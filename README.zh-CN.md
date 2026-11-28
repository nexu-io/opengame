<p align="center"><img src="docs/readme/opengame-logo.svg" width="400" alt="OpenGame"></p>

<p align="center"><strong>首个 Super Game Agent —— 开源全栈 AI 游戏创作工作台</strong></p>

<p align="center">
  <img src="docs/readme/opengame-hero.webp" width="100%" alt="OpenGame —— 首个 Super Game Agent。用你的 AI Agent 制作、一键复刻并发布 3D 与 9:16 可玩游戏。">
</p>

<p align="center">
  <a href="docs/opengame-setup.md#prerequisites"><img src="docs/readme/badges/node.svg" alt="Node.js 26.11.1"></a>
  <a href="LICENSE"><img src="docs/readme/badges/license.zh-CN.svg" alt="Apache 2.0 许可证"></a>
  <a href="https://github.com/nexu-io/open-design"><img src="docs/readme/badges/built-by-opendesign.zh-CN.svg" alt="OpenDesign 出品"></a>
</p>

<p align="center">
  <a href="https://go.open-design.ai/?utm_source=github&amp;utm_medium=referral&amp;utm_campaign=opengame&amp;utm_content=readme_zh"><img src="docs/readme/badges/opendesign-go.svg" alt="OpenDesign Go 模型订阅" /></a>
  <a href="https://discord.com/invite/M7NnHS9gNa"><img src="docs/readme/badges/discord.svg" alt="加入 OpenGame Discord 社区" /></a>
  <a href="https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=b6cs46dc-acb2-48ed-941d-c45642ead841"><img src="docs/readme/badges/feishu.zh-CN.svg" alt="加入 OpenGame 飞书群" /></a>
  <a href="https://x.com/OpenDesignHQ"><img src="docs/readme/badges/x-opendesignhq.svg" alt="OpenDesign 官方 X 账号 @OpenDesignHQ" /></a>
  <a href="https://x.com/OpenDesignDevs"><img src="docs/readme/badges/x-opendesigndevs.svg" alt="OpenDesign 开发者 X 账号 @OpenDesignDevs" /></a>
  <a href="https://www.youtube.com/channel/UChtshixMhvtgBWzoD9R_Qfg"><img src="docs/readme/badges/youtube.svg" alt="OpenDesign 的 YouTube 频道" /></a>
</p>

<p align="center"><a href="#quick-start">快速开始</a> · <a href="#agent-wall">支持的 Agent</a> · <a href="#showcase">可玩游戏模板</a> · <a href="#features">核心能力</a> · <a href="#publish-monetize">发布与变现</a> · <a href="#technical-guide">接入与 MCP</a> · <a href="#community">社区共建</a></p>

<div align="center">

[English](README.md) · **简体中文** · [日本語](README.ja.md)

</div>

# 认识 OpenGame

OpenGame 是**首个开源全栈 Super Game Agent**——把 **DeepSeek（DSH）**、**Claude Code**、**Codex** 或任意本地编程 Agent 变成一座开源 AI 版虚幻引擎 / Unity 与全栈游戏工作台，从一句话创意出发，既能打造 **3A 级 3D 大作**，也能跑通 **爆款小游戏上架变现** 全链路。

