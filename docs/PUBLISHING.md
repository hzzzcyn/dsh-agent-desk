# 发布到社区：还差什么

> 这份文档只服务于「把它公开出去」这件事。目标有两个，可以只做第一个：
> **A. 建一个公开 GitHub 仓库**（别人能 `dsh plugin add github:<owner>/dsh-agent-desk` 装上）；
> **B. 收录进 DSH 社区插件列表**（dsh-market / plugin-console 商店里能搜到、能一键装）。

## 一、社区是怎么发现插件的（先搞清机制）

DSH 没有官方 npm 式注册中心。事实链路是：

```
awesome-dsh-plugin/awesome-dsh-plugin   ← 收录仓库，一个插件一个 YAML（data/plugins/<owner>__<repo>.yml）
        │  CI 每天生成
        ▼
awesome-dsh-plugin.com/plugins.json     ← 市场实时拉取的索引
        │
        ▼
dshmarket / plugin-console              ← 用户在商店里搜到 → 一键安装（走 npm 或 GitHub 源码）
```

所以要「上社区」，不是发个 npm 包就行，而是**给收录仓库提一个新增 YAML 文件的 PR**。
官方规则：[contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)。

### 收录的硬门槛（来自官方规则）

| 要求 | 本插件现状 |
|---|---|
| 仓库 `package.json` 声明 `dsh.bundle`（只声明 `dsh.client` 会被拒） | ✅ 已有 `dsh.bundle.patch` + `dsh.client` |
| 仓库根目录有 `cordis.patch.yml` | ✅ 已有 |
| 仓库有真实可用代码，非占位/纯 README | ✅ 宿主半 + 浏览器半 + 43 项测试 |
| GitHub 仓库**创建满 1 天**（CI 自动检查） | ⬜ 还没有远程仓库，建仓那天开始计时 |
| 仓库加 `dsh-plugin` topic | ⬜ 建仓后加 |
| 描述必须与代码一致、不带营销词 | ⬜ 条目文案待定稿（草稿见下） |
| 一个 PR 最多 3 条；不改生成的 README | — 本插件一条，天然满足 |
| 同类已有条目时「谁更好谁上」 | ⚠️ 见第四节「同名与同类风险」 |

### 可选项（不影响收录，但影响体验）

| 项 | 说明 |
|---|---|
| npm 发布 | 商店能显示下载量；预构建安装可跳过 `allowBuilds` 构建授权。包名 `dsh-agent-desk` 目前**未被占用**（registry 返回 404，2026-11-09 核实） |
| `screenshots.json` | 放在 `package.json` 旁，列 1–8 张仓库内图片；市场详情页按此展示 |
| `icon:` 字段 | 市场卡片图标只认 **GitHub 托管的 png/jpg/webp**，SVG 会被拒——现在只有 `icon.svg`，需要另导一张 PNG |
| GitHub Release tarball | 不发 npm 时的替代：`tarball:` 指向 `releases/latest/download/<名字>.tgz`，资产名**不要带版本号** |

## 二、现状盘点（2026-11-10 更新：已发布）

