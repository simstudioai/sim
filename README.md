# Sim Studio

[![Twitter](https://img.shields.io/twitter/follow/simstudio?style=social)](https://x.com/simstudioai) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Sim Studio** is a powerful, user-friendly platform that allows developers and agents to build, test, and optimize agentic workflows.

## Run

1. Self-host
2. [Join the Waitlist](https://simstudio.ai) for the cloud-hosted beta

## Getting Started

1. Clone the repository

```bash
git clone https://github.com/simstudioai/sim.git
cd sim-studio
```

2. Install dependencies

```bash
npm install
```

3. Set up your environment variables

Copy `.env.example` to `.env` and configure:

- Database connection (PostgreSQL)
- Authentication secret
- Email provider (Resend)

4. Set up the database

```bash
# Push the database schema
npx drizzle-kit push
```

5. Start the development server

```bash
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000)

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
