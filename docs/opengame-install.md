# Install OpenGame {{VERSION}}

If you are reading this file in the source repository and see `{{...}}`, it is a template, not a published installation instruction. Do not guess a package name or version.

This guide installs **OpenGame** (`{{PACKAGE_SPEC}}`, channel **{{CHANNEL}}**), a local stdio MCP service with Game Studio and game authoring Skills. Supported native targets: {{TARGETS}}. Requires Node.js 22.18+ with npm.

## Instructions for the Agent

1. Confirm OS/CPU, Node.js/npm version, and the current Agent host once. Do not infer the host from other CLIs on PATH; configure only the active host and preserve unrelated MCP servers, Skills, and projects.
2. Run the single setup command matching the current host below. For a test candidate, pass isolated `--home`, `--data-dir`, and `--skills-dir` paths.
3. For npm network failures, retry once with `npm_config_registry=https://registry.npmmirror.com npm_config_fetch_retries=0` keeping the exact package spec `{{PACKAGE_SPEC}}`. Stop immediately on permission or checksum errors.
4. After setup succeeds:
   - Verify the connection with `opengame_get({ id: "tidebreaker" })` (if native tools are not loaded in the current chat yet, use the returned `directAccess` command without asking the user to restart).
   - Open `gameStudio.previewUrl` (or call `openmotion_open_preview({ target: "game" })`) in the host's built-in browser when available; otherwise share the link. Do not create a placeholder game.

<!-- opengame-utm-source-supported -->

## Setup commands

| Current Agent | Setup command | Notes |
| --- | --- | --- |
| Codex | `npx --yes --package "{{PACKAGE_SPEC}}" opengame setup --host codex` | Preserves `CODEX_HOME` and installs isolated `opengame-workflows` Skills. |
| Claude Code | `npx --yes --package "{{PACKAGE_SPEC}}" opengame setup --host claude` | Preserves `CLAUDE_CONFIG_DIR` and registers `mcpServers.opengame`. |
| DeepSeek Harness | `npx --yes --package "{{PACKAGE_SPEC}}" opengame setup --host deepseek --profile PROFILE` | Replace `PROFILE` with the active Harness profile. |
| WorkBuddy | `npx --yes --package "{{PACKAGE_SPEC}}" opengame setup --host workbuddy` | Preserves `WORKBUDDY_CONFIG_DIR` and registers `mcpServers.opengame`. |
| Any other local Agent | `npx --yes --package "{{PACKAGE_SPEC}}" opengame setup --host AGENT` | Replace `AGENT` with the lowercase Agent name (for example `opencode`). Add the returned `agentRegistration.transport` as local stdio MCP `opengame`. |

## Runtime, updates and recovery

- Setup installs into `~/.local/share/opengame` (isolated from `~/.local/share/openmotion`), keeps Game Studio bundled locally, starts headless Chrome preparation in the background, and defers FFmpeg until `opengame_trailer` is used or `opengame prepare --with-trailer` is run.
- Background updates check npm (`latest` / `test`), verify package integrity and live MCP handshake before staging, swap atomically when idle, and roll back automatically if a new version fails to start.
- Manual controls: `opengame update [--check]`, `opengame rollback`, `opengame diagnose --host HOST`, `opengame prepare --with-trailer`.

Release identity: source `{{COMMIT}}`; npm tgz SHA256 `{{TGZ_SHA256}}`.
