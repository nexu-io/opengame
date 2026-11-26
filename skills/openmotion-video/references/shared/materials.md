# 视频素材选择、替换与混合模态边界

需要为视频选择、获取或替换视觉与声音素材时读取；仅查看、预览或导出既有内容不触发本页。全平台通用的[生成边界](../../../openmotion-media/references/materials.md#generation-boundary)、[生成时机阶梯](../../../openmotion-media/references/materials.md#generation-timing-ladder)、[工具发现](../../../openmotion-media/references/materials.md#tool-selection-and-discovery)、[资产命名契约](../../../openmotion-media/references/materials.md#asset-naming)与[跨镜头一致性](../../../openmotion-media/references/materials.md#cross-shot-consistency)归口于 `openmotion-media` 单一真相源，本页保留视频制作专属规则。

## 按素材职责确定来源

用户明确的必用素材、参考用途、来源限制与视觉要求优先于以下默认顺序。同一视频可组合不同来源，逐项判断当前素材承担的是身份呈现、事实证据、主体表演、图解还是氛围。

1. **先复用合适的已有素材。** 检查用户上传、指定以及工程中已确认的材料，核对用途、相关性、身份、质量和使用依据。区分成片必用素材、风格参考与背景资料；上传不等于全部采用。用户要求必用的材料按指定用途保留，存在质量或内容冲突时说明具体影响。已有材料足够时直接复用，缺口再补齐。
2. **既有对象的缺口，默认先检索对应原始素材。** 视频围绕有明确身份、原作或来源的既有对象时，无论真实还是虚构，主动上网检索，并优先将与该对象直接对应的原始素材用于成片，无需用户提醒。优先官方或原始发布来源，核对身份、版本、时期与镜头所需内容。例如哈利波特宣传片优先寻找对应角色、场景或影片素材，通用魔法题材画面不能替代其身份。具体商品还要核对型号、配色和结构。AIGC可补充氛围、转场与概念视觉；生成结果不能充当原作素材或事实证据。
3. **原创与补充表达，按需要生成或程序化制作。** 自创对象、独特场景、氛围、图解以及用户指定的原创视觉，可优先使用AIGC或程序化材料，无需先穷尽网络检索。排印、图形与数据表达可直接使用HTML/SVG/3D等媒介；按观看效果选择。对应原始素材无法取得或不适用时，说明关键缺口及对表达的影响，再选择允许的替代表达，区分原始与生成内容。

用户没有素材或明确不愿提供时，由Agent按上述规则自主补齐，不把上传作为默认前置步骤。沿用禁止联网/生成、限用现有素材等明确约束；仅方案或只读审片不因此自动启动生成、导入或工程修改。

## 取得素材并核对可用性

检索从内容与镜头需要出发，回到原始来源取得可用文件，记录来源页面及使用依据。搜索缩略图用于筛选；取得足够清晰的原文件后再用于成片。可下载不自动代表可商用。来源或使用依据不成立时换其他来源或允许的替代表达；仍保持主体身份与事实边界。

生成时把片中职责写进输入：主体及所需状态、材质/光向/视角、构图、文字空间，以及抠图或拆层需要；需要连续动作时选择可支持该动作的素材形式。先选定合格主体，再用可用的参考编辑或派生能力维持跨镜头身份；各镜头可有不同姿态和状态。生成产品细节与功能仍须依据可靠来源核对。

使用实际可用工具和既有授权，不虚构能力或默默增加付费依赖。查看真实完成的素材；排队成功不算取得文件。失败时按原因修正或切换允许的来源，不无依据地重复请求。

在实际最大取景下检查主体轮廓、细节、结构与文字、光影材质、身份一致性，以及裁切、背景能否支撑构图和所需动作。不合格就更换或修正，再扩建影片。声音素材核对内容、可用时段和用途；实际听感另行试听，未审听如实记录。生成成功、标称分辨率高或文件已导入，都不能替代可用性检查。

复用现有简报、动作脚本或素材记录，保留实际采用文件、来源、用途及重要限制，无需另建必填表。材料与具体动作、占时和跨段状态的配合，按需应用[制作决策与状态延续](decisions.md)。

## Replacing existing shots

Apply this when a template adaptation, recreation or edit generates media to replace shots that already exist in the source film.

When the request names which shots to replace, check each shot against that description and replace only the shots that clearly match. A shot that only partly fits, such as a product, tag or packaging close-up showing only hands or sleeves when the request replaces people, stays outside the request: keep the original shot and fix old brand names, logos or text on it in place with native cover, crop or overlay layers. Offering and approving generated replacements for them follows the [media authorization](../../../openmotion-media/SKILL.md#provider-preference-and-authorization).

Write each replacement's generation input from the original shot. Look at its frames first, then keep its setting and background, lighting, shot size and camera angle, number and placement of people, action, camera movement and duration, changing only what the user asked to change. A description of the new subject, such as "outdoor hardshell jackets", changes the subject, not the setting; move the shot to a new location only when the user asks. Match the shot's role and composition, not its exact pixels or a real person's identity. Compare the result with the original shot on these points before using it.

## Mixed-media recreation boundaries

Apply this when a reference video combines motion graphics with live-action footage, product photography, portraits, narration or music:

- **Faithfully rebuildable**: native editable typography, UI, charts, logos, captions and graphic transitions layered above generated or supplied visual plates and aligned sound, preserving the reference's story, framing, holds and hard cuts.
- **Approximate replacement only (state plainly, never overclaim)**:
  - **Identifiable real people and synced lip performance**: current generation routes do not clone a specific real person's likeness or voice, or produce frame-accurate lip-sync. Use a matching-vibe generated performer or user-supplied footage, and clearly tell the user when new narration plays over a speaking person whose mouth will not match.
  - **Unprovided physical product details or complex multi-object physics**: without clean supplied or official photos, generated pixels cannot guarantee exact logos, ports or inscriptions. Prefer supplied/official imagery first; otherwise disclose the approximation.
  - **Narration mixed inseparably with background music**: do not claim clean vocal removal when stems cannot be split; offer keeping the original mix, muting to build new narration plus music, or waiting for separate audio.
  - **Predominantly live-action footage with minimal editable structure**: tell the user directly that OpenMotion excels at mixed motion graphics, editable overlays/captions and targeted generated shots rather than regenerating an entire live-action film shot-for-shot.

## Recorded speech, transcript review and captions

For existing speech-led material, follow the [transcript workflow](../../../../docs/transcripts.md) for source discovery, recognition, correction and editable captions through `openmotion_assets_use`; configure any needed transcription provider through [openmotion-media](../../../openmotion-media/SKILL.md). When a film also needs newly generated TTS voiceover or script-led captions (and the screen does not already carry those lines as synchronized display typography), follow [narration and editable captions](sound.md#配音与可编辑字幕协同) to bind real timing and keep captions editable. Continue composition edits and delivery through the existing native workflow.
