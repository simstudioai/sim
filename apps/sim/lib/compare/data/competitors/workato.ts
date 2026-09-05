import { WorkatoIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Public claims reviewed on 2026-09-04; uncertainties are marked below. */
export const workatoProfile: CompetitorProfile = {
  id: 'workato',
  name: 'Workato',
  website: 'https://www.workato.com',
  brand: {
    icon: WorkatoIcon,
    selfFramed: true,
    colors: ['#62dfd2', '#418484', '#151716'],
    description:
      'Workato provides integration and automation for connected business systems, with visual recipes, AI agents, and MCP tools.',
    industries: [
      'Software (B2B)',
      'Developer Tools & APIs',
      'Artificial Intelligence & Machine Learning',
      'Data Infrastructure & Analytics',
    ],
    socials: [
      {
        type: 'x',
        url: 'https://x.com/workato',
      },
      {
        type: 'linkedin',
        url: 'https://linkedin.com/company/workato',
      },
      {
        type: 'instagram',
        url: 'https://instagram.com/workatohq',
      },
      {
        type: 'facebook',
        url: 'https://facebook.com/workato',
      },
      {
        type: 'youtube',
        url: 'https://youtube.com/@Workato',
      },
    ],
    source: 'Context.dev brand-intelligence API',
    asOf: '2026-07-02',
  },
  oneLiner:
    'Workato is a managed integration and automation platform with visual recipes, Agent Studio Genies, reusable skills, and governed MCP tools. It offers enterprise subscriptions and self-service credit plans.',
  standoutFeatures: [
    {
      title: 'Development-to-production promotion',
      description:
        'Environments support testing, deployment, and rollback of project assets across development, test, and production. Availability depends on the plan.',
      shortDescription: 'Promote and roll back project assets across environments.',
      source: {
        url: 'https://docs.workato.com/features/environments.html',
        label: 'Workato: Environments',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Hybrid connectivity',
      description:
        'On-prem agents connect private systems to Workato through outbound encrypted connections, with agent groups for high availability.',
      shortDescription: 'Connect private systems through outbound on-prem agents.',
      source: {
        url: 'https://docs.workato.com/on-prem.html',
        label: 'Workato: On-prem connectivity',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Bring your own model provider',
      description:
        'Agent Studio supports customer connections for OpenAI, Anthropic, Azure OpenAI, and AWS Bedrock.',
      shortDescription: 'Genies support four documented BYOLLM provider options.',
      source: {
        url: 'https://docs.workato.com/en/agentic/agent-studio/ai-model/ai-model',
        label: 'Workato: AI models and BYOLLM',
        asOf: '2026-09-04',
      },
    },
  ],
  limitations: [
    {
      title: 'Custom snippet packages are unsupported',
      description:
        'Python recipe steps support standard and selected packages but do not allow installing additional libraries.',
      shortDescription: 'Python steps use the supported package set.',
      source: {
        url: 'https://docs.workato.com/connectors/python.html',
        label: 'Workato: Python connector',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Recipe-based knowledge ingestion does not preserve source permissions',
      description:
        'The knowledge-base recipe method makes ingested content available to all users of the Genie. The Workato GO connected-source method provides a separate permission-aware option.',
      shortDescription: 'Recipe-ingested knowledge is accessible to all users of that Genie.',
      source: {
        url: 'https://docs.workato.com/en/agentic/agent-studio/knowledge-bases/data-ingestion.html',
        label: 'Workato: Knowledge base ingestion',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Some platform capabilities require specific plans',
      description:
        'Development/test/production environments are available on specific plans and may require contacting Workato to enable them.',
      shortDescription: 'Environment promotion is plan-dependent.',
      source: {
        url: 'https://docs.workato.com/features/environments.html',
        label: 'Workato: Environments',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Free credits are a one-time allowance',
      description:
        'The self-service Free plan provides 50,000 credits once. Continuing beyond that allowance requires a paid subscription.',
      shortDescription: 'The 50,000 Free credits do not renew monthly.',
      source: {
        url: 'https://docs.workato.com/en/pricing/self-service/self-service',
        label: 'Workato: Self-service pricing',
        asOf: '2026-09-04',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'Visual recipes combine triggers, actions, conditions, loops, and optional code steps.',
        shortValue: 'Visual recipe builder with code steps',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/recipes/building-recipes.html',
            label: 'Workato: Building recipes',
            asOf: '2026-09-04',
          },
        ],
      },
      learningCurve: {
        value: 'Learning effort depends on the recipe and governance requirements.',
        shortValue: 'Estimated: complexity grows with recipe scope',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.workato.com/recipes/building-recipes.html',
            label: 'Workato: Building recipes',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'This is an editorial assessment based on documented mappings, conditions, and loops, rather than a measured onboarding comparison.',
      },
      selfHostOption: {
        value:
          'The platform is delivered through Workato-managed cloud services, including Virtual Private Workato.',
        shortValue: 'Managed cloud/VPW with local connectivity components',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/cloud-hosting-editions/hosting-editions.html',
            label: 'Workato: Cloud hosting editions',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.workato.com/on-prem.html',
            label: 'Workato: On-prem connectivity',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.workato.com/en/api-mgmt/api-edge-gateway.html',
            label: 'Workato: API Edge Gateway',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'On-prem agents connect private systems. API Edge Gateway also provides a local data-plane option while retaining a cloud control plane.',
      },
      deploymentOptions: {
        value:
          'Shared cloud hosting and a dedicated AWS VPC through Virtual Private Workato are documented.',
        shortValue: 'Shared cloud or Workato-managed private VPC',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/cloud-hosting-editions/hosting-editions.html',
            label: 'Workato: Cloud hosting editions',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Virtual Private Workato is managed by Workato; local connectivity agents are a separate component.',
      },
      templates: {
        value: 'The Community Library provides reusable recipes, connectors, and skills.',
        shortValue: 'Yes: community recipes, connectors, and skills',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/community-library.html',
            label: 'Workato: Community library',
            asOf: '2026-09-04',
          },
        ],
      },
      license: {
        value: 'Proprietary commercial platform licensed through a subscription agreement.',
        shortValue: 'Proprietary commercial service',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.workato.com/legal/terms-of-service',
            label: 'Workato Terms of Service and support agreement',
            asOf: '2026-09-04',
          },
        ],
      },
      environmentPromotion: {
        value:
          'Environments support development, testing, production deployment, and rollback of project assets.',
        shortValue: 'Yes: dev/test/prod promotion (plan-dependent)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/features/environments.html',
            label: 'Workato: Environments',
            asOf: '2026-09-04',
          },
        ],
        detail: 'Availability depends on the contracted plan.',
      },
      versionControlDepth: {
        value: 'Recipe saves create versions that can be compared with Recipe Diff and restored.',
        shortValue: 'Saved versions, Recipe Diff, and restore',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/recipes/version-management.html',
            label: 'Workato: Recipe version management',
            asOf: '2026-09-04',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          'Presence indicators and stale-version safeguards coordinate multiple recipe editors.',
        shortValue: 'Partial: presence and stale-save protection',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/recipes/collaboration-safeguards.html',
            label: 'Workato: Collaboration safeguards',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'An outdated editor cannot save or test until it reloads. This is not evidence of synchronized shared-cursor recipe editing.',
      },
      nativeFileStorage: {
        value: 'Workato FileStorage provides files and directories through a UI and connector.',
        shortValue: 'Yes: FileStorage, with limited availability',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/features/workato-filestorage.html',
            label: 'Workato: FileStorage',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The documented limits include 10 GB per file and 100 GB total storage; access must be enabled for eligible plans.',
      },
      dataTables: {
        value:
          'Data Tables provide structured storage with documented default limits of one million rows and 100 columns per table.',
        shortValue: 'Yes: Data Tables with documented capacity limits',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/data-tables/data-table-limits.html',
            label: 'Workato: Data Table limits',
            asOf: '2026-09-04',
          },
        ],
        detail: 'Enterprise customers can request higher limits.',
      },
      richTextEditor: {
        value:
          'A native rich-text document editor was not confirmed in the reviewed platform documentation.',
        shortValue: 'Unconfirmed: native rich-text document editor',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.workato.com/recipes/building-recipes.html',
            label: 'Workato: Building recipes',
            asOf: '2026-09-04',
          },
        ],
      },
      subWorkflows: {
        value: 'Recipe functions allow recipes to call reusable workflows and exchange data.',
        shortValue: 'Yes: reusable recipe functions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/connectors/recipe-functions.html',
            label: 'Workato: Recipe functions',
            asOf: '2026-09-04',
          },
        ],
      },
      customBlocks: {
        value: 'Recipe functions and shared skills encapsulate reusable workflow behavior.',
        shortValue: 'Partial: functions/skills; custom toolbar blocks unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.workato.com/connectors/recipe-functions.html',
            label: 'Workato: Recipe functions',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.workato.com/agentic/skills',
            label: 'Workato: Skills',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The documented reuse mechanisms are callable recipes and skills; a separate publish-recipe-as-toolbar-block feature was not confirmed.',
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Agent Studio provides managed model choices and BYOLLM connections for OpenAI, Anthropic, Azure OpenAI, and AWS Bedrock.',
        shortValue: 'Managed models plus four BYOLLM provider options',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/en/agentic/agent-studio/ai-model/ai-model',
            label: 'Workato: AI models and BYOLLM',
            asOf: '2026-09-04',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          'Genies combine a job description, skills, and knowledge to decide how to carry out a task.',
        shortValue: 'Yes: Genies with skills and knowledge',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/agentic/agentic.html',
            label: 'Workato: Agent Studio',
            asOf: '2026-09-04',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          'Recipe Copilot creates and refines recipe steps from natural-language instructions.',
        shortValue: 'Yes: Recipe Copilot',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/recipes/using-recipe-copilot.html',
            label: 'Workato: Recipe Copilot',
            asOf: '2026-09-04',
          },
        ],
        detail: 'Builders review suggested changes before applying them.',
      },
      knowledgeBaseRag: {
        value:
          'Agent Studio retrieves knowledge from connected sources or custom knowledge-base ingestion recipes.',
        shortValue: 'Yes: connected-source and recipe-based retrieval',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/en/agentic/agent-studio/knowledge-bases/data-ingestion.html',
            label: 'Workato: Knowledge base ingestion',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpSupport: {
        value:
          'Enterprise MCP exposes governed tools to external clients with discovery, identity, and access controls.',
        shortValue: 'Yes: Enterprise MCP servers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/mcp.html',
            label: 'Workato: Enterprise MCP',
            asOf: '2026-09-04',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'Agent Studio documents skill test cases and a beta Guardrails API for chat input and output policies.',
        shortValue: 'Yes: skill tests and beta chat guardrails',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/agentic/agentic.html',
            label: 'Workato: Agent Studio',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.workato.com/workato-api/agent-studio.html',
            label: 'Workato: Agent Studio and Guardrails API',
            asOf: '2026-09-04',
          },
        ],
      },
      humanInTheLoop: {
        value:
          'Workbot can pause a recipe until a Slack user supplies a configured approval or other response.',
        shortValue: 'Yes: Workbot approval and response steps',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/workbot/wait-for-user-action.html',
            label: 'Workato: Wait for user action',
            asOf: '2026-09-04',
          },
        ],
      },
      generativeMedia: {
        value: 'The OpenAI connector includes image generation, editing, and variation actions.',
        shortValue: 'Yes: OpenAI image actions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/connectors/openai/generate-images.html',
            label: 'Workato: OpenAI image generation',
            asOf: '2026-09-04',
          },
        ],
      },
      dynamicToolUse: {
        value:
          'A Genie selects available skills and searches knowledge according to its instructions and the conversation.',
        shortValue: 'Yes: agent-selected skills and knowledge',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/en/agentic/agent-studio/ai-model/ai-model',
            label: 'Workato: AI models and BYOLLM',
            asOf: '2026-09-04',
          },
        ],
      },
      modelFallback: {
        value:
          'Automatic cross-model failover was not confirmed in the reviewed model and gateway documentation.',
        shortValue: 'Unconfirmed: automatic model fallback',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.workato.com/en/agentic/agent-studio/ai-model/ai-model',
            label: 'Workato: AI models and BYOLLM',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.workato.com/en/ai-gateway',
            label: 'Workato: AI Gateway',
            asOf: '2026-09-04',
          },
        ],
      },
      agentSkills: {
        value:
          'Skills combine prompts and recipe behavior and can be reused across Genies, projects, and MCP servers.',
        shortValue: 'Yes: reusable prompt and workflow skills',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/agentic/skills',
            label: 'Workato: Skills',
            asOf: '2026-09-04',
          },
        ],
      },
      nativeChatDeployment: {
        value: 'Genies can be used through Slack, Microsoft Teams, and Workato GO chat interfaces.',
        shortValue: 'Yes: Slack, Teams, and Workato GO',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/en/agentic/agent-studio/chat-interface/chat-interface.html',
            label: 'Workato: Genie chat interfaces',
            asOf: '2026-09-04',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          'Ingestion includes chunking, but a user-facing chunk inspection interface was not confirmed.',
        shortValue: 'Unconfirmed: chunk inspection UI',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.workato.com/en/agentic/agent-studio/knowledge-bases/data-ingestion.html',
            label: 'Workato: Knowledge base ingestion',
            asOf: '2026-09-04',
          },
        ],
      },
      parallelExecution: {
        value:
          'Asynchronous recipe functions can run independent processes in parallel, then join through Wait for async calls.',
        shortValue: 'Yes: parallel async functions with a join step',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/en/connectors/recipe-functions/actions/wait-for-async-calls',
            label: 'Workato: Wait for async calls',
            asOf: '2026-09-04',
          },
        ],
      },
      a2aProtocol: {
        value:
          'An A2A connector in the Community Library connects recipes to external agents using the Agent2Agent protocol.',
        shortValue: 'Yes: A2A community connector',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/en/connectors/a2a',
            label: 'Workato: A2A connector',
            asOf: '2026-09-04',
          },
        ],
      },
      loopIteration: {
        value: 'Recipes support list iteration, nested loops, and condition-based do-while loops.',
        shortValue: 'Yes: for-each and do-while loops',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/recipes/repeat-for-each.html',
            label: 'Workato: Repeat for each',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.workato.com/recipes/loops.html',
            label: 'Workato: Conditional loops',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value:
          'Workato describes its prebuilt connector coverage as thousands of apps, databases, and enterprise systems.',
        shortValue: 'Thousands of connected apps (vendor claim)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.workato.com/integrations',
            label: 'Workato integrations',
            asOf: '2026-09-04',
          },
        ],
      },
      triggerTypes: {
        value: 'Recipes start from configured application events, schedules, or API requests.',
        shortValue: 'App events, schedules, and API requests',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/recipes/building-recipes.html',
            label: 'Workato: Building recipes',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.workato.com/api-management.html',
            label: 'Workato: API management',
            asOf: '2026-09-04',
          },
        ],
      },
      customCodeSteps: {
        value: 'Python and JavaScript connectors execute code inside recipes.',
        shortValue: 'Yes: Python and JavaScript',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/connectors/python.html',
            label: 'Workato: Python connector',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.workato.com/connectors/javascript.html',
            label: 'Workato: JavaScript connector',
            asOf: '2026-09-04',
          },
        ],
      },
      codeSandboxRuntime: {
        value:
          'Snippet runtimes provide standard and selected libraries; user-provided packages are not supported.',
        shortValue: 'Fixed snippet runtimes; no additional packages',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/connectors/python.html',
            label: 'Workato: Python connector',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.workato.com/connectors/javascript.html',
            label: 'Workato: JavaScript connector',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Python steps have a 90-second timeout; JavaScript steps have a 30-second timeout. Both document 256 MB memory limits.',
      },
      apiPublishing: {
        value:
          'API Management publishes recipes as endpoints and manages API proxies, access policies, and usage.',
        shortValue: 'Yes: recipe APIs and API management',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/api-management.html',
            label: 'Workato: API management',
            asOf: '2026-09-04',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'The Connector SDK builds and shares custom connectors, including open-source or closed-source distributions.',
        shortValue: 'Yes: custom Connector SDK',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/developing-connectors/sdk.html',
            label: 'Workato: Connector SDK',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpPublishing: {
        value:
          'Enterprise MCP publishes recipe-backed tools and skills with client access controls.',
        shortValue: 'Yes: governed MCP tool publishing',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/mcp.html',
            label: 'Workato: Enterprise MCP',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Enterprise subscriptions combine platform editions and usage. Self-service plans use credit allowances.',
        shortValue: 'Enterprise platform/usage fees; self-service credits',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/en/pricing',
            label: 'Workato: Pricing',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.workato.com/en/pricing/self-service/self-service',
            label: 'Workato: Self-service pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      entryPaidPlan: {
        value: 'Self-service Pro starts at $75 per month with 2,500 monthly credits.',
        shortValue: 'Self-service Pro: $75/month for 2,500 credits',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/en/pricing/self-service/self-service',
            label: 'Workato: Self-service pricing',
            asOf: '2026-09-04',
          },
        ],
        detail: 'Enterprise editions and additional capabilities are quoted separately.',
      },
      freeTier: {
        value: 'The self-service Free plan includes a one-time allowance of 50,000 credits.',
        shortValue: 'Free: 50,000 one-time credits',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/en/pricing/self-service/self-service',
            label: 'Workato: Self-service pricing',
            asOf: '2026-09-04',
          },
        ],
        detail: 'This is not a recurring monthly credit allowance.',
      },
      byok: {
        value:
          'Genies can use customer connections for OpenAI, Anthropic, Azure OpenAI, and AWS Bedrock.',
        shortValue: 'Yes: Agent Studio BYOLLM',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/en/agentic/agent-studio/ai-model/ai-model',
            label: 'Workato: AI models and BYOLLM',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    security: {
      dataResidency: {
        value:
          'Enterprise regions include the US, EU, Japan, Singapore, Australia, Israel, China, South Korea, and UK.',
        shortValue: 'Multiple enterprise regions; self-service US only',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/datacenter/datacenter-overview.html',
            label: 'Workato: Data center overview',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Self-service workspaces use the US region. Features and availability vary by region.',
      },
      rbac: {
        value: 'Environment and project roles govern access, with custom roles and user groups.',
        shortValue: 'Yes: environment/project roles and custom groups',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/user-accounts-and-teams/role-based-access/access-control-v2.html',
            label: 'Workato: Environment and project access controls',
            asOf: '2026-09-04',
          },
        ],
      },
      auditLogging: {
        value:
          'Activity audit logging records workspace events and can stream job and activity data to external systems.',
        shortValue: 'Yes: activity audit logs and streaming',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/features/activity-audit-log-streaming.html',
            label: 'Workato: Activity audit log streaming',
            asOf: '2026-09-04',
          },
        ],
        detail: 'Streaming is available on specific plans.',
      },
      compliance: {
        value:
          'Workato reports SOC 1/2 Type II and SOC 3, ISO 27001/27701, PCI DSS Level 1, HIPAA attestations and BAAs, IRAP assessment, and NIST 800-171A r2 attestation.',
        shortValue: 'SOC, ISO, PCI; HIPAA/IRAP/NIST assurances',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/security/security-compliance.html',
            label: 'Workato: Security compliance',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The source describes different assurance types, not a single certification category. It describes ISO 42001 alignment separately.',
      },
      modelAndToolGovernance: {
        value:
          'AI Gateway scopes keys to provider/model routes and applies limits; Enterprise MCP governs tool access.',
        shortValue: 'Yes: model routes, scoped keys, and MCP access',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/en/ai-gateway',
            label: 'Workato: AI Gateway',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.workato.com/mcp.html',
            label: 'Workato: Enterprise MCP',
            asOf: '2026-09-04',
          },
        ],
        detail: 'AI Gateway availability depends on the plan.',
      },
      credentialGovernance: {
        value: 'Environment and project access controls govern resources including connections.',
        shortValue: 'Project/environment connection access',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/user-accounts-and-teams/role-based-access/access-control-v2.html',
            label: 'Workato: Environment and project access controls',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The reviewed access model establishes resource scope, rather than a universal claim about every credential-specific policy.',
      },
      whiteLabeling: {
        value:
          'Workato Embedded supports customizing the embedded editor’s branding and appearance.',
        shortValue: 'Yes: Embedded editor branding',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/oem/branding.html',
            label: 'Workato: Embedded branding',
            asOf: '2026-09-04',
          },
        ],
      },
      dataRetention: {
        value:
          'Job data retention is configurable; documented defaults are 30 days for Standard/Business and 90 days for Enterprise.',
        shortValue: 'Job data: 30/90-day defaults; configurable',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/security/data-protection/data-retention/',
            label: 'Workato: Data retention',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Recipe settings can disable stored job data; supported retention can be reduced to one hour.',
      },
      piiRedaction: {
        value:
          'Beta Genie guardrails can detect PII and block, anonymize, or tokenize it; recipe-step masking is a separate control.',
        shortValue: 'Yes: beta Genie PII policies and step masking',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/workato-api/agent-studio.html',
            label: 'Workato: Agent Studio and Guardrails API',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.workato.com/features/data-masking.html',
            label: 'Workato: Data masking',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'These controls have different scopes and do not establish automatic redaction of all platform data.',
      },
      sso: {
        value:
          'Workspace SSO supports SAML, just-in-time provisioning, and enforcement for members.',
        shortValue: 'Yes: SAML SSO and provisioning',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/user-accounts-and-teams/single-sign-on.html',
            label: 'Workato: Single sign-on',
            asOf: '2026-09-04',
          },
        ],
        detail: 'The workspace owner retains a password sign-in exception.',
      },
      sessionPolicy: {
        value:
          'Session timeout defaults to seven days and can be configured from 15 minutes to 14 days.',
        shortValue: 'Configurable session timeout: 15 minutes–14 days',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/security/security-faqs.html',
            label: 'Workato: Security FAQs',
            asOf: '2026-09-04',
          },
        ],
      },
      thirdPartyVetting: {
        value:
          'Community connectors require installation privileges and a review before public listing.',
        shortValue: 'Community connector review and installation controls',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/developing-connectors/community/community.html',
            label: 'Workato: Community connectors',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.workato.com/developing-connectors/community/community-listing.html',
            label: 'Workato: Contributing a connector',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The docs describe community connectors as examples and advise users to evaluate them before production use.',
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Job debug tracing exposes request/response details; the Logging Service collects configured recipe logs.',
        shortValue: 'Job debug tracing and configured recipe logs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/recipes/job-debug-tracing.html',
            label: 'Workato: Job debug tracing',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.workato.com/features/logging-service.html',
            label: 'Workato: Logging Service',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Debug tracing requires enablement. Logging Service uses explicit Logger steps and is plan-dependent.',
      },
      durabilityModel: {
        value:
          'Recipes support configured retries and rerunning jobs from their original trigger events.',
        shortValue: 'Configured retries and full-job reruns',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/recipes/best-practices-error-handling.html',
            label: 'Workato: Error handling',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.workato.com/recipes/rerun-job.html',
            label: 'Workato: Rerunning jobs',
            asOf: '2026-09-04',
          },
        ],
        detail: 'A rerun uses the current recipe version and can repeat external side effects.',
      },
      failureAlerting: {
        value:
          'Error emails notify the workspace owner by default; admins can configure recipients and throttling.',
        shortValue: 'Yes: configurable, throttled error emails',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/recipes/error-notifications.html',
            label: 'Workato: Error notifications',
            asOf: '2026-09-04',
          },
        ],
      },
      dataDrains: {
        value:
          'Plan-dependent log streaming sends job and activity data to destinations including S3, Azure, GCS, Datadog, and Splunk.',
        shortValue: 'Yes: external activity/job log streaming',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/features/activity-audit-log-streaming.html',
            label: 'Workato: Activity audit log streaming',
            asOf: '2026-09-04',
          },
        ],
      },
      asyncExecution: {
        value:
          'Recipes support asynchronous function calls, and the Jobs API provides job status and details.',
        shortValue: 'Yes: async functions and pollable Jobs API',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/connectors/recipe-functions/actions/call-recipe-function-asynchronously.html',
            label: 'Workato: Asynchronous recipe functions',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.workato.com/workato-api/jobs.html',
            label: 'Workato: Jobs API',
            asOf: '2026-09-04',
          },
        ],
      },
      executionLimits: {
        value:
          'The default active execution timeout is 90 minutes; recipe concurrency defaults to one and can be set up to 30.',
        shortValue: '90-minute default; concurrency 1–30',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/recipes/jobs.html',
            label: 'Workato: Recipe jobs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.workato.com/recipes/settings.html',
            label: 'Workato: Recipe settings',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Admins can configure execution timeout. Long actions can pause and resume a job and allow subsequent jobs to start.',
      },
      partialFailureHandling: {
        value:
          'Handle Errors blocks provide retry and On Error paths so recipes can continue with configured recovery logic.',
        shortValue: 'Yes: Handle Errors and On Error paths',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/recipes/best-practices-error-handling.html',
            label: 'Workato: Error handling',
            asOf: '2026-09-04',
          },
        ],
      },
      unattendedExecution: {
        value: 'Active recipes run as managed jobs in response to their configured triggers.',
        shortValue: 'Yes: managed background recipe execution',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/recipes/building-recipes.html',
            label: 'Workato: Building recipes',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.workato.com/recipes/jobs.html',
            label: 'Workato: Recipe jobs',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'The support agreement documents portal, email, and chat support, with coverage depending on the support plan.',
        shortValue: 'Support portal, email, and chat; plan-based coverage',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.workato.com/legal/terms-of-service',
            label: 'Workato Terms of Service and support agreement',
            asOf: '2026-09-04',
          },
        ],
      },
      sla: {
        value:
          'The support agreement defines response targets; Enterprise severity-one incidents have a one-hour response target.',
        shortValue: 'Enterprise: one-hour severity-one response target',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.workato.com/legal/terms-of-service',
            label: 'Workato Terms of Service and support agreement',
            asOf: '2026-09-04',
          },
        ],
        detail: 'This is a support response commitment, not an uptime guarantee.',
      },
      community: {
        value:
          'The Community Library enables sharing and reuse of recipes, skills, and connectors.',
        shortValue: 'Community recipes, skills, and connectors',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/community-library.html',
            label: 'Workato: Community library',
            asOf: '2026-09-04',
          },
        ],
      },
      companyMaturity: {
        value:
          'Workato lists a Palo Alto headquarters, international offices, and institutional investors.',
        shortValue: 'Established company with international offices',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.workato.com/about_us',
            label: 'About Workato',
            asOf: '2026-09-04',
          },
        ],
        detail: 'Volatile headcount, funding totals, and secondary-market valuations are omitted.',
      },
      academy: {
        value:
          'Workato Academy offers structured courses, hands-on labs, and completion certificates, including Foundations courses.',
        shortValue: 'Yes: Workato Academy courses and certificates',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/training/automation-institute.html',
            label: 'Workato: Workato Academy',
            asOf: '2026-09-04',
          },
        ],
      },
    },
  },
}
