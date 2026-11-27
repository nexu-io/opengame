import { WorkspaceStore } from '../workspace.ts';
import { ensureService } from '../preview.ts';
import { gameStudioPreview } from '../shared/workspace-url.ts';

// Setup prepares Game Studio without initializing a motion project or opening an OS browser.
const service = await ensureService(new WorkspaceStore());
console.log(JSON.stringify(gameStudioPreview(new URL(service.previewUrl).origin)));
