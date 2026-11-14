# Antigravity 船板主题 + 上下文监控与汉化融合套件

**简体中文** · [English](README.en.md)

在 **Google Antigravity 2.x** 中一键集成 **船板主题美化** 与 **精简防卡顿版对话上下文监控 + v3.3.4 桌面端汉化**，全程采用**免改 `app.asar` 纯 CDP 常驻守护模式**，客户端重启、重载或版本更新后自动恢复生效。

---

## 🙏 上游项目与致谢 (Upstream Credits)

本项目本身不重复造轮子，而是将社区中两个优秀开源项目整合适配、去除功能冲突并加上工程化守护脚本后打包成 Antigravity Skill：

1. **[Anarcadia/chuanban-antigravity-theme-patch](https://github.com/Anarcadia/chuanban-antigravity-theme-patch)**（船板主题补丁）
   - **借鉴与复用内容**：直接调用其安装器配置调试启动参数、主题配色/排版注入与后台守护框架。
   - **本套件适配改造**（[`assets/theme-user-config.json`](assets/theme-user-config.json)、[`assets/theme-user-custom.js`](assets/theme-user-custom.js)）：保留主题与顶栏右上角按钮，关闭与 ContextViewer 冲突的内置 `i18n` 与 `metrics`；为 `#ag-context-meter` 展开态注入高优先级 `z-index: 2147483500`（收起恢复 `20`），避免弹窗被右侧网页或辅助面板遮挡，并支持 `Esc` / 点击外部关闭。
2. **[elviscjn-cjn/antigravity-context-viewer](https://github.com/elviscjn-cjn/antigravity-context-viewer)**（Antigravity 对话上下文查看器与 Token 看板，锁定已验证基线提交 `a204823f597e1aee482f35574798ecbec61874c9`）
   - **借鉴与复用内容**：复用其顶栏实时上下文占用胶囊、生成速度监控、Token 历史热力图/明细面板，以及 `v3.3.4` 汉化引擎。
   - **本套件精简与优化**（[`patches/context-viewer.patch`](patches/context-viewer.patch)、[`assets/antigravity-patch-guardian.mjs`](assets/antigravity-patch-guardian.mjs)）：
     - 将运行机制从改写 `app.asar` 改造为参考船板思路的 **纯 CDP 注入 + 动态多 Origin 回环 HTTP 桥接守护**（`process.noAsar = true`，不改写官方 `app.asar`，检测到历史 ASAR 补丁痕迹时可从干净 `*-base.asar` 备份自动还原）。
     - 移除 `256K 实验性上下文解锁`、`ProxyNoTun 代理直连`、`指标配色自定义抽屉` 及面板内检查更新弹窗，并将主面板高度上限收紧至 `580px`（`#panel` `max-height: 580px`）。
     - 加入**保守性防卡顿优化**：`hostDomObserver` 通过 `observedTitlebar` 快速路径避免无谓 DOM 扫描；切会话路由时对重型 `/scan` 请求错峰 `900ms` 调度并做 `5s` `/token-history` 请求去重；汉化引擎 `flushPendingNodes` 采用 `8ms` `requestAnimationFrame` 时间切片，`translateSingleUnit` 在精确词典查询后跳过超过 `500` 字符长文本的全量正则扫描。

---

## 🤖 一句话发给 AI Agent (One-Sentence Prompt for AI Agents)

只需将下面任意一句话直接发给另一台电脑上的 Antigravity / AI Agent，即可让它全自动拉取并部署本套件：

**中文一句指令（推荐）：**

> 请把 `https://github.com/jyxu0621/antigravity-chuanban-context-suite` 克隆到我的全局 Skills 目录（`~/.gemini/config/skills/antigravity-chuanban-context-suite`），读取里面的 `SKILL.md` 和 `README.md`，然后运行 `node scripts/setup.mjs` 和 `node scripts/verify.mjs` 完成安装与校验（注意保留纯 CDP 模式，不要修改 `app.asar`）。

**English one-sentence prompt:**

> Clone `https://github.com/jyxu0621/antigravity-chuanban-context-suite` into `~/.gemini/config/skills/antigravity-chuanban-context-suite`, read `SKILL.md` and `README.en.md`, and run `node scripts/setup.mjs` followed by `node scripts/verify.mjs` to install and verify the suite in pure CDP mode without modifying `app.asar`.

> [!IMPORTANT] **AI Agent 执行注意事项（详见 [`SKILL.md`](SKILL.md)）**：
> - **零破坏与纯 CDP 守护**：不要改写官方 `app.asar`。Windows 下 `setup.mjs` 会通过 `Register-ScheduledTask` 注册用户级开机/登录自启任务 `AntigravityPatchGuardian`，使守护进程脱离 Agent 终端的 Win32 Job Object 长期存活；macOS 与 Linux 则分别写入 LaunchAgent 与 `systemd --user`。
> - **切勿强杀运行中的宿主机 Antigravity**：如果在 Antigravity 内部会话中执行安装，首次运行前若客户端未开启远程调试端口，请在 `setup.mjs` 完成后提示用户手动彻底退出并用更新后的快捷方式重开一次 Antigravity，再运行 `node scripts/verify.mjs` 完成实时 CDP 复验。
> - **可选字体包**：船板字体（Anthropic + Sarasa）需从 [Google Drive](https://drive.google.com/drive/folders/1NX92SgVUqtSjWg6bt6sIJXy-cn7J_boC) 另行下载并通过 `--fonts-from <字体目录>` 传入。

---

## ✨ 功能与精简明细 (Features & Customizations)

- **双项目无缝共存**：船板提供全局字体、色彩与顶栏样式，ContextViewer 提供实时上下文进度、输出速度、`v3.3.4` 汉化与 Token 历史统计，二者职责隔离不互相覆盖 DOM。
- **不被遮挡的顶栏弹窗**：点击右上角上下文面板时自动将宿主 `#ag-context-meter` 提升至 `z-index: 2147483500`，收起回落到 `20`，右侧打开网页/预览面板时依然清晰前置。
- **精简紧凑视口**：移除了 256K、ProxyNoTun、调色板抽屉与更新提示弹窗，主浮层固定最大高度 `580px`，短屏/笔记本屏幕展开不溢出。
- **保守防卡顿**：切换对话、Webview 局部重载时维持低抖动渲染与延迟错峰采样。
- **重装 / 更新免二次折腾**：依托 `Page.addScriptToEvaluateOnNewDocument`、导航事件去抖重载与系统级自启守护，Antigravity 重启或小版本升级后自动重挂。

---

## 🚀 快速开始 (Quick Start)

前置条件：**Node.js `>= 22.0.0`**、**Git**。

### Windows (PowerShell)

```powershell
git clone https://github.com/jyxu0621/antigravity-chuanban-context-suite.git "$env:USERPROFILE\.gemini\config\skills\antigravity-chuanban-context-suite"
cd "$env:USERPROFILE\.gemini\config\skills\antigravity-chuanban-context-suite"

# 预览即将解析的路径（不写入任何文件）
node scripts/setup.mjs --dry-run

# 一键安装并启动验证（可选追加 --fonts-from "C:\path\to\fonts"）
node scripts/setup.mjs
```

### macOS / Linux

```bash
git clone https://github.com/jyxu0621/antigravity-chuanban-context-suite.git ~/.gemini/config/skills/antigravity-chuanban-context-suite
cd ~/.gemini/config/skills/antigravity-chuanban-context-suite

node scripts/setup.mjs --dry-run
node scripts/setup.mjs
```

### 常用可选参数

| 参数 | 说明 |
| --- | --- |
| `--context-viewer-dir <目录>` | 自定义 `antigravity-context-viewer` 克隆路径 |
| `--theme-repo-dir <目录>` | 自定义 `chuanban-antigravity-theme-patch` 克隆路径（默认 `~/.gemini/antigravity/chuanban-theme-repo`） |
| `--fonts-from <目录>` | 传入下载好的船板字体文件夹，自动调用 `install-fonts --from` |
| `--latest` | 跳过锁定基线 `a204823`，直接基于上游 `HEAD` 测试应用补丁 |
| `--skip-tests` | 跳过打补丁后的 ContextViewer 单元测试 |
| `--skip-verify` | 安装结束后跳过自动运行 `verify.mjs` |

---

## 🧪 验证与测试 (Verification & Testing)

```bash
# 完整联检（静态配置 + 官方 app.asar 洁净度 + 守护进程 PID + 实时 CDP DOM/桥接/z-index/高度）
node scripts/verify.mjs

# Antigravity 未打开时仅做静态与守护进程检查
node scripts/verify.mjs --skip-cdp
```

若需单独在已打补丁的 `antigravity-context-viewer` 目录跑原版单元测试：

```bash
node --test meter-core.test.js meter-renderer.test.js meter-integration.test.js
```

> 所有修改前涉及覆盖的旧文件会自动备份到 `<STATE_DIR>/backups/skill-setup/`；由于全程不改动 `app.asar`，停止双守护进程并在客户端触发重载即可无损还原官方原始界面。

---

## 📁 仓库结构 (Repository Structure)

```text
antigravity-chuanban-context-suite/
├── .gitattributes                       # 强制 .patch 保持原始字节与 LF 行尾
├── .gitignore
├── SKILL.md                             # Antigravity Skill 标准定义与执行规范
├── README.md                            # 中文文档（本文件）
├── README.en.md                         # English documentation
├── assets/
│   ├── antigravity-patch-guardian.mjs   # 便携化纯 CDP + 动态回环 HTTP 桥接守护脚本
│   ├── theme-user-config.json           # 船板适配配置（关闭冲突 i18n/metrics）
│   └── theme-user-custom.js             # 船板 popup z-index 置顶与 Esc 关闭脚本
├── patches/
│   └── context-viewer.patch             # 基于 upstream@a204823 的精简 + 防卡顿干净补丁
└── scripts/
    ├── setup.mjs                        # 跨平台幂等安装与自启注册脚本
    └── verify.mjs                       # 静态 + 进程 + 实时 CDP 联合验收脚本
```
