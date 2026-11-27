<p align="center"><img src="docs/readme/opengame-logo.svg" width="400" alt="OpenGame"></p>

<p align="center"><strong>İlk Süper Oyun Ajanı — Açık Kaynaklı Tam Yığın Yapay Zekâ Oyun Stüdyosu</strong></p>

<p align="center">
  <img src="docs/readme/opengame-hero.webp" width="100%" alt="OpenGame — İlk Süper Oyun Ajanı. 22 yerel yapay zekâ ajanında 25 dahili oynanabilir şablondan oynanabilir 3B, anime, piksel ve 9:16 mini oyunları yeniden düzenleyin, stilini değiştirin, test edin ve yayımlayın.">
</p>

<p align="center">
  <a href="package.json"><img src="docs/readme/badges/node.svg" alt="Node.js 22.18+"></a>
  <a href="LICENSE"><img src="docs/readme/badges/license.svg" alt="Apache 2.0 lisansı"></a>
  <a href="https://github.com/nexu-io/open-design"><img src="docs/readme/badges/built-by-opendesign.svg" alt="OpenDesign tarafından geliştirildi"></a>
</p>

<p align="center">
  <a href="https://go.open-design.ai/?utm_source=github&amp;utm_medium=referral&amp;utm_campaign=opengame&amp;utm_content=readme_en"><img src="docs/readme/badges/opendesign-go.svg" alt="OpenDesign Go model abonelikleri" /></a>
  <a href="https://discord.com/invite/M7NnHS9gNa"><img src="docs/readme/badges/discord.svg" alt="OpenGame Discord sunucusuna katıl" /></a>
  <a href="https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=b6cs46dc-acb2-48ed-941d-c45642ead841"><img src="docs/readme/badges/feishu.svg" alt="OpenGame Feishu grubuna katıl" /></a>
  <a href="https://x.com/OpenDesignHQ"><img src="docs/readme/badges/x-opendesignhq.svg" alt="X'te OpenDesign (@OpenDesignHQ)" /></a>
  <a href="https://x.com/OpenDesignDevs"><img src="docs/readme/badges/x-opendesigndevs.svg" alt="X'te OpenDesign Developers (@OpenDesignDevs)" /></a>
  <a href="https://www.youtube.com/channel/UChtshixMhvtgBWzoD9R_Qfg"><img src="docs/readme/badges/youtube.svg" alt="YouTube'da OpenDesign" /></a>
</p>

<p align="center"><a href="#quick-start">Hızlı Başlangıç</a> · <a href="#agent-wall">Ajanlar</a> · <a href="#showcase">Oynanabilir Şablonlar</a> · <a href="#features">Neden OpenGame</a> · <a href="#publish-monetize">Yayımlama ve Gelir</a> · <a href="#technical-guide">Kurulum ve MCP</a> · <a href="#community">Topluluk</a></p>

<div align="center">

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · **Türkçe**

</div>

# OpenGame ile Tanışın

OpenGame, **ilk açık kaynaklı Süper Oyun Ajanıdır** — **DeepSeek (DSH)**, **Claude Code**, **Codex** veya yerel kodlama ajanlarınızdan herhangi birini yapay zekâ destekli bir Unreal Engine / Unity ve tam yığın oyun stüdyosuna dönüştürür. Tek bir uçtan uca işlem hattında tek bir fikirden **AAA düzeyinde 3B dünyalara** veya **gelir elde etmeye hazır viral mini oyunlara** ulaşın.

