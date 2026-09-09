# Frontend Audit Agent 组内使用手册

这份文档用于把工具直接交给组内同事使用，适用于 JeecgBoot 后台、Vue H5、ECharts 大屏以及 UniApp 项目的日常需求分析和交付巡检。

## 1. 工具能做什么

- 静态扫描常见的路由、表格、弹窗、字典、接口类型、重复提示和 ECharts 问题。
- 在本地页面记录控制台错误、失败请求、重复请求、遮挡和图表尺寸异常。
- 用安全交互模式验证“筛选、选择、弹窗、提交、提示次数、列表刷新、请求参数”。
- 给每个问题生成稳定 ID，把已接受、误报、忽略和已解决的问题记入台账，避免重复检查。
- 把 HTML 报告和 `report.json` 提供给 Codex、Qoder 或开发人员继续定位和修复。

工具默认只读取业务项目。交互巡检会拦截业务写请求并返回模拟成功结果，不应把它当作真实接口验收的替代品。

## 2. 首次安装

环境要求：

- Node.js 18 或更高版本
- npm
- 可以正常启动待检查的前端项目

```bash
cd frontend-audit-agent
npm install
npx playwright install chromium
```

如果工具被复制到了其他目录，请把上面的路径替换为同事电脑上的实际目录。

## 3. 添加或修改项目

公共示例配置位于 `config/projects.json`。建议每位同事复制一份为 `config/projects.local.json`，再根据自己的目录结构修改 `root`。相对路径以 `frontend-audit-agent` 目录为基准；本地配置会被优先加载，并已加入 Git 忽略列表。

```bash
cp config/projects.json config/projects.local.json
```

```json
{
  "admin": {
    "name": "示例后台项目",
    "type": "jeecg-admin",
    "root": "../admin-project",
    "startCommand": "npm run dev -- --port 3102",
    "url": "http://127.0.0.1:3102/",
    "routes": ["/"],
    "viewports": [
      { "name": "desktop-1366", "width": 1366, "height": 768 }
    ]
  }
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| 配置键，例如 `admin` | 命令中使用的项目简称，必须唯一 |
| `name` | 报告中显示的项目名称 |
| `type` | 当前内置规则类型：`jeecg-admin`、`mobile-vue`、`data-screen` |
| `root` | 业务项目路径；推荐使用相对于本工具目录的路径 |
| `startCommand` | 启动项目的参考命令，当前不会由扫描命令自动执行 |
| `url` | 运行时巡检访问的本地地址 |
| `routes` | 需要巡检的页面路由 |
| `viewports` | 需要验证的屏幕尺寸 |
| `settleMs` | 可选，页面加载后等待稳定的毫秒数，大屏可适当增大 |

同一台电脑上的项目不能占用相同端口。修改命令行端口即可，不需要修改业务源码。

### UniApp 项目

当前工具还没有独立的 `uniapp` 静态规则类型。如果项目主要是移动端页面，可以暂时使用 `mobile-vue` 获得运行时的移动端尺寸、遮挡和键盘检查；UniApp 的条件编译、页面栈、分包、原生权限和发行配置仍需人工或编码 Agent 复核。

UniApp 只有一个外部接口地址，不通过 `baseURL` 区分本地、测试和生产。不能根据 URL 判断数据环境，必须同时确认登录账号、Token、租户、角色、请求头以及网关的实际转发目标。

## 4. 日常使用流程

### 第一步：静态扫描

```bash
npm run scan
```

只检查一个项目：

```bash
node src/cli.mjs scan admin
node src/cli.mjs scan mobile
node src/cli.mjs scan screen
```

### 第二步：启动被测项目

在业务项目目录运行其开发命令，并确认 `config/projects.json` 中的 `url` 能够正常访问。

Windows也可以在Audit目录执行一键脚本。脚本会复用已经运行的服务；未启动时根据项目配置中的`startCommand`打开独立PowerShell窗口，等待服务就绪后运行Audit，并在同级存在Test项目时继续联动测试：

```powershell
.\start-workspace.ps1 admin
```

只需要启动业务项目时执行：

```powershell
.\start-workspace.ps1 admin -SkipAudit
```

### 第三步：保存登录状态

```bash
npm run auth -- admin
```

浏览器打开后手动登录，确认已经进入业务页面，再回到终端按 Enter。状态只保存在本机 `.auth/`，不要发送给其他人，也不要提交到代码仓库。

### 第四步：页面巡检

```bash
npm run audit -- admin
```

需要观察浏览器执行过程时：

```bash
node src/cli.mjs audit admin --headed
```

### 第五步：操作型验证

```bash
npm run interact -- admin
```

在浏览器中手动完成目标流程，例如：

1. 输入筛选条件并查询。
2. 验证全选、单选和取消选择。
3. 打开新增、编辑、指派或确认弹窗。
4. 点击提交。
5. 观察 loading、按钮禁用、提示次数和列表刷新。

安全交互模式默认拦截 `POST`、`PUT`、`PATCH`、`DELETE` 业务请求。需要验证真实写入结果时，应退出安全交互模式，在明确的测试账号和测试数据下人工验证。

### 第六步：查看报告

报告目录：

```text
output/<时间>/index.html
output/<时间>/report.json
```

- `index.html`：给开发、测试和负责人查看。
- `report.json`：给 Codex、Qoder 或其他自动化工具读取。
- 截图及其他证据：和本次报告保存在同一个时间目录。

## 5. 问题台账

报告里的问题具有稳定 ID，例如 `F-12AB34CD56`。

```bash
# 团队确认当前写法合理
npm run decide -- F-12AB34CD56 accepted 已与后端确认

