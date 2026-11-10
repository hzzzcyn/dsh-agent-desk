# 参与开发

欢迎提 Issue 和 PR。这个插件很小，规则也少，但有几条是踩过坑换来的，请先看一眼。

## 开工前

1. 读 [`README.md`](README.md) 了解它做什么、有哪些已知限制；
2. 读 [`docs/DESIGN.md`](docs/DESIGN.md)——宿主槽位、`agent/created`、`startActivation` 的契约都在里面，
   有「查证结论」章节，别凭印象改 API；
3. 读 [`CHANGELOG.md`](CHANGELOG.md) 了解当前版本改了什么。

## 环境

- Node `>=20`；
- DSH `>=0.2.1-rc.1 <0.3.0`（想实测请装到某个 profile，装完必须**重启 DSH 并新建会话**）；
- 无构建步骤、无运行时依赖——请不要为了一个小功能引入依赖。

## 常用命令

```bash
npm run check   # 校验 package.json 的 files/icon 声明 + node --check 两个入口
npm test        # node --test test/*.test.js
npm run test:no-isolation   # 受限沙箱里 node --test 子进程隔离会 EPERM 时用这个
npm pack --dry-run          # 看最终发布包里有哪 7 个文件
```

`prepack` 会自动跑 files 校验：声明的路径缺文件就非零退出，避免 `npm pack` 静默丢文件。

## 代码约定

### 宿主半 `lib/index.js`

- 纯 ESM、单一入口 `apply(ctx)`；
- 宿主服务一律 `ctx.get('...')` **可选读取**，用 `try/catch` 包住，失败只 `console.warn` 后降级——
  这个插件的底线是**绝不能让宿主起不来或会话组装失败**；
- 工具在 `agent/created` 时注册进 `agent.ctx`（不是全局工具表），两个工具各自注册、各自 `try/catch`；
- 原始工具定义要给完整 JSON Schema 对象根（`type: 'object'` + `properties` + `required`）；
- 改工具名或参数会改变模型看到的行为，请在 CHANGELOG 里写明。

### 浏览器半 `lib/client.js`

- 手写 `window.__ModuleLoader__` 包，React 由宿主提供，**不要 import 第三方库**；
- 页面与入口必须成对注册：`sidebar.panellist`（`id`）配 `main`（`key`），少一个就会出现「点了没反应」；
- 所有宿主调用包 `try/catch`，拿不到数据就退化为空列表或平铺视图；
- 能测的纯逻辑请放进 `exports.__internals`，让 `node --test` 能直接覆盖——浏览器侧不会读这个字段。

## 测试

- 测试不依赖宿主：用假 `ctx`、假 `agent.ctx.tools`、假 sessions 快照；
- 新增分支请补用例：错误路径（service 缺失、注册抛错、预设不存在、`stopReason` 异常）比正常路径更容易坏；
- 提交前至少跑一遍 `npm run check` 和 `npm test`。

## 文档

- 行为变了 → 更新 `README.md` 与 `CHANGELOG.md`（格式参考 Keep a Changelog）；
- 查到新的宿主契约 → 写进 `docs/DESIGN.md` 的「查证结论」，附证据来源（文件路径/版本）；
- 发布前把验证结论补到 `docs/STATUS.md`。

## 提交与 PR

- 提交信息用 `<type>(<scope>): <做了什么>`，例如 `feat(host): list_agent_presets`、
  `fix(client): per-row session jump + 7-day task window`、`docs: README 重构`；
- 一个 PR 做一件事，不夹带无关格式化；
- PR 描述里给**证据**：命令 + 关键输出（测试通过数量、打包文件清单、实测步骤），而不是「已测试」。

## 许可

提交即表示同意以 [MIT](LICENSE) 许可发布。
