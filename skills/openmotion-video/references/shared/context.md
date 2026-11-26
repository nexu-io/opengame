# 视频共享上下文与按范围读集

本页归口视频域（`openmotion-video`）的共享执行边界与按范围参考索引。首轮进入 `openmotion-video` 后直接读取命中的子工作流文件，仅在需要核对依赖范围、冷启动最小读集或聊天静态分镜预览时按需查阅本页；已有上下文继续有效。

## 中途换入口

根据当前目标、保持项与工程状态选择本轮子工作流；工程最初来自模板、原创还是复刻，不构成永久路线。各子工作流适用范围见 [openmotion-video 入口](../../SKILL.md) 或 [production 导航](../../workflows/production.md#专业导航与旧调用兼容)。续作沿用既定决定和已完成操作，范围变化时只补齐新增所需的参考文档。

## 工具连接

视频任务在第一条相关回复里说明将用 OpenMotion 执行。宿主按需加载工具时，先搜索并确认已连接的 OpenMotion 工具；读过指引只是拿到规范，实际发起宿主 MCP 调用后才能说用过工具。仅需方案时可只交付方案、不建工程；确认制作后再通过已连接工具建工程并打开可编辑预览。

OpenMotion 工具缺失或调用失败时立刻报告连接状态与恢复办法，创建或导入前按 [连接诊断与恢复](production.md#tool-transport-and-workspace-readiness) 处理。通过 npm 安装的平铺 Skill 可读取入口旁的 `openmotion-install.json`（`runtimeRoot` 指向运行时与共享 `docs/`）；完整包或薄插件按 `scope.json.runtimeRoot` 定位，不要从当前工程猜测服务路径。

## OpenMotion 能力优先

工程编写、时间线修改、预览和导出使用 OpenMotion。素材缺口先按内容需要判断检索、生成还是原生图形，再按 [共享工具选择规则](../../../openmotion-media/references/materials.md#tool-selection-and-discovery) 选工具。Hyperframes 指引只在 [原生引擎边界](native.md#engine-guidance-boundary) 内提供技术编写与渲染约束；选路、素材来源、供应商配置与交付由 OpenMotion 负责。

## 先补齐阅读缺口，再执行当前范围

每轮只补读“本次必需 − 正文仍在上下文中的已读文档”的差集，可并发只读拉取；若长文档输出被截断，须分段读完再继续。续作不因进入新一轮而重读仍在上下文里的正文，只在正文丢失、截断、版本变化或任务扩围时补读。

以下是按范围的参考索引（不是强制遍历清单；`references` 是发现索引，不代表每个目标都必读）：

| 本次范围 | 必需参考（可复用已读正文） |
| --- | --- |
| 选择、获取或替换视频素材 | [视频素材规则](materials.md) 与 [全平台生成边界](../../../openmotion-media/references/materials.md#generation-boundary)；确认需要 AIGC 时按需读取 [openmotion-media](../../../openmotion-media/SKILL.md) |
| 字体选择、文字层级调整或字体问题诊断 | [Typography](typography.md)；局部改字只检查受影响文案，原样预览/导出与纯声音任务不触发 |
| 原创新片／大幅重编 | `workflows/director.md` 负责自己的创作读集；受影响内容应用共享 [审片](review.md) |
| 既定声音决定下的音轨调整、配音字幕协同与画面锁定 | [声音执行与配音字幕协同](sound.md)、声音相关 [审片](review.md)；需要新设计声音叙事时再由 director 读取声音叙事参考 |
| 原样使用模板、不做修改 | Editor-only uses the [editable preview handoff](native.md#editable-preview-handoff). Explicit file delivery applies [delivery scope](production.md#delivery-scope), [source pinning](native.md#pin-source-for-independent-deliverables) and [verification scope](verification.md#verification-scope). |
| 使用／适配可编辑模板 | ID／来源未明确时读 [模板能力说明](templates.md)；内容修改按影响审片，原样渲染不加载创作规范 |
| 视频转可复用模板 | 按 [参考视频读取与测量](reference-video.md) 检查原片；按影响应用 [制作决策](decisions.md)、[审片](review.md) 与 [可移植工程](portable-project.md) |
| 复刻视频 | [参考视频读取与测量](reference-video.md)、[制作决策](decisions.md) 及实际原片；明确要求审片或修改时再读 [审片](review.md) |
| 修改已有内容（含声音、模板替换与重编） | 追加 [共享修改流程](edit.md)；首次创作或仅查看／导出不加载 |
| 多段画面、截图、复现对象或跨段状态延续 | 追加 [制作决策](decisions.md) |
| 操作工程／编写原生代码 | [运行规范](production.md)；编写原生代码前另读 [Native authoring](native.md) 与固定版本引擎指南 |
| 导出／验证已有成片 | [运行规范](production.md)、[验证](verification.md) |

## 按范围收紧读集的例子

| 当前请求 | 本次所需的共享正文 |
| --- | --- |
| 局部改字，保持字形气质、排版意图和声音 | [修改流程](edit.md)、[运行规范](production.md)、[原生编写](native.md) 与受影响范围的 [审片](review.md)。保留现有字体，不因改字加载原创动作脚本或字体目录。 |
| 换已选现成音乐，画面锁定 | [修改流程](edit.md)、[素材规范](materials.md)、[运行规范](production.md)、[声音执行](sound.md) 与声音相关的 [审片](review.md)；需要改源文件时再用 [原生编写](native.md) 和引擎指南。 |
| 原样模板，明确要 HTML／工程文件 | 应用 [运行规范](production.md)、[源版本固定](native.md#pin-source-for-independent-deliverables) 与 [验证范围](verification.md#verification-scope)；不触发 MP4 导出或原创设计。 |
| 原样模板，明确要 MP4 | 沿用相同的固定版本文件顺序和 [验证](verification.md)，检查已完成任务的技术校验与实际播放。 |

## 读取结果返回后，再决定依赖它的操作

尚缺的规范或目标源文件须先通过独立只读调用完成并返回给模型，再在后续调用中执行套模板、导入、写文件或导出。固定引擎指南通过 `resources/read openmotion://engine/SKILL.md` 或已返回的 `authoringGuide` 读取，不为读指南而打开工作室。

## 会话与产物归属

操作工程时先用 `openmotion_get_project({projectId})` 核对项目、`sessionId` 与当前版本；无 `projectId` 时先查列表。新建工程用 `openmotion_create_project`，宿主聊天 ID 不自动等于 OpenMotion `sessionId`。何时打开可编辑预览见 [Native 工程循环](native.md#project-loop) 第 6 步。

## 在聊天中展示静态创作预览

需要让用户比较创作方向或看分镜时，支持聊天内 HTML 的 Codex 可执行 `node scripts/inline-storyboard.mjs --manifest /absolute/preview.json --output /absolute/chat-visualization/preview-v1.html`，原样放入返回的 `contentReference`；宿主不支持时按同一顺序展示单张图片与标签。

- 清单共用本地化 `title`、`openLabel`、`backLabel`，每张卡片提供 `title`、`alt` 与清单同目录图片文件名 `image`。
- 方向比较传 `previewType: "creative_directions"` 与 2–3 个带 `id`/`note` 的 `directions`（对应 A–C）；分镜传最多 12 张带 `time`/`note` 的 `frames`。动态验证仍用可播放样片。

## 共享质量，按职责应用

声明自行负责交付与审片范围的子工作流，按其声明上限执行；其余按对应审片与 [验证](verification.md) 执行。Motion 质量是基础职责，不以用户是否说“丝滑”作为前提；声音用实际音轨核对，画面锁定时不得改动视觉内容。规范要求表达、证据与连续性，不预设固定镜头数、转场配额或统一速度。

处理或命名任何新素材时，统一遵循 [共享资产命名契约](../../../openmotion-media/references/materials.md#asset-naming)。
