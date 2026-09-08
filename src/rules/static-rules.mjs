import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { lineOf, relative, sourceFiles } from '../utils.mjs';

const severityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };

export async function scanProject(projectKey, project) {
  const files = await sourceFiles(project.root);
  const findings = [];
  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    const context = { projectKey, project, file: relative(project.root, file), content };
    findings.push(...scanFile(context));
  }
  return findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

export function scanFile(context) {
  return [
    ...jeecgBusinessRules(context),
    ...mobileFixedRules(context),
    ...componentConsistencyRules(context),
    ...dataScreenRules(context),
    ...ssoContractRules(context),
    ...tokenRules(context),
  ];
}

function ssoContractRules(context) {
  if (!/ticketUac/.test(context.content)) return [];
  const findings = [];
  const active = stripComments(context.content);
  const activeContext = { ...context, content: active };
  const handlesPlaceholder = /ticketUac\s*(?:===|==)\s*['"]-1['"]|['"]-1['"]\s*(?:===|==)\s*ticketUac/.test(active);

  if (handlesPlaceholder && !/getCheckLoginUrl/.test(active)) {
    addFirst(findings, activeContext, /ticketUac\s*(?:===|==)\s*['"]-1['"]|['"]-1['"]\s*(?:===|==)\s*ticketUac/, {
      ruleId: 'SSO_CHECK_LOGIN_URL_MISSING', severity: 'P1', title: '单点登录占位票据缺少认证地址获取流程',
      message: '代码识别了ticketUac=-1，但没有调用getCheckLoginUrl获取认证地址，可能停留在登录页而无法进入统一认证中心。',
      suggestion: '在-1分支请求/uac/getCheckLoginUrl，保留并编码redirect参数后使用location.replace跳转到返回的同源或受信任认证地址。',
    });
  }

  if (/getCheckLoginUrl/.test(active) && !/(?:window\.)?location\.(?:href|replace|assign)\s*(?:=|\()/.test(active)) {
    addFirst(findings, activeContext, /getCheckLoginUrl/, {
      ruleId: 'SSO_CHECK_LOGIN_REDIRECT_MISSING', severity: 'P1', title: '已获取单点认证地址但未执行浏览器重定向',
      message: '调用了getCheckLoginUrl，但没有发现location跳转，认证流程可能无法离开当前系统。',
      suggestion: '校验返回地址后使用window.location.replace或assign进入统一认证中心，避免仅在SPA路由中跳转外部URL。',
    });
  }

  if (!handlesPlaceholder && /(?:validateLogin|JiTuanDDLogin)/.test(active)) {
    addFirst(findings, activeContext, /(?:validateLogin|JiTuanDDLogin)/, {
      ruleId: 'SSO_PLACEHOLDER_TICKET_UNHANDLED', severity: 'P1', title: '单点登录未区分占位票据',
      message: '代码会校验ticketUac，但没有发现对-1占位票据的独立处理，可能把无效票据提交给validateLogin。',
      suggestion: '先处理ticketUac=-1的认证地址获取流程，只有返回真实票据后才调用validateLogin。',
    });
  }

  return findings;
}

function jeecgBusinessRules(context) {
  if (context.project.type !== 'jeecg-admin') return [];
  const findings = [];
  const active = stripComments(context.content);
  const activeContext = { ...context, content: active };

  if (context.file === 'src/router/helper/routeHelper.ts' && /route\.children\s*=\s*\[cloneDeep\(route\)\]/.test(active)) {
    addFirst(findings, activeContext, /route\.children\s*=\s*\[cloneDeep\(route\)\]/, {
      ruleId: 'ROUTE_CHILDREN_BLANK_PAGE', severity: 'P1', title: '单页路由被再次包装为children',
      message: '架构层把已有component路由克隆到children，叠加子级校验后可能形成空路径父子路由并出现白屏。',
      suggestion: '用已知异常菜单做路由解析测试；不要直接改框架，先为转换前后的path、name、component和children建立快照断言。',
    });
  }

  if (!context.file.startsWith('src/views/safe/')) return findings;

  if (/<BasicTable\b/.test(active) && /(?:rowSelection|:row-selection)/i.test(active) && !/\browKey\s*(?:=|:)/.test(active)) {
    addFirst(findings, activeContext, /(?:rowSelection|:row-selection)/i, {
      ruleId: 'TABLE_SELECTION_WITHOUT_ROW_KEY', severity: 'P1', title: '表格选择缺少稳定rowKey',
      message: '表格启用了单选或多选，但没有有效rowKey；筛选、翻页或全选后选择状态可能指向错误记录。',
      suggestion: '显式设置唯一且稳定的rowKey，并验证接口每条记录都包含该字段。',
    });
  }

  addGrouped(findings, activeContext, /field\s*:\s*['"]['"]/g, {
    ruleId: 'EMPTY_FORM_FIELD_KEY', severity: 'P1', title: '表单Schema使用空field',
    message: '多个展示项共用空field会产生重复key和错误字段映射，动态显示或回显时尤其不稳定。',
    suggestion: '即使字段只展示，也为每一项设置唯一field，例如display_cityCode_dictText。',
  });

  if (/\.then\s*\([\s\S]{0,900}?\}\s*finally\s*\{/.test(active)) {
    addFirst(findings, activeContext, /[A-Za-z_$][\w$]*\([^;\n]*\)\.then\s*\(/, {
      ruleId: 'MODAL_REQUEST_NOT_AWAITED', severity: 'P1', title: '弹窗请求未await但外层使用finally',
      message: 'finally会在接口完成前执行，confirmLoading可能提前关闭，列表刷新、关闭弹窗与接口结果发生竞态。',
      suggestion: '改为await请求后再emit success和closeModal，并只在finally里恢复loading。',
    });
  }

  if (/<template\s+#footer[\s\S]*?<\/template>/.test(active)
    && /setModalProps\s*\(\s*\{[^}]*confirmLoading\s*:\s*true/.test(active)
    && !/<a-button[^>]*:loading\s*=/.test(active)) {
    addFirst(findings, activeContext, /<template\s+#footer/, {
      ruleId: 'CUSTOM_MODAL_LOADING_UNBOUND', severity: 'P1', title: '自定义弹窗按钮未绑定loading',
      message: '代码设置了confirmLoading，但自定义footer按钮没有:loading绑定，请求期间用户看不到加载状态且仍可重复点击。',
      suggestion: '将提交锁同时绑定到按钮:loading和:disabled，并保证请求被await后再释放。',
    });
  }

  if (/await\s+[A-Za-z_$][\w$]*\([^;]*\);[\s\S]{0,420}?(?:createMessage|message)\.success\s*\(/.test(active)) {
    addFirst(findings, activeContext, /(?:createMessage|message)\.success\s*\(/, {
      ruleId: 'DUPLICATE_SUCCESS_MESSAGE', severity: 'P2', title: '业务层可能重复显示成功提示',
      message: '项目Axios默认successMessageMode为success，接口完成后业务代码又手动提示，可能连续出现两条message。',
      suggestion: '二选一：删除业务层提示，或在该接口请求选项中显式设置successMessageMode: none。',
    });
  }

  addGrouped(findings, activeContext, /\b[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*_dictText\b/g, {
    ruleId: 'DICT_TEXT_RESPONSE_CONTRACT', severity: 'P2', title: '页面依赖接口返回_dictText字段',
    message: '页面直接读取_dictText；若接口只返回字典值而没有对应文本字段，页面会空白或回显原始值。',
    suggestion: '把基础字段与对应_dictText加入接口契约测试；缺失时统一走前端字典解析，不要临时写死默认文本。',
  });

  if (context.file.endsWith('.api.ts') && /params\s*:\s*Object\b/.test(active)) {
    addGrouped(findings, activeContext, /params\s*:\s*Object\b/g, {
      ruleId: 'UNTYPED_API_PARAMS', severity: 'P2', title: '接口参数使用宽泛Object类型',
      message: 'Object无法约束字段名和number/string类型，联调时的类型混淆及AI擅自补默认值无法在编译期发现。',
      suggestion: '为每个接口定义明确Request类型，并避免用空串、0等值替代缺失字段，除非接口契约明确要求。',
    });
  }
  return findings;
}

function mobileFixedRules(context) {
  if (context.project.type !== 'mobile-vue') return [];
  const findings = [];
  addGrouped(findings, context, /position\s*:\s*fixed\b/g, {
    ruleId: 'MOBILE_FIXED_OCCLUSION', severity: 'P2', title: '移动端固定定位存在遮挡风险',
    message: '固定定位元素可能在小屏或软键盘弹出后覆盖输入框和操作按钮。',
    suggestion: '结合 safe-area-inset-bottom、visualViewport 或可滚动容器处理，并加入键盘缩屏测试。',
  });
  addGrouped(findings, context, /(?:height|min-height)\s*:\s*100vh\b/g, {
    ruleId: 'MOBILE_100VH', severity: 'P2', title: '移动端直接使用100vh',
    message: '移动浏览器地址栏和软键盘会改变可视高度，100vh容易造成底部内容不可见。',
    suggestion: '优先使用100dvh或由visualViewport更新的CSS变量。',
  });
  return findings;
}

function componentConsistencyRules(context) {
  const findings = [];
  if (!isBusinessView(context.file)) return findings;
  if (context.project.type === 'jeecg-admin') {
    const rules = [
      ['a-upload', 'RAW_UPLOAD_COMPONENT', 'P2', 'JUpload/JUploadButton', '鉴权、签名和统一上传交互'],
      ['a-modal', 'RAW_MODAL_COMPONENT', 'P2', 'BasicModal', '弹窗宽度、loading、footer和二次确认样式'],
      ['a-table', 'RAW_TABLE_COMPONENT', 'P2', 'BasicTable', '分页、rowKey、选择状态、空状态和操作列规范'],
      ['a-form', 'RAW_FORM_COMPONENT', 'P3', 'BasicForm/JVxeTable', '校验、布局、字典和提交状态'],
      ['a-select', 'RAW_SELECT_COMPONENT', 'P3', 'JDictSelectTag/ApiSelect/BasicForm Schema', '字典、搜索和字段回显'],
      ['a-tree-select', 'RAW_TREE_SELECT_COMPONENT', 'P3', 'JTreeSelect/JCategorySelect', '树数据加载、回显和字段映射'],
    ];
    for (const [tag, ruleId, severity, preferred, capabilities] of rules) {
      const regex = new RegExp(`<${tag}\\b`, 'i');
      if (!regex.test(context.content) || isFrameworkComponentException(context, tag)) continue;
      addFirst(findings, context, regex, {
        ruleId, severity, title: `业务页直接使用${tag}`,
        message: `Jeecg项目应优先复用框架已有组件，直接使用${tag}可能绕过${capabilities}。`,
        suggestion: `优先使用${preferred}；确属特殊场景时添加带原因的audit-allow-jeecg-component例外声明。`,
      });
    }
  }
  const lines = context.content.split('\n');
  lines.forEach((line, index) => {
    if (!/component\s*:\s*['"]Select['"]/.test(line)) return;
    const windowText = lines.slice(Math.max(0, index - 8), index + 18).join('\n');
    if (/field\s*:\s*['"][^'"]*(status|type|level|category|scene)[^'"]*['"]/i.test(windowText) && /options\s*:/.test(windowText)) {
      findings.push(makeFinding(context, index + 1, {
        ruleId: 'INLINE_BUSINESS_DICTIONARY', severity: 'P3', title: '疑似在前端硬编码业务字典',
        message: '状态、类型或级别字段使用内联options，可能与内部字典不一致。',
        suggestion: '改用JDictSelectTag和明确的dictCode，或在规则白名单中声明。',
      }, line.trim()));
    }
  });
  return findings;
}

function isFrameworkComponentException(context, tag) {
  if (context.file.startsWith('src/components/')) return true;
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const marker = new RegExp(`audit-allow-jeecg-component\\s*:?\\s*(?:${escaped}|all)\\b([^\\n]*)`, 'i');
  const match = marker.exec(context.content);
  if (!match) return false;
  const reason = match[1].replace(/-->|\*\/|#>/g, '').trim();
  return reason.length >= 2;
}

function dataScreenRules(context) {
  if (context.project.type !== 'data-screen') return [];
  const findings = [];
  const active = stripComments(context.content);
  const activeContext = { ...context, content: active };

  if (/provide\s*\(\s*['"]screenData['"]\s*,\s*screenData\s*\)/.test(active)
    && !/screenData\.value\s*=/.test(active)) {
    addFirst(findings, activeContext, /provide\s*\(\s*['"]screenData['"]/, {
      ruleId: 'SCREEN_DATA_PROVIDED_BUT_NEVER_UPDATED', severity: 'P1', title: '共享大屏数据从未更新',
      message: 'screenData被provide给子组件，但当前文件没有任何screenData.value赋值，后续数据变化无法沿响应式链路传播。',
      suggestion: '建立统一刷新入口更新screenData，子组件watch对应数据切片并复用ECharts实例setOption。',
    });
  }

  const hasChart = /echarts\.init\s*\(/.test(active);
  const loadsData = /(?:async\s+)?(?:function\s+loadData|const\s+loadData\s*=)/.test(active) && /onMounted\s*\(/.test(active);
  const observesData = /\bwatch(?:Effect)?\s*\(/.test(active);
  if (hasChart && loadsData && !observesData) {
    addFirst(findings, activeContext, /onMounted\s*\(/, {
      ruleId: 'ECHARTS_DATA_UPDATE_UNOBSERVED', severity: 'P1', title: 'ECharts数据只在挂载时加载',
      message: '组件只在onMounted加载并绘制一次，接口数据或共享状态后续变化时没有watch/watchEffect触发setOption。',
      suggestion: '将数据获取与图表渲染分离；监听数据变化后调用现有实例setOption，而不是重新init。',
    });
  }

  if (hasChart && observesData && !/getInstanceByDom\s*\(|myChart\?\.setOption|chartInstance\?\.setOption/.test(active)) {
    addFirst(findings, activeContext, /\bwatch(?:Effect)?\s*\(/, {
      ruleId: 'ECHARTS_REINIT_ON_DATA_UPDATE', severity: 'P1', title: '数据变化后可能重复初始化ECharts',
      message: '组件监听了数据变化，但没有发现实例复用保护；再次echarts.init可能产生重复实例、事件和定时器。',
      suggestion: '初始化只执行一次，更新时调用chart.setOption(option, { notMerge: false })；卸载时dispose。',
    });
  }

  const initFunctions = [...active.matchAll(/(?:function\s+|const\s+)([A-Za-z_$][\w$]*)[^=\n]*(?:=\s*)?(?:\([^)]*\)\s*=>)?\s*\{[\s\S]{0,900}?echarts\.init\s*\(/g)];
  for (const match of initFunctions) {
    const functionName = match[1];
    const calls = [...active.matchAll(new RegExp(`\\b${functionName}\\s*\\(`, 'g'))].length;
    if (calls > 2 && !/getInstanceByDom\s*\(/.test(active)) {
      findings.push(makeFinding(activeContext, lineOf(active, match.index), {
        ruleId: 'ECHARTS_INIT_FUNCTION_REENTERED', severity: 'P2', title: '包含echarts.init的函数会被重复调用',
        message: `${functionName}在文件中被调用${calls - 1}次，可能重复创建实例并绑定事件。`,
        suggestion: '缓存ECharts实例；重复进入时只setOption和resize，创建新实例前必须dispose旧实例。',
      }, functionName));
      break;
    }
  }
  if (/echarts/i.test(active)) {
    addGrouped(findings, activeContext, /document\.getElementById\s*\(/g, {
      ruleId: 'ECHARTS_HARDCODED_DOM', severity: 'P2', title: '大屏图表依赖DOM ID',
      message: '通过固定ID初始化图表，组件复用、条件渲染或切换数据时容易拿到旧DOM。',
      suggestion: '优先使用template ref，并在数据更新后setOption；卸载时dispose。',
    });
  }
  if (/setInterval\s*\(/.test(active) && !/clearInterval\s*\(/.test(active)) {
    addFirst(findings, activeContext, /setInterval\s*\(/, {
      ruleId: 'UNCLEARED_INTERVAL', severity: 'P1', title: '定时器可能未清理',
      message: '文件创建了setInterval，但没有发现clearInterval，页面重复进入后可能叠加执行。',
      suggestion: '保存定时器句柄，并在onUnmounted中清理。',
    });
  }
  if (/echarts\.init|\(echarts\.init/.test(active) && !/(ResizeObserver|\.resize\s*\(|addEventListener\s*\(\s*['"]resize)/.test(active)) {
    addFirst(findings, activeContext, /echarts\.init|\(echarts\.init/, {
      ruleId: 'ECHARTS_NO_RESIZE', severity: 'P2', title: 'ECharts未发现尺寸变化处理',
      message: '图表初始化后没有发现resize或ResizeObserver，大屏缩放时可能错位。',
      suggestion: '统一封装ResizeObserver并在组件卸载时dispose。',
    });
  }
  return findings;
}

function tokenRules(context) {
  const findings = [];
  const unsafeQueryToken = /(?:const|let)\s+token\s*=\s*[^\n]*query[^\n]*[\s\S]{0,500}?localStorage\.setItem\s*\([^\n]*token[^\n]*[\s\S]{0,180}?if\s*\(\s*token\s*\)/i;
  if (unsafeQueryToken.test(context.content)) {
    addFirst(findings, context, /localStorage\.setItem\s*\([^\n]*token/i, {
      ruleId: 'LOGIN_TOKEN_ORDER', severity: 'P1', title: 'Token在有效性判断前写入',
      message: 'URL没有Token时可能把字符串“undefined”写入存储，路由误判已登录并提前发起业务请求。',
      suggestion: '先校验query token，再统一写入Token Service；登录完成并初始化用户状态后再进入业务路由。',
    });
    return findings;
  }
  addGrouped(findings, context, /localStorage\.setItem\s*\([^\n]*(token|Token|TOKEN)/g, {
    ruleId: 'DIRECT_TOKEN_STORAGE', severity: 'P1', title: '直接写入Token存储',
    message: '直接写localStorage可能绕过统一状态更新，造成登录后首批请求早于Token就绪。',
    suggestion: '通过统一Token Service完成写入，再等待用户状态初始化后挂载路由和发起业务请求。',
  });
  return findings;
}

function isBusinessView(file) {
  if (!file.startsWith('src/views/')) return false;
  return !/^src\/views\/(?:sys|system|demo|monitor|components)\//.test(file);
}

function addGrouped(target, context, regex, meta) {
  const matches = [];
  let match;
  while ((match = regex.exec(context.content))) {
    const line = lineOf(context.content, match.index);
    if (!isCommentLine(context.content, line)) matches.push({ line, evidence: match[0] });
  }
  if (!matches.length) return;
  const first = matches[0];
  const countText = matches.length > 1 ? ` 本文件共发现${matches.length}处。` : '';
  target.push(makeFinding(context, first.line, { ...meta, message: `${meta.message}${countText}` }, first.evidence));
}

function addEach(target, context, regex, meta, limit) {
  let match;
  let count = 0;
  while ((match = regex.exec(context.content)) && count < limit) {
    const line = lineOf(context.content, match.index);
    if (isCommentLine(context.content, line)) continue;
    target.push(makeFinding(context, line, meta, match[0]));
    count += 1;
  }
}

function addFirst(target, context, regex, meta) {
  const match = regex.exec(context.content);
  if (match) {
    const line = lineOf(context.content, match.index);
    if (!isCommentLine(context.content, line)) target.push(makeFinding(context, line, meta, match[0]));
  }
}

function isCommentLine(content, line) {
  const value = content.split('\n')[line - 1]?.trim() || '';
  return value.startsWith('//') || value.startsWith('*') || value.startsWith('<!--');
}

function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, (value) => value.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (value) => ' '.repeat(value.length));
}

function makeFinding(context, line, meta, evidence) {
  const lines = context.content.split('\n');
  const nearby = lines.slice(Math.max(0, line - 2), line + 1).join('\n').replace(/\s+/g, ' ').trim();
  const contextHash = crypto.createHash('sha256').update(nearby).digest('hex').slice(0, 16);
  return { project: context.projectKey, file: context.file, line, evidence, contextHash, ...meta };
}
