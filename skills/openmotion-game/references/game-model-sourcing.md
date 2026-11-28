# Find and acquire a game model

Choose the source from the request. “Get the lighthouse from this game” calls for the original asset. “Find a low-poly lighthouse for my game” calls for a reusable model. When the user wants both, label originals and alternatives separately. If the distinction affects the result and the wording is ambiguous, ask which they mean.

## From a game or project

1. Start in the supplied installation, asset pack or project directory. If only the game title is known, establish the installation or official mod kit location. Inspect its file listing for the requested object and engine signatures. A game title, archive extension or display name alone may match several formats or variants.
2. Prefer a loose GLB, glTF, FBX or OBJ when available. Copy the chosen file, its dependent buffers, textures, material files and any supplied license into a new folder in the conversation workspace. Preserve relative paths. Keep the source installation intact.
3. For packed assets, use the game's supported exporter or mod kit if available. Otherwise select a compatible installed tool from the evidence below. Inspect its version and actual export options before using it. List matching objects and export the requested mesh or character with its material and skeleton dependencies. Write into a separate export directory.

| Evidence in the supplied files | Extraction route |
| --- | --- |
| Unity `*_Data` directory with serialized assets, or UnityFS bundles | Use `unity-inventory` below. `unity-extract` exports textures through UnityPy or a Unity project through a compatible installed AssetRipper. Use a compatible Unity exporter on the recovered project to obtain an interchange mesh. [AssetRipper](https://github.com/AssetRipper/AssetRipper) |
| Unreal `Content/Paks` with `.pak` or paired `.utoc` and `.ucas` files, or loose cooked packages | Use `unreal-index`, `unreal-search` and `unreal-export` below. Retain companion `.uexp` and `.ubulk` files. FModel is another viewer on compatible hosts. [FModel](https://github.com/4sval/FModel) |
| A confirmed Overwatch installation | Use OWLib DataTool to list heroes and unlocks, then select the requested hero and skin. OW-specific exports can require the OWM Blender importer before GLB export. [DataTool](https://github.com/overtools/OWLib) |

For other engines, identify the documented importer for that title and version. If a reader cannot open the package or the required exporter is unavailable, report the exact input format and missing prerequisite. Ask for an official export or offer a catalog alternative with the user's agreement. Carry the original asset's usage terms separately from the extraction tool's license.

### Run local tools from a filesystem-capable host

Use Python 3.11+ and the [host adapter](../scripts/game_model_tools.py) in the installed `openmotion-game` Skill or source checkout. The commands below assume the Skill directory is the working directory. Use trusted local installations of the indicated versions. The adapter checks the upstream entry script or release executable against its pinned SHA-256 before launching it. Check out Python sources with their original LF endings, including on Windows. Supply a specific, authorized project, fixture or pack. Keep output in a new directory outside the input, under an existing parent. Inspect the exit status, output manifest and emitted files before reporting delivery.

| Tool | Set up the host |
| --- | --- |
| AnimVault | Set `OPENMOTION_ANIMVAULT` to the checkout root at `fc8044b763b2672b3ee2bc9032059ef52e92627d`, or pass `--checkout /path/to/AnimVault`. The identifier scans naming and executable signatures. Inventory groups files by their headers. Manifest validation requires `jsonschema` in the Python environment used to launch the adapter. A missing seed file is a separate upstream warning even when schema validation succeeds. [Source and requirements](https://github.com/Thazzeus-ML/AnimVault/tree/fc8044b763b2672b3ee2bc9032059ef52e92627d) |
| NeoXider Unity extraction | Set `OPENMOTION_UNITY_EXTRACTION` to the checkout root at `479dd8891a47032265b587f3f344a144d53dbad0`, or pass `--checkout /path/to/unity-asset-extraction`. Use the adapter with a Python environment containing UnityPy 1.25.4 for object inventory and texture export. On Windows, `unity-extract --assetripper /path/to/AssetRipper.GUI.Free.exe` selects the upstream SHA-256-pinned GUI v2 backend. Inspect `manifest.json` for classes, output files, coverage and unresolved dependencies. Exit 2 indicates partial results. [Upstream usage, limits and backend pin](https://github.com/NeoXider/unity-asset-extraction/tree/479dd8891a47032265b587f3f344a144d53dbad0) |
| uex | Use the official self-contained **v0.1.0** Linux x64 or Windows x64 executable in a trusted tools directory. Set `OPENMOTION_UEX`, pass `--uex /path/to/uex`, or put `uex` on `PATH`. The adapter recognizes both official binary hashes. Use the project's CUE4Parse engine version, such as `GAME_UE5_4`, and supply a matching local `--mappings file.usmap` when needed. The adapter uses a temporary profile scoped to the supplied directory and passes no keys. Check `data.archives`, file counts and warnings before interpreting an empty search. Stop if the archive remains locked. Use loose authorized packages or request an official export. [Release](https://github.com/3L0935/uex/releases/tag/v0.1.0) · [Command definitions](https://github.com/3L0935/uex/blob/5d04ae88d8ee8a748fdee465f302bc5633790dd8/src/Program.cs) |

```sh
python3 scripts/game_model_tools.py identify /path/to/authorized-project
python3 scripts/game_model_tools.py inventory /path/to/unpacked-assets
python3 scripts/game_model_tools.py validate /path/to/animvault-manifest.json

python3 scripts/game_model_tools.py unity-inventory /path/to/bundle --output /workspace/inventory
python3 scripts/game_model_tools.py unity-extract /path/to/bundle --output /workspace/textures

python3 scripts/game_model_tools.py unreal-index /path/to/Paks --version GAME_UE5_4
python3 scripts/game_model_tools.py unreal-search /path/to/Paks BlueCube --version GAME_UE5_4
python3 scripts/game_model_tools.py unreal-export /path/to/Paks Content/SM_BlueCube.uasset --version GAME_UE5_4 --mappings /path/to/project.usmap --output /workspace/cube
```

`unreal-index` runs upstream `info` to mount and count files. `unreal-search` passes a literal query to upstream regex search and pages 200 paths at a time (`--offset 200` for the next page, `--all` to include non-packages). `unreal-export` requests `--mesh-format Gltf2` for one selected package and collects its files. Non-mesh packages can produce JSON. Inspect `items[].class`, `files`, mesh geometry and dependencies before presenting a model. When opening sidecar-backed packages, point the adapter at the directory containing the package files.

### Fixture verification

- **AnimVault, macOS arm64.** Ran `identify` on a copy of Unity's bundle named `test.unity3d` (Unity guess, low confidence), and `inventory` on AnimVault's `tests/fixtures` (one 1,016-byte binary glTF). With `jsonschema` installed, `validate` accepted an example manifest and rejected an empty JSON object with exit 1 and eight missing fields. Engine inference and schema validation are distinct from inspecting mesh geometry or playback. [AnimVault fixture](https://github.com/Thazzeus-ML/AnimVault/tree/fc8044b763b2672b3ee2bc9032059ef52e92627d/tests/fixtures)
- **NeoXider, macOS arm64, Python 3.12 with UnityPy 1.25.4.** Ran `unity-inventory` and `unity-extract` on UnityDataTools `TestCommon/Data/AssetBundles/2021.3.0f1/assetbundle`. Inventory reported seven Mesh objects, two Texture2D objects and two AnimationClips. Export produced two PNGs decoded at 2048×2048 and 256×256. Both commands returned partial with three unresolved references. This run exercised the real UnityPy backend. Windows AssetRipper execution and Unity project re-import remain unverified here. [Unity test fixture](https://github.com/Unity-Technologies/UnityDataTools/tree/bc8bc17fcfe15612856f6b1ceb065801b61316b9/TestCommon/Data/AssetBundles/2021.3.0f1) · [Unity Companion License](https://github.com/Unity-Technologies/UnityDataTools/blob/bc8bc17fcfe15612856f6b1ceb065801b61316b9/LICENSE.md)
- **uex, Debian 12 with Rosetta Linux x64 execution.** Copied the `.uasset` and `.uexp` files from UAssetAPI's UE5.4 `BlankGame` fixture to a directory named `Content`. Ran the three Unreal commands above against that directory using the fixture's `BlankGame_Dumper-7.usmap`. `info` indexed four packages, `search BlueCube` returned two candidates, and `export Content/SM_BlueCube.uasset` produced a 5,124-byte GLB containing 24 positions and 36 indices. The same release reported a locally packed, unencrypted copy as locked with zero mounted archives. The successful export used the loose packages. Windows binary execution and IoStore conversion remain unverified here. [BlankGame fixture](https://github.com/atenfyr/UAssetAPI/tree/05910ba8f6d278201120e10d87adbb06dfb3a097/UAssetAPI.Tests/TestAssets/TestUE5_4/BlankGame) · [uex exporter](https://github.com/3L0935/uex/blob/5d04ae88d8ee8a748fdee465f302bc5633790dd8/src/CmdAssets.cs)

## From model catalogs

Use the subject, visual style and intended use as search terms. Filter for requirements that change the choice, such as a rig and named animation, poly count, file format, or a license permitting the intended use. Search at least one appropriate catalog and broaden to another when matches are poor.

- **3D Asset Server** supplies the Studio game asset catalog. Use `dimension: "2d"` with `search_models` or `browse_models` for sprite sheets, tiles and UI art, or `dimension: "3d"` for models. Use `openmotion_asset_manage` with `{"action":"search_models","query":"low-poly lighthouse"}` for candidates. To show the catalog in the target conversation, use `{"action":"browse_models","conversationId":"<conversation UUID>","query":"lighthouse"}`. Select a downloadable result, check its source page and terms, then call `{"action":"acquire_model","conversationId":"<conversation UUID>","id":"<selected result ID>"}`. Source-page-only listings need provider-side download steps. Local game acquisition uses the filesystem adapter above. [3D Asset Server](https://github.com/arielshad/3d-asset-server)

- **Kenney** is a starting point for stylized game kits. Search the 3D asset packs, inspect the pack contents and license, and extract the matching model and dependencies. [Kenney assets](https://kenney.nl/assets)
- **Poly Haven** is a starting point for realistic props and environments. Search its models and inspect the chosen asset's available files. Where the API is available under the applicable terms, `GET /assets?t=models` returns catalog entries and `GET /files/{asset_id}` returns file variants. For glTF, fetch the selected resolution's `gltf` file and every entry in its `include` map, preserving the map keys as relative filenames. Use the asset page's download option when working through the website. [Model catalog](https://polyhaven.com/models) · [API and terms](https://polyhaven.com/our-api)

For a shortlist, return a few actual items with source page, format, license and relevant differences. When the user requested a download and a candidate meets the brief, retrieve the published model or pack. Keep attribution with the files. A catalog thumbnail only supports a recommendation.

### When the catalog links to the provider

Use the selected result's `sourceUrl`, item ID and title. On Kenney and itch.io, find the original pack in the creator's download section. On OpenGameArt, use the attachments under **Files**. For a model marketplace, inspect the formats offered for that item. Choose GLB or a complete glTF bundle for 3D, or the original image and its sheet metadata for 2D. If the site asks for a login, purchase or license acceptance, send the user the item page and identify that step. Resume from the original file they provide. If the site offers no original download, report that outcome.

Extract the selected files into a fresh folder inside the current workspace, preserving relative paths. Keep the license and attribution. Verify the decoded image or model and its companion files, then use `present_asset` with the real `conversationId` and workspace-relative `path`. Studio's **Ask Agent to download** action inserts the selected asset and source page into the current conversation's editable draft. The user sends the request when ready.

## Verify and deliver

Open the model with a compatible reader. Check that it contains mesh geometry and that referenced buffers and textures resolve inside the export folder. If a rig or action was requested, inspect the skin and clip list. State which properties were verified and identify any missing dependency. Preserve the original if conversion is needed for preview.

Return a workspace-relative link to the verified model, the source title or catalog URL, and the applicable license or known reuse limits. Follow the game Skill's chat preview instructions when the user asks to open it in Studio. MCP-only hosts can acquire supported catalog downloads through `acquire_model`. For local tools, use a host with filesystem access and call `present_asset` on the resulting workspace file.