| 项 | 状态 |
|---|---|
| 远程仓库 | ✅ [`hzzzcyn/dsh-agent-desk`](https://github.com/hzzzcyn/dsh-agent-desk)，public，默认分支 `main` |
| 已发布内容 | 16 个文本文件，`main` 上单一根提交 `9825c41`（历史压缩，旧提交里的内部称呼不入公开历史） |
| topic | ✅ `dsh-plugin`、`dsh`、`plugin`、`agents` |
| 版本 / 测试 | 发布版 `0.2.3`；`npm run check` 通过，`node --test` 43 项全通过 |
| 打包 | `npm pack` 7 个文件、22.9 kB（`lib` / `cordis.patch.yml` / `icon.svg` / `README.md` / `LICENSE` / `package.json`） |
| 依赖 | 零运行时依赖、无构建步骤 |
| `repository` 元数据 | ✅ `package.json` 已指向远程仓库（npm 包与列表条目靠它关联） |
| 包名可用性 | `dsh-agent-desk` 可用（npm 尚未发布） |
| 图标 | ✅ `icon.svg` + `icon.png`（512×512，GitHub 托管，市场卡片可直接引用） |
| 截图 | 无（可选，1–8 张 PNG，配合 `screenshots.json`） |
| 收录条目 | ✅ 定稿草稿在 [`docs/awesome-entry.yml`](awesome-entry.yml)，分类 `ui` |
| 收录门槛 | 仓库创建于 `2026-11-09T10:46:57Z`，满 24 小时（= 2026-11-10 18:47 +08）后才可提 PR（CI 自动卡） |
| fork | ✅ `hzzzcyn/awesome-dsh-plugin` 已 fork，PR 分支待建 |
| 未入库的杂物 | 已全部 gitignore：`dist/`、`*.bak-*`、`docs/ROLLBACK.txt`、`*.log`、`*.tgz` |
| 真实委派实测 | ⬜ 待重启 DSH 后新建会话验证 |

## 三、已定的选择

| 事项 | 结论 |
|---|---|
| 仓库归属 | 个人账号 `hzzzcyn`，仓库名保持 `dsh-agent-desk`（不改名） |
| 署名 | LICENSE 与 `package.json` 的 `author` 均为 `hzzzcyn` |
| 公开范围 | public，历史压缩为单一根提交，旧提交里的内部称呼不进公开历史 |
| 发布方式 | 走 GitHub API（本机 `gh` CLI 未装，且 `github.com:443` 被网络拦截，`api.github.com` 可用） |
| npm | **暂缓**：本机 npm 走公司内网镜像，发布要显式 `--registry https://registry.npmjs.org --access public`，且需 npm token |
| 截图 | 未做（可选）；需要真实运行的 DSH 界面截图，无法凭空生成 |

## 三之二、还需要出手的事

1. **收录 PR 的最终提交**：CI 卡「仓库满 1 天」，到点后可以直接把 fork 分支和 PR 建好；
   若 token 没有对上游仓库的 PR 权限，就由你点一次 GitHub 的「Create pull request」。
2. **截图**（可选）：侧栏入口、智能体页、一次委派的结果，2–3 张 PNG 即可。

## 四、同名与同类风险（值得先想清楚）

查了一圈同类：

- [`Renakoni/dsh-desk`](https://github.com/Renakoni/dsh-desk)：桌面端状态监听 + 桌宠，名字只差一个 `agent-`；
- 市场上另有名为 **Agent Deck** 的插件（[dshpluginhub](https://dshpluginhub.ai/zh/plugins/dsh-agent-deck)）；
- [`kevin-luo/dsh-org-panel`](https://github.com/kevin-luo/dsh-org-panel)：多智能体「指挥台」面板；
- [`NanmiCoder/dsh-agent-teams`](https://dshbase.com/plugins/dsh-agent-teams/)、[`991206772-debug/dsh-agentrix`](https://github.com/991206772-debug/dsh-agentrix)：多智能体协作/规划。

评审规则是「同一件事谁更好谁上」，所以条目描述里要写清**差异**：本插件是**按预设看会话 + 受确认约束的跨预设委派**，
不做编排、不做角色分工、不引入自己的调度器。名字如果撞得太像，可以考虑 `dsh-agent-hub` 之类——
改名要同步 `package.json` 的 `name`、`cordis.patch.yml` 的 `id`/`name`、`lib` 里的 `name` 常量与日志前缀，
属于小改但必须一次改全，改完重跑测试与安装。

## 五、发布步骤（A → B）

### A1. 清理不该入库的东西

已写进 `.gitignore`：`dist/`、`*.bak`、`*.bak-*`、`docs/ROLLBACK.txt`、`*.log`、`*.tgz`。
`docs/ROLLBACK.txt` 是本机回退手册（含本机用户目录路径），**保留在本地但不入库**；
要不要从磁盘删掉，等你确认。

### A2. 建仓并推送

```bash
cd "D:\DeepSeek Harness\projects\dsh-agent-desk"
git add -A
git commit -m "chore: prepare public release docs"
git remote add origin https://github.com/<owner>/dsh-agent-desk.git
git push -u origin master
```

用 `gh` 的话可以一条搞定（并顺手加 topic）：

```bash
gh repo create <owner>/dsh-agent-desk --public --source . --remote origin --push
gh repo edit <owner>/dsh-agent-desk --add-topic dsh-plugin
```

### A3. 补元数据（我可以代改，等 URL 定下来）

`package.json` 增加：

```json
"repository": { "type": "git", "url": "git+https://github.com/<owner>/dsh-agent-desk.git" },
"homepage": "https://github.com/<owner>/dsh-agent-desk#readme",
"bugs": { "url": "https://github.com/<owner>/dsh-agent-desk/issues" }
```

> `repository` 必须指回被收录的仓库，否则 npm 包与列表条目关联不上。
> 早前的占位 `https://github.com/OWNER/dsh-agent-desk` 已经删掉，别再加回来。

### A4. 素材

- 市场图标：从 `icon.svg` 导一张 512 或 256 的 PNG（`docs/assets/icon-512.png`），条目里用 `icon:` 指向
  `raw.githubusercontent.com/.../icon-512.png`；
- 截图：`docs/screenshot-sidebar-entry.png`、`docs/screenshot-agent-page.png`，再在根目录加 `screenshots.json`。

### B. 提收录 PR

前置：仓库已 fork 到 `hzzzcyn/awesome-dsh-plugin`；条目内容以 [`docs/awesome-entry.yml`](awesome-entry.yml) 为准
（改描述只改这个文件，PR 前再原样复制到 fork 的 `data/plugins/hzzzcyn__dsh-agent-desk.yml`）。

1. 在 fork 上基于上游 `main` 建分支 `add-hzzzcyn-dsh-agent-desk`，只加上面那一个文件；
2. 开 PR 到 `awesome-dsh-plugin/awesome-dsh-plugin:main`，正文写清：
   - 插件做什么、怎么装（`dsh plugin add github:hzzzcyn/dsh-agent-desk`）；
   - 验证证据：`node --test` 43 项通过、`npm run check` / `npm pack` 通过、装机后实测步骤；
   - 与近名插件的差异（见第四节），避免评审误判重复。
3. CI 会查条目数、`dsh.bundle`、仓库年龄、`awesome-lint`；失败会指到具体行，同分支推修复即可。

> 分类填 `ui`：主体是侧栏页面，另加两个工具；同类里 `dsh-agent-status` 归 `ui`，
> 任务板类 `dsh-agent-board` 归 `workflow`。分类选偏了维护者会直接改，不会因此打回。

## 六、发布前自检清单

- [ ] `npm run check` 通过（files 声明齐全）
- [ ] `npm test` 43 项通过（或用 `test:no-isolation`）
- [ ] `npm pack --dry-run` 里没有本机文件、没有 `docs/ROLLBACK.txt`
- [ ] 仓库里没有本机用户目录之类的绝对路径（已核查：tracked 文件 0 处）
- [ ] 仓库公开、加了 `dsh-plugin` topic、创建满 1 天
- [ ] `package.json` 的 `repository` 指回该仓库
- [ ] 真实装一次 `dsh plugin add`，重启后新建会话能看到「智能体」页与两个工具
- [ ] 条目 YAML 的每条描述都能在代码里找到对应实现
