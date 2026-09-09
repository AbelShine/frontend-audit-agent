# Frontend Audit Agent

> 首次使用、添加新项目或配合编码Agent工作，请先阅读
> [组内使用手册](docs/TEAM_USAGE.md)。

面向常见企业前端项目的交付巡检工具：

- JeecgBoot/Vue后台
- Vue移动端与H5
- ECharts数据大屏
- UniApp项目（当前复用移动端运行时检查，专项规则持续补充）

工具只读取业务项目，不修改它们。检查结果和浏览器登录状态保存在本工具目录。

## 项目价值

- **规则可复用**：把路由白屏、表格选择、字典回显、重复提示、请求竞态和图表更新等团队经验沉淀成固定规则。
- **结果可追溯**：每个发现都有稳定ID、代码证据和处理状态，已确认问题不会被反复提示，代码变化后可以识别回归。
- **静态与运行时结合**：既扫描源码，也观察真实页面、网络请求、控制台、布局和截图，减少只看代码造成的误判。
- **安全验证**：交互巡检默认拦截业务写请求，可以检查loading、重复提交、提示次数和列表刷新而不修改业务数据。
- **不绑定AI工具**：命令行和JSON报告可以被Codex、Qoder、Trae、VS Code或CI调用；本地规则执行本身不消耗模型Token。
- **保护项目隐私**：业务源码留在本机，个人配置、登录状态、报告与问题台账默认不会进入Git。

对于已知文件中的一次性问题，直接询问编码Agent通常更快；对于多个项目的重复检查、版本回归和团队统一验收，本工具更有价值。

## 当前能力

静态检查：

- Jeecg业务页面是否优先使用BasicTable、BasicForm、BasicModal、JUpload、JDictSelectTag等框架组件
- 移动端固定定位和`100vh`风险
- 业务页绕过公共上传、弹窗、表格组件
- 疑似前端硬编码内部业务字典
- ECharts固定DOM ID、缺少resize、定时器未清理
- ECharts数据只加载一次、共享数据未更新、数据变化时重复init
- 直接写入Token导致的初始化时序风险
- URL Token在校验前写入存储的登录竞态
- 单点登录占位票据、认证地址获取、票据校验与业务回跳契约
- Jeecg动态路由children包装导致的空白页风险
- 表格选择缺少稳定rowKey、表单Schema空field
- 弹窗请求未await导致loading与列表刷新竞态
- Axios统一提示与业务message重复
- `_dictText`接口回显契约和宽泛Object参数类型

Jeecg业务代码确实需要直接使用底层组件时，必须在对应文件写明原因：

```html
<!-- audit-allow-jeecg-component: a-table 第三方虚拟滚动兼容 -->
```

无原因的例外声明不会生效。公共框架组件目录`src/components/`默认允许封装底层组件。

运行时检查：

- 多分辨率截图
- 控制台和页面错误
- 失败请求与HTTP错误
- 短时间重复接口请求
- 横向溢出、可点击元素遮挡、图表尺寸异常
- H5模拟键盘缩屏后的输入框遮挡

## 安装

```bash
cd frontend-audit-agent
npm install
npx playwright install chromium
```

首次使用时可以直接修改`config/projects.json`中的通用示例。`root`支持相对于本工具目录的路径；个人配置也可以放在`config/projects.local.json`，该文件优先加载且不会提交到Git。

临时检查其他项目时，可以通过`FRONTEND_AUDIT_PROJECTS_FILE`指定项目配置文件，无需改动仓库中的公共配置。

推荐目录结构：

```text
workspace/
├── frontend-audit-agent/
├── admin-project/
├── mobile-project/
└── screen-project/
```

## 静态扫描

```bash
npm run scan
```

也可以只扫描一个项目：

```bash
node src/cli.mjs scan admin
node src/cli.mjs scan mobile
node src/cli.mjs scan screen
```

## 保存测试登录状态

业务页面需要登录时，执行：

```bash
npm run auth -- admin
```

