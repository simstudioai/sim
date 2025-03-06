# Sim Studio

[![Twitter](https://img.shields.io/twitter/follow/simstudio?style=social)](https://x.com/simstudioai) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Sim Studio** is a powerful, user-friendly platform for building, testing, and optimizing agentic workflows.

## Run

1. Self-host
2. [Join the Waitlist](https://simstudio.ai) for the cloud-hosted beta

## Quick Start

There are several ways to get started with Sim Studio:

### Option 1: Docker Environment (Recommended)

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/sim.git
cd sim

# Start the Docker environment
docker compose up -d
# Or use the helper script
./scripts/start_simstudio_docker.sh
```

### Option 2: [Cursor](https://cursor.sh) / [VS Code](https://code.visualstudio.com) Dev Containers

For the best development experience:

1. Install [Cursor](https://cursor.sh) or [VS Code](https://code.visualstudio.com)
2. Install the [Remote - Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
3. Open the project in Cursor or VS Code
4. Click "Reopen in Container" when prompted
5. Run `npm run dev` in the terminal

### Option 3: Manual Setup

If you prefer not to use Docker or Dev Containers:

1. **Install Dependencies**

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/sim.git
cd sim

# Install dependencies
npm install
```

2. **Set Up Environment**

```bash
# Copy .env.example to .env
cp .env.example .env

# Configure your .env file with:
# - Database connection (PostgreSQL)
# - Authentication settings
```

3. **Set Up Database**

```bash
# Push the database schema
npx drizzle-kit push
```

4. **Start Development Server**

```bash
# Start the development server
npm run dev
```

5. **Open [http://localhost:3000](http://localhost:3000) in your browser**

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
