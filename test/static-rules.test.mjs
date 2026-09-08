import test from 'node:test';
import assert from 'node:assert/strict';
import { scanFile } from '../src/rules/static-rules.mjs';

test('H5固定定位和100vh会触发移动端规则', () => {
  const findings = scanFile({
    projectKey: 'mobile', project: { type: 'mobile-vue' }, file: 'src/demo.vue',
    content: '.page { height: 100vh; } .footer { position: fixed; bottom: 0; }',
  });
  assert.ok(findings.some((item) => item.ruleId === 'MOBILE_FIXED_OCCLUSION'));
  assert.ok(findings.some((item) => item.ruleId === 'MOBILE_100VH'));
});

test('大屏定时器和ECharts固定ID会触发规则', () => {
  const findings = scanFile({
    projectKey: 'screen', project: { type: 'data-screen' }, file: 'src/chart.ts',
    content: "setInterval(load, 1000); echarts.init(document.getElementById('chart'))",
  });
  assert.ok(findings.some((item) => item.ruleId === 'UNCLEARED_INTERVAL'));
  assert.ok(findings.some((item) => item.ruleId === 'ECHARTS_HARDCODED_DOM'));
  assert.ok(findings.some((item) => item.ruleId === 'ECHARTS_NO_RESIZE'));
});

test('业务页直接使用上传组件会触发一致性规则', () => {
  const findings = scanFile({
    projectKey: 'admin', project: { type: 'jeecg-admin' }, file: 'src/views/demo.vue',
    content: '<template><a-upload /></template>',
  });
  assert.equal(findings[0].ruleId, 'RAW_UPLOAD_COMPONENT');
});

test('Jeecg业务页直接使用基础表单和选择器会触发组件优先规则', () => {
  const findings = scanFile({
    projectKey: 'admin', project: { type: 'jeecg-admin' }, file: 'src/views/orders/Edit.vue',
    content: '<template><a-form><a-select /></a-form></template>',
  });
  assert.ok(findings.some((item) => item.ruleId === 'RAW_FORM_COMPONENT'));
  assert.ok(findings.some((item) => item.ruleId === 'RAW_SELECT_COMPONENT'));
});

test('框架组件和带原因的特殊场景不会触发基础组件规则', () => {
  const frameworkFindings = scanFile({
    projectKey: 'admin', project: { type: 'jeecg-admin' }, file: 'src/views/orders/index.vue',
    content: '<template><BasicTable /><BasicModal /><BasicForm /></template>',
  });
  const exceptionFindings = scanFile({
    projectKey: 'admin', project: { type: 'jeecg-admin' }, file: 'src/views/orders/Special.vue',
    content: '<!-- audit-allow-jeecg-component: a-table 第三方虚拟滚动兼容 -->\n<a-table />',
  });
  assert.ok(!frameworkFindings.some((item) => item.ruleId?.startsWith('RAW_')));
  assert.ok(!exceptionFindings.some((item) => item.ruleId === 'RAW_TABLE_COMPONENT'));
});

test('没有填写原因的组件例外声明无效', () => {
  const findings = scanFile({
    projectKey: 'admin', project: { type: 'jeecg-admin' }, file: 'src/views/orders/Special.vue',
    content: '<!-- audit-allow-jeecg-component: a-table -->\n<a-table />',
  });
  assert.ok(findings.some((item) => item.ruleId === 'RAW_TABLE_COMPONENT'));
});

test('URL Token先写入再判断会触发登录时序规则', () => {
  const findings = scanFile({
    projectKey: 'screen', project: { type: 'data-screen' }, file: 'src/views/sys/login/Login.vue',
    content: `const token = route.query.token;
      localStorage.setItem('yunshuToken', token);
      if (token) userStore.login(token);`,
  });
  assert.ok(findings.some((item) => item.ruleId === 'LOGIN_TOKEN_ORDER'));
  assert.ok(!findings.some((item) => item.ruleId === 'DIRECT_TOKEN_STORAGE'));
});

