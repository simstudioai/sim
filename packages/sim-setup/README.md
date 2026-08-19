# @sim/setup

Set up and manage a self-hosted Sim installation.

```bash
npx @sim/setup
```

Outside a Sim source checkout, the command creates a Docker Compose installation using published
images. Inside a Sim source checkout, it exposes the complete development and deployment wizard.

By default, a standalone installation is written to `./sim`. Use `--dir <path>` to choose a
different directory. The `sim` npm package remains the Sim API CLI; this package intentionally
publishes only the `sim-setup` binary.
