<p align="center"><img src="docs/readme/opengame-logo.svg" width="400" alt="OpenGame"></p>

<p align="center"><strong>世界初の Super Game Agent —— オープンソース・フルスタック AI ゲームスタジオ</strong></p>

<p align="center">
  <img src="docs/readme/opengame-hero.webp" width="100%" alt="OpenGame — 世界初の Super Game Agent。22種類のローカル AI Agent と25本の内蔵ゲームテンプレートから、3D・アニメ・ドット絵・9:16 縦型ミニゲームを制作・リミックス・検証・公開。">
</p>

<p align="center">
  <a href="docs/opengame-setup.md#prerequisites"><img src="docs/readme/badges/node.svg" alt="Node.js 26.11.1"></a>
  <a href="LICENSE"><img src="docs/readme/badges/license.ja.svg" alt="Apache 2.0 ライセンス"></a>
  <a href="https://github.com/nexu-io/open-design"><img src="docs/readme/badges/built-by-opendesign.ja.svg" alt="OpenDesign 開発"></a>
</p>

<p align="center">
  <a href="https://go.open-design.ai/?utm_source=github&amp;utm_medium=referral&amp;utm_campaign=opengame&amp;utm_content=readme_ja"><img src="docs/readme/badges/opendesign-go.svg" alt="OpenDesign Go モデルサブスクリプション" /></a>
  <a href="https://discord.com/invite/M7NnHS9gNa"><img src="docs/readme/badges/discord.svg" alt="OpenGame Discord コミュニティに参加" /></a>
  <a href="https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=b6cs46dc-acb2-48ed-941d-c45642ead841"><img src="docs/readme/badges/feishu.svg" alt="OpenGame Feishu グループに参加" /></a>
  <a href="https://x.com/OpenDesignHQ"><img src="docs/readme/badges/x-opendesignhq.svg" alt="OpenDesign 公式 X (@OpenDesignHQ)" /></a>
  <a href="https://x.com/OpenDesignDevs"><img src="docs/readme/badges/x-opendesigndevs.svg" alt="OpenDesign 開発者向け X (@OpenDesignDevs)" /></a>
  <a href="https://www.youtube.com/channel/UChtshixMhvtgBWzoD9R_Qfg"><img src="docs/readme/badges/youtube.svg" alt="OpenDesign YouTube チャンネル" /></a>
</p>

<p align="center"><a href="#quick-start">クイックスタート</a> · <a href="#agent-wall">対応 Agent</a> · <a href="#showcase">プレイ可能テンプレート</a> · <a href="#features">主な機能</a> · <a href="#publish-monetize">配信・収益化</a> · <a href="#technical-guide">セットアップ &amp; MCP</a> · <a href="#community">コミュニティ</a></p>

<div align="center">

[English](README.md) · [简体中文](README.zh-CN.md) · **日本語**

</div>

# OpenGame とは

OpenGame は**世界初のオープンソース・フルスタック Super Game Agent** です。**DeepSeek（DSH）**、**Claude Code**、**Codex** をはじめとする手元のローカルコーディング Agent を**オープンソースの AI 版 Unreal Engine / Unity** かつフルスタックのゲームスタジオへと変え、一言のアイデアから **AAA 級の 3D 大作**、さらには**収益化まで見据えたヒットミニゲーム**を一気通貫で生み出します。

