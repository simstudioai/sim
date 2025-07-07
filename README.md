<p align="center">
  <img src="apps/sim/public/static/sim.png" alt="247 Workforce Logo" width="500"/>
</p>

<p align="center">
  <a href="https://www.apache.org/licenses/LICENSE-2.0"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License: Apache-2.0"></a>
  <a href="https://discord.gg/Hr4UWYEcTT"><img src="https://img.shields.io/badge/Discord-Join%20Server-7289DA?logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://x.com/247workforce"><img src="https://img.shields.io/twitter/follow/247workforce?style=social" alt="Twitter"></a>
  <a href="https://github.com/247workforce/workforce/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs welcome"></a>
  <a href="https://docs.247workforce.com"><img src="https://img.shields.io/badge/Docs-visit%20documentation-blue.svg" alt="Documentation"></a>
</p>

<p align="center">
  <strong>247 Workforce</strong> is a lightweight, user-friendly platform for building AI agent workflows.
</p>

<p align="center">
  <img src="apps/sim/public/static/demo.gif" alt="247 Workforce Demo" width="800"/>
</p>

## Getting Started

1. Use our [cloud-hosted version](https://247workforce.com)
2. Self-host using one of the methods below

## Self-Hosting Options

### Option 1: NPM Package (Simplest)

The easiest way to run 247 Workforce locally is using our [NPM package](https://www.npmjs.com/package/247-workforce-cli?activeTab=readme):

```bash
npx 247-workforce-cli
```

After running these commands, open [http://localhost:3000/](http://localhost:3000/) in your browser.

#### Options

- `-p, --port <port>`: Specify the port to run 247 Workforce on (default: 3000)
- `--no-pull`: Skip pulling the latest Docker images

#### Requirements

- Docker must be installed and running on your machine

### Option 2: Docker Compose

```bash
# Clone the repository
git clone https://github.com/247workforce/workforce.git

# Navigate to the project directory
cd workforce

# Start 247 Workforce
docker compose -f docker-compose.prod.yml up -d
```

## Features

- **Visual Workflow Builder**: Drag-and-drop interface for creating AI agent workflows
- **AI Agent Automation**: Build intelligent agents that can automate complex tasks
- **Real-time Collaboration**: Work together with your team in real-time
- **Extensive Tool Library**: Access to hundreds of pre-built tools and integrations
- **Custom Blocks**: Create your own custom blocks and tools
- **Deployment**: Deploy your workflows with a single click
- **Analytics**: Monitor and analyze your workflow performance

## Documentation

Visit our [documentation](https://docs.247workforce.com) for detailed guides, tutorials, and API references.

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

This project is licensed under the Apache 2.0 License - see the [LICENSE](LICENSE) file for details.

## Support

- **Documentation**: [docs.247workforce.com](https://docs.247workforce.com)
- **Discord**: [Join our community](https://discord.gg/Hr4UWYEcTT)
- **Twitter**: [@247workforce](https://x.com/247workforce)
- **GitHub Issues**: [Report bugs or request features](https://github.com/247workforce/workforce/issues)