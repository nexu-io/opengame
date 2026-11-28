import type { SuperAgentArtifact, SuperAgentChat, SuperAgentResourceAttachment } from '../../../shared/super-agent';

export const assetKindForModality = {
  image: 'asset-image', video: 'asset-video', audio: 'asset-audio', '3d': 'asset-3d',
} as const;

export function isMediaArtifact(kind: SuperAgentArtifact['kind']): kind is typeof assetKindForModality[keyof typeof assetKindForModality] {
  return kind === 'asset-image' || kind === 'asset-video' || kind === 'asset-audio' || kind === 'asset-3d';
}

export function presentedAssetIds(chat: SuperAgentChat) {
  const ids = new Set<string>();
  for (const message of chat.messages) {
    if (message.role !== 'assistant' || !message.id.startsWith('presentation:')) continue;
    for (const id of message.artifactIds ?? []) if (message.id === `presentation:${id}`) ids.add(id);
  }
  return ids;
}

export function mediaArtifactAttachment(artifact: SuperAgentArtifact): SuperAgentResourceAttachment | null {
  if (!artifact.assetId || !isMediaArtifact(artifact.kind)) return null;
  return {
    id: artifact.assetId,
    kind: 'asset',
    title: artifact.title,
    subtitle: artifact.subtitle,
    modality: ({ 'asset-image': 'image', 'asset-video': 'video', 'asset-audio': 'audio', 'asset-3d': '3d' } as const)[artifact.kind],
    versionId: artifact.versionId,
    previewUrl: artifact.url,
  };
}