工具会打开独立浏览器。手动登录成功后回到终端按Enter。登录状态只保存在本地`.auth/`，已被Git忽略。大屏可执行`npm run auth -- screen`。

## 运行页面巡检

先单独启动被测项目。如果多个项目默认使用同一端口，可通过命令行参数为其中一个项目指定其他端口，不需要修改业务源码：

```bash
cd ../mobile-project
npm run dev -- --port 3101
```

随后执行：

```bash
cd ../frontend-audit-agent
npm run audit -- mobile
```

报告输出到`output/<时间>/index.html`，同时保留机器可读的`report.json`，后续可以提供给Codex或Qoder修复。

## 联动自动测试

如果本工具同级目录存在`frontend-test-agent`，可以执行：

```bash
npm start -- admin
```

该命令会先运行Audit页面巡检，再自动调用Test项目执行同一项目的测试。找不到Test项目时只运行Audit并正常结束。也可以用环境变量`FRONTEND_TEST_AGENT_DIR`指定Test项目目录。

### Windows一键启动工作区

先在`config/projects.local.json`中配置真实业务项目的`root`、`url`和`startCommand`，然后在PowerShell运行：

```powershell
# 启动admin业务项目，等待页面可访问，再运行Audit并联动Test
.\start-workspace.ps1 admin

# 只启动业务项目，不执行巡检
.\start-workspace.ps1 admin -SkipAudit

# 显示巡检浏览器
.\start-workspace.ps1 admin -Headed
```

如果业务地址已经可以访问，脚本会复用现有进程，不会重复启动。业务项目会在独立PowerShell窗口中持续运行；Audit完成后该窗口不会被关闭。

如果Windows禁止执行本地脚本，可以只为当前终端放开：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\start-workspace.ps1 admin
```

## 安全交互巡检

先保存登录状态，然后运行：

```bash
npm run interact -- admin
```

在打开的浏览器中完成“筛选 → 全选/单选 → 打开弹窗 → 提交”。工具会放行登录、验证码和鉴权请求；其他POST、PUT、PATCH、DELETE返回延迟900ms的模拟成功响应，不修改真实业务数据，同时检查：

- 表格行key缺失或重复
- 写请求期间是否出现loading
- 相同写接口是否重复提交
- 成功提示是否重复出现
- 写操作后是否重新请求列表
- ID、Code、Status、Type等字段是否出现可疑空串或0默认值
- 弹窗footer溢出、按钮数量与宽度、操作颜色重复

按钮语义颜色和弹窗最小宽度位于`config/ui-policy.json`，可以按组内规范调整。

## 下一阶段

- 增加页面操作脚本：搜索、弹窗、表单提交、空数据注入
- 建立组内组件白名单和允许例外配置
- 对接模型，对截图、网络证据和Git Diff进行归因
- 暴露MCP工具，让Codex/Qoder运行巡检并读取失败证据

## 给编码Agent使用

把项目路径、需求、后端完成内容和允许的操作范围一起提供给Codex、Qoder、Trae或其他编码Agent。推荐先让Agent只读分析，确认方案后再授权修改。可直接复制的提示词和多项目协作方式见[使用手册](docs/TEAM_USAGE.md)。

## 问题台账与免重复检查

每个发现都有稳定ID，例如`F-12AB34CD56`。处理决定保存在`state/findings.json`。

```bash
# 确认当前写法合理，以后相同证据不再显示
npm run decide -- F-12AB34CD56 accepted 已与后端确认

# 标记误报
npm run decide -- F-12AB34CD56 false_positive 框架内部特殊实现

# 临时忽略
npm run decide -- F-12AB34CD56 ignored 本期不处理

# 重新打开
npm run decide -- F-12AB34CD56 open 重新检查

# 查看台账
npm run history
```

扫描不到的开放问题会自动转为`resolved`。已处理问题如果相关代码证据变化会生成新ID重新检查；已解决问题再次出现会标记为“回归”。
