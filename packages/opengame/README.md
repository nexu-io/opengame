# OpenGame

OpenGame is a local stdio MCP service with a bundled Game Studio and authoring Skills for creating, simulating, playtesting, and publishing playable HTML5 and Three.js web games from local coding Agents.

## Quick start

Configure OpenGame for your current coding Agent host (requires Node.js 22.18+):

```sh
npx --yes opengame setup --host codex
npx --yes opengame setup --host claude
npx --yes opengame setup --host deepseek --profile PROFILE
npx --yes opengame setup --host workbuddy
npx --yes opengame setup --host AGENT
```

Or launch the local stdio MCP server directly:

```sh
npx --yes opengame mcp
```

## Commands

- `opengame setup --host <HOST>` — install the managed local application, Game Studio, Skills, and host MCP registration.
- `opengame mcp` — run the local stdio MCP server (auto-bootstrapping on first use and applying staged updates when idle).
- `opengame update [--check]` — check npm for a newer version, verify package integrity and live MCP handshake, and stage or apply when idle.
- `opengame rollback` — switch back to the previous healthy version and restore its Skills.
- `opengame prepare [--with-trailer]` — wait for headless Chrome (and optionally FFmpeg/ffprobe for `opengame_trailer`).
- `opengame diagnose --host <HOST>` — verify host MCP configuration and run a live handshake probe.
- `opengame tools --host <HOST>` / `opengame call TOOL --args-file FILE.json --host <HOST>` — inspect schemas or invoke tools directly through the installed transport.
- `opengame diagnostics` — save a redacted local diagnostics archive.

## License

Apache-2.0. See `LICENSE` for details.
