# sim-setup

Set up and manage a self-hosted Sim installation.

```bash
npx sim-setup
```

Outside a Sim source checkout, the command creates a Docker Compose installation using published
images. Inside a Sim source checkout, use `bun run sim-setup` to expose the complete development
and deployment wizard.

To connect or replace the Chat API key without rerunning the full wizard:

```bash
npx sim-setup add chat
```
