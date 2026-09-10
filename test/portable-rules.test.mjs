import test from 'node:test';
import assert from 'node:assert/strict';
import { scanFile } from '../src/rules/static-rules.mjs';

const scan = (file, content, type = 'jeecg-admin') => scanFile({
  projectKey: 'fixture', project: { type }, file, content,
});
const has = (findings, id) => findings.some((item) => item.ruleId === id);

test('任意views业务层级和历史排除目录都执行Jeecg规则', () => {
  for (const file of [
    'src/views/index.vue', 'src/views/orders/index.vue',
    'src/views/member/settings/grade/index.vue', 'src/views/system/users/index.vue',
    'src/views/sys/index.vue', 'src/views/demo/index.vue',
    'src/views/monitor/index.vue', 'src/views/components/Edit.vue',
  ]) {
    const result = scan(file, '<BasicTable :rowSelection="selection" /><a-upload />');
    assert.ok(has(result, 'TABLE_SELECTION_WITHOUT_ROW_KEY'), file);
    assert.ok(has(result, 'RAW_UPLOAD_COMPONENT'), file);
  }
});

test('公共组件与相似前缀不作为业务页面扫描', () => {
  for (const file of ['src/components/Table.vue', 'src/views-old/Table.vue', 'src/view/Table.vue']) {
    assert.equal(scan(file, '<BasicTable :rowSelection="selection" /><a-upload />').length, 0);
  }
});

test('Windows路径归一化且和POSIX路径生成相同结果', () => {
  const content = '<BasicTable :rowSelection="selection" />';
  assert.deepEqual(scan('src\\views\\orders\\index.vue', content), scan('src/views/orders/index.vue', content));
});

test('支持rowKey和row-key，不把有效声明标为缺失', () => {
  for (const attr of ['rowKey="id"', ':row-key="keyField"', 'v-bind:row-key="keyField"']) {
    assert.ok(!has(scan('src/views/orders/index.vue', `<BasicTable :rowSelection="selection" ${attr} />`), 'TABLE_SELECTION_WITHOUT_ROW_KEY'));
  }
});

test('api.ts和页面内参数声明不依赖.api.ts命名', () => {
  for (const file of ['src/views/member/api.ts', 'src/views/member/index.api.ts', 'src/views/member/index.vue']) {
    assert.ok(has(scan(file, 'const save = (params: Object) => post(params);'), 'UNTYPED_API_PARAMS'), file);
  }
  assert.ok(!has(scan('src/views/member/api.ts', 'const save = (params: SaveRequest) => post(params);'), 'UNTYPED_API_PARAMS'));
});

test('路由规则不依赖routeHelper固定文件名', () => {
  assert.ok(has(scan('src/router/helpers/menu.ts', 'route.children = [cloneDeep(route)];'), 'ROUTE_CHILDREN_BLANK_PAGE'));
});

test('注释中的组件和表格配置不参与判断，例外声明仍有效', () => {
  assert.equal(scan('src/views/orders/index.vue', '<!--\n<a-table />\n<a-upload />\n-->').length, 0);
  assert.ok(has(scan('src/views/orders/index.vue', '<!-- rowKey: id -->\n<BasicTable :rowSelection="selection" />'), 'TABLE_SELECTION_WITHOUT_ROW_KEY'));
  assert.ok(!has(scan('src/views/orders/index.vue', '<!-- audit-allow-jeecg-component: a-table 虚拟滚动适配 -->\n<a-table />'), 'RAW_TABLE_COMPONENT'));
});

test('图表实例复用不限定myChart或chartInstance变量名', () => {
  const result = scan('src/views/screen/Chart.vue', 'const salesChart = echarts.init(el); watch(data, () => salesChart.setOption(options));', 'data-screen');
  assert.ok(!has(result, 'ECHARTS_REINIT_ON_DATA_UPDATE'));
});

test('重复提示只报告风险，不假定业务项目开启了统一提示', () => {
  const result = scan('src/views/orders/index.vue', 'await save(values); message.success("完成");');
  const finding = result.find((item) => item.ruleId === 'DUPLICATE_SUCCESS_MESSAGE');
  assert.ok(finding);
  assert.match(finding.message, /未验证/);
});
