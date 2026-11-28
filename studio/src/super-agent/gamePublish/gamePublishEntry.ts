import type { GameCard } from '../../../../shared/game-contract';
import type { SuperAgentArtifact } from '../../../../shared/super-agent';
import { bundledGames, communityGames } from '../../motion/game/gameCatalog';
import type { GamePublishLinkTarget } from './gamePublishAdapter';
import type { GamePublishOpenInput } from './gamePublishStore';

/**
 * Shared trial/template check for game artifacts.
 * Only local workspace games (`source === 'mine'`) can enter the platform publish wizard;
 * bundled templates, community games, and external-only trials cannot be packaged/published.
 */
export function isTrialGameArtifact(
  artifact: SuperAgentArtifact | null | undefined,
  catalogSource?: GameCard['source'] | null,
): boolean {
  if (artifact?.kind !== 'game-project') return false;
  const projectId = artifact.projectId;
  if (!projectId) return true;
  if (catalogSource === 'template' || catalogSource === 'community') return true;
  return bundledGames.some(game => game.id === projectId)
    || communityGames.some(game => game.id === projectId);
}

/** Returns the local workspace game ID when the artifact is eligible for the publish wizard. */
export function resolvePublishableGameId(
  artifact: SuperAgentArtifact | null | undefined,
  catalogSource?: GameCard['source'] | null,
): string | undefined {
  if (artifact?.kind !== 'game-project' || !artifact.projectId) return undefined;
  return isTrialGameArtifact(artifact, catalogSource) ? undefined : artifact.projectId;
}

/** Shared OpenDesign Cloud target derivation for `game-project` artifacts (Share popover + Publish wizard). */
export function resolveGameCloudTarget(
  artifact: SuperAgentArtifact | null | undefined,
): { targetId: string; filePath?: string; embedUrl?: string } | null {
  if (artifact?.kind !== 'game-project') return null;
  const targetId = artifact.projectId || (artifact.id.startsWith('game:') ? artifact.id.slice('game:'.length) : '');
  if (!targetId) return null;
  if (artifact.projectId) {
    return { targetId, filePath: artifact.entry };
  }
  if (artifact.url && /^https:\/\//i.test(artifact.url)) {
    return { targetId, embedUrl: artifact.url };
  }
  return null;
}

/** Shared OpenDesign Cloud share target used by both the Artifact Viewer and deliverable cards. */
export function resolveGamePublishLink(
  artifact: SuperAgentArtifact,
): GamePublishLinkTarget | undefined {
  const target = resolveGameCloudTarget(artifact);
  return target ? { ...target, title: artifact.title } : undefined;
}

/** Builds the shared `gamePublishActions` open/toggle payload for a publishable game artifact. */
export function buildGamePublishOpenInput(
  artifact: SuperAgentArtifact,
  options: {
    chatId: string | null;
    catalogSource?: GameCard['source'] | null;
    orientation?: 'portrait' | 'landscape';
    includeLink?: boolean;
  },
): GamePublishOpenInput | null {
  const gameId = resolvePublishableGameId(artifact, options.catalogSource);
  if (!gameId) return null;
  const orientation = options.orientation
    ?? (artifact.scenario === 'portrait'
      ? 'portrait'
      : artifact.scenario === 'landscape'
        ? 'landscape'
        : undefined);
  return {
    artifactId: artifact.id,
    chatId: options.chatId,
    gameId,
    gameTitle: artifact.title,
    ...(orientation ? { orientation } : {}),
    link: options.includeLink === false ? undefined : resolveGamePublishLink(artifact),
    artifact,
  };
}
