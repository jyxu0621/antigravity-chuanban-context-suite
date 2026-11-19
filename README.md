# Antigravity 船板主题 + 上下文监控与汉化融合套件

**简体中文** · [English](README.en.md)

**仿Claude风格的antigravity反重力美化插件**：面向 Google Antigravity 2.x（已适配最新 `2.33.0+`），整合 **船板暖纸主题 `v5.5.1`**（含 `2.33.0` 单图标 `M1+M2` CDP 接力与 `1,860` 条词典）与 **精简版对话上下文监控 `v0.8.8`**（含模型配额圆环、多账号用量隔离、按模型统计、请求时间线、速度对比、外接屏防模糊像素对齐与 `v3.3.4` 桌面端汉化），通过纯 CDP 与本地回环 HTTP 守护进程注入，不改动官方 `app.asar`，重启、重载窗口或客户端更新后自动重新生效。

---

## 预览 (Preview)

**整窗 Claude 风格融合效果（已对会话标题、项目列表与对话记录打码脱敏）：**

![整窗效果预览](assets/preview-workbench-full.png)

**顶栏胶囊（船板主题 + 上下文进度 / 输出速度 / Token 累计 / CLI 入口）：**

![顶栏胶囊预览](assets/preview-titlebar.png)

| 精简版当前会话上下文面板（高度上限 `580px`，已移除 256K / ProxyNoTun / 配色抽屉） | 本机 Token 用量与 52 周热力图面板 |
| :---: | :---: |
| ![当前会话上下文面板](assets/preview-context-panel.png) | ![Token 用量统计面板](assets/preview-tokens-panel.png) |

---

## 上游项目与借鉴说明 (Upstream Projects)

本仓库整合并适配了社区中的两个开源项目：

