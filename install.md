# Install OpenGame

## 1. Install the main OpenGame Skill

Install the main `opengame` Skill once through the official Skills CLI before continuing:

```sh
npx --yes skills@1.9.0 add nexu-io/opengame --skill opengame --global --agent AGENT --copy --yes
```

Use `codex` for Codex, `claude-code` for Claude Code, or `universal` for DeepSeek Harness (DSH) and other local agents without a dedicated Skills CLI target. For isolated profiles, omit `--global` and run inside the profile directory.

Skip this step if `opengame` is already installed from `nexu-io/opengame` or when `OPENGAME_SKIP_PUBLIC_SKILL=1` is set. Preserve unrelated Skills and telemetry opt-outs, and do not reinstall merely to generate another install event. If the Skills CLI fails or times out, report it briefly and continue with Step 2.

## 2. Set up local Studio and stdio MCP

Skills CLI installs instructions only. Follow [the OpenGame setup guide](docs/opengame-setup.md) to complete the local source checkout, Studio build, and stdio MCP connection in this conversation.
