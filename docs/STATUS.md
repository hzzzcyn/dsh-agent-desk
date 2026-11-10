# 进展

| 时间 | 事件 | 证据 |
|---|---|---|
| 2026-11-09 | 宿主半实现 `delegate_agent`：`agent/created` 按 agent 作用域注册，`startActivation` 前台委派，预设预检与降级 | `lib/index.js`，提交 `fd135e5` |
| 2026-11-09 | 查证 0.2.2-rc.1 客户端 bundle：会话归属字段是 `projectionValues.agentPreset`，无 `agentPresetName`；预设名走已有 `remote.agentPresets.list()` | `docs/DESIGN.md`「查证结论」 |
| 2026-11-09 | 浏览器半改为侧栏 `sidebar.panellist` 入口 + `main` keyed 页面，按自定义预设分组、展开任务、点击跳会话；移除浮层 | `lib/client.js` |
| 2026-11-09 | 最小测试 28 项全通过 | `node --test --experimental-test-isolation=none "test/*.test.js"` → `# pass 28` |
| 2026-11-09 | 两个入口语法检查通过 | `node --check lib/index.js && node --check lib/client.js` → OK |
| 2026-11-09 | 文档更新：入口/页面用法、槽位契约、查证结论、CHANGELOG | `README.md`、`docs/DESIGN.md`、`CHANGELOG.md` |
| 2026-11-09 | 修复包级图标缺失：新增 `icon.svg`（512 画布、整体内缩 0.72、显式描边 `#e6e8ef`、几何照抄侧栏 `AgentDeskIcon`），规格对齐 console 图标 | `icon.svg` 880 B，SHA256 `5A78281001F4…` |
| 2026-11-09 | 新增打包前 files 校验并接入 `check` / `prepack`；正例 exit 0，临时改名 `icon.svg` 时 exit 1 并列出缺失 | `scripts/check-package-files.mjs`、`package.json` |
| 2026-11-09 | 版本升 `0.2.3`；删除占位 `repository`；CHANGELOG 补「图标缺失 + files 校验」条目 | `package.json`、`CHANGELOG.md` |
| 2026-11-09 | 两处安装副本已同步：三份 `icon.svg` / `package.json` / check 脚本哈希一致；state `version=0.2.3`、`enabled=true`、`fiberPhase=active` | `/plugin-console/state`、`dist/state-before.json`（改动前 0.2.2） |
| 2026-11-09 | 按核心 `iconOf` 同序解析（realpath→stat→read）两份副本的 `icon.svg`：不再 ENOENT，返回 `data:image/svg+xml;base64,…`，880 B < 256 KiB | `node` 复现脚本输出（见会话记录） |
| 2026-11-09 | 文档重整：README 重构（目录、功能一览、错误表、兼容性、已知限制、故障排查、安全与隐私、English summary）；新增 `CONTRIBUTING.md` 与 `docs/PUBLISHING.md` | `README.md`、`CONTRIBUTING.md`、`docs/PUBLISHING.md` |
| 2026-11-09 | 发布前体检：`check` 通过；`node --test` **43 项全通过**（此前记为 28 项）；`npm pack --dry-run` 7 个文件 19.8 kB；tracked 文件无本机路径；npm 包名 `dsh-agent-desk` 未被占用（registry 404） | 命令输出见会话记录 |
| 2026-11-09 | `.gitignore` 补 `dist/`、`*.bak*`、`docs/ROLLBACK.txt`，避免本机快照与回退手册入库 | `.gitignore` |
| 2026-11-09 | 公开前去人格化：工具描述/示例/注释/测试夹具改用通用预设名与「用户」措辞；`LICENSE` 署名 `hzzzcyn`、`package.json` 补 `author` | `lib/index.js`、`test/*.js`、`README.md`、`LICENSE`、`package.json`；`node --test` → `# pass 43` |

## 待办

- 重启 DSH 后新建会话实测：左侧出现「智能体」入口，点开是主区页面；自定义预设分组正确；
  展开任务、点击任务回到会话；「返回对话」可用。
- 实测 `delegate_agent`：工具表出现、委派到 `dev` 成功、预设写错时报错含可用预设。
- 补截图：`docs/screenshot-sidebar-entry.png`、`docs/screenshot-agent-page.png`。
- 作者刷新插件页后确认「包元信息错误」消失、列表图标与同排插件尺寸一致（图标文件已就位，宿主按需读取）。
- 发布准备（见 `docs/PUBLISHING.md`）：建 GitHub 仓库并推送、加 `dsh-plugin` topic、补 `repository`/`homepage`/`bugs`、
  导出位图图标、补截图与 `screenshots.json`、仓库满 1 天后提收录 PR。