- 🚀 **Agent で AAA 級の 3D ゲームを構築。** **DeepSeek（DSH）**・**Claude**・**Codex**・**Gemini** からコード・3D シーン・アート・BGM・ボイスを丸ごと駆動し、一言のプロンプトから遊べる 3D アクション・レース・オープンワールドを制作。
- 🎮 **あらゆるゲームをワンクリックでリミックス＆スタイル変換。** **25 本のプレイ可能な内蔵テンプレート**（3D・ボクセル・ドット絵・アニメ・9:16 ヒットミニゲーム／プレイアブル広告）を完全オープンソースで搭載し、検証済みゲームループのまま数分で画風や世界観を刷新。
- 💰 **稼げるゲームを届ける：制作 → 検証 → 配信・収益化。** ロジック検証・バランスシミュレーション・実機プレイテスト・カバー撮影・トレーラー録画まで自動化し、Web 共有リンクや単一ファイル **9:16 プレイアブル広告**、**WeChat ミニゲーム / TikTok / Douyin** 向けの配信・収益化パスへ接続。
- 🔓 **フルスタック・オープンソース（BYOA + BYOK）。** コード・アート・映像・BGM・ボイス・効果音・Three.js 3D まですべてオープンソース。普段お使いの [ローカル Agent](#agent-wall) と API キー、または [OpenDesign Go](https://go.open-design.ai/?utm_source=github&utm_medium=referral&utm_campaign=opengame&utm_content=readme_ja)（ブラックフライデー期間中は最安割引・**DeepSeek V4.1 Flash** や **Seedream** などのモデルが無料）にすぐ接続できます。

<a id="quick-start"></a> <a id="クイックスタート"></a>

## ⚡ クイックスタート

### 1. ローカル Agent に一言送るだけ

以下のプロンプトを **DeepSeek TUI / Harness**、**Claude Code**、**Codex**、**WorkBuddy**、**Cursor**、**Gemini CLI**、または [対応する 22 種類のローカル Agent](#agent-wall) にそのまま貼り付けてください：

```text
https://github.com/nexu-io/opengame/blob/main/docs/opengame-setup.md に従って、この Agent に OpenGame を接続し、Game Studio のテンプレート一覧を開いてください。
```

### 2. Skills CLI で OpenGame メイン Skill をインストール

[Skills CLI](https://github.com/vercel-labs/skills) を使って、OpenGame メインエントリー Skill（`opengame`：ローカル接続を案内し、`openmotion-game` および 3C 操作感・2D/3D アニメーション・プレイアブル広告仕様・品質ゲートを網羅した 18 冊のエンジニアリングハンドブックへルーティング）を導入できます：

```sh
npx skills add https://github.com/nexu-io/opengame/tree/skills --skill opengame
```

> Skills CLI はワークフロー指針を Agent に導入します（必要に応じて `--skill openmotion-game` 単体も導入可能）。12 個の `openmotion_game_*` ツール呼び出しや Game Studio 連携を行うには、以下のローカル起動と MCP 設定もあわせて完了してください。

### 3. ソースからローカルで OpenGame Studio を起動

必要環境：**Git**、**Git LFS**、**npm**、**Node.js 26.11.1**（CI と同じバージョン）。起動後すぐにカタログを閲覧でき、初めてプレイまたは Remix する際に選んだテンプレートの素材を取得します。Tidebreaker はオフラインで遊べます。

```sh
git -c filter.lfs.process= -c filter.lfs.smudge= -c filter.lfs.required=false clone --depth 1 --single-branch --branch main https://github.com/nexu-io/opengame.git
cd opengame
git lfs install --local --skip-smudge
npm ci
npm run build:studio
npm start
```

<a id="agent-wall"></a>

**22 種類のローカル Agent に対応（BYOA）** · [お使いの Agent を選ぶ](#choose-agent)

<p align="center"><a href="#choose-agent"><picture><source media="(max-width: 600px)" srcset="docs/readme/agents/local-agents.mobile.png"><img src="docs/readme/agents/local-agents.png" width="100%" alt="WorkBuddy, Codex CLI, Claude Code, OpenCode, Hermes, Antigravity, Gemini CLI, Grok Build, Kimi CLI, Cursor Agent, Qwen Code, Qoder CLI, GitHub Copilot, Pi, Kiro CLI, Kilo, Mistral Vibe, DeepSeek TUI, Reasonix, Aider, Devin, Trae CLI"></picture></a></p>

<a id="showcase"></a>

## 🕹️ 内蔵プレイ可能ゲームテンプレート & ショーケース

OpenGame は [`templates/games/`](templates/games/) に**すぐ遊べる 25 本の完全なゲームプロジェクト**を標準搭載しています。すべて HTML5 / Three.js ソースコード、カバーアート、操作ガイド、多言語メタデータ付き。Game Studio 上でそのまま試遊し、ワンクリックで **Remix**、あるいは**世界観・アートスタイル・キャラクターを丸ごと差し替えて**自分だけの作品にできます。

### 3D・ボクセル・アクションゲーム（16:9 横画面）

<table width="100%">
<tr>
<td width="50%" valign="top">
<img src="templates/games/tidebreaker/cover.webp" width="100%" alt="Tidebreaker — 嵐の群島 3D スピードボートレース"><br>
<strong>Tidebreaker（タイドブレイカー）</strong> · <code>3D · レーシング · Three.js</code><br>
嵐の群島をスピードボートで駆け抜け、波頭をジャンプしながら暗礁をかわし、8つのチェックポイントを制覇する 3D レース。<br>
<a href="templates/games/tidebreaker/">ソース &amp; DESIGN.md を見る →</a>
</td>
<td width="50%" valign="top">
<img src="templates/games/starlight-bastion/cover.webp" width="100%" alt="Starlight Bastion — ボクセル宇宙クリスタル防衛シューター"><br>
<strong>Starlight Bastion（スターライト・バスティオン）</strong> · <code>ボクセル · シューター · 強化</code><br>
5ウェーブにわたり押し寄せるボクセル侵略者から光のクリスタルを防衛し、ウェーブ間でローグライト強化を選択。<br>
<a href="templates/games/starlight-bastion/">ソース &amp; DESIGN.md を見る →</a>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="templates/games/skyline-courier/cover.webp" width="100%" alt="Skyline Courier — 3D サイバーパンク屋上パルクール"><br>
<strong>Skyline Courier（スカイライン・クーリエ）</strong> · <code>3D · パルクール · サイバーパンク</code><br>
雨に濡れたサイバーパンクの高層ビル群を疾走・壁キックし、制限時間90秒以内に3つの荷物を届け切るアクション。<br>
<a href="templates/games/skyline-courier/">ソース &amp; DESIGN.md を見る →</a>
</td>
<td width="50%" valign="top">
<img src="templates/games/neon-drift/cover.webp" width="100%" alt="Neon Drift — 3D シンセウェーブ夜間ハイウェイレース"><br>
<strong>Neon Drift（ネオン・ドリフト）</strong> · <code>3D · レーシング · サイバーパンク</code><br>
雨夜のネオン高速道路で車両をすり抜け、ニアミス連鎖でブーストを溜めて最長走行距離を狙う 3D ドリフト。<br>
<a href="templates/games/neon-drift/">ソースを見る →</a>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="templates/games/comet-guard/cover.webp" width="100%" alt="Comet Guard — 軌道防衛スペースシューター"><br>
<strong>Comet Guard（コメット・ガード）</strong> · <code>シューター · 宇宙</code><br>
星海を駆ける軌道迎撃機を操り、灼熱の彗星群を撃砕しながらステーションを守り抜くスペースシューター。<br>
<a href="templates/games/comet-guard/">ソースを見る →</a>
</td>
<td width="50%" valign="top">
<img src="templates/games/harbor-skirmish/cover.webp" width="100%" alt="Harbor Skirmish — 3D 一人称アイランド FPS"><br>
<strong>Harbor Skirmish（ハーバー・スカーミッシュ）</strong> · <code>3D FPS · グラップル &amp; スライド</code><br>
二段ジャンプ・スライディング・ダッシュ・グラップリングフックを駆使して戦うスタイライズド 3D FPS。<br>
<a href="templates/games/harbor-skirmish/">ソースを見る →</a>
</td>
</tr>
</table>

### アニメ・ドット絵・物語・ホラーゲーム（16:9 横画面）

<table width="100%">
<tr>
<td width="50%" valign="top">
<img src="templates/games/glyph-garden/cover.webp" width="100%" alt="Glyph Garden — アニメ調ファンタジー マッチ3パズル"><br>
<strong>Glyph Garden（グリフ・ガーデン）</strong> · <code>アニメ · パズル · ファンタジー</code><br>
月夜の花びらを入れ替えて連鎖コンボを咲かせ、24手以内に 2,200 点を目指す幻想的なマッチ3パズル。<br>
<a href="templates/games/glyph-garden/">ソースを見る →</a>
</td>
<td width="50%" valign="top">
<img src="templates/games/lantern-hop/cover.webp" width="100%" alt="Lantern Hop — ドット絵キツネの月夜屋根ランナー"><br>
<strong>Lantern Hop（ランタン・ホップ）</strong> · <code>ドット絵 · プラットフォーマー · ファンタジー</code><br>
マフラーを巻いたドット絵のキツネが月夜の屋根を二段ジャンプで駆け抜け、提灯を集めるエンドレスランナー。<br>
<a href="templates/games/lantern-hop/">ソースを見る →</a>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="templates/games/lighthouse-log/cover.webp" width="100%" alt="Lighthouse Log — 嵐の灯台サバイバル物語"><br>
<strong>Lighthouse Log（灯台日誌）</strong> · <code>アニメ · ビジュアルノベル · サバイバル</code><br>
7日間の嵐の夜、燃料をやりくりし苦渋の無線判断を下しながら海辺の灯台の灯を守り抜く物語サバイバル。<br>
<a href="templates/games/lighthouse-log/">ソースを見る →</a>
</td>
<td width="50%" valign="top">
<img src="templates/games/last-light/cover.webp" width="100%" alt="Last Light — 懐中電灯ホラー脱出"><br>
<strong>Last Light（ラスト・ライト）</strong> · <code>ホラー · アトモスフィア</code><br>
電池が尽きる前に廃校から3本の鍵を探し出し、迫りくる影を懐中電灯の光で封じながら脱出するホラーゲーム。<br>
<a href="templates/games/last-light/">ソースを見る →</a>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="templates/games/night-train/cover.webp" width="100%" alt="Night Train Letters — 雨夜の海行き列車 分岐ノベル"><br>
<strong>Night Train Letters（夜行列車の手紙）</strong> · <code>ビジュアルノベル · 分岐ストーリー</code><br>
雨夜の海へ向かう列車で綴られる3通の届かぬ手紙。ピュア HTML で描く繊細なインタラクティブ分岐ノベル。<br>
<a href="templates/games/night-train/">ソースを見る →</a>
</td>
<td width="50%" valign="top">
<img src="templates/games/stack-the-moon/cover.webp" width="100%" alt="Stack the Moon — ワンタップ月夜タワー積み上げ"><br>
<strong>Stack the Moon（スタック・ザ・ムーン）</strong> · <code>カジュアル · ワンタップ</code><br>
雲海の上に月夜の天文台を一段ずつ積み上げるワンタップアーケード。パーフェクト連続で足場が広がります。<br>
<a href="templates/games/stack-the-moon/">ソースを見る →</a>
</td>
</tr>
</table>

### 縦型ヒットミニゲーム & プレイアブル広告（9:16 縦画面）

スマホの片手操作・ファーストフレーム即プレイ・短時間高リテンション設計で、**ミニゲーム配信とプレイアブル広告（Playable Ad）の収益化**に最適化されています：

<table width="100%">
<tr>
<td width="50%" valign="top">
<img src="templates/games/gate-legion/cover.webp" width="100%" alt="Gate Legion — 9:16 算数ゲート軍団ランナー"><br>
<strong>Gate Legion</strong> · <code>9:16 · ゲートランナー</code><br>
<code>+10</code> / <code>×2</code> ゲートで軍勢を増殖させ、終点のボス軍団と激突する王道縦型ランナー。<br>
<a href="templates/games/gate-legion/">ソース →</a>
</td>
<td width="50%" valign="top">
<img src="templates/games/pin-rescue/cover.webp" width="100%" alt="Pin Rescue — 9:16 ピン抜きパズル"><br>
<strong>Pin Rescue</strong> · <code>9:16 · ピン抜きパズル</code><br>
ピンを抜いて水と溶岩を石に変え、罠を避けながら5ステージで黄金を届ける物理パズル。<br>
<a href="templates/games/pin-rescue/">ソース →</a>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="templates/games/sky-runner/cover.webp" width="100%" alt="Sky Runner — 9:16 3D ネオンホバーボードランナー"><br>
<strong>Sky Runner</strong> · <code>9:16 · 3D レーンランナー</code><br>
スワイプでレーンを切り替え、コイン回収とドローン回避を決めながら加速するネオン空中ラン。<br>
<a href="templates/games/sky-runner/">ソース →</a>
</td>
<td width="50%" valign="top">
<img src="templates/games/slime-swell/cover.webp" width="100%" alt="Slime Swell — 9:16 街飲み込み成長アリーナ"><br>
<strong>Slime Swell</strong> · <code>9:16 · 捕食成長 .io</code><br>
街のオブジェクトを飲み込んでビルより大きく成長し、60秒間で3体のライバルを圧倒。<br>
<a href="templates/games/slime-swell/">ソース →</a>
</td>
</tr>
</table>

<details>
<summary><strong>全 25 本の内蔵プレイ可能テンプレート一覧を開く</strong></summary>

| ゲーム名 | ジャンル | スタイル | 画面比率 | 概要 | ソース |
| --- | --- | --- | --- | --- | --- |
| **Castle Crush** | カジュアル | アニメ | 9:16 縦画面 | 木材と石造りの4つの砦を崩す物理スリングショット攻城戦 | [castle-crush](templates/games/castle-crush/) |
| **Comet Guard** | シューター | ミニマル | 16:9 横画面 | 灼熱の彗星群から宇宙ステーションを守る軌道迎撃シューター | [comet-guard](templates/games/comet-guard/) |
| **Drift Dash** | レーシング | ボクセル | 9:16 縦画面 | 片手親指で操作するレトロサーキット・ドリフトレース（AI3台対戦） | [drift-dash](templates/games/drift-dash/) |
| **Gate Legion** | カジュアル | ドット絵 | 9:16 縦画面 | 算数ゲートで軍勢を増やしてボス軍団と戦うヒット系ランナー | [gate-legion](templates/games/gate-legion/) |
| **Glyph Garden** | カジュアル | アニメ | 16:9 横画面 | 連鎖コンボが爽快なファンタジー調マッチ3パズル | [glyph-garden](templates/games/glyph-garden/) |
| **Harbor Skirmish** | シューター | 3D | 16:9 横画面 | 二段ジャンプ・スライディング・グラップルを備えた 3D FPS | [harbor-skirmish](templates/games/harbor-skirmish/) |
| **Jingyang Ridge** | カジュアル | アニメ | 16:9 横画面 | 予備動作を見切り回避・反撃を決める水墨武侠ボス戦 | [jingyang-ridge](templates/games/jingyang-ridge/) |
| **Lane Turret** | シューター | ドット絵 | 9:16 縦画面 | 強化カード選択付きの自動砲台ウェーブ防衛 | [lane-turret](templates/games/lane-turret/) |
| **Lantern Hop** | プラットフォーマー | ドット絵 | 16:9 横画面 | 月夜の屋根を駆けるキツネの二段ジャンプ・エンドレスランナー | [lantern-hop](templates/games/lantern-hop/) |
| **Last Light** | ホラー | ミニマル | 16:9 横画面 | 懐中電灯の光だけで廃校から脱出するサバイバルホラー | [last-light](templates/games/last-light/) |
| **Lighthouse Log** | ビジュアルノベル | アニメ | 16:9 横画面 | 嵐の7日間を燃料管理と無線選択で生き抜く物語サバイバル | [lighthouse-log](templates/games/lighthouse-log/) |
| **Merge Bakery** | カジュアル | アニメ | 9:16 縦画面 | 焼成・マージ・時間制限オーダーをこなすベーカリーパズル | [merge-bakery](templates/games/merge-bakery/) |
| **Neon Drift** | レーシング | 3D | 16:9 横画面 | 雨夜のシンセウェーブ高速道路をすり抜けるブーストレーシング | [neon-drift](templates/games/neon-drift/) |
| **Night Train Letters** | ビジュアルノベル | ミニマル | 16:9 横画面 | 夜行列車で3通の届かぬ手紙を辿る分岐ナラティブ | [night-train](templates/games/night-train/) |
| **Periscope Depth** | シューター | ミニマル | 16:9 横画面 | 潜望鏡で艦隊を魚雷攻撃し爆雷を回避する潜水艦アクション | [periscope-depth](templates/games/periscope-depth/) |
| **Pin Rescue** | カジュアル | ミニマル | 9:16 縦画面 | 溶岩・水・黄金を操る王道ピン抜き物理パズル | [pin-rescue](templates/games/pin-rescue/) |
| **Rooftop Roast** | カジュアル | ミニマル | 16:9 横画面 | `SHOP` 定数を書き換えるだけでブランド差し替え可能なカフェ販促ゲーム | [rooftop-roast](templates/games/rooftop-roast/) |
| **Sky Runner** | レーシング | 3D | 9:16 縦画面 | コイン収集＆ブーストで駆けるサイバーパンク 3D ホバーボードランナー | [sky-runner](templates/games/sky-runner/) |
| **Skyline Courier** | プラットフォーマー | 3D | 16:9 横画面 | 90秒以内に高層ビルの屋上を駆け抜ける 3D パルクール | [skyline-courier](templates/games/skyline-courier/) |
| **Slime Swell** | カジュアル | ミニマル | 9:16 縦画面 | 街ごと飲み込んでライバルと競う 60 秒成長アリーナ | [slime-swell](templates/games/slime-swell/) |
| **Sort Stack** | カジュアル | ミニマル | 9:16 縦画面 | Undo 対応・全5ステージのカラーリング仕分けパズル | [sort-stack](templates/games/sort-stack/) |
| **Stack the Moon** | カジュアル | ミニマル | 16:9 横画面 | 月夜の天文台を積み上げるワンタップ・タイミングゲーム | [stack-the-moon](templates/games/stack-the-moon/) |
| **Starlight Bastion** | シューター | ボクセル | 16:9 横画面 | ローグライト強化付き・全5ウェーブのクリスタル防衛戦 | [starlight-bastion](templates/games/starlight-bastion/) |
| **Tidebreaker** | レーシング | 3D | 16:9 横画面 | 嵐の群島で波を跳ね越える 3D スピードボートレース | [tidebreaker](templates/games/tidebreaker/) |
| **Tilt Temple** | カジュアル | 3D | 9:16 縦画面 | 浮遊迷宮を傾けて鍵を取りポータルへ導く 3D 傾きパズル | [tilt-temple](templates/games/tilt-temple/) |

</details>

<a id="features"></a>

## ✨ 主な機能

### 1. ワンクリック・リミックス & スタイル変換（Game-as-Code）

白紙のプロンプトから完成度の高いゲームをゼロから作るのは、最先端モデルにとっても難題です。OpenGame は**検証済みのゲームエンジニアリング基盤**と**世界観・アート・演出コンテンツ**を分離することでこの壁を突破します：

- **すべてが透明で編集可能なソースコード**：`index.html`、決定論的ロジック `logic.js`、3D 向け内蔵 Three.js、さらに構造化設計ドキュメント（`design/plan.md`、`design/style.md`、`design/assets.csv`、`design/verification.md`）で構成されます。
- **ワンクリックでリミックス**：Game Studio で 25 本のテンプレートから **Remix** を押す（または Agent に指示する）だけで、操作系・パラメータ調整・自動テストフックまで整った編集用ドラフトを即座に複製できます。
- **あらゆる世界観へスタイル変換**：物理挙動や勝敗ルールを壊さず、題材・キャラクター・配色・スプライト・テクスチャ・BGM を差し替え可能。**DeepSeek** などの高コスパモデルで高速イテレーションを回すのも、**Claude Fable 5.2 / Opus / Codex / Gemini** で本格的な 3D オリジナル作品に挑むのも自由です。

**接続済みの Agent でそのまま試せるプロンプト例：**

```text
# 1. ワンクリック・リミックス & スタイル変換（DeepSeek 等の高速モデルに最適）
openmotion-game を使って「Lantern Hop」テンプレートをサイバーパンク雨夜都市のロボット猫ランナーにリミックスしてください。二段ジャンプ物理とエンドレススコア設計は維持し、キツネと提灯をネオン猫とホロバッテリーに差し替え、新規キーアートとシンセウェーブ BGM を生成したうえで、検証・プレイテスト・新カバー撮影まで完了してください。
```

```text
# 2. モバイル広告向け 9:16 プレイアブル広告を制作
openmotion-game を使って中世タワーディフェンス向けの縦型 9:16 プレイアブル広告（playableAd: true）を作成してください。ファーストフレーム即操作＋指アイコン誘導、25秒間の段階ウェーブ戦、最後に App Store / Google Play への CTA エンドカードを備え、検証・シミュレーション・390x844 プレイテストを経て単一 HTML にバンドルしてください。
```

```text
# 3. ゼロから 3D オリジナルゲームを制作（Claude Fable 5.2 / Opus / Codex / Gemini 推奨）
openmotion-game を使って、霧深い夕暮れの竹林の崖を舞台にした 3D 武侠ボス決闘ゲーム（style: "3d"）をゼロから制作してください。パリィ判定、回避無敵フレーム、スタミナ管理、ボス2段階フェーズを実装し、3段階シミュレーション・ヘッドレス Chrome プレイテスト・1280x720 カバー撮影・ゲームプレイトレーラー録画まで実行してください。
```

<a id="model-wall"></a>

### 2. フルスタック・マルチモーダル素材生成（BYOK）

本格的なゲームにはコードだけでなく、キーアート、立ち絵・スプライト、シームレス 3D テクスチャ、BGM ループ、キャラクターボイス、効果音が必要です。OpenGame の **Model Gateway** はマルチモーダル生成をゲーム制作パイプラインへ直接統合しつつ、API キーをローカル環境内に安全に分離します。

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

| ゲーム素材レイヤー | 推奨モデル（Model Gateway 設定時に自動検出） | API キー不要の標準フォールバック |
| --- | --- | --- |
| **🖼️ キーアート・立ち絵・スプライト・テクスチャ** | `GPT Image 2.6`（編集・透過 PNG 対応）、`Seedream 5.5` / `5.0 Flash`、`Nano Banana 2`、`FLUX`、`Codex Image` | 高精細プロシージャル Canvas/SVG スプライト & テクスチャ |
| **🎵 BGM（メニュー・ステージ・ボス戦）** | `ElevenLabs Music v2`（`no vocals` ループ）、`Suno v4` | Web Audio API によるリアルタイム合成サウンドトラック |
| **🎙️ キャラクターボイス & ナレーション** | `ElevenLabs v3`（多言語対応）、`BytePlus TTS 2`、`Kokoro` | スタイル付き会話ウィンドウ & 字幕 UI |
| **🎬 オープニング演出 & モーション映像** | `Wan 2.7`、`Seedance 2.5`（短尺 I2V クリップ） | エンジン内カメラワーク & タイトル演出 |
| **🔊 効果音（打撃・ジャンプ・コイン・UI）** | ゲームコード内で Web Audio API により直接合成 | 同左（ゼロ遅延・外部ファイル不要） |
| **🧊 3D シーン & モデル** | 内蔵 **Three.js** + CC0 キット + 3D ゲートウェイ拡張スロット（接続時自動検出） | Three.js プロシージャル造形・ライティング・シェーダー |

> ローカルのオープンソース基盤自体にソフトウェア利用料はかかりません。**Model Settings** で手持ちの API キーを設定するか、[OpenDesign Go](https://go.open-design.ai/?utm_source=github&utm_medium=referral&utm_campaign=opengame&utm_content=readme_ja) に接続して複数モデルをまとめて利用でき、API コストゼロの純コード生成ゲームも制作可能です。[モデル一覧](gateway/catalog.ts) · [プロバイダー設定ガイド](docs/model-gateway.md)

### 3. 自動ゲーム QA・3 段階バランスシミュレーション & 自動トレーラー録画

「コードを出して動くことを祈る」時代は終わりです。OpenGame はゲームを **ready** と判定する前に、完全自動の検証ループを実行します：

1. **静的検査 & 50-Tick ロジック検証（`openmotion_game_validate`）** — `index.html`、許可アセット/CDN ポリシー、決定論的エクスポートを検証し、50-tick スモークテスト（1 tick あたり `< 5 ms`）を実行。
2. **3 段階決定論バランスシミュレーション（`openmotion_game_simulate`）** — ブラウザ不要の高速シミュレーションで、熟練ルート（`reference`）が勝利条件に到達すること、低熟練ルートが苦戦すること、無操作（`idle`）が `< 2500` tick 以内に適切に敗北することを検証。
3. **ヘッドレス Chromium 実操作プレイテスト（`openmotion_game_playtest`）** — 1〜4 クライアントで実際のキーボード／マウス／タッチ操作を実行し、3C 応答性、`390×844` モバイル画面崩れの有無、メディア読み込み、コンソール＆通信エラーゼロを確認。
4. **ゲームキャンバス専用カバー撮影（`openmotion_game_capture_cover`）** — 隔離されたヘッドレス Chrome 上でゲームキャンバスから直接 `1280×720` PNG カバーを自動撮影。
5. **自動ゲームプレイトレーラー生成（`openmotion_game_trailer`）** — 実機ヘッドレス操作から `1280×720` の 5 秒ハイライトを 3 本録画し、タイトル＋ハイライト＋Play Now 構成の編集可能な約 19 秒 MP4 トレーラーを書き出し。

<a id="publish-monetize"></a>

## 🚀 配信から収益化までのエンドツーエンド経路

プレイ可能なプロトタイプを、そのまま共有・配信・収益化できる完成品へとつなげます。

| ステージ | 現在利用可能 | ロードマップ（開発中） |
| --- | --- | --- |
| **ローカルカタログ & 試遊** | ローカルの OpenGame Studio カタログへ即時公開（`openmotion_game_publish`）。プレイ回数記録・お気に入り・ワンクリック Remix 対応 | ジャンル別・収益モデル別に厳選した **Top 100 収益化ミニゲームテンプレート** |
| **ワンクリック Web 公開** | OpenDesign Cloud 経由で静的バンドル化＆公開リンク発行（`openmotion_assets_use action="web_publish"`）。ローカル素材 URL の自動書換・圧縮対応 | カスタムドメイン＆埋め込み用ゲームウィジェットカード |
| **モバイル・プレイアブル広告** | **9:16 プレイアブル広告モード**（`playableAd: true`）標準搭載：初手即プレイ・指チュートリアル・短尺ループ・単一インライン HTML・App Store / Google Play CTA カード | 主要アドネットワーク向け自動パッケージプリセット（AppLovin / Unity Ads / Meta / TikTok） |
| **ミニゲームプラットフォーム & 収益化** | そのまま各プラットフォームへラップ可能な自己完結型 HTML5/JS プロジェクト出力、および宣伝用の自動録画 MP4 トレーラー | **L1–L4 ガイド付きストア公開支援**（パッケージスクリプト・審査チェックリスト・Skill）：**WeChat ミニゲーム**、**Douyin ミニゲーム**、**TikTok**、**itch.io / Poki / CrazyGames** |
| **AI ゲームアリーナ** | ローカル単人プレイおよび既存のルーム型プレイテスト | **マルチモデル対戦アリーナ** — 複数の最先端 LLM 同士をリアルタイムのゲーム内で直接対決 |

<a id="technical-guide"></a>

## 🛠️ セットアップ & MCP ツール

<a id="agent-setup"></a> <a id="choose-agent"></a>

### ローカル Agent の接続

お使いの Agent を選んでローカル OpenGame MCP サーバーと Skill を接続してください：

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

- <a id="deepseek-setup"></a>**DeepSeek TUI / Harness** · `openmotion-game` Skill を導入し、Cordis 設定でローカル MCP を接続するか、リポジトリ直下で `node integrations/dsh/install.ts` を実行します。[DeepSeek Harness ガイド](docs/agent-adapters.md#deepseek-harness)
- <a id="claude-setup"></a>**Claude Code** · 下記の stdio MCP 設定を追加し、`openmotion-game` Skill をインストールしたあと `/mcp` でツール接続を確認します。
- <a id="codex-setup"></a>**Codex CLI** · リポジトリ直下で `bash scripts/install-motion.command` を実行すると、ローカルプラグインと MCP サーバーが自動登録されます。
- <a id="workbuddy-setup"></a>**WorkBuddy** · コネクタをインポートするか、下記の `mcp.json` 設定を貼り付けます。[WorkBuddy ガイド](docs/agent-adapters.md#workbuddy)

<a id="manual-mcp"></a>

#### 手動 stdio MCP 設定（あらゆる MCP クライアント共通）

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

> 制作したゲーム、生成アセット、API キーをリポジトリ更新から安全に分離するため、`MOTION_DATA_DIR` は Git チェックアウト外のパスに配置してください。詳細は [セットアップガイド](docs/opengame-setup.md) · [アーキテクチャ解説](docs/opengame-architecture.md) をご覧ください。

### 12 個のゲーム専用 MCP ツール

OpenGame はローカル stdio MCP 経由で完全なゲーム開発ツール群を提供します（既存ホストやアダプターとの 100% 互換性を保つため `openmotion_game_*` 名前空間を使用）：

| MCP ツール | 役割 |
| --- | --- |
| `openmotion_game_create` | 新規ゲームドラフト（2D、Three.js 内蔵 3D、または 9:16 `playableAd`）を作成し完全な開発ブリーフを返却 |
| `openmotion_game_get` | ゲームカード・ライフサイクル状態・全ファイル一覧を取得 |
| `openmotion_game_read_file` | ゲームプロジェクト内の任意のソースコード・設計書を読み込み |
| `openmotion_game_write_files` | ゲームソースと設計ファイルを一括書き込み（1 ゲームあたり最大 100 テキストファイル / 8 MiB） |
| `openmotion_game_update_meta` | タイトル・説明・操作ガイド・カバー画像・多言語メタデータを更新 |
| `openmotion_game_validate` | `index.html`・CDN ポリシー・決定論的ロジック出力を検証し 50-tick スモークテストを実行 |
| `openmotion_game_simulate` | 3 段階決定論的ヘッドレスシミュレーション（`reference` 勝利 / 低熟練 / `idle` 敗北）を実行 |
| `openmotion_game_playtest` | 隔離ヘッドレス Chrome（1〜4 クライアント）を起動し実入力・`390×844` レイアウト・コンソール健全性を検証 |
| `openmotion_game_capture_cover` | ゲームキャンバスから `1280×720` PNG カバー画像を `assets/cover.png` へ自動撮影 |
| `openmotion_game_trailer` | 実機ヘッドレス操作クリップを録画し編集可能な約 19 秒 MP4 トレーラーを書き出し |
| `openmotion_game_set_status` | プロジェクトのライフサイクル状態（`building` / `ready` / `failed`）を遷移 |
| `openmotion_game_publish` | 再検証のうえローカル Game Studio カタログへ公開 |

あわせて **`openmotion_media_use`**（設定済み BYOK マルチモーダルモデルの検出・照会）と **`openmotion_assets_use`**（画像・音楽・音声・動画生成および `action: "web_publish"` によるワンクリック Web 公開）も利用可能です。[MCP 契約仕様](docs/mcp-phase1-tools.md)

### ゲーム開発 Skill & 18 冊のエンジニアリングハンドブック

接続されたすべての Agent は [`skills/openmotion-game/SKILL.md`](skills/openmotion-game/SKILL.md)（MCP リソース経由では `openmotion://workflow/game/start`）および 18 冊の専門ハンドブックを参照できます：

| 領域 | リファレンスガイド |
| --- | --- |
| **ゲーム設計・構造** | [Brief Standard](skills/openmotion-game/references/game-brief.md) · [Genres & Core Loops](skills/openmotion-game/references/game-genres.md) · [Design System](skills/openmotion-game/references/game-design-system.md) · [Reference Lookup](skills/openmotion-game/references/game-lookup.md) |
| **3C・操作感・ゲームフィール** | [3C Modules](skills/openmotion-game/references/game-3c-modules.md) · [Game Feel & Craft](skills/openmotion-game/references/game-feel-craft.md) · [Production Flow](skills/openmotion-game/references/game-flow.md) |
| **ビジュアル・2D/3D・オーディオ** | [Stylization](skills/openmotion-game/references/game-stylization.md) · [Textures](skills/openmotion-game/references/game-textures.md) · [2D Animation](skills/openmotion-game/references/game-2d-animation.md) · [3D Animation](skills/openmotion-game/references/game-3d-animation.md) · [Procedural Motion](skills/openmotion-game/references/game-procedural-animation.md) · [Audio & Web Audio](skills/openmotion-game/references/game-audio.md) |
| **プレイアブル広告 & 品質ゲート** | [Playable Ad Spec](skills/openmotion-game/references/game-playable-ad.md) · [Quality Gates](skills/openmotion-game/references/game-gates.md) · [Review Rubric](skills/openmotion-game/references/review-rubric.md) |

### 技術スタック & ソースコード構成

| レイヤー | 技術 | エントリーポイント |
| --- | --- | --- |
| **OpenGame Studio UI** | React 19, TypeScript 5.9, Vite 6, Tailwind CSS 4, Zustand | [GameStudio.tsx](studio/src/motion/game/GameStudio.tsx) · [gameCatalog.ts](studio/src/motion/game/gameCatalog.ts) |
| **ゲーム実行基盤 & 自動 QA** | Node.js, ネイティブ HTTP, Puppeteer Core / Chrome, 決定論シミュレーター | [game-projects.ts](game-projects.ts) · [shared/game-contract.ts](shared/game-contract.ts) · [server.ts](server.ts) |
| **MCP & ゲーム Skill** | ローカル stdio MCP サーバー、`opengame` メイン Skill、`openmotion-game` & 18 冊のハンドブック | [mcp.ts](mcp.ts) · [skills/opengame/SKILL.md](skills/opengame/SKILL.md) · [skills/openmotion-game/](skills/openmotion-game/) |
| **マルチモーダル Gateway** | BYOK モデル検出・非同期ジョブ管理・アセットライブラリ & Web 公開 | [gateway/service.ts](gateway/service.ts) · [gateway/catalog.ts](gateway/catalog.ts) · [docs/assets.md](docs/assets.md) |
| **内蔵テンプレート** | カバー・メタデータ付き 25 本の独立 HTML5 / Canvas / Three.js ゲーム | [templates/games/](templates/games/) |
| **トレーラー録画パイプライン** | ヘッドレス実機録画 + HTML コンポジション + FFmpeg MP4 書き出し | [docs/usage.md](docs/usage.md) · [scripts/verify-export.ts](scripts/verify-export.ts) |

<a id="community"></a>

## 🤝 コミュニティで一緒に作ろう

プレイ可能なゲームテンプレート、リミックスしやすいミニゲーム骨格、アートスタイルガイド、プラットフォーム配信スクリプト（WeChat / Douyin / TikTok / itch.io）、Game Studio の改善など、あらゆるコントリビューションを歓迎します。

| コントリビューション領域 | 推奨内容 |
| --- | --- |
| **プレイ可能ゲームテンプレート** | `templates/games/<id>/` 配下の独立プロジェクト（`index.html`、`game.json`、`cover.webp`、任意の `DESIGN.md`） |
| **ジャンル／プレイアブル広告レシピ** | 明確な 3C 規約・バランス基準・検証メモ |
| **プラットフォーム公開アダプター** | ミニゲームや Web ポータル向けのパッケージングスクリプト・マニフェスト生成・提出チェックリスト |
| **Agent & モデル統合** | 新規ローカル Agent アダプターや BYOK マルチモーダルプロバイダー対応 |

[コントリビューションガイド](CONTRIBUTING.md) · [リポジトリ開発規約](AGENTS.md) · [Issue を報告](https://github.com/nexu-io/opengame/issues)

<a id="acknowledgements"></a>

## 🙏 謝辞・オープンソース帰属

OpenGame は、ゲーム開発・クリエイティブツール・AI Agent のオープンソースエコシステムに支えられ、多くのプロジェクトから着想を得ています。

### 主要な基盤・参考オープンソースプロジェクト

| プロジェクト | ライセンス | 活用・参考内容 |
| --- | --- | --- |
| **[Higgsfield AI Skills](https://github.com/higgsfield-ai/skills)** | MIT | [skills/openmotion-game/](skills/openmotion-game/) 配下のゲーム制作ハンドブック複数本の移植元（[PROVENANCE.md](skills/openmotion-game/PROVENANCE.md) · [LICENSE-HIGGSFIELD](skills/openmotion-game/LICENSE-HIGGSFIELD)） |
| **[HeyGen Hyperframes](https://github.com/heygen-com/hyperframes)** | Apache-2.0 | Studio エディタのフロントエンド基盤（[studio/LICENSE](studio/LICENSE)）および実機トレーラー合成・MP4 レンダリングエンジン |
| **[DSH Game Studio](https://github.com/ZSeven-W/dsh-game-studio)** & **[dsh-games](https://github.com/finiking/dsh-games)**（作者：[@FiniYang](https://x.com/FiniYang)） | Open Source | DeepSeek Harness（DSH）上の AI ネイティブゲーム制作ワークショップ、自動プレイテスト、プレイアブルゲームウォールの設計着想・参考 |
| **[OpenDesign](https://github.com/nexu-io/open-design)** & **[OpenMotion](https://github.com/nexu-io/openmotion)** | Apache-2.0 | 共通オープンソース基盤（デザインシステム、マルチモーダル Model Gateway、ワークスペース設計、MCP ツール契約） |
| **[Three.js](https://github.com/mrdoob/three.js)** | MIT | 3D テンプレートおよび Agent 生成 3D ゲームを支える同梱オフライン 3D レンダリングエンジン（[LICENSE-three.txt](templates/game-kits/vendor/LICENSE-three.txt)） |
| **[KayKit Adventurers Character Pack](https://www.kaylousberg.com/)**（作者：Kay Lousberg） | CC0 | [templates/game-kits/characters/](templates/game-kits/characters/) に同梱したリグ済み 3D キャラクター（Mage・Knight）（[LICENSE-KayKit.txt](templates/game-kits/characters/LICENSE-KayKit.txt)） |
| **[Cocos Creator / Cocos Engine](https://github.com/cocos/cocos-engine)** | MIT | オフラインプレイ可能なミニゲームテンプレートを支えるオープンソースゲームエンジンランタイム |
| **[Model Context Protocol (MCP) SDK](https://github.com/modelcontextprotocol/typescript-sdk)** & **[Vercel Skills CLI](https://github.com/vercel-labs/skills)** | MIT / Apache-2.0 | 22 のローカル AI Agent 接続プロトコルおよび軽量 Skill 配布基盤 |

また、**Puppeteer & Chrome for Testing**、**FFmpeg**、**Dockview**、**CodeMirror 6**、**Lexical**、**React**、**Vite**、**Tailwind CSS**、**Zustand**、**Electron**、**GSAP**、**DiceBear**（Micah アバタースタイル、CC BY 4.0、[帰属表示](studio/skill-cover-attribution.md)）、およびオープンソースフォント（**Albert Sans**、**IBM Plex Mono**、**Instrument Serif**、SIL OFL 1.1）にも感謝いたします。

### コミュニティ紹介ゲーム・クリエイター謝辞

Game Studio のインスピレーション欄でオリジナル投稿へのリンクとして紹介している素晴らしい AI ゲームのクリエイターの皆様に感謝いたします（各アイコンをクリックすると原作者の投稿を開けます）：

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

> **権利表記について**：上記コミュニティ作品は原作者のオリジナルページへのリンク紹介のみを行っており、ソースコードの複製は行っていません。すべての権利は原作者に帰属します。表記の変更や掲載取り下げをご希望の場合は、[Issue よりご連絡](https://github.com/nexu-io/opengame/issues)いただければ速やかに対応いたします。

## Contributors

コード、ゲームテンプレート、Skill、ドキュメント、フィードバック、Issue で参加してくださったすべての皆さまに感謝します。

<a href="https://github.com/nexu-io/opengame/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=nexu-io/opengame&amp;max=500&amp;columns=20&amp;anon=1" alt="OpenGame contributors" />
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
