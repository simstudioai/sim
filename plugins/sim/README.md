# Sim plugin

Connects Claude Code or Cursor to Sim, the open-source AI workspace where teams build, deploy, and manage AI agents. The plugin adds Sim's hosted MCP server, `https://mcp.sim.ai/mcp`, so your agent can manage workspaces, run and deploy workflows, and work with tables, knowledge bases, files, and logs.

## Install

Claude Code:

```bash
claude plugin marketplace add simstudioai/sim --sparse .claude-plugin plugins
claude plugin install sim@sim
```

Cursor: use [Add to Cursor](https://cursor.com/install-mcp?name=sim&config=eyJ1cmwiOiJodHRwczovL21jcC5zaW0uYWkvbWNwIn0%3D).

Then sign in to Sim in the browser when your client asks. In Claude Code, open `/mcp` to start sign-in. Access follows your Sim account and workspace roles.

## Self-hosted Sim

This plugin connects to Sim Cloud. For a self-hosted deployment, add your own server URL instead, as described in the [MCP docs](https://docs.sim.ai/mcp/overview).
