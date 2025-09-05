# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sim is an AI agent workflow platform that allows users to build and deploy AI agent workflows. It's a monorepo using Turborepo with workspace structure:
- `apps/sim` - Main Next.js application 
- `apps/docs` - Documentation site
- `packages/cli` - NPM CLI package
- `packages/ts-sdk` - TypeScript SDK
- `packages/python-sdk` - Python SDK

## Development Commands

### Essential Commands
```bash
# Install dependencies (uses Bun package manager)
bun install

# Run development servers (Next.js + Socket server)
bun run dev:full

# Run only Next.js dev server
bun run dev

# Run only Socket.io realtime server
bun run dev:sockets

# Build the application  
bun run build

# Run tests
bun run test                  # Run all tests once
cd apps/sim && bun test:watch  # Watch mode for tests
cd apps/sim && bun test:coverage # With coverage

# Run a single test file
cd apps/sim && bun test path/to/file.test.ts

# Linting and formatting (uses Biome)
bun run lint          # Fix linting issues
bun run lint:check    # Check for issues without fixing
bun run format        # Format code
bun run format:check  # Check formatting

# Type checking
bun run type-check

# Database operations (from apps/sim directory)
cd apps/sim
bunx drizzle-kit migrate  # Run migrations
bunx drizzle-kit push     # Push schema changes
bunx drizzle-kit studio   # Open Drizzle Studio
```

## Architecture

### Core Technologies
- **Framework**: Next.js 15 with App Router, React 19
- **Runtime**: Bun (required, version >=1.2.13)
- **Database**: PostgreSQL with pgvector extension (required for embeddings)
- **ORM**: Drizzle ORM
- **Authentication**: Better Auth
- **Realtime**: Socket.io server (`socket-server/`)
- **State Management**: Zustand stores in `stores/`
- **UI Components**: Shadcn UI + Tailwind CSS
- **Flow Editor**: ReactFlow for visual workflow editing
- **Code Style**: Biome for linting/formatting

### Key Architectural Components

**Blocks System (`blocks/`)**: Core workflow building blocks that users compose into AI workflows. Each block type has specific functionality (agents, tools, logic, etc).

**Executor (`executor/`)**: Handles workflow execution runtime, managing the flow of data between blocks and orchestrating tool calls.

**Serializer (`serializer/`)**: Manages workflow serialization/deserialization for storage and execution.

**Tools (`tools/`)**: Collection of tools that AI agents can use (HTTP requests, function execution, etc). Each tool has validation and execution logic.

**Providers (`providers/`)**: AI model provider integrations (OpenAI, Anthropic, etc) with unified interfaces.

**Socket Server (`socket-server/`)**: Realtime WebSocket server for live workflow execution, collaborative features, and real-time updates.

**Stores (`stores/`)**: Zustand stores managing client-side state for execution, console logs, UI state, etc.

### Database Schema
Uses Drizzle ORM with PostgreSQL. Key tables include workflows, executions, users, organizations, knowledge bases. The pgvector extension is required for embedding storage.

### API Structure
- REST APIs in `app/api/` using Next.js Route Handlers
- Trigger.dev for background jobs (when configured)
- WebSocket connections via Socket.io for realtime features

## Code Conventions

- **Imports**: Follow Biome's import organization (React first, packages, then local imports)
- **Components**: Use functional components with TypeScript
- **Styling**: Tailwind CSS utility classes, avoid inline styles
- **File naming**: kebab-case for files, PascalCase for components
- **Path aliases**: Use `@/` for imports from project root
- **Error handling**: Use proper try-catch blocks and error boundaries
- **TypeScript**: Strict mode enabled, avoid `any` types

## Testing Approach

- Test framework: Vitest with React Testing Library
- Test files: `*.test.ts` or `*.test.tsx` alongside source files
- Run tests from `apps/sim` directory
- Mock external services and database calls in tests
- Focus on user behavior and integration tests over implementation details

## Environment Variables

Key environment variables needed (see `apps/sim/.env.example`):
- `DATABASE_URL` - PostgreSQL connection string with pgvector
- `BETTER_AUTH_SECRET` - Authentication secret
- `BETTER_AUTH_URL` - Authentication URL  
- `COPILOT_API_KEY` - For Copilot features (from sim.ai)
- Various AI provider API keys as needed

## Development Tips

- The Socket.io server must be running for realtime features to work (`bun run dev:sockets`)
- PostgreSQL with pgvector extension is required - use Docker image `pgvector/pgvector:pg17` for easy setup
- Use `bun run dev:full` to start both Next.js and Socket servers together
- Biome handles both linting and formatting - configure your editor to use it
- Check existing components before creating new ones to maintain consistency