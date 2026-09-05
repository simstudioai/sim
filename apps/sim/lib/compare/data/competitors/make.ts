import { MakeIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Public claims reviewed on 2026-09-04; uncertainties are marked below. */
export const makeProfile: CompetitorProfile = {
  id: 'make',
  name: 'Make',
  website: 'https://www.make.com',
  brand: {
    icon: MakeIcon,
    selfFramed: true,
    colors: ['#9108f9', '#f5eef7', '#040404'],
    description:
      'Make is a visual automation platform for building workflows and AI agents using connected app modules.',
    industries: [
      'Software (B2B)',
      'Developer Tools & APIs',
      'Artificial Intelligence & Machine Learning',
    ],
    socials: [
      {
        type: 'linkedin',
        url: 'https://linkedin.com/company/itsmakehq',
      },
      {
        type: 'x',
        url: 'https://x.com/integromat',
      },
      {
        type: 'instagram',
        url: 'https://instagram.com/itsmakehq',
      },
      {
        type: 'facebook',
        url: 'https://facebook.com/itsmakehq',
      },
      {
        type: 'youtube',
        url: 'https://youtube.com/@itsmake',
      },
    ],
    source: 'Context.dev brand-intelligence API',
    asOf: '2026-07-02',
  },
  oneLiner:
    'Make is a managed visual automation platform with app modules, AI Agents, MCP tools, and JavaScript/Python steps. Subscription plans meter usage in credits.',
  standoutFeatures: [
    {
      title: 'Conversational workflow building',
      description:
        'Maia creates and modifies scenarios and AI Agents through conversation. It is in public beta, with paid-plan access and a Free-plan trial.',
      shortDescription: 'Maia builds and edits automations through conversation (public beta).',
      source: {
        url: 'https://help.make.com/introduction-to-maia-by-make',
        label: 'Make: Introduction to Maia',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Agent execution visibility',
      description:
        'AI Agent modules show execution steps, token usage, and reasoning supplied by supported models.',
      shortDescription: 'Inspect agent execution steps and model-provided reasoning.',
      source: {
        url: 'https://help.make.com/make-ai-agent-new-app',
        label: 'Make: Make AI Agents (New)',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Curated MCP Toolboxes',
      description:
        'Teams can publish a selected collection of scenarios as tools on a dedicated MCP endpoint.',
      shortDescription: 'Publish selected scenarios through a dedicated MCP server.',
      source: {
        url: 'https://help.make.com/mcp-toolboxes',
        label: 'Make: MCP toolboxes',
        asOf: '2026-09-04',
      },
    },
  ],
  limitations: [
    {
      title: 'Custom code dependencies require Enterprise',
      description:
        'Make Code supports JavaScript and Python, but installing additional npm or PyPI dependencies requires Enterprise.',
      shortDescription: 'Additional code dependencies require Enterprise.',
      source: {
        url: 'https://apps.make.com/code',
        label: 'Make: Make Code',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Custom roles require Enterprise',
      description:
        'Custom organization and team roles require Enterprise. Predefined organization roles and plan-dependent team permissions remain available.',
      shortDescription: 'Custom organization and team roles require Enterprise.',
      source: {
        url: 'https://www.make.com/en/blog/governance-in-make',
        label: 'Make governance updates',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Blueprint imports require reconnection',
      description:
        'A scenario blueprint includes modules, settings, and mapped values. Connections must be configured in the destination after import.',
      shortDescription: 'Imported scenarios need their connections configured again.',
      source: {
        url: 'https://help.make.com/blueprints',
        label: 'Make: Blueprints',
        asOf: '2026-09-04',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'Visual scenario canvas with app modules, flow control, AI Agents, and optional code steps.',
        shortValue: 'Visual canvas with AI and code steps',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/make-ai-agent-new-app',
            label: 'Make: Make AI Agents (New)',
            asOf: '2026-09-04',
          },
          {
            url: 'https://apps.make.com/code',
            label: 'Make: Make Code',
            asOf: '2026-09-04',
          },
        ],
      },
      learningCurve: {
        value: 'Learning effort depends on workflow complexity.',
        shortValue: 'Estimated: more concepts for complex workflows',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://help.make.com/flow-control',
            label: 'Make: Flow control',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'This is an editorial assessment: iterators, routers, mappings, and error handling introduce additional concepts beyond a simple linear scenario.',
      },
      selfHostOption: {
        value:
          'Make runs as a managed cloud service; its Enterprise on-premise agent connects that service to private systems.',
        shortValue: 'Managed cloud with Enterprise on-prem connectivity',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/security',
            label: 'Make security',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.make.com/on-premise-agent',
            label: 'Make: On-premise agent',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The documented agent is a connectivity component, not an installation of the scenario builder and complete platform.',
      },
      deploymentOptions: {
        value: 'AWS-hosted service, with a separate Enterprise environment.',
        shortValue: 'AWS cloud; separate Enterprise environment',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/security',
            label: 'Make security',
            asOf: '2026-09-04',
          },
        ],
      },
      templates: {
        value: 'Public gallery with thousands of reusable scenario templates.',
        shortValue: 'Thousands of scenario templates',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/templates',
            label: 'Make templates',
            asOf: '2026-09-04',
          },
        ],
      },
      license: {
        value: 'Proprietary commercial service under the Make Master Services Agreement.',
        shortValue: 'Proprietary commercial service',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/master-service-agreement.pdf',
            label: 'Make Master Services Agreement',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The agreement reserves ownership of the service to Celonis and restricts copying and reverse engineering.',
      },
      environmentPromotion: {
        value: 'Blueprint export/import moves scenario definitions between accounts.',
        shortValue: 'Partial: blueprints; managed promotion unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://help.make.com/blueprints',
            label: 'Make: Blueprints',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Connections must be configured after import. A managed dev/test/prod promotion pipeline was not confirmed in the reviewed documentation.',
      },
      versionControlDepth: {
        value:
          'Saved scenario versions can be restored for up to 60 days; recovery also helps retrieve interrupted, unsaved work.',
        shortValue: 'Saved versions and scenario recovery',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/restore-and-recover-scenario',
            label: 'Make: Restore and recover a scenario',
            asOf: '2026-09-04',
          },
        ],
      },
      realtimeCollaboration: {
        value: 'Make Grid shows collaborator cursors and presence.',
        shortValue: 'Partial: live presence in Grid; scenario coediting unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://help.make.com/make-grid-workspace-navigation-and-interaction-updates',
            label: 'Make: Make Grid collaboration',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'This documents collaboration in the workspace map. Synchronized editing of one scenario was not established by the reviewed sources.',
      },
      nativeFileStorage: {
        value:
          'File download, upload, and transfer are documented; a general native file library was not confirmed.',
        shortValue: 'Unconfirmed: native file library',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://help.make.com/working-with-files',
            label: 'Make: Working with files',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The reviewed guide describes files passed between modules and connected storage services.',
      },
      dataTables: {
        value:
          'Data Stores provide structured records with a table view and manual record editing.',
        shortValue: 'Yes: structured Data Stores',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/data-stores',
            label: 'Make: Data Stores',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Storage allocation scales with credits: 1 MB per 1,000 monthly credits, rather than a fixed capacity for each paid plan.',
      },
      richTextEditor: {
        value:
          'Google Docs integration supports document creation and updates; a native document editor was not confirmed.',
        shortValue: 'Unconfirmed: native rich-text document editor',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://apps.make.com/google-docs',
            label: 'Make: Google Docs',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Connected document editing does not establish a native Make document store or WYSIWYG editor.',
      },
      subWorkflows: {
        value:
          'Call a Scenario invokes reusable subscenarios with defined inputs and outputs, synchronously or asynchronously.',
        shortValue: 'Yes: synchronous and asynchronous subscenarios',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/subscenarios',
            label: 'Make: Subscenarios',
            asOf: '2026-09-04',
          },
        ],
      },
      customBlocks: {
        value: 'Reusable scenarios can be called through the Call a Scenario module.',
        shortValue: 'Partial: reusable subscenarios',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/subscenarios',
            label: 'Make: Subscenarios',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The dedicated subscenario selector is scoped to scenarios in the same team; other invocation methods can cross team boundaries.',
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'AI Agents support a model selector and provider connections, including OpenAI, Anthropic, and Gemini.',
        shortValue: 'Multiple providers and selectable models',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/make-ai-agent-new-app',
            label: 'Make: Make AI Agents (New)',
            asOf: '2026-09-04',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          'AI Agent modules expose execution steps, token usage, and model-provided reasoning when available.',
        shortValue: 'Yes: agent modules with execution visibility',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/make-ai-agent-new-app',
            label: 'Make: Make AI Agents (New)',
            asOf: '2026-09-04',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          'Maia creates, modifies, and troubleshoots scenarios and AI Agents through conversation.',
        shortValue: 'Yes: Maia conversational builder (public beta)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/introduction-to-maia-by-make',
            label: 'Make: Introduction to Maia',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Available on paid plans, with a 30-day trial for Free users who sign up. Users review and activate the resulting scenarios.',
      },
      knowledgeBaseRag: {
        value: 'AI Agent knowledge files are chunked and stored for retrieval of relevant content.',
        shortValue: 'Yes: built-in knowledge-file retrieval',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/knowledge-files-for-ai-agents',
            label: 'Make: Knowledge files for AI Agents',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpSupport: {
        value:
          'AI Agents can use MCP tools, and MCP Toolboxes expose scenarios to external clients.',
        shortValue: 'Yes: MCP tool use and publishing',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/make-ai-agent-new-app',
            label: 'Make: Make AI Agents (New)',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.make.com/mcp-toolboxes',
            label: 'Make: MCP toolboxes',
            asOf: '2026-09-04',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'Agent instructions, structured output configuration, and test conversations help constrain and inspect behavior.',
        shortValue: 'Partial: instructions; enforced policies unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://help.make.com/make-ai-agent-new-best-practices',
            label: 'Make: AI Agent best practices',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The guide warns that models may ignore instructions. A dedicated evaluation suite or enforced content-policy engine was not confirmed.',
      },
      humanInTheLoop: {
        value: 'Agent workflows can request human approval through configured tools such as Slack.',
        shortValue: 'Yes: approvals through workflow tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/make-ai-agent-new-best-practices',
            label: 'Make: AI Agent best practices',
            asOf: '2026-09-04',
          },
        ],
      },
      generativeMedia: {
        value: 'Provider integrations include OpenAI image and video generation actions.',
        shortValue: 'Yes: provider-backed image and video generation',
        confidence: 'verified',
        sources: [
          {
            url: 'https://apps.make.com/openai-gpt-3',
            label: 'Make: OpenAI app',
            asOf: '2026-09-04',
          },
        ],
      },
      dynamicToolUse: {
        value:
          'An agent selects from configured modules, scenarios, and MCP tools based on its task.',
        shortValue: 'Yes: agent-selected tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/make-ai-agent-new-app',
            label: 'Make: Make AI Agents (New)',
            asOf: '2026-09-04',
          },
        ],
      },
      modelFallback: {
        value:
          'Automatic failover between models was not confirmed in the reviewed agent configuration.',
        shortValue: 'Unconfirmed: automatic model fallback',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://help.make.com/make-ai-agent-new-app',
            label: 'Make: Make AI Agents (New)',
            asOf: '2026-09-04',
          },
        ],
      },
      agentSkills: {
        value: 'Agents can reuse scenario tools with descriptions and defined inputs and outputs.',
        shortValue: 'Partial: tools; portable skill packages unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://help.make.com/make-ai-agent-new-best-practices',
            label: 'Make: AI Agent best practices',
            asOf: '2026-09-04',
          },
        ],
        detail: 'A separate portable skill-package format was not confirmed.',
      },
      nativeChatDeployment: {
        value: 'The AI Agent module includes a chat interface for testing.',
        shortValue: 'Partial: agent test chat; public deployment unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://help.make.com/make-ai-agent-new-app',
            label: 'Make: Make AI Agents (New)',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'A production chat deployment interface was not established by the reviewed agent documentation.',
      },
      kbChunkVisibility: {
        value:
          'Knowledge files use chunk-based retrieval; a chunk inspection interface was not confirmed.',
        shortValue: 'Unconfirmed: chunk inspection UI',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://help.make.com/knowledge-files-for-ai-agents',
            label: 'Make: Knowledge files for AI Agents',
            asOf: '2026-09-04',
          },
        ],
      },
      parallelExecution: {
        value:
          'Separate webhook-triggered scenario runs can execute concurrently; Router routes run sequentially.',
        shortValue: 'Concurrent runs; sequential Router routes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/webhooks',
            label: 'Make: Webhooks',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.make.com/router',
            label: 'Make: Router',
            asOf: '2026-09-04',
          },
        ],
      },
      a2aProtocol: {
        value:
          'A native Agent2Agent protocol integration was not confirmed in the reviewed documentation.',
        shortValue: 'Unconfirmed: native A2A protocol support',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://help.make.com/make-ai-agent-new-app',
            label: 'Make: Make AI Agents (New)',
            asOf: '2026-09-04',
          },
        ],
      },
      loopIteration: {
        value:
          'Iterator processes array items as bundles, and Repeater generates a specified number of iterations.',
        shortValue: 'Yes: Iterator and Repeater',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/flow-control',
            label: 'Make: Flow control',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value: 'Make advertises more than 3,000 standard app integrations.',
        shortValue: '3,000+ apps (vendor claim)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/pricing',
            label: 'Make pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      triggerTypes: {
        value:
          'Scenarios can run on schedules or incoming webhooks; connected apps provide their own triggers.',
        shortValue: 'Schedules, webhooks, and app triggers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/webhooks',
            label: 'Make: Webhooks',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.make.com/en/pricing',
            label: 'Make pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      customCodeSteps: {
        value: 'Make Code runs JavaScript or Python on paid plans.',
        shortValue: 'Yes: JavaScript and Python',
        confidence: 'verified',
        sources: [
          {
            url: 'https://apps.make.com/code',
            label: 'Make: Make Code',
            asOf: '2026-09-04',
          },
        ],
      },
      codeSandboxRuntime: {
        value:
          'Managed code runtime with preinstalled libraries; custom npm/PyPI dependencies require Enterprise.',
        shortValue: 'Managed JS/Python; custom dependencies on Enterprise',
        confidence: 'verified',
        sources: [
          {
            url: 'https://apps.make.com/code',
            label: 'Make: Make Code',
            asOf: '2026-09-04',
          },
        ],
        detail: 'Code execution is metered at two credits per second.',
      },
      apiPublishing: {
        value:
          'Custom webhooks receive HTTP requests and a Webhook Response module can return a configured response.',
        shortValue: 'Yes: webhook endpoints with response modules',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/webhooks',
            label: 'Make: Webhooks',
            asOf: '2026-09-04',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'The official TypeScript SDK manages platform resources and custom app development endpoints.',
        shortValue: 'Yes: TypeScript SDK and custom apps',
        confidence: 'verified',
        sources: [
          {
            url: 'https://integromat.github.io/make-typescript-sdk/index.html',
            label: 'Make TypeScript SDK',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpPublishing: {
        value:
          'MCP Toolboxes publish a selected set of active, on-demand scenarios behind a dedicated endpoint.',
        shortValue: 'Yes: curated scenario MCP servers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/mcp-toolboxes',
            label: 'Make: MCP toolboxes',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Toolbox keys and tool annotations control how external clients access the selected tools.',
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Subscription plans include credits; module actions usually cost one credit, while some AI and code operations vary.',
        shortValue: 'Subscription plus usage credits',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/pricing',
            label: 'Make pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      entryPaidPlan: {
        value: 'The pricing page advertises Core from $9 per month for 10,000 monthly credits.',
        shortValue: 'Core: advertised from $9/month',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/pricing',
            label: 'Make pricing',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The page offers monthly and annual billing; the final price depends on billing term and credit volume.',
      },
      freeTier: {
        value:
          'Free includes 1,000 credits per month, two active scenarios, and a 15-minute minimum schedule interval.',
        shortValue: '1,000 credits/month; two active scenarios',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/pricing',
            label: 'Make pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      byok: {
        value:
          'AI Agents accept custom provider connections on paid plans; Make’s managed AI provider is available on all plans.',
        shortValue: 'Yes: paid-plan AI Agent provider connections',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/make-ai-agent-new-app',
            label: 'Make: Make AI Agents (New)',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    security: {
      dataResidency: {
        value:
          'Choose a US or EU organization region during creation; that selection cannot subsequently be changed.',
        shortValue: 'US or EU, selected at organization creation',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/organizations',
            label: 'Make: Organizations',
            asOf: '2026-09-04',
          },
        ],
      },
      rbac: {
        value:
          'Organization roles and team access controls are documented; Enterprise adds custom organization and team roles.',
        shortValue: 'Organization/team roles; Enterprise custom roles',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/organizations',
            label: 'Make: Organizations',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.make.com/teams',
            label: 'Make: Teams',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.make.com/en/blog/governance-in-make',
            label: 'Make governance updates',
            asOf: '2026-09-04',
          },
        ],
      },
      auditLogging: {
        value:
          'Enterprise audit logs record organization and team activity and are retained for 12 months.',
        shortValue: 'Enterprise audit logs; 12-month retention',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/audit-logs',
            label: 'Make: Audit logs',
            asOf: '2026-09-04',
          },
        ],
      },
      compliance: {
        value:
          'Make reports SOC 2 Type II and SOC 3 audits, an ISO 27001 information-security program, and GDPR adherence.',
        shortValue: 'SOC 2 Type II/SOC 3; ISO 27001 program; GDPR',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/security',
            label: 'Make security',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'These are vendor-reported assurances; the source distinguishes audits, the security program, and privacy obligations.',
      },
      modelAndToolGovernance: {
        value:
          'Enterprise feature controls can disable listed AI/beta features; MCP Toolboxes restrict published scenario tools.',
        shortValue: 'Partial: AI/tool controls; model allowlist unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://help.make.com/feature-controls',
            label: 'Make: Feature controls',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.make.com/mcp-toolboxes',
            label: 'Make: MCP toolboxes',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Feature controls do not cover application modules. A model-specific organization allowlist was not confirmed.',
      },
      credentialGovernance: {
        value:
          'Connections are scoped through teams; credential-use alerts notify owners when another user uses a connection or key.',
        shortValue: 'Team access and credential-use alerts',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/teams',
            label: 'Make: Teams',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.make.com/en/blog/governance-in-make',
            label: 'Make governance updates',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Private Spaces also isolate personal work. This does not establish a separate permission policy for every individual credential.',
      },
      whiteLabeling: {
        value:
          'The White Label offering supports instance branding, including names, logos, colors, and support links.',
        shortValue: 'Yes: White Label instance branding',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.make.com/white-label-documentation/customize-your-instance/rebrand-your-instance',
            label: 'Make White Label: rebrand your instance',
            asOf: '2026-09-04',
          },
        ],
      },
      dataRetention: {
        value:
          'Detailed execution logs are retained for 7 days on Free, 30 on Core/Pro/Teams, and 60 on Enterprise.',
        shortValue: 'Execution logs: 7/30/60 days by plan',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/pricing',
            label: 'Make pricing',
            asOf: '2026-09-04',
          },
        ],
        detail: 'Audit-log and knowledge-file retention are separate policies.',
      },
      piiRedaction: {
        value:
          'Automatic platform-wide PII detection and redaction was not confirmed in the reviewed agent guidance.',
        shortValue: 'Unconfirmed: automatic PII redaction',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://help.make.com/make-ai-agent-new-best-practices',
            label: 'Make: AI Agent best practices',
            asOf: '2026-09-04',
          },
        ],
      },
      sso: {
        value: 'Enterprise supports SAML 2.0 and OpenID Connect single sign-on.',
        shortValue: 'Enterprise: SAML 2.0 and OIDC',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/single-sign-on',
            label: 'Make: Single sign-on',
            asOf: '2026-09-04',
          },
        ],
      },
      sessionPolicy: {
        value:
          'Organization owners and admins can set an inactivity timeout from 15 minutes to 7 days.',
        shortValue: 'Idle timeout: 15 minutes to 7 days',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/set-the-length-of-your-session-timeout',
            label: 'Make: Session timeout',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'When a user belongs to multiple organizations, the shortest applicable timeout takes precedence.',
      },
      thirdPartyVetting: {
        value:
          'Custom apps can be shared privately; publication in the public catalog requires Make’s app review.',
        shortValue: 'Private custom apps; review for public listing',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.make.com/custom-apps-documentation/app-review/overview',
            label: 'Make custom app review',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The review documentation describes quality and code requirements. It does not guarantee every installed private app has undergone that review.',
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Scenario history exposes run and module details; Enterprise Analytics Dashboard adds execution, usage, and error trends.',
        shortValue: 'Run/module history; Enterprise analytics',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/scenario-history',
            label: 'Make: Scenario history',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.make.com/analytics-dashboard',
            label: 'Make: Analytics Dashboard',
            asOf: '2026-09-04',
          },
        ],
      },
      durabilityModel: {
        value: 'Incomplete executions preserve failed work for retry from the failed module.',
        shortValue: 'Incomplete executions and retries',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/automatic-retry-of-incomplete-executions',
            label: 'Make: Automatic retry of incomplete executions',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Automatic retries apply to documented transient errors; Retry error-handler configuration provides another recovery path.',
      },
      failureAlerting: {
        value: 'Email preferences control scenario-error and deactivation notifications.',
        shortValue: 'Configurable error and deactivation emails',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/manage-your-email-preferences',
            label: 'Make: Email preferences',
            asOf: '2026-09-04',
          },
        ],
      },
      dataDrains: {
        value:
          'Scenario history supports CSV export; continuous native log streaming was not confirmed.',
        shortValue: 'Partial: CSV export; continuous streaming unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://help.make.com/scenario-history',
            label: 'Make: Scenario history',
            asOf: '2026-09-04',
          },
        ],
      },
      asyncExecution: {
        value:
          'Webhook-triggered runs and asynchronous subscenario calls can execute without blocking the caller.',
        shortValue: 'Yes: background runs and async subscenarios',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/webhooks',
            label: 'Make: Webhooks',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.make.com/subscenarios',
            label: 'Make: Subscenarios',
            asOf: '2026-09-04',
          },
        ],
      },
      executionLimits: {
        value: 'Maximum scenario execution time is 5 minutes on Free and 40 minutes on paid plans.',
        shortValue: '5-minute Free / 40-minute paid run limit',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/pricing',
            label: 'Make pricing',
            asOf: '2026-09-04',
          },
        ],
        detail: 'Code modules and AI Agent steps have separate runtime limits.',
      },
      partialFailureHandling: {
        value:
          'Resume substitutes output for a failed bundle; Skip removes that bundle while other bundles continue.',
        shortValue: 'Yes: Resume and Skip error handlers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/resume-error-handler',
            label: 'Make: Resume error handler',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.make.com/skip-error-handler',
            label: 'Make: Skip error handler',
            asOf: '2026-09-04',
          },
        ],
      },
      unattendedExecution: {
        value: 'Active scenarios run on Make’s service in response to schedules and webhooks.',
        shortValue: 'Yes: managed background execution',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/webhooks',
            label: 'Make: Webhooks',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.make.com/en/security',
            label: 'Make security',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Support varies by plan, from initial expert access on Free to technical support and 24/7 Enterprise assistance.',
        shortValue: 'Plan-based technical support; Enterprise 24/7',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/pricing',
            label: 'Make pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      sla: {
        value:
          'Make advertises a 99.5% cloud uptime commitment and defined support SLAs for Enterprise.',
        shortValue: 'Enterprise: advertised 99.5% uptime',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/security',
            label: 'Make security',
            asOf: '2026-09-04',
          },
        ],
      },
      community: {
        value:
          'Make links an official community forum, developer documentation, and learning resources.',
        shortValue: 'Official community forum and developer resources',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/blog/governance-in-make',
            label: 'Make governance updates',
            asOf: '2026-09-04',
          },
        ],
      },
      companyMaturity: {
        value:
          'Make launched its current brand in 2022, following Integromat, and is a Celonis business.',
        shortValue: 'Formerly Integromat; part of Celonis',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/press',
            label: 'Make press',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.make.com/master-service-agreement.pdf',
            label: 'Make Master Services Agreement',
            asOf: '2026-09-04',
          },
        ],
      },
      academy: {
        value: 'Make Academy offers free, self-paced courses, hands-on learning, and badges.',
        shortValue: 'Yes: free Make Academy courses and badges',
        confidence: 'verified',
        sources: [
          {
            url: 'https://academy.make.com/',
            label: 'Make Academy',
            asOf: '2026-09-04',
          },
        ],
      },
    },
  },
}