- 🚀 **Ajanınızla AAA Düzeyinde 3B Oyunlar Geliştirin.** Tam yığın 3B oynanış, sanat, müzik ve seslendirmeyi doğrudan **DeepSeek (DSH)**, **Claude**, **Codex** veya **Gemini** üzerinden yönetin — tek bir istemden oynanabilir 3B aksiyon, yarış ve açık dünya oyunlarına.
- 🎮 **Herhangi Bir Oyunu Tek Tıkla Yeniden Düzenleyin (Remix) ve Stilini Değiştirin.** Tamamen düzenlenebilir kaynak kodlu **25 dahili oynanabilir şablonla** (3B, voksel, anime, piksel ve 9:16 hitler) başlayın — kanıtlanmış mekanikleri korurken dakikalar içinde karakterleri, dünyaları ve sanat stillerini değiştirin.
- 💰 **Kazandıran Oyunlar İnşa Edin: Üret → Doğrula → Gelire Dönüştür.** Otomatik mantık kontrolleri, denge simülasyonu, başsız oynanış testi, kapaklar ve oynanış fragmanları — canlı web bağlantıları yayımlayın, tek dosyalık **9:16 Oynanabilir Reklamlar (Playable Ads)** dışa aktarın ve **WeChat Mini Games**, **TikTok** ile **Douyin** yayımlama yollarına bağlanın.
- 🔓 **Tam Yığın Açık Kaynak (BYOA + BYOK).** Kod, sanat, video, müzik, seslendirme, SFX ve Three.js 3B tamamen açık kaynaklıdır — favori [yerel ajanınızı](#agent-wall) ve kendi API anahtarlarınızı takın veya [OpenDesign Go](https://go.open-design.ai/?utm_source=github&utm_medium=referral&utm_campaign=opengame&utm_content=readme_en) bağlantısını kullanın.

<a id="quick-start"></a> <a id="快速开始"></a>

## ⚡ Hızlı Başlangıç

### 1. Yerel Ajanınıza tek bir istem verin

Bu talimatı **DeepSeek TUI / Harness**, **Claude Code**, **Codex**, **WorkBuddy**, **Cursor**, **Gemini CLI** veya [desteklenen 22 yerel ajandan](#agent-wall) herhangi birine yapıştırın:

```text
Follow https://github.com/nexu-io/opengame/blob/main/docs/opengame-setup.md to connect OpenGame to this agent and open the Game Studio template gallery.
```

### 2. Skills CLI ile Ana OpenGame Becerisini Kurun

[Skills CLI](https://github.com/vercel-labs/skills) ile ana `opengame` giriş Becerisini (yerel kuruluma rehberlik eder ve `openmotion-game` + 18 oyun tasarımı, 3C, animasyon, playable-ad ve QA başvuru kılavuzuna yönlendirir) kurun:

```sh
npx skills add https://github.com/nexu-io/opengame/tree/skills --skill opengame
```

> Beceriyi kurmak OpenGame giriş talimatlarını ajanınıza kopyalar (doğrudan `--skill openmotion-game` de kurabilirsiniz). Ajanınızın 12 `openmotion_game_*` aracını çağırabilmesi ve Game Studio'yu açabilmesi için aşağıdaki yerel Stüdyo ve MCP kurulumunu tamamlayın.

### 3. OpenGame Studio'yu kaynak koddan yerelde çalıştırın

**Git**, **Git LFS**, **npm** ve **Node.js 22.18+** gerektirir (CI, Node.js 26.11.1'i sabitler). Başlattıktan hemen sonra kataloğa göz atabilirsiniz. Bir şablonu oynatmak veya yeniden düzenlemek varlıklarını ilk kullanımda indirir. Tidebreaker çevrimdışı çalışır.

```sh
git -c filter.lfs.process= -c filter.lfs.smudge= -c filter.lfs.required=false clone --depth 1 --single-branch --branch main https://github.com/nexu-io/opengame.git
cd opengame
git lfs install --local --skip-smudge
npm ci
npm run build:studio
npm start
```

<a id="agent-wall"></a>

**22 yerel ajanla çalışır (BYOA)** · [Ajanınızı seçin](#choose-agent)

<p align="center"><a href="#choose-agent"><picture><source media="(max-width: 600px)" srcset="docs/readme/agents/local-agents.mobile.png"><img src="docs/readme/agents/local-agents.png" width="100%" alt="WorkBuddy, Codex CLI, Claude Code, OpenCode, Hermes, Antigravity, Gemini CLI, Grok Build, Kimi CLI, Cursor Agent, Qwen Code, Qoder CLI, GitHub Copilot, Pi, Kiro CLI, Kilo, Mistral Vibe, DeepSeek TUI, Reasonix, Aider, Devin, Trae CLI"></picture></a></p>

<a id="showcase"></a>

## 🕹️ Oynanabilir Oyun Şablonları ve Vitrin

OpenGame, [`templates/games/`](templates/games/) altında oynanabilir HTML5 / Three.js kaynak kodu, görseller, kontroller ve yerelleştirmeyle birlikte **25 oynamaya hazır oyun** sunar. Bunları Game Studio'da yerelde oynayın, tek tıkla **Remix** yapın veya kendi markanıza, temanıza ya da evreninize göre **Re-style** edin.

### 3B, Voksel ve Aksiyon Oyunları (16:9)

<table width="100%">
<tr>
<td width="50%" valign="top">
<img src="templates/games/tidebreaker/cover.webp" width="100%" alt="Tidebreaker — 3B fırtınalı takımada sürat teknesi yarışı"><br>
<strong>Tidebreaker</strong> · <code>3D · Yarış · Three.js</code><br>
Fırtınalı bir takımadada sürat teknesiyle yarışın, dalga tepelerinden zıplayın, resiflerden kaçının ve sekiz kontrol noktasında gelgiti yenin.<br>
<a href="templates/games/tidebreaker/">Kaynağı ve DESIGN.md'yi incele →</a>
</td>
<td width="50%" valign="top">
<img src="templates/games/starlight-bastion/cover.webp" width="100%" alt="Starlight Bastion — Voksel uzay kristali dalga nişancı oyunu"><br>
<strong>Starlight Bastion</strong> · <code>Voksel · Nişancı · Yükseltmeler</code><br>
Işıltılı bir kristali giderek zorlaşan beş voksel işgalci dalgasına karşı savunun, dalgalar arasında roguelite yükseltmeleri seçin.<br>
<a href="templates/games/starlight-bastion/">Kaynağı ve DESIGN.md'yi incele →</a>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="templates/games/skyline-courier/cover.webp" width="100%" alt="Skyline Courier — 3B siberpunk çatı parkur platform oyunu"><br>
<strong>Skyline Courier</strong> · <code>3D · Platform · Siberpunk</code><br>
90 saniye içinde son üç paketi teslim etmek için yağmurla ıslanmış siberpunk gökdelenlerinde koşun, zıplayın ve duvardan sekin.<br>
<a href="templates/games/skyline-courier/">Kaynağı ve DESIGN.md'yi incele →</a>
</td>
<td width="50%" valign="top">
<img src="templates/games/neon-drift/cover.webp" width="100%" alt="Neon Drift — 3B synthwave gece otoyolu yarışı"><br>
<strong>Neon Drift</strong> · <code>3D · Yarış · Siberpunk</code><br>
Yağmurlu neon otoyol trafiğinden sıyrılın, turbo doldurmak için kıl payı geçişleri zincirleyin ve yeni mesafe rekoru kırın.<br>
<a href="templates/games/neon-drift/">Kaynağı incele →</a>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="templates/games/comet-guard/cover.webp" width="100%" alt="Comet Guard — Yörünge savunma uzay nişancı oyunu"><br>
<strong>Comet Guard</strong> · <code>Nişancı · Uzay</code><br>
Boyalı bir yıldız alanında yörünge önleyicisi kullanın, erimiş kuyruklu yıldızları parçalayın ve artan dalgalara karşı istasyonu koruyun.<br>
<a href="templates/games/comet-guard/">Kaynağı incele →</a>
</td>
<td width="50%" valign="top">
<img src="templates/games/harbor-skirmish/cover.webp" width="100%" alt="Harbor Skirmish — 3B birinci şahıs ada nişancı oyunu"><br>
<strong>Harbor Skirmish</strong> · <code>3D FPS · Kanca ve Kayma</code><br>
Çift zıplama, kayma, atılma ve kanca hareketliliğine sahip kavisli bir adada stilize 3B birinci şahıs nişancı oyunu.<br>
<a href="templates/games/harbor-skirmish/">Kaynağı incele →</a>
</td>
</tr>
</table>

### Stilize, Anlatı ve Atmosferik Oyunlar (16:9)

<table width="100%">
<tr>
<td width="50%" valign="top">
<img src="templates/games/glyph-garden/cover.webp" width="100%" alt="Glyph Garden — Anime fantastik üçlü eşleştirme bulmacası"><br>
<strong>Glyph Garden</strong> · <code>Anime · Bulmaca · Fantastik</code><br>
Ay ışığındaki taç yapraklarını değiştirin ve 24 hamlede 2.200 puana ulaşmak için zincirleme kombolar tetikleyin.<br>
<a href="templates/games/glyph-garden/">Kaynağı incele →</a>
</td>
<td width="50%" valign="top">
<img src="templates/games/lantern-hop/cover.webp" width="100%" alt="Lantern Hop — Piksel fantastik çatı platform oyunu"><br>
<strong>Lantern Hop</strong> · <code>Piksel · Platform · Fantastik</code><br>
Atkılı bir piksel tilkiye ay ışığındaki çatılar boyunca rehberlik edin; boşluklardan çift zıplayın ve parlayan kâğıt fenerleri toplayın.<br>
<a href="templates/games/lantern-hop/">Kaynağı incele →</a>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="templates/games/lighthouse-log/cover.webp" width="100%" alt="Lighthouse Log — Anime fırtınalı gece anlatılı hayatta kalma"><br>
<strong>Lighthouse Log</strong> · <code>Anime · Görsel roman · Hayatta kalma</code><br>
Yedi fırtınalı gece boyunca bir kıyı deniz fenerini yanık tutun, yakıtı idareli kullanın ve zorlu telsiz kararları verin.<br>
<a href="templates/games/lighthouse-log/">Kaynağı incele →</a>
</td>
<td width="50%" valign="top">
<img src="templates/games/last-light/cover.webp" width="100%" alt="Last Light — El feneri ışıklı korku kaçış oyunu"><br>
<strong>Last Light</strong> · <code>Korku · Atmosferik</code><br>
Sizi takip eden gölgeyi ışığınızda sabit tutarken el feneriniz bitmeden terk edilmiş okulda üç anahtarı bulun.<br>
<a href="templates/games/last-light/">Kaynağı incele →</a>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="templates/games/night-train/cover.webp" width="100%" alt="Night Train Letters — Etkileşimli dallanan hikâye"><br>
<strong>Night Train Letters</strong> · <code>Görsel roman · Dallanan Anlatı</code><br>
Denize giden yağmurlu bir gece treninde gönderilmemiş üç mektup — saf HTML ile yazılmış samimi bir dallanan anlatı.<br>
<a href="templates/games/night-train/">Kaynağı incele →</a>
</td>
<td width="50%" valign="top">
<img src="templates/games/stack-the-moon/cover.webp" width="100%" alt="Stack the Moon — Tek dokunuşlu ay ışığı kule yığma"><br>
<strong>Stack the Moon</strong> · <code>Gündelik · Tek Dokunuş Arcade</code><br>
Bulutların üzerinde zamanlamalı taşlarla ay ışığı gözlemevi inşa edin; kulenizi genişletmek için kusursuz inişleri zincirleyin.<br>
<a href="templates/games/stack-the-moon/">Kaynağı incele →</a>
</td>
</tr>
</table>

### Viral Dikey Mini Oyunlar ve Oynanabilir Reklamlar (9:16)

Mobil başparmak kullanımı, ilk karede anında etkileşim, kısa yüksek elde tutma döngüleri ve **mini oyun / oynanabilir reklam geliri** için tasarlandı:

<table width="100%">
<tr>
<td width="50%" valign="top">
<img src="templates/games/gate-legion/cover.webp" width="100%" alt="Gate Legion — 9:16 aritmetik kapı ordusu koşu oyunu"><br>
<strong>Gate Legion</strong> · <code>9:16 · Kapı Koşusu</code><br>
Birliğinizi <code>+10</code> / <code>×2</code> aritmetik kapılarından geçirin ve son patron ordusuyla çarpışın.<br>
<a href="templates/games/gate-legion/">Kaynağı incele →</a>
</td>
<td width="50%" valign="top">
<img src="templates/games/pin-rescue/cover.webp" width="100%" alt="Pin Rescue — 9:16 pim çekme bulmacası"><br>
<strong>Pin Rescue</strong> · <code>9:16 · Pim Çekme Bulmacası</code><br>
Su ve lavı taşa dönüştürmek, tehlikeleri temizlemek ve beş aşamada altını ulaştırmak için pimleri çekin.<br>
<a href="templates/games/pin-rescue/">Kaynağı incele →</a>
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="templates/games/sky-runner/cover.webp" width="100%" alt="Sky Runner — 9:16 3B neon uçan kaykay koşusu"><br>
<strong>Sky Runner</strong> · <code>9:16 · 3B Şerit Koşusu</code><br>
Şerit değiştirin, altınları toplayın, dronlardan kaçının ve hızlanan bir neon gökyüzü yolunda hızlanın.<br>
<a href="templates/games/sky-runner/">Kaynağı incele →</a>
</td>
<td width="50%" valign="top">
<img src="templates/games/slime-swell/cover.webp" width="100%" alt="Slime Swell — 9:16 şehir yutan arcade arena"><br>
<strong>Slime Swell</strong> · <code>9:16 · Büyü ve Yut .io</code><br>
Sokak nesnelerini yutun, binalardan daha büyük olun ve 60 saniyede üç rakip slime'ı geride bırakın.<br>
<a href="templates/games/slime-swell/">Kaynağı incele →</a>
</td>
</tr>
</table>

<details>
<summary><strong>25 dahili oynanabilir oyun şablonunun tamamına göz atın</strong></summary>

| Oyun | Tür | Stil | Biçim | Özet | Kaynak |
| --- | --- | --- | --- | --- | --- |
| **Castle Crush** | Gündelik | Anime | 9:16 Dikey | Dört ahşap ve taş aşamada sapan fiziği kuşatması | [castle-crush](templates/games/castle-crush/) |
| **Comet Guard** | Nişancı | Minimal | 16:9 Yatay | Yıldız alanı istasyonunu erimiş kuyruklu yıldızlardan koruyan yörünge önleyicisi | [comet-guard](templates/games/comet-guard/) |
| **Drift Dash** | Yarış | Voksel | 9:16 Dikey | Üç yapay zekâ rakibine karşı tek başparmakla retro pist drifti | [drift-dash](templates/games/drift-dash/) |
| **Gate Legion** | Gündelik | Piksel | 9:16 Dikey | Viral aritmetik kapılı birlik çarpanı ve patron savaşı | [gate-legion](templates/games/gate-legion/) |
| **Glyph Garden** | Gündelik | Anime | 16:9 Yatay | Zincirleme fantastik üçlü eşleştirme bulmacası | [glyph-garden](templates/games/glyph-garden/) |
| **Harbor Skirmish** | Nişancı | 3B | 16:9 Yatay | Çift zıplama, kayma, atılma ve kancalı stilize 3B FPS | [harbor-skirmish](templates/games/harbor-skirmish/) |
| **Jingyang Ridge** | Gündelik | Anime | 16:9 Yatay | Mürekkep desenli dövüş sanatları patron düellosu — işaretleri oku, şerit değiştir, cezalandır | [jingyang-ridge](templates/games/jingyang-ridge/) |
| **Lane Turret** | Nişancı | Piksel | 9:16 Dikey | Yükseltme kartlarıyla otomatik taret dalga savunması | [lane-turret](templates/games/lane-turret/) |
| **Lantern Hop** | Platform | Piksel | 16:9 Yatay | Ay ışığındaki çatılarda sonsuz çift zıplamalı tilki koşusu | [lantern-hop](templates/games/lantern-hop/) |
| **Last Light** | Korku | Minimal | 16:9 Yatay | Terk edilmiş bir okulda el feneriyle hayatta kalma kaçışı | [last-light](templates/games/last-light/) |
| **Lighthouse Log** | Görsel roman | Anime | 16:9 Yatay | Yedi fırtınalı gece boyunca yakıt yönetimi ve dallanan telsiz seçimleri | [lighthouse-log](templates/games/lighthouse-log/) |
| **Merge Bakery** | Gündelik | Anime | 9:16 Dikey | Hamur işleri pişirin, birleştirin ve süreli müşteri siparişlerini tamamlayın | [merge-bakery](templates/games/merge-bakery/) |
| **Neon Drift** | Yarış | 3B | 16:9 Yatay | Yağmurlu synthwave otoyolunda trafikten sıyrılma ve turbo | [neon-drift](templates/games/neon-drift/) |
| **Night Train Letters** | Görsel roman | Minimal | 16:9 Yatay | Bir gece treninde gönderilmemiş üç mektubun samimi dallanan hikâyesi | [night-train](templates/games/night-train/) |
| **Periscope Depth** | Nişancı | Minimal | 16:9 Yatay | Denizaltı devriyesi: periskopla gemileri torpidola, sonar derinlik bombalarından kaç | [periscope-depth](templates/games/periscope-depth/) |
| **Pin Rescue** | Gündelik | Minimal | 9:16 Dikey | Pim çekmeli lav, su ve altın fizik bulmacaları | [pin-rescue](templates/games/pin-rescue/) |
| **Rooftop Roast** | Gündelik | Minimal | 16:9 Yatay | Markalanabilir kafe tanıtım drone oyunu — yeniden markalamak için tek `SHOP` nesnesini düzenleyin | [rooftop-roast](templates/games/rooftop-roast/) |
| **Sky Runner** | Yarış | 3B | 9:16 Dikey | Altın ve turbolu siberpunk 3B uçan kaykay şerit koşusu | [sky-runner](templates/games/sky-runner/) |
| **Skyline Courier** | Platform | 3B | 16:9 Yatay | 90 saniyelik sayaca karşı 3B çatı parkuru ve duvardan sekme | [skyline-courier](templates/games/skyline-courier/) |
| **Slime Swell** | Gündelik | Minimal | 9:16 Dikey | Üç rakip slime'a karşı şehir yutan büyüme arenası | [slime-swell](templates/games/slime-swell/) |
| **Sort Stack** | Gündelik | Minimal | 9:16 Dikey | Geri almalı beş aşamalı halka sıralama mantık bulmacası | [sort-stack](templates/games/sort-stack/) |
| **Stack the Moon** | Gündelik | Minimal | 16:9 Yatay | Tek dokunuşlu ay ışığı gözlemevi kule yığma oyunu | [stack-the-moon](templates/games/stack-the-moon/) |
| **Starlight Bastion** | Nişancı | Voksel | 16:9 Yatay | Roguelite yükseltmeleriyle beş dalgalı kristal savunması | [starlight-bastion](templates/games/starlight-bastion/) |
| **Tidebreaker** | Yarış | 3B | 16:9 Yatay | Fırtınalı takımada 3B sürat teknesi yarışı ve dalga sıçramaları | [tidebreaker](templates/games/tidebreaker/) |
| **Tilt Temple** | Gündelik | 3B | 9:16 Dikey | 3B yüzen labirent — eğ, anahtarı al, portala ulaş | [tilt-temple](templates/games/tilt-temple/) |

</details>

<a id="features"></a>

## ✨ Neden OpenGame?

### 1. Tek Tıkla Remix ve Re-style — Kod Olarak Oyun (Game-as-Code) Gücüyle

Boş bir istemden cilalı bir oyun geliştirmek her model için zordur. OpenGame bunu **doğrulanmış oyun mühendisliğini** **tema, sanat yönetimi ve içerikten** ayırarak çözer:

- **Her oyun temiz, incelenebilir kaynak kodudur**: `index.html`, deterministik `logic.js`, 3B oyunlar için dahili Three.js ve yapılandırılmış tasarım belgeleri (`design/plan.md`, `design/style.md`, `design/assets.csv`, `design/verification.md`).
- **Tek tıkla Remix**: Game Studio'daki 25 şablondan herhangi birinde **Remix** düğmesine tıklayın (veya ajanınızdan yeniden düzenlemesini isteyin); tüm kontrolleri, denge ayarları ve otomatik test kancaları hazır, tamamen size ait düzenlenebilir bir taslak oluşturun.
- **Herhangi bir evrene göre Re-style**: Fizik veya kazanma/kaybetme kurallarını bozmadan tür görünümünü, karakterleri, paleti, sprite'ları, dokuları ve müziği değiştirin — **DeepSeek** gibi ekonomik modellerle hızlı yineleme veya **Claude Fable 5.2**, **Opus**, **Codex** ve **Gemini** ile AAA düzeyinde 3B ve gölgelendirici hedefleri için idealdir.

**Bağlı Ajanınızda şu istemleri deneyin:**

```text
# 1. Tek tıkla Remix & Re-style (DeepSeek / hızlı modeller için harika)
Use openmotion-game to remix the "Lantern Hop" template into a cyberpunk rain-city cat runner. Keep the double-jump physics and endless scoring loop, replace the fox and lanterns with a neon cyber-cat and holo-batteries, generate new key art and synthwave BGM, then validate, playtest, and capture a fresh cover.
```

```text
# 2. Mobil kampanyalara hazır 9:16 Oynanabilir Reklam (Playable Ad) oluşturun
Use openmotion-game to create a portrait 9:16 playable ad (playableAd: true) for a medieval tower-defense mobile game: instant first-frame interaction with a hand tutorial, a 25-second escalating wave battle, and an end card with an App Store / Google Play CTA. Validate, simulate, playtest at 390x844, and bundle as a single-file HTML.
```

```text
# 3. Sıfırdan Özgün 3B Oyun (Claude Fable 5.2 / Opus / Codex / Gemini için harika)
Use openmotion-game to create a 3D wuxia boss-duel game (style: "3d") set on a misty bamboo cliff at dusk. Include parry timing, dodge i-frames, stamina management, and two boss phases. Run 3-tier simulation, headless Chromium playtest, capture a 1280x720 cover, and record a gameplay trailer.
```

<a id="model-wall"></a>

### 2. Tam Yığın Çok Kipli Oyun Üretimi (BYOK)

Gerçek bir oyun koddan fazlasını gerektirir — ana görseller, karakter sprite'ları, kesintisiz 3B dokular, müzik döngüleri, seslendirme replikleri ve net ses efektleri gerekir. OpenGame'in **Model Gateway** katmanı, API anahtarlarınızı yerelde ve oyun kaynağından ayrı tutarken çok kipli üretimi doğrudan oyun projesine bağlar.

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

| Oyun Varlık Katmanı | Önerilen Modeller (Model Gateway'de yapılandırıldığında) | Anahtarsız / Dahili Yedek |
| --- | --- | --- |
| **🖼️ Ana görseller, portreler, sprite'lar ve dokular** | `GPT Image 2.6` (düzenleme ve şeffaf PNG'ler), `Seedream 5.5` / `5.0 Flash`, `Nano Banana 2`, `FLUX`, `Codex Image` | Net prosedürel Canvas/SVG sprite'lar ve prosedürel dokular |
| **🎵 Arka plan müziği (menü, aşama, patron)** | `ElevenLabs Music v2` (`no vocals` döngüleri), `Suno v4` | Prosedürel Web Audio sentezlenmiş oyun müziği |
| **🎙️ Karakter sesi ve anlatıcı replikleri** | `ElevenLabs v3` (İngilizce ve çok dilli), `BytePlus TTS 2` (Çince), `Kokoro` | Stilize diyalog yazıları ve altyazı arayüzü |
| **🎬 Giriş ara sahneleri ve hareketli klipler** | `Wan 2.7`, `Seedance 2.5` (kısa I2V klipleri) | Motor içi animasyonlu giriş kamerası ve başlık sekansı |
| **🔊 Etki ses efektleri (vuruş, zıplama, altın, arayüz)** | Web Audio API ile doğrudan oyun kodunda sentezlenir | Aynı (sıfır gecikme, sıfır harici dosya) |
| **🧊 3B sahneler ve modeller** | Dahili **Three.js** + dahili CC0 kitleri + ayrılmış 3B ağ geçidi yuvası (bağlandığında otomatik keşfedilir) | Prosedürel Three.js geometrisi, ışıklandırma ve gölgelendiriciler |

> OpenGame yerel açık kaynak yığını için hiçbir yazılım aboneliği ücreti almaz. **Model Settings** içinde kendi sağlayıcı anahtarlarınızı kullanın, birleşik çoklu model erişimi için [OpenDesign Go](https://go.open-design.ai/?utm_source=github&utm_medium=referral&utm_campaign=opengame&utm_content=readme_en) bağlayın veya %100 kodla üretilen sıfır API maliyetli oyunlar yapın. [Model kataloğu](gateway/catalog.ts) · [Sağlayıcı kurulumu](docs/model-gateway.md)

### 3. Otomatik Oyun QA, Denge Simülasyonu ve Otomatik Fragmanlar

Ajanlar yalnızca kod üretip çalışmasını ummamalıdır. OpenGame herhangi bir oyunu **hazır (`ready`)** işaretlemeden önce otomatik bir mühendislik doğrulama döngüsü uygular:

1. **Statik ve 50-Tik Mantık Doğrulaması (`openmotion_game_validate`)** — `index.html`, izin verilen varlık/CDN politikalarını ve zorunlu deterministik dışa aktarımları doğrular, 50 tiklik duman testi çalıştırır (tik başına `< 5 ms`).
2. **3 Katmanlı Deterministik Denge Simülasyonu (`openmotion_game_simulate`)** — Tarayıcı olmadan sınırlı başsız rotalar çalıştırarak yetenekli bir `reference` rotasının gerçek kazanma hedefine ulaştığını, zayıf bir rotanın zorlandığını ve boşta (`idle`) bir oyuncunun temiz biçimde kaybettiğini (`< 2500` tik) doğrular.
3. **Başsız Chromium Oynanış Testi (`openmotion_game_playtest`)** — 1–4 istemci üzerinde gerçek klavye/fare/dokunmatik kontrolleri sürerek 3C tepkiselliğini, `390×844` mobil yerleşim bütünlüğünü, medya URL yüklemelerini ve sıfır konsol/ağ hatasını kontrol eder.
4. **Yalnızca Oyun Kapağı Yakalama (`openmotion_game_capture_cover`)** — Yalıtılmış başsız Chrome'da doğrudan oyun tuvalinden temiz bir `1280×720` PNG yakalar.
5. **Otomatik Oynanış Fragmanı (`openmotion_game_trailer`)** — `1280×720` çözünürlükte üç gerçek 5 saniyelik başsız oynanış klibi kaydeder, düzenlenebilir ~19 saniyelik başlık + öne çıkanlar + Şimdi Oyna fragmanı kurgular ve sosyal medya lansmanına hazır MP4 üretir.

<a id="publish-monetize"></a>

## 🚀 Uçtan Uca Dağıtım ve Gelire Dönüştürme

Oynanabilir prototipleri insanların oynayabileceği, paylaşabileceği ve ödeme yapabileceği gerçek oyunlara dönüştürün.

| Aşama | Bugün Kullanılabilir | Yol Haritası (Geliştiriliyor) |
| --- | --- | --- |
| **Oynama ve Yerel Katalog** | Oynama takibi, favoriler ve tek tıkla Remix ile doğrudan yerel OpenGame Studio pazarınıza yayımlayın (`openmotion_game_publish`) | Anında remix için tür ve gelir mekaniğine göre seçilmiş **En Karlı 100 Mini Oyun Şablonu** |
| **Anında Web Paylaşımı** | OpenDesign Cloud üzerinden tek tıkla statik paket ve canlı web paylaşım bağlantısı (`openmotion_assets_use action="web_publish"`), yerel medya URL'lerini otomatik yeniden yazar ve varlıkları sıkıştırır | Özel alan adı ve gömülebilir oyun kartları |
| **Mobil Oynanabilir Reklamlar** | Dahili **9:16 Oynanabilir Reklam kipi** (`playableAd: true`): ilk karede anında oynama, el rehberi, kısa zengin seviye ilerlemesi, döngülü BGM ve App Store / Google Play kapanış kartı | Doğrudan reklam ağı paketleme ön ayarları (AppLovin, Unity Ads, Meta, TikTok) |
| **Mini Oyun Platformları ve Gelir** | Elle platform paketlemesine hazır temiz kendi kendine yeten HTML5/JS proje dışa aktarımları artı lansman pazarlaması için otomatik kaydedilen oynanış fragmanları | **WeChat Mini Games**, **Douyin Mini Games**, **TikTok**, **Xiaohongshu Mini-Tools** ve **itch.io / Poki / CrazyGames** için **L1–L4 Rehberli Platform Yayımlama** |
| **Yapay Zekâ Oyun Alanı** | Yerel tek oyunculu ve oda tabanlı oynanış testi | **Çoklu Model Canlı Oyun Arenası** — birden fazla öncü LLM'i canlı oyunlarda gerçek zamanlı yarıştırın |

<a id="technical-guide"></a>

## 🛠️ Kurulum ve MCP Araçları

<a id="agent-setup"></a> <a id="choose-agent"></a>

### Yerel Ajanınızı Bağlayın

Yerel OpenGame MCP sunucusunu ve Becerilerini bağlamak için ajanınızı seçin:

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

- <a id="deepseek-setup"></a>**DeepSeek TUI / Harness** · `openmotion-game` becerisini kurun ve Cordis yapılandırmasıyla yerel MCP araçlarını bağlayın veya depodan `node integrations/dsh/install.ts` çalıştırın. [DeepSeek Harness kılavuzu](docs/agent-adapters.md#deepseek-harness)
- <a id="claude-setup"></a>**Claude Code** · Aşağıdaki stdio MCP girdisini ekleyin, `openmotion-game` becerisini kurun ve araçların etkin olduğunu doğrulamak için `/mcp` çalıştırın.
- <a id="codex-setup"></a>**Codex CLI** · Yerel eklentiyi ve MCP sunucusunu otomatik kaydetmek için depodan `bash scripts/install-motion.command` çalıştırın.
- <a id="workbuddy-setup"></a>**WorkBuddy** · Bağlayıcıyı içe aktarın veya aşağıdaki `mcp.json` yapılandırmasını yapıştırın. [WorkBuddy kılavuzu](docs/agent-adapters.md#workbuddy)

<a id="manual-mcp"></a>

#### Manuel stdio MCP yapılandırması (herhangi bir MCP istemcisinde çalışır)

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

> Oyunlarınızın, üretilen varlıkların ve sağlayıcı anahtarlarınızın depo güncellemelerinden temiz biçimde ayrı kalması için `MOTION_DATA_DIR` dizinini git klonu dışında tutun. Bkz. [tam kurulum kılavuzu](docs/opengame-setup.md) ve [mimari referansı](docs/opengame-architecture.md).

### 12 Özel Oyun MCP Aracı

OpenGame, yerel stdio MCP üzerinden eksiksiz bir oyun mühendisliği araç yüzeyi sunar (mevcut ana bilgisayarlar ve bağdaştırıcıların %100 uyumlu kalması için ortak `openmotion_game_*` ad alanını kullanır):

| MCP Aracı | Amaç |
| --- | --- |
| `openmotion_game_create` | Yeni bir oyun taslağı oluşturur (2B, dahili Three.js ile 3B veya 9:16 `playableAd`) ve tam ajan brifingini döndürür |
| `openmotion_game_get` | Bir oyun kartını, yaşam döngüsü durumunu ve tam dosya envanterini okur |
| `openmotion_game_read_file` | Bir oyun projesindeki herhangi bir kaynak veya tasarım dosyasını okur |
| `openmotion_game_write_files` | Bütünlüklü oyun kaynak ve tasarım dosyalarını topluca yazar (oyun başına 100 metin dosyası / 8 MiB'e kadar) |
| `openmotion_game_update_meta` | Başlık, açıklama, kontroller, kapak yolu ve yerelleştirilmiş meta verileri (`zh-CN` vb.) birleştirir |
| `openmotion_game_validate` | `index.html`, CDN politikası, deterministik mantık dışa aktarımlarını kontrol eder ve 50 tiklik duman testi çalıştırır |
| `openmotion_game_simulate` | Sınırlı 3 katmanlı deterministik başsız simülasyonlar (`reference` kazanım / zayıf / `idle` kayıp) çalıştırır |
| `openmotion_game_playtest` | Gerçek girdi kontrollerini, `390×844` yerleşimini ve konsol temizliğini test etmek için yalıtılmış başsız Chrome (1–4 istemci) başlatır |
| `openmotion_game_capture_cover` | Doğrudan oyun tuvalinden `assets/cover.png` içine temiz bir `1280×720` PNG yakalar |
| `openmotion_game_trailer` | Gerçek başsız oynanış klipleri kaydeder ve düzenlenebilir ~19 saniyelik MP4 fragmanı oluşturur |
| `openmotion_game_set_status` | Yaşam döngüsü durumunu günceller (`building`, `ready`, `failed`) |
| `openmotion_game_publish` | Oyunu yeniden doğrular ve yerel Game Studio kataloğuna yayımlar |

Artı **`openmotion_media_use`** (yapılandırılmış BYOK çok kipli modelleri keşfeder ve inceler) ve **`openmotion_assets_use`** (görsel/müzik/ses/video üretir ve tek tıkla bulut paylaşım bağlantıları için `action: "web_publish"` çalıştırır). [Tam MCP sözleşmesi](docs/mcp-phase1-tools.md)

### Oyun Mühendisliği Becerisi ve 18 Başvuru Kılavuzu

Bağlı her ajan [`skills/openmotion-game/SKILL.md`](skills/openmotion-game/SKILL.md) dosyasını (veya MCP kaynakları üzerinden `openmotion://workflow/game/start`) ve 18 uzman mühendislik kılavuzunu okuyabilir:

| Alan | Başvuru Kılavuzları |
| --- | --- |
| **Oyun Tasarımı ve Yapı** | [Brifing Standardı](skills/openmotion-game/references/game-brief.md) · [Türler ve Çekirdek Döngüler](skills/openmotion-game/references/game-genres.md) · [Tasarım Sistemi](skills/openmotion-game/references/game-design-system.md) · [Referans Arama](skills/openmotion-game/references/game-lookup.md) |
| **3C, Kontroller ve Oyun Hissi** | [3C Modülleri](skills/openmotion-game/references/game-3c-modules.md) · [Oyun Hissi ve Zanaat](skills/openmotion-game/references/game-feel-craft.md) · [Üretim Akışı](skills/openmotion-game/references/game-flow.md) |
| **Görseller, 2B/3B ve Ses** | [Stilizasyon](skills/openmotion-game/references/game-stylization.md) · [Dokular](skills/openmotion-game/references/game-textures.md) · [2B Animasyon](skills/openmotion-game/references/game-2d-animation.md) · [3B Animasyon](skills/openmotion-game/references/game-3d-animation.md) · [Prosedürel Hareket](skills/openmotion-game/references/game-procedural-animation.md) · [Ses ve Web Audio](skills/openmotion-game/references/game-audio.md) |
| **Oynanabilir Reklamlar ve Kalite Kapıları** | [Playable Ad Spesifikasyonu](skills/openmotion-game/references/game-playable-ad.md) · [Kalite Kapıları](skills/openmotion-game/references/game-gates.md) · [İnceleme Ölçütü](skills/openmotion-game/references/review-rubric.md) |

### Teknoloji Yığını ve Kaynak Haritası

| Katman | Teknoloji | Giriş Noktaları |
| --- | --- | --- |
| **OpenGame Studio Arayüzü** | React 19, TypeScript 5.9, Vite 6, Tailwind CSS 4, Zustand | [GameStudio.tsx](studio/src/motion/game/GameStudio.tsx) · [gameCatalog.ts](studio/src/motion/game/gameCatalog.ts) |
| **Oyun Çalışma Zamanı ve QA** | Node.js, yerel HTTP, Puppeteer Core / Chrome, deterministik simülatör | [game-projects.ts](game-projects.ts) · [shared/game-contract.ts](shared/game-contract.ts) · [server.ts](server.ts) |
| **MCP ve Ajan Becerileri** | Yerel stdio MCP sunucusu, `opengame` giriş Becerisi, `openmotion-game` iş akışı ve 18 kılavuz | [mcp.ts](mcp.ts) · [skills/opengame/SKILL.md](skills/opengame/SKILL.md) · [skills/openmotion-game/](skills/openmotion-game/) |
| **Çok Kipli Ağ Geçidi** | BYOK model keşfi, iş yoklama, varlık kütüphanesi ve web yayımlama | [gateway/service.ts](gateway/service.ts) · [gateway/catalog.ts](gateway/catalog.ts) · [docs/assets.md](docs/assets.md) |
| **Oynanabilir Şablonlar** | Kapakları ve meta verileriyle 25 bağımsız HTML5 / Canvas / Three.js oyunu | [templates/games/](templates/games/) |
| **Fragman Hattı** | Başsız oynanış yakalama + HTML kurgulama + FFmpeg MP4 dışa aktarımı | [docs/usage.md](docs/usage.md) · [scripts/verify-export.ts](scripts/verify-export.ts) |

<a id="community"></a>

## 🤝 Oyunları Birlikte Geliştirelim

Oynanabilir bir oyun şablonu, remixlenebilir bir mini oyun tür kiti, sanat stili kılavuzu, platform yayımlama betiği (WeChat / Douyin / TikTok / itch.io) veya bir Game Studio iyileştirmesi paylaşın.

| Katkı | Neleri içermeli? |
| --- | --- |
| **Oynanabilir oyun şablonu** | `templates/games/<id>/` altında `index.html`, `game.json`, `cover.webp` ve isteğe bağlı `DESIGN.md` içeren kendi kendine yeten klasör |
| **Tür veya playable-ad tarifi** | Net 3C kuralları, denge değişmezleri ve referans doğrulama notları |
| **Platform yayımlama bağdaştırıcıları** | Mini oyun ve web portalları için paketleme betikleri, bildirim üreteçleri veya gönderim kontrol listeleri |
| **Ajan ve model entegrasyonları** | Ana bilgisayar kurulum bağdaştırıcıları veya BYOK çok kipli sağlayıcı desteği |

[Katkıda Bulun](CONTRIBUTING.md) · [Depo Yönergeleri](AGENTS.md) · [Sorun Bildir](https://github.com/nexu-io/opengame/issues)

<a id="acknowledgements"></a>

## 🙏 Teşekkürler ve Açık Kaynak Atıfları

OpenGame, açık kaynaklı oyun, yaratıcı araçlar ve yapay zekâ ajan topluluğu üzerine inşa edilmiştir ve ondan ilham almaktadır.

### Çekirdek Temeller ve Başlıca İlham Kaynakları

| Proje | Lisans | OpenGame'in Nasıl Yararlandığı / Atıf Yaptığı |
| --- | --- | --- |
| **[Higgsfield AI Skills](https://github.com/higgsfield-ai/skills)** | MIT | [skills/openmotion-game/](skills/openmotion-game/) altında uyarlanan çeşitli oyun tasarımı kılavuzlarının kaynağı ([PROVENANCE.md](skills/openmotion-game/PROVENANCE.md) · [LICENSE-HIGGSFIELD](skills/openmotion-game/LICENSE-HIGGSFIELD)) |
| **[HeyGen Hyperframes](https://github.com/heygen-com/hyperframes)** | Apache-2.0 | Yukarı akış Studio düzenleyici temeli ([studio/LICENSE](studio/LICENSE)) ve otomatik oynanış fragmanı kurgulama ve MP4 oluşturma motoru |
| **[DSH Game Studio](https://github.com/ZSeven-W/dsh-game-studio)** ve **[dsh-games](https://github.com/finiking/dsh-games)** ([@FiniYang](https://x.com/FiniYang)) | Açık Kaynak | DeepSeek Harness (DSH) yapay zekâ odaklı oyun üretim iş akışları, otomatik oynanış testi ve oynanabilir oyun duvarları için erken açık kaynak ilhamı ve referansı |
| **[OpenDesign](https://github.com/nexu-io/open-design)** ve **[OpenMotion](https://github.com/nexu-io/openmotion)** | Apache-2.0 | Paylaşılan açık kaynak tasarım sistemi, çok kipli Model Gateway, çalışma alanı mimarisi ve MCP araç sözleşmeleri |
| **[Three.js](https://github.com/mrdoob/three.js)** | MIT | 3B şablonlara ve ajan üretimi 3B oyunlara güç veren dahili çevrimdışı 3B oluşturma motoru ve model/iskelet yükleyicileri ([LICENSE-three.txt](templates/game-kits/vendor/LICENSE-three.txt)) |
| **[KayKit Adventurers Character Pack](https://www.kaylousberg.com/)** (Kay Lousberg) | CC0 | [templates/game-kits/characters/](templates/game-kits/characters/) altında dahili çevrimdışı iskeletli 3B karakterler (Mage & Knight) ([LICENSE-KayKit.txt](templates/game-kits/characters/LICENSE-KayKit.txt)) |
| **[Cocos Creator / Cocos Engine](https://github.com/cocos/cocos-engine)** | MIT | Çevrimdışı oynanabilir mini oyun şablonlarına güç veren açık kaynak oyun motoru çalışma zamanı |
| **[Model Context Protocol (MCP) SDK](https://github.com/modelcontextprotocol/typescript-sdk)** ve **[Vercel Skills CLI](https://github.com/vercel-labs/skills)** | MIT / Apache-2.0 | 22 yerel yapay zekâ ajanını bağlamak ve hafif Beceri dağıtımı için standart protokol |

Yığınımıza güç veren daha geniş açık kaynak ekosistemine de teşekkür ederiz: **Puppeteer & Chrome for Testing**, **FFmpeg**, **Dockview**, **CodeMirror 6**, **Lexical**, **React**, **Vite**, **Tailwind CSS**, **Zustand**, **Electron**, **GSAP**, **DiceBear** (Micah avatar stili, CC BY 4.0, [atıf](studio/skill-cover-attribution.md)) ve açık kaynak yazı tipleri (**Albert Sans**, **IBM Plex Mono**, **Instrument Serif**, SIL OFL 1.1).

## Katkıda Bulunanlar

Kod, oyun şablonları, beceriler, belgeler, geri bildirimler ve issue'larla katkıda bulunan herkese teşekkürler.

<a href="https://github.com/nexu-io/opengame/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=nexu-io/opengame&amp;max=500&amp;columns=20&amp;anon=1" alt="OpenGame katkıda bulunanlar" />
</a>

## Yıldız Geçmişi

<a href="https://www.star-history.com/#nexu-io/opengame&amp;Date">
  <picture>
    <source srcset="https://raw.githubusercontent.com/nexu-io/opengame/readme-charts/star-history.svg" />
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=nexu-io%2Fopengame&amp;type=Date&amp;theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=nexu-io%2Fopengame&amp;type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=nexu-io%2Fopengame&amp;type=Date" />
  </picture>
</a>