1. **[Anarcadia/chuanban-antigravity-theme-patch](https://github.com/Anarcadia/chuanban-antigravity-theme-patch)**（船板主题补丁，已验证至 `v5.5.1`）
   - 借鉴与复用：沿用其主题样式、`Google Sans Flex` × 更纱黑体排版体系、Antigravity `2.33.0+` 单图标 `M1+M2` CDP Opt-in 启动接力（自动修补 `.lnk`/`.desktop` 快捷方式参数并在更新重启 `--updated` 冷启动时自动接力）、`plugin://swarm--` 子帧实时主题同步、宿主指纹门禁、WSL2 双轨读取、Windows ME SDDL 计划任务、可选深色预设与 `1,860` 条词典。
   - 本仓库适配（[`assets/theme-user-config.json`](assets/theme-user-config.json)、[`assets/theme-user-custom.js`](assets/theme-user-custom.js)）：关闭与 ContextViewer 重复的内置 `i18n` 和 `metrics`，保留 `"darkPreset": "onyx"`（可按需切为 `"claude-warm"`），并开启 `composerWaxSeal`、`deadlockHealer`、`coldBootHealer`、`zoomShortcuts`、`cdpAutoRelaunch`、`customCss` 与 `customJs`；弹窗（`#panel`、`#panel-quota`、`#panel-tokens`、`#valid-end-popover`、`#account-remove-modal` 等）展开时将 `#ag-context-meter` 及其层叠祖先提升至 `z-index: 2147483500`（关闭后还原，并配合 `wcvBrowser.setPortalOverlayOpen`），同时监听宿主父节点替换与捕获阶段点击事件，确保动态重挂后立即重新绑定。
2. **[elviscjn-cjn/antigravity-context-viewer](https://github.com/elviscjn-cjn/antigravity-context-viewer)**（锁定已验证基线提交 `838211fea3d305c72f3fe5f0c6ec340a644d481a` / `v0.8.8`）
   - 借鉴与复用：复用顶栏上下文用量显示、模型配额圆环（`#badge-quota` 与 `/quota` 面板）、多账号用量隔离、按模型 7/30 天堆叠统计与 WSL 用量汇总、请求时间线与速度评分（ELV-91）、自定义日期选择器与三语币种规则、外接显示器防文字发虚及像素网格定位（`ELV-84`/`ELV-86`）、品牌/语言切换卡片，以及 `v3.3.4` 中文汉化引擎。
   - 本仓库精简与调整（[`patches/context-viewer.patch`](patches/context-viewer.patch)、[`assets/antigravity-patch-guardian.mjs`](assets/antigravity-patch-guardian.mjs)）：
     - 将运行方式从修改 `app.asar` 改为纯 CDP 注入配合动态回环 HTTP 桥接守护（`process.noAsar = true`），加入 Antigravity 宿主指纹校验避免误注本地预览页，暴露带 Token 校验的回环 `GET /health` 供 `--ensure` 保活探针秒级检查，补齐信号/退出/高内存水位与全局未捕获异常落盘日志，冷启动 CDP 命令超时放宽至 `8s`/`10s` 并支持异常 WebSocket 自愈与串行注入，对齐 `v0.8.8` 版本与路由能力上报（`/quota`、`/scan`、`/session-timeline`、`/accounts-overview`、`/accounts-action`、`/modules-status`、`/toggle-module`、`/open-external` 等）；若检测到旧版 ASAR 补丁标记，仍会尝试从干净 `*-base.asar` 备份恢复官方文件。
     - 合并船板 `v5.5.1` 的 `1,860` 条 `core/i18n.json` 词条作为 `zh-CN.json` 后备补全，统一由单套 `v3.3.4` 汉化引擎执行，不启动第二套冲突观察器。
     - 移除涉及二进制补丁或冗余的抽屉与卡片（`#tab-ctx-models`、`#pane-ctx-models`、`#ctx-compact-card`、提示词增强卡片、`ProxyNoTun`、`btn-toggle-colors` / 面板调色板）以及启动更新弹窗，并将 `#panel` 与 `#panel-quota` 最大高度统一限制在 `580px`。
     - 结合上游 `6ms` `rAF` 汉化分片与 `observedTitlebar` 快速判定，进一步强化大历史防卡顿与低内存护栏：进入任意会话（含冷启动首次点开旧对话）时 `requestPoll` 错峰 `450ms`、`/scan` 错峰 `1500ms` 并在面板关闭时放宽至 `60s`（后台标签 `120s`），守护端对 `/scan` 实行 `45s` 有界合并缓存并剥离图片 Base64（`inlineData`）；`/record-calls` 采用 `12s` 批量节流与后台 Worker `recordModelCallsAsync` 异步入账且不再立刻清空历史缓存；`/token-history` 采用守护端 `180s` 缓存（变更 `30s` 冷却）+ 渲染端面板关闭 `5min` 轮询，让后台 Worker 空闲 `45s` 后自动回收内存；`translateSingleUnit` 查完 `exactDict` 后继续跳过超过 `500` 字符文本的正则扫描。

---

## 一句话发给 Agent (One-Sentence Prompt for AI Agents)

在新电脑上把下面任意一句话发给 Antigravity 或其他 AI Agent，即可直接拉取并部署本套件：

**中文指令：**

> 请把 `https://github.com/jyxu0621/antigravity-chuanban-context-suite` 克隆到全局 Skills 目录（`~/.gemini/config/skills/antigravity-chuanban-context-suite`），阅读里面的 `SKILL.md` 和 `README.md`，运行 `node scripts/setup.mjs` 和 `node scripts/verify.mjs` 完成船板主题与精简防卡顿版 ContextViewer + v3.3.4 汉化的部署和验证（保持纯 CDP 模式，不要修改 `app.asar`）。

**English prompt:**

> Clone `https://github.com/jyxu0621/antigravity-chuanban-context-suite` into `~/.gemini/config/skills/antigravity-chuanban-context-suite`, read `SKILL.md` and `README.en.md`, and run `node scripts/setup.mjs` followed by `node scripts/verify.mjs` to install and verify the suite in pure CDP mode without modifying `app.asar`.

> [!IMPORTANT] **Agent 执行注意（详情见 [`SKILL.md`](SKILL.md)）**
> - 不要修改官方 `app.asar`。Windows 下 `setup.mjs` 保留船板原生 ME SDDL 计划任务 `AntigravityThemeDaemon`，并以同等 `schtasks /Create /XML`（`ME` SDDL、`Parallel`、`StopOnIdleEnd=false`、`LogonTrigger` + `PT1M` `--ensure` 自愈巡检）注册 `AntigravityPatchGuardian`，使双守护脱离 Agent 终端的 Win32 Job Object 并在异常退出后 1 分钟内自动拉起；macOS 和 Linux 分别注册 `LaunchAgent`（`KeepAlive`）与 `systemd --user`（`Restart=always`）。
> - 切勿在 Antigravity 会话内强杀宿主机进程。如果安装前客户端未启用远程调试端口，请在 `setup.mjs` 跑完后提示用户彻底退出并用更新后的快捷方式重开一次 Antigravity，再运行 `node scripts/verify.mjs`。
> - 船板字体（Anthropic + Sarasa）需从 [Google Drive](https://drive.google.com/drive/folders/1NX92SgVUqtSjWg6bt6sIJXy-cn7J_boC) 另行下载，并在安装时通过 `--fonts-from <字体目录>` 传入。

---

## 功能与精简明细 (Features & Customizations)

- 主题与监控职责隔离：船板 `v5.5.1` 负责主题配色、`Google Sans Flex` 字体、Antigravity `2.33.0+` CDP 启动接力、Swarm/PDF 适配与冷启动/死锁自愈，ContextViewer `v0.8.8` 负责上下文用量、模型配额圆环、多账号隔离、按模型统计与请求时间线、输出速度对比、`v3.3.4` 汉化（合并船板 `1,860` 条后备词库）与 Token 统计，关闭重叠模块避免互相覆盖。
- 弹窗置顶防遮挡：打开右上角上下文面板或配额面板时自动抬高宿主与祖先节点 `z-index` 至 `2147483500`，关闭后还原；支持动态重挂立即重绑，不被右侧浏览器或预览窗格挡住。
- 精简面板高度：去掉 Models/256K、提示词增强、ProxyNoTun、调色板抽屉与更新弹窗，`#panel` 与 `#panel-quota` 统一限制 `max-height: 580px`，适配小屏与笔记本视口。
- 对话切换减抖动与低内存护栏：结合上游 `6ms` rAF 分片与 `observedTitlebar` 快速判定，对首进与切换会话实行 `450ms`/`1500ms` 错峰、`/scan` 合并缓存与剥离图片 Base64、`12s` 批量异步入账、`180s`/`5min` `/token-history` 合并缓存让 Worker 自动释放内存，以及长文本跳过正则扫描，大幅压低打开巨型旧对话时的卡顿与后台内存占用。
- 重启、升级与守护自愈：依赖 `Page.addScriptToEvaluateOnNewDocument`、`8s`/`10s` 冷启动 CDP 容错、页面加载监听以及系统级开机自启 + 1 分钟 `--ensure` 守护自愈，重开 Antigravity、重载窗口或版本更新后均能稳定重新挂载。

---

## 快速开始 (Quick Start)

前置条件：**Node.js `>= 22.0.0`**、**Git**。

### Windows (PowerShell)

```powershell
git clone https://github.com/jyxu0621/antigravity-chuanban-context-suite.git "$env:USERPROFILE\.gemini\config\skills\antigravity-chuanban-context-suite"
cd "$env:USERPROFILE\.gemini\config\skills\antigravity-chuanban-context-suite"

# 预览默认路径解析（不改动任何文件）
node scripts/setup.mjs --dry-run

# 一键安装并检查实时状态（如需安装字体可附加 --fonts-from "C:\path\to\fonts"）
node scripts/setup.mjs
```

### macOS / Linux

```bash
git clone https://github.com/jyxu0621/antigravity-chuanban-context-suite.git ~/.gemini/config/skills/antigravity-chuanban-context-suite
cd ~/.gemini/config/skills/antigravity-chuanban-context-suite

node scripts/setup.mjs --dry-run
node scripts/setup.mjs
```

### 可选参数

| 参数 | 说明 |
| --- | --- |
| `--context-viewer-dir <目录>` | 自定义 `antigravity-context-viewer` 克隆路径 |
| `--theme-repo-dir <目录>` | 自定义 `chuanban-antigravity-theme-patch` 克隆路径（默认 `~/.gemini/antigravity/chuanban-theme-repo`） |
| `--fonts-from <目录>` | 指定下载好的船板字体文件夹，传递给 `install-fonts --from` |
| `--latest` | 跳过锁定基线 `838211f`，尝试直接基于上游 `HEAD` 打补丁 |
| `--skip-tests` | 跳过打补丁后的 ContextViewer 单元测试 |
| `--skip-verify` | 安装结束时不自动执行 `verify.mjs` |

---

## 验证与回滚 (Verification & Rollback)

```bash
# 完整检查（本地配置 + 官方 app.asar 洁净度 + 守护进程 PID + 实时 CDP DOM/桥接/配额/z-index/高度）
node scripts/verify.mjs

# 仅做静态文件与守护进程检查（Antigravity 未启动时）
node scripts/verify.mjs --skip-cdp
```

如需在已打补丁的 `antigravity-context-viewer` 目录单独复现核心单元测试（225 项通过）：

```bash
node --test meter-core.test.js meter-renderer.test.js meter-integration.test.js meter-v083-fixes.test.js meter-hotload.test.js meter-elv91-speed.test.js meter-v089-usage.test.js
```

> 被覆盖的用户配置和旧脚本会自动备份至 `<STATE_DIR>/backups/skill-setup/`。若需卸载，停止双守护进程并卸载船板后重启或重载 Antigravity 即可恢复原版界面。

---

## 仓库结构 (Repository Structure)

```text
antigravity-chuanban-context-suite/
├── .gitattributes                       # 保持 .patch 原始字节与 LF 行尾
├── .gitignore
├── SKILL.md                             # Antigravity Skill 定义与部署规范
├── README.md                            # 中文文档（本文件）
├── README.en.md                         # English documentation
├── assets/
│   ├── antigravity-patch-guardian.mjs   # 便携版纯 CDP + 动态回环 HTTP 桥接守护脚本
│   ├── preview-workbench-full.png       # 预览：整窗 Claude 风格主题 + 监控弹窗效果（已打码脱敏）
│   ├── preview-titlebar.png             # 预览：顶栏胶囊（船板主题 + ContextMeter + CLI）
│   ├── preview-context-panel.png        # 预览：精简版当前会话上下文面板
│   ├── preview-tokens-panel.png         # 预览：Token 统计与热力图面板
│   ├── theme-user-config.json           # 船板适配配置（关闭重叠 i18n 与 metrics）
│   └── theme-user-custom.js             # 弹窗高优先级 z-index 与原生视图层级适配脚本
├── patches/
│   └── context-viewer.patch             # 基于 upstream@838211f (v0.8.8) 的精简与防卡顿补丁
└── scripts/
    ├── setup.mjs                        # 跨平台幂等安装与系统自启注册脚本
    └── verify.mjs                       # 静态 + 进程 + 实时 CDP 联合验收脚本
```
