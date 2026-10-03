# Sim CLI

Sim CLI allows you to run [Sim](https://sim.ai) using Docker with a single command.

## Installation

To install the Sim CLI globally, use:

```bash
npm install -g simstudio
```

## Usage

To start Sim, simply run:

```bash
simstudio
```

### Options

- `-p, --port <port>`: Specify the port to run Sim on (default: 3000).
- `--no-pull`: Skip pulling the latest Docker images.

## Requirements

- Docker must be installed and running on your machine.

## Data and secrets

Everything lives under `~/.simstudio`:

- `data/postgres` — the database volume.
- `secrets.env` — secrets generated for this install on first run, then reused.

Keep `secrets.env`. `ENCRYPTION_KEY` and `API_ENCRYPTION_KEY` decrypt data already stored in the
database, so replacing them leaves that data unreadable. Back the file up alongside `data/`.

You can supply your own values by editing it. The format is `KEY=value`, one per line, with `#`
for comments — quotes are not interpreted, so leave them off.

| Key | Requirement |
|---|---|
| `ENCRYPTION_KEY`, `API_ENCRYPTION_KEY` | exactly 64 hex characters (`openssl rand -hex 32`) |
| `BETTER_AUTH_SECRET`, `INTERNAL_API_SECRET` | at least 32 characters, otherwise free-form |

A value that does not meet its requirement is regenerated on the next run. When that replaces
something you had set, the CLI says so and copies the previous file to `secrets.env.bak-<time>`.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

This project is licensed under the Apache-2.0 License. 