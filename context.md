# SimStudio AI - Comprehensive Codebase Context

> **Last Updated**: December 28, 2025
> **Project**: SimStudio AI (Sim)
> **Repository**: Oppulence-Engineering/paperless-automation
> **License**: Apache 2.0

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture & Structure](#architecture--structure)
3. [Tech Stack & Dependencies](#tech-stack--dependencies)
4. [Database & Data Models](#database--data-models)
5. [Frontend Architecture](#frontend-architecture)
6. [Backend & API Structure](#backend--api-structure)
7. [Authentication & Security](#authentication--security)
8. [Configuration & Environment](#configuration--environment)
9. [Build & Deployment](#build--deployment)
10. [Testing Infrastructure](#testing-infrastructure)
11. [Core Business Logic](#core-business-logic)
12. [Third-Party Integrations](#third-party-integrations)
13. [Development Guidelines](#development-guidelines)
14. [Key Metrics & Statistics](#key-metrics--statistics)

---

## Project Overview

### What is SimStudio AI?

**SimStudio AI** is a sophisticated, production-grade **AI workflow automation platform** that enables users to visually design and deploy AI agent workflows with 140+ tool integrations. Think of it as "Zapier meets Claude" - combining visual workflow design with powerful AI capabilities.

### Key Capabilities

- **Visual Workflow Builder**: Drag-and-drop canvas using ReactFlow for designing complex AI workflows
- **AI Agent Execution**: Multi-provider LLM support (OpenAI, Claude, Gemini, Groq, etc.)
- **Real-time Collaboration**: Socket.IO-based collaborative editing
- **140+ Integrations**: Pre-built blocks for Slack, Stripe, Gmail, GitHub, databases, and more
- **Knowledge Base & RAG**: Vector embeddings with semantic search using pgvector
- **Multi-tenant**: Workspace and organization-based access control
- **Enterprise Ready**: SSO (OIDC/SAML), RBAC, audit logging, SOC 2 compliance features

### Project Metadata

| Property | Value |
|----------|-------|
| **Project Type** | Full-stack TypeScript monorepo |
| **Primary Framework** | Next.js 16.1.0-canary (React 19) |
| **Package Manager** | Bun 1.3.3+ |
| **Database** | PostgreSQL with pgvector |
| **ORM** | Drizzle 0.44.5 |
| **Build Tool** | Turborepo 2.7.2 |
| **Total Lines of Code** | ~200,000+ |
| **API Endpoints** | 369+ |
| **Test Files** | 130+ |

---

## Architecture & Structure

### Monorepo Organization

```
paperless-automation/
├── apps/
│   ├── sim/                    # Main Next.js application
│   │   ├── app/               # Next.js App Router (pages & API routes)
│   │   ├── blocks/            # 143 workflow block implementations
│   │   ├── components/        # React components (UI, emails, analytics)
│   │   ├── executor/          # Workflow execution engine
│   │   ├── hooks/             # React hooks (queries, selectors)
│   │   ├── lib/               # Business logic libraries
│   │   ├── providers/         # LLM provider integrations (11 providers)
│   │   ├── socket/            # Socket.IO server
│   │   ├── stores/            # Zustand state management (69 stores)
│   │   ├── tools/             # Tool implementations (140+ integrations)
│   │   └── triggers/          # Workflow trigger integrations
│   └── docs/                  # Fumadocs documentation site
│
├── packages/
│   ├── db/                    # Drizzle ORM schema & migrations
│   │   ├── schema.ts         # 63 tables, 1737 lines
│   │   ├── migrations/       # 138 migration files
│   │   └── drizzle.config.ts
│   ├── logger/                # Shared logging utility
│   ├── ts-sdk/                # TypeScript SDK for external use
│   ├── python-sdk/            # Python SDK
│   ├── cli/                   # CLI for local deployment
│   └── testing/               # Testing utilities (factories, mocks, assertions)
│
├── docker/                    # Dockerfile definitions
│   ├── app.Dockerfile        # Main application (multi-stage)
│   ├── realtime.Dockerfile   # Socket.IO server
│   └── db.Dockerfile         # Migration runner
│
├── helm/                      # Kubernetes Helm charts
│   └── sim/
│       ├── templates/        # K8s resource definitions
│       └── examples/         # 8 value file variants (AWS, Azure, GCP, etc.)
│
├── .github/workflows/         # CI/CD pipelines
│   ├── ci.yml               # Main CI workflow
│   ├── images.yml           # Docker image builds
│   └── test-build.yml       # Testing workflow
│
└── scripts/                   # Shared build scripts
```

### Application Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     User Interface Layer                     │
│  React 19 + Next.js 16 + Tailwind CSS + Radix UI            │
│  ReactFlow (Canvas) + Zustand (State) + React Query         │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────┴────────────────────────────────────┐
│                      API Layer (369 Routes)                  │
│  Next.js Route Handlers + Better Auth + Rate Limiting       │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────┴────────────────────────────────────┐
│                   Business Logic Layer                       │
│  Workflow Executor + Block Handlers + Integrations          │
│  DAG Orchestrator + Loop/Parallel Support                   │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────┴────────────────────────────────────┐
│                     Data Layer                               │
│  PostgreSQL + Drizzle ORM + Redis + Vector DB               │
│  63 Tables + 138 Migrations + pgvector Extension            │
└─────────────────────────────────────────────────────────────┘
```

### Key Architectural Patterns

1. **Separation of Concerns**
   - UI (React components) → Business Logic (lib/) → Data Access (ORM) → Execution Engine

2. **Plugin Architecture**
   - 143 blocks as reusable workflow units
   - Tool registry for dynamic discovery
   - Provider abstraction for LLM flexibility

3. **Event-Driven Design**
   - Socket.IO for real-time updates
   - Trigger.dev for async background jobs
   - Redis pub/sub for distributed events

4. **Type Safety First**
   - Full TypeScript with strict mode enabled
   - Zod validation at all API boundaries
   - Drizzle ORM for type-safe database queries

5. **Observability by Design**
   - OpenTelemetry integration from the start
   - Structured logging with context tracking
   - Per-execution cost and performance metrics

---

## Tech Stack & Dependencies

### Core Framework Stack

#### Frontend/UI
- **Next.js** v16.1.0-canary - React SSR framework with App Router
- **React** v19.2.1 - UI library
- **TypeScript** v5.7.3 - Type-safe development
- **Tailwind CSS** v3.4.1 - Utility-first styling
- **Radix UI** - Headless component primitives (15+ packages)
- **Framer Motion** v12.5.0 - Animation library
- **ReactFlow** v11.11.4 - Interactive node-based UI
- **Lucide React** v0.479.0 - Icon library

#### State Management
- **Zustand** v4.5.7 - Client state (69 stores)
- **TanStack React Query** v5.90.8 - Server state (26 hooks)
- **React Hook Form** v7.54.2 - Form state

#### Backend/API
- **Next.js API Routes** - RESTful endpoints
- **PostgreSQL** 12+ - Primary database
- **Drizzle ORM** v0.44.5 - Type-safe query builder
- **postgres** v3.4.5 - Database driver
- **ioredis** v5.6.0 - Redis client for caching

#### Real-time & Jobs
- **Socket.io** v4.8.1 - WebSocket server/client
- **Trigger.dev** v4.1.2 - Async job orchestration
- **Croner** v9.0.0 - Cron scheduling

#### Authentication
- **Better Auth** v1.3.12 - Modern auth framework
  - OAuth2 (40+ providers)
  - SSO (OIDC/SAML)
  - Email/password with OTP
  - Multi-tenant organizations

#### AI/LLM Providers (11 total)
- **@anthropic-ai/sdk** v0.39.0 - Claude
- **openai** v4.91.1 - GPT models
- **@google/genai** v1.34.0 - Gemini
- **groq-sdk** v0.15.0 - Groq
- **@cerebras/cerebras_cloud_sdk** v1.23.0 - Cerebras
- Plus: Mistral, DeepSeek, xAI, OpenRouter, Ollama, vLLM

#### Developer Tools
- **Turborepo** v2.7.2 - Monorepo build system
- **Biome** v2.0.0-beta.5 - Linting & formatting
- **Vitest** v3.0.8 - Testing framework
- **Husky** v9.1.7 - Git hooks

### Major Third-Party Services

#### Payment & Billing
- **Stripe** v18.5.0 - Payment processing, subscriptions

#### Communication
- **Resend** v4.1.2 - Transactional email
- **Twilio** v5.9.0 - SMS and voice
- **@azure/communication-email** - Azure email service

#### Cloud Storage
- **@aws-sdk/client-s3** v3.779.0 - AWS S3
- **@azure/storage-blob** v12.27.0 - Azure Blob
- Multiple bucket support (logs, files, knowledge, chat)

#### Monitoring & Analytics
- **@opentelemetry/sdk-node** - Distributed tracing
- **posthog-js** v1.268.9 - Product analytics
- **@vercel/og** v0.6.5 - Dynamic OG images

#### Web Automation
- **@browserbasehq/stagehand** v3.0.5 - Browser automation
- **@e2b/code-interpreter** v2.0.0 - Sandboxed code execution

#### Data Processing
- **cheerio** v1.1.2 - HTML parsing
- **unpdf** v1.4.0 - PDF processing
- **xlsx** v0.18.5 - Excel handling
- **mammoth** v1.9.0 - DOCX to HTML

#### Utilities
- **zod** v3.24.2 - Schema validation
- **date-fns** v4.1.0 - Date manipulation
- **nanoid** v3.3.7 - Unique ID generation
- **lodash** v4.17.21 - Utility functions

---

## Database & Data Models

### Database Type & Configuration

**Database:** PostgreSQL 12+ with pgvector extension
**ORM:** Drizzle v0.44.5
**Migration System:** 138 migration files (numbered 0000-0133)

**Connection Configuration:**
```typescript
// Connection pool settings
{
  prepare: false,           // Use non-prepared statements
  idle_timeout: 20,         // Close idle connections after 20s
  connect_timeout: 30,      // Connection establishment timeout
  max: 30,                  // Maximum pool size
  onnotice: () => {}        // Suppress notices
}
```

### Schema Overview (63 Tables)

#### Authentication & Authorization (6 tables)
- `user` - Core user data (id, email, emailVerified, stripeCustomerId, isSuperUser)
- `session` - User sessions (token, expiresAt, activeOrganizationId, ipAddress, userAgent)
- `account` - OAuth/Provider accounts (accountId, providerId, accessToken, refreshToken)
- `verification` - Email/phone verification (identifier, value, expiresAt)
- `permissions` - Entity-based permissions (userId, entityType, entityId, permissionType)
- `ssoProvider` - SSO configurations (issuer, domain, oidcConfig, samlConfig)

#### Workspace & Organization Management (7 tables)
- `organization` - Team organizations (name, slug, logo, creditBalance, orgUsageLimit)
- `member` - Organization members (userId, organizationId, role)
- `workspace` - User workspaces (name, ownerId, billedAccountUserId)
- `workspaceInvitation` - Workspace invitations (email, status, permissions, token)
- `workspaceEnvironment` - Workspace-level variables (variables JSONB)
- `workspaceNotificationSubscription` - Notification preferences
- `workspaceBYOKKeys` - Bring-Your-Own-Key API keys (providerId, encryptedApiKey)

#### Workflow Engine (7 core tables)
- `workflow` - Workflow definitions (name, description, isDeployed, runCount, lastRunAt)
- `workflowFolder` - Workflow organization (name, parentId, color, sortOrder)
- `workflowBlocks` - Workflow nodes/blocks (type, position, enabled, subBlocks, outputs)
- `workflowEdges` - Node connections (sourceBlockId, targetBlockId, handles)
- `workflowSubflows` - Loop/parallel blocks (type, config JSONB)
- `workflowSchedule` - Cron triggers (cronExpression, triggerType, timezone)
- `webhook` - Webhook triggers (path, provider, isActive, failedCount)

#### Execution & Monitoring (5 tables)
- `workflowExecutionLogs` - Execution history (status, trigger, startedAt, totalDurationMs)
- `workflowExecutionSnapshots` - Execution state snapshots (stateHash, stateData JSONB)
- `pausedExecutions` - Paused workflow state (executionSnapshot, pausePoints)
- `resumeQueue` - Resumed execution queue (parentExecutionId, newExecutionId)
- `idempotencyKey` - Idempotency tracking (key, namespace, result)

#### Chat & Copilot (3 tables)
- `chat` - Chat sessions (workflowId, authType, password, allowedEmails, outputConfigs)
- `copilotChats` - Copilot conversations (userId, workflowId, messages JSONB, model)
- `copilotFeedback` - User feedback on AI (userId, chatId, isPositive, feedback)

#### Knowledge Base & RAG (5 tables + vector support)
- `knowledgeBase` - KB definition (userId, workspaceId, embeddingModel, chunkingConfig)
- `document` - Documents in KB (knowledgeBaseId, filename, fileUrl, processingStatus)
  - 7 text tags, 5 number tags, 2 date tags, 3 boolean tags for filtering
- `knowledgeBaseTagDefinitions` - Custom tag schemas (tagSlot, displayName, fieldType)
- `embedding` - Vector embeddings (embedding vector(1536), chunkHash)
  - HNSW index for similarity search
  - TSVector for full-text search
- `docsEmbeddings` - Documentation embeddings (chunkText, sourceDocument, headerLevel)

#### Templates & Sharing (3 tables)
- `templateCreators` - Template creators (referenceType, referenceId, verified)
- `templates` - Workflow templates (workflowId, state JSONB, views, stars, status)
- `templateStars` - Template likes (userId, templateId unique constraint)

#### Billing & Usage (5 tables)
- `userStats` - User usage tracking (totalManualExecutions, totalApiCalls, totalCost)
- `subscription` - Stripe subscriptions (plan, stripeCustomerId, status, seats)
- `apiKey` - API authentication (userId, workspaceId, key unique, type, expiresAt)
- `rateLimitBucket` - Token bucket rate limiting (key, tokens decimal, lastRefillAt)
- `usageLog` - Detailed billing events (userId, category, source, cost, metadata)

#### Settings & Files (5 tables)
- `settings` - User preferences (userId, theme, telemetryEnabled, emailPreferences)
- `environment` - User environment variables (userId, variables JSON)
- `workspaceFile` - Workspace files (workspaceId, key, size, type)
- `workspaceFiles` - File management (userId, workspaceId, context, contentType)
- `memory` - Workspace memory/cache (workspaceId, key, data JSONB, deletedAt)

#### Integration & Tools (3 tables)
- `customTools` - User-defined tools (workspaceId, userId, schema JSON, code)
- `mcpServers` - MCP server configurations (workspaceId, transport, url, headers)
- `invitation` - Organization invitations (email, organizationId, status, expiresAt)

### Special PostgreSQL Features

#### Vector Type (1536 dimensions)
```sql
embedding vector(1536)  -- For OpenAI text-embedding-3-small
```
- HNSW index: `vector_cosine_ops` for efficient similarity search
- Used in `embedding` and `docsEmbeddings` tables

#### TSVector Type (Full-Text Search)
```sql
fts tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
```
- GIN index for efficient FTS queries
- Auto-generated from content columns

#### PostgreSQL Enums (10 defined)
- `notification_type`: 'webhook', 'email', 'slack'
- `notification_delivery_status`: 'pending', 'in_progress', 'success', 'failed'
- `permission_type`: 'admin', 'write', 'read'
- `workspaceInvitationStatus`: 'pending', 'accepted', 'rejected', 'cancelled'
- `templateStatus`: 'pending', 'approved', 'rejected'
- `usageLogCategory`: 'model', 'fixed'
- `usageLogSource`: 'workflow', 'wand', 'copilot'

#### JSONB Support
Extensive use for flexible data storage:
- `workflowBlocks.subBlocks` - Block configuration
- `workflowBlocks.outputs` - Block outputs
- `workflowExecutionSnapshots.stateData` - Execution state
- `workspaceEnvironment.variables` - Environment variables
- `copilotChats.messages` - Chat history

### Database Relationships

**Cascade Delete Strategy:**
- User deletion → cascades to workflows, sessions, settings
- Workspace deletion → cascades to workflows, files
- Workflow deletion → cascades to execution logs, edges
- Knowledge base deletion → cascades to documents, embeddings

**Soft Delete Support:**
- `document.deletedAt`
- `knowledgeBase.deletedAt`
- `memory.deletedAt`
- `mcpServers.deletedAt`

### Indexing Strategy (200+ indexes)

**Index Types:**
- **B-tree**: Standard single and composite indexes
- **HNSW**: Vector similarity search (m=16, ef_construction=64)
- **GIN**: JSONB queries and full-text search
- **Unique**: Data integrity constraints

**Key Indexes:**
- User-centric access patterns (userId, workspaceId)
- Temporal queries (createdAt, updatedAt)
- Soft-delete filtering (WHERE deletedAt IS NULL)
- Tag filtering (tag1-7, number1-5, date1-2)

---

## Frontend Architecture

### UI Framework & Technology

**Core Stack:**
- **React** 19.2.1 with Next.js 16 App Router
- **State Management:** Zustand (69 stores) + TanStack Query (26 hooks)
- **Styling:** Tailwind CSS 3.4 with custom theme
- **Component Library:** Radix UI primitives + Custom EMCN components
- **Canvas:** ReactFlow 11.11.4 for visual workflow editor

### Routing Structure (14 nested layouts)

```
app/
├── layout.tsx                           # Root layout (PostHog, Theme, Query, Session)
├── (landing)/                           # Public pages (light mode forced)
│   ├── login, signup, verify
│   └── terms, privacy, changelog
├── workspace/[workspaceId]/             # Workspace routes
│   ├── layout.tsx                       # Socket provider wrapper
│   └── w/[workflowId]/                 # Workflow editor
│       ├── layout.tsx
│       ├── page.tsx                     # Main editor
│       └── components/                  # Editor components
├── chat/[identifier]/                   # Chat interface
├── playground/                          # Playground page
└── api/                                # 369 API routes
```

### State Management Architecture

**Zustand Stores (69 total):**

**Categories:**
- **Layout State:** sidebar, panel, terminal
- **Workflow State:** workflows, workflow-diff, execution, undo-redo
- **UI State:** chat, notifications, search-modal, settings-modal
- **Data State:** knowledge, logs, folders, variables, custom-tools
- **Settings:** general, environment, settings-modal
- **Advanced:** copilot-training, operation-queue, providers

**Persistence Pattern:**
```typescript
const useSidebarStore = create<SidebarState>()(
  persist(
    (set, get) => ({...}),
    {
      name: 'sidebar-state',
      onRehydrateStorage: () => (state) => {
        // Sync CSS variables after rehydration
      }
    }
  )
)
```

**TanStack React Query (26 hooks):**
- Default: 30s staleTime, 5m gcTime, no refetchOnWindowFocus
- Query hooks: workflows, settings, environment, oauth, providers, knowledge, logs
- Mutation hooks: create/update/delete operations

### Component Organization

**UI Components (26 core):**
```
components/ui/
├── button, dialog, input, select, dropdown-menu
├── slider, switch, checkbox, textarea
├── card, badge, alert, tabs, table
├── popover, tooltip, command, calendar
└── ... (Radix UI wrappers)
```

**EMCN Components (Custom library):**
```
components/emcn/components/
├── tooltip, popover, modal, combobox
├── code-editor, date-picker, breadcrumb
├── pagination, tabs, tree-select, spinner
└── ... (Enhanced custom components)
```

**Feature Components:**
```
app/workspace/[workspaceId]/w/[workflowId]/components/
├── workflow-block/       # Block rendering
├── workflow-edge/        # Edge rendering
├── panel/               # Right panel (Copilot, Editor, Variables)
├── sidebar/             # Left sidebar (workflow list)
├── chat/                # Chat interface
├── terminal/            # Logs display
├── cursors/             # Collaborative cursors
└── training-modal/      # Copilot training
```

### Styling Approach

**Tailwind Configuration:**
```typescript
// tailwind.config.ts
{
  theme: {
    extend: {
      colors: { /* Custom color palette */ },
      animations: {
        'caret-blink', 'slide-left', 'slide-right',
        'dash-animation', 'code-shimmer', 'ring-pulse'
      },
      keyframes: { /* Custom animations */ }
    }
  },
  plugins: [
    tailwindcss-animate,
    '@tailwindcss/typography'
  ]
}
```

**CSS Variables for Layout:**
```css
--sidebar-width: 232px (min), 30% viewport (max)
--panel-width: 260px (min), 40% viewport (max)
--toolbar-triggers-height: 300px
--terminal-height: 196px
```

**Theme System:**
- Light mode: Warm color palette
- Dark mode: Neutral dark palette
- CSS custom properties for theming
- Font weights configurable per theme

### Key UI Features

**1. Workflow Editor Canvas**
- ReactFlow for graph-based UI
- Custom node types: workflowBlock, noteBlock, subflowNode
- Custom edge types with connection logic
- Real-time cursor tracking for collaboration
- Undo/redo support (61KB hook)

**2. Resizable Panels**
- Sidebar: 232px-30vw, collapsible
- Right panel: 260px-40vw, tabs (Copilot, Editor, Variables)
- Terminal: max 70vh, collapsible
- CSS variable-based sizing for SSR compatibility

**3. Chat Interface**
- Floating window: 305x286 (default), 500x600 (max)
- Message history (max 50 messages)
- Attachments support
- Position persistence in localStorage

**4. Command Palette**
- Global command registry
- Keyboard shortcut handler
- Search using cmdk v1.0.0

### Provider Architecture

**Root Providers (layout.tsx):**
```tsx
<PostHogProvider>
  <ThemeProvider>
    <QueryProvider>
      <SessionProvider>
        {children}
      </SessionProvider>
    </QueryProvider>
  </ThemeProvider>
</PostHogProvider>
```

**Workspace Providers:**
- SocketProvider - Real-time WebSocket
- GlobalCommandsProvider - Command palette
- SettingsLoader - Workspace settings
- ProviderModelsLoader - LLM models
- WorkspacePermissionsProvider - RBAC
- TooltipProvider - Radix UI wrapper

### Hooks & Custom Logic

**Major Custom Hooks (27 total):**
- `use-collaborative-workflow` (63KB) - Real-time collaboration
- `use-undo-redo` (61KB) - History management
- `use-execution-stream` - Stream execution results
- `use-knowledge` - Knowledge base operations
- `use-webhook-management` - Webhook CRUD
- `use-subscription-state` - Billing state
- `use-user-permissions` - Permission checking

### Performance Optimizations

1. **Code Splitting**
   - Lazy-loaded components (Chat, OAuth Modal)
   - Suspense boundaries for non-critical UI

2. **React.memo**
   - Main workflow content memoized
   - Prevents unnecessary re-renders

3. **Query Optimization**
   - Shallow comparison with Zustand
   - Selector pattern to prevent re-renders
   - React Query garbage collection (5min)

4. **CSS-Based Layout**
   - CSS variables prevent hydration mismatches
   - Blocking script reads localStorage before React hydrates
   - Immediate visual feedback for resizing

5. **Image Optimization**
   - Next.js Image component
   - Remote pattern configuration (S3, Azure, GitHub)

---

## Backend & API Structure

### Backend Framework & Language

**Framework Stack:**
- **Primary:** Next.js 16.1.0-canary (full-stack React framework)
- **Language:** TypeScript 5.7.3 (strict mode)
- **Runtime:** Node.js 20+, Bun 1.3.3+
- **Database:** PostgreSQL (Drizzle ORM)
- **Build:** Turborepo for monorepo

**Location:** `/apps/sim/`

### API Endpoints (369 total)

**Route Structure:** File-based routing with Next.js App Router
**Pattern:** `/api/{resource}/{id}/{action}`

**Major API Categories:**

#### Authentication & Authorization
```
/api/auth/[...all]                    # Better Auth integration
/api/auth/accounts                    # Account management
/api/auth/reset-password              # Password reset
/api/auth/socket-token                # WebSocket auth token
/api/auth/sso/providers               # SSO provider list
/api/auth/oauth/connections           # OAuth connections
/api/auth/oauth2/shopify/*           # Shopify OAuth flow
/api/auth/trello/*                   # Trello OAuth
```

#### Workflows (Core Feature - 50+ routes)
```
/api/workflows                        # List/create workflows
/api/workflows/[id]                   # CRUD operations
/api/workflows/[id]/execute           # Execute workflow
/api/workflows/[id]/deploy            # Deploy workflow
/api/workflows/[id]/deployments/*     # Deployment management
/api/workflows/[id]/variables         # Variable management
/api/workflows/[id]/paused/*          # Pause/resume handling
/api/resume/[workflowId]/[executionId]/*  # Resume paused
```

#### Copilot/Agent Features (30+ routes)
```
/api/copilot/chat                     # Chat interactions (streaming)
/api/copilot/chats                    # List chats
/api/copilot/api-keys/*               # API key management
/api/copilot/tools/*                  # Tool management
/api/copilot/checkpoints/*            # Savepoint functionality
/api/copilot/training/*               # Training data
/api/copilot/user-models              # User-specific models
/api/copilot/execute-tool             # Tool execution
```

#### Tools Integration (140+ tools)
```
/api/tools/slack/*                    # Slack integration
/api/tools/discord/*                  # Discord integration
/api/tools/gmail/*                    # Gmail automation
/api/tools/stripe/*                   # Stripe payments
/api/tools/github/*                   # GitHub integration
/api/tools/{postgresql,mongodb,neo4j}/*  # Databases
/api/tools/stagehand/*                # Browser automation
... (140+ total tool endpoints)
```

#### Knowledge Base & Documents (20+ routes)
```
/api/knowledge                        # Create/list knowledge bases
/api/knowledge/[id]/documents/*       # Document management
/api/knowledge/[id]/documents/[documentId]/chunks/*  # Chunks
/api/knowledge/search                 # Knowledge base search
/api/knowledge/[id]/tag-definitions/* # Tag management
```

#### Files & Storage
```
/api/files/upload                     # File upload
/api/files/multipart                  # Multipart upload
/api/files/presigned                  # Pre-signed URLs
/api/files/download                   # Download files
/api/files/serve/[...path]            # File serving
```

#### Logging & Monitoring
```
/api/logs                             # Workflow execution logs
/api/logs/[id]                        # Individual log details
/api/logs/execution/[executionId]     # Execution-specific logs
/api/logs/export                      # Export logs
```

#### Organizations & Workspaces
```
/api/organizations                    # Org management
/api/organizations/[id]/members/*     # Member management
/api/organizations/[id]/invitations/* # Invitations
/api/workspaces                       # Workspace CRUD
/api/workspaces/[id]/*                # Workspace operations
```

#### Admin & V1 API (40+ routes)
```
/api/v1/admin/workflows               # Admin workflow management
/api/v1/admin/organizations/*         # Admin org management
/api/v1/admin/users/*                 # Admin user management
/api/v1/admin/subscriptions/*         # Subscription management
```

### Controller/Handler Organization

**API Route Pattern:**
```typescript
// Next.js Route Handler (route.ts)
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // ... business logic
  return NextResponse.json({ data: result })
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  // ... handle POST request
}
```

**Executor Handler Organization:**
```
executor/handlers/
├── agent/                  # Agent block execution
├── api/                    # API call execution
├── condition/              # Conditional logic
├── evaluator/              # Expression evaluation
├── function/               # Function execution
├── generic/                # Generic operations
├── human-in-the-loop/      # Human approval flows
├── router/                 # Routing logic
├── trigger/                # Trigger execution
├── wait/                   # Wait/delay logic
├── workflow/               # Workflow coordination
├── response/               # Response handling
└── variables/              # Variable management
```

### Middleware & Authentication

**Authentication Layers:**

1. **Session-Based Auth (User Routes)**
```typescript
// Using Better Auth
const session = await getSession()
if (!session?.user?.id) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

2. **API Key Auth (V1 API)**
```typescript
// /app/api/v1/auth.ts
const apiKey = request.headers.get('x-api-key')
const result = await authenticateApiKeyFromHeader(apiKey)
```

3. **Internal JWT (Service-to-Service)**
```typescript
// /lib/auth/internal.ts
// 5-minute expiry, signed with INTERNAL_API_SECRET
const token = generateInternalToken({ userId, workspaceId })
```

4. **Socket.IO Auth**
```typescript
// /socket/middleware/auth.ts
const token = socket.handshake.auth?.token
const session = await auth.api.verifyOneTimeToken({ body: { token } })
```

**Middleware Files:**
- `/app/api/v1/middleware.ts` - Rate limiting
- `/app/api/v1/admin/middleware.ts` - Admin auth wrapper
- `/socket/middleware/auth.ts` - Socket authentication
- `/socket/middleware/permissions.ts` - Socket permissions

### API Design Patterns

**Response Format:**
```typescript
// Success
{
  "data": [...],
  "status": 200,
  "pagination": { "total": 100, "limit": 50, "offset": 0 }
}

// Error
{
  "error": "Error message",
  "status": 400/401/403/404/500,
  "code": "ERROR_CODE"
}
```

**Validation:** Zod schemas for all inputs
```typescript
const CreateWorkflowSchema = z.object({
  name: z.string().min(1).max(255),
  workspaceId: z.string().uuid()
})
```

**Pagination:** Query params `limit` (default: 50, max: 250), `offset` (default: 0)

**Streaming:** SSE for copilot chat and long-running operations

**Rate Limiting:**
- Implemented in `/app/api/v1/middleware.ts`
- Subscription-aware limits
- Returns `X-RateLimit-*` headers

### Server Setup

**Main Server (Next.js):**
- Port: 3000 (configurable)
- Development: `bun run dev`
- Production: `bun run build && bun run start`

**Socket.IO Server:**
- **Location:** `/socket/index.ts`
- Port: 3002 (configurable via `SOCKET_PORT`)
- Command: `bun run dev:sockets`
- Health check: `/health` endpoint

**Next.js Configuration:**
```typescript
// next.config.ts
{
  output: 'standalone',              // Docker optimization
  serverExternalPackages: [          // Native modules
    'unpdf', 'ffmpeg-static', 'fluent-ffmpeg',
    'pino', 'ws', 'isolated-vm'
  ],
  experimental: {
    optimizeCss: true,
    turbopackSourceMaps: false,
    turbopackFileSystemCacheForDev: true
  }
}
```

**Environment Configuration:**
- **File:** `/lib/core/config/env.ts`
- Uses `@t3-oss/env-nextjs` + `next-runtime-env`
- 200+ environment variables
- Categories: Database, Auth, AI Providers, Cloud, Billing, Email, SMS

---

## Authentication & Security

### Authentication Framework

**Better Auth v1.3.12** - Modern authentication library

**Configuration Location:** `/apps/sim/lib/auth/auth.ts`

**Features:**
- Database adapter: Drizzle with PostgreSQL
- Session management: 30-day expiry, 24-hour cache
- Plugins: SSO, Stripe integration, Email OTP, Organizations, Generic OAuth

**Session Configuration:**
```typescript
{
  expiresIn: 60 * 60 * 24 * 30,        // 30 days
  updateAge: 60 * 60 * 24,             // 24 hours refresh
  freshAge: 60 * 60,                   // 1 hour fresh
  cookieCache: {
    enabled: true,
    maxAge: 60 * 60 * 24               // 24 hour cache
  }
}
```

### OAuth Provider Support (40+ providers)

**Social OAuth:**
- Google, GitHub, Microsoft, Slack, LinkedIn, Spotify, WordPress, Zoom

**Service Providers:**
- Atlassian (Confluence, Jira)
- Salesforce, HubSpot, Pipedrive, Wealthbox
- Notion, Airtable, Linear, Asana
- Dropbox, Webflow, Reddit, X (Twitter)

**Microsoft Suite:**
- Teams, Excel, Planner, Outlook, OneDrive, SharePoint

**Cloud Platforms:**
- Supabase, Vertex AI

### Multi-Method Authentication

**1. Session-Based (Web UI)**
```typescript
const session = await getSession()
// Returns: { user: { id, email, name, image }, session: { ... } }
```

**2. API Key (External Access)**
```typescript
// Header: x-api-key
// Format: sim_[base64url] or sk-sim-[base64url]
// Types: personal (user-scoped) | workspace (team-scoped)
```

**3. Internal JWT (Service-to-Service)**
```typescript
// Header: Authorization: Bearer [token]
// Expiry: 5 minutes
// Secret: INTERNAL_API_SECRET
```

**4. Socket.IO (WebSocket)**
```typescript
// One-time token from Better Auth
const token = socket.handshake.auth.token
await auth.api.verifyOneTimeToken({ body: { token } })
```

### Authorization & Permissions

**Permission Model:**
```typescript
type PermissionType = 'admin' | 'write' | 'read'  // Level 3, 2, 1
type EntityType = 'workspace' | 'workflow' | 'organization'
```

**Location:** `/lib/workspaces/permissions/utils.ts`

**Key Functions:**
- `getUserEntityPermissions()` - Get highest permission
- `hasAdminPermission()` - Check admin access
- `hasWorkspaceAdminAccess()` - Including owner check
- `getManageableWorkspaces()` - List accessible workspaces

**Permission Storage:**
```sql
permissions (
  userId UUID,
  entityType TEXT,
  entityId UUID,
  permissionType permission_type,
  UNIQUE(userId, entityType, entityId)
)
```

### Security Features

#### Data Encryption
**Location:** `/lib/core/security/encryption.ts`

```typescript
// AES-256-GCM encryption
Algorithm: 'aes-256-gcm'
Key: ENCRYPTION_KEY (32 bytes)
Format: 'iv:encrypted:authTag' (hex-encoded)
```

**Encrypted Fields:**
- API keys (optional dedicated key: `API_ENCRYPTION_KEY`)
- OAuth credentials (access/refresh tokens)
- User-defined secrets

#### Secret Redaction
**Location:** `/lib/core/security/redaction.ts`

**Redacted Patterns:**
- API keys, access tokens, refresh tokens
- Client secrets, private keys, passwords
- Bearer tokens, Basic auth, authorization headers

**Use Cases:**
- Logging (prevent secret leakage)
- Event tracking
- Error reporting

#### Access Control
**Features:**
- Workspace-level isolation
- Role-based permissions (admin, write, read)
- User-scoped API keys with rate limiting
- OAuth scope validation

#### Input Validation
- Zod schema validation on all endpoints
- Code injection prevention (isolated-vm for JavaScript)
- SQL injection prevention via Drizzle ORM
- XSS protection via content sanitization

### Security Hardening

**CORS & Origin Validation:**
```typescript
trustedOrigins: [
  env.BETTER_AUTH_URL,
  env.NEXT_PUBLIC_SOCKET_URL
]
```

**Session Security:**
- Token uniqueness (indexed)
- IP/User-Agent tracking (optional forensics)
- Expiration enforcement
- Cascade deletion on user removal

**Login Restrictions (Enterprise):**
```typescript
ALLOWED_LOGIN_EMAILS: 'user1@example.com,user2@example.com'
ALLOWED_LOGIN_DOMAINS: 'company.com,subsidiary.com'
```

**Rate Limiting:**
```typescript
// Implemented in /app/api/v1/middleware.ts
rateLimitBucket: {
  tokens: decimal,        // Remaining tokens
  lastRefillAt: timestamp // Last refill time
}
```

### API Key Management

**Dual-Format Support:**
- Legacy: `sim_[base64url]` (24 bytes random)
- New: `sk-sim-[base64url]` (24 bytes random)

**Key Attributes:**
- Type: personal | workspace
- Scope: userId or workspaceId
- Expiration: Optional expiry date
- Last used: Timestamp tracking
- Display format: prefix + last 4 chars

**Encryption:**
```typescript
// Encryption flow
const encrypted = encrypt(apiKey, API_ENCRYPTION_KEY)
// Format: 'iv:encrypted:authTag'

// Decryption flow
const decrypted = decrypt(encrypted, API_ENCRYPTION_KEY)
```

**Authentication Flow:**
1. Extract key from `x-api-key` header
2. Query applicable keys (filtered by scope/type)
3. Check expiration
4. Compare against encrypted/plain stored value
5. Verify workspace permissions
6. Update last-used timestamp

### SSO & Enterprise Authentication

**SSO Configuration:**
```typescript
// Environment variables
SSO_ENABLED: 'true'
SSO_PROVIDER_TYPE: 'OIDC' | 'SAML'

// OIDC
OIDC_ENDPOINT, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET

// SAML
SAML_ENTRY_POINT, SAML_CERTIFICATE, SAML_METADATA
```

**Better Auth SSO Plugin:**
- Supports OIDC (OpenID Connect)
- Supports SAML 2.0
- Auto-provisioning users
- Account linking across providers

### Feature Flags (Security-Related)

```typescript
isAuthDisabled              // DISABLE_AUTH - Dev mode only
isEmailVerificationEnabled  // EMAIL_VERIFICATION_ENABLED
isRegistrationDisabled      // REGISTRATION_DISABLED
isSsoEnabled               // SSO_ENABLED
```

---

## Configuration & Environment

### Environment Variables (200+)

**Configuration Framework:**
- `@t3-oss/env-nextjs` v0.13.4 - Zod-based validation
- `next-runtime-env` - Docker runtime injection
- `getEnv()` utility - Fallback to `process.env`

**Configuration File:** `/lib/core/config/env.ts` (371 lines)

### Major Configuration Categories

#### 1. Core Database & Authentication
```bash
DATABASE_URL                   # PostgreSQL connection string
BETTER_AUTH_SECRET            # JWT signing key (min 32 chars)
BETTER_AUTH_URL               # Auth service base URL
DISABLE_AUTH                  # Toggle for self-hosted behind private networks
DISABLE_REGISTRATION          # Disable new user registration
ALLOWED_LOGIN_EMAILS          # Comma-separated email whitelist
ALLOWED_LOGIN_DOMAINS         # Comma-separated domain whitelist
```

#### 2. Security & Encryption
```bash
ENCRYPTION_KEY                # Data encryption key (min 32 chars)
INTERNAL_API_SECRET           # Internal API authentication (min 32 chars)
API_ENCRYPTION_KEY            # Optional dedicated API key encryption (32+ chars)
ADMIN_API_KEY                 # Optional admin API access (min 32 chars)
```

#### 3. AI/LLM Provider Keys (18+ variables)
```bash
# OpenAI
OPENAI_API_KEY
OPENAI_API_KEY_1              # Load balancing support
OPENAI_API_KEY_2
OPENAI_API_KEY_3

# Anthropic
ANTHROPIC_API_KEY_1
ANTHROPIC_API_KEY_2
ANTHROPIC_API_KEY_3

# Google Gemini
GEMINI_API_KEY_1
GEMINI_API_KEY_2
GEMINI_API_KEY_3

# Other Providers
MISTRAL_API_KEY
GROQ_API_KEY
CEREBRAS_API_KEY
DEEPSEEK_API_KEY
XAI_API_KEY

# Local Models
OLLAMA_URL                    # Ollama endpoint
VLLM_BASE_URL                 # vLLM endpoint
VLLM_API_KEY                  # vLLM API key

# Search & Services
SERPER_API_KEY                # Serper search
EXA_API_KEY                   # Exa search
ELEVENLABS_API_KEY            # TTS service
```

#### 4. Cloud Storage

**AWS S3:**
```bash
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION

# S3 Buckets
S3_BUCKET_NAME                # General files
S3_LOGS_BUCKET_NAME           # Execution logs
S3_KNOWLEDGE_BUCKET_NAME      # Knowledge base documents
S3_EXECUTION_BUCKET_NAME      # Execution artifacts
S3_CHAT_BUCKET_NAME           # Chat attachments
S3_COPILOT_BUCKET_NAME        # Copilot files
S3_PROFILES_BUCKET_NAME       # User profiles
S3_OG_BUCKET_NAME             # Open Graph images
```

**Azure Blob Storage:**
```bash
AZURE_ACCOUNT_NAME
AZURE_ACCOUNT_KEY
AZURE_CONNECTION_STRING

# Azure Containers (same categories as S3)
AZURE_CONTAINER_NAME
AZURE_LOGS_CONTAINER_NAME
# ... (8 total containers)
```

#### 5. Billing & Usage Enforcement
```bash
BILLING_ENABLED               # Enable/disable billing enforcement

# Cost Limits per Tier
FREE_TIER_COST_LIMIT
PRO_TIER_COST_LIMIT
TEAM_TIER_COST_LIMIT
ENTERPRISE_TIER_COST_LIMIT

# Storage Limits
FREE_STORAGE_LIMIT_GB=5
PRO_STORAGE_LIMIT_GB=50
TEAM_STORAGE_LIMIT_GB=500
ENTERPRISE_STORAGE_LIMIT_GB=500

# Overage
OVERAGE_THRESHOLD_DOLLARS=50  # Incremental billing threshold

# Stripe
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_ID_FREE
STRIPE_PRICE_ID_PRO
STRIPE_PRICE_ID_TEAM
STRIPE_PRICE_ID_ENTERPRISE
```

#### 6. Rate Limiting (8 variables)
```bash
RATE_LIMIT_WINDOW_MS=60000    # 1 minute window
MANUAL_EXECUTION_LIMIT=999999 # Default limit

# Per-Tier Limits
FREE_TIER_SYNC_LIMIT=10       # 10 req/min
FREE_TIER_ASYNC_LIMIT=50

PRO_TIER_SYNC_LIMIT=25
PRO_TIER_ASYNC_LIMIT=200

TEAM_TIER_SYNC_LIMIT=75
TEAM_TIER_ASYNC_LIMIT=500

ENTERPRISE_TIER_SYNC_LIMIT=150
ENTERPRISE_TIER_ASYNC_LIMIT=1000
```

#### 7. Knowledge Base Processing
```bash
KB_CONFIG_MAX_DURATION=600        # 10 minutes
KB_CONFIG_MAX_ATTEMPTS=3          # Retry attempts
KB_CONFIG_CONCURRENCY_LIMIT=20    # Parallel processes
KB_CONFIG_BATCH_SIZE=20           # Documents per batch
KB_CONFIG_DELAY_BETWEEN_BATCHES=100  # ms delay
```

#### 8. Email & Communications
```bash
# Email Service
RESEND_API_KEY                # Transactional email
FROM_EMAIL_ADDRESS            # Complete from address
EMAIL_DOMAIN                  # Fallback domain
EMAIL_VERIFICATION_ENABLED    # Require email verification

# Azure Communication Services
AZURE_ACS_CONNECTION_STRING

# SMS/Voice
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_PHONE_NUMBER
```

#### 9. Infrastructure & Deployment
```bash
NODE_ENV                      # development, test, production
DOCKER_BUILD                  # Flag for Docker builds
NEXT_RUNTIME                  # Next.js runtime
PORT                          # Application port (default: 3000)
SOCKET_PORT                   # WebSocket port (default: 3002)
SOCKET_SERVER_URL             # Socket.IO server URL
NEXT_PUBLIC_SOCKET_URL        # Client-side socket URL
```

#### 10. Monitoring & Analytics
```bash
LOG_LEVEL                     # DEBUG, INFO, WARN, ERROR
TELEMETRY_ENDPOINT            # Custom telemetry endpoint
COST_MULTIPLIER               # Cost calculation multiplier
DRIZZLE_ODS_API_KEY          # OneDollarStats analytics
NEXT_TELEMETRY_DISABLED       # Disable Next.js telemetry
```

#### 11. Background Jobs
```bash
TRIGGER_PROJECT_ID            # Trigger.dev project
TRIGGER_SECRET_KEY            # Trigger.dev secret
TRIGGER_DEV_ENABLED           # Enable/disable async jobs
CRON_SECRET                   # Cron job authentication
JOB_RETENTION_DAYS=1          # Log retention
```

#### 12. SSO & Enterprise Authentication
```bash
SSO_ENABLED                   # Enable SSO
SSO_PROVIDER_TYPE             # OIDC or SAML

# OIDC Config
OIDC_ENDPOINT
OIDC_CLIENT_ID
OIDC_CLIENT_SECRET
OIDC_SCOPES
OIDC_PKCE_ENABLED

# SAML Config
SAML_ENTRY_POINT
SAML_CERTIFICATE
SAML_METADATA
```

#### 13. Branding & UI Customization
```bash
NEXT_PUBLIC_BRAND_NAME         # Custom brand name
NEXT_PUBLIC_BRAND_LOGO_URL     # Custom logo
NEXT_PUBLIC_BRAND_FAVICON_URL  # Custom favicon
NEXT_PUBLIC_CUSTOM_CSS_URL     # Custom CSS
NEXT_PUBLIC_SUPPORT_EMAIL      # Support contact

# Color Customization (hex format)
NEXT_PUBLIC_PRIMARY_COLOR
NEXT_PUBLIC_PRIMARY_HOVER_COLOR
NEXT_PUBLIC_ACCENT_COLOR
NEXT_PUBLIC_ACCENT_HOVER_COLOR
NEXT_PUBLIC_BACKGROUND_COLOR
```

#### 14. Feature Flags
```bash
NEXT_PUBLIC_TRIGGER_DEV_ENABLED      # Async executions UI
NEXT_PUBLIC_SSO_ENABLED              # SSO login UI
NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED=true
NEXT_PUBLIC_E2B_ENABLED              # Remote code execution
DEEPSEEK_MODELS_ENABLED=false        # DeepSeek model support
```

### Environment-Specific Configuration

#### Development Environment
```bash
# .devcontainer/docker-compose.yml
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@db:5432/simstudio
LOG_LEVEL=DEBUG
DISABLE_AUTH=true              # Optional for local dev
```

#### Production Environment
```bash
# docker-compose.prod.yml
NODE_ENV=production
DATABASE_URL=<managed-database-url>
LOG_LEVEL=ERROR
BILLING_ENABLED=true
SSO_ENABLED=true
```

#### Kubernetes (Helm)
```yaml
# helm/sim/values.yaml
env:
  - name: DATABASE_URL
    valueFrom:
      secretKeyRef:
        name: db-secret
        key: connection-string
  - name: BETTER_AUTH_SECRET
    valueFrom:
      secretKeyRef:
        name: auth-secret
        key: secret
```

### Configuration Management Patterns

**1. Tiered Configuration:**
```
process.env → next-runtime-env → getEnv() utility
```

**2. Feature Flag System:**
```typescript
// /lib/core/config/feature-flags.ts
export const isProd = env.NODE_ENV === 'production'
export const isDev = env.NODE_ENV === 'development'
export const isTest = env.NODE_ENV === 'test'
export const isHosted = env.NEXT_PUBLIC_APP_URL?.includes('simstudio.ai')
export const isBillingEnabled = env.BILLING_ENABLED === 'true'
export const isAuthDisabled = env.DISABLE_AUTH === 'true'
export const isRegistrationDisabled = env.DISABLE_REGISTRATION === 'true'
export const isTriggerDevEnabled = env.TRIGGER_DEV_ENABLED === 'true'
export const isSsoEnabled = env.SSO_ENABLED === 'true'
export const isE2bEnabled = env.NEXT_PUBLIC_E2B_ENABLED === 'true'
```

**3. API Key Rotation:**
```typescript
// /lib/core/config/api-keys.ts
export function getRotatingApiKey(provider: 'openai' | 'anthropic' | 'gemini') {
  const keys = [
    env[`${provider.toUpperCase()}_API_KEY_1`],
    env[`${provider.toUpperCase()}_API_KEY_2`],
    env[`${provider.toUpperCase()}_API_KEY_3`]
  ].filter(Boolean)

  // Round-robin based on current minute
  const index = Math.floor(Date.now() / 60000) % keys.length
  return keys[index]
}
```

**4. Redis Configuration:**
```typescript
// /lib/core/config/redis.ts
{
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port),
  password: redisUrl.password,
  db: 0,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  keepAlive: 30000
}
```

### Secrets Management

**Kubernetes Secrets:**
```yaml
# helm/sim/templates/external-db-secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: external-db-secret
type: Opaque
data:
  connection-string: {{ .Values.externalDatabase.connectionString | b64enc }}
```

**Docker Secrets:**
- Environment variables injected at runtime
- No secrets in image layers
- Support for Docker secrets mounting

**Generation Commands:**
```bash
# Generate secure keys
openssl rand -hex 32  # 32-byte keys (64 hex chars)
```

### Telemetry Configuration

**Location:** `apps/sim/telemetry.config.ts`

```typescript
{
  serviceName: 'sim-studio',
  endpoint: 'https://telemetry.simstudio.ai/v1/traces',

  // Sampling Strategy
  sampling: {
    errors: 1.0,              // 100% of errors
    aiOperations: 1.0,        // 100% of AI/LLM calls
    regular: 0.1              // 10% of regular operations
  },

  // Batch Configuration
  batchSpanProcessor: {
    maxQueueSize: 2048,
    maxBatchSize: 512,
    scheduledDelayMillis: 5000,
    exportTimeoutMillis: 30000
  }
}
```

---

## Build & Deployment

### Package Management

**Package Manager:** Bun v1.3.3+
**Configuration:** `/bunfig.toml`

```toml
[install]
exact = true              # Reproducible installs
frozen = false            # Allow lockfile updates

[install.cache]
enabled = true            # Enable Bun cache
```

### Build Tools & Scripts

**Turborepo Configuration:** `/turbo.json`

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"]
    }
  }
}
```

**Root-Level Scripts:**
```bash
bun run build          # Turbo build all workspaces
bun run dev            # Turbo dev all workspaces
bun run dev:full       # Concurrent app + socket server
bun run test           # Turbo test all
bun run lint           # Biome format + fix
bun run type-check     # TypeScript checking
bun run format         # Format with Biome
bun run release        # Create release
```

**App-Level Scripts:**
```bash
bun run dev            # Next.js dev server
bun run dev:webpack    # Next.js with Webpack
bun run dev:sockets    # Socket.io server
bun run dev:full       # App + realtime concurrent
bun run build          # Production build
bun run test           # Vitest tests
bun run email:dev      # Email component dev
```

### Docker Configuration

**Three Specialized Images:**

#### 1. app.Dockerfile (Main Application)
```dockerfile
# Multi-stage build
FROM oven/bun:1.3.3-slim AS base
FROM base AS deps
FROM deps AS builder
FROM base AS runner

# Optimizations
- APT cache mounts
- Bun cache mounts
- NPM cache mounts
- Python pip cache
- Layer ordering by change frequency

# Features
- Node.js 22 installed
- Python 3 with venv for guardrails
- FFmpeg for media processing
- Non-root user (UID 1001)
- Standalone Next.js output
```

#### 2. realtime.Dockerfile (Socket Server)
```dockerfile
FROM oven/bun:1.3.3-alpine

# Lightweight Alpine-based
# Serves Socket.io on port 3002
# Minimal dependencies
# Non-root execution
```

#### 3. db.Dockerfile (Migrations)
```dockerfile
FROM oven/bun:1.3.3-alpine

# Single-purpose container
# Runs Drizzle migrations
# Exits after completion
```

**Docker Compose Configurations:**

```yaml
# docker-compose.prod.yml
services:
  simstudio:
    image: ghcr.io/simstudioai/simstudio:latest
    ports: ["3000:3000"]
    environment:
      - DATABASE_URL
      - BETTER_AUTH_SECRET
      # ... 200+ env vars
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/status"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  realtime:
    image: ghcr.io/simstudioai/realtime:latest
    ports: ["3002:3002"]

  db:
    image: postgres:17
    volumes:
      - postgres-data:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=simstudio
```

### CI/CD Pipeline

**GitHub Actions Workflows:**

#### Main CI Workflow (`.github/workflows/ci.yml`)
```yaml
name: CI
on:
  push:
    branches: [main, staging]
  pull_request:
    branches: [main, staging]

jobs:
  test-build:
    uses: ./.github/workflows/test-build.yml

  detect-version:
    runs-on: ubuntu-latest
    # Extract version from commit message (v*.*.*)

  build-amd64:
    runs-on: blacksmith-8vcpu-ubuntu-2404
    # Build 3 images for AMD64

  build-arm64:
    runs-on: blacksmith-8vcpu-ubuntu-2404-arm
    # Build 3 images for ARM64 (main only)

  create-manifests:
    # Create multi-arch manifests
```

#### Test & Build Workflow (`.github/workflows/test-build.yml`)
```yaml
jobs:
  test-build:
    runs-on: blacksmith-4vcpu-ubuntu-2404
    steps:
      - Setup Bun 1.3.3
      - Setup Node
      - Sticky disk cache (Bun + node_modules)
      - bun install --frozen-lockfile
      - bun run lint:check
      - bun run test (with coverage)
      - Drizzle schema validation
      - bun run build
      - Upload coverage to Codecov
```

**Blacksmith Runners (Performance):**
- `blacksmith-4vcpu-ubuntu-2404` - Test jobs
- `blacksmith-8vcpu-ubuntu-2404` - Image builds (AMD64)
- `blacksmith-8vcpu-ubuntu-2404-arm` - Image builds (ARM64)
- **Sticky Disk:** Persistent cache across runs
  - Bun cache: `~/.bun/install/cache`
  - node_modules: `./node_modules`

#### Image Build Workflow (`.github/workflows/images.yml`)
```yaml
jobs:
  build-amd64:
    strategy:
      matrix:
        image: [app, migrations, realtime]
    steps:
      - Build Docker image
      - Push to ECR (always for staging/main)
      - Push to GHCR (main only)
      - Tag: latest, {sha}, {version}
```

**Tagging Strategy:**
- **Development:** `staging` tag
- **Production:** `latest`, `{commit-sha}`, `{version}` (if release)
- **Multi-arch:** Separate `-amd64`, `-arm64` tags + unified manifest

**Image Registries:**
- **ECR (AWS):** Primary production registry
- **GHCR (GitHub):** Public mirror for main branch
- **DockerHub:** Available but not primary

### Kubernetes Deployment (Helm)

**Helm Chart Location:** `/helm/sim/`

**Chart Metadata:**
```yaml
# Chart.yaml
apiVersion: v2
name: sim
version: 0.5.45
appVersion: "0.5.45"
kubeVersion: ">=1.19.0-0"
```

**Key Features:**
- PostgreSQL 17 with pgvector (StatefulSet or external)
- Deployments for app and realtime
- CronJobs for scheduled tasks
- HorizontalPodAutoscaler for scaling
- NetworkPolicy support
- ServiceMonitor for Prometheus
- Pod Disruption Budgets for HA
- Shared storage (PVC) for multi-pod data

**8 Value File Examples:**
```
helm/sim/examples/
├── values-aws.yaml              # EKS optimized
├── values-azure.yaml            # AKS optimized
├── values-gcp.yaml              # GKE optimized
├── values-development.yaml      # Dev/testing
├── values-production.yaml       # Generic production
├── values-external-db.yaml      # Managed database
├── values-whitelabeled.yaml     # White-label deployment
└── values-copilot.yaml          # Copilot integration
```

**Example: AWS EKS Deployment**
```yaml
# values-aws.yaml
global:
  storageClass: gp3

app:
  replicas: 3
  resources:
    requests:
      cpu: 1000m
      memory: 2Gi
    limits:
      cpu: 2000m
      memory: 4Gi

  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 10
    targetCPUUtilizationPercentage: 70

ingress:
  enabled: true
  className: alb
  annotations:
    alb.ingress.kubernetes.io/scheme: internet-facing
```

**CronJobs:**
```yaml
# Schedule execution polling (every 1 minute)
scheduleExecution:
  enabled: true
  schedule: "*/1 * * * *"

# Gmail polling (every 1 minute)
gmailPolling:
  enabled: true
  schedule: "*/1 * * * *"

# Outlook polling (every 1 minute)
outlookPolling:
  enabled: true
  schedule: "*/1 * * * *"
```

### Build Optimizations

**1. Layer Caching:**
```dockerfile
# Order by change frequency
COPY package.json bun.lock ./          # Rarely changes
RUN bun install                         # Cache dependencies
COPY . .                                # Source code (changes often)
```

**2. BuildKit Mount Caching:**
```dockerfile
RUN --mount=type=cache,id=bun-cache,target=/root/.bun/install/cache \
    --mount=type=cache,id=npm-cache,target=/root/.npm \
    bun install --frozen-lockfile
```

**3. Next.js Optimization:**
```typescript
// next.config.ts
{
  experimental: {
    optimizeCss: true,               // CSS optimization
    turbopackSourceMaps: false,      // Disable source maps in Turbopack
    turbopackFileSystemCacheForDev: true  // Dev cache
  },
  output: 'standalone'               // Minimal runtime bundle
}
```

**4. Turborepo Incremental Builds:**
```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**"],
      "cache": true
    }
  }
}
```

**5. Dependency Management:**
```json
// package.json
{
  "overrides": {
    "react": "19.2.1",
    "react-dom": "19.2.1",
    "next": "16.1.0-canary.21"
  },
  "trustedDependencies": [
    "ffmpeg-static",
    "isolated-vm",
    "sharp"
  ]
}
```

### Deployment Commands

**Local Development:**
```bash
# Start all services
bun run dev:full

# Docker Compose
docker-compose -f docker-compose.local.yml up

# With Ollama
docker-compose -f docker-compose.ollama.yml up
```

**Production Deployment:**
```bash
# Docker
docker-compose -f docker-compose.prod.yml up -d

# Kubernetes (Helm)
helm install sim ./helm/sim \
  --values ./helm/sim/examples/values-production.yaml \
  --namespace sim \
  --create-namespace
```

**Database Migrations:**
```bash
# Run migrations
bun run db:push

# Or via Docker
docker-compose run migrations
```

### Health Checks & Monitoring

**Kubernetes Probes:**
```yaml
livenessProbe:
  httpGet:
    path: /api/status
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /api/status
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
```

**Prometheus Monitoring:**
```yaml
# ServiceMonitor
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: sim
spec:
  selector:
    matchLabels:
      app: sim
  endpoints:
    - port: metrics
      interval: 30s
```

---

## Testing Infrastructure

### Testing Framework

**Primary Framework:** Vitest v3.0.8
**Coverage Tool:** @vitest/coverage-v8 v3.0.8
**Supporting Library:** @testing-library/jest-dom v6.6.3

**Configuration Files:**
- `/apps/sim/vitest.config.ts`
- `/packages/ts-sdk/vitest.config.ts`
- `/packages/logger/vitest.config.ts`

**Key Configuration (apps/sim):**
```typescript
{
  globals: true,                    // Global test utilities
  environment: 'node',
  pool: 'threads',
  poolOptions: {
    threads: {
      singleThread: false,
      useAtomics: true,
      isolate: true
    }
  },
  fileParallelism: true,
  maxConcurrency: 20,
  testTimeout: 10000                // 10 seconds
}
```

### Test Organization

**Total Test Files:** 130+
**Convention:** `*.test.ts`, `*.test.tsx`
**Location:** Colocated with source code

**Directory Patterns:**
- Unit tests: Alongside implementation (e.g., `logger.ts` → `logger.test.ts`)
- API route tests: In API directories (`/app/api/chat/route.test.ts`)
- Extended tests: Dedicated `tests/` subdirectories

**Test File Distribution:**
```
apps/sim/
├── blocks/blocks/*.test.ts         # Block unit tests
├── app/api/**/route.test.ts       # API route tests (30+)
├── tools/utils.test.ts            # Tool utilities
├── executor/*.test.ts             # Executor tests
├── serializer/tests/*.test.ts     # Serializer extended tests
└── lib/**/*.test.ts               # Library tests

packages/
├── logger/src/*.test.ts           # Logger tests
├── ts-sdk/*.test.ts               # SDK tests
└── testing/src/*.test.ts          # Testing utilities self-tests
```

### Testing Utilities Package (@sim/testing)

**Location:** `/packages/testing/`

**Package Structure:**
```
testing/src/
├── factories/                # Test data factories
│   ├── block.factory.ts     # Block factories
│   ├── workflow.factory.ts  # Workflow factories
│   ├── execution.factory.ts # Execution factories
│   ├── dag.factory.ts       # DAG factories
│   └── entity.factory.ts    # User/workspace factories
├── builders/                # Fluent builders
│   └── workflow.builder.ts  # WorkflowBuilder with presets
├── mocks/                   # Mock implementations
│   ├── logger.mock.ts       # Logger mock
│   ├── fetch.mock.ts        # Fetch mock
│   ├── database.mock.ts     # DB mock
│   ├── storage.mock.ts      # localStorage/sessionStorage
│   └── socket.mock.ts       # Socket.io mock
├── assertions/              # Domain-specific assertions
│   ├── workflow.assertions.ts
│   ├── execution.assertions.ts
│   └── permission.assertions.ts
├── setup/                   # Global setup
│   └── vitest.setup.ts      # Vitest configuration
└── index.ts                 # Public exports
```

#### Factories (Test Data Generation)

**Block Factories:**
```typescript
createBlock(overrides?)              // Generic block
createStarterBlock(overrides?)       // Starter block
createAgentBlock(overrides?)         // Agent block
createFunctionBlock(overrides?)      // Function block
createConditionBlock(overrides?)     // Condition block
// ... (20+ block factories)
```

**Workflow Factories:**
```typescript
createLinearWorkflow()               // Sequential workflow
createBranchingWorkflow()            // With conditions
createLoopWorkflow()                 // With loop blocks
createParallelWorkflow()             // Parallel execution
```

**Execution Factories:**
```typescript
createExecutionContext(overrides?)   // Base context
createExecutionContextWithStates()   // With block states
createCancelledExecutionContext()    // Cancelled state
createTimedExecutionContext()        // With timing info
```

**DAG Factories:**
```typescript
createDAG(blocks, edges)             // Complete DAG
createDAGNode(block)                 // Single node
createLinearDAG(count)               // Linear graph
```

#### Builders (Fluent API)

**WorkflowBuilder:**
```typescript
// Fluent API
const workflow = new WorkflowBuilder()
  .addStarter()
  .addAgent({ model: 'gpt-4', prompt: 'Hello' })
  .addFunction({ code: 'return input * 2' })
  .connect(0, 1)
  .connect(1, 2)
  .build()

// Static presets
WorkflowBuilder.linear()             // Linear workflow
WorkflowBuilder.branching()          // With conditions
WorkflowBuilder.withLoop()           // With loop
WorkflowBuilder.withParallel()       // Parallel branches
```

#### Mocks (Reusable Implementations)

**Logger Mock:**
```typescript
const logger = createMockLogger()
logger.info('test')
expect(logger.info).toHaveBeenCalledWith('test')
```

**Fetch Mock:**
```typescript
const mockFetch = createMockFetch({
  json: { result: 'success' },
  status: 200
})
setupGlobalFetchMock(mockFetch)

// Multi-response mock
const multiMock = createMultiMockFetch([
  { json: { page: 1 }, status: 200 },
  { json: { page: 2 }, status: 200 }
])
```

**Database Mock:**
```typescript
const db = createMockDb()
db.select().from(users).where(eq(users.id, '1'))
expect(db.select).toHaveBeenCalled()
```

**Storage Mock:**
```typescript
setupGlobalStorageMocks()
localStorage.setItem('key', 'value')
expect(localStorage.getItem('key')).toBe('value')
```

#### Assertions (Semantic Checks)

**Workflow Assertions:**
```typescript
expectBlockExists(workflow, blockId)
expectBlockNotExists(workflow, blockId)
expectEdgeConnects(workflow, sourceId, targetId)
expectNoEdgeBetween(workflow, sourceId, targetId)
expectBlockHasParent(workflow, blockId, parentId)
expectBlockCount(workflow, expectedCount)
expectEdgeCount(workflow, expectedCount)
expectBlockPosition(workflow, blockId, { x, y })
expectBlockEnabled(workflow, blockId)
expectBlockDisabled(workflow, blockId)
expectLoopExists(workflow, loopId)
expectParallelExists(workflow, parallelId)
expectEmptyWorkflow(workflow)
expectLinearChain(workflow, [id1, id2, id3])
```

### Global Test Setup

**Setup File:** `/apps/sim/vitest.setup.ts`

**Global Mocks:**
1. `fetch` - Returns mock Response
2. `localStorage/sessionStorage` - Storage mock
3. `drizzle-orm` - SQL operators and template literals
4. `@sim/logger` - Logger mock
5. `@/stores/console/store` - Console store
6. `@/stores/terminal` - Terminal console
7. `@/stores/execution/store` - Execution store
8. `@/blocks/registry` - Block registry
9. `@trigger.dev/sdk` - Trigger.dev SDK

**Cleanup:**
```typescript
afterEach(() => {
  vi.clearAllMocks()
})
```

**Console Suppression:**
- Zustand persist middleware warnings
- Workflow execution test errors
- Known test artifacts

### Test Patterns

**Standard Test Structure:**
```typescript
describe('Feature/Component', () => {
  let mockService: ReturnType<typeof createMockService>

  beforeEach(() => {
    mockService = createMockService()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('specific behavior', () => {
    it('should perform expected action', () => {
      // Arrange
      const input = someTestData

      // Act
      const result = executeFunction(input)

      // Assert
      expect(result).toEqual(expectedOutput)
    })
  })
})
```

**Concurrent Testing:**
```typescript
it.concurrent('handles multiple requests', async () => {
  // Test executes in parallel with other concurrent tests
})
```

**Mock Patterns:**
```typescript
// Store mocks
vi.mock('@/stores/console/store', () => ({
  useConsoleStore: {
    getState: vi.fn().mockReturnValue({ addConsole: vi.fn() })
  }
}))

// Spy pattern
const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
```

### Code Coverage

**Tool:** @vitest/coverage-v8
**Command:** `vitest run --coverage`
**Config:** Excluded in biome.json (`!**/coverage`)

**Coverage Emphasis:**
- Extended test suites explicitly document gap coverage
- Comments: "These tests cover edge cases, complex scenarios, and gaps in coverage"
- Iterative coverage improvement approach

### Testing Conventions

**TSDoc Comments:**
- All test utilities include TSDoc with `@example` blocks
- Demonstrates intended usage patterns

**Error Handling Testing:**
- Validates error paths (network errors, 400 responses)
- Tests both success and error transformations

**Edge Case Coverage:**
- Null/undefined handling
- Circular references
- Multiple argument combinations
- Empty/missing data

**API Route Testing:**
- Comprehensive mocking:
  - NextRequest/NextResponse
  - Redis operations
  - Database operations
  - Email services
  - Environment variables
  - Crypto functions

### Test Execution

**Scripts:**
```bash
bun run test                    # Run all tests
bun run test:watch              # Watch mode
bun run test:coverage           # Generate coverage
```

**CI/CD Integration:**
```yaml
# .github/workflows/test-build.yml
- name: Run tests with coverage
  run: bun run test

- name: Upload coverage
  uses: codecov/codecov-action@v3
```

---

## Core Business Logic

### Main Application Purpose

**SimStudio AI** is an AI workflow automation platform enabling users to:
1. Design AI agent workflows visually on a canvas
2. Connect 140+ tools and integrations
3. Execute workflows via API, webhooks, schedules, or manual triggers
4. Store and retrieve knowledge bases with vector embeddings (RAG)
5. Monitor execution logs and performance metrics
6. Pause/resume workflows with state persistence
7. Deploy workflows for production use

### Workflow Execution Architecture

**Entry Point:** `/lib/workflows/executor/execute-workflow.ts`

**Execution Flow:**
```
executeWorkflow (public API)
    ↓
executeWorkflowCore (coordination + logging)
    ↓
DAGExecutor (workflow orchestration)
    ├─ DAGBuilder: Construct directed acyclic graph
    ├─ ExecutionEngine: Manage execution flow
    ├─ ExecutionState: Track block states
    ├─ BlockExecutor: Execute individual blocks
    ├─ EdgeManager: Manage data flow
    ├─ LoopOrchestrator: Handle iterations
    └─ ParallelOrchestrator: Manage parallel execution
```

**Execution Pipeline (6 stages):**

1. **Initialization**
   - Load workflow definition and deployment version
   - Resolve environment variables and credentials
   - Initialize execution context with block states

2. **DAG Construction**
   - Build directed acyclic graph from blocks and edges
   - Expand loop and parallel nodes into execution nodes
   - Compute execution paths and dependencies

3. **Execution**
   - Process nodes in topological order
   - Execute BlockHandlers for each node type
   - Handle streaming responses in real-time
   - Track execution time and costs

4. **State Management**
   - Maintain block outputs after execution
   - Track loop iterations with per-iteration state
   - Store parallel branch outputs
   - Preserve decision routing history

5. **Human-in-the-Loop**
   - Detect pause points in block handlers
   - Serialize execution snapshot to database
   - Resume from pause point with updated inputs
   - Chain multiple pause-resume cycles

6. **Completion**
   - Aggregate final outputs
   - Log execution metadata and costs
   - Clean up temporary resources
   - Trigger post-execution webhooks

### Block System (143 implementations)

**Block Categories:**

**Control Flow Blocks:**
- `agent.ts` - LLM-powered blocks with message history
- `condition.ts` - Conditional branching
- `router.ts` - Dynamic routing
- `parallel.ts` - Parallel execution
- `loop.ts` - Iteration (for, forEach, while, doWhile)
- `function.ts` - JavaScript/TypeScript execution
- `wait.ts` - Delay/sleep
- `human_in_the_loop.ts` - Manual approval

**Integration Blocks (140+ tools):**
- **Communication**: Discord, Slack, Telegram, WhatsApp, Teams, Email
- **Data**: MongoDB, PostgreSQL, MySQL, DynamoDB, Neo4j, S3, Dropbox
- **CRM/Business**: Salesforce, HubSpot, Linear, Jira, GitHub, Asana, Notion
- **Search/Web**: DuckDuckGo, Tavily, Exa, Perplexity, Wikipedia, Firecrawl
- **AI/ML**: OpenAI, Claude, Gemini, Groq, LLaMA, Ollama, vLLM, Cerebras
- **Media**: YouTube, Spotify, video/image generation, STT/TTS
- **Specialized**: Stripe, Shopify, Kalshi, Stagehand (web automation)

**Block Configuration:**
```typescript
interface BlockConfig {
  type: string
  position: { x: number, y: number }
  enabled: boolean
  subBlocks: JSONB               // Configurable inputs
  outputs: JSONB                 // Output definitions
}
```

### Execution Context

**Type Definition:** `/executor/types.ts`

```typescript
interface ExecutionContext {
  // Block States
  blockStates: {
    [blockId: string]: {
      outputs: NormalizedBlockOutput
      status: 'pending' | 'running' | 'completed' | 'failed'
      startedAt?: number
      completedAt?: number
      error?: string
    }
  }

  // Loop Tracking
  loopExecutions: {
    [loopId: string]: {
      iterations: number
      items: any[]
      outputs: NormalizedBlockOutput[]
    }
  }

  // Parallel Tracking
  parallelExecutions: {
    [parallelId: string]: {
      branchOutputs: Record<string, NormalizedBlockOutput>
      completedBranches: number
    }
  }

  // Variables
  variables: {
    environment: Record<string, any>
    workflow: Record<string, any>
  }

  // Metadata
  userId: string
  workspaceId: string
  workflowId: string
  executionId: string
  requestId: string

  // Decision Routing
  decisionHistory: Array<{
    blockId: string
    decision: boolean | string
    timestamp: number
  }>
}
```

**Normalized Block Output:**
```typescript
interface NormalizedBlockOutput {
  content: string                    // Main output
  model?: string                     // Model used
  tokenCount?: {
    input: number
    output: number
    total: number
  }
  toolCalls?: {
    count: number
    calls: ToolCall[]
  }
  files?: Array<{
    url: string                      // S3 URL
    type: string
    size: number
  }>
  error?: {
    message: string
    code: string
    stack?: string
  }
  executionTime?: {
    started: number
    completed: number
    duration: number
  }
}
```

### Knowledge Base & RAG

**Document Processing Pipeline:**

1. **Ingestion** (`/lib/knowledge/`)
   - Upload document (PDF, DOCX, TXT, MD)
   - Extract text content
   - Extract metadata (filename, size, type)

2. **Chunking** (`/lib/chunkers/`)
   - Token-based chunking (respects limits)
   - Semantic chunking (preserves meaning)
   - Sliding window with overlap
   - Custom per document type

3. **Embedding** (`/lib/knowledge/`)
   - Generate embeddings using provider models
   - Store in `embedding` table with vector(1536)
   - Create HNSW index for similarity search
   - Generate TSVector for full-text search

4. **Search**
   - Vector similarity search (cosine distance)
   - Full-text search (TSVector + GIN index)
   - Tag-based filtering (7 text, 5 number, 2 date, 3 boolean)
   - Hybrid search combining multiple methods

**Vector Search Query:**
```sql
SELECT * FROM embedding
WHERE knowledge_base_id = $1
ORDER BY embedding <=> $2
LIMIT 10
```

### Data Processing

**File Parsing** (`/lib/file-parsers/`):
- PDF: Text extraction + chunking
- DOCX: Mammoth library conversion
- XLSX: Sheet parsing
- YAML/JSON: Configuration parsing
- Office: Various document formats

**Tokenization** (`/lib/tokenization/`):
- Multi-provider token counting
- Token estimation for streaming
- Cost calculation based on model pricing

### Integration Patterns

**Tool Execution Model:**
```typescript
interface ToolConfig {
  parameters: {
    schema: ZodSchema
    visibility: 'user-only' | 'llm-only' | 'user-or-llm'
  }
  request: {
    url: string | UrlTemplate
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
    headers: Record<string, string>
    body?: any
  }
  outputs: {
    schema: ZodSchema
    mapping: OutputMapping
  }
  auth: {
    type: 'oauth' | 'api-key' | 'bot-token'
    provider?: string
  }
}
```

**Data Flow:**
```
Tools → Blocks → Workflows → Execution Engine → Logs/Telemetry
```

### Background Jobs (Trigger.dev)

**Job Types:**

1. **schedule-execution.ts**
   - Scheduled workflow triggers (cron-based)
   - Polls `workflowSchedule` table
   - Creates execution records

2. **webhook-execution.ts**
   - Webhook trigger processing
   - Retry logic for failures
   - Idempotency key tracking

3. **workflow-execution.ts**
   - Async workflow execution
   - Long-running task support
   - Resource-intensive workflows

4. **knowledge-processing.ts**
   - Async document embedding
   - Batch processing
   - Indexing operations

5. **workspace-notification-delivery.ts**
   - Webhook/email notifications
   - Retry logic
   - Delivery tracking

**Configuration:**
```typescript
// trigger.config.ts
{
  project: env.TRIGGER_PROJECT_ID,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2
    }
  },
  maxDuration: 600  // 10 minutes
}
```

### Real-time Features (Socket.IO)

**Socket Event Handlers** (`/socket/handlers/`):

```typescript
// Workflow state synchronization
socket.on('workflow:update', async (data) => {
  // Broadcast to room members
  socket.to(workflowId).emit('workflow:updated', data)
})

// Execution progress streaming
socket.on('execution:subscribe', async (executionId) => {
  // Join execution room
  socket.join(`execution:${executionId}`)
})

// User presence
socket.on('cursor:move', async (position) => {
  socket.to(workflowId).emit('cursor:update', {
    userId: socket.userId,
    position
  })
})
```

**Room Management:**
```typescript
class RoomManager {
  join(socket, workflowId)
  leave(socket, workflowId)
  broadcast(workflowId, event, data)
  getUsersInRoom(workflowId)
}
```

### Security Implementation

**Encryption** (`/lib/core/security/encryption.ts`):
```typescript
// AES-256-GCM
function encrypt(plaintext: string, key: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ])
  const authTag = cipher.getAuthTag()

  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${authTag.toString('hex')}`
}
```

**Redaction** (`/lib/core/security/redaction.ts`):
```typescript
const SENSITIVE_PATTERNS = [
  /api[_-]?key/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /client[_-]?secret/i,
  /private[_-]?key/i,
  /password/i,
  /bearer\s+\S+/i
]

function redactSensitiveData(obj: any): any {
  // Recursive object traversal
  // Replace sensitive values with '[REDACTED]'
}
```

### Monitoring & Observability

**Structured Logging:**
```typescript
import { createLogger } from '@sim/logger'

const logger = createLogger('WorkflowExecutor')

logger.info('Starting workflow execution', {
  workflowId,
  userId,
  workspaceId,
  executionId
})
```

**OpenTelemetry Tracing:**
```typescript
import { trace } from '@opentelemetry/api'

const tracer = trace.getTracer('sim-studio')

const span = tracer.startSpan('workflow.execute', {
  attributes: {
    'workflow.id': workflowId,
    'user.id': userId,
    'execution.id': executionId
  }
})

try {
  // ... execution logic
  span.setStatus({ code: SpanStatusCode.OK })
} catch (error) {
  span.setStatus({ code: SpanStatusCode.ERROR })
  span.recordException(error)
} finally {
  span.end()
}
```

**Cost Tracking:**
```typescript
// After each execution
await db.insert(usageLog).values({
  userId,
  category: 'model',
  source: 'workflow',
  cost: tokenCount.total * modelPricePerToken,
  metadata: {
    model,
    tokenCount,
    executionId
  }
})
```

---

## Third-Party Integrations

### Integration Overview

**Total Integrations:** 140+ tools, 40+ OAuth providers, 11 LLM providers

### AI/LLM Providers (11 total)

#### Primary Providers
1. **OpenAI** (`openai` v4.91.1)
   - Models: GPT-4, GPT-4 Turbo, GPT-3.5 Turbo
   - Features: Function calling, vision, streaming
   - Load balancing: 3 API keys supported

2. **Anthropic Claude** (`@anthropic-ai/sdk` v0.39.0)
   - Models: Claude 3.5 Sonnet, Claude 3 Opus, Claude 3 Haiku
   - Features: Streaming, vision, structured output
   - Load balancing: 3 API keys

3. **Google Gemini** (`@google/genai` v1.34.0)
   - Models: Gemini 1.5 Pro, Gemini 1.5 Flash
   - Features: Reasoning modes, vision, long context
   - Load balancing: 3 API keys

4. **Groq** (`groq-sdk` v0.15.0)
   - Fast inference for supported models
   - Streaming support

5. **Cerebras** (`@cerebras/cerebras_cloud_sdk` v1.23.0)
   - High-performance inference

#### Additional Providers
- **Mistral** (via Azure endpoint)
- **DeepSeek** (optional, feature flag)
- **xAI** (X AI integration)
- **OpenRouter** (Multi-model aggregator)
- **Ollama** (Self-hosted local models)
- **vLLM** (OpenAI-compatible self-hosted)

#### Provider Features
```typescript
interface ProviderCapabilities {
  streaming: boolean
  vision: boolean
  toolCalling: boolean
  reasoning: boolean
  structuredOutput: boolean
  maxTokens: number
  costPerToken: {
    input: number
    output: number
  }
}
```

### OAuth Providers (40+)

**Authentication Framework:** Better Auth v1.3.12

**Provider Categories:**

#### Social & Communication
- Google (multiple services)
- GitHub (2 apps)
- Microsoft (Teams, Outlook, Excel, OneDrive, SharePoint)
- Slack
- Discord
- X/Twitter
- LinkedIn
- Reddit
- Spotify
- Zoom

#### CRM & Business
- Salesforce
- HubSpot
- Pipedrive
- Wealthbox

#### Project Management
- Jira
- Confluence
- Linear
- Asana
- Trello
- Notion
- Airtable

#### Cloud & Development
- GitHub
- GitLab
- Supabase
- Vertex AI

#### Content & Commerce
- WordPress
- Webflow
- Shopify
- Dropbox

### Cloud Services

#### AWS Services
```typescript
// @aws-sdk packages
{
  "client-s3": "3.779.0",                  // Object storage
  "s3-request-presigner": "3.779.0",       // Signed URLs
  "client-dynamodb": "3.940.0",            // NoSQL database
  "client-rds-data": "3.940.0",            // RDS Data API
  "client-sqs": "3.947.0"                  // Message queue
}
```

**S3 Buckets (8 categories):**
- General files
- Execution logs
- Knowledge base documents
- Execution artifacts
- Chat attachments
- Copilot files
- User profiles
- Open Graph images

#### Azure Services
```typescript
{
  "@azure/storage-blob": "12.27.0",        // Blob storage
  "@azure/communication-email": "1.0.0"    // Email service
}
```

**Azure Containers:** (Same 8 categories as S3)

#### Google Cloud
- Vertex AI (enterprise AI platform)
- Google services via OAuth

### Communication Services

#### Email
- **Resend** v4.1.2 - Primary transactional email
- **Azure Communication Services** - Enterprise email
- **Gmail** - OAuth integration for automation
- **Mailgun** - Traditional email service
- **Mailchimp** - Email marketing

**Email Templates:**
```typescript
// @react-email/components v0.0.34
import { Html, Body, Container, Button } from '@react-email/components'
```

#### SMS & Voice
- **Twilio** v5.9.0
  - SMS messaging
  - Voice calls
  - WhatsApp Business API
- **Telegram** - Bot messaging

#### Team Communication
- **Slack** - Comprehensive workspace integration
- **Discord** - Server and channel management
- **Microsoft Teams** - Teams messaging

### Payment Processing

**Stripe** v18.5.0

**Features:**
- Payment intents
- Customers management
- Subscriptions (recurring billing)
- Invoices
- Products and prices
- Payment methods
- Webhooks
- Events tracking

**Integration:**
```typescript
// @better-auth/stripe v1.3.12
{
  stripeCustomerId: user.stripeCustomerId,
  subscriptionStatus: 'active' | 'canceled' | 'past_due',
  plan: 'free' | 'pro' | 'team' | 'enterprise'
}
```

### Real-time & Background Jobs

#### Socket.IO
**Version:** v4.8.1 (client + server)

**Features:**
- Real-time bidirectional communication
- Room-based architecture
- Auto-reconnection
- Binary support

**Use Cases:**
- Live workflow execution updates
- Collaborative cursor tracking
- Chat messaging
- Presence detection

#### Trigger.dev
**Version:** v4.1.2

**Features:**
- Serverless job orchestration
- Retry logic
- Scheduled tasks
- Event-driven workflows

**Job Types:**
- Async workflow execution
- Document processing
- Webhook delivery
- Scheduled executions

### Monitoring & Analytics

#### OpenTelemetry
```typescript
{
  "@opentelemetry/api": "1.9.0",
  "@opentelemetry/sdk-trace-node": "2.0.0",
  "@opentelemetry/exporter-jaeger": "2.1.0",
  "@opentelemetry/exporter-trace-otlp-http": "0.200.0"
}
```

**Exporters:**
- Jaeger (distributed tracing)
- OTLP HTTP (generic exporter)

#### Analytics
- **PostHog** v1.268.9 - Product analytics
- **OneDollarStats** v0.0.10 - Cost tracking

### Web Automation

#### Browserbase + Stagehand
**Version:** @browserbasehq/stagehand v3.0.5

**Features:**
- AI-powered browser automation
- Vision-based element detection
- Web scraping
- Form automation

#### Code Execution
**E2B Code Interpreter** v2.0.0

**Features:**
- Sandboxed code execution
- Python and JavaScript support
- File system access
- Security isolation

### Model Context Protocol (MCP)

**Version:** @modelcontextprotocol/sdk v1.20.2

**Features:**
- Protocol version: 2025-06-18
- Transport: Streamable HTTP
- OAuth 2.1 support
- Tool discovery and invocation
- Session management
- Audit logging

**MCP Servers:**
```typescript
interface MCPServerConfig {
  workspaceId: string
  transport: 'http' | 'stdio' | 'websocket'
  url: string
  headers?: Record<string, string>
  statusConfig: JSONB
}
```

### Tool Implementation Structure

**Tool Definition Pattern:**
```typescript
// /tools/{tool-name}/index.ts
export const toolConfig: ToolConfig = {
  name: 'tool-name',
  description: 'Tool description',
  category: 'communication' | 'data' | 'ai' | 'crm' | 'search',
  auth: {
    type: 'oauth' | 'api-key' | 'bot-token',
    provider: 'provider-name'
  },
  parameters: {
    schema: z.object({
      param1: z.string(),
      param2: z.number().optional()
    }),
    visibility: 'user-or-llm'
  },
  execute: async (params, context) => {
    // Implementation
    return {
      content: 'Result',
      files: [],
      metadata: {}
    }
  }
}
```

**Tool Categories:**
- Communication (30+ tools)
- Data & Databases (20+ tools)
- CRM & Business (25+ tools)
- AI & ML (15+ tools)
- Search & Web (15+ tools)
- Media & Content (10+ tools)
- Developer Tools (15+ tools)
- Specialized (10+ tools)

### Integration Authentication Modes

1. **OAuth2** (40+ providers)
   - Authorization Code flow
   - Refresh token management
   - Scope validation
   - Account linking

2. **API Keys** (100+ tools)
   - User-provided credentials
   - Encrypted storage
   - Per-workspace or per-user

3. **Bot Tokens** (Slack, Discord, Telegram)
   - Service-specific authentication
   - Workspace-level tokens

4. **Bring-Your-Own-Key (BYOK)**
   - Enterprise feature
   - Customer-managed credentials
   - Dedicated encryption

### Dependency Management Strategy

**Version Pinning:**
```json
// package.json overrides
{
  "overrides": {
    "react": "19.2.1",
    "react-dom": "19.2.1",
    "next": "16.1.0-canary.21",
    "drizzle-orm": "0.44.5",
    "postgres": "3.4.5"
  }
}
```

**Trusted Dependencies:**
```json
{
  "trustedDependencies": [
    "ffmpeg-static",      // Native binary
    "isolated-vm",        // Native addon
    "sharp",              // Image processing
    "canvas",             // Canvas rendering
    "better-sqlite3"      // SQLite native
  ]
}
```

**Workspace References:**
```json
// Internal packages use workspace:*
{
  "dependencies": {
    "@sim/db": "workspace:*",
    "@sim/logger": "workspace:*",
    "@sim/testing": "workspace:*"
  }
}
```

---

## Development Guidelines

### Code Standards (from CLAUDE.md)

**Role:** Professional software engineer
**Standard:** Best practices, accuracy, quality, readability, cleanliness

#### Logging
✅ **DO:** Use logger.info, logger.warn, logger.error
❌ **DON'T:** Use console.log for application logging

```typescript
import { createLogger } from '@sim/logger'
const logger = createLogger('ModuleName')

logger.info('Operation completed', { userId, workflowId })
logger.warn('Rate limit approaching', { remaining: 10 })
logger.error('Operation failed', { error: error.message })
```

#### Comments
✅ **DO:** Use TSDOC for comments
❌ **DON'T:** Use `====` for section separators
❌ **DON'T:** Leave non-TSDOC comments

```typescript
/**
 * Executes a workflow with the given context
 * @param workflowId - The workflow identifier
 * @param context - Execution context
 * @returns Execution result
 * @throws {WorkflowNotFoundError} If workflow doesn't exist
 */
export async function executeWorkflow(
  workflowId: string,
  context: ExecutionContext
): Promise<ExecutionResult> {
  // Implementation
}
```

#### Global Styles
❌ **DON'T:** Update global styles unless absolutely necessary
✅ **DO:** Keep all styling local to components and files

#### Package Manager
✅ **DO:** Use `bun` and `bunx`
❌ **DON'T:** Use `npm` and `npx`

```bash
# Correct
bun install
bun run dev
bunx drizzle-kit push

# Incorrect
npm install
npm run dev
npx drizzle-kit push
```

### Code Quality Principles

**1. Write Clean, Maintainable Code**
- Follow project's existing patterns
- Prefer composition over inheritance
- Keep functions small and focused (single responsibility)
- Use meaningful variable and function names

**2. Handle Errors Gracefully**
```typescript
try {
  const result = await executeWorkflow(workflowId)
  return NextResponse.json({ data: result })
} catch (error) {
  logger.error('Workflow execution failed', {
    workflowId,
    error: error.message,
    stack: error.stack
  })
  return NextResponse.json(
    { error: 'Workflow execution failed' },
    { status: 500 }
  )
}
```

**3. Write Type-Safe Code**
```typescript
// Use proper TypeScript types
interface WorkflowConfig {
  name: string
  enabled: boolean
  variables: Record<string, any>
}

// Avoid 'any' when possible
// Use Zod for runtime validation
const WorkflowConfigSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean(),
  variables: z.record(z.any())
})
```

### Testing Conventions

**1. Write Tests for New Functionality**
```typescript
describe('executeWorkflow', () => {
  it('should execute workflow successfully', async () => {
    const workflow = createLinearWorkflow()
    const result = await executeWorkflow(workflow.id)

    expect(result.status).toBe('completed')
    expect(result.outputs).toBeDefined()
  })

  it('should handle errors gracefully', async () => {
    const workflow = createLinearWorkflow()

    await expect(
      executeWorkflow('invalid-id')
    ).rejects.toThrow('Workflow not found')
  })
})
```

**2. Ensure Existing Tests Pass**
```bash
bun run test              # Before committing
bun run test:coverage     # Check coverage
```

**3. Follow Testing Conventions**
- Use `@sim/testing` utilities
- Colocate tests with source code
- Write descriptive test names
- Use factories for test data

### Performance Considerations

**1. Avoid Unnecessary Re-renders (React)**
```typescript
// Use React.memo for expensive components
const WorkflowCanvas = React.memo(({ workflow }) => {
  // ... component logic
})

// Use useMemo for expensive calculations
const processedBlocks = useMemo(() => {
  return workflow.blocks.map(processBlock)
}, [workflow.blocks])

// Use useCallback for function props
const handleBlockClick = useCallback((blockId: string) => {
  // ... handler logic
}, [])
```

**2. Optimize Database Queries**
```typescript
// Use select only needed fields
const users = await db
  .select({ id: user.id, email: user.email })
  .from(user)
  .where(eq(user.workspaceId, workspaceId))

// Use proper indexes (defined in schema)
// Batch operations when possible
const workflows = await db
  .select()
  .from(workflow)
  .where(inArray(workflow.id, workflowIds))
```

**3. Profile and Optimize When Necessary**
- Use Chrome DevTools for frontend profiling
- Use OpenTelemetry for backend tracing
- Monitor execution times in logs

### Project Structure Best Practices

**1. Directory Organization**
```
feature/
├── components/          # Feature-specific React components
├── hooks/              # Feature-specific hooks
├── lib/                # Business logic
├── types.ts            # TypeScript types
├── api.ts              # API client functions
└── utils.ts            # Utility functions
```

**2. File Naming**
- Components: `PascalCase.tsx` (e.g., `WorkflowCanvas.tsx`)
- Utilities: `camelCase.ts` (e.g., `formatDate.ts`)
- Types: `types.ts`, `schema.ts`
- Constants: `constants.ts`, `config.ts`

**3. Import Organization**
```typescript
// External dependencies
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'

// Internal packages
import { db } from '@sim/db'
import { createLogger } from '@sim/logger'

// Relative imports
import { WorkflowCanvas } from './components/WorkflowCanvas'
import { executeWorkflow } from './lib/executor'
import type { Workflow } from './types'
```

### Git Workflow

**1. Commit Messages**
```bash
# Good commit messages
git commit -m "fix: resolve workflow execution timeout issue"
git commit -m "feat: add parallel execution support"
git commit -m "docs: update API documentation for workflows"

# Bad commit messages
git commit -m "fix stuff"
git commit -m "WIP"
git commit -m "updates"
```

**2. Pre-commit Hooks (Husky)**
```bash
# Automatically runs:
- bun run lint        # Biome formatting
- bun run type-check  # TypeScript validation
```

**3. Branch Naming**
```bash
# Feature branches
feature/workflow-pause-resume
feature/knowledge-base-search

# Bug fixes
fix/execution-timeout
fix/auth-session-expiry

# Improvements
improvement/logging-enhancement
improvement/database-query-optimization
```

### API Development Guidelines

**1. Route Handler Pattern**
```typescript
// /app/api/workflows/route.ts
export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workflows = await db
      .select()
      .from(workflow)
      .where(eq(workflow.userId, session.user.id))

    return NextResponse.json({ data: workflows })
  } catch (error) {
    logger.error('Failed to fetch workflows', { error })
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
```

**2. Input Validation**
```typescript
const CreateWorkflowSchema = z.object({
  name: z.string().min(1).max(255),
  workspaceId: z.string().uuid()
})

export async function POST(request: NextRequest) {
  const body = await request.json()

  // Validate input
  const validation = CreateWorkflowSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.errors },
      { status: 400 }
    )
  }

  // ... proceed with validated data
}
```

**3. Response Format**
```typescript
// Success response
return NextResponse.json({
  data: result,
  pagination: {
    total: 100,
    limit: 50,
    offset: 0
  }
})

// Error response
return NextResponse.json({
  error: 'Error message',
  code: 'ERROR_CODE'
}, { status: 400 })
```

### Environment Variables

**1. Adding New Variables**
```typescript
// 1. Add to .env.example
NEW_SERVICE_API_KEY=

// 2. Add to /lib/core/config/env.ts
export const env = createEnv({
  server: {
    NEW_SERVICE_API_KEY: z.string().min(1)
  }
})

// 3. Document in CODEBASE_CONTEXT.md
```

**2. Accessing Variables**
```typescript
import { env } from '@/lib/core/config/env'

const apiKey = env.NEW_SERVICE_API_KEY
```

### Database Changes

**1. Schema Changes**
```typescript
// 1. Update /packages/db/schema.ts
export const newTable = pgTable('new_table', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull()
})

// 2. Generate migration
bun run db:generate

// 3. Apply migration
bun run db:push

// 4. Update types are auto-generated by Drizzle
```

**2. Query Patterns**
```typescript
// Use Drizzle query builder
import { db, workflow } from '@sim/db'
import { eq, and, desc } from 'drizzle-orm'

const workflows = await db
  .select()
  .from(workflow)
  .where(
    and(
      eq(workflow.userId, userId),
      eq(workflow.isDeployed, true)
    )
  )
  .orderBy(desc(workflow.createdAt))
  .limit(50)
```

### Debugging & Troubleshooting

**1. Logging Levels**
```bash
# Development
LOG_LEVEL=DEBUG bun run dev

# Production
LOG_LEVEL=ERROR bun run start
```

**2. Database Inspection**
```bash
# Drizzle Studio (web UI)
bunx drizzle-kit studio

# Or use psql
psql $DATABASE_URL
```

**3. Telemetry**
```typescript
// Add custom spans for tracing
import { trace } from '@opentelemetry/api'

const tracer = trace.getTracer('my-feature')
const span = tracer.startSpan('operation-name')

try {
  // ... operation
  span.setStatus({ code: SpanStatusCode.OK })
} finally {
  span.end()
}
```

---

## Key Metrics & Statistics

### Codebase Size

| Metric | Count |
|--------|-------|
| **Total Files** | 3,000+ |
| **TypeScript LOC** | ~200,000 |
| **Test Files** | 130+ |
| **API Endpoints** | 369 |
| **Database Tables** | 63 |
| **Database Migrations** | 138 |
| **Tool Integrations** | 140+ |
| **OAuth Providers** | 40+ |
| **LLM Providers** | 11 |
| **Block Types** | 143 |
| **Zustand Stores** | 69 |
| **React Query Hooks** | 26 |
| **Docker Images** | 3 |
| **Helm Value Examples** | 8 |

### Performance Benchmarks

**Build Times:**
- Full build (Turborepo): ~3-5 minutes
- Incremental build: ~30 seconds
- Type checking: ~15 seconds
- Linting: ~10 seconds

**Test Execution:**
- Full test suite: ~2 minutes
- Single test file: <1 second
- Coverage generation: ~3 minutes

**Deployment:**
- Docker build (with cache): ~5 minutes
- Docker build (cold): ~15 minutes
- Helm deployment: ~2 minutes
- Database migration: ~30 seconds

### Database Statistics

**Table Sizes (Production estimates):**
- `workflowExecutionLogs`: Largest table (millions of rows)
- `embedding`: Large (hundreds of thousands of vectors)
- `workflowBlocks`: Medium (thousands of blocks)
- `user`: Small-medium (thousands of users)

**Index Count:** 200+ indexes
**Foreign Keys:** 81 relationships
**Unique Constraints:** 30+

### API Statistics

**Route Distribution:**
- Workflow routes: 50+
- Tool routes: 140+
- Copilot routes: 30+
- Auth routes: 15+
- Knowledge routes: 20+
- Admin routes: 40+
- Other routes: 74+

**Authentication Types:**
- Session-based: 200+ routes
- API key: 40+ routes
- Internal JWT: 30+ routes
- Socket.IO: Real-time connections

### Dependency Statistics

**Total Dependencies:** 250+
**Production Dependencies:** 200+
**Dev Dependencies:** 50+
**Workspace Packages:** 6

**Major Categories:**
- UI/React: 40+ packages
- Database/ORM: 5 packages
- Authentication: 10+ packages
- AI/LLM: 10+ packages
- Cloud Services: 15+ packages
- Testing: 10+ packages
- Build Tools: 20+ packages

### Integration Coverage

**Communication:** 30+ tools
**Data & Databases:** 20+ tools
**CRM & Business:** 25+ tools
**AI & ML:** 15+ tools
**Search & Web:** 15+ tools
**Media & Content:** 10+ tools
**Developer Tools:** 15+ tools
**Specialized:** 10+ tools

### Testing Coverage

**Test Types:**
- Unit tests: 80+ files
- Integration tests: 30+ files
- API route tests: 20+ files

**Testing Utilities:**
- Factories: 30+ functions
- Builders: 5+ classes
- Mocks: 10+ implementations
- Assertions: 20+ functions

### Cloud Infrastructure

**AWS Resources:**
- S3 buckets: 8 categories
- DynamoDB tables: As needed
- RDS instances: 1+ (PostgreSQL)
- SQS queues: As needed

**Azure Resources:**
- Blob containers: 8 categories
- Communication Services: Email
- OpenAI: Enterprise endpoint

**Kubernetes:**
- Deployments: 2 (app, realtime)
- StatefulSets: 1 (PostgreSQL)
- CronJobs: 3 (schedules, Gmail, Outlook)
- Services: 3
- ConfigMaps: Multiple
- Secrets: Multiple

### Development Activity

**Active Development Areas:**
- Workflow execution engine
- Knowledge base & RAG
- AI integrations
- Tool ecosystem
- Real-time collaboration
- Enterprise features (SSO, RBAC)

**Recent Version:** v0.5.45
**Release Cadence:** Continuous deployment
**Git Branches:** main, staging

---

## Additional Resources

### Key Documentation Files

- `/README.md` - Project overview and quick start
- `/CLAUDE.md` - Code standards and guidelines
- `/packages/README.md` - Package documentation
- `/helm/sim/README.md` - Helm chart documentation

### Important Configuration Files

- `/package.json` - Root workspace configuration
- `/turbo.json` - Turborepo build configuration
- `/biome.json` - Code formatting rules
- `/tsconfig.json` - TypeScript configuration
- `/.github/workflows/` - CI/CD pipelines

### Useful Commands

```bash
# Development
bun install                    # Install dependencies
bun run dev                    # Start development server
bun run dev:full              # Start app + socket server
bun run test                   # Run tests
bun run lint                   # Format and lint code

# Database
bun run db:push               # Apply schema changes
bun run db:generate           # Generate migrations
bunx drizzle-kit studio       # Database UI

# Build & Deploy
bun run build                 # Production build
docker-compose up             # Local Docker
helm install sim ./helm/sim   # Kubernetes deployment
```

### Getting Help

For questions or issues:
1. Check this document for context
2. Review relevant code in the codebase
3. Consult the README files
4. Check the .env.example for configuration

---

**Document Version:** 1.0
**Last Updated:** December 28, 2025
**Maintained By:** Development Team