- 🚀 **用你的 Agent 打造 3A 级大作。** 直接用 **DeepSeek（DSH）**、**Claude**、**Codex**、**Gemini** 驱动代码、3D 场景、美术、配乐与配音全栈生产——从一句话想法到可玩的 3D 动作、竞速与大世界体验。
- 🎮 **一键复刻 & 风格化任何游戏。** 内置 **25 款可玩游戏模板**（3D、体素、像素、动漫及 9:16 爆款小游戏 / 试玩广告），源码与设计文档全开放；保留成熟核心玩法，几分钟完成换皮与画风重构。
- 💰 **做能赚钱的游戏：制作 → 验证 → 上架变现。** 自动完成规则校验、仿真试玩、封面截图与实机预告片；一键生成在线试玩链接或单文件 **9:16 试玩广告**，并打通 **微信小游戏 / 抖音 / TikTok** 等平台上架变现路径。
- 🔓 **全栈开源（BYOA + BYOK）。** 代码、美术、视频、音乐、配音与 Three.js 3D 全部开源，支持接入你常用的 [本地 Agent](#agent-wall) 与自有 API Key，也可一键连接 [OpenDesign Go](https://go.open-design.ai/?utm_source=github&utm_medium=referral&utm_campaign=opengame&utm_content=readme_zh)（黑五期间享最低折扣，**DeepSeek V4.1 Flash**、**Seedream** 等模型免费用）。

<a id="quick-start"></a> <a id="快速开始"></a>

## ⚡ 快速开始

### 1. 一句话交给你的本地 Agent

把下面这段指令发给 **DeepSeek TUI / Harness**、**Claude Code**、**Codex**、**WorkBuddy**、**Cursor**、**Gemini CLI** 或任意 [22 个本地 Agent](#agent-wall)：

```text
请按 https://github.com/nexu-io/opengame/blob/main/docs/opengame-setup.md 把 OpenGame 接入当前 Agent，并打开 Game Studio 模板库。
```

### 2. 通过 Skills CLI 安装 OpenGame 主 Skill

使用 [Skills CLI](https://github.com/vercel-labs/skills) 安装 OpenGame 主入口 Skill（`opengame`，自动引导本地接入并路由到 `openmotion-game` 及 18 份涵盖 3C 手感、2D/3D 动画、试玩广告规范与质量门禁的工程手册）：

```sh
npx skills add https://github.com/nexu-io/opengame/tree/skills --skill opengame
```

> Skills CLI 只安装工作流指引（也可按需单独安装 `--skill openmotion-game`）；请结合下方本地运行与 MCP 配置，让 Agent 能够直接调用 12 个 `openmotion_game_*` 工具并打开 Game Studio。

### 3. 从源码在本地启动 OpenGame Studio

环境要求：**Git**、**Git LFS**、**npm**、**Node.js 26.11.1**（与 CI 版本一致）。启动后即可浏览模板目录，首次试玩或 Remix 时只下载所选模板的素材。Tidebreaker 可直接离线试玩。

```sh
git -c filter.lfs.process= -c filter.lfs.smudge= -c filter.lfs.required=false clone --depth 1 --single-branch --branch main https://github.com/nexu-io/opengame.git
cd opengame
git lfs install --local --skip-smudge
npm ci
npm run build:studio
npm start
```

<a id="agent-wall"></a>

**支持 22 个本地 Agent（BYOA）** · [选择你的 Agent](#choose-agent)

<p align="center"><a href="#choose-agent"><picture><source media="(max-width: 600px)" srcset="docs/readme/agents/local-agents.mobile.png"><img src="docs/readme/agents/local-agents.png" width="100%" alt="WorkBuddy, Codex CLI, Claude Code, OpenCode, Hermes, Antigravity, Gemini CLI, Grok Build, Kimi CLI, Cursor Agent, Qwen Code, Qoder CLI, GitHub Copilot, Pi, Kiro CLI, Kilo, Mistral Vibe, DeepSeek TUI, Reasonix, Aider, Devin, Trae CLI"></picture></a></p>

<a id="showcase"></a>

## 🕹️ 内置可玩游戏模板与示例

OpenGame 在 [`templates/games/`](templates/games/) 中内置了 **25 款开箱即玩的完整游戏工程**，全部包含 HTML5 / Three.js 源码、封面、操控说明与中英双语元数据。在 Game Studio 里可直接试玩，一键 **Remix 复刻**，或**一键换画风 / 换题材 / 换角色**做成属于你的游戏。

### 3D、体素与动作游戏（16:9 横屏）

<table width="100%">
<tr>
<td width="50%" valign="top">
<img src="templates/games/tidebreaker/cover.webp" width="100%" alt="破潮者 Tidebreaker — 3D 风暴群岛快艇竞速"><br>
<strong>破潮者 · Tidebreaker</strong> · <code>3D · 竞速 · Three.js</code><br>
驾驶快艇穿越风暴群岛，跃过浪尖、避开暗礁，在倒计时结束前冲过八个检查点。<br>
<a href="templates/games/tidebreaker/">查看源码与 DESIGN.md →</a>
</td>
<td width="50%" valign="top">
<img src="templates/games/starlight-bastion/cover.webp" width="100%" alt="星辉堡垒 Starlight Bastion — 体素太空晶核防御射击"><br>
<strong>星辉堡垒 · Starlight Bastion</strong> · <code>体素 · 射击 · 肉鸽升级</code><br>
守护发光的星核，击退五波体素入侵者，每波结束后三选一强化技能。<br>
<a href="templates/games/starlight-bastion/">查看源码与 DESIGN.md →</a>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="templates/games/skyline-courier/cover.webp" width="100%" alt="天际快递员 Skyline Courier — 3D 赛博高楼跑酷"><br>
<strong>天际快递员 · Skyline Courier</strong> · <code>3D · 平台跑酷 · 赛博朋克</code><br>
在雨夜霓虹摩天楼顶奔跑、二段跳与蹬墙飞跃，90 秒内送达最后三件包裹。<br>
<a href="templates/games/skyline-courier/">查看源码与 DESIGN.md →</a>
</td>
<td width="50%" valign="top">
<img src="templates/games/neon-drift/cover.webp" width="100%" alt="霓虹漂移 Neon Drift — 3D 赛博夜路高架飙车"><br>
<strong>霓虹漂移 · Neon Drift</strong> · <code>3D · 竞速 · 赛博霓虹</code><br>
在雨后霓虹高架高速穿梭车流，极限擦车积攒氮气加速，刷新行驶距离纪录。<br>
<a href="templates/games/neon-drift/">查看源码 →</a>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="templates/games/comet-guard/cover.webp" width="100%" alt="彗星守卫 Comet Guard — 轨道空间站太空射击"><br>
<strong>彗星守卫 · Comet Guard</strong> · <code>射击 · 太空防御</code><br>
驾驶轨道拦截机在手绘星空中击碎熔岩彗星，守护发光空间站撑过递增波次。<br>
<a href="templates/games/comet-guard/">查看源码 →</a>
</td>
<td width="50%" valign="top">
<img src="templates/games/harbor-skirmish/cover.webp" width="100%" alt="海港突击 Harbor Skirmish — 3D 第一人称海岛射击"><br>
<strong>海港突击 · Harbor Skirmish</strong> · <code>3D FPS · 抓钩与滑铲</code><br>
风格化 3D 第一人称海岛射击，支持二段跳、滑铲、冲刺与抓钩机动。<br>
<a href="templates/games/harbor-skirmish/">查看源码 →</a>
</td>
</tr>
</table>

### 风格化、叙事与氛围游戏（16:9 横屏）

<table width="100%">
<tr>
<td width="50%" valign="top">
<img src="templates/games/glyph-garden/cover.webp" width="100%" alt="符花庭园 Glyph Garden — 二次元奇幻三消"><br>
<strong>符花庭园 · Glyph Garden</strong> · <code>二次元 · 消除 · 奇幻</code><br>
交换月光花瓣触发连锁绽放，在 24 步内冲刺 2,200 分唤醒失落的庭园。<br>
<a href="templates/games/glyph-garden/">查看源码 →</a>
</td>
<td width="50%" valign="top">
<img src="templates/games/lantern-hop/cover.webp" width="100%" alt="灯笼跳跃 Lantern Hop — 像素奇幻屋檐跑酷"><br>
<strong>灯笼跳跃 · Lantern Hop</strong> · <code>像素 · 平台跑酷 · 东方奇幻</code><br>
操控围着围巾的像素小狐狸跃过月夜飞檐，二段跳收集发光纸灯笼。<br>
<a href="templates/games/lantern-hop/">查看源码 →</a>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="templates/games/lighthouse-log/cover.webp" width="100%" alt="灯塔手记 Lighthouse Log — 动漫风风暴生存叙事"><br>
<strong>灯塔手记 · Lighthouse Log</strong> · <code>动漫 · 视觉小说 · 生存</code><br>
在连续七个暴风雨夜守护海崖灯塔，分配最后燃料，在电台求救间做出抉择。<br>
<a href="templates/games/lighthouse-log/">查看源码 →</a>
</td>
<td width="50%" valign="top">
<img src="templates/games/last-light/cover.webp" width="100%" alt="最后的光 Last Light — 手电筒潜行恐怖逃生"><br>
<strong>最后的光 · Last Light</strong> · <code>恐怖 · 氛围逃生</code><br>
在手电熄灭前于废弃校园找齐三把钥匙，同时用光束压制紧追不舍的暗影。<br>
<a href="templates/games/last-light/">查看源码 →</a>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="templates/games/night-train/cover.webp" width="100%" alt="夜行列车的信 Night Train Letters — 互动分支叙事"><br>
<strong>夜行列车的信 · Night Train Letters</strong> · <code>视觉小说 · 分支剧情</code><br>
三封未寄出的信、一列驶向大海的雨夜列车，用纯 HTML 讲述细腻分支故事。<br>
<a href="templates/games/night-train/">查看源码 →</a>
</td>
<td width="50%" valign="top">
<img src="templates/games/stack-the-moon/cover.webp" width="100%" alt="叠叠月 Stack the Moon — 一键月光叠塔"><br>
<strong>叠叠月 · Stack the Moon</strong> · <code>休闲 · 单指街机</code><br>
在云海之上精准叠起月光天文台，连续完美落位修复塔身并冲入星空。<br>
<a href="templates/games/stack-the-moon/">查看源码 →</a>
</td>
</tr>
</table>

### 9:16 竖屏爆款小游戏与试玩广告模板

专为单手触屏、首帧即玩、高留存短局与**小游戏 / 试玩广告商业变现**打造：

<table width="100%">
<tr>
<td width="50%" valign="top">
<img src="templates/games/gate-legion/cover.webp" width="100%" alt="草原军团 Gate Legion — 9:16 算术门跑酷"><br>
<strong>草原军团 · Gate Legion</strong> · <code>9:16 · 算术门军团跑酷</code><br>
左右拖动选择 <code>+10</code> / <code>×2</code> 算术门壮大军团，在终点迎战敌军。<br>
<a href="templates/games/gate-legion/">查看源码 →</a>
</td>
<td width="50%" valign="top">
<img src="templates/games/pin-rescue/cover.webp" width="100%" alt="熔金拔针 Pin Rescue — 9:16 拔针解谜"><br>
<strong>熔金拔针 · Pin Rescue</strong> · <code>9:16 · 拔针物理解谜</code><br>
拔出机关针混合水流与熔岩，化解陷阱并在五道关卡中顺利夺金。<br>
<a href="templates/games/pin-rescue/">查看源码 →</a>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="templates/games/sky-runner/cover.webp" width="100%" alt="霓虹天际跑者 Sky Runner — 9:16 3D 滑板跑酷"><br>
<strong>霓虹天际跑者 · Sky Runner</strong> · <code>9:16 · 3D 三道跑酷</code><br>
切换赛道、拾取金币、躲避无人机，在不断加速的霓虹高空疾驰。<br>
<a href="templates/games/sky-runner/">查看源码 →</a>
</td>
<td width="50%" valign="top">
<img src="templates/games/slime-swell/cover.webp" width="100%" alt="史莱姆膨胀城 Slime Swell — 9:16 城市吞噬大作战"><br>
<strong>史莱姆膨胀城 · Slime Swell</strong> · <code>9:16 · 吞噬成长 .io</code><br>
吞噬比自己小的车辆与建筑，60 秒内体积超越三名竞争对手。<br>
<a href="templates/games/slime-swell/">查看源码 →</a>
</td>
</tr>
</table>

<details>
<summary><strong>展开查看全部 25 款内置可玩游戏模板</strong></summary>

| 游戏名称 | 类型 | 画风 | 屏幕方向 | 简介 | 源码目录 |
| --- | --- | --- | --- | --- | --- |
| **弹弓攻城 (Castle Crush)** | 休闲 | 动漫 | 9:16 竖屏 | 弹弓拉弓投石击倒木石城塔，每关三发共四关 | [castle-crush](templates/games/castle-crush/) |
| **彗星守卫 (Comet Guard)** | 射击 | 极简 | 16:9 横屏 | 驾驶拦截机击碎熔岩彗星，守护轨道空间站 | [comet-guard](templates/games/comet-guard/) |
| **像素漂移冲刺 (Drift Dash)** | 竞速 | 体素 | 9:16 竖屏 | 单手按住左右漂移，三圈击败三辆 AI 赛车 | [drift-dash](templates/games/drift-dash/) |
| **草原军团 (Gate Legion)** | 休闲 | 像素 | 9:16 竖屏 | 爆款算术门军团倍增与终点决战 | [gate-legion](templates/games/gate-legion/) |
| **符花庭园 (Glyph Garden)** | 休闲 | 动漫 | 16:9 横屏 | 奇幻月光花园三消连击解谜 | [glyph-garden](templates/games/glyph-garden/) |
| **海港突击 (Harbor Skirmish)** | 射击 | 3D | 16:9 横屏 | 手绘风格 3D 第一人称海岛射击，带滑铲与抓钩 | [harbor-skirmish](templates/games/harbor-skirmish/) |
| **景阳冈 (Jingyang Ridge)** | 休闲 | 动漫 | 16:9 横屏 | 水墨武松打虎 Boss 战：识破招式前摇、闪避反击 | [jingyang-ridge](templates/games/jingyang-ridge/) |
| **星港三线炮台 (Lane Turret)** | 射击 | 像素 | 9:16 竖屏 | 三线炮台瞄准射击、收集卡牌坚守十波 | [lane-turret](templates/games/lane-turret/) |
| **灯笼跳跃 (Lantern Hop)** | 平台 | 像素 | 16:9 横屏 | 像素狐狸月夜屋檐无尽二段跳跑酷 | [lantern-hop](templates/games/lantern-hop/) |
| **最后的光 (Last Light)** | 恐怖 | 极简 | 16:9 横屏 | 废弃校园手电筒寻钥逃生 | [last-light](templates/games/last-light/) |
| **灯塔手记 (Lighthouse Log)** | 视觉小说 | 动漫 | 16:9 横屏 | 七个暴风雨夜的燃料分配与电台道德抉择 | [lighthouse-log](templates/games/lighthouse-log/) |
| **合成小烘焙 (Merge Bakery)** | 休闲 | 动漫 | 9:16 竖屏 | 烘焙面团、拖拽合成点心并在 90 秒内完成订单 | [merge-bakery](templates/games/merge-bakery/) |
| **霓虹漂移 (Neon Drift)** | 竞速 | 3D | 16:9 横屏 | 赛博霓虹雨夜高架车流穿梭与氮气加速 | [neon-drift](templates/games/neon-drift/) |
| **夜行列车的信 (Night Train Letters)** | 视觉小说 | 极简 | 16:9 横屏 | 雨夜海滨列车的温情分支文字冒险 | [night-train](templates/games/night-train/) |
| **潜望深渊 (Periscope Depth)** | 射击 | 极简 | 16:9 横屏 | 潜艇巡航：潜望镜发射鱼雷，下潜躲避声呐深水炸弹 | [periscope-depth](templates/games/periscope-depth/) |
| **熔金拔针 (Pin Rescue)** | 休闲 | 极简 | 9:16 竖屏 | 拔针混合水火、避开岩浆赢取金币的五关解谜 | [pin-rescue](templates/games/pin-rescue/) |
| **屋顶咖啡 (Rooftop Roast)** | 休闲 | 极简 | 16:9 横屏 | 可一键换品牌的门店营销小游戏（修改一个 `SHOP` 对象即可换皮） | [rooftop-roast](templates/games/rooftop-roast/) |
| **霓虹天际跑者 (Sky Runner)** | 竞速 | 3D | 9:16 竖屏 | 赛博 3D 悬浮滑板变道跑酷与吃币加速 | [sky-runner](templates/games/sky-runner/) |
| **天际快递员 (Skyline Courier)** | 平台 | 3D | 16:9 横屏 | 3D 赛博楼顶蹬墙跳与 90 秒限时派送 | [skyline-courier](templates/games/skyline-courier/) |
| **史莱姆膨胀城 (Slime Swell)** | 休闲 | 极简 | 9:16 竖屏 | 60 秒吞噬城市物品、击败三名对手史莱姆 | [slime-swell](templates/games/slime-swell/) |
| **色环归位 (Sort Stack)** | 休闲 | 极简 | 9:16 竖屏 | 同色圆环归柱解谜，支持撤销，挑战五关计时 | [sort-stack](templates/games/sort-stack/) |
| **叠叠月 (Stack the Moon)** | 休闲 | 极简 | 16:9 横屏 | 单指精准叠起月光天文台，连击完美落位 | [stack-the-moon](templates/games/stack-the-moon/) |
| **星辉堡垒 (Starlight Bastion)** | 射击 | 体素 | 16:9 横屏 | 五波体素敌人晶核防卫战 + 局间升级 | [starlight-bastion](templates/games/starlight-bastion/) |
| **破潮者 (Tidebreaker)** | 竞速 | 3D | 16:9 横屏 | 风暴群岛 3D 快艇跳浪与限时过关竞速 | [tidebreaker](templates/games/tidebreaker/) |
| **倾斜神庙 (Tilt Temple)** | 休闲 | 3D | 9:16 竖屏 | 3D 悬浮迷宫拖动倾斜滚球，拿钥匙闯三关 | [tilt-temple](templates/games/tilt-temple/) |

</details>

<a id="features"></a>

## ✨ 核心能力

### 1. 一键复刻与一键风格化 —— 游戏即开源工程代码

从空白提示词让大模型直接写出好玩、不崩的游戏门槛极高。OpenGame 把**可验证的游戏工程骨架**与**题材、画风、角色和素材**解耦：

- **每一款游戏都是清晰可编辑的源码**：`index.html`、确定性核心逻辑 `logic.js`、3D 场景内置 Three.js，以及结构化设计文档（`design/plan.md`、`design/style.md`、`design/assets.csv`、`design/verification.md`）。
- **一键 Remix 复刻**：在 Game Studio 点击任意模板的 **Remix**（或在 Agent 对话中指定模板），即可派生独立可编辑草稿，完整继承操控、数值配置表与自动化测试钩子。
- **一键 Re-style 风格化**：保留已经验证过的物理手感与胜负循环，自由替换世界观、角色、美术风格与配乐——**DeepSeek** 等低成本模型也能稳定改出高质量成品；**Claude Fable 5.2**、**Opus**、**Codex**、**Gemini** 等顶级模型更可直接从零创作复杂 3D 游戏。

**直接在 Agent 中试试这些提示词：**

```text
# 1. 一键复刻 + 换画风（极适合 DeepSeek 等高性价比模型快速出活）
使用 openmotion-game 复刻「灯笼跳跃 (Lantern Hop)」模板，把它风格化为赛博雨夜猫咪跑酷：保留原有二段跳手感与计分循环，把狐狸和灯笼换成霓虹机械猫与全息电池，生成新的角色立绘和合成波 BGM，最后完成校验、无头试玩并截取新封面。
```

```text
# 2. 制作可直接投放的 9:16 竖屏试玩广告 (Playable Ad)
使用 openmotion-game 创建一个 9:16 竖屏试玩广告（playableAd: true），题材为中世纪塔防手游：首帧即玩并带手势引导、25 秒爽快波次战斗、结尾展示带 App Store / Google Play 转化按钮的结束页。完成 390x844 试玩验证并打包为单文件 HTML。
```

```text
# 3. 从零制作 3D 原创游戏（适合 Claude Fable 5.2 / Opus / Codex / Gemini）
使用 openmotion-game 从零制作一款 3D 国风武侠 Boss 决斗游戏（style: "3d"），场景设在黄昏迷雾竹崖，包含弹反判定、闪避无敌帧、体力管理与两阶段 Boss 战。运行三档仿真与无头浏览器试玩，截取 1280x720 封面并自动录制 19 秒实机预告片。
```

<a id="model-wall"></a>

### 2. 全栈多模态素材生成（BYOK）

一款完整的游戏离不开主视觉、角色立绘、3D 无缝贴图、背景音乐、角色配音和清脆音效。OpenGame 通过内置 **Model Gateway** 将多模态生成直接接入游戏工程，同时让 API Key 留在本地工作区，不写入游戏源码。

<p>
  <img src="docs/readme/opengame/models/gpt-image.svg" width="148" alt="GPT Image">
  <img src="docs/readme/opengame/models/seedream.svg" width="148" alt="Seedream">
  <img src="docs/readme/models/nano-banana.svg" width="148" alt="Nano Banana 2">
  <img src="docs/readme/models/flux.svg" width="148" alt="FLUX">
  <img src="docs/readme/models/codex.svg" width="148" alt="Codex Image"><br>
  <img src="docs/readme/models/seedance.svg" width="148" alt="Seedance">
  <img src="docs/readme/models/wan.svg" width="148" alt="Wan">
  <img src="docs/readme/models/suno.svg" width="148" alt="Suno">
  <img src="docs/readme/models/elevenlabs.svg" width="148" alt="ElevenLabs">
  <img src="docs/readme/opengame/models/byteplus.svg" width="148" alt="BytePlus Voice">
</p>

| 游戏素材层 | 推荐模型（在 Model Settings 配置后自动发现） | 零 Key / 代码内建降级方案 |
| --- | --- | --- |
| **🖼️ 主视觉、角色立绘、精灵与贴图** | `GPT Image 2.6`（支持参考改图与透明底）、`Seedream 5.5` / `5.0 Flash`、`Nano Banana 2`、`FLUX`、`Codex Image` | 高质量 Canvas / SVG 程序化绘制与程序纹理 |
| **🎵 背景音乐（菜单 / 关卡 / Boss 战）** | `ElevenLabs Music v2`（`no vocals` 纯音乐循环）、`Suno v4` | Web Audio API 实时合成配乐循环 |
| **🎙️ 角色语音与旁白播报** | `ElevenLabs v3`（多语种）、`BytePlus TTS 2`（中文语音）、`Kokoro` | 风格化剧情字幕与对话框 |
| **🎬 开场过场与动效片段** | `Wan 2.7`、`Seedance 2.5`（短时 I2V 动画片段） | 引擎内实时运镜与开场动画 |
| **🔊 打击、跳跃、金币与 UI 音效** | 直接在游戏代码中通过 Web Audio API 实时合成 | 同左（零延迟、零外链资源） |
| **🧊 3D 场景与模型** | 内置 **Three.js** + CC0 套件 + 3D 网关预留槽位（接入即自动发现） | Three.js 程序化建模、光照与着色器 |

> 本地开源创作栈本身完全免费，不收软件订阅费。你可以在 **Model Settings** 填入自有供应商 Key、接入 [OpenDesign Go](https://go.open-design.ai/?utm_source=github&utm_medium=referral&utm_campaign=opengame&utm_content=readme_zh) 统一订阅，或完全使用纯代码零成本方案生成游戏。[模型目录](gateway/catalog.ts) · [供应商配置指南](docs/model-gateway.md)

### 3. 自动化游戏 QA、三档数值仿真与自动预告片

不靠盲猜「代码大概能跑」——OpenGame 在交付可玩成品前内建完整自动化验证闭环：

1. **静态规范与 50-Tick 逻辑冒烟 (`openmotion_game_validate`)** —— 校验 `index.html`、资源策略与确定性核心导出，确保单帧逻辑 `< 5 ms`。
2. **三档无头数值仿真 (`openmotion_game_simulate`)** —— 无需拉起浏览器即可自动验证：标准操作路线能达成真正胜利里程碑、弱操作路线会吃力受挫、挂机路线会在 `< 2500` tick 内正常失败。
3. **无头 Chrome 真操作试玩 (`openmotion_game_playtest`)** —— 启动 1–4 个独立浏览器客户端执行真实键鼠/触屏脚本，核验 3C 操控手感、`390×844` 移动端适配、生成素材加载状态，以及控制台/网络零报错。
4. **纯画布高清封面截取 (`openmotion_game_capture_cover`)** —— 在隔离的无头 Chrome 中自动截取 `1280×720` 游戏画布 PNG 到 `assets/cover.png`。
5. **自动实机预告片 (`openmotion_game_trailer`)** —— 自动录制 3 段 5 秒 `1280×720` 实机片段，合成约 19 秒带封面与「立即游玩」尾板的可编辑视频工程并渲染为 MP4，直接用于社媒宣发。

<a id="publish-monetize"></a>

## 🚀 端到端分发与变现路径

让做出来的游戏不止停留在本地——能玩、能分享、能上架、能赚钱。

| 环节 | 当前已支持 | 路线图（推进中） |
| --- | --- | --- |
| **本地游玩与模板库** | 一键发布到本地 OpenGame Studio 游戏市场（`openmotion_game_publish`），支持游玩计数、收藏与一键 Remix | **TOP 100 赚钱小游戏模板专栏**，覆盖高变现玩法壳子，拿来即可复刻换皮 |
| **一键公网分享链接** | 登录后通过 OpenDesign Cloud（`openmotion_assets_use action="web_publish"`）自动重写本地素材路径、压缩资源并生成可分享的在线游玩 URL | 自定义域名与可嵌入试玩卡片 |
| **移动端试玩广告** | 内置 **9:16 Playable Ad 模式**（`playableAd: true`）：首帧即玩、手势引导、短关卡、单文件内联 HTML 与 App Store / Google Play 转化卡片 | 主流广告平台一键打包预设（AppLovin / Unity Ads / Meta / TikTok） |
| **小游戏平台上架与变现** | 干净自包含的 HTML5 / JS 工程源码 + 自动录制的实机宣传预告片，方便直接封装投稿与买量宣发 | **L1–L4 分级平台上架引导页面与打包 Skill**：覆盖**微信小游戏**、**抖音小游戏**、**TikTok**、**小红书小工具市场**以及 **itch.io / CrazyGames / Poki** |
| **AI 模型游乐场** | 本地单人试玩与已有联机房间的自动入房测试 | **多模型实时游戏对战（AI Arena）**——让多个大模型在游戏里同场实时博弈 |

<a id="technical-guide"></a>

## 🛠️ 接入配置与 12 个游戏 MCP 工具

<a id="agent-setup"></a> <a id="choose-agent"></a>

### 接入你的本地 Agent

点击下方图标跳转对应配置，把本地 OpenGame MCP 服务与游戏 Skill 接入你的常用 Agent：

<p>
  <a href="#deepseek-setup"><img src="docs/readme/agents/deepseek-badge.svg" width="144" height="34" alt="DeepSeek TUI / Harness" /></a>
  <a href="#claude-setup"><img src="docs/readme/agents/claude-code-badge.svg" width="144" height="34" alt="Claude Code" /></a>
  <a href="#codex-setup"><img src="docs/readme/agents/codex-badge.svg" width="144" height="34" alt="Codex CLI" /></a>
  <a href="#workbuddy-setup"><img src="docs/readme/agents/workbuddy-badge.svg" width="144" height="34" alt="WorkBuddy" /></a>
  <a href="#manual-mcp"><img src="docs/readme/agents/opencode-badge.svg" width="144" height="34" alt="OpenCode" /></a>
  <a href="#manual-mcp"><img src="docs/readme/agents/hermes-badge.svg" width="144" height="34" alt="Hermes" /></a>
  <a href="#manual-mcp"><img src="docs/readme/agents/antigravity-badge.svg" width="144" height="34" alt="Antigravity" /></a>
  <a href="#manual-mcp"><img src="docs/readme/agents/gemini-badge.svg" width="144" height="34" alt="Gemini CLI" /></a>
  <a href="#manual-mcp"><img src="docs/readme/agents/grok-build-badge.svg" width="144" height="34" alt="Grok Build" /></a>
  <a href="#manual-mcp"><img src="docs/readme/agents/kimi-badge.svg" width="144" height="34" alt="Kimi CLI" /></a>
  <a href="#manual-mcp"><img src="docs/readme/agents/cursor-badge.svg" width="144" height="34" alt="Cursor Agent" /></a>
  <a href="#manual-mcp"><img src="docs/readme/agents/qwen-badge.svg" width="144" height="34" alt="Qwen Code" /></a>
  <a href="#manual-mcp"><img src="docs/readme/agents/qoder-badge.svg" width="144" height="34" alt="Qoder CLI" /></a>
  <a href="#manual-mcp"><img src="docs/readme/agents/copilot-badge.svg" width="144" height="34" alt="GitHub Copilot" /></a>
  <a href="#manual-mcp"><img src="docs/readme/agents/pi-badge.svg" width="144" height="34" alt="Pi" /></a>
  <a href="#manual-mcp"><img src="docs/readme/agents/kiro-badge.svg" width="144" height="34" alt="Kiro CLI" /></a>
  <a href="#manual-mcp"><img src="docs/readme/agents/kilo-badge.svg" width="144" height="34" alt="Kilo" /></a>
  <a href="#manual-mcp"><img src="docs/readme/agents/vibe-badge.svg" width="144" height="34" alt="Mistral Vibe" /></a>
  <a href="#manual-mcp"><img src="docs/readme/agents/reasonix-badge.svg" width="144" height="34" alt="Reasonix" /></a>
  <a href="#manual-mcp"><img src="docs/readme/agents/aider-badge.svg" width="144" height="34" alt="Aider" /></a>
  <a href="#manual-mcp"><img src="docs/readme/agents/devin-badge.svg" width="144" height="34" alt="Devin" /></a>
  <a href="#manual-mcp"><img src="docs/readme/agents/trae-badge.svg" width="144" height="34" alt="Trae CLI" /></a>
</p>

- <a id="deepseek-setup"></a>**DeepSeek TUI / Harness** · 安装 `openmotion-game` Skill，并通过 Cordis 配置连接本地 MCP 工具，或在仓库根目录运行 `node integrations/dsh/install.ts`。[DeepSeek Harness 配置指南](docs/agent-adapters.md#deepseek-harness)
- <a id="claude-setup"></a>**Claude Code** · 添加下方 stdio MCP 配置并安装 `openmotion-game` Skill，然后执行 `/mcp` 确认连接就绪。
- <a id="codex-setup"></a>**Codex CLI** · 在仓库根目录运行 `bash scripts/install-motion.command`，自动完成本地插件与 MCP 注册。
- <a id="workbuddy-setup"></a>**WorkBuddy** · 导入 Connector 或将下方 `mcp.json` 添加为自定义 MCP 服务。[WorkBuddy 接入说明](docs/agent-adapters.md#workbuddy)

<a id="manual-mcp"></a>

#### 通用手动 stdio MCP 配置（适用于所有支持 MCP 的客户端）

```json
{
  "mcpServers": {
    "openmotion": {
      "command": "/absolute/path/to/node",
      "args": ["--experimental-strip-types", "/absolute/path/to/opengame/mcp.ts"],
      "env": {
        "MOTION_DATA_DIR": "/absolute/path/to/opengame-data"
      }
    }
  }
}
```

> 请将 `MOTION_DATA_DIR` 指向仓库目录之外的绝对路径，确保你的游戏工程、生成素材和 API 密钥与仓库更新完全隔离。完整接入细节见 [部署与配置指南](docs/opengame-setup.md) · [系统架构说明](docs/opengame-architecture.md)。

### 12 个游戏专用 MCP 工具

OpenGame 通过本地 stdio MCP 暴露完整的游戏开发与测试工具集（沿用 `openmotion_game_*` 命名空间，确保所有既有宿主与适配器无缝兼容）：

| MCP 工具 | 用途 |
| --- | --- |
| `openmotion_game_create` | 创建新游戏草稿（支持 2D、内置 Three.js 的 3D，或 9:16 `playableAd` 试玩广告），返回完整 Agent 指令 |
| `openmotion_game_get` | 读取游戏卡片、当前生命周期状态与全部文件清单 |
| `openmotion_game_read_file` | 读取游戏工程内的任意源码或设计文档 |
| `openmotion_game_write_files` | 批量写入多个游戏源码与设计文件（单次最多 100 个文本文件 / 8 MiB） |
| `openmotion_game_update_meta` | 合并更新标题、简介、操控说明、封面路径及多语言翻译（如 `zh-CN`） |
| `openmotion_game_validate` | 校验 `index.html`、资源规范、确定性核心导出并执行 50-tick 逻辑冒烟测试 |
| `openmotion_game_simulate` | 无需浏览器运行三档有界确定性仿真（标准路线通关 / 弱操作受挫 / 挂机失败） |
| `openmotion_game_playtest` | 启动隔离无头 Chrome（1–4 客户端）验证真实操控、390×844 竖屏布局及控制台无报错 |
| `openmotion_game_capture_cover` | 直接截取纯游戏画布的 `1280×720` 高清 PNG 保存到 `assets/cover.png` |
| `openmotion_game_trailer` | 后台录制真实玩法片段并合成导出约 19 秒可编辑 MP4 宣传预告片 |
| `openmotion_game_set_status` | 更新游戏构建状态（`building`、`ready`、`failed`） |
| `openmotion_game_publish` | 重新校验并将游戏发布到本地 Game Studio 市场 |

配合 **`openmotion_media_use`**（查询已配置的 BYOK 多模态模型）与 **`openmotion_assets_use`**（生成图/音/视素材并调用 `action: "web_publish"` 一键发布在线试玩链接）。[完整 MCP 工具契约](docs/mcp-phase1-tools.md)

### 游戏工程 Skill 与 18 份专业手册

接入的 Agent 可直接读取 [`skills/openmotion-game/SKILL.md`](skills/openmotion-game/SKILL.md)（或通过 MCP Resource 读取 `openmotion://workflow/game/start`）以及 18 份游戏工程参考文档：

| 领域 | 参考手册 |
| --- | --- |
| **立项与玩法设计** | [需求简报标准](skills/openmotion-game/references/game-brief.md) · [类型与核心循环](skills/openmotion-game/references/game-genres.md) · [设计体系](skills/openmotion-game/references/game-design-system.md) · [参考拆解与盲区排查](skills/openmotion-game/references/game-lookup.md) |
| **3C 操控与打击感** | [3C 模块规范](skills/openmotion-game/references/game-3c-modules.md) · [手感与打磨细节](skills/openmotion-game/references/game-feel-craft.md) · [完整制作流](skills/openmotion-game/references/game-flow.md) |
| **美术、2D/3D 与音频** | [风格化指南](skills/openmotion-game/references/game-stylization.md) · [贴图规范](skills/openmotion-game/references/game-textures.md) · [2D 动画](skills/openmotion-game/references/game-2d-animation.md) · [3D 动画](skills/openmotion-game/references/game-3d-animation.md) · [程序化动效](skills/openmotion-game/references/game-procedural-animation.md) · [音频与 Web Audio](skills/openmotion-game/references/game-audio.md) |
| **试玩广告与质量门禁** | [试玩广告完整规范](skills/openmotion-game/references/game-playable-ad.md) · [分级质量门禁](skills/openmotion-game/references/game-gates.md) · [验收评分标准](skills/openmotion-game/references/review-rubric.md) |

### 技术栈与源码导航

| 层级 | 核心技术 | 源码入口 |
| --- | --- | --- |
| **OpenGame Studio 界面** | React 19, TypeScript 5.9, Vite 6, Tailwind CSS 4, Zustand | [GameStudio.tsx](studio/src/motion/game/GameStudio.tsx) · [gameCatalog.ts](studio/src/motion/game/gameCatalog.ts) |
| **游戏运行时与自动 QA** | Node.js, 原生 HTTP, Puppeteer Core / Chrome, 确定性仿真器 | [game-projects.ts](game-projects.ts) · [shared/game-contract.ts](shared/game-contract.ts) · [server.ts](server.ts) |
| **MCP 与游戏 Skill** | 本地 stdio MCP 服务、`opengame` 主入口 Skill、`openmotion-game` 工作流及 18 份手册 | [mcp.ts](mcp.ts) · [skills/opengame/SKILL.md](skills/opengame/SKILL.md) · [skills/openmotion-game/](skills/openmotion-game/) |
| **多模态 Model Gateway** | BYOK 模型发现、异步任务轮询、素材库与在线分享发布 | [gateway/service.ts](gateway/service.ts) · [gateway/catalog.ts](gateway/catalog.ts) · [docs/assets.md](docs/assets.md) |
| **内置游戏模板库** | 25 款独立可玩 HTML5 / Canvas / Three.js 工程与封面 | [templates/games/](templates/games/) |
| **实机预告片管线** | 无头实机录屏 + HTML 合成 + FFmpeg MP4 渲染 | [docs/usage.md](docs/usage.md) · [scripts/verify-export.ts](scripts/verify-export.ts) |

<a id="community"></a>

## 🤝 一起共建 OpenGame

欢迎贡献可玩游戏模板、热门小游戏复刻壳子、美术风格指南、微信/抖音/TikTok/itch.io 等平台上架打包脚本，以及 Game Studio 体验优化。

| 贡献方向 | 建议包含内容 |
| --- | --- |
| **可玩游戏模板** | 放在 `templates/games/<id>/` 下的完整独立目录，包含 `index.html`、`game.json`、`cover.webp` 与可选 `DESIGN.md` |
| **玩法与试玩广告配方** | 清晰的 3C 操控约定、数值平衡规则与验证说明 |
| **平台上架与打包适配器** | 面向微信小游戏、抖音小游戏、Web 门户的打包脚本与提交清单 |
| **Agent 与模型接入** | 更多本地 Agent 适配或 BYOK 多模态供应商集成 |

[贡献指南](CONTRIBUTING.zh-CN.md) · [仓库开发规范](AGENTS.md) · [提交 Issue](https://github.com/nexu-io/opengame/issues)

<a id="acknowledgements"></a>

## 🙏 开源致谢与版权声明

OpenGame 的诞生离不开开源游戏、创作工具与 AI Agent 社区的共同积累。

### 深度借鉴与核心开源底座

| 开源项目 | 许可证 | 借鉴与复用说明 |
| --- | --- | --- |
| **[Higgsfield AI Skills](https://github.com/higgsfield-ai/skills)** | MIT | [skills/openmotion-game/](skills/openmotion-game/) 中多份游戏美术与工程参考手册移植改编自该仓库（详见 [PROVENANCE.md](skills/openmotion-game/PROVENANCE.md) · [LICENSE-HIGGSFIELD](skills/openmotion-game/LICENSE-HIGGSFIELD)） |
| **[HeyGen Hyperframes](https://github.com/heygen-com/hyperframes)** | Apache-2.0 | Studio 编辑器前端底座（许可见 [studio/LICENSE](studio/LICENSE)）以及自动实机预告片合成与 MP4 渲染引擎 |
| **[DSH Game Studio](https://github.com/ZSeven-W/dsh-game-studio)** & **[dsh-games](https://github.com/finiking/dsh-games)**（作者 [@FiniYang](https://x.com/FiniYang)） | 开源 | 深度启发并参考了基于 DeepSeek Harness（DSH）的 AI 原生游戏创作工作坊、自动试玩与可玩游戏墙理念 |
| **[OpenDesign](https://github.com/nexu-io/open-design)** & **[OpenMotion](https://github.com/nexu-io/openmotion)** | Apache-2.0 | 同源开源底座，复用设计系统、多模态 Model Gateway、工作区架构与 MCP 工具契约 |
| **[Three.js](https://github.com/mrdoob/three.js)** | MIT | 内置离线 3D 渲染引擎与模型/骨骼加载模块，支撑 3D 模板与原创 3D 游戏（[LICENSE-three.txt](templates/game-kits/vendor/LICENSE-three.txt)） |
| **[KayKit Adventurers Character Pack](https://www.kaylousberg.com/)**（作者 Kay Lousberg） | CC0 | 内置离线带骨骼动画 3D 角色包（Mage 与 Knight），位于 [templates/game-kits/characters/](templates/game-kits/characters/)（[LICENSE-KayKit.txt](templates/game-kits/characters/LICENSE-KayKit.txt)） |
| **[Cocos Creator / Cocos Engine](https://github.com/cocos/cocos-engine)** | MIT | 支撑多款离线可玩小游戏模板的开源游戏引擎运行时 |
| **[Model Context Protocol (MCP) SDK](https://github.com/modelcontextprotocol/typescript-sdk)** & **[Vercel Skills CLI](https://github.com/vercel-labs/skills)** | MIT / Apache-2.0 | 支撑 22 个本地 AI Agent 标准化接入协议与轻量化 Skill 分发 |

同时感谢支撑本项目的底层开源生态：**Puppeteer & Chrome for Testing**、**FFmpeg**、**Dockview**、**CodeMirror 6**、**Lexical**、**React**、**Vite**、**Tailwind CSS**、**Zustand**、**Electron**、**GSAP**、**DiceBear**（Micah 头像风格，CC BY 4.0，[归属说明](studio/skill-cover-attribution.md)）及开源字体（**Albert Sans**、**IBM Plex Mono**、**Instrument Serif**，SIL OFL 1.1）。

### 社区游戏灵感与案例致谢

特别感谢以下在社区公开分享精彩 AI 游戏的创作者，我们在 Game Studio 灵感区以原帖外链形式致敬并展示他们的作品（点击任意图标直达原作者原帖）：

<p>
  <a href="https://x.com/felixrieseberg/status/2119925633564463609" title="Saltline by @felixrieseberg"><img src="studio/src/motion/game/community/saltline.jpg" width="56" height="56" alt="Saltline (@felixrieseberg)" /></a>
  <a href="https://x.com/Saccc_c/status/2109962425512734739" title="The Little Prince: Star Journey by @Saccc_c"><img src="studio/src/motion/game/community/little-prince.jpg" width="56" height="56" alt="The Little Prince: Star Journey (@Saccc_c)" /></a>
  <a href="https://x.com/Rubzem/status/2104253584737230926" title="Sky Reach by @jonesiller"><img src="studio/src/motion/game/community/sky-reach.jpg" width="56" height="56" alt="Sky Reach (@jonesiller)" /></a>
  <a href="https://x.com/edwinarbus/status/2102463453176979794" title="Antikythera Dive by @edwinarbus"><img src="studio/src/motion/game/community/shipwreck.jpg" width="56" height="56" alt="Antikythera Dive (@edwinarbus)" /></a>
  <a href="https://x.com/bridgemindai/status/2102451997395866021" title="Turbo Kart Rally by @bridgemindai"><img src="studio/src/motion/game/community/turbo-kart.jpg" width="56" height="56" alt="Turbo Kart Rally (@bridgemindai)" /></a>
  <a href="https://x.com/BubuStd/status/2102991290568954264" title="Voxel Musou by @BubuStd"><img src="studio/src/motion/game/community/voxel-musou.jpg" width="56" height="56" alt="Voxel Musou (@BubuStd)" /></a>
  <a href="https://x.com/ebbyamir/status/2120284261089673376" title="Starry Nightrider by @ebbyamir"><img src="studio/src/motion/game/community/starry-nightrider.jpg" width="56" height="56" alt="Starry Nightrider (@ebbyamir)" /></a>
  <a href="https://x.com/ViktorKav/status/2122647483281015155" title="Uno com Escada by @ViktorKav"><img src="studio/src/motion/game/community/uno-com-escada.jpg" width="56" height="56" alt="Uno com Escada (@ViktorKav)" /></a>
  <a href="https://x.com/kevin_t_ngo/status/2119868968307695818" title="What the Water Keeps by @kevin_t_ngo"><img src="studio/src/motion/game/community/what-the-water-keeps.jpg" width="56" height="56" alt="What the Water Keeps (@kevin_t_ngo)" /></a>
  <a href="https://x.com/kevin_t_ngo/status/2120238844754923874" title="Evensong by @kevin_t_ngo"><img src="studio/src/motion/game/community/evensong.jpg" width="56" height="56" alt="Evensong (@kevin_t_ngo)" /></a>
  <a href="https://x.com/mattshumer_/status/2119877065701036047" title="Mirror Earth by @mattshumer_"><img src="studio/src/motion/game/community/mirror-earth.jpg" width="56" height="56" alt="Mirror Earth (@mattshumer_)" /></a>
  <a href="https://x.com/photonstorm/status/2120330010112434313" title="Tennis (Go Wild) by @photonstorm"><img src="studio/src/motion/game/community/tennis-go-wild.jpg" width="56" height="56" alt="Tennis (Go Wild) (@photonstorm)" /></a>
  <a href="https://x.com/op7418/status/2120694045299327187" title="Mist-Locked Mountain Gate by @op7418"><img src="studio/src/motion/game/community/mist-locked-mountain-gate.jpg" width="56" height="56" alt="Mist-Locked Mountain Gate (@op7418)" /></a>
  <a href="https://x.com/__morse/status/2122013410309153042" title="omw: Castle Valley by @__morse"><img src="studio/src/motion/game/community/omw-castle-valley.jpg" width="56" height="56" alt="omw: Castle Valley (@__morse)" /></a>
  <a href="https://x.com/loktar00/status/2120192761542615271" title="LANTERNFALL by @loktar00"><img src="studio/src/motion/game/community/lanternfall.jpg" width="56" height="56" alt="LANTERNFALL (@loktar00)" /></a>
  <a href="https://x.com/Andrew_Blumson/status/2120599812512833557" title="MAAD MAXXING by @Andrew_Blumson"><img src="studio/src/motion/game/community/maad-maxxing.jpg" width="56" height="56" alt="MAAD MAXXING (@Andrew_Blumson)" /></a>
  <a href="https://x.com/kevin_t_ngo/status/2119900487688622171" title="Gilt &amp; Gutter by @kevin_t_ngo"><img src="studio/src/motion/game/community/gilt-and-gutter.jpg" width="56" height="56" alt="Gilt &amp; Gutter (@kevin_t_ngo)" /></a>
  <a href="https://x.com/xikhar/status/2122682962647122403" title="Papertrails by @xikhar"><img src="studio/src/motion/game/community/papertrails.jpg" width="56" height="56" alt="Papertrails (@xikhar)" /></a>
  <a href="https://x.com/AravSrinivas/status/2122338465648103676" title="VICE '86 by @AravSrinivas"><img src="studio/src/motion/game/community/vice-86.jpg" width="56" height="56" alt="VICE '86 (@AravSrinivas)" /></a>
  <a href="https://x.com/FuSheng_0306/status/2121237878097207583" title="Starfall by @FuSheng_0306"><img src="studio/src/motion/game/community/starfall-moba.jpg" width="56" height="56" alt="Starfall (@FuSheng_0306)" /></a>
  <a href="https://x.com/aniketjart/status/2121793239175119279" title="Goku: Four-Star Road by @aniketjart"><img src="studio/src/motion/game/community/goku-four-star-road.jpg" width="56" height="56" alt="Goku: Four-Star Road (@aniketjart)" /></a>
  <a href="https://x.com/noclipepe/status/2119728047754547326" title="Rug Racers by @noclipepe"><img src="studio/src/motion/game/community/rug-racers.jpg" width="56" height="56" alt="Rug Racers (@noclipepe)" /></a>
  <a href="https://x.com/noclipepe/status/2119927838321328577" title="Dino Run: Locked In by @noclipepe"><img src="studio/src/motion/game/community/rambo-dino.jpg" width="56" height="56" alt="Dino Run: Locked In (@noclipepe)" /></a>
  <a href="https://x.com/AravSrinivas/status/2122713692324384793" title="HADAL by @AravSrinivas"><img src="studio/src/motion/game/community/hadal.jpg" width="56" height="56" alt="HADAL (@AravSrinivas)" /></a>
  <a href="https://x.com/emollick/status/2119876449494540554" title="I Would Have Gotten Away With It by @emollick"><img src="studio/src/motion/game/community/i-would-have-gotten-away.jpg" width="56" height="56" alt="I Would Have Gotten Away With It (@emollick)" /></a>
  <a href="https://x.com/petergyang/status/2119901658394358005" title="Turbo Tails by @petergyang"><img src="studio/src/motion/game/community/turbo-tails.jpg" width="56" height="56" alt="Turbo Tails (@petergyang)" /></a>
</p>

> **版权声明**：上述社区作品仅作灵感展示与原页面跳转，不拷贝第三方源码，全部版权归原作者所有。如原作者希望调整署名、更新链接或移除展示，欢迎[提交 Issue](https://github.com/nexu-io/opengame/issues)，我们将第一时间处理。

## 贡献者

感谢每一位参与共建的开发者与创作者——代码、游戏模板、Skill、文档、反馈与 Issue。

<a href="https://github.com/nexu-io/opengame/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=nexu-io/opengame&amp;max=500&amp;columns=20&amp;anon=1" alt="OpenGame 贡献者" />
</a>

## Star History

<a href="https://www.star-history.com/#nexu-io/opengame&amp;Date">
  <picture>
    <source srcset="https://raw.githubusercontent.com/nexu-io/opengame/readme-charts/star-history.svg" />
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=nexu-io%2Fopengame&amp;type=Date&amp;theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=nexu-io%2Fopengame&amp;type=Date" />
    <img alt="OpenGame Star History" src="https://api.star-history.com/svg?repos=nexu-io%2Fopengame&amp;type=Date" />
  </picture>
</a>
