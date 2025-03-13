# Sim Studio

[![Discord](https://img.shields.io/badge/Discord-Join%20Server-7289DA?logo=discord&logoColor=white)](https://discord.gg/pQKwMTvNrg) [![Twitter](https://img.shields.io/twitter/follow/simstudio?style=social)](https://x.com/simstudioai) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Sim Studio** is a powerful, user-friendly platform for building, testing, and optimizing agentic workflows.

## Run

1. Run on our [cloud-hosted version](https://simstudio.ai)
2. Self-host

## How to Self-Host

Fork this repository by clicking the "Fork" button at the top right of this page.

> **Note:** Ensure you have VS Code or another editor, git, npm, and Docker (if you're not setting up manually) installed on your system.

There are several ways to self-host Sim Studio:

### Option 1: Docker Environment (Recommended)

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/sim.git
cd sim

# Create environment file
cp sim/.env.example sim/.env

# Start the Docker environment
docker compose up -d
# Or use the helper script
./scripts/start_simstudio_docker.sh
```

After running these commands:

1. **Access the Application**:

   - Open [http://localhost:3000/w/](http://localhost:3000/w/) in your browser
   - The `/w/` path is where the main workspace interface is located

2. **Useful Docker Commands**:

   ```bash
   # View application logs
   docker compose logs -f simstudio

   # Access PostgreSQL database
   docker compose exec db psql -U postgres -d simstudio

   # Stop the environment
   docker compose down

   # Rebuild and restart (after code changes)
   docker compose up -d --build
   ```

### Option 2: Dev Containers

1. Open VS Code or your favorite VS Code fork (Cursor, Windsurf, etc.)
2. Install the [Remote - Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
3. Open the project in your editor
4. Click "Reopen in Container" when prompted
5. The environment will automatically be set up in the `sim` directory
6. Run `npm run dev` in the terminal or use the `sim-start` alias

### Option 3: Manual Setup

1. **Install Dependencies**

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/sim.git
cd sim/sim

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
