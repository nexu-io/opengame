import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { gameHttp } from '../game-projects.ts';

function previewHostname(id: string) {
  return `opengame-preview-${createHash('sha256').update(id).digest('hex').slice(0, 24)}.localhost`;
}

export async function startLocalGamePreview(workspace: string, runtimeRoot?: string) {
  const server = createServer(async (req, res) => {
    const port = (server.address() as { port: number }).port;
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const match = /^\/(?:motion-)?api\/games\/([A-Za-z0-9_-]{1,101})\/play\/.+/.exec(url.pathname);
      if (!['GET', 'HEAD'].includes(req.method ?? '') || !req.url?.startsWith('/') || req.url.startsWith('//')
        || !match || req.headers.host !== `${previewHostname(match[1])}:${port}`) {
        res.writeHead(404).end();
        return;
      }
      await gameHttp(req, res, url, workspace, async () => ({}), runtimeRoot, { isolatedPreview: true });
    } catch {
      if (res.headersSent) res.destroy();
      else res.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const port = (server.address() as { port: number }).port;
  return {
    url: (id: string, search = '') => `http://${previewHostname(id)}:${port}/api/games/${encodeURIComponent(id)}/play/index.html${search}`,
    close() { server.close(); server.closeAllConnections(); },
  };
}
