# Contributing to Sim

Thank you for your interest in contributing to Sim! Our goal is to provide developers with a powerful, user-friendly platform for building, testing, and optimizing agentic workflows. We welcome contributions in all forms—from bug fixes and design improvements to brand-new features.

> **Project Overview:**
> Sim is a Turborepo monorepo with two deployable apps and a set of shared packages:
>
> - `apps/sim/` — the main Next.js application (App Router, ReactFlow, Zustand, Shadcn, Tailwind CSS).
> - `apps/realtime/` — a small Bun + Socket.IO server that powers the collaborative canvas. Shares DB and Better Auth secrets with `apps/sim` via `@sim/*` packages.
> - `apps/docs/` — Fumadocs-based documentation site.
> - `packages/` — shared workspace packages (`@sim/db`, `@sim/auth`, `@sim/audit`, `@sim/workflow-types`, `@sim/workflow-persistence`, `@sim/workflow-authz`, `@sim/realtime-protocol`, `@sim/security`, `@sim/logger`, `@sim/utils`, `@sim/testing`, `@sim/tsconfig`).
>
> Strict one-way dependency flow: `apps/* → packages/*`. Packages never import from apps. Please ensure your contributions follow this and our best practices for clarity, maintainability, and consistency.

---

## Table of Contents

