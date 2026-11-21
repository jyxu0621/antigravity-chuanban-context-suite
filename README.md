# Antigravity 船板主题 + 极限精简上下文监控融合套件

**简体中文** · [English](README.en.md)

**仿Claude风格的antigravity反重力美化插件**：面向 Google Antigravity 2.x（已实测适配最新 `2.34.0+`），将 **船板暖纸主题 `v5.5.3`**（`1,940` 条单一汉化引擎、底部 DSH 风格实时胶囊、原生设置页 Token Analytics、高刷屏 GPU 动画减负 CSS 与 `2.33/2.34` 单图标 `M1+M2` CDP 接力）与 **极限精简零卡顿版 ContextViewer `v0.8.9`**（顶栏仅保留上下文进度环 + 输出速度纯 SVG 沙漏胶囊，彻底根除后台卡顿与内存飙升）通过纯 CDP + 超轻本地回环 HTTP 守护进程融合运行，**零修改官方 `app.asar`**，重启、重载窗口或客户端升级后自动重新生效。

---

## 实测性能提升（Antigravity `2.34.0` 14/14 闭环压测）

| 观测维度 | 优化前 | 优化后（本版本实测） | 改善幅度 |
| --- | --- | --- | --- |
| 页面活跃 GPU 动画数（6s 窗口） | `131` | **`0`** | **-100%** |
| 样式重算 `RecalcStyle` 耗时（6s 窗口） | `221–371 ms` | **`14 ms`** | **-94% ~ -96%** |
| `AG-GPU` 进程 CPU 占用 | `32.6%` | **`2.3%`** | **-92.9%** |
| `PatchGuardian` 守护常驻内存 (RSS) | `860 MB`（冷启动 +233 MB 尖峰） | **`20–31 MB`**（连续运行近 3 小时实测 `20 MB`） | **-96% ~ -97%** |
| `PatchGuardian` 后台 CPU 占用 | `51.6%` | **`0.0–0.6%`** | **-99%** |
| 渲染帧率稳定性（高刷屏） | 滚动/切换对话偶发掉帧 | **`125 FPS`**（`max=10.1 ms`，`jank33=0`），闭面板 JS 热点 `0/4,982` | **丝滑零掉帧** |

---

## 预览 (Preview)

> 注：以下预览图展示 Claude 风格整体工作台与上下文面板视觉；在当前 `v5.5.3 + v0.8.9` 极限精简版中，顶栏已进一步收口为仅保留「上下文圆环 + 速度胶囊」，累计 Token 统计已整合至船板原生「设置 → Token Analytics」，底部输入框新增 DSH 风格实时指标胶囊（`入 <used>/<limit> (<pct>%) · 出 <out> · <tps> tok/s · 首字 <ttft>`）。

**整窗 Claude 风格融合效果（已对会话标题、项目列表与对话记录打码脱敏）：**

![整窗效果预览](assets/preview-workbench-full.png)

| 精简版当前会话上下文面板（高度上限 `580px`，已移除 Models/256K/Enhance/ProxyNoTun/配色抽屉） | 历史版本顶栏视觉参考 |
| :---: | :---: |
| ![当前会话上下文面板](assets/preview-context-panel.png) | ![顶栏胶囊预览](assets/preview-titlebar.png) |

---

## 上游项目与深度定制说明 (Upstream Projects & Adaptations)

本仓库整合、分工并深度优化了两个开源社区项目，避免双观察器冲突与后台资源风暴：