test('ticketUac为-1但未获取认证地址会触发单点登录契约规则', () => {
  const findings = scanFile({
    projectKey: 'admin', project: { type: 'jeecg-admin' }, file: 'src/hooks/web/useSsoLogin.ts',
    content: `const ticketUac = params.get('ticketUac');
      if (!ticketUac || ticketUac === '-1') return;
      await validateLogin({ ticketUac });`,
  });
  assert.ok(findings.some((item) => item.ruleId === 'SSO_CHECK_LOGIN_URL_MISSING'));
});

test('完整的单点登录两阶段流程不会触发认证地址规则', () => {
  const findings = scanFile({
    projectKey: 'admin', project: { type: 'jeecg-admin' }, file: 'src/hooks/web/useSsoLogin.ts',
    content: `if (ticketUac === '-1') {
      const checkLogin = await getCheckLoginUrl();
      window.location.replace(checkLogin);
    } else {
      await validateLogin({ ticketUac });
    }`,
  });
  assert.ok(!findings.some((item) => item.ruleId?.startsWith('SSO_')));
});

test('普通DOM查询不会误报为ECharts固定ID', () => {
  const findings = scanFile({
    projectKey: 'screen', project: { type: 'data-screen' }, file: 'src/theme.ts',
    content: "document.getElementById('theme-link')",
  });
  assert.ok(!findings.some((item) => item.ruleId === 'ECHARTS_HARDCODED_DOM'));
});

test('Jeecg表格选择缺少rowKey会触发规则', () => {
  const findings = scanFile({
    projectKey: 'admin', project: { type: 'jeecg-admin' }, file: 'src/views/safe/demo/Modal.vue',
    content: '<BasicTable :rowSelection="rowSelection" /> // rowKey: id',
  });
  assert.ok(findings.some((item) => item.ruleId === 'TABLE_SELECTION_WITHOUT_ROW_KEY'));
});

test('空field和未await的弹窗请求会触发规则', () => {
  const findings = scanFile({
    projectKey: 'admin', project: { type: 'jeecg-admin' }, file: 'src/views/safe/demo/EditModal.vue',
    content: `const schemas = [{ field: '', component: 'Input' }];
      try { save(values).then(() => emit('success')); } finally { setModalProps({ confirmLoading: false }); }`,
  });
  assert.ok(findings.some((item) => item.ruleId === 'EMPTY_FORM_FIELD_KEY'));
  assert.ok(findings.some((item) => item.ruleId === 'MODAL_REQUEST_NOT_AWAITED'));
});

test('宽泛Object接口参数会触发类型契约规则', () => {
  const findings = scanFile({
    projectKey: 'admin', project: { type: 'jeecg-admin' }, file: 'src/views/safe/demo/index.api.ts',
    content: 'export const save = (params: Object) => defHttp.post({ url, params });',
  });
  assert.ok(findings.some((item) => item.ruleId === 'UNTYPED_API_PARAMS'));
});

test('自定义弹窗footer没有绑定loading会触发规则', () => {
  const findings = scanFile({
    projectKey: 'admin', project: { type: 'jeecg-admin' }, file: 'src/views/safe/demo/EditModal.vue',
    content: `<BasicModal><template #footer><a-button @click="submit">提交</a-button></template></BasicModal>
      setModalProps({ confirmLoading: true });`,
  });
  assert.ok(findings.some((item) => item.ruleId === 'CUSTOM_MODAL_LOADING_UNBOUND'));
});

test('ECharts只在挂载时加载数据会触发更新遗漏规则', () => {
  const findings = scanFile({
    projectKey: 'screen', project: { type: 'data-screen' }, file: 'src/views/screen/components/Chart.vue',
    content: `const loadData = async () => { data.value = await fetchData(); chart = echarts.init(el); chart.setOption(option); };
      onMounted(() => loadData());`,
  });
  assert.ok(findings.some((item) => item.ruleId === 'ECHARTS_DATA_UPDATE_UNOBSERVED'));
});

test('provide的screenData从未赋值会触发规则', () => {
  const findings = scanFile({
    projectKey: 'screen', project: { type: 'data-screen' }, file: 'src/views/screen/index.vue',
    content: `const screenData = ref({}); provide('screenData', screenData);`,
  });
  assert.ok(findings.some((item) => item.ruleId === 'SCREEN_DATA_PROVIDED_BUT_NEVER_UPDATED'));
});
