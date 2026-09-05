import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Reviewed against public documentation and source code on 2026-09-04. */
export const simProfile: CompetitorProfile = {
  id: 'sim',
  name: 'Sim',
  website: 'https://sim.ai',
  oneLiner:
    'Sim is an open-source AI workspace for building and running agents with a visual workflow canvas, natural-language Chat, custom code, connected services, and multiple model providers.',
  standoutFeatures: [
    {
      title: 'Workspace Chat and workflow-scoped Copilot',
      description:
        'Use natural language to build and edit workflows, work with files and tables, research, and schedule jobs. The in-editor assistant focuses on the current workflow.',
      shortDescription:
        'Build workflows and manage workspace resources through natural-language requests.',
      source: {
        url: 'https://docs.sim.ai/chat',
        label: 'Sim Docs: Chat',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Built-in knowledge base with editable chunks',
      description:
        'Upload documents, configure chunking, search by meaning, and inspect or edit individual chunks. Connectors can keep external content synchronized.',
      shortDescription: 'Search your documents and inspect, edit, merge, or split their chunks.',
      source: {
        url: 'https://docs.sim.ai/knowledgebase',
        label: 'Sim Docs: Knowledge base',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'MCP workflow publishing',
      description:
        'Publish deployed workflows as tools on public or API-key-protected MCP servers for external assistants.',
      shortDescription: 'Expose deployed workflows as tools for MCP-compatible clients.',
      source: {
        url: 'https://docs.sim.ai/workflows/deployment/mcp',
        label: 'Sim Docs: MCP deployment',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Workspace forks for separate environments',
      description:
        'Fork workspaces and preview, push, pull, or roll back changes. Sync requires mapping environment-specific resources and credentials. Enterprise on Sim Cloud.',
      shortDescription: 'Fork, diff, and sync workspaces with explicit resource mappings.',
      source: {
        url: 'https://docs.sim.ai/platform/enterprise/forks',
        label: 'Sim Docs: Workspace forks',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Human-in-the-loop approval steps',
      description:
        'Pause a workflow for human input and resume it through an approval portal or API. Configure notification steps to deliver the approval link.',
      shortDescription: 'Pause for approval and resume through a portal or API.',
      source: {
        url: 'https://docs.sim.ai/workflows/blocks/human-in-the-loop',
        label: 'Sim Docs: Human in the Loop',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Self-hostable open-source core',
      description:
        'Run the Apache-2.0 core with Docker or Kubernetes. Enterprise code has separate license terms, and Chat requires a Sim-managed service connection.',
      shortDescription:
        'Self-host the core; Enterprise licensing and external services have separate requirements.',
      source: {
        url: 'https://docs.sim.ai/platform/self-hosting',
        label: 'Sim Docs: Self-hosting',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Live workflow collaboration',
      description:
        'The collaborative editor synchronizes workflow activity and broadcasts participant cursors and selections.',
      shortDescription: 'Work together on a canvas with live cursors and selections.',
      source: {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/realtime/src/handlers/presence.ts',
        label: 'Sim source: live cursors and selections',
        asOf: '2026-09-04',
      },
    },
  ],
  limitations: [
    {
      title: 'Self-hosting still requires service configuration',
      description:
        'The core runs on your infrastructure, but Chat uses a Sim-managed service. Knowledge-base embeddings, integrations, and remote code execution require their configured providers or credentials.',
      shortDescription: 'Plan for Chat, embedding, integration, and sandbox service dependencies.',
      source: {
        url: 'https://docs.sim.ai/platform/self-hosting',
        label: 'Sim Docs: Self-hosting',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Enterprise capabilities have separate terms',
      description:
        'The core repository is Apache-2.0 licensed. Enterprise features have a separate license; Sim Cloud also gates governance features by plan.',
      shortDescription: 'Check Enterprise licensing and plan eligibility for governance features.',
      source: {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/ee/LICENSE',
        label: 'Sim Enterprise License',
        asOf: '2026-09-04',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value: 'Visual workflow canvas, natural-language Chat, and custom code or API access',
        shortValue: 'Visual canvas, Chat, code, and API',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/introduction',
            label: 'Sim Docs: Introduction',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.sim.ai/chat',
            label: 'Sim Docs: Chat',
            asOf: '2026-09-04',
          },
        ],
      },
      learningCurve: {
        value: 'Not objectively rated; visual and conversational building are documented',
        shortValue: 'No independently measured learning-curve rating',
        detail: 'Advanced integrations, code, and self-hosting still require technical setup.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.sim.ai/introduction',
            label: 'Sim Docs: Introduction',
            asOf: '2026-09-04',
          },
        ],
      },
      selfHostOption: {
        value: 'Yes: Docker Compose and Kubernetes deployment options for the open-source core',
        shortValue: 'Docker Compose or Kubernetes',
        detail:
          'Configure external services separately; Enterprise code has its own license terms.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/self-hosting/docker',
            label: 'Sim Docs: Docker',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.sim.ai/platform/self-hosting/kubernetes',
            label: 'Sim Docs: Kubernetes',
            asOf: '2026-09-04',
          },
        ],
      },
      deploymentOptions: {
        value: 'Managed Sim Cloud or a deployment on your own infrastructure',
        shortValue: 'Managed cloud or self-hosted',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/self-hosting',
            label: 'Sim Docs: Self-hosting',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.sim.ai/pricing',
            label: 'Sim pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      templates: {
        value: 'Unknown: a current importable workflow-template gallery was not verified',
        shortValue: 'Importable template gallery not verified',
        confidence: 'unknown',
        sources: [],
      },
      license: {
        value: 'Apache 2.0 for the core; separate Enterprise license for enterprise features',
        shortValue: 'Apache-2.0 core; separate Enterprise terms',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/ee/LICENSE',
            label: 'Sim Enterprise License',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.sim.ai/introduction',
            label: 'Sim Docs: Introduction',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/simstudioai/sim',
            label: 'Sim GitHub repository',
            asOf: '2026-09-04',
          },
        ],
      },
      environmentPromotion: {
        value: 'Yes: workspace forks with diff, push/pull sync, and rollback',
        shortValue: 'Workspace forks and sync (Enterprise on Cloud)',
        detail:
          'Sync requires mapping credentials and other environment-specific resources; copying and synchronization behavior varies by resource.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/enterprise/forks',
            label: 'Sim Docs: Workspace forks',
            asOf: '2026-09-04',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Deployment history with promotion of an older version and loading a deployment onto the canvas',
        shortValue: 'Deployment history and rollback',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/deployment/api',
            label: 'Sim Docs: API deployment',
            asOf: '2026-09-04',
          },
        ],
      },
      realtimeCollaboration: {
        value: 'Yes: collaborative workflow editing with live cursors and selections',
        shortValue: 'Live canvas cursors and selections',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/realtime/src/handlers/presence.ts',
            label: 'Sim source: live cursors and selections',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.sim.ai/introduction',
            label: 'Sim Docs: Introduction',
            asOf: '2026-09-04',
          },
        ],
      },
      nativeFileStorage: {
        value: 'Yes: a workspace file store shared by users and workflows',
        shortValue: 'Shared workspace files and workflow outputs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/files',
            label: 'Sim Docs: Files',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.sim.ai/files',
            label: 'Sim Files',
            asOf: '2026-09-04',
          },
        ],
      },
      dataTables: {
        value:
          'Yes: native typed tables with keyboard editing, spreadsheet paste, and workflow access',
        shortValue: 'Typed tables with spreadsheet paste and undo',
        detail:
          'Published per-table limits are 50,000 rows on Free, 100,000 on Pro, and 500,000 on Max; Enterprise is custom.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/tables',
            label: 'Sim Docs: Tables',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.sim.ai/pricing',
            label: 'Sim pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      richTextEditor: {
        value: 'Yes: rich Markdown editing with formatting, tables, lists, images, and diagrams',
        shortValue: 'Rich Markdown editor',
        detail:
          'Files containing unsupported editable constructs such as raw HTML or footnotes open read-only to preserve the source.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/files/editor',
            label: 'Sim Docs: File editor',
            asOf: '2026-09-04',
          },
        ],
      },
      subWorkflows: {
        value: 'Yes: a Workflow block calls a child workflow and returns its result',
        shortValue: 'Reusable child-workflow calls',
        detail:
          'Deployment behavior depends on the execution context; use deployed child workflows for production.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/blocks/workflow',
            label: 'Sim Docs: Workflow block',
            asOf: '2026-09-04',
          },
        ],
      },
      customBlocks: {
        value: 'Yes: publish a deployed workflow as a reusable organization-wide block',
        shortValue: 'Publish workflows as organization-wide blocks',
        detail:
          'Workspace admins choose exposed outputs. Consumers do not need access to the source workflow. Internal steps stay hidden by default, but publishers can enable consumer trace visibility.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/enterprise/custom-blocks',
            label: 'Sim Docs: Custom blocks',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'OpenAI, Anthropic, Google, Azure, AWS Bedrock, OpenRouter, and other hosted or local model providers',
        shortValue: 'Multiple hosted and local model providers',
        detail:
          'The workflow Agent block supports provider selection; the workspace Chat service has its own model policy.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/blocks/agent',
            label: 'Sim Docs: Agent block',
            asOf: '2026-09-04',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          'Yes: Agent blocks reason, call configured tools, and return text or structured output',
        shortValue: 'Agent blocks with reasoning and tool calls',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/blocks/agent',
            label: 'Sim Docs: Agent block',
            asOf: '2026-09-04',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          'Yes: workspace Chat and workflow-scoped assistance build and edit workflows from prompts',
        shortValue: 'Chat and Copilot build and edit workflows',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/chat',
            label: 'Sim Docs: Chat',
            asOf: '2026-09-04',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          'Yes: document ingestion, semantic retrieval, configurable chunking, and external-source connectors',
        shortValue: 'Document RAG with chunking and connectors',
        detail:
          'Supported formats include PDF, Word, text, Markdown, HTML, spreadsheets, presentations, CSV, JSON, and YAML. Live sync availability depends on plan.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/knowledgebase',
            label: 'Sim Docs: Knowledge base',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.sim.ai/knowledgebase/connectors',
            label: 'Sim Docs: Connectors',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpSupport: {
        value: 'Yes: call external MCP tools and publish deployed workflows as MCP tools',
        shortValue: 'MCP client and server',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/agents/mcp',
            label: 'Sim Docs: Using MCP tools',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.sim.ai/workflows/deployment/mcp',
            label: 'Sim Docs: MCP deployment',
            asOf: '2026-09-04',
          },
        ],
      },
      evaluationGuardrails: {
        value: 'Evaluator scoring and Guardrails checks for JSON, regex, grounding, and PII',
        shortValue: 'LLM scoring plus validation and PII checks',
        detail: 'These are workflow blocks; each Guardrails block performs one configured check.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/blocks/evaluator',
            label: 'Sim Docs: Evaluator',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.sim.ai/workflows/blocks/guardrails',
            label: 'Sim Docs: Guardrails',
            asOf: '2026-09-04',
          },
        ],
      },
      humanInTheLoop: {
        value: 'Yes: pause a workflow for approval or input, then resume through a portal or API',
        shortValue: 'Approval portal and resumable workflow steps',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/blocks/human-in-the-loop',
            label: 'Sim Docs: Human in the Loop',
            asOf: '2026-09-04',
          },
        ],
      },
      generativeMedia: {
        value: 'Yes: image, video, text-to-speech, and speech-to-text integrations',
        shortValue: 'Image, video, and audio integrations',
        detail: 'Available operations depend on the selected provider and credentials.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.sim.ai/integrations',
            label: 'Sim integration catalog',
            asOf: '2026-09-04',
          },
        ],
      },
      dynamicToolUse: {
        value:
          'Agent blocks select among tools attached by the author; workspace Chat has broader workspace actions',
        shortValue: 'Agent tools are configured; Chat has workspace actions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/blocks/agent',
            label: 'Sim Docs: Agent block',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.sim.ai/chat',
            label: 'Sim Docs: Chat',
            asOf: '2026-09-04',
          },
        ],
      },
      modelFallback: {
        value:
          'Unknown: automatic failover to another model or provider is not documented for the Agent block',
        shortValue: 'Cross-model failover not verified',
        confidence: 'unknown',
        sources: [],
      },
      agentSkills: {
        value:
          'Yes: reusable Markdown instruction packages loaded on demand by agents or selected in Chat',
        shortValue: 'Reusable skills loaded on demand',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/agents/skills',
            label: 'Sim Docs: Agent skills',
            asOf: '2026-09-04',
          },
        ],
      },
      nativeChatDeployment: {
        value: 'Yes: hosted chat interfaces with streaming, file uploads, and configurable access',
        shortValue: 'Hosted chat; public, password, email, or SSO',
        detail: 'SSO-protected chats require Enterprise eligibility.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/deployment/chat',
            label: 'Sim Docs: Chat deployment',
            asOf: '2026-09-04',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          'Yes: search results expose chunk text, source, index, and similarity; document chunks are editable',
        shortValue: 'Chunk-level results and editing',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/knowledgebase/debugging-retrieval',
            label: 'Sim Docs: Debugging retrieval',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.sim.ai/knowledgebase',
            label: 'Sim Docs: Knowledge base',
            asOf: '2026-09-04',
          },
        ],
      },
      parallelExecution: {
        value: 'Yes: Parallel containers execute branches concurrently in configurable batches',
        shortValue: 'Parallel branches in batches of up to 20',
        detail: 'Larger collections run in successive batches.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/blocks/parallel',
            label: 'Sim Docs: Parallel block',
            asOf: '2026-09-04',
          },
        ],
      },
      a2aProtocol: {
        value: 'Yes: an A2A integration discovers agent cards, sends messages, and manages tasks',
        shortValue: 'A2A agent discovery and task operations',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/integrations/a2a',
            label: 'Sim Docs: A2A integration',
            asOf: '2026-09-04',
          },
        ],
      },
      loopIteration: {
        value: 'Yes: sequential For, ForEach, While, and Do-While loop containers',
        shortValue: 'For, ForEach, While, and Do-While',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/blocks/loop',
            label: 'Sim Docs: Loop block',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value: '259 apps and services listed in the public integration catalog',
        shortValue: '259 listed apps and services',
        detail:
          'The broader marketing claim of 1,000+ integrations uses a different scope; this count follows the public service directory.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.sim.ai/integrations',
            label: 'Sim integration catalog',
            asOf: '2026-09-04',
          },
        ],
      },
      triggerTypes: {
        value:
          'Manual, API, schedule, webhook, chat, and provider events, plus Sim Table and workspace-event triggers',
        shortValue: 'API, schedules, webhooks, chat, and events',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/deployment/api',
            label: 'Sim Docs: API deployment',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.sim.ai/workflows/triggers/table',
            label: 'Sim Docs: Table trigger',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.sim.ai/workflows/triggers/sim',
            label: 'Sim Docs: Workspace Events',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.sim.ai/introduction',
            label: 'Sim Docs: Introduction',
            asOf: '2026-09-04',
          },
        ],
      },
      customCodeSteps: {
        value:
          'Yes: a Function block runs JavaScript, Python, or Shell with runtime-dependent availability',
        shortValue: 'JavaScript, Python, and Shell Function blocks',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/blocks/function',
            label: 'Sim Docs: Function block',
            asOf: '2026-09-04',
          },
        ],
      },
      codeSandboxRuntime: {
        value:
          'Yes: named Function sandboxes with language packages, system packages, and managed CLI tools',
        shortValue: 'Named sandboxes with packages and CLI tools',
        detail:
          'Requires Max or Enterprise on Sim Cloud. Self-hosted deployments require the feature and remote execution provider configuration.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/blocks/function',
            label: 'Sim Docs: Function block',
            asOf: '2026-09-04',
          },
        ],
      },
      apiPublishing: {
        value:
          'Yes: deploy workflows as REST endpoints with synchronous, streaming, or asynchronous execution',
        shortValue: 'REST API with sync, streaming, and async modes',
        detail: 'The current execution API is under /api/v2.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/deployment/api',
            label: 'Sim Docs: API deployment',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.sim.ai/api-reference/getting-started',
            label: 'Sim Docs: API getting started',
            asOf: '2026-09-04',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Official Python and TypeScript SDKs, custom tools, Function blocks, and MCP connections',
        shortValue: 'Python and TypeScript SDKs plus custom tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/api-reference/python',
            label: 'Sim Docs: Python SDK',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.sim.ai/api-reference/typescript',
            label: 'Sim Docs: TypeScript SDK',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.sim.ai/agents/mcp',
            label: 'Sim Docs: Using MCP tools',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpPublishing: {
        value: 'Yes: publish deployed workflows on public or API-key-protected MCP servers',
        shortValue: 'Workflows as public or protected MCP tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/deployment/mcp',
            label: 'Sim Docs: MCP deployment',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value: 'Per-seat paid plans with included credits and optional usage overages',
        shortValue: 'Subscription plus credit-based usage',
        detail:
          'Workflow costs include a base run charge and applicable model or hosted-tool usage.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.sim.ai/pricing',
            label: 'Sim pricing',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.sim.ai/platform/costs',
            label: 'Sim Docs: Cost calculation',
            asOf: '2026-09-04',
          },
        ],
      },
      entryPaidPlan: {
        value:
          'Pro: US$25 per user/month with monthly billing; US$21.25/month equivalent billed annually',
        shortValue: 'Pro: $25/user/month, monthly billing',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.sim.ai/pricing',
            label: 'Sim pricing',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.sim.ai/platform/costs',
            label: 'Sim Docs: Cost calculation',
            asOf: '2026-09-04',
          },
        ],
      },
      freeTier: {
        value: 'Yes: Free plan with 1,000 one-time credits and plan-specific resource limits',
        shortValue: 'Free plan with 1,000 one-time credits',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.sim.ai/pricing',
            label: 'Sim pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      byok: {
        value:
          'Yes: supported model and tool providers can use your keys, with provider charges paid directly',
        shortValue: 'BYOK for supported models and tools',
        detail:
          'BYOK avoids hosted-provider markup; it does not remove the workflow base charge or all platform limits.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/costs',
            label: 'Sim Docs: Cost calculation',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    security: {
      dataResidency: {
        value:
          'Self-hosting controls where the core application and database run; external services retain their own data paths',
        shortValue: 'Self-hosted infrastructure; external services need review',
        detail:
          'Chat is Sim-managed, knowledge-base embeddings require a configured provider, and integrations or remote sandboxes may send data outside the deployment. Self-hosting alone does not guarantee all data stays on premises.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/self-hosting',
            label: 'Sim Docs: Self-hosting',
            asOf: '2026-09-04',
          },
        ],
      },
      rbac: {
        value:
          'Yes: organization roles, workspace Read/Write/Admin access, and Enterprise permission groups',
        shortValue: 'Organization/workspace roles; Enterprise permission groups',
        detail: 'Team collaboration and governance availability depend on plan.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/permissions',
            label: 'Sim Docs: Roles and permissions',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.sim.ai/platform/enterprise/access-control',
            label: 'Sim Docs: Access control',
            asOf: '2026-09-04',
          },
        ],
      },
      auditLogging: {
        value: 'Yes: organization audit-log UI and API, with scheduled export through Data Drains',
        shortValue: 'Audit logs, API access, and export',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/enterprise/audit-logs',
            label: 'Sim Docs: Audit logs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.sim.ai/platform/enterprise/data-drains',
            label: 'Sim Docs: Data drains',
            asOf: '2026-09-04',
          },
        ],
      },
      compliance: {
        value: 'Sim publicly states that it is SOC 2 compliant',
        shortValue: 'SOC 2 compliance stated by Sim',
        detail:
          'The reviewed public enterprise page does not specify the SOC 2 report type or audit scope. Do not infer ISO certification or a HIPAA agreement from this statement. Self-hosting is a deployment option, not an attestation.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.sim.ai/enterprise',
            label: 'Sim enterprise',
            asOf: '2026-09-04',
          },
        ],
      },
      modelAndToolGovernance: {
        value:
          'Yes: permission groups restrict providers, individual models, blocks, tools, and platform features',
        shortValue: 'Provider, model, block, and tool restrictions',
        detail:
          'Enterprise controls apply to the relevant organization and workspace; provider data-retention terms remain separate.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/enterprise/access-control',
            label: 'Sim Docs: Access control',
            asOf: '2026-09-04',
          },
        ],
      },
      credentialGovernance: {
        value:
          'Yes: credentials have use and administration roles, and permission groups can restrict credential access',
        shortValue: 'Credential roles and permission-group restrictions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/permissions',
            label: 'Sim Docs: Roles and permissions',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.sim.ai/platform/enterprise/access-control',
            label: 'Sim Docs: Access control',
            asOf: '2026-09-04',
          },
        ],
      },
      whiteLabeling: {
        value:
          'Yes: Enterprise organization branding; separate instance-level branding for self-hosting',
        shortValue: 'Organization and instance branding options',
        detail:
          'Organization branding applies to signed-in members; public surfaces use separate instance settings and have documented limitations.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/enterprise/whitelabeling',
            label: 'Sim Docs: White-labeling',
            asOf: '2026-09-04',
          },
        ],
      },
      dataRetention: {
        value:
          'Yes: Enterprise retention policies for logs, deleted resources, and Chat data, with workspace overrides',
        shortValue: 'Organization retention with workspace overrides',
        detail:
          'Options range from one day to five years or Forever. Deletion runs on scheduled cleanup jobs.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/enterprise/data-retention',
            label: 'Sim Docs: Data retention',
            asOf: '2026-09-04',
          },
        ],
      },
      piiRedaction: {
        value:
          'Yes: Guardrails PII detection/masking and configurable Enterprise redaction policies',
        shortValue: 'Presidio checks and configurable redaction stages',
        detail:
          'Policies can apply to logs, workflow input, or block outputs. In-flight redaction can change workflow results.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/blocks/guardrails',
            label: 'Sim Docs: Guardrails',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.sim.ai/platform/enterprise/data-retention',
            label: 'Sim Docs: Data retention',
            asOf: '2026-09-04',
          },
        ],
      },
      sso: {
        value:
          'Yes: OIDC and SAML 2.0 with verified-domain routing and configurable member provisioning',
        shortValue: 'OIDC/SAML; automatic or invite-only provisioning',
        detail:
          'Automatic provisioning creates organization membership subject to seat policy; it does not automatically grant workspace access.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/enterprise/sso',
            label: 'Sim Docs: Single Sign-On',
            asOf: '2026-09-04',
          },
        ],
      },
      sessionPolicy: {
        value:
          'Yes: Enterprise maximum session lifetime, idle timeout, and organization-wide sign-out',
        shortValue: 'Session lifetime, idle timeout, and sign-out',
        detail: 'Lifetime accepts 1–8,760 hours; idle timeout accepts 48–8,760 hours.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/enterprise/session-policies',
            label: 'Sim Docs: Session policies',
            asOf: '2026-09-04',
          },
        ],
      },
      thirdPartyVetting: {
        value:
          'Built-in integrations ship through the Sim repository; external MCP tools and custom code have separate trust requirements',
        shortValue: 'Repository-shipped integrations; review external tools',
        detail:
          'Repository inclusion is not an independent security certification for every integration.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim',
            label: 'Sim GitHub repository',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.sim.ai/agents/mcp',
            label: 'Sim Docs: Using MCP tools',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Per-run and per-block logs with timing, inputs, outputs, cost information, and workflow snapshots',
        shortValue: 'Block-level logs, costs, and workflow snapshots',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/logs-debugging/logging',
            label: 'Sim Docs: Logging',
            asOf: '2026-09-04',
          },
        ],
      },
      durabilityModel: {
        value:
          'Resumable human-approval steps and configurable retries for supported tool requests',
        shortValue: 'Approval pause/resume and tool-request retries',
        detail:
          'Retry behavior depends on the tool and error; this does not guarantee exactly-once external side effects.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/blocks/human-in-the-loop',
            label: 'Sim Docs: Human in the Loop',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/tools/index.ts',
            label: 'Sim source: tool request retry handling',
            asOf: '2026-09-04',
          },
        ],
      },
      failureAlerting: {
        value:
          'Yes: workspace-event triggers can notify on workflow failures and cost, duration, or inactivity thresholds',
        shortValue: 'Failure and threshold events for notification workflows',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/triggers/sim',
            label: 'Sim Docs: Workspace Events',
            asOf: '2026-09-04',
          },
        ],
      },
      dataDrains: {
        value:
          'Yes: scheduled Enterprise export of execution logs, audit logs, and Chat data to external storage or HTTPS',
        shortValue: 'Scheduled exports to storage, warehouses, and webhooks',
        detail:
          'Destinations include S3, GCS, Azure Blob, BigQuery, Snowflake, Datadog, and HTTPS webhooks.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/enterprise/data-drains',
            label: 'Sim Docs: Data drains',
            asOf: '2026-09-04',
          },
        ],
      },
      asyncExecution: {
        value: 'Yes: asynchronous API execution returns a run ID and status URL for polling',
        shortValue: 'Async runs with a status URL',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/api-reference/getting-started',
            label: 'Sim Docs: API getting started',
            asOf: '2026-09-04',
          },
        ],
      },
      executionLimits: {
        value:
          'Free synchronous runs: 5 minutes; Pro/Max: 50 minutes. Async defaults to 90 minutes; Enterprise limits are configurable',
        shortValue: '5–50 min sync; 90 min default async',
        detail:
          'Published concurrency is 10 on Free, 50 on Pro, 200 on Max, and 1,000 by default on Enterprise, shared per billing account.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/costs',
            label: 'Sim Docs: Cost calculation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.sim.ai/pricing',
            label: 'Sim pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      partialFailureHandling: {
        value:
          'Yes: error paths can handle failed steps, and Parallel branches can fail independently',
        shortValue: 'Error paths and independent parallel branches',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/blocks/workflow',
            label: 'Sim Docs: Workflow block',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.sim.ai/workflows/blocks/parallel',
            label: 'Sim Docs: Parallel block',
            asOf: '2026-09-04',
          },
        ],
      },
      unattendedExecution: {
        value: 'Yes: deployed API, scheduled, and event-triggered workflows execute server-side',
        shortValue: 'Server-side runs without an open browser',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/deployment/api',
            label: 'Sim Docs: API deployment',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.sim.ai/workflows/triggers/sim',
            label: 'Sim Docs: Workspace Events',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value: 'Public documentation and GitHub community; dedicated support listed for Enterprise',
        shortValue: 'Docs, GitHub, and Enterprise dedicated support',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim',
            label: 'Sim GitHub repository',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.sim.ai/pricing',
            label: 'Sim pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      sla: {
        value: 'Unknown: no specific contractual uptime or response-time commitment was verified',
        shortValue: 'Contractual SLA terms not publicly verified',
        confidence: 'unknown',
        sources: [],
      },
      community: {
        value: 'Sim reports more than 100,000 builders/developers',
        shortValue: '100,000+ users reported by Sim',
        detail: 'A self-reported adoption figure, not independently audited active usage.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim',
            label: 'Sim GitHub repository',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.ycombinator.com/companies/sim',
            label: 'Y Combinator: Sim company profile',
            asOf: '2026-09-04',
          },
        ],
      },
      companyMaturity: {
        value: 'Founded in 2025; Y Combinator Spring 2025 company',
        shortValue: 'Founded 2025; YC Spring 2025',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.ycombinator.com/companies/sim',
            label: 'Y Combinator: Sim company profile',
            asOf: '2026-09-04',
          },
        ],
      },
      academy: {
        value:
          'Yes: Sim Academy provides structured workflow, Chat, table, and knowledge-base lessons',
        shortValue: 'Structured Sim Academy lessons',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/academy',
            label: 'Sim Docs: Academy',
            asOf: '2026-09-04',
          },
        ],
      },
    },
  },
}
