import { DustIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Reviewed against current primary sources on 2026-09-04. */
export const dustProfile: CompetitorProfile = {
  id: 'dust',
  name: 'Dust',
  website: 'https://dust.tt',
  brand: {
    icon: DustIcon,
    selfFramed: true,
    colors: ['#FFAA0D', '#111418', '#1C91FF'],
    source: 'dust-tt/dust Sparkle design system (GitHub)',
    asOf: '2026-07-02',
  },
  oneLiner:
    'Dust is a hosted AI agent workspace combining instructions, reusable skills, company-data search, MCP tools, and shared Pods for people and agents.',
  standoutFeatures: [
    {
      title: 'Reusable skills with dynamic discovery',
      description:
        'Skills package instructions, knowledge, and tools. Updates propagate to agents using them, and discoverable skills can be enabled during a conversation.',
      shortDescription: 'Shared skills that agents load when needed.',
      source: {
        url: 'https://docs.dust.tt/docs/user-documentation/agents/skills/skills-overview.md',
        label: 'Dust: Skills overview',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Pods keep collaborative work together',
      description:
        'Pods combine conversations, tasks, and files as shared context for human and agent participants.',
      shortDescription: 'Shared conversations, tasks, files, and agent context.',
      source: {
        url: 'https://docs.dust.tt/docs/user-documentation/pods/overview.md',
        label: 'Dust: Pods overview',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Discover Tools loads capabilities on demand',
      description:
        'Agents can find and enable permitted toolsets during a conversation without loading every tool into their initial configuration.',
      shortDescription: 'On-demand discovery of permitted tools.',
      source: {
        url: 'https://docs.dust.tt/docs/user-documentation/agents/discover-tools.md',
        label: 'Dust: Discover Tools',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Interactive Frames',
      description:
        'Agents generate interactive React-based documents that can be shared, exported, stored in Pods, and pinned as Pod banners.',
      shortDescription: 'Interactive dashboards and reports in shared Pods.',
      source: {
        url: 'https://docs.dust.tt/docs/user-documentation/pods/frames.md',
        label: 'Dust: Pod Frames',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'GitOps for agent configuration',
      description:
        'The official GitHub Action synchronizes skill and agent configuration files into workspaces, allowing teams to apply Git review and history.',
      shortDescription: 'Repository-managed agent and skill configurations.',
      source: {
        url: 'https://github.com/dust-tt/dust-github-action',
        label: 'Dust: GitHub Action for skills and agents',
        asOf: '2026-09-04',
      },
    },
  ],
  limitations: [
    {
      title: 'Hosted deployment is the documented commercial path',
      description:
        'Current plans offer hosted US/EU residency and Enterprise single tenancy. A supported customer-operated production installation was not confirmed.',
      shortDescription: 'Supported self-managed deployment remains unconfirmed.',
      source: {
        url: 'https://dust.tt/home/pricing',
        label: 'Dust: Pricing',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Tables focus on agent queries',
      description:
        'Dust documents uploaded and connected tables queried with SQL. A native editable spreadsheet grid was not confirmed.',
      shortDescription: 'SQL table access; editable database grid unconfirmed.',
      source: {
        url: 'https://docs.dust.tt/docs/user-documentation/agents/knowledge/table-queries.md',
        label: 'Dust: Table queries',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Shared Pod content is visible to its members',
      description:
        'Pod conversations, files, linked data, and tasks form shared context. Sensitive work needs a Pod with appropriate membership.',
      shortDescription: 'Pod membership determines access to shared context.',
      source: {
        url: 'https://docs.dust.tt/docs/user-documentation/pods/overview.md',
        label: 'Dust: Pods overview',
        asOf: '2026-09-04',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value: 'Instruction-based agent configuration with conversational Sidekick assistance',
        shortValue: 'Instruction-based builder with Sidekick',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/create-your-first-agent.md',
            label: 'Dust: Create your first agent',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/agent-builder-sidekick.md',
            label: 'Dust: @sidekick agent',
            asOf: '2026-09-04',
          },
        ],
      },
      learningCurve: {
        value:
          'Accessible for basic templated agents; custom tools and governance require more setup',
        shortValue: 'Easy basics; deeper setup for custom tools',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/templates.md',
            label: 'Dust: Templates',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/admins/tools-management/adding-an-mcp-server.md',
            label: 'Dust: Adding an MCP Server',
            asOf: '2026-09-04',
          },
        ],
      },
      selfHostOption: {
        value:
          'MIT source is public; a supported self-managed production installation was not confirmed',
        shortValue: 'MIT source; supported self-hosting unconfirmed',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/dust-tt/dust/blob/main/LICENSE',
            label: 'Dust: MIT License (GitHub)',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/developer-platform/overview/developer-platform.md',
            label: 'Dust: Developer platform',
            asOf: '2026-09-04',
          },
        ],
      },
      deploymentOptions: {
        value: 'Hosted service with US/EU residency; Enterprise offers single-tenant deployment',
        shortValue: 'US/EU cloud; Enterprise single tenancy',
        confidence: 'verified',
        sources: [
          {
            url: 'https://dust.tt/home/pricing',
            label: 'Dust: Pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      templates: {
        value: 'Yes: templates launch a guided Sidekick agent-creation flow',
        shortValue: 'Sidekick-guided agent templates',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/templates.md',
            label: 'Dust: Templates',
            asOf: '2026-09-04',
          },
        ],
      },
      license: {
        value: 'Core repository is MIT-licensed; the hosted product is commercially offered',
        shortValue: 'MIT repository; commercial hosted service',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/dust-tt/dust/blob/main/LICENSE',
            label: 'Dust: MIT License (GitHub)',
            asOf: '2026-09-04',
          },
        ],
      },
      environmentPromotion: {
        value: 'Official GitHub Action syncs skills and agent configurations across workspaces',
        shortValue: 'GitOps configuration sync across workspaces',
        detail:
          'Separate workflows can target development, staging, and production workspaces; teams define their own review and promotion process.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/dust-tt/dust-github-action',
            label: 'Dust: GitHub Action for skills and agents',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/changelog.md',
            label: 'Dust: Changelog',
            asOf: '2026-09-04',
          },
        ],
      },
      versionControlDepth: {
        value: 'Prompt history, skill version diffs, and Git-managed configuration history',
        shortValue: 'Prompt history, skill diffs, GitOps',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/skills/skills-overview.md',
            label: 'Dust: Skills overview',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/dust-tt/dust-github-action',
            label: 'Dust: GitHub Action for skills and agents',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/changelog.md',
            label: 'Dust: Changelog',
            asOf: '2026-09-04',
          },
        ],
      },
      realtimeCollaboration: {
        value: 'Not confirmed in current public documentation',
        shortValue: 'Not publicly confirmed',
        detail:
          'Pods support shared work and Sidekick exposes editors’ suggestions. Cursor-synchronized concurrent editing of agent configurations was not confirmed.',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/pods/overview.md',
            label: 'Dust: Pods overview',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/agent-builder-sidekick.md',
            label: 'Dust: @sidekick agent',
            asOf: '2026-09-04',
          },
        ],
      },
      nativeFileStorage: {
        value: 'Yes: Pods provide shared files and nested folders, writable by users and agents',
        shortValue: 'Pod files and nested folders',
        detail:
          'Files can be previewed, renamed, moved, and deleted. A recycle bin or general public file-link access model was not confirmed.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/pods/files.md',
            label: 'Dust: Pod files',
            asOf: '2026-09-04',
          },
        ],
      },
      dataTables: {
        value:
          'Uploaded/API-created tables support SQL queries; an editable spreadsheet grid was not confirmed',
        shortValue: 'Stored tables and SQL query tools',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/knowledge/table-queries.md',
            label: 'Dust: Table queries',
            asOf: '2026-09-04',
          },
        ],
      },
      richTextEditor: {
        value:
          'Agents create documents and interactive Frames; a native WYSIWYG document editor was not confirmed',
        shortValue: 'Document generation and interactive Frames',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/tools/computer.md',
            label: 'Dust: Computer',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/pods/frames.md',
            label: 'Dust: Pod Frames',
            asOf: '2026-09-04',
          },
        ],
      },
      subWorkflows: {
        value:
          'Yes: Run agent delegates to another saved agent and returns its result or hands off',
        shortValue: 'Saved subagents with return or handoff',
        detail: 'Nested calls are limited to depth four.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/tools/run-agent.md',
            label: 'Dust: Run agent',
            asOf: '2026-09-04',
          },
        ],
      },
      customBlocks: {
        value:
          'Reusable skills and saved subagents; encapsulated visual workflow blocks were not confirmed',
        shortValue: 'Shared skills and reusable subagents',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/skills/skills-overview.md',
            label: 'Dust: Skills overview',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/tools/run-agent.md',
            label: 'Dust: Run agent',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value: 'Yes: multiple providers, individual model choices, and maintained Auto model tiers',
        shortValue: 'Multiple providers and Auto model tiers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/model-selection.md',
            label: 'Dust: Auto models and the model picker',
            asOf: '2026-09-04',
          },
        ],
      },
      agentReasoningBlocks: {
        value: 'Yes: agents choose and execute tools according to instructions and context',
        shortValue: 'Autonomous agents with tool selection',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/create-your-first-agent.md',
            label: 'Dust: Create your first agent',
            asOf: '2026-09-04',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          'Yes: Sidekick proposes instructions, tools, skills, and models with reviewable changes',
        shortValue: 'Sidekick drafts reviewable agent configurations',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/agent-builder-sidekick.md',
            label: 'Dust: @sidekick agent',
            asOf: '2026-09-04',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          'Yes: semantic search over synced sources, uploaded files, websites, and Pod content',
        shortValue: 'Semantic retrieval across sources and Pod files',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/knowledge/search-data-sources.md',
            label: 'Dust: Search data sources',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/pods/files.md',
            label: 'Dust: Pod files',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpSupport: {
        value: 'Yes: remote MCP servers and preview client-side tools',
        shortValue: 'Remote and client-side MCP',
        detail:
          'Client-side tools require a custom API client and are not directly available in Dust’s web app or official extensions. Returned results still enter the Dust conversation.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/admins/tools-management/adding-an-mcp-server.md',
            label: 'Dust: Adding an MCP Server',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/developers/client-side-mcp-server.md',
            label: 'Dust: Client Side MCP Server (Preview)',
            asOf: '2026-09-04',
          },
        ],
      },
      evaluationGuardrails: {
        value: 'Agent preview, tool approvals, and production Insights are documented',
        shortValue: 'Preview, approvals, and production Insights',
        detail: 'A native batch dataset regression suite was not confirmed.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/create-your-first-agent.md',
            label: 'Dust: Create your first agent',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/changelog.md',
            label: 'Dust: Changelog',
            asOf: '2026-09-04',
          },
        ],
      },
      humanInTheLoop: {
        value: 'Yes: tool approval policies can require confirmation before execution',
        shortValue: 'Configurable tool approvals',
        detail:
          'Admins can configure approval levels; agents pause for decisions on tools that require them.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/changelog.md',
            label: 'Dust: Changelog',
            asOf: '2026-09-04',
          },
        ],
      },
      generativeMedia: {
        value: 'Yes: reference-based image generation and native speech generation',
        shortValue: 'Image and speech generation',
        detail: 'The image tool supports parallel generations. Video generation was not confirmed.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/tools/image-generation.md',
            label: 'Dust: Image Generation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/tools/voice-and-sound-generation.md',
            label: 'Dust: Voice and sound generation',
            asOf: '2026-09-04',
          },
        ],
      },
      dynamicToolUse: {
        value: 'Yes: Discover Tools finds and enables permitted toolsets during a conversation',
        shortValue: 'On-demand tool discovery and activation',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/discover-tools.md',
            label: 'Dust: Discover Tools',
            asOf: '2026-09-04',
          },
        ],
      },
      modelFallback: {
        value:
          'Auto modes choose the next available candidate; failed-call retry semantics were not confirmed',
        shortValue: 'Auto model availability fallback; retries unconfirmed',
        detail:
          'Candidate availability considers region, plan, provider access, and admin settings.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/model-selection.md',
            label: 'Dust: Auto models and the model picker',
            asOf: '2026-09-04',
          },
        ],
      },
      agentSkills: {
        value: 'Yes: reusable instruction, knowledge, and tool packages with dynamic discovery',
        shortValue: 'Shared skills with on-demand discovery',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/skills/skills-overview.md',
            label: 'Dust: Skills overview',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/discover-skills.md',
            label: 'Dust: Discover Skills',
            asOf: '2026-09-04',
          },
        ],
      },
      nativeChatDeployment: {
        value: 'Yes: workspace chat, Slack, and Microsoft Teams',
        shortValue: 'Workspace chat, Slack, and Teams',
        detail:
          'This confirms authenticated collaboration surfaces, not arbitrary anonymous public chatbot embedding.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/create-your-first-agent.md',
            label: 'Dust: Create your first agent',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/integrations/dust-in-teams.md',
            label: 'Dust in Teams',
            asOf: '2026-09-04',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          'Source citations and retrieval inspection exist; a raw chunk-index inspector was not confirmed',
        shortValue: 'Citations; raw chunk inspector unconfirmed',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/knowledge/search-data-sources.md',
            label: 'Dust: Search data sources',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/changelog.md',
            label: 'Dust: Changelog',
            asOf: '2026-09-04',
          },
        ],
      },
      parallelExecution: {
        value: 'Parallel image tool calls and background subagent delegation are documented',
        shortValue: 'Parallel tools and background subagents',
        detail: 'A general visual branch-and-join orchestration canvas was not confirmed.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/tools/image-generation.md',
            label: 'Dust: Image Generation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/tools/run-agent.md',
            label: 'Dust: Run agent',
            asOf: '2026-09-04',
          },
        ],
      },
      a2aProtocol: {
        value: 'Not confirmed in current public documentation',
        shortValue: 'Not publicly confirmed',
        detail:
          'Reviewed interoperability documentation covers MCP; native Agent2Agent protocol support was not confirmed.',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/integrations/dust-mcp-server.md',
            label: 'Dust MCP Server',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/admins/tools-management/adding-an-mcp-server.md',
            label: 'Dust: Adding an MCP Server',
            asOf: '2026-09-04',
          },
        ],
      },
      loopIteration: {
        value: 'Agents can repeat tasks through code, subagents, and recurring wake-ups',
        shortValue: 'Code, subagents, and recurring wake-ups',
        detail: 'A separate deterministic for-each or while workflow container was not confirmed.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/tools/computer.md',
            label: 'Dust: Computer',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/tools/run-agent.md',
            label: 'Dust: Run agent',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/tools/wake-ups.md',
            label: 'Dust: Wake-ups',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value: 'Vendor advertises 70+ ready-made MCP connectors and 20+ data-source connectors',
        shortValue: '70+ MCP; 20+ data-source connectors',
        detail: 'These are distinct categories, not a combined count of unique integrations.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://dust.tt/home/product',
            label: 'Dust: Product',
            asOf: '2026-09-04',
          },
          {
            url: 'https://dust.tt/home/pricing',
            label: 'Dust: Pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      triggerTypes: {
        value: 'Schedules, webhook events, chat/API calls, and agent-created wake-ups',
        shortValue: 'Schedules, webhooks, chat, API, wake-ups',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/triggers/schedules.md',
            label: 'Dust: Schedules',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/triggers/webhooks/rate-limiting.md',
            label: 'Dust: Rate Limiting',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/developer-platform/overview/developer-platform.md',
            label: 'Dust: Developer platform',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/tools/wake-ups.md',
            label: 'Dust: Wake-ups',
            asOf: '2026-09-04',
          },
        ],
      },
      customCodeSteps: {
        value:
          'Yes: Computer executes code; Val Town adds serverless JavaScript/TypeScript functions',
        shortValue: 'Computer code execution and Val Town functions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/tools/computer.md',
            label: 'Dust: Computer',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/tools/val-town.md',
            label: 'Dust: Val Town',
            asOf: '2026-09-04',
          },
        ],
      },
      codeSandboxRuntime: {
        value:
          'Computer provides a managed sandbox with network allowlists and environment settings',
        shortValue: 'Managed sandbox; dependency customization unconfirmed',
        detail:
          'User-declared package manifests, custom images, and OS-package installation were not confirmed.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/tools/computer.md',
            label: 'Dust: Computer',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/admins/tools-management/computer-admin-setup.md',
            label: 'Dust: Computer admin setup',
            asOf: '2026-09-04',
          },
        ],
      },
      apiPublishing: {
        value: 'Yes: the Conversation API exposes agents to external applications',
        shortValue: 'Agent access through Conversation API',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/developer-platform/overview/developer-platform.md',
            label: 'Dust: Developer platform',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/developers/client-side-mcp-server.md',
            label: 'Dust: Client Side MCP Server (Preview)',
            asOf: '2026-09-04',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Official JavaScript SDK, API, CLI documentation, and GitHub configuration-sync action',
        shortValue: 'JavaScript SDK, API, CLI, GitHub Action',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/developer-platform/overview/javascript-sdk.md',
            label: 'Dust: JavaScript SDK',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/developer-platform/overview/developer-platform.md',
            label: 'Dust: Developer platform',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/dust-tt/dust-github-action',
            label: 'Dust: GitHub Action for skills and agents',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpPublishing: {
        value: 'Yes: Dust MCP Server exposes agents and permitted workspace capabilities',
        shortValue: 'Dust agents callable over MCP',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/integrations/dust-mcp-server.md',
            label: 'Dust MCP Server',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Seat subscriptions include credits; programmatic use and overage have separate terms',
        shortValue: 'Per-seat credits with separate programmatic usage',
        confidence: 'verified',
        sources: [
          {
            url: 'https://dust.tt/home/pricing',
            label: 'Dust: Pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      entryPaidPlan: {
        value: 'Pro is $30/seat/month, or $24 billed yearly, with 8,000 monthly credits',
        shortValue: 'Pro $30 monthly; $24 with annual billing',
        confidence: 'verified',
        sources: [
          {
            url: 'https://dust.tt/home/pricing',
            label: 'Dust: Pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      freeTier: {
        value: 'Yes: Free seats include 500 lifetime credits',
        shortValue: '500 lifetime credits per Free seat',
        confidence: 'verified',
        sources: [
          {
            url: 'https://dust.tt/home/pricing',
            label: 'Dust: Pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      byok: {
        value: 'Not confirmed in current public documentation',
        shortValue: 'Not publicly confirmed',
        detail:
          'The current plan and model documentation describe Dust credits; customer-supplied model API keys were not confirmed.',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://dust.tt/home/pricing',
            label: 'Dust: Pricing',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/model-selection.md',
            label: 'Dust: Auto models and the model picker',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    security: {
      dataResidency: {
        value:
          'US/EU residency appears on Business and Enterprise; provider processing needs separate review',
        shortValue: 'US/EU residency on Business and Enterprise',
        detail:
          'Residency of stored workspace data does not by itself establish that every model or external tool processes only in that region.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://dust.tt/home/pricing',
            label: 'Dust: Pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      rbac: {
        value: 'Yes: Admin, Manager, and Member roles with group-based granular permissions',
        shortValue: 'Three roles plus group-granted permissions',
        detail:
          'Some older pages still use the former Builder terminology. Current governance documentation defines Admin, Manager, and Member.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/admins/admin-governance/workspace-governance-roles-groups-and-permissions.md',
            label: 'Dust: Workspace Governance: Roles, Groups & Permissions',
            asOf: '2026-09-04',
          },
        ],
      },
      auditLogging: {
        value: 'Yes: Enterprise audit events, CSV export, and continuous SIEM streaming',
        shortValue: 'Enterprise audit logs and SIEM streaming',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/admins/audit-logs/audit-logs.md',
            label: 'Dust: Audit Logs',
            asOf: '2026-09-04',
          },
        ],
      },
      compliance: {
        value: 'Vendor lists SOC 2 Type II; its changelog also claims HIPAA compliance',
        shortValue: 'SOC 2 II listed; HIPAA claim needs scope review',
        detail:
          'The restricted trust materials and current HIPAA contractual scope were not inspectable. No current GDPR, ISO 27001, PCI DSS, or FedRAMP certification is asserted.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://dust.tt/home/pricing',
            label: 'Dust: Pricing',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/changelog.md',
            label: 'Dust: Changelog',
            asOf: '2026-09-04',
          },
        ],
      },
      modelAndToolGovernance: {
        value:
          'Yes: model-tier ceilings at workspace, group, or member level; tool access follows space permissions',
        shortValue: 'Model-tier limits and scoped tool access',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/admins/usage-seats-and-credits/model-access-tiers.md',
            label: 'Dust: Model access tiers',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/admins/admin-governance/access-controls-and-permissions.md',
            label: 'Dust: Access Controls and Permissions',
            asOf: '2026-09-04',
          },
        ],
      },
      credentialGovernance: {
        value: 'Admins select shared or personal tool credentials and scope access through Spaces',
        shortValue: 'Personal/shared credentials with Space access',
        detail:
          'Restricted spaces can isolate separate bearer-token server configurations. A distinct role-level stored-credential allowlist was not confirmed.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/admins/tools-management/personal-vs-shared-credentials.md',
            label: 'Dust: Personal vs Shared Credentials for Tools & MCP Servers',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/admins/tools-management/adding-an-mcp-server.md',
            label: 'Dust: Adding an MCP Server',
            asOf: '2026-09-04',
          },
        ],
      },
      whiteLabeling: {
        value: 'Yes: eligible plans can replace branding on publicly shared Frames',
        shortValue: 'White-labeled public Frames',
        detail: 'This is Frame branding, not confirmed rebranding of the entire Dust workspace.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/frames/white-labeled-frames.md',
            label: 'Dust: White-labeled Frames',
            asOf: '2026-09-04',
          },
        ],
      },
      dataRetention: {
        value: 'Enterprise lists custom data retention',
        shortValue: 'Enterprise custom retention',
        detail: 'Public plan information does not specify the configurable retention windows.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://dust.tt/home/pricing',
            label: 'Dust: Pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      piiRedaction: {
        value: 'Not confirmed in current public documentation',
        shortValue: 'Not publicly confirmed',
        detail:
          'The reviewed governance and Computer documentation do not confirm general PII redaction across prompts, responses, and stored logs.',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/admins/admin-governance/workspace-governance-roles-groups-and-permissions.md',
            label: 'Dust: Workspace Governance: Roles, Groups & Permissions',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/admins/tools-management/computer-admin-setup.md',
            label: 'Dust: Computer admin setup',
            asOf: '2026-09-04',
          },
        ],
      },
      sso: {
        value:
          'Yes: SAML SSO; Business lists availability on request at 5+ seats, with SCIM on Enterprise',
        shortValue: 'SAML SSO; Enterprise SCIM',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/admins/admin-governance/single-sign-on-sso/single-sign-on-sso.md',
            label: 'Dust: Single Sign-On (SSO)',
            asOf: '2026-09-04',
          },
          {
            url: 'https://dust.tt/home/pricing',
            label: 'Dust: Pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      sessionPolicy: {
        value: 'Not confirmed in current public documentation',
        shortValue: 'Not publicly confirmed',
        detail:
          'SSO enforcement is documented, but a configurable session lifetime or idle timeout was not confirmed.',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/admins/admin-governance/single-sign-on-sso/single-sign-on-sso.md',
            label: 'Dust: Single Sign-On (SSO)',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/admins/admin-governance/single-sign-on-sso/saml-sso.md',
            label: 'Dust: SAML SSO',
            asOf: '2026-09-04',
          },
        ],
      },
      thirdPartyVetting: {
        value: 'Dust-built MCP tools and externally hosted custom MCP servers are supported',
        shortValue: 'First-party tools and external MCP servers',
        detail: 'A universal Dust security review of each customer-added server was not confirmed.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/admins/tools-management/adding-an-mcp-server.md',
            label: 'Dust: Adding an MCP Server',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Agent Insights tracks version-linked tool, latency, feedback, and retrieval metrics; Analytics reports credit usage',
        shortValue: 'Agent Insights and workspace credit analytics',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/changelog.md',
            label: 'Dust: Changelog',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/analytics.md',
            label: 'Dust: Analytics',
            asOf: '2026-09-04',
          },
        ],
      },
      durabilityModel: {
        value:
          'Rate-limited webhook events are dropped; general durable run replay was not confirmed',
        shortValue: 'Webhook drops; durable replay unconfirmed',
        detail:
          'Requests rejected at a trigger limit are not queued or replayed when capacity returns.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/triggers/webhooks/rate-limiting.md',
            label: 'Dust: Rate Limiting',
            asOf: '2026-09-04',
          },
        ],
      },
      failureAlerting: {
        value:
          'Credit thresholds support email notifications; general run-failure push alerts were not confirmed',
        shortValue: 'Credit alerts; run-failure alerts unconfirmed',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/admins/usage-seats-and-credits/credit-management.md',
            label: 'Dust: Credit management',
            asOf: '2026-09-04',
          },
        ],
      },
      dataDrains: {
        value: 'Yes: Enterprise audit streaming; usage analytics also supports CSV/API export',
        shortValue: 'Audit streaming and analytics export',
        detail: 'Audit streaming is distinct from continuous full execution-trace export.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/admins/audit-logs/audit-logs.md',
            label: 'Dust: Audit Logs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/analytics.md',
            label: 'Dust: Analytics',
            asOf: '2026-09-04',
          },
        ],
      },
      asyncExecution: {
        value: 'Yes: background subagents, scheduled runs, and recurring wake-ups',
        shortValue: 'Background agents and scheduled execution',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/tools/run-agent.md',
            label: 'Dust: Run agent',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/triggers/schedules.md',
            label: 'Dust: Schedules',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/tools/wake-ups.md',
            label: 'Dust: Wake-ups',
            asOf: '2026-09-04',
          },
        ],
      },
      executionLimits: {
        value:
          'Documented limits include four nested subagent levels and 32 firings per recurring wake-up',
        shortValue: 'Depth-four subagents; 32 wake-up firings',
        detail:
          'Overall agent-run duration and concurrency ceilings were not confirmed. A later wake-up can schedule another series.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/tools/run-agent.md',
            label: 'Dust: Run agent',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/tools/wake-ups.md',
            label: 'Dust: Wake-ups',
            asOf: '2026-09-04',
          },
        ],
      },
      partialFailureHandling: {
        value: 'Not confirmed in current public documentation',
        shortValue: 'Not publicly confirmed',
        detail:
          'Tool errors can be surfaced to an agent, but a configurable workflow error branch and guaranteed continuation behavior were not confirmed.',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/tools/run-agent.md',
            label: 'Dust: Run agent',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/troubleshooting-your-agent.md',
            label: 'Dust: Troubleshooting your agent',
            asOf: '2026-09-04',
          },
        ],
      },
      unattendedExecution: {
        value: 'Yes: scheduled runs and wake-ups execute without an active chat session',
        shortValue: 'Hosted schedules and wake-ups',
        detail:
          'Client-side MCP tools additionally require the external tool client to be available.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/triggers/schedules.md',
            label: 'Dust: Schedules',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/tools/wake-ups.md',
            label: 'Dust: Wake-ups',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value: 'Documentation, community, email support, and Enterprise priority support',
        shortValue: 'Docs, community, email, Enterprise priority support',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/dust-support.md',
            label: 'Dust Support',
            asOf: '2026-09-04',
          },
          {
            url: 'https://dust.tt/home/pricing',
            label: 'Dust: Pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      sla: {
        value: 'Enterprise lists an SLA; the public uptime percentage was not confirmed',
        shortValue: 'Enterprise SLA; public percentage unconfirmed',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://dust.tt/home/pricing',
            label: 'Dust: Pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      community: {
        value: 'Public Dust Community with help discussions and events',
        shortValue: 'Public community and events',
        confidence: 'verified',
        sources: [
          {
            url: 'https://community.dust.tt/',
            label: 'Dust Community',
            asOf: '2026-09-04',
          },
        ],
      },
      companyMaturity: {
        value: 'Vendor reports 300,000+ agents deployed and 3,000+ teams',
        shortValue: 'Vendor-reported 300,000+ agents and 3,000+ teams',
        detail:
          'These are vendor adoption figures, not independently audited usage or financial-stability measures.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://dust.tt/home/pricing',
            label: 'Dust: Pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      academy: {
        value: 'Not confirmed in current public documentation',
        shortValue: 'Not publicly confirmed',
        detail:
          'Public documentation and community learning events are available. The standalone Academy course catalog could not be inspected in this review.',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/user-documentation/agents/dust-support.md',
            label: 'Dust Support',
            asOf: '2026-09-04',
          },
          {
            url: 'https://community.dust.tt/',
            label: 'Dust Community',
            asOf: '2026-09-04',
          },
        ],
      },
    },
  },
}