- [How to Contribute](#how-to-contribute)
- [Reporting Issues](#reporting-issues)
- [Pull Request Process](#pull-request-process)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Local Development Setup](#local-development-setup)
- [Adding New Blocks and Tools](#adding-new-blocks-and-tools)
- [License](#license)
- [Contributor License Agreement (CLA)](#contributor-license-agreement-cla)

---

## How to Contribute

We strive to keep our workflow as simple as possible. To contribute:

1. **Fork the Repository**
   Click the **Fork** button on GitHub to create your own copy of the project.

2. **Clone Your Fork**

   ```bash
   git clone https://github.com/<your-username>/sim.git
   cd sim
   ```

3. **Create a Feature Branch**
   Create a new branch with a descriptive name:

   ```bash
   git checkout -b feat/your-feature-name
   ```

   Use a clear naming convention to indicate the type of work (e.g., `feat/`, `fix/`, `docs/`).

4. **Make Your Changes**
   Ensure your changes are small, focused, and adhere to our coding guidelines.

5. **Commit Your Changes**
   Write clear, descriptive commit messages that follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/#specification) specification. This allows us to maintain a coherent project history and generate changelogs automatically. For example:

   - `feat(api): add new endpoint for user authentication`
   - `fix(ui): resolve button alignment issue`
   - `docs: update contribution guidelines`

6. **Push Your Branch**

   ```bash
   git push origin feat/your-feature-name
   ```

7. **Create a Pull Request**
   Open a pull request against the `staging` branch on GitHub. Please provide a clear description of the changes and reference any relevant issues (e.g., `fixes #123`).

---

## Reporting Issues

If you discover a bug or have a feature request, please open an issue in our GitHub repository. When opening an issue, ensure you:

- Provide a clear, descriptive title.
- Include as many details as possible (steps to reproduce, screenshots, etc.).
- **Tag Your Issue Appropriately:**
  Use the following labels to help us categorize your issue:
  - **active:** Actively working on it right now.
  - **bug:** Something isn't working.
  - **design:** Improvements & changes to design & UX.
  - **discussion:** Initiate a discussion or propose an idea.
  - **documentation:** Improvements or updates to documentation.
  - **feature:** New feature or request.

> **Note:** If you're uncertain which label to use, mention it in your issue description and we'll help categorize it.

---

## Pull Request Process

Before creating a pull request:

- **Ensure Your Branch Is Up-to-Date:**
  Rebase your branch onto the latest `staging` branch to prevent merge conflicts.
- **Follow the Guidelines:**
  Make sure your changes are well-tested, follow our coding standards, and include relevant documentation if necessary.
- **Reference Issues:**
  If your PR addresses an existing issue, include `refs #<issue-number>` or `fixes #<issue-number>` in your PR description.

Our maintainers will review your pull request and provide feedback. We aim to make the review process as smooth and timely as possible.

---

## Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/#specification) standard. Your commit messages should have the following format:

```
<type>[optional scope]: <description>
```

- **Types** may include:
  - `feat` – a new feature
  - `fix` – a bug fix
  - `docs` – documentation changes
  - `style` – code style changes (formatting, missing semicolons, etc.)
  - `refactor` – code changes that neither fix a bug nor add a feature
  - `test` – adding or correcting tests
  - `chore` – changes to tooling, build process, etc.
  - `high priority` – a high priority feature or fix
  - `high risk` – a high risk feature or fix
  - `improvement` – an improvement to the codebase

_Examples:_

- `feat[auth]: add social login integration`
- `fix[ui]: correct misaligned button on homepage`
- `docs: update installation instructions`

Using clear and consistent commit messages makes it easier for everyone to understand the project history and aids in automating changelog generation.

---

## Local Development Setup

To set up your local development environment:

### Option 1: Using NPM Package (Simplest)

The easiest way to run Sim locally is using our NPM package:

```bash
npx simstudio
```

After running this command, open [http://localhost:3000/](http://localhost:3000/) in your browser.

#### Options

- `-p, --port <port>`: Specify the port to run Sim on (default: 3000)
- `--no-pull`: Skip pulling the latest Docker images

#### Requirements

- Docker must be installed and running on your machine

### Option 2: Using Docker Compose

```bash
# Clone the repository
git clone https://github.com/<your-username>/sim.git
cd sim

# Start Sim
docker compose -f docker-compose.prod.yml up -d
```

Access the application at [http://localhost:3000/](http://localhost:3000/)

#### Using Local Models

To use local models with Sim:

1. Install Ollama and pull models:

   ```bash
   # Install Ollama (if not already installed)
   curl -fsSL https://ollama.ai/install.sh | sh

   # Pull a model (e.g., gemma3:4b)
   ollama pull gemma3:4b
   ```

2. Start Sim with local model support:

   ```bash
   # With NVIDIA GPU support
   docker compose --profile local-gpu -f docker-compose.ollama.yml up -d

   # Without GPU (CPU only)
   docker compose --profile local-cpu -f docker-compose.ollama.yml up -d

   # If hosting on a server, update the environment variables in the docker-compose.prod.yml file
   # to include the server's public IP then start again (OLLAMA_URL to i.e. http://1.1.1.1:11434)
   docker compose -f docker-compose.prod.yml up -d
   ```

### Option 3: Using VS Code / Cursor Dev Containers

Dev Containers provide a consistent and easy-to-use development environment:

1. **Prerequisites:**

   - Visual Studio Code or Cursor
   - Docker Desktop
   - [Remote - Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) extension for VS Code

2. **Setup Steps:**

   - Clone the repository:

     ```bash
     git clone https://github.com/<your-username>/sim.git
     cd sim
     ```

   - Open the project in VS Code/Cursor.
   - When prompted, click "Reopen in Container" (or press F1 and select "Remote-Containers: Reopen in Container").
   - Wait for the container to build and initialize.

3. **Start Developing:**

   - Run `bun run dev:full` in the terminal or use the `sim-start` alias.
   - This starts both the main application and the realtime socket server.
   - All dependencies and configurations are automatically set up.
   - Your changes will be automatically hot-reloaded.

4. **GitHub Codespaces:**

   - This setup also works with GitHub Codespaces if you prefer development in the browser.
   - Just click "Code" → "Codespaces" → "Create codespace on staging".

### Option 4: Manual Setup

If you prefer not to use Docker or Dev Containers. **All commands run from the repository root unless explicitly noted.**

1. **Clone and Install:**

   ```bash
   git clone https://github.com/<your-username>/sim.git
   cd sim
   bun install
   ```

   Bun workspaces handle dependency resolution for all apps and packages from the root `bun install`.

2. **Set Up Environment Files:**

   We use **per-app `.env` files** (the Turborepo-canonical pattern), not a single root `.env`. Three files are needed for local dev:

   ```bash
   # Main app — large, app-specific (OAuth secrets, LLM keys, Stripe, etc.)
   cp apps/sim/.env.example apps/sim/.env

   # Realtime server — small, only the values shared with the main app
   cp apps/realtime/.env.example apps/realtime/.env

   # DB tooling (drizzle-kit, db:migrate)
   cp packages/db/.env.example packages/db/.env
   ```

   At minimum, each `.env` needs `DATABASE_URL`. `apps/sim/.env` and `apps/realtime/.env` additionally need matching values for `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `INTERNAL_API_SECRET`, and `NEXT_PUBLIC_APP_URL`. `apps/sim/.env` also needs `ENCRYPTION_KEY` and `API_ENCRYPTION_KEY`. Generate any 32-char secrets with `openssl rand -hex 32`.

   The same `BETTER_AUTH_SECRET`, `INTERNAL_API_SECRET`, and `DATABASE_URL` must appear in both `apps/sim/.env` and `apps/realtime/.env` so the two services share auth and DB. After editing `apps/sim/.env`, you can mirror the shared subset into the realtime env in one shot:

   ```bash
   grep -E '^(DATABASE_URL|BETTER_AUTH_URL|BETTER_AUTH_SECRET|INTERNAL_API_SECRET|NEXT_PUBLIC_APP_URL|REDIS_URL)=' apps/sim/.env > apps/realtime/.env
   grep -E '^DATABASE_URL=' apps/sim/.env > packages/db/.env
   ```

3. **Run Database Migrations:**

   Migrations live in `packages/db/migrations/`. Run them via the dedicated workspace script:

   ```bash
   cd packages/db && bun run db:migrate && cd ../..
   ```

   For ad-hoc schema iteration during development you can also use `bun run db:push` from `packages/db`, but `db:migrate` is the canonical command for both local and CI/CD setups.

4. **Run the Development Servers:**

   ```bash
   bun run dev:full
   ```

   This launches both apps with coloured prefixes:

   - `[App]` — Next.js on `http://localhost:3000`
   - `[Realtime]` — Socket.IO on `http://localhost:3002`

   Or run them separately:

   ```bash
   bun run dev          # Next.js app only
   bun run dev:sockets  # realtime server only
   ```

5. **Make Your Changes and Test Locally.**

   Before opening a PR, run the same checks CI runs:

   ```bash
   bun run type-check   # TypeScript across every workspace
   bun run lint:check   # Biome lint across every workspace
   bun run test         # Vitest across every workspace
   ```

### Email Template Development

When working on email templates, you can preview them using a local email preview server:

1. **Run the Email Preview Server:**

   ```bash
   cd apps/sim && bun run email:dev
   ```

2. **Access the Preview:**

   - Open `http://localhost:3000` in your browser.
   - You'll see a list of all email templates.
   - Click on any template to view and test it with various parameters.

3. **Templates Location:**

   - Email templates live in `apps/sim/components/emails/`.
   - Changes hot-reload automatically in the preview.

---

## Adding New Blocks and Tools

Sim is built in a modular fashion where blocks and tools extend the platform's functionality. To maintain consistency and quality, please follow the guidelines below when adding a new block or tool.

> **Use the skill guides for step-by-step recipes.** The repository ships opinionated, end-to-end guides under `.agents/skills/` that cover the exact file layout, conventions, registry wiring, and gotchas for each kind of contribution. Read the relevant SKILL.md before you start writing code:
>
> | Adding…                                                                                     | Read                                                                                |
> | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
> | A new integration end-to-end (tools + block + icon + optional triggers + all registrations) | [`.agents/skills/add-integration/SKILL.md`](../.agents/skills/add-integration/SKILL.md) |
> | Just a block (or aligning an existing block with its tools)                                 | [`.agents/skills/add-block/SKILL.md`](../.agents/skills/add-block/SKILL.md)             |
> | Just tool configs for a service                                                             | [`.agents/skills/add-tools/SKILL.md`](../.agents/skills/add-tools/SKILL.md)             |
> | A webhook trigger for a service                                                             | [`.agents/skills/add-trigger/SKILL.md`](../.agents/skills/add-trigger/SKILL.md)         |
> | A knowledge-base connector (sync docs from an external source)                              | [`.agents/skills/add-connector/SKILL.md`](../.agents/skills/add-connector/SKILL.md)     |
>
> The shorter overview below is a high-level reference; the SKILL.md files are the authoritative source of truth and stay in sync with the codebase.

### Where to Add Your Code

- **Blocks:** Create your new block file under the `apps/sim/blocks/blocks/` directory. The name of the file should match the provider name (e.g., `pinecone.ts`).
- **Tools:** Create a new directory under `apps/sim/tools/` with the same name as the provider (e.g., `apps/sim/tools/pinecone`).

In addition, you will need to update the registries:

- **Block Registry:** Add your block to `apps/sim/blocks/registry.ts`. (`apps/sim/blocks/index.ts` re-exports lookups from the registry; you do not need to edit it.)
- **Tool Registry:** Add your tool to `apps/sim/tools/index.ts`.

### How to Create a New Block

1. **Create a New File:**
   Create a file for your block named after the provider (e.g., `pinecone.ts`) in the `apps/sim/blocks/blocks/` directory.

2. **Create a New Icon:**
   Create a new icon for your block in `apps/sim/components/icons.tsx`. The icon should follow the same naming convention as the block (e.g., `PineconeIcon`).

3. **Define the Block Configuration:**
   Your block should export a constant of type `BlockConfig`. For example:

   ```typescript
   // apps/sim/blocks/blocks/pinecone.ts
   import { PineconeIcon } from '@/components/icons'
   import type { BlockConfig } from '@/blocks/types'
   import type { PineconeResponse } from '@/tools/pinecone/types'

   export const PineconeBlock: BlockConfig<PineconeResponse> = {
     type: 'pinecone',
     name: 'Pinecone',
     description: 'Use Pinecone vector database',
     longDescription: 'A more detailed description of what this block does and how to use it.',
     category: 'tools',
     bgColor: '#123456',
     icon: PineconeIcon,

     subBlocks: [
       {
         id: 'operation',
         title: 'Operation',
         type: 'dropdown',
         required: true,
         options: [
           { label: 'Generate Embeddings', id: 'generate' },
           { label: 'Search Text', id: 'search_text' },
         ],
         value: () => 'generate',
       },
       {
         id: 'apiKey',
         title: 'API Key',
         type: 'short-input',
         placeholder: 'Your Pinecone API key',
         password: true,
         required: true,
       },
     ],

     tools: {
       access: ['pinecone_generate_embeddings', 'pinecone_search_text'],
       config: {
         tool: (params: Record<string, any>) => {
           switch (params.operation) {
             case 'generate':
               return 'pinecone_generate_embeddings'
             case 'search_text':
               return 'pinecone_search_text'
             default:
               throw new Error('Invalid operation selected')
           }
         },
       },
     },

     inputs: {
       operation: { type: 'string', description: 'Operation to perform' },
       apiKey: { type: 'string', description: 'Pinecone API key' },
       searchQuery: { type: 'string', description: 'Search query text' },
       topK: { type: 'string', description: 'Number of results to return' },
     },

     outputs: {
       matches: { type: 'any', description: 'Search results or generated embeddings' },
       data: { type: 'any', description: 'Response data from Pinecone' },
       usage: { type: 'any', description: 'API usage statistics' },
     },
   }
   ```

4. **Register Your Block:**
   Add your block to the blocks registry (`apps/sim/blocks/registry.ts`):

   ```typescript
   // apps/sim/blocks/registry.ts
   import { PineconeBlock } from '@/blocks/blocks/pinecone'

   // Registry of all available blocks
   export const registry: Record<string, BlockConfig> = {
     // ... existing blocks
     pinecone: PineconeBlock,
   }
   ```

   The block will be automatically available to the application through the registry.

5. **Test Your Block:**
   Ensure that the block displays correctly in the UI and that its functionality works as expected.

### How to Create a New Tool

1. **Create a New Directory:**
   Create a directory under `apps/sim/tools/` with the same name as the provider (e.g., `apps/sim/tools/pinecone`).

2. **Create Tool Files:**
   Create separate files for each tool functionality with descriptive names (e.g., `fetch.ts`, `generate_embeddings.ts`, `search_text.ts`) in your tool directory.

3. **Create a Types File:**
   Create a `types.ts` file in your tool directory to define and export all types related to your tools.

4. **Create an Index File:**
   Create an `index.ts` file in your tool directory that imports and exports all tools:

   ```typescript
   // apps/sim/tools/pinecone/index.ts
   import { fetchTool } from './fetch'
   import { generateEmbeddingsTool } from './generate_embeddings'
   import { searchTextTool } from './search_text'

   export { fetchTool, generateEmbeddingsTool, searchTextTool }
   ```

5. **Define the Tool Configuration:**
   Your tool should export a constant with a naming convention of `{toolName}Tool`. The tool ID should follow the format `{provider}_{tool_name}`. For example:

   ```typescript
   // apps/sim/tools/pinecone/fetch.ts
   import { ToolConfig, ToolResponse } from '@/tools/types'
   import { PineconeParams, PineconeResponse } from '@/tools/pinecone/types'

   export const fetchTool: ToolConfig<PineconeParams, PineconeResponse> = {
     id: 'pinecone_fetch', // Follow the {provider}_{tool_name} format
     name: 'Pinecone Fetch',
     description: 'Fetch vectors from Pinecone database',
     version: '1.0.0',

     // OAuth configuration (if applicable)
     provider: 'pinecone', // ID of the OAuth provider

     params: {
       parameterName: {
         type: 'string',
         required: true,
         visibility: 'user-or-llm', // Controls parameter visibility
         description: 'Description of the parameter',
       },
       optionalParam: {
         type: 'string',
         required: false,
         visibility: 'user-only',
         description: 'Optional parameter only user can set',
       },
     },
     request: {
       // Request configuration
     },
     transformResponse: async (response: Response) => {
       // Transform response
     },
   }
   ```

6. **Register Your Tool:**
   Update the tools registry in `apps/sim/tools/index.ts` to include your new tool:

   ```typescript
   // apps/sim/tools/index.ts
   import { fetchTool, generateEmbeddingsTool, searchTextTool } from '@/tools/pinecone'
   // ... other imports

   export const tools: Record<string, ToolConfig> = {
     // ... existing tools
     pinecone_fetch: fetchTool,
     pinecone_generate_embeddings: generateEmbeddingsTool,
     pinecone_search_text: searchTextTool,
   }
   ```

7. **Test Your Tool:**
   Ensure that your tool functions correctly by making test requests and verifying the responses.

8. **Generate Documentation:**
   Run the documentation generator (from `apps/sim`) to create docs for your new tool:

   ```bash
   cd apps/sim && bun run generate-docs
   ```

### Naming Conventions

Maintaining consistent naming across the codebase is critical for auto-generation of tools and documentation. Follow these naming guidelines:

- **Block Files:** Name should match the provider (e.g., `pinecone.ts`)
- **Block Export:** Should be named `{Provider}Block` (e.g., `PineconeBlock`)
- **Icons:** Should be named `{Provider}Icon` (e.g., `PineconeIcon`)
- **Tool Directories:** Should match the provider name (e.g., `tools/pinecone/`)
- **Tool Files:** Should be named after their function (e.g., `fetch.ts`, `search_text.ts`)
- **Tool Exports:** Should be named `{toolName}Tool` (e.g., `fetchTool`)
- **Tool IDs:** Should follow the format `{provider}_{tool_name}` (e.g., `pinecone_fetch`)

### Parameter Visibility System

Sim implements a sophisticated parameter visibility system that controls how parameters are exposed to users and LLMs in agent workflows. Each parameter can have one of four visibility levels:

| Visibility    | User Sees | LLM Sees | How It Gets Set                |
| ------------- | --------- | -------- | ------------------------------ |
| `user-only`   | ✅ Yes    | ❌ No    | User provides in UI            |
| `user-or-llm` | ✅ Yes    | ✅ Yes   | User provides OR LLM generates |
| `llm-only`    | ❌ No     | ✅ Yes   | LLM generates only             |
| `hidden`      | ❌ No     | ❌ No    | Application injects at runtime |

#### Visibility Guidelines

- **`user-or-llm`**: Use for core parameters that can be provided by users or intelligently filled by the LLM (e.g., search queries, email subjects)
- **`user-only`**: Use for configuration parameters, API keys, and settings that only users should control (e.g., number of results, authentication credentials)
- **`llm-only`**: Use for computed values that the LLM should handle internally (e.g., dynamic calculations, contextual data)
- **`hidden`**: Use for system-level parameters injected at runtime (e.g., OAuth tokens, internal identifiers)

#### Example Implementation

```typescript
params: {
  query: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm', // User can provide or LLM can generate
    description: 'Search query to execute',
  },
  apiKey: {
    type: 'string',
    required: true,
    visibility: 'user-only', // Only user provides this
    description: 'API key for authentication',
  },
  internalId: {
    type: 'string',
    required: false,
    visibility: 'hidden', // System provides this at runtime
    description: 'Internal tracking identifier',
  },
}
```

This visibility system ensures clean user interfaces while maintaining full flexibility for LLM-driven workflows.

### Guidelines & Best Practices

- **Code Style:** Follow the project's Biome configurations. Use meaningful variable names and small, focused functions.
- **Documentation:** Clearly document the purpose, inputs, outputs, and any special behavior for your block/tool.
- **Error Handling:** Implement robust error handling and provide user-friendly error messages.
- **Parameter Visibility:** Always specify the appropriate visibility level for each parameter to ensure proper UI behavior and LLM integration.
- **Testing:** Add unit or integration tests to verify your changes when possible.
- **Commit Changes:** Update all related components and registries, and describe your changes in your pull request.

Happy coding!

---

## License

This project is licensed under the Apache License 2.0. By contributing, you agree that your contributions will be licensed under the Apache License 2.0 as well.

---

## Contributor License Agreement (CLA)

By contributing to this repository, you agree that your contributions are provided under the terms of the Apache License Version 2.0, as included in the LICENSE file of this repository.

In addition, by submitting your contributions, you grant Sim, Inc. ("The Licensor") a perpetual, irrevocable, worldwide, royalty-free, sublicensable right and license to:

- Use, copy, modify, distribute, publicly display, publicly perform, and prepare derivative works of your contributions.
- Incorporate your contributions into other works or products.
- Re-license your contributions under a different license at any time in the future, at the Licensor's sole discretion.

You represent and warrant that you have the legal authority to grant these rights and that your contributions are original or you have sufficient rights to submit them under these terms.

If you do not agree with these terms, you must not contribute your work to this repository.

---

Thank you for taking the time to contribute to Sim. We truly appreciate your efforts and look forward to collaborating with you!
