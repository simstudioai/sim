import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Reviewed against public documentation and source code on 2026-09-13. */
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
        asOf: '2026-09-13',
      },
    },
    {
      title: 'Built-in knowledge base with editable chunks',
      description:
        'Upload documents, configure chunking, search by meaning, and inspect, edit, merge, or split individual chunks. Connectors can keep external content synchronized.',
      shortDescription: 'Search your documents and inspect, edit, merge, or split their chunks.',
      source: {
        url: 'https://docs.sim.ai/knowledgebase',
        label: 'Sim Docs: Knowledge base',
        asOf: '2026-09-13',
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
        asOf: '2026-09-13',
      },
    },
    {
      title: 'Workspace forks for separate environments',
      description:
        'Fork workspaces and preview, force push/pull, or roll back deployed workflow changes. Drafts do not sync; target workflows are overwritten. Map environment-specific resources and credentials. Enterprise workspace admins on Sim Cloud; account enablement may be required.',
      shortDescription:
        'Fork and force-sync deployed workflows; Enterprise Cloud admins; account enablement may be required.',
      source: {
        url: 'https://docs.sim.ai/platform/enterprise/forks',
        label: 'Sim Docs: Workspace forks',
        asOf: '2026-09-13',
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
        asOf: '2026-09-13',
      },
    },
    {
      title: 'Self-hostable core',
      description:
        'Run the core with Docker or Kubernetes. Chat requires a Sim-managed service connection, and other providers need separate configuration.',
      shortDescription: 'Self-host the core with separately configured service dependencies.',
      source: {
        url: 'https://docs.sim.ai/platform/self-hosting',
        label: 'Sim Docs: Self-hosting',
        asOf: '2026-09-13',
      },
    },
    {
      title: 'Live workflow presence',
      description: 'The workflow editor broadcasts participant cursors and selections.',
      shortDescription: 'See participant cursors and selections on the workflow canvas.',
      source: {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/realtime/src/handlers/presence.ts',
        label: 'Sim source: live cursors and selections',
        asOf: '2026-09-13',
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
        asOf: '2026-09-13',
      },
    },
    {
      title: 'Enterprise capabilities have separate terms',
      description: 'The core is Apache-2.0 licensed; Enterprise features use a separate license.',
      shortDescription: 'Check the separate Enterprise license terms.',
      source: {
        url: 'https://docs.sim.ai/introduction',
        label: 'Sim Docs: Introduction',
        asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/chat',
            label: 'Sim Docs: Chat',
            asOf: '2026-09-13',
          },
        ],
      },
      learningCurve: {
        value:
          'No objective learning-curve rating verified; visual and conversational building are documented',
        shortValue: 'Learning-curve rating not independently verified',
        detail: 'Advanced integrations, code, and self-hosting still require technical setup.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.sim.ai/introduction',
            label: 'Sim Docs: Introduction',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/platform/self-hosting',
            label: 'Sim Docs: Self-hosting',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/workflows/blocks/function',
            label: 'Sim Docs: Function block',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/platform/self-hosting/kubernetes',
            label: 'Sim Docs: Kubernetes',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/introduction',
            label: 'Sim Docs: Introduction',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://www.sim.ai/pricing',
            label: 'Sim pricing',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/introduction',
            label: 'Sim Docs: Introduction',
            asOf: '2026-09-13',
          },
          {
            url: 'https://github.com/simstudioai/sim',
            label: 'Sim GitHub repository',
            asOf: '2026-09-13',
          },
        ],
      },
      environmentPromotion: {
        value: 'Yes: workspace forks with force push/pull of deployed workflows and rollback',
        shortValue: 'Workspace forks; Enterprise Cloud admins; account enablement may be required',
        detail:
          'Enterprise on Sim Cloud; workspace admins only, and account enablement may be required. Self-hosted deployments require the fork feature flags. Drafts do not sync; push/pull overwrites target workflows. Credentials and environment-specific resources require mapping, and copying behavior varies by resource.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/enterprise/forks',
            label: 'Sim Docs: Workspace forks',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/platform/permissions',
            label: 'Sim Docs: Roles and permissions',
            asOf: '2026-09-13',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/realtime/src/handlers/operations.ts',
            label: 'Sim source: collaborative workflow operations',
            asOf: '2026-09-13',
          },
        ],
      },
      nativeFileStorage: {
        value: 'Partial: shared workspace files with workflow access and deleted-item recovery',
        shortValue: 'Workspace files; sharing controls unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.sim.ai/files',
            label: 'Sim Docs: Files',
            asOf: '2026-09-13',
          },
          {
            url: 'https://www.sim.ai/files',
            label: 'Sim Files',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/platform/enterprise/data-retention',
            label: 'Sim Docs: Deleted-resource recovery and cleanup',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/platform/enterprise/whitelabeling',
            label: 'Sim Docs: Public file-share pages',
            asOf: '2026-09-13',
          },
        ],
        detail:
          'Files are shared across the workspace and can be read or produced by workflows. The retention guide documents recovery from Recently Deleted before permanent cleanup. Public file-share pages are documented, but the cited pages do not establish folder hierarchy or password/SSO options for shared links.',
      },
      dataTables: {
        value:
          'Yes: native typed tables with keyboard editing, spreadsheet paste, undo, and workflow access',
        shortValue: 'Typed tables with spreadsheet paste and undo',
        detail:
          'Published per-table limits are 50,000 rows on Free, 100,000 on Pro, and 500,000 on Max; Enterprise is custom.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/tables',
            label: 'Sim Docs: Tables',
            asOf: '2026-09-13',
          },
          {
            url: 'https://www.sim.ai/pricing',
            label: 'Sim pricing',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'OpenAI, Anthropic, Google, Azure, AWS Bedrock, OpenRouter, and other hosted or local model providers',
        shortValue: 'Agent block: multiple hosted and local model providers',
        detail: 'This provider selection applies to the workflow Agent block.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/blocks/agent',
            label: 'Sim Docs: Agent block',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/knowledgebase/connectors',
            label: 'Sim Docs: Connectors',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/workflows/deployment/mcp',
            label: 'Sim Docs: MCP deployment',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/workflows/blocks/guardrails',
            label: 'Sim Docs: Guardrails',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
        ],
      },
      generativeMedia: {
        value:
          'Image/video generation and text-to-speech integrations; speech-to-text voice input in Chat',
        shortValue: 'Image/video/TTS; Chat voice transcription',
        detail: 'Available operations depend on the selected provider and credentials.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/costs',
            label: 'Sim Docs: Cost calculation',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/integrations/elevenlabs',
            label: 'Sim Docs: ElevenLabs',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/chat',
            label: 'Sim Docs: Chat',
            asOf: '2026-09-13',
          },
        ],
      },
      modelFallback: {
        value:
          'Unknown: automatic failover to another model or provider was not verified for the Agent block',
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
            asOf: '2026-09-13',
          },
        ],
      },
      nativeChatDeployment: {
        value: 'Yes: hosted chat interfaces with streaming, file uploads, and configurable access',
        shortValue: 'Hosted chat; public/password/email; SSO requires Enterprise',
        detail: 'SSO-protected chats require Enterprise eligibility.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/deployment/chat',
            label: 'Sim Docs: Chat deployment',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/knowledgebase',
            label: 'Sim Docs: Knowledge base',
            asOf: '2026-09-13',
          },
        ],
      },
      parallelExecution: {
        value: 'Yes: Parallel containers execute branches concurrently in configurable batches',
        shortValue: 'Parallel branches in batches of up to 20',
        detail: 'Batches support up to 20 branches; larger collections run in successive batches.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/blocks/parallel',
            label: 'Sim Docs: Parallel block',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value: '262 apps and services listed in the public integration catalog',
        shortValue: '262 listed apps and services',
        detail: 'This count follows the public apps-and-services directory.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.sim.ai/integrations',
            label: 'Sim integration catalog',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/workflows/triggers/table',
            label: 'Sim Docs: Table trigger',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/workflows/triggers/sim',
            label: 'Sim Docs: Workspace Events',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/workflows',
            label: 'Sim Docs: Workflows',
            asOf: '2026-09-13',
          },
        ],
      },
      customCodeSteps: {
        value:
          'Yes: a Function block runs JavaScript, Python, or Shell with runtime-dependent availability',
        shortValue: 'JavaScript, Python, and Shell; runtime-dependent availability',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/blocks/function',
            label: 'Sim Docs: Function block',
            asOf: '2026-09-13',
          },
        ],
      },
      codeSandboxRuntime: {
        value:
          'Yes: named Function sandboxes with language packages, system packages, and managed CLI tools',
        shortValue: 'Named sandboxes and packages (Max/Enterprise on Cloud)',
        detail:
          'Requires Max or Enterprise on Sim Cloud. Self-hosted deployments require the feature and remote execution provider configuration.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/blocks/function',
            label: 'Sim Docs: Function block',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/api-reference/getting-started',
            label: 'Sim Docs: API getting started',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/api-reference/typescript',
            label: 'Sim Docs: TypeScript SDK',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/agents/mcp',
            label: 'Sim Docs: Using MCP tools',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/agents/custom-tools',
            label: 'Sim Docs: Custom Tools',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/workflows/blocks/function',
            label: 'Sim Docs: Function block',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Per-seat Pro/Max plans with included credits and optional overages; custom Enterprise pricing',
        shortValue: 'Pro/Max per-seat plus usage; Enterprise custom',
        detail:
          'Workflow costs include a base run charge and applicable model or hosted-tool usage. Enterprise has a fixed monthly price without overages and custom usage limits.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.sim.ai/pricing',
            label: 'Sim pricing',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/platform/costs',
            label: 'Sim Docs: Cost calculation',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/platform/costs',
            label: 'Sim Docs: Cost calculation',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/platform/enterprise/access-control',
            label: 'Sim Docs: Access control',
            asOf: '2026-09-13',
          },
        ],
      },
      auditLogging: {
        value:
          'Yes: organization audit-log UI and API, with scheduled Data Drains export; Enterprise on Sim Cloud',
        shortValue: 'Audit logs, API, export (Enterprise on Cloud)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/enterprise/audit-logs',
            label: 'Sim Docs: Audit logs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/platform/enterprise/data-drains',
            label: 'Sim Docs: Data drains',
            asOf: '2026-09-13',
          },
        ],
      },
      compliance: {
        value: "Sim's public Trust Center lists SOC 2 Type II, ISO 27001:2022, and GDPR",
        shortValue: 'SOC 2 Type II, ISO 27001:2022, GDPR listed by Sim',
        detail:
          'These are vendor-published listings. The public overview does not establish the audit period or service scope; no HIPAA agreement was verified. Self-hosting is a deployment option, not an attestation.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://trust.sim.ai/',
            label: 'Sim Trust Center',
            asOf: '2026-09-13',
          },
        ],
      },
      modelAndToolGovernance: {
        value:
          'Yes: permission groups restrict providers, individual models, blocks, tools, and platform features',
        shortValue: 'Provider/model/tool restrictions (Enterprise on Cloud)',
        detail:
          'Enterprise controls apply to the relevant organization and workspace; provider data-retention terms remain separate.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/enterprise/access-control',
            label: 'Sim Docs: Access control',
            asOf: '2026-09-13',
          },
        ],
      },
      credentialGovernance: {
        value:
          'Yes: shared credentials have use and administration roles through explicit grants and inherited administrator access',
        shortValue: 'Credential grants and inherited administrator access',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/permissions',
            label: 'Sim Docs: Roles and permissions',
            asOf: '2026-09-13',
          },
        ],
      },
      whiteLabeling: {
        value:
          'Yes: Enterprise organization branding; separate instance-level branding for self-hosting',
        shortValue: 'Enterprise organization branding; self-hosted instance branding',
        detail:
          'Organization branding applies to signed-in members; public surfaces use separate instance settings and have documented limitations.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/enterprise/whitelabeling',
            label: 'Sim Docs: White-labeling',
            asOf: '2026-09-13',
          },
        ],
      },
      dataRetention: {
        value:
          'Yes: Enterprise retention policies for logs, deleted resources, and Chat data, with workspace overrides',
        shortValue: 'Enterprise retention policies with workspace overrides',
        detail:
          'Options range from one day to five years or Forever. Deletion runs on scheduled cleanup jobs.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/enterprise/data-retention',
            label: 'Sim Docs: Data retention',
            asOf: '2026-09-13',
          },
        ],
      },
      piiRedaction: {
        value:
          'Yes: Guardrails PII detection/masking and configurable Enterprise redaction policies',
        shortValue: 'PII checks; Enterprise redaction policies',
        detail:
          'Policies can apply to logs, workflow input, or block outputs. In-flight redaction can change workflow results.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/blocks/guardrails',
            label: 'Sim Docs: Guardrails',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/platform/enterprise/data-retention',
            label: 'Sim Docs: Data retention',
            asOf: '2026-09-13',
          },
        ],
      },
      sso: {
        value:
          'Yes: Enterprise SAML 2.0/OIDC SSO and SCIM 2.0 provisioning for Okta, Microsoft Entra ID, OneLogin, and JumpCloud, with group mappings for permission groups, workspace access, and organization admins',
        shortValue: 'Enterprise SAML/OIDC SSO and SCIM provisioning',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/enterprise/sso',
            label: 'Sim Docs: Single Sign-On',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/platform/enterprise/scim',
            label: 'Sim Docs: Directory provisioning (SCIM)',
            asOf: '2026-09-13',
          },
        ],
        detail:
          "Email domains route users after they choose SSO sign-in; password sign-in remains available. Provisioning creates, updates, and suspends members; removal requires a provider's SCIM DELETE request. Okta deactivates instead of deleting.",
      },
      sessionPolicy: {
        value:
          'Yes: Enterprise maximum session lifetime, idle timeout, and organization-wide sign-out',
        shortValue: 'Enterprise session lifetime, idle timeout, and sign-out',
        detail:
          'Lifetime accepts 1–8,760 hours; idle timeout accepts 48–8,760 hours. Organization sign-out excludes the acting administrator and applies to browser sessions.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/enterprise/session-policies',
            label: 'Sim Docs: Session policies',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/agents/mcp',
            label: 'Sim Docs: Using MCP tools',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/tools/index.ts',
            label: 'Sim source: tool request retry handling',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/workflows/blocks/api',
            label: 'Sim Docs: API block',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
        ],
      },
      dataDrains: {
        value:
          'Yes: scheduled Enterprise export of execution logs, audit logs, and Chat data to external storage or HTTPS',
        shortValue: 'Enterprise scheduled exports to storage, warehouses, and webhooks',
        detail:
          'Destinations include S3, GCS, Azure Blob, BigQuery, Snowflake, Datadog, and HTTPS webhooks.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/enterprise/data-drains',
            label: 'Sim Docs: Data drains',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
        ],
      },
      executionLimits: {
        value:
          'Free synchronous runs: 5 minutes; Pro/Max: 50 minutes. Async defaults to 90 minutes; Enterprise limits are configurable',
        shortValue: '5–50 min sync; 90 min async; Enterprise custom',
        detail:
          'Published concurrency is 10 on Free, 50 on Pro, 200 on Max, and 1,000 by default on Enterprise, shared per billing account.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/costs',
            label: 'Sim Docs: Cost calculation',
            asOf: '2026-09-13',
          },
          {
            url: 'https://www.sim.ai/pricing',
            label: 'Sim pricing',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/workflows/blocks/parallel',
            label: 'Sim Docs: Parallel block',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/workflows/triggers/sim',
            label: 'Sim Docs: Workspace Events',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.sim.ai/platform/costs',
            label: 'Sim Docs: Cost calculation',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://www.sim.ai/pricing',
            label: 'Sim pricing',
            asOf: '2026-09-13',
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
        shortValue: '100,000+ builders/developers reported by Sim',
        detail: 'A self-reported adoption figure, not independently audited active usage.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim',
            label: 'Sim GitHub repository',
            asOf: '2026-09-13',
          },
          {
            url: 'https://www.ycombinator.com/companies/sim',
            label: 'Y Combinator: Sim company profile',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
        ],
      },
    },
  },
  oneLinerSources: [
    {
      url: 'https://docs.sim.ai/introduction',
      label: 'Sim Docs: Introduction',
      asOf: '2026-09-13',
    },
    {
      url: 'https://docs.sim.ai/chat',
      label: 'Sim Docs: Chat',
      asOf: '2026-09-13',
    },
    {
      url: 'https://docs.sim.ai/workflows/blocks/function',
      label: 'Sim Docs: Function block',
      asOf: '2026-09-13',
    },
  ],
}
