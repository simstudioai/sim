import { GumloopIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Reviewed against current primary sources on 2026-09-04. */
export const gumloopProfile: CompetitorProfile = {
  id: 'gumloop',
  name: 'Gumloop',
  website: 'https://www.gumloop.com',
  brand: {
    icon: GumloopIcon,
    selfFramed: true,
    colors: ['#fb3e97', '#fc87c0', '#7c7c7c'],
    description:
      'Gumloop is an AI automation platform that enables non-technical teams to build their own AI agents without code or engineering support. Marketing, sales, operations, and support teams can create and deploy workflows instantly by simply typing. The platform lets users design, test, and run AI-driven automations that streamline repetitive tasks, integrate with existing tools, and scale processes. Trusted by companies such as Shopify, DoorDash, Instacart, and Webflow, Gumloop helps organizations automate the workflows that matter most, accelerating productivity and reducing reliance on engineering tickets.',
    industries: ['Artificial Intelligence & Machine Learning', 'Software (B2B)'],
    socials: [
      { type: 'x', url: 'https://x.com/gumloop' },
      { type: 'linkedin', url: 'https://linkedin.com/company/gumloop' },
      { type: 'youtube', url: 'https://youtube.com/@Gumloop_AI' },
    ],
    source: 'Context.dev brand-intelligence API',
    asOf: '2026-07-02',
  },
  oneLiner:
    'Gumloop combines configurable AI agents, Company Brain search, skills, MCP integrations, and a visual workflow builder; it offers managed cloud and Enterprise VPC deployment.',
  standoutFeatures: [
    {
      title: 'Company Brain connects shared knowledge',
      description:
        'Brain indexes connected company sources and makes permission-scoped hybrid search available to agents and through an API.',
      shortDescription: 'Indexed company knowledge with semantic and keyword search.',
      source: {
        url: 'https://docs.gumloop.com/api-reference/brain/search.md',
        label: 'Gumloop: Search Company Brain',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Persistent agent code environments',
      description:
        'Agents run Python and shell commands in isolated VMs. Editors can install packages that persist across conversations.',
      shortDescription: 'Isolated code execution with persistent packages.',
      source: {
        url: 'https://docs.gumloop.com/core-concepts/agent_sandbox_and_secrets.md',
        label: 'Gumloop: Code Sandbox & Secrets',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Skills synchronized from GitHub',
      description:
        'Organization skills can be maintained in a repository and synchronized into Gumloop for shared agent use.',
      shortDescription: 'Version-controlled organization skills.',
      source: {
        url: 'https://docs.gumloop.com/core-concepts/organization_skills.md',
        label: 'Gumloop: Organization Skills',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Conversation evaluations with notifications',
      description:
        'Completed agent interactions are graded against configured criteria, with tags, extracted data, and notifications for selected outcomes.',
      shortDescription: 'Automatic conversation grading and notifications.',
      source: {
        url: 'https://docs.gumloop.com/core-concepts/evaluations.md',
        label: 'Gumloop: Evaluations',
        asOf: '2026-09-04',
      },
    },
    {
      title: '250+ MCP servers advertised',
      description:
        'The vendor advertises managed connections to more than 250 MCP servers; custom servers can extend the catalog.',
      shortDescription: '250+ vendor-advertised MCP servers.',
      source: {
        url: 'https://www.gumloop.com/mcp',
        label: 'MCP Servers for Your AI Agents | Gumloop',
        asOf: '2026-09-04',
      },
    },
  ],
  limitations: [
    {
      title: 'Workflows are now labeled legacy',
      description:
        'Current pricing identifies the visual workflow offering as legacy alongside the newer agent product. Confirm the roadmap if the canvas is central to your adoption.',
      shortDescription: 'Visual workflows are listed as legacy.',
      source: {
        url: 'https://www.gumloop.com/pricing',
        label: 'Pricing | Gumloop',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Usage includes orchestration charges',
      description:
        'Agent runs incur compute, tool, and orchestration costs. BYOK removes model credits but raises the standard agent orchestration rate to 16%; provider tokens are billed separately.',
      shortDescription: 'BYOK still carries agent orchestration and other charges.',
      source: {
        url: 'https://docs.gumloop.com/core-concepts/credits.md',
        label: 'Gumloop: Credits',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Workflow saves can affect live triggers',
      description:
        'Checkpoint documentation says saved changes to the live checkpoint immediately affect triggers. Use checkpoint and testing practices appropriate to production workflows.',
      shortDescription: 'Saved live-checkpoint changes affect triggers immediately.',
      source: {
        url: 'https://docs.gumloop.com/core-concepts/checkpoint_history.md',
        label: 'Gumloop: Workflow Checkpoints',
        asOf: '2026-09-04',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value: 'Agent configuration and chat, plus a visual node-based workflow builder',
        shortValue: 'Agent builder plus visual workflows',
        detail:
          'Current pricing labels the workflow product as legacy; agents combine instructions, connectors, skills, subagents, and abilities.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/agents.md',
            label: 'Gumloop: Agents',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/workbooks.md',
            label: 'Gumloop: Workflows',
            asOf: '2026-09-04',
          },
        ],
      },
      learningCurve: {
        value:
          'Accessible for basic agents; advanced integrations and code require more technical work',
        shortValue: 'Simple basics; technical depth for custom work',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/agents.md',
            label: 'Gumloop: Agents',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/agent_sandbox_and_secrets.md',
            label: 'Gumloop: Code Sandbox & Secrets',
            asOf: '2026-09-04',
          },
        ],
      },
      selfHostOption: {
        value:
          'Customer-cloud VPC deployment is offered; a supported self-managed install was not confirmed',
        shortValue: 'Customer VPC; self-managed install unconfirmed',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.gumloop.com/solutions/security',
            label: 'Security and trust at Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      deploymentOptions: {
        value: 'Managed SaaS or an optional Enterprise deployment into your own cloud',
        shortValue: 'SaaS or Enterprise VPC',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.gumloop.com/solutions/security',
            label: 'Security and trust at Gumloop',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.gumloop.com/pricing',
            label: 'Pricing | Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      templates: {
        value: 'Yes: public templates and organization sharing for reusable automations',
        shortValue: 'Public templates and team reuse',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.gumloop.com/templates',
            label: 'Gumloop Community Templates | AI Agent and Workflow Automation Templates',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/teams',
            label: 'Organization and Teams - Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      license: {
        value: 'Proprietary hosted service',
        shortValue: 'Proprietary',
        detail:
          'The service terms reserve ownership of the platform to AgentHub and its licensors. Open model support and open SDKs do not make the platform open source.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.gumloop.com/tos',
            label: 'Terms Of Service | Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      environmentPromotion: {
        value: 'Workflow checkpoints can be made live; organization skills can sync from GitHub',
        shortValue: 'Live checkpoints; GitHub skill sync',
        detail:
          'A separate staged promotion pipeline for the whole platform was not confirmed. Saved edits to the live workflow affect triggers immediately.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/checkpoint_history.md',
            label: 'Gumloop: Workflow Checkpoints',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/organization_skills.md',
            label: 'Gumloop: Organization Skills',
            asOf: '2026-09-04',
          },
        ],
      },
      versionControlDepth: {
        value: 'Workflow snapshots and rollback; GitHub-backed organization skills',
        shortValue: 'Checkpoint rollback and GitHub skill sync',
        detail:
          'Checkpoint documentation describes choosing a live snapshot. It does not establish Git-style workflow branches or visual diffs.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/checkpoint_history.md',
            label: 'Gumloop: Workflow Checkpoints',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/organization_skills.md',
            label: 'Gumloop: Organization Skills',
            asOf: '2026-09-04',
          },
        ],
      },
      realtimeCollaboration: {
        value: 'Not confirmed in current public documentation',
        shortValue: 'Not publicly confirmed',
        detail:
          'Team sharing and editor access are documented; simultaneous cursor-synchronized canvas editing was not confirmed.',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/teams',
            label: 'Organization and Teams - Gumloop',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/workbooks.md',
            label: 'Gumloop: Workflows',
            asOf: '2026-09-04',
          },
        ],
      },
      nativeFileStorage: {
        value: 'Yes: stored agent artifacts with versions, previews, and access-controlled sharing',
        shortValue: 'Versioned artifacts with sharing controls',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/agent_artifacts.md',
            label: 'Gumloop: Agent Artifacts (Files)',
            asOf: '2026-09-04',
          },
        ],
      },
      dataTables: {
        value:
          'Spreadsheet artifacts and tabular data are supported; a native editable database grid was not confirmed',
        shortValue: 'Spreadsheet artifacts; native database grid unconfirmed',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/agent_artifacts.md',
            label: 'Gumloop: Agent Artifacts (Files)',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/types',
            label: 'Types - Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      richTextEditor: {
        value: 'Not confirmed in current public documentation',
        shortValue: 'Not publicly confirmed',
        detail:
          'Artifact documentation describes previews and syntax-highlighted text; a native document WYSIWYG editor was not confirmed.',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/agent_artifacts.md',
            label: 'Gumloop: Agent Artifacts (Files)',
            asOf: '2026-09-04',
          },
        ],
      },
      subWorkflows: {
        value: 'Yes: saved workflows become reusable Subflow nodes with input and output ports',
        shortValue: 'Reusable Subflow nodes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/subflows',
            label: 'Subflows - Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      customBlocks: {
        value: 'Reusable Subflows and organization-shared custom code nodes',
        shortValue: 'Subflows and shared custom nodes',
        detail:
          'Custom code nodes appear in teammates’ node libraries. Hiding every internal step and credential of a shared multi-step workflow was not confirmed.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/subflows',
            label: 'Subflows - Gumloop',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/node_and_flow_library',
            label: 'Node and Workflow Library - Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Yes: multiple providers and open models, with model selection and custom Enterprise proxies',
        shortValue: 'Multiple providers and open models',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/ai_models.md',
            label: 'Gumloop: AI Models',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/enterprise-features/ai_model_control',
            label: 'AI Model Governance & Configuration - Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      agentReasoningBlocks: {
        value: 'Yes: autonomous agents choose tools, and an Agent node embeds them in workflows',
        shortValue: 'Agents with tools and workflow Agent nodes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/agents.md',
            label: 'Gumloop: Agents',
            asOf: '2026-09-04',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          'Yes: agents can write their instructions and skills; Gummie assists workflow creation',
        shortValue: 'Conversational agent and workflow creation',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/agents.md',
            label: 'Gumloop: Agents',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.gumloop.com/changelog',
            label: 'Changelog | Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          'Yes: Company Brain indexes connected knowledge and provides hybrid search with citations',
        shortValue: 'Company Brain hybrid search and citations',
        detail:
          'Sources are scoped to personal, team, or organization access. Search combines semantic and keyword retrieval.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/brain.md',
            label: 'Gumloop: Brain',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/api-reference/brain/search.md',
            label: 'Gumloop: Search Company Brain',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpSupport: {
        value: 'Yes: managed integrations, custom MCP connections, and a remote Gumloop MCP server',
        shortValue: 'MCP connections and remote Gumloop server',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/nodes/mcp/custom_mcp_servers',
            label: 'Custom MCP Servers - Gumloop',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/mcp-server/overview.md',
            label: 'Gumloop: MCP Server',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.gumloop.com/mcp',
            label: 'MCP Servers for Your AI Agents | Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      evaluationGuardrails: {
        value: 'Yes: conversation grading and alerts, plus App Rules that block or tag tool calls',
        shortValue: 'Conversation evaluations and tool-call rules',
        detail:
          'Evaluations run after completed interactions. This does not establish a separate batch dataset regression runner.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/evaluations.md',
            label: 'Gumloop: Evaluations',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/enterprise-features/app-policies/app-rules.md',
            label: 'Gumloop: App Rules',
            asOf: '2026-09-04',
          },
        ],
      },
      humanInTheLoop: {
        value: 'Yes: tool approvals and structured questions pause agents for human decisions',
        shortValue: 'Tool approvals and structured questions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/human_in_the_loop.md',
            label: 'Gumloop: Human in the Loop',
            asOf: '2026-09-04',
          },
        ],
      },
      generativeMedia: {
        value: 'Image generation and server-side voice transcription are documented',
        shortValue: 'Image generation and voice transcription',
        detail:
          'Video generation and a general native speech-generation feature were not confirmed.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/nodes/using_ai/generate_image',
            label: 'Generate Image - Gumloop',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/agents.md',
            label: 'Gumloop: Agents',
            asOf: '2026-09-04',
          },
        ],
      },
      dynamicToolUse: {
        value: 'Yes: agents select tools and can load tool schemas on demand',
        shortValue: 'Runtime tool selection and discovery',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/agents.md',
            label: 'Gumloop: Agents',
            asOf: '2026-09-04',
          },
        ],
      },
      modelFallback: {
        value:
          'Yes: agent retries can switch to another provider, with up to two configured fallbacks',
        shortValue: 'Retries with cross-provider model fallback',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/agents.md',
            label: 'Gumloop: Agents',
            asOf: '2026-09-04',
          },
        ],
      },
      agentSkills: {
        value:
          'Yes: reusable instruction and script packages, with organization GitHub synchronization',
        shortValue: 'Reusable skills with GitHub synchronization',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/skills.md',
            label: 'Gumloop: Agent Skills',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/organization_skills.md',
            label: 'Gumloop: Organization Skills',
            asOf: '2026-09-04',
          },
        ],
      },
      nativeChatDeployment: {
        value: 'Yes: agents can publish standalone hosted chat pages',
        shortValue: 'Hosted public or restricted chat pages',
        detail:
          'Hosted pages use gumloopagents.com. Sharing and credential settings determine who can use them.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/hosted_pages.md',
            label: 'Gumloop: Hosted Pages',
            asOf: '2026-09-04',
          },
        ],
      },
      kbChunkVisibility: {
        value: 'Brain search exposes ranked snippets and source metadata through its API',
        shortValue: 'Search snippets and source metadata',
        detail: 'A dedicated raw chunk-index debugging interface was not confirmed.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/api-reference/brain/search.md',
            label: 'Gumloop: Search Company Brain',
            asOf: '2026-09-04',
          },
        ],
      },
      parallelExecution: {
        value: 'Yes: parallel subagents and concurrent list processing in workflow Loop Mode',
        shortValue: 'Parallel subagents and list processing',
        detail:
          'Loop Mode documents 15 concurrent items on Pro; subagent concurrency depends on subscription.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/agents.md',
            label: 'Gumloop: Agents',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/loop_mode.md',
            label: 'Gumloop: Loop Mode',
            asOf: '2026-09-04',
          },
        ],
      },
      a2aProtocol: {
        value: 'Not confirmed in current public documentation',
        shortValue: 'Not publicly confirmed',
        detail:
          'The reviewed integration documentation covers MCP; native Agent2Agent protocol support was not confirmed.',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.gumloop.com/nodes/mcp/custom_mcp_servers',
            label: 'Custom MCP Servers - Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      loopIteration: {
        value: 'Yes: Loop Mode processes each list item and collects corresponding outputs',
        shortValue: 'List iteration through Loop Mode',
        detail:
          'Items can execute concurrently. A separate while-loop container was not confirmed.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/loop_mode.md',
            label: 'Gumloop: Loop Mode',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value: 'Vendor advertises 250+ MCP servers',
        shortValue: '250+ MCP servers, vendor-reported',
        detail:
          'This is an MCP-server count, not a count of workflow actions or unique native app integrations.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.gumloop.com/mcp',
            label: 'MCP Servers for Your AI Agents | Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      triggerTypes: {
        value: 'Scheduled, event-driven, webhook, chat, email, and API entry points',
        shortValue: 'Schedules, events, webhooks, chat, email, API',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/agent_triggers.md',
            label: 'Gumloop: Agent Triggers',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/workflow_triggers',
            label: 'Workflow Triggers - Gumloop',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/api-reference/getting-started',
            label: 'Getting Started - Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      customCodeSteps: {
        value: 'Yes: Python or JavaScript workflow nodes and Python/shell agent sandboxes',
        shortValue: 'Python/JavaScript nodes and agent shell',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/nodes/advanced/run_code',
            label: 'Run Code - Gumloop',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/agent_sandbox_and_secrets.md',
            label: 'Gumloop: Code Sandbox & Secrets',
            asOf: '2026-09-04',
          },
        ],
      },
      codeSandboxRuntime: {
        value:
          'Yes: isolated agent VMs support pip/npm installation and persistent package environments',
        shortValue: 'Agent VMs with installable packages',
        detail:
          'Editors can persist packages across agent chats; viewer installs are session-only. Commands have a 30-minute timeout. Legacy Run Code nodes expose a curated library list.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/agent_sandbox_and_secrets.md',
            label: 'Gumloop: Code Sandbox & Secrets',
            asOf: '2026-09-04',
          },
        ],
      },
      apiPublishing: {
        value: 'Yes: APIs manage agents and sessions and start asynchronous workflow runs',
        shortValue: 'Agent/session APIs and workflow execution',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/api-reference/getting-started',
            label: 'Getting Started - Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Official Python and JavaScript SDKs, a programmable API, and an AI-assisted custom node builder',
        shortValue: 'Python/JavaScript SDKs, API, custom nodes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/api-reference/getting-started',
            label: 'Getting Started - Gumloop',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/api-reference/sdk/javascript',
            label: 'JavaScript SDK - Gumloop',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/nodes/custom_node_details',
            label: 'Gumloop: Retrieve API key from environment variable',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpPublishing: {
        value: 'Yes: Gumloop MCP Server can start workflows and agents and retrieve their results',
        shortValue: 'Workflows and agents callable through MCP',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/mcp-server/overview.md',
            label: 'Gumloop: MCP Server',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value: 'Credits for model, tool, and compute usage; agent orchestration adds a base 8% fee',
        shortValue: 'Usage credits plus agent orchestration fee',
        detail:
          'Workflow runs charge node costs without the agent compute or orchestration fee. Enterprise rates may differ.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/credits.md',
            label: 'Gumloop: Credits',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.gumloop.com/blog/transparent-pricing',
            label: 'Gumloop: A simple, transparent pricing model',
            asOf: '2026-09-04',
          },
        ],
      },
      entryPaidPlan: {
        value: 'Pro starts at $37/month with 20,000 credits and unlimited seats',
        shortValue: 'Pro from $37/month',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.gumloop.com/pricing',
            label: 'Pricing | Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      freeTier: {
        value:
          'A 14-day Pro trial requiring a card; current signup documentation replaces the former Free plan',
        shortValue: '14-day Pro trial; card required',
        detail:
          'The trial converts to paid Pro unless cancelled. It is a one-time offer per customer.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/credits.md',
            label: 'Gumloop: Credits',
            asOf: '2026-09-04',
          },
        ],
      },
      byok: {
        value:
          'Yes: Pro+ waives model credits with your key, while agent orchestration rises to 16%',
        shortValue: 'BYOK waives model credits; other charges remain',
        detail:
          'You pay the provider directly. Compute and tool charges remain; the agent fee uses the run’s pre-waiver value. Enterprise rates can differ. Workflows have no orchestration fee.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/credits.md',
            label: 'Gumloop: Credits',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    security: {
      dataResidency: {
        value: 'Enterprise VPC deployment can use your chosen cloud region',
        shortValue: 'Chosen region through Enterprise VPC',
        detail:
          'LLM and connected-service calls still depend on the selected providers and account configuration.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.gumloop.com/solutions/security',
            label: 'Security and trust at Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      rbac: {
        value: 'Yes: organization and team roles, plus Enterprise custom roles',
        shortValue: 'Organization/team roles and custom roles',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/organization_user_roles.md',
            label: 'Gumloop: User Roles',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/enterprise-features/user_groups',
            label: 'Custom Roles - Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      auditLogging: {
        value: 'Yes: Enterprise logs record administrative, workflow, agent, and file activity',
        shortValue: 'Enterprise audit logs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/enterprise-features/audit_logging',
            label: 'Audit Logging - Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      compliance: {
        value:
          'Vendor states SOC 2 Type II attestation, HIPAA support with eligible-plan BAAs, and GDPR-aligned practices',
        shortValue: 'SOC 2 II; HIPAA/BAA; GDPR-aligned',
        detail:
          'Gumloop also states EU–US Data Privacy Framework certification including the UK Extension. These are vendor claims; the restricted audit report was not inspected.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.gumloop.com/solutions/security',
            label: 'Security and trust at Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      modelAndToolGovernance: {
        value:
          'Yes: Enterprise model restrictions and role policies; App Rules can block or tag tool calls',
        shortValue: 'Model restrictions and scoped App Rules',
        detail:
          'Agent-scoped rules are available on Pro with limits; organization-wide rules require Enterprise.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/enterprise-features/ai_model_control',
            label: 'AI Model Governance & Configuration - Gumloop',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/enterprise-features/user_groups',
            label: 'Custom Roles - Gumloop',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/enterprise-features/app-policies/app-rules.md',
            label: 'Gumloop: App Rules',
            asOf: '2026-09-04',
          },
        ],
      },
      credentialGovernance: {
        value:
          'Personal, team, and organization credentials with account selection and role-governed access',
        shortValue: 'Scoped credentials and account selection',
        detail:
          'Specific credential allowlists per role were not confirmed. Agents may use the runner’s account, a selected account, or a team default.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/credentials.md',
            label: 'Gumloop: Connectors',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/agent_sandbox_and_secrets.md',
            label: 'Gumloop: Code Sandbox & Secrets',
            asOf: '2026-09-04',
          },
        ],
      },
      whiteLabeling: {
        value:
          'Custom Slack app branding and organization login pages; full workspace rebranding unconfirmed',
        shortValue: 'Slack branding and organization login pages',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/custom_slack_app',
            label: 'Custom Slack App Integration - Gumloop',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/enterprise-features/sso_saml_scim',
            label: 'SSO, SAML & SCIM - Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      dataRetention: {
        value:
          'Enterprise custom retention; Incognito chats use temporary storage deleted after 24 hours',
        shortValue: 'Custom retention and temporary Incognito chats',
        detail: 'Incognito is not a promise that every external provider retains no data.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.gumloop.com/pricing',
            label: 'Pricing | Gumloop',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/agents.md',
            label: 'Gumloop: Agents',
            asOf: '2026-09-04',
          },
        ],
      },
      piiRedaction: {
        value: 'Not confirmed in current public documentation',
        shortValue: 'Not publicly confirmed',
        detail:
          'Tool policies and secret handling are documented; general automatic PII redaction of inputs, outputs, and retained logs was not confirmed.',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.gumloop.com/enterprise-features/app-policies/app-rules.md',
            label: 'Gumloop: App Rules',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/agent_sandbox_and_secrets.md',
            label: 'Gumloop: Code Sandbox & Secrets',
            asOf: '2026-09-04',
          },
        ],
      },
      sso: {
        value: 'Yes: Enterprise SAML SSO and SCIM provisioning',
        shortValue: 'Enterprise SAML SSO and SCIM',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/enterprise-features/sso_saml_scim',
            label: 'SSO, SAML & SCIM - Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      sessionPolicy: {
        value:
          'SSO documentation mentions configurable session timeouts without public configuration details',
        shortValue: 'Timeout capability mentioned; settings unconfirmed',
        detail:
          'Defaults, idle versus absolute duration, and the administrative configuration procedure were not confirmed.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/enterprise-features/sso_saml_scim',
            label: 'SSO, SAML & SCIM - Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      thirdPartyVetting: {
        value: 'Managed integrations coexist with customer-defined custom nodes and MCP servers',
        shortValue: 'Managed and customer-defined integrations',
        detail: 'A universal vendor security review of every custom integration was not confirmed.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/nodes/custom_node_details',
            label: 'Gumloop: Retrieve API key from environment variable',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/nodes/mcp/custom_mcp_servers',
            label: 'Custom MCP Servers - Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Per-node inputs, outputs, duration, and credits, plus organization usage dashboards',
        shortValue: 'Node traces and organization insights',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/run_log',
            label: 'Run Log - Gumloop',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/enterprise-features/organization_insights.md',
            label: 'Gumloop: Organization Insights',
            asOf: '2026-09-04',
          },
        ],
      },
      durabilityModel: {
        value: 'Workflow Resume, scheduled-trigger retries, and agent model retries with fallbacks',
        shortValue: 'Resume, trigger retries, and model fallback',
        detail:
          'General durable replay of all external side effects after infrastructure failure was not confirmed.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/workbooks.md',
            label: 'Gumloop: Workflows',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/workflow_triggers',
            label: 'Workflow Triggers - Gumloop',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/agents.md',
            label: 'Gumloop: Agents',
            asOf: '2026-09-04',
          },
        ],
      },
      failureAlerting: {
        value: 'Yes: Pro+ workflow failure emails and configurable agent evaluation notifications',
        shortValue: 'Failure emails and evaluation notifications',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/alerts',
            label: 'Alerts - Gumloop',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/evaluations.md',
            label: 'Gumloop: Evaluations',
            asOf: '2026-09-04',
          },
        ],
      },
      dataDrains: {
        value: 'Yes: Enterprise continuous exports to HTTP/OTLP, S3, or Datadog',
        shortValue: 'Enterprise HTTP/OTLP, S3, Datadog drains',
        detail:
          'Drains begin from creation and do not refresh already-delivered in-flight costs. The docs recommend Credit Logs for finalized cost accounting.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/enterprise-features/organization_data_export',
            label: 'Usage Data Export - Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      asyncExecution: {
        value: 'Yes: asynchronous agent sessions and workflow runs with retrievable status',
        shortValue: 'Asynchronous sessions and workflow runs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/api-reference/getting-started',
            label: 'Getting Started - Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      executionLimits: {
        value:
          'Pro allows 5 concurrent workflows and 25 agent chats; agent shell commands time out after 30 minutes',
        shortValue: 'Pro: 5 workflows, 25 chats concurrently',
        detail:
          'Enterprise concurrency is customizable. The shell-command timeout is not a maximum duration for an entire workflow.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.gumloop.com/pricing',
            label: 'Pricing | Gumloop',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/agent_sandbox_and_secrets.md',
            label: 'Gumloop: Code Sandbox & Secrets',
            asOf: '2026-09-04',
          },
        ],
      },
      partialFailureHandling: {
        value: 'Yes: Error Shield routes failed nodes to an error path',
        shortValue: 'Error Shield success/error routing',
        detail:
          'It supports per-item loop failures; non-loop paths require appropriate joining to continue.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/nodes/flow_basics/error_shield',
            label: 'Error Shield - Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      unattendedExecution: {
        value: 'Yes: scheduled and event-triggered agents run on the hosted service',
        shortValue: 'Hosted scheduled and event execution',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/agent_triggers.md',
            label: 'Gumloop: Agent Triggers',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value: 'Email support, public forum, University, and Enterprise Slack support',
        shortValue: 'Email, forum, learning, Enterprise Slack',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.gumloop.com/pricing',
            label: 'Pricing | Gumloop',
            asOf: '2026-09-04',
          },
          {
            url: 'https://university.gumloop.com/',
            label: 'Gumloop University - Gumloop University',
            asOf: '2026-09-04',
          },
        ],
      },
      sla: {
        value: 'Not confirmed in current public documentation',
        shortValue: 'Not publicly confirmed',
        detail:
          'A public contractual uptime percentage or service-credit schedule was not confirmed in the current pricing and service terms.',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://www.gumloop.com/pricing',
            label: 'Pricing | Gumloop',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.gumloop.com/tos',
            label: 'Terms Of Service | Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
      community: {
        value: 'Public user forum and a creator template gallery',
        shortValue: 'Public forum and creator templates',
        detail: 'No community-size comparison is asserted.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.gumloop.com/templates',
            label: 'Gumloop Community Templates | AI Agent and Workflow Automation Templates',
            asOf: '2026-09-04',
          },
          {
            url: 'https://university.gumloop.com/',
            label: 'Gumloop University - Gumloop University',
            asOf: '2026-09-04',
          },
        ],
      },
      companyMaturity: {
        value: 'Founded in 2023; YC-backed; announced a $50 million Series B in March 2026',
        shortValue: 'Founded 2023; YC-backed; Series B announced',
        detail:
          'Funding is reported by Gumloop. No employee count or implied financial stability guarantee is asserted.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.ycombinator.com/companies/gumloop',
            label:
              'Gumloop: A no-code platform for creating agents and automating workflows with… | Y Combinator',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.gumloop.com/blog/series-b',
            label: "Announcing Gumloop's $50M Series B",
            asOf: '2026-09-04',
          },
        ],
      },
      academy: {
        value: 'Yes: Gumloop University courses and cohort-based learning',
        shortValue: 'University courses and learning cohorts',
        confidence: 'verified',
        sources: [
          {
            url: 'https://university.gumloop.com/',
            label: 'Gumloop University - Gumloop University',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.gumloop.com/cohorts',
            label: 'Learning Cohorts | Gumloop',
            asOf: '2026-09-04',
          },
        ],
      },
    },
  },
}
