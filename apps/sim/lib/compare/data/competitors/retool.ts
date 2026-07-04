import { RetoolIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Researched and cross-verified against live vendor sources on 2026-07-02. */
export const retoolProfile: CompetitorProfile = {
  id: 'retool',
  name: 'Retool',
  website: 'https://retool.com',
  brand: {
    icon: RetoolIcon,
    colors: ['#242424', '#818479', '#e8e9dc'],
    description:
      'Retool is a low‑code platform that lets enterprises build, deploy, and manage internal tools and AI‑powered applications. Users describe desired functionality or import existing React, Replit, or GitHub code, and Retool generates production‑ready apps with built‑in enterprise security, access controls, and audit logging. The platform connects directly to any database, API, or LLM, leveraging existing permissions for data access. Features include a prompt‑driven app builder, MCP server for AI coding agents, and import tools for legacy codebases. Retool’s governance framework lets business teams move fast while IT retains visibility, and the product is used by finance, manufacturing, logistics, and other data‑intensive organizations.',
    industries: ['Software (B2B)', 'Developer Tools & APIs'],
    socials: [
      { type: 'x', url: 'https://x.com/retool' },
      { type: 'reddit', url: 'https://reddit.com/r/retool' },
      { type: 'linkedin', url: 'https://linkedin.com/company/tryretool' },
      { type: 'youtube', url: 'https://youtube.com/retool' },
    ],
    source: 'Context.dev brand-intelligence API',
    asOf: '2026-07-02',
  },
  oneLiner:
    'Retool is a low-code platform for building, deploying, and managing internal software (apps, workflows, and AI agents) that connect to databases, APIs, and LLMs.',
  standoutFeatures: [
    {
      title: 'Full internal business applications, not just agent workflows',
      description:
        "Retool builds custom internal UI screens, forms, admin panels, and dashboards backed by Retool Database, a genuine Postgres database with real SQL joins and foreign keys, not a spreadsheet-like grid, plus a mature React app runtime. AppGen lets users describe an app in plain English and Retool generates pages, queries, components, data bindings, and event handlers already wired to production data and inheriting the org's existing SSO/RBAC/audit policies.",
      shortDescription:
        'Builds full internal apps on a real relational database, not just agent workflows.',
      source: {
        url: 'https://retool.com/ai-app-generation',
        label: 'Retool AI App Generation',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Retool Vectors (managed vector store)',
      description:
        "A Retool-managed vector database that automatically indexes uploaded text, PDFs, or web pages, so AI apps and agents can look up relevant content with one click instead of building a custom search pipeline. The lookups always run through OpenAI's embedding API, even when the chat model is a different provider.",
      shortDescription:
        'Managed vector database with automatic indexing for one-click content lookup.',
      source: {
        url: 'https://docs.retool.com/data-sources/guides/vectors/embeddings',
        label: 'Manage embeddings in Retool-managed Vectors | Retool Docs',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Bidirectional MCP support',
      description:
        'Retool Agents can connect outbound to external MCP servers (a standard for plugging AI agents into outside tools) to pull in tools like GitHub or Jira. Retool also exposes its own workspace as an MCP server (public beta), so build and management actions, such as creating apps, running queries, and managing users, can be performed directly from Claude, Cursor, Codex, or Kiro. This does not let you publish an individual deployed app or workflow as its own standalone MCP tool for outside consumption.',
      shortDescription:
        'Connects to external MCP servers and exposes workspace management actions as one.',
      source: {
        url: 'https://retool.com/blog/how-to-use-mcp-in-retool',
        label: 'How to use MCP in Retool',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Retool Agents (deterministic + non-deterministic decisioning)',
      description:
        'A dedicated agent-building surface that combines code-based deterministic logic, LLM-based non-deterministic decisions, and human-in-the-loop steps within one automation, distinct from the classic Workflows product.',
      shortDescription: 'Combines deterministic logic, LLM decisions, and human-in-the-loop steps.',
      source: {
        url: 'https://docs.retool.com/agents',
        label: 'Retool Agents docs',
        asOf: '2026-07-02',
      },
    },
  ],
  limitations: [
    {
      title: 'Proprietary, closed-source core',
      description:
        'Retool is proprietary and closed-source. The self-hosted deployment can be forked and customized and bundles open-source dependencies, but still requires a Retool-issued license key to run. No OSS license covers the product itself.',
      shortDescription: 'Closed-source product; self-hosted still requires a Retool license key.',
      source: {
        url: 'https://docs.retool.com/legal/open-source-license-disclosure',
        label: 'Open Source License Disclosure | Retool Docs',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Docker self-hosted deployment explicitly not production-ready',
      description:
        'The Docker Compose self-hosted setup (bundled Postgres container, no SSL configured) is for local and non-production testing only. Production self-hosting requires a Kubernetes/Helm deployment.',
      shortDescription:
        'Docker Compose setup is for testing only; production needs Kubernetes/Helm.',
      source: {
        url: 'https://docs.retool.com/self-hosted/tutorials/docker',
        label: 'Deploy Self-hosted Retool with Docker | Retool Docs',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'No dedicated built-in eval/guardrail framework documented',
      description:
        'Retool documents governance controls (audit logs, RBAC, enterprise access controls) but no dedicated evaluation, testing, or guardrail framework for validating AI agent behavior or outputs before production use.',
      shortDescription: 'No dedicated evaluation or guardrail framework for AI output quality.',
      source: { url: 'https://retool.com/ai', label: 'Retool AI', asOf: '2026-07-02' },
    },
    {
      title: 'Agents billed separately by the hour, outside the AI-credit pool',
      description:
        'Retool Agents usage is metered and billed hourly, separate from the monthly AI-credit allocation used for app-building and AI actions. This adds a second, less predictable usage-based cost on top of seat pricing.',
      shortDescription: 'Agents usage is billed hourly, separate from the AI-credit pool.',
      source: { url: 'https://retool.com/pricing', label: 'Retool Pricing', asOf: '2026-07-02' },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'Low-code/no-code visual app and workflow builder with an underlying React-based app runtime; supports AI-generated ("AppGen") starting points that users then refine visually or by editing generated queries/code.',
        detail:
          'Retool offers a React-based app builder where you can generate pages, components, and queries from a natural-language description and then edit the underlying logic directly.',
        shortValue: 'Low-code builder with AI-generated starting points',
        confidence: 'verified',
        sources: [
          { url: 'https://retool.com/', label: 'Retool homepage', asOf: '2026-07-02' },
          {
            url: 'https://retool.com/ai-app-generation',
            label: 'Retool AI App Generation',
            asOf: '2026-07-02',
          },
        ],
      },
      learningCurve: {
        value: 'Unknown',
        detail: 'Retool has not published a learning-curve claim.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      selfHostOption: {
        value:
          'Yes: self-hosted deployment is available on Free, Team, and Business plans at the same pricing as cloud; Enterprise is required for unlimited users and advanced capabilities. A Retool-issued license key is required even when self-hosted.',
        detail:
          'Self-hosted Retool is deployable via Docker (non-production/testing only) or Kubernetes/Helm (production).',
        shortValue: 'Yes, on Free/Team/Business; license key required',
        confidence: 'verified',
        sources: [
          {
            url: 'https://retool.com/self-hosted',
            label: 'Retool Self Hosted',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.retool.com/self-hosted/tutorials/docker',
            label: 'Deploy Self-hosted Retool with Docker | Retool Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      deploymentOptions: {
        value:
          'Retool Cloud (multi-tenant SaaS), or self-hosted via Docker Compose (non-prod/testing) or Kubernetes with Helm chart (production).',
        shortValue: 'Cloud, or self-hosted via Docker/Kubernetes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/self-hosted/tutorials/docker',
            label: 'Deploy Self-hosted Retool with Docker | Retool Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/tryretool/retool-onpremise',
            label: 'tryretool/retool-onpremise GitHub',
            asOf: '2026-07-02',
          },
        ],
      },
      templates: {
        value:
          'Yes: a public template gallery of ready-made, one-click apps/workflows/dashboards (e.g. inventory alerts, abandoned-cart recovery, ticket routing, DB admin panels, SLA/HR/sales dashboards) usable as-is or as a starting point.',
        shortValue: 'Public gallery of one-click apps and dashboards',
        confidence: 'verified',
        sources: [
          { url: 'https://retool.com/templates', label: 'Retool Templates', asOf: '2026-07-02' },
        ],
      },
      license: {
        value: 'Proprietary',
        detail:
          'Retool is closed-source and proprietary for both cloud and self-hosted versions. The self-hosted codebase can be forked and customized and bundles third-party open-source dependencies, but requires a Retool license key to run.',
        shortValue: 'Closed-source, license key required',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/legal/open-source-license-disclosure',
            label: 'Open Source License Disclosure | Retool Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      environmentPromotion: {
        value: 'Yes: via Retool Source Control (Git-based) across separate instances/spaces',
        detail:
          'Source Control lets teams branch an app, open pull requests, and merge changes across dev, staging/QA, and production, running on separate Retool instances (self-hosted Enterprise) or Retool Spaces (Cloud) with per-app control over what syncs. It targets Enterprise/self-hosted customers and requires connecting an external Git provider (GitHub, GitLab, or CodeCommit).',
        shortValue: 'Git-based branching across dev/staging/prod',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://retool.com/blog/git-branching-with-source-control',
            label: 'Introducing Source Control: Git-based branching and version control in Retool',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.retool.com/education/coe/customer-resources/environments',
            label: 'Environment Best Practices (Retool Docs)',
            asOf: '2026-07-02',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Branch-based editing, pull-request review, and release history for controlling which version is live, plus rollback and blue/green deployments.',
        detail:
          'Source Control supports branch-based editing that isolates changes without overwriting teammates, pull-request review before merging into a live app, and Retool Releases to control which Git commit is live vs draft. No dedicated diff/compare view or client-vs-server undo/redo distinction exists.',
        shortValue: 'Branching, PR review, and release history',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://retool.com/blog/git-branching-with-source-control',
            label: 'Introducing Source Control: Git-based branching and version control in Retool',
            asOf: '2026-07-02',
          },
          {
            url: 'https://retoolers.io/blog-posts/staging-vs-production-in-retool-how-environments-and-versions-work',
            label: 'Staging vs Production in Retool: How Environments and Versions Work',
            asOf: '2026-07-02',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          'Yes: Retool Multiplayer lets multiple people edit the same app at once, with live avatars and highlights showing where each teammate is working. It is generally available on Cloud and in beta for self-hosted. Under the hood it uses conflict-free replicated data types (CRDTs) over WebSockets so simultaneous edits merge automatically instead of overwriting each other.',
        detail: 'Self-hosted customers must sign up for beta access.',
        shortValue: 'Yes, live co-editing (GA on Cloud, beta on self-hosted)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/changelog/multiplayer',
            label: 'Multiplayer: Collaborative app building',
            asOf: '2026-07-02',
          },
          {
            url: 'https://retool.com/blog/multiplayer-editing',
            label: 'Introducing multiplayer editing for faster, collaborative app building',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeFileStorage: {
        value:
          'Partial: Retool Storage is a native Retool-hosted file store (cloud orgs) supporting folder creation/rename/delete, file rename/move, and link-based access (public URLs or app-scoped private URLs). No password-protected/SSO-gated sharing links or deleted-item/trash recovery mechanism is documented.',
        detail:
          'Storage caps at a fixed capacity and lacks more advanced sharing and recovery controls.',
        shortValue: 'Partial, folders and links yes, no trash/recovery or password links found',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/data-sources/quickstarts/retool-storage',
            label: 'Retool Storage quickstart',
            asOf: '2026-07-02',
          },
          {
            url: 'https://retool.com/integrations/retool-storage',
            label: 'Retool Storage',
            asOf: '2026-07-02',
          },
        ],
      },
      dataTables: {
        value:
          "Yes: Retool Database is a real, built-in Postgres-backed database (not a spreadsheet-like store), so tables can be queried with actual SQL and joined against other Resources, in addition to a spreadsheet-style Edit Table view for inline editing. Retool's Table UI component separately renders and scrolls through 100,000+ rows and hundreds of columns without slowing down.",
        detail:
          "Because it's genuine Postgres under the hood, Retool Database supports relational features (foreign keys, SQL joins/queries) that a typed-column grid like Sim's Tables does not expose; Retool does not publish hard row/column caps for Retool Database itself (forum threads mention plan-dependent limits like 50,000 records, unconfirmed as current). The Table UI component is documented to handle 100K+ rows.",
        shortValue:
          'Yes, real Postgres database (SQL-queryable), plus a large-dataset Table component',
        confidence: 'verified',
        sources: [
          {
            url: 'https://retool.com/blog/supercharging-the-retool-table',
            label: 'Supercharging the Retool table',
            asOf: '2026-07-02',
          },
          {
            url: 'https://retoolers.io/blog-posts/retool-edit-table-effortless-inline-editing',
            label: 'Retool Edit Table: Easily Modify Data in Retool',
            asOf: '2026-07-02',
          },
        ],
      },
      richTextEditor: {
        value:
          "Not true WYSIWYG editing: Retool's Rich Text Editor component lets users type HTML-formatted text, and a separate Text component displays Markdown, but neither is a full WYSIWYG Markdown editor. Community members have built custom components (based on the CKEditor library) to get true WYSIWYG Markdown editing.",
        detail:
          'Multiple long-running Retool forum feature requests ask for WYSIWYG markdown editing, still unresolved.',
        shortValue: 'No, native editor is HTML-input, not WYSIWYG markdown',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/apps/reference/components/rich-text-editor',
            label: 'The Rich Text Editor component for classic apps',
            asOf: '2026-07-02',
          },
          {
            url: 'https://retool.com/blog/text-v2-app-documentation',
            label: "Display sophisticated text via Markdown in Retool's Text component",
            asOf: '2026-07-02',
          },
          {
            url: 'https://community.retool.com/t/markdown-wysiwyg-text-editor/23689',
            label: 'Markdown WYSIWYG text editor (feature request)',
            asOf: '2026-07-02',
          },
        ],
      },
      subWorkflows: {
        value:
          'Yes: the Workflow block runs another saved workflow as a step, passing data to it and receiving its returned data back, so the parent workflow can compose child workflows rather than duplicating logic.',
        detail:
          'The Workflow block supports two execution modes: Finished, where the calling workflow pauses until the triggered workflow run completes, and Queued, where the calling workflow continues immediately while the triggered run is queued.',
        shortValue: 'Yes, Workflow block calls and waits on another workflow',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/guides/blocks/run-workflow',
            label: 'Run another workflow with the Workflow block | Retool Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.retool.com/workflows/reference/objects/block/run-workflow',
            label: 'The Workflow block | Retool Docs',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Direct providers OpenAI, Anthropic, and Google; cloud service providers AWS (Bedrock) and Azure (OpenAI); plus a "bring your own model" option.',
        detail: 'Retool lists these categories without enumerating specific model versions.',
        shortValue: 'OpenAI, Anthropic, Google, Bedrock, Azure, or BYO model',
        confidence: 'verified',
        sources: [{ url: 'https://retool.com/ai', label: 'Retool AI', asOf: '2026-07-02' }],
      },
      agentReasoningBlocks: {
        value:
          'Yes: Retool Agents is a dedicated product for encoding business processes that mixes deterministic code-based decisions with non-deterministic LLM-based decisions and human-in-the-loop steps, separate from the classic data-routing Workflows product.',
        shortValue: 'Dedicated Agents product, deterministic + LLM logic',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/agents',
            label: 'Retool Agents docs',
            asOf: '2026-07-02',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          'Yes: "Generate with AI" / AppGen lets users describe an app in plain English and iterate via prompts; Retool generates pages, queries, components, and event handlers wired to live data and existing security policies.',
        shortValue: 'AppGen builds full apps from a prompt',
        confidence: 'verified',
        sources: [
          {
            url: 'https://retool.com/ai-app-generation',
            label: 'Retool AI App Generation',
            asOf: '2026-07-02',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          "Yes: Retool Vectors is a Retool-managed vector database that stores and indexes text, PDF, or web-page content, so AI apps and agents can retrieve relevant context in one click. Embedding calls always go through OpenAI's API (default model text-embedding-ada-002), regardless of which chat model is used.",
        shortValue: 'Managed vector store with built-in embeddings',
        confidence: 'verified',
        sources: [
          {
            url: 'https://retool.com/integrations/retool-vector',
            label: 'Retool Vectors integration page',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.retool.com/data-sources/guides/vectors/embeddings',
            label: 'Manage embeddings in Retool-managed Vectors | Retool Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpSupport: {
        value:
          'Yes, bidirectional. Retool Agents can connect to external remote-hosted MCP servers (Streamable HTTP/SSE; basic, bearer-token, or OAuth 2.0 auth) as tool sources, and Retool itself can act as an MCP server so external AI tools (Claude, Cursor, Codex, Kiro) can manage Retool apps/workflows/users.',
        shortValue: 'Bidirectional. Connects to and acts as an MCP server',
        confidence: 'verified',
        sources: [
          {
            url: 'https://retool.com/blog/how-to-use-mcp-in-retool',
            label: 'How to use MCP in Retool',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.retool.com/agents/guides/tools/connect-to-mcp-server',
            label: 'Connect an MCP server to an agent | Retool Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'Partial: Retool provides governance-style guardrails, enterprise access controls, monitoring, and audit trails for agent and workflow actions, but no dedicated evaluation or test-suite framework for validating AI output quality.',
        detail:
          "Retool's guardrails are access and observability controls (enterprise access controls, monitoring, and audit trails), not a dedicated evals product.",
        shortValue: 'Access/audit controls only, no eval framework',
        confidence: 'estimated',
        sources: [{ url: 'https://retool.com/ai', label: 'Retool AI', asOf: '2026-07-02' }],
      },
      humanInTheLoop: {
        value: 'Yes: dedicated human-in-the-loop approval tasks distinct from a delay/wait step',
        detail:
          "Retool Agents and Workflows support an auditable, permissionable approval task that must be approved by one or more people in a designated permission group before a run proceeds (for example, reviewing an agent's proposed tool call or action). Approvers can be notified via Retool app/task assignment or Slack/email through workflow blocks. The run resumes automatically once the decision is recorded, and every step is logged to the audit trail.",
        shortValue: 'Auditable approval tasks that gate agent runs',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://retool.com/blog/ai-agents-in-production',
            label: 'Human + AI collaboration: Beyond the automation anxiety (Retool Blog)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://retool.com/blog/how-agents-in-retool-solves-hard-parts-of-agent-development',
            label: 'How Agents in Retool solves the hard parts of agent development',
            asOf: '2026-07-02',
          },
        ],
      },
      generativeMedia: {
        value:
          'Native image generation only. No native video generation, text-to-speech, or speech-to-text block.',
        detail:
          'Retool\'s AI query block includes a native "Generate image" action (model options such as dall-e-2/gpt-image-1 via OpenAI) that returns a base64-encoded PNG. There is no native video-generation, text-to-speech, or speech-to-text block; users build these via third-party APIs.',
        shortValue: 'Image generation only, no video/TTS/STT',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.retool.com/queries/guides/ai/image',
            label: 'Retool AI image actions (docs)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://community.retool.com/t/speech-to-text-anybody/26774',
            label: 'Speech to text - Anybody? (Retool Forum)',
            asOf: '2026-07-02',
          },
        ],
      },
      dynamicToolUse: {
        value: 'Unknown',
        detail: 'Not publicly documented.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      modelFallback: {
        value: 'Unknown',
        detail: 'Not publicly documented.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      agentSkills: {
        value:
          "Unknown: Retool has no feature for defining a reusable, named prompt or knowledge snippet once and reusing it across multiple agents by reference. Retool's agent docs describe per-agent instructions and system prompts, plus connecting Resources, Vectors, and MCP servers as tools, but not a shared 'skills library' construct.",
        detail:
          "Retool has reusable components and shared primitives for apps and workflows generally, but nothing matches a cross-agent named prompt-snippet system, the kind Anthropic and Replit call 'Agent Skills'.",
        shortValue: 'Unknown, no shared skills-library feature found',
        confidence: 'unknown',
        sources: [],
      },
      nativeChatDeployment: {
        value:
          "Estimated yes: Retool Agents include a chat interface for testing and interacting with an agent, and can be embedded into deployed Retool apps via an Agent Chat component, giving end users a conversational surface, alongside other deployment targets like email and workflows/API. A public 'share thread' replay link also exists for individual conversations.",
        detail:
          'Chat is delivered by embedding the Agent Chat component in a publicly-shared app rather than a single-click standalone public chat deployment; there is no dedicated one-click public chat endpoint.',
        shortValue: 'Estimated yes, via Agent Chat component embedded in apps',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.retool.com/agents/guides/chat-with-agent',
            label: 'Retool Agents chat',
            asOf: '2026-07-02',
          },
          {
            url: 'https://retool.com/build-enterprise-apps/agents',
            label: 'Retool Agents: Create a custom-built agent team',
            asOf: '2026-07-02',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          'Estimated yes: Retool Vectors automatically splits uploaded text into smaller chunks for embedding. When a vector search runs in an AI action, it retrieves the specific matching chunk (with its source document or URL) and adds it to the model context. Community threads mention accessing this chunk-level data, but there is no dedicated debugging view listing the chunk index and content for a given query, the way some knowledge-base products offer.',
        detail:
          'The Retool Vectors quickstart confirms automatic chunking and per-chunk retrieval, but no chunk-inspector or debug view is documented.',
        shortValue: 'Estimated, chunk-level retrieval but no dedicated debug UI found',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.retool.com/data-sources/quickstarts/retool-vectors',
            label: 'Retool-managed Vectors',
            asOf: '2026-07-02',
          },
          {
            url: 'https://community.retool.com/t/access-vector-value-from-document-chunks/43856',
            label: 'Access Vector Value from Document Chunks (forum)',
            asOf: '2026-07-02',
          },
        ],
      },
      parallelExecution: {
        value:
          'Yes: Retool Workflows has a Branch block that outputs to multiple downstream blocks, creating separate paths that run at the same time, and a Loop block with a dedicated parallel execution mode for concurrent iteration. A block with multiple incoming connections waits for all of them to finish before running, which is how parallel paths join back together. Some older community forum reports describe blocks executing sequentially rather than concurrently in certain cases, so real-world concurrency may vary from the documented behavior.',
        detail:
          'Official docs describe multi-output blocks and a Loop block parallel mode; a small number of community forum threads report inconsistent concurrent execution in practice.',
        shortValue: 'Yes, Branch block fan-out plus Loop block parallel mode',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/quickstart',
            label: 'Retool Workflows quickstart',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.retool.com/workflows/reference/objects/block/branch',
            label: 'The Branch block',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.retool.com/workflows/guides/blocks/logic/loop',
            label: 'Loop block',
            asOf: '2026-07-02',
          },
          {
            url: 'https://community.retool.com/t/do-workflow-nodes-run-in-parralell/20797',
            label: 'Do workflow nodes run in parallel? (forum)',
            asOf: '2026-07-02',
          },
        ],
      },
      a2aProtocol: {
        value:
          'Yes: Retool documents native Agent2Agent (A2A) protocol support for Retool-built agents, including agent cards, sending messages, polling for task updates, and streaming updates over Server-Sent Events. Support is ingress-only (external agents can call a Retool agent, not the reverse), limited to the HTTP+REST and JSON-RPC transports, and authenticates callers with an API key header rather than delegated auth.',
        detail:
          'Retool docs describe this as "the core set of A2A functionality" and explicitly note the input-required and auth-required task states are not supported, so tools requiring delegated authentication or approval will fail over A2A.',
        shortValue: 'Yes, ingress-only A2A support with API key auth',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/agents/concepts/a2a',
            label: 'Agent-to-agent communication (A2A)',
            asOf: '2026-07-02',
          },
        ],
      },
      loopIteration: {
        value:
          'Yes: a dedicated Loop block runs an embedded set of blocks once per item in an array, referencing each item and its index via value and index.',
        detail:
          'The Loop block supports Sequential mode (each iteration completes before the next starts, with an optional delay to avoid rate limits), Parallel mode (all iterations run simultaneously), and Batch mode (a configurable number of iterations run in parallel per batch, default batch size 10) before moving to the next batch.',
        shortValue: 'Yes, Loop block with sequential, parallel, and batch modes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/guides/blocks/logic/loop',
            label: 'Loop block | Retool Docs',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value:
          '90+ listed integrations/connectors on the public integrations page, plus generic REST API, GraphQL, and gRPC connectivity for anything without a native connector.',
        detail:
          'Categories include databases, cloud platforms, CRMs, messaging, and AI services (OpenAI, Anthropic, Google Gemini, etc.).',
        shortValue: '90+ connectors plus REST/GraphQL/gRPC',
        confidence: 'verified',
        sources: [
          {
            url: 'https://retool.com/integrations',
            label: 'Retool Integrations',
            asOf: '2026-07-02',
          },
        ],
      },
      triggerTypes: {
        value: 'Unknown',
        detail: 'Not documented in a single consolidated reference.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      customCodeSteps: {
        value: 'Unknown',
        detail: 'Not publicly documented.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      apiPublishing: {
        value:
          'Enterprise plan includes "platform APIs" for managing/orchestrating Retool resources; Retool itself can also be exposed as an MCP server for programmatic/agent access.',
        detail:
          'Platform APIs are an Enterprise-tier pricing feature. Retool has not published whether individual apps or workflows can be published as standalone REST endpoints.',
        shortValue: 'Enterprise platform APIs plus MCP server access',
        confidence: 'estimated',
        sources: [
          { url: 'https://retool.com/pricing', label: 'Retool Pricing', asOf: '2026-07-02' },
        ],
      },
      extensibilitySdk: {
        value:
          'Custom Component dev kit (React/TypeScript) + CLI, plus a community Custom Component Gallery; no general-purpose client SDK for multiple languages found',
        detail:
          "Retool provides a TypeScript API for building custom React components locally (using standard npm packages and Retool's `retool-ccl` CLI tool) that adds new properties and events to the app editor. Finished components can be published to the community Custom Component Gallery or shared privately as component libraries. There is no multi-language client SDK, such as Python, Node, or Go REST client libraries, beyond this TypeScript toolkit and workflow webhook/REST triggers.",
        shortValue: 'Custom Component React/TS kit, no multi-language SDK',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.retool.com/apps/guides/custom/custom-component-libraries/',
            label: 'Build custom React components (Retool Docs)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/tryretool/custom-component-guide',
            label: 'tryretool/custom-component-guide (GitHub)',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpPublishing: {
        value:
          "No, not in the sense of turning one specific app into its own callable tool: Retool's MCP server (public beta) exposes Retool's own build and management actions (create/edit apps, run queries, manage users, inspect resources) so external AI tools like Claude or Cursor can operate the Retool platform itself. It does not let you publish a single deployed app or workflow as its own standalone MCP tool for outside consumption.",
        detail:
          'Retool agents can call external MCP servers as tools, and Retool itself is an MCP server for managing the workspace, but no documentation confirms publishing an individual workflow or app as its own MCP endpoint for external tool-calling.',
        shortValue: 'No, MCP exposes platform control, not per-app tools',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://retool.com/blog/how-to-use-mcp-in-retool',
            label: 'How to use MCP in Retool: Two setup options for AI agents',
            asOf: '2026-07-02',
          },
          {
            url: 'https://retool.com/blog/retool-mcp-server',
            label: 'Retool MCP Server: Manage Retool from Any AI Agent',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.retool.com/agents/guides/tools/connect-to-mcp-server',
            label: 'Connect an MCP server to an agent',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Seat-based (separate builder vs. end-user/internal-user seat prices) plus pooled monthly AI-credit allocations and separately metered hourly billing for Agents usage.',
        shortValue: 'Seat-based plus AI credits and hourly Agents billing',
        confidence: 'verified',
        sources: [
          { url: 'https://retool.com/pricing', label: 'Retool Pricing', asOf: '2026-07-02' },
        ],
      },
      entryPaidPlan: {
        value:
          'Team plan: $10/builder/month and $5/internal-user/month (annual billing; $12/$7 monthly), including 5,000 workflow runs/month, staging environment, app release versions, and 1,000 AI credits/month.',
        shortValue: '$10/builder + $5/user per month (Team plan)',
        confidence: 'verified',
        sources: [
          { url: 'https://retool.com/pricing', label: 'Retool Pricing', asOf: '2026-07-02' },
        ],
      },
      freeTier: {
        value:
          'Yes: Free plan: unlimited web/mobile apps, 500 workflow runs/month, 5GB database capacity, 5GB file storage, up to 5 users, 20 hours/month of Agents, 250 AI credits/month.',
        shortValue: 'Yes, up to 5 users with limited usage',
        confidence: 'verified',
        sources: [
          { url: 'https://retool.com/pricing', label: 'Retool Pricing', asOf: '2026-07-02' },
        ],
      },
      byok: {
        value:
          'Partial: Retool AI supports "bring your own" model connections for chat/completion models (OpenAI, Anthropic, Google, AWS, Azure, or custom), but Retool Vectors\' embedding calls always go through OpenAI\'s API regardless of the chosen chat model.',
        shortValue: 'BYO chat model, but embeddings always use OpenAI',
        confidence: 'verified',
        sources: [
          { url: 'https://retool.com/ai', label: 'Retool AI', asOf: '2026-07-02' },
          {
            url: 'https://docs.retool.com/data-sources/guides/vectors/embeddings',
            label: 'Manage embeddings in Retool-managed Vectors | Retool Docs',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    security: {
      soc2: {
        value: 'Yes: SOC 2 Type 2, plus ISO/IEC 27001:2022, GDPR, and CCPA.',
        detail:
          'Reports/certificates are downloadable via the self-serve Trust Center (SafeBase-powered).',
        shortValue: 'SOC 2 Type 2, ISO 27001, GDPR, CCPA',
        confidence: 'verified',
        sources: [
          { url: 'https://trust.retool.com/', label: 'Retool Trust Center', asOf: '2026-07-02' },
          {
            url: 'https://docs.retool.com/legal/security',
            label: 'Security Practices | Retool Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      dataResidency: {
        value:
          'Cloud: customer data stored redundantly across multiple AWS data center locations (no customer-selectable region specified). Self-hosted: no Retool systems store customer data and no Retool personnel have technical/logical access to it.',
        shortValue: 'AWS-hosted (cloud); no data stored self-hosted',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/legal/security',
            label: 'Security Practices | Retool Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      rbac: {
        value:
          'Yes: role-based access control with organization-level and resource-level permissions; Business plan gets a limited set of assignable permissions, Enterprise plan gets the full range of organization-level permissions.',
        shortValue: 'Org- and resource-level roles, tiered by plan',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/permissions/guides/roles-permissions',
            label: 'Configure role-based access control | Retool Docs',
            asOf: '2026-07-02',
          },
          { url: 'https://retool.com/pricing', label: 'Retool Pricing', asOf: '2026-07-02' },
        ],
      },
      auditLogging: {
        value:
          'Yes: available starting on the Business plan (audit logging listed as a Business-tier feature), with expanded audit logging on Enterprise; Enterprise orgs can also continuously stream audit log events to Datadog, or output them to stdout for ingestion by any external pipeline on self-hosted deployments.',
        detail:
          'Cloud Business/Enterprise can additionally download audit logs from the UI in batch. No direct S3/BigQuery/generic-webhook drain is documented; Datadog streaming and self-hosted stdout are the only continuous-export mechanisms Retool publishes.',
        shortValue: 'From Business plan up; continuous export limited to Datadog/stdout',
        confidence: 'verified',
        sources: [
          { url: 'https://retool.com/pricing', label: 'Retool Pricing', asOf: '2026-07-02' },
          {
            url: 'https://docs.retool.com/changelog/audit-logs-in-datadog',
            label: 'Send audit log events to Datadog',
            asOf: '2026-07-02',
          },
        ],
      },
      additionalCompliance: {
        value:
          'SOC 2 Type II, ISO/IEC 27001:2022, GDPR, and CCPA certifications, plus HIPAA via BAA on Enterprise.',
        detail:
          'The Trust Center (SafeBase-powered) lists SOC 2 Type 2, ISO/IEC 27001:2022, GDPR, and CCPA certifications. HIPAA compliance is available with a signed BAA on Enterprise (self-hosted) plans. PCI and FedRAMP are not confirmed.',
        shortValue: 'SOC 2, ISO 27001, GDPR, CCPA; HIPAA via BAA',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://trust.retool.com/',
            label: 'Retool Trust Center (SafeBase)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.retool.com/legal/security',
            label: 'Security Practices (Retool Docs)',
            asOf: '2026-07-02',
          },
        ],
      },
      modelAndToolGovernance: {
        value: 'Unknown',
        detail: 'Not publicly documented.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      credentialGovernance: {
        value:
          'Yes: Retool (Business/Enterprise plans) supports resource-level permissions with Use, Edit, and Own tiers. Enterprise orgs can go further and set per-environment permissions on the same resource (for example, allow Use on staging credentials but deny production credentials), independent of feature-level RBAC.',
        detail:
          "Permission control for Resources (Use/Edit/Own tiers) is available starting on the Business plan; per-environment override, selecting 'Define specific resource access' on a resource, is an Enterprise-only capability.",
        shortValue: 'Yes, Use/Edit/Own permissions per resource per env',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/org-users/guides/configuration/environments',
            label: 'Configure resource environments',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.retool.com/changelog/new-resource-permissions',
            label: 'New resource permission levels changelog',
            asOf: '2026-07-02',
          },
          {
            url: 'https://blog.boldtech.dev/advanced-permissions-retool-fundamentals/',
            label: 'Advanced permissions in Retool: The Fundamentals',
            asOf: '2026-07-02',
          },
          { url: 'https://retool.com/pricing', label: 'Retool Pricing', asOf: '2026-07-04' },
        ],
      },
      whiteLabeling: {
        value:
          "Yes: Retool's Enterprise plan includes full white-labeling, letting orgs replace the Retool logo/favicon and remove references to the Retool name across login pages, headers, invite/password-reset emails, and app presentation mode. The Business plan gets custom branding with fewer white-label controls. Separately, white-labeled Retool Mobile apps can be requested for the iOS/Android app stores.",
        detail:
          'Custom domain (Business/Enterprise) is required alongside white-labeling for a fully de-branded experience.',
        shortValue: 'Yes, full white-labeling on Enterprise plan',
        confidence: 'verified',
        sources: [
          {
            url: 'https://retool.com/pricing',
            label: 'Retool Pricing',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.retool.com/apps/mobile/guides/whitelabel',
            label: 'White-labeled Retool Mobile apps',
            asOf: '2026-07-02',
          },
          {
            url: 'https://community.retool.com/t/change-retool-logo-for-custom-logo-at-retool-login-page-with-retool-branding-options/22734',
            label: 'Change Retool Logo for Custom Logo (forum)',
            asOf: '2026-07-02',
          },
        ],
      },
      dataRetention: {
        value:
          'No: Retool Cloud has a fixed one-year audit log retention with only the most recent three months browsable in the UI; there is no documented org-configurable retention window on Cloud. Self-hosted orgs manage retention themselves via their own infrastructure, but that is operator-managed, not a Retool-provided configurable setting.',
        detail:
          'No configurable retention windows exist for other resources, like soft-deleted items, either.',
        shortValue: 'No, fixed 1-year retention on Cloud, not configurable',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.retool.com/org-users/guides/monitoring/audit-logs',
            label: 'View user audit logs',
            asOf: '2026-07-02',
          },
        ],
      },
      piiRedaction: {
        value:
          "No: Retool has no automated PII-detection or redaction system for workflow content or logs. The closest control is the manual, per-query 'Remove parameters from logs' option in Advanced Options, which lets a builder exclude specific named parameters (which could include PII) from being written to audit logs. This is manual exclusion, not automatic PII detection or redaction.",
        shortValue: 'No, only manual log-parameter exclusion, not PII detection',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/education/coe/customer-resources/security-checklist',
            label: 'Security Checklist',
            asOf: '2026-07-02',
          },
        ],
      },
      sso: {
        value:
          'Yes: Retool supports SAML 2.0 SSO (Business plan and above) compatible with Okta, Azure AD, Google Workspace, OneLogin and other SAML/OIDC providers, plus SCIM-based auto-provisioning (create/update/deactivate users automatically) available on Cloud or self-hosted 2.32.1+.',
        detail:
          "The Enterprise plan separately lists 'Custom SSO' as a feature, suggesting tiered SSO capability between Business and Enterprise.",
        shortValue: 'Yes, SAML/OIDC SSO plus SCIM auto-provisioning',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/sso/guides/scim-user-provisioning',
            label: 'Provision users with SCIM',
            asOf: '2026-07-02',
          },
          {
            url: 'https://retool.com/pricing',
            label: 'Retool Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      thirdPartyVetting: {
        value:
          "Yes: Retool's built-in integrations (Resources) are a first-party catalog of roughly 50 databases, APIs, and cloud services built and maintained by Retool, not an open marketplace of third-party-submitted connectors. Retool separately offers Custom Component Libraries, which let a customer's own developers pull in npm packages to build custom UI components, but these are private to the authoring organization by default (or explicitly made public by that org), not a shared registry where other Retool customers install code published by unrelated third parties.",
        detail:
          "A custom component loads into a sandboxed iframe, and Retool's custom-component-guide plus a community forum thread ('Custom Component Vulnerabilities') flag that developers should run npm audit on dependencies pulled into their own component libraries. This is a supply-chain caution for self-authored code, not an incident involving a shared marketplace, since no public component marketplace exists.",
        shortValue: 'Yes, first-party integration catalog, no public component marketplace',
        confidence: 'verified',
        sources: [
          {
            url: 'https://retool.com/integrations',
            label: 'Retool Integrations',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.retool.com/apps/guides/custom/custom-component-libraries/',
            label: 'Build custom React components',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Per-run/per-block execution logs and status in Run History; no native distributed tracing with spans. Latency percentile and error-rate dashboards require connecting Datadog or Sentry.',
        detail:
          'Run History lists every workflow run with date/time/status and lets you drill into each block to find where a failure occurred, filterable by error/success/info. This is block-level status logging, not distributed tracing with spans. For latency percentile or error-rate dashboards, Retool points to connecting an external tool like Datadog or Sentry rather than offering a built-in metrics dashboard.',
        shortValue: 'Block-level run logs; tracing via Datadog/Sentry',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/guides/error-handlers',
            label: 'Configure workflow error handlers (Retool Docs)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.retool.com/apps/guides/observability/',
            label: 'Observability (Retool Docs)',
            asOf: '2026-07-02',
          },
        ],
      },
      durabilityModel: {
        value:
          'Automatic retries with configurable schedules and exponential backoff. No durable checkpointing or one-click replay of a past execution with its original inputs.',
        detail:
          'Workflows can configure error handlers to automatically retry failed blocks on a schedule, including exponential backoff for rate-limited APIs/data sources, plus block-level and global error handlers for unhandled errors. There is no durable checkpointing of workflow state or one-click replay of a past execution with its original inputs beyond re-running/retrying.',
        shortValue: 'Configurable retries with backoff; no checkpointing',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/guides/error-handlers',
            label: 'Configure workflow error handlers (Retool Docs)',
            asOf: '2026-07-02',
          },
        ],
      },
      failureAlerting: {
        value:
          'Alerting is DIY. Built via error-handler blocks wired to Slack/email/notification actions. No built-in proactive alert or cost/latency-threshold subscription system.',
        detail:
          'Retool Workflows exposes `workflowContext.currentRun.error` inside an error handler block, which builders commonly wire to a Slack or email notification action to be proactively notified of a failed run. There is no native cost/latency-threshold alerting feature (e.g., an admin setting an alert for runs exceeding a cost or duration threshold); this is typically DIY via error handlers.',
        shortValue: 'DIY via error handlers, no built-in alerting',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/guides/error-handlers',
            label: 'Configure workflow error handlers (Retool Docs)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://community.retool.com/t/notify-on-error-during-workflow/49006',
            label: 'Notify on error during workflow (Retool Forum)',
            asOf: '2026-07-02',
          },
        ],
      },
      dataDrains: {
        value:
          'Yes: Retool Enterprise orgs (Cloud or self-hosted 3.38 Edge+) can continuously stream audit log events to Datadog, and self-hosted deployments can set LOG_AUDIT_EVENTS=true to output all audit events to stdout for ingestion by any external log pipeline.',
        detail:
          'Cloud Business/Enterprise can also download audit logs from the UI (batch, not a live drain). No direct S3/BigQuery/generic-webhook drains are documented; Datadog and self-hosted stdout are the documented mechanisms.',
        shortValue: 'Yes, audit log streaming to Datadog / stdout',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/changelog/audit-logs-in-datadog',
            label: 'Send audit log events to Datadog',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.retool.com/org-users/guides/monitoring/audit-logs',
            label: 'View user audit logs',
            asOf: '2026-07-02',
          },
        ],
      },
      asyncExecution: {
        value:
          "Yes: Retool Workflows can run asynchronously in the background. Triggering a workflow (via the API startTrigger endpoint or a webhook) kicks off a run that continues executing after the initial request returns, and you can check back on it later using the Retool API's Get Workflow Run Details endpoint, which returns the run's status and result.",
        detail:
          "Retool explicitly distinguishes 'synchronous workflow runs' (blocks until a Response block executes, 15-minute timeout) from 'asynchronous workflow runs' (up to 30 hours) in its own docs, and provides a Get Workflow Run Details API to fetch a run's status/result after triggering.",
        shortValue: 'Yes, async trigger + poll for run status',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/concepts/limits',
            label: 'Retool Docs: Workflow limits (sync vs async execution modes)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.retool.com/api/get-workflow-run-details',
            label: 'Retool API Docs: Get Workflow Run Details',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.retool.com/workflows/guides/webhooks',
            label: 'Retool Docs: Trigger workflows with webhooks',
            asOf: '2026-07-02',
          },
        ],
      },
      executionLimits: {
        value:
          'Yes: Retool publishes concrete execution limits. Synchronous workflow runs (blocking until the first webhook Response block) time out after 15 minutes; asynchronous runs time out after 30 hours, though workflows with a User Task or Wait block can run indefinitely (individual Wait blocks still cap at 60 days). Resource and query blocks can run up to 2 minutes in sync mode or up to 10 minutes in async mode (Cloud). Concurrency is capped at 50 in-flight outbound requests per workflow and 100 concurrent workflow runs on Retool Cloud, with a burst allowance of 200 runs in a 10-second window, and each run can use up to 2.5GB of memory.',
        detail:
          'Self-hosted customers can raise the 50 in-flight request cap via the WORKFLOW_REQUEST_CONCURRENCY_LIMIT env var, and memory enforcement (2,500 MB default) is opt-in via WORKFLOW_MONITOR_PROCESS_ENABLED.',
        shortValue: '15 min sync / 30 hr async timeout; 100 concurrent runs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/concepts/limits',
            label: 'Retool Docs: Workflow limits',
            asOf: '2026-07-02',
          },
        ],
      },
      partialFailureHandling: {
        value:
          "Yes: Retool Workflows let a failing block route to a dedicated error-handling path while the rest of the run continues, rather than always halting the whole execution. Each block has a red 'On Error' connector you can wire to a downstream handler block, and workflow-level (global) error handlers catch any unhandled errors from blocks that don't have their own On Error connection.",
        detail:
          'Global error handlers only fire for blocks lacking a block-level On Error connection, avoiding double handling; error details are exposed at workflowContext.currentRun.error for logging.',
        shortValue: 'Yes, per-block On Error routing continues run',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/guides/error-handlers',
            label: 'Retool Docs: Configure workflow error handlers',
            asOf: '2026-07-02',
          },
        ],
      },
      unattendedExecution: {
        value:
          "Yes: scheduled and webhook-triggered Retool Workflow runs execute entirely on Retool's servers (Cloud) or the self-hosted deployment's own infrastructure, not on a builder's browser or device.",
        detail:
          'A triggered run continues executing after the initial request returns and can be polled later via the Get Workflow Run Details API, exactly as documented for asynchronous runs. No client device needs to stay open, awake, or connected for a scheduled or webhook-triggered run to fire or complete.',
        shortValue: 'Yes, runs server-side; no client device dependency',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/concepts/limits',
            label: 'Retool Docs: Workflow limits (sync vs async execution modes)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.retool.com/workflows/guides/webhooks',
            label: 'Retool Docs: Trigger workflows with webhooks',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Community Discourse forum (free tier), email + chat (Team plan), dedicated/priority support (Business and Enterprise plans); a Slack group is available to invited "Power Users."',
        detail:
          'Support channels scale with plan tier, from community forum access on the free tier up to dedicated support on Business and Enterprise.',
        shortValue: 'Forum on free tier up to dedicated Enterprise support',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.retool.com/support/',
            label: 'Contact Retool support | Retool Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      sla: {
        value:
          'Yes: custom SLA available on the Enterprise plan, alongside dedicated support engineers/account management.',
        detail:
          'Enterprise plans include dedicated support engineers, account management, and a custom SLA.',
        shortValue: 'Custom SLA on Enterprise plan',
        confidence: 'estimated',
        sources: [
          { url: 'https://retool.com/pricing', label: 'Retool Pricing', asOf: '2026-07-02' },
        ],
      },
      community: {
        value:
          'Community Discourse forum with 1,000+ posts. No GitHub star count or Slack member count is publicly disclosed.',
        detail:
          'Forum activity figures come from third-party reporting rather than a published Retool metrics page.',
        shortValue: 'Active Discourse forum, no public star/member count',
        confidence: 'estimated',
        sources: [
          { url: 'https://retool.com/community', label: 'Retool Community', asOf: '2026-07-02' },
        ],
      },
      companyMaturity: {
        value:
          'Founded 2017; ~$165M total funding raised (Series A/B/C, investors incl. Sequoia Capital, Y Combinator); valuation ~$3.2B (unicorn since 2021); ~415 employees (as of mid-2026)',
        detail:
          'Retool is a San Francisco-based company founded in 2017. Aggregated funding data reports $165M raised across 6 rounds from 28 investors (including Sequoia Capital, Y Combinator, Magic Fund), reaching unicorn status in 2021 with a reported valuation of $3.2B, and an employee count of 415 as of May 31, 2026.',
        shortValue: 'Founded 2017, ~$165M raised, ~$3.2B valuation',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.crunchbase.com/organization/retool',
            label: 'Retool - Crunchbase Company Profile & Funding',
            asOf: '2026-07-02',
          },
          {
            url: 'https://tracxn.com/d/companies/retool/__3Qw2mDrisfHcLzB8sG6xEXwD7lueXw7kuVlus34H2KY',
            label: 'Retool - 2026 Company Profile, Team, Funding & Competitors (Tracxn)',
            asOf: '2026-07-02',
          },
        ],
      },
      academy: {
        value:
          'Yes: Retool University (university.retool.com) is a structured education platform with course paths for developers, admins, and architects, including a Retool Platform Developer certification path with earnable digital badges, plus Labs walkthroughs and recorded Developer Day sessions.',
        detail:
          'Launched with five course paths; Retool Platform Developer and Platform Admin courses award Credly digital badges. A third-party Coursera course also exists but the primary academy is Retool University.',
        shortValue: 'Yes, Retool University with certification badges',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/education/',
            label: 'Retool University docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://retool.com/blog/introducing-retool-university',
            label: 'Introducing Retool University',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.credly.com/org/retool-inc/badge/retool-platform-developer',
            label: 'Retool Platform Developer badge on Credly',
            asOf: '2026-07-02',
          },
        ],
      },
    },
  },
}
