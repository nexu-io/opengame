export interface CatalogModel {
  id: string;
  title: string;
  provider: string;
  thumbnailUrl?: string;
  sourceUrl?: string;
  license?: string;
  author?: string;
  downloadable: boolean;
}

/** An item-specific handoff for the user or an Agent with local filesystem access. */
export function catalogDownloadPrompt(item: CatalogModel, context: {
  dimension: '2d' | '3d'; conversationId?: string; locale?: string;
}): string {
  const zh = context.locale?.startsWith('zh');
  const is2d = context.dimension === '2d';
  const credit = [item.author, item.license].filter(Boolean).join(' · ');
  const pack = item.provider === 'kenney' || item.provider === 'itchio';
  return [
    zh ? `帮我下载「${item.title}」到当前工作区，并打开预览。` : `Download “${item.title}” into this workspace and open a preview.`,
    [item.sourceUrl, item.id, credit].filter(Boolean).join(' · '),
    pack ? (zh ? '打开素材包页面的下载区，找到包含所选素材的原始压缩包。' : 'Use the download section of the pack page and select the archive containing this asset.')
      : (zh ? '在来源页核对标题、作者和许可，从发布者提供的下载入口获取原始文件。' : 'Confirm the title, author and license on the source page and use the publisher’s original download.'),
    is2d ? (zh ? '优先选原始 PNG 或精灵图集。将图片、图集描述文件和许可放在同一素材目录，保留包内目录结构。' : 'Prefer the original PNG or sprite atlas. Keep the artwork, atlas metadata and license together, preserving their relative paths.')
      : (zh ? '优先选 GLB；如选 glTF，保留 .bin、纹理和材质的相对路径。' : 'Prefer GLB. For glTF, preserve relative paths to buffers, textures and materials.'),
    zh ? '若要求登录、购买或同意条款，请把官方链接和具体步骤给我，由我完成后提供下载文件。只读取素材文件，保留本地修改及署名信息。' : 'If sign-in, payment or accepting terms is required, give me the official link and the specific step so I can supply the downloaded file. Use the asset data, preserve local edits and retain attribution.',
    context.conversationId ? (zh ? `检查实际文件和依赖后，调用 openmotion_asset_manage（action=present_asset，conversationId=${context.conversationId}，path 为工作区相对路径）展示素材。` : `Verify the files and dependencies. Use openmotion_asset_manage with action=present_asset, conversationId=${context.conversationId}, and the workspace-relative path.`)
      : (zh ? '检查文件和依赖后，返回能打开的工作区相对链接。' : 'Verify the files and dependencies, then return a workspace-relative link to the usable asset.'),
  ].join('\n');
}
