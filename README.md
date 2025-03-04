# Sim Studio

<div align="center">
  <img src="https://imgur.com/a/QnSEYrN" alt="Sim Studio Banner" width="600px" />
  <p><b>Build, optimize, and test agent workflows with a powerful visual interface.</b></p>
  <p>
    <a href="https://github.com/simstudioai/sim/stargazers">
      <img src="https://img.shields.io/github/stars/simstudioai/sim?style=flat-square" alt="Stars" />
    </a>
    <a href="https://github.com/simstudioai/sim/network/members">
      <img src="https://img.shields.io/github/forks/simstudioai/sim?style=flat-square" alt="Forks" />
    </a>
    <a href="https://github.com/simstudioai/sim/issues">
      <img src="https://img.shields.io/github/issues/simstudioai/sim?style=flat-square" alt="Issues" />
    </a>
    <a href="https://github.com/simstudioai/sim/blob/main/LICENSE">
      <img src="https://img.shields.io/github/license/simstudioai/sim?style=flat-square" alt="License" />
    </a>
    <a href="https://discord.gg/rTHJynCD">
      <img src="https://img.shields.io/discord/1234567890?style=flat-square&label=Discord" alt="Discord" />
    </a>
  </p>
</div>

## Run

1. Self-host
2. [Join the Waitlist](https://simstudio.ai) for the cloud-hosted beta

## 🚀 Quick Start

### Try Instantly with npx

Sim Studio now supports a quick start option with zero installation required:

```bash
npx sim
```

This downloads and runs Sim Studio with browser localStorage for data persistence. Visit http://localhost:3000 to start building workflows immediately!

### Docker Setup (For Development)

For a full development environment with database support:

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/sim.git
cd sim

# Start the Docker environment
./scripts/start_simstudio_docker.sh
```

### VS Code Dev Container

For the best development experience:

1. Install the VS Code Remote - Containers extension
2. Open the project in VS Code
3. Click "Reopen in Container" when prompted
4. Run `sim-start` in the terminal

## Development Options

### Option 1: Docker (Recommended)

The quickest way to get started with development:

```bash
docker compose up -d
```

Or use the convenience script for automatic setup:

```bash
chmod +x scripts/start_simstudio_docker.sh
./scripts/start_simstudio_docker.sh
```

### Option 2: VS Code / Cursor Dev Containers

For a great development experience with VS Code or Cursor:

1. **Install Prerequisites**

   - Visual Studio Code
   - Docker Desktop
   - Remote - Containers extension for VS Code

2. **Open in Container**

   - Open the project in VS Code
   - When prompted, click "Reopen in Container" (or use F1 → "Remote-Containers: Reopen in Container")
   - Wait for the container to build and initialize

3. **Start Developing**
   - The container automatically sets up your environment
   - Type `sim-start` in the terminal to run the development server

This method works with GitHub Codespaces too - just click "Code" → "Codespaces" → "Create codespace on main".

### Option 3: Manual Setup

If you prefer not to use Docker:

1. **Install dependencies**

```bash
npm install
```

2. **Set up environment variables**

Copy `.env.example` to `.env` and configure:

- Database connection (PostgreSQL)
- Authentication secret
- Email provider (Resend)

3. **Set up the database**

```bash
# Push the database schema
npx drizzle-kit push
```

4. **Start the development server**

```bash
npm run dev
```

5. **Open [http://localhost:3000](http://localhost:3000)**

## Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router)
- **Database**: PostgreSQL with [Drizzle ORM](https://orm.drizzle.team)
- **Authentication**: [Better Auth](https://better-auth.com) with GitHub OAuth
- **UI**: [Shadcn](https://ui.shadcn.com/), [Tailwind CSS](https://tailwindcss.com)
- **State Management**: [Zustand](https://zustand-demo.pmnd.rs/)
- **Flow Editor**: [ReactFlow](https://reactflow.dev/)

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

##

<p align="center">Made with ❤️ by the Sim Studio Team</p>