1. **[Anarcadia/chuanban-antigravity-theme-patch](https://github.com/Anarcadia/chuanban-antigravity-theme-patch)**（船板主题补丁，已验证至 `v5.5.3` / `0aec663`）
   - 复用与职责：全权负责暖纸/深色主题视觉、`Google Sans Flex` × 更纱黑体排版（Windows 建议配合独立拆分 `Windows-Sarasa-Split-SC-TTF` + `--retire-super-ttc` 消除 `SuperTTC` 回退延迟）、**单一 `1,940` 词条桌面汉化引擎**（`i18n: true`）、底部实时指标胶囊（`metrics: true`）、原生设置页 **Token Analytics**（`tokenAnalytics: true`）、Antigravity `2.33/2.34+` 单图标 `M1+M2` CDP 接力与 `cdpAutoRelaunch`、`plugin://swarm--` 子帧实时主题同步、宿主指纹门禁及 Windows ME SDDL 计划任务。
   - 本仓库定制（[`assets/theme-user-config.json`](assets/theme-user-config.json)、[`assets/theme-user-custom.js`](assets/theme-user-custom.js)、[`assets/theme-user-custom.css`](assets/theme-user-custom.css)）：
     - **DSH Harness 风格底部胶囊**：通过事件驱动包装 `window.__ag_render_metrics`（零额外定时器、`ctx.onCleanup` 无泄漏回收），将底部 `#ag-live-metrics-pill` 格式化为 `入 <used>/<limit> (<pct>%) · 出 <out> · <tps> tok/s · 首字 <ttft>`，完整保留原生悬停详情卡。
     - **高刷屏 GPU 合成减负 CSS（`theme-user-custom.css`）**：关闭侧边栏 12 组 `[data-agent-state-dot]` / `agentStateDot` 144Hz 空转脉动、`.shimmer-text-mask/.shimmer-text-content` 流光蒙版重绘、流式逐词 `span[style*="fade-in"]` WAAPI 残留动画、装饰性 `.animate-pulse/.animate-ping/.animate-bounce` 与大面积 `[class*="backdrop-blur"]` 毛玻璃，同时保留全部悬停/点击交互反馈。
     - **弹窗最高层叠与原生视图穿透避让**：上下文弹窗 `#panel` 展开时自动将 `#ag-context-meter` 及层叠祖先提权至 `z-index: 2147483500` 并通知 `wcvBrowser.setPortalOverlayOpen(true)`（关闭后无损还原）；监听宿主父节点 `childList` 与捕获阶段点击事件，保底重连间隔放宽至 `15s`。

2. **[elviscjn-cjn/antigravity-context-viewer](https://github.com/elviscjn-cjn/antigravity-context-viewer)**（锁定已验证基线 `v0.8.9` / `1ec6f3d381e687f51846d3690c10373bb8832a92`）
   - 复用与极限精简（[`patches/context-viewer.patch`](patches/context-viewer.patch)）：
     - 顶栏仅保留 **`#badge`（上下文进度环 + `%`）** 与 **`#badge-speed`（`⚡ tok/s` + ELV-93 纯 SVG 等待沙漏）**，面板保留当前会话上下文、速度对比（ELV-91）、会话时间线与设置页（`max-height: min(580px, calc(100vh - 96px))`，隐藏态启用 `content-visibility: hidden`）。
     - 彻底移除冗余顶栏与面板模块：`#badge-quota` / `#panel-quota`（限额提示）、`#badge-cli` / `#cli-launch-toast`（CLI 入口）、`#badge-tokens` / `#panel-tokens`（由船板 `v5.5.3` Token Analytics 接管）、`#tab-ctx-models` / `#pane-ctx-models`、提示词增强卡片、品牌/语言卡片、外观停靠偏好卡、`ProxyNoTun`、调色抽屉及启动更新弹窗（`autoCheckUpdate = false`），并修复上游 `v0.8.9` 模板中 `#pane-ctx-settings` 多余闭合标签 `</div></div>` 的结构嵌套缺陷。
     - 关闭 ContextViewer 重复汉化模块（`modules.chinese.enabled = false`），杜绝双 `MutationObserver` 竞争 DOM。
     - **渲染层深度防卡顿优化**：关闭面板时 `render()` / `syncSpeedBadgeText()` / `updateWaitOnly()` 走 O(1) 快路径（展开面板时通过 `panelRenderDirty` 立即刷新）；`resolveLatestSessionCallRecord()` 改用 16 条尾窗扫描 + 记忆化缓存；`requestPoll()` 改用 O(1) 流式状态检测与视觉签名去重（流式 `1.5s` / 闭面板空闲 `5s` / 开面板空闲 `3s` / 后台标签 `20s`）；后台标签 `tick()` 2s 节流；`hostDomObserver` 去掉 `characterData`/`attributes` 并做 `250ms` 节流 + titlebar 快路径；硬停用 `/quota`、`/accounts-overview`、`/record-calls` 与后台 15s `/token-history` 轮询（包括门控 `heatmap.js` 冷启动拉取，消除冷启动 10s CPU 与 +170 MB 内存尖峰），`/scan` 改为严格按需触发（展开底层技术审计抽屉或手动刷新时才扫描）；`ensureHostDocked()` 保持弹窗展开时的提权 `z-index`；`openGithubRepo` 通过回环桥 `/open-external` 打开。

3. **超轻纯 CDP + 动态回环桥接守护**（[`assets/antigravity-patch-guardian.mjs`](assets/antigravity-patch-guardian.mjs)）
   - 零改盘官方 `app.asar`（`process.noAsar = true`），若发现历史 ASAR 补丁标记仍自动尝试从 `app-*-base.asar` 恢复。
   - `5s` 轮询周期 / `30s` 轻量心跳（页面重载由 CDP WebSocket 实时事件驱动）；`.live-session.json` 增加 dirty-check 避免重复写盘；在精简模式下短路 `/record-calls`（彻底消除每 20s 重写 35 MB `pricing_ledger_v1.json` 造成的 51.6% CPU + 860 MB 内存风暴）；`GET /health` 暴露 `rssMB` 与 `routeHits` 便于 `verify.mjs` 实时审计。

---

## 一句话发给 Agent (One-Sentence Prompt for AI Agents)

在新电脑上把下面任意一句话发给 Antigravity 或其他 AI Agent，即可直接拉取并部署本套件：

**中文指令：**

> 请把 `https://github.com/jyxu0621/antigravity-chuanban-context-suite` 克隆到全局 Skills 目录（`~/.gemini/config/skills/antigravity-chuanban-context-suite`），阅读里面的 `SKILL.md` 和 `README.md`，运行 `node scripts/setup.mjs` 和 `node scripts/verify.mjs` 完成船板 `v5.5.3`（单一汉化 + DSH 底部胶囊 + GPU 减负 CSS）与极限精简零卡顿版 ContextViewer `v0.8.9` 的部署和验证（保持纯 CDP 模式，不要修改 `app.asar`）。

**English prompt:**

> Clone `https://github.com/jyxu0621/antigravity-chuanban-context-suite` into `~/.gemini/config/skills/antigravity-chuanban-context-suite`, read `SKILL.md` and `README.en.md`, and run `node scripts/setup.mjs` followed by `node scripts/verify.mjs` to install and verify the Chuanban v5.5.3 + ultra-slim ContextViewer v0.8.9 suite in pure CDP mode without modifying `app.asar`.

> [!IMPORTANT] **Agent 执行注意（详情见 [`SKILL.md`](SKILL.md)）**
> - 不要修改官方 `app.asar`。Windows 下 `setup.mjs` 保留船板原生 ME SDDL 计划任务 `AntigravityThemeDaemon`，并以同等 `schtasks /Create /XML`（`ME` SDDL、`Parallel`、`StopOnIdleEnd=false`、`LogonTrigger` + `PT1M` `--ensure` 自愈巡检）注册 `AntigravityPatchGuardian`，使双守护脱离 Agent 终端的 Win32 Job Object 并在异常退出后 1 分钟内自动拉起；macOS 和 Linux 分别注册 `LaunchAgent`（`KeepAlive`）与 `systemd --user`（`Restart=always`）。
> - 切勿在 Antigravity 会话内强杀宿主机进程。如果安装前客户端未启用远程调试端口，请在 `setup.mjs` 跑完后提示用户彻底退出并用更新后的快捷方式重开一次 Antigravity，再运行 `node scripts/verify.mjs`。
> - 船板字体（Anthropic + Sarasa）需从 [Google Drive](https://drive.google.com/drive/folders/1NX92SgVUqtSjWg6bt6sIJXy-cn7J_boC) 另行下载，并在安装时通过 `--fonts-from <字体目录>` 传入；Windows 推荐下载独立拆分版 `Windows-Sarasa-Split-SC-TTF` 并执行 `node install.mjs install-fonts --from <目录> --retire-super-ttc` 停用 `Sarasa-SuperTTC.ttc`。

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
| `--latest` | 跳过锁定基线 `1ec6f3d`（`v0.8.9`），尝试直接基于上游 `HEAD` 打补丁 |
| `--skip-tests` | 跳过打补丁后的 ContextViewer 单元测试 |
| `--skip-verify` | 安装结束时不自动执行 `verify.mjs` |

---

## 验证与回滚 (Verification & Rollback)

```bash
# 完整检查（本地配置 + 官方 app.asar 洁净度 + 守护进程 PID + /health RSS/路由审计 + 实时 CDP DOM/z-index/GPU CSS/DSH 胶囊）
node scripts/verify.mjs

# 仅做静态文件、守护进程与 /health 检查（Antigravity 未启动时）
node scripts/verify.mjs --skip-cdp
```

如需在已打补丁的 `antigravity-context-viewer` 目录单独复现核心单元测试（**238 项全通过**）：

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
│   ├── antigravity-patch-guardian.mjs   # 超轻纯 CDP + 动态回环 HTTP 桥接守护脚本
│   ├── preview-workbench-full.png       # 预览：整窗 Claude 风格主题 + 监控弹窗效果（已打码脱敏）
│   ├── preview-titlebar.png             # 预览：历史版顶栏视觉参考
│   ├── preview-context-panel.png        # 预览：精简版当前会话上下文面板
│   ├── preview-tokens-panel.png         # 预览：历史版 Token 面板参考
│   ├── theme-user-config.json           # 船板 v5.5.3 适配配置（单一汉化 + 底部指标 + Token Analytics）
│   ├── theme-user-custom.css            # 高刷屏 GPU 合成减负 CSS（消除 144Hz 持续空转动画与模糊）
│   └── theme-user-custom.js             # DSH 底部胶囊格式化 + 弹窗高优先级 z-index 与原生视图层级适配
├── patches/
│   └── context-viewer.patch             # 基于 upstream@1ec6f3d (v0.8.9) 的极限精简与零卡顿补丁
└── scripts/
    ├── setup.mjs                        # 跨平台幂等安装与系统自启注册脚本
    └── verify.mjs                       # 静态 + 进程 + /health + 实时 CDP 联合验收脚本
```