# 标记为误报
npm run decide -- F-12AB34CD56 false_positive 框架内部特殊实现

# 本期暂不处理
npm run decide -- F-12AB34CD56 ignored 本期不处理

# 重新纳入检查
npm run decide -- F-12AB34CD56 open 重新检查

# 查看台账
npm run history
```

决定记录在 `state/findings.json`。如果要让团队共享处理结论，应共享这个文件；如果理由中包含客户、账号或业务敏感信息，应先脱敏。

## 6. 环境与数据安全

### 后台和普通 H5

- 本地开发与测试使用同一个测试接口地址。
- 生产使用独立的生产接口地址。
- 默认只在本地或测试环境进行登录、联调和写操作。
- 未经明确确认，不对生产环境执行新增、修改、删除、指派或审批。

### UniApp

- 各构建环境使用同一个外部地址。
- 如果无法确认外部网关最终连接的环境，按生产环境处理。
- 默认允许静态分析和只读查询；写操作必须先确认账号、数据范围及影响。

严禁把账号密码、验证码、Token、Cookie、`.auth/` 内容或客户敏感数据放进需求文档、报告或 AI 提示词。

## 7. 配合 Codex/Qoder 处理新需求

仅仅把项目添加到 Codex 侧栏，不代表当前对话会自动加载所有项目。向编码 Agent 提供项目名称和绝对路径，并明确是“只读分析”还是“允许修改”。

### 单项目需求模板

```text
项目：../admin-project
需求：选择隐患场景后，对应选中专业管理员，不过滤管理员列表。
后端完成内容：getProfessionalPersonList 增加 checkScene 返回值。
涉及文件：src/views/safe/clapOk/modules/AssignModal.vue

请先：
1. 只读检查现有实现和接口类型；
2. 给出修改位置、数据匹配规则和异常情况；
3. 给出静态、接口和页面操作验收步骤；
4. 暂时不要修改代码。
```

### 多项目、多 Agent 模板

```text
需求：<粘贴完整需求>
后端完成内容：<接口、字段、类型和示例响应>

涉及项目：
- 后台：../admin-project
- H5：../mobile-project
- UniApp：../uniapp-project

请启用多 Agent：
- Agent 1 只读分析后台；
- Agent 2 只读分析 H5；
- Agent 3 只读分析 UniApp 和跨端接口契约；
- 主 Agent 汇总字段类型、字典、交互差异和验收清单。

本轮不要修改代码，也不要访问生产环境。
```

确认方案后再发送：

```text
方案已确认。允许修改上述项目。
每个 Agent 只负责一个项目，不要同时编辑同一个文件。
修改后运行相关测试和 frontend-audit-agent，最后汇总改动、验证证据和未覆盖风险。
```

同一个 Git 仓库需要并行修改时，优先为不同任务创建独立 worktree，避免 Agent 相互覆盖代码。

## 8. 推荐验收清单

- 页面能通过正常菜单进入，没有空白页。
- 筛选、全选、单选、翻页后的选择状态正确。
- 字典来自内部字典，值与 `xxx_dictText` 正确回显。
- 请求参数名称和字符串、数字、数组类型与后端契约一致。
- AI 没有擅自补固定 ID、状态、空串或 `0`。
- 所有可感知请求有 loading；提交期间按钮不可重复点击。
- 搜索输入做防抖，高频 resize/scroll 做节流。
- 框架提示和业务提示不重复。
- 提交成功后列表只按预期重新请求并显示最新数据。
- 弹窗 footer、确认按钮数量、宽度和语义颜色符合规范。
- ECharts 空数据不报错，数据变化后调用现有实例的 `setOption`。
- 大屏缩放后图表和文字布局正常，监听器和定时器已清理。
- UniApp 验证 App/H5/小程序差异、登录 Token 时序、页面生命周期和条件编译。

## 9. 使用边界

- 静态规则只能发现高概率风险，不能替代需求确认和真实接口契约。
- 拦截写请求的交互巡检只能验证前端行为，不能证明后端已经正确保存数据。
- 涉及生产数据、权限、支付、审批、删除或批量操作时，必须由负责人明确授权并准备回滚方案。
- Agent 给出的结果必须以代码、网络请求、页面行为和测试报告为证据，不能只接受文字结论。

## 10. 联动Frontend Test Agent

如果同级目录安装了`frontend-test-agent`，可以用一条命令先巡检再测试：

```bash
npm start -- admin
```

Audit会把当前项目配置和登录状态临时传给Test。Test存在时执行页面冒烟和已配置场景，不存在时自动跳过，不影响Audit单独使用。

两个项目建议保持同级：

```text
workspace/
├── frontend-audit-agent/
└── frontend-test-agent/
```

Audit负责发现风险和维护问题台账；Test负责执行可重复的验收场景并返回通过或失败。Test默认拦截业务写请求，真实写入必须显式使用`--allow-writes`。
