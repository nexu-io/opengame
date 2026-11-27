import {
  CLIENT_CAPABILITIES_META_KEY, ProtocolError, Server, createMcpHandler,
  type Implementation, type ServerCapabilities, type ServerContext,
} from '@modelcontextprotocol/server';

export { serveStdio } from '@modelcontextprotocol/server/stdio';

type McpRequest = { method: string; params?: Record<string, unknown> };
type Dispatch = (message: McpRequest & { jsonrpc: '2.0'; id: string | number }, clientCapabilities: unknown) => Promise<
  { result?: any; error?: { code: number; message: string; data?: unknown } } | null
>;

type Discovery = {
  serverInfo: Implementation;
  capabilities: ServerCapabilities;
  instructions?: string;
};

export function createModernMcpServer(discovery: Discovery, dispatch: Dispatch) {
  const server = new Server(discovery.serverInfo, {
    capabilities: discovery.capabilities,
    instructions: discovery.instructions,
  });
  const forward = async (request: McpRequest, { mcpReq }: ServerContext) => {
    const params = { ...request.params, _meta: { ...mcpReq._meta, ...mcpReq.envelope } };
    const reply = await dispatch({ jsonrpc: '2.0', id: mcpReq.id, method: request.method, params },
      mcpReq.envelope?.[CLIENT_CAPABILITIES_META_KEY]);
    if (!reply) throw new ProtocolError(-32603, 'Missing MCP response');
    if (reply.error) {
      const data = request.method === 'resources/read' && reply.error.code === -32602
        ? { uri: request.params?.uri } : reply.error.data;
      throw new ProtocolError(reply.error.code, reply.error.message, data);
    }
    return reply.result;
  };
  server.setRequestHandler('tools/list', forward);
  server.setRequestHandler('tools/call', forward);
  if (discovery.capabilities.resources) {
    server.setRequestHandler('resources/list', forward);
    server.setRequestHandler('resources/read', forward);
    server.setRequestHandler('resources/templates/list', async () => ({ resourceTemplates: [] }));
  }
  return server;
}

export async function runModernMcpHttp(request: Request, payload: unknown, factory: () => Server) {
  const handler = createMcpHandler(factory, { legacy: 'reject', responseMode: 'json', maxSubscriptions: 0 });
  try {
    const response = await handler.fetch(request, { parsedBody: payload });
    return { status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) };
  } finally {
    await handler.close();
  }
}
