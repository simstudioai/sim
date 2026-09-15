import { AnthropicIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Reviewed against live primary sources on 2026-09-13; undocumented capabilities remain qualified. */
export const claudeCoworkProfile: CompetitorProfile = {
  id: 'claude-cowork',
  name: 'Claude Cowork',
  website: 'https://claude.com/product/cowork',
  isWorkflowBuilder: false,
  brand: {
    icon: AnthropicIcon,
    colors: ['#CC785C', '#F0EFEA', '#141413'],
    source:
      'Public Anthropic brand assets (loftlyy.com, brandcolorcode.com aggregation of official palette)',
    asOf: '2026-07-02',
  },
  oneLiner:
    "Claude Cowork is Anthropic's conversational agent for completing tasks across files and connected apps. Cloud sessions (beta) continue across desktop, web, and mobile; local computer access depends on the Claude Desktop app being online.",
  standoutFeatures: [
    {
      title: 'Tools selected during a task',
      description: 'Claude chooses connected tools as it works toward the requested outcome.',
      shortDescription: 'Claude chooses tools while working toward a goal.',
      source: {
        url: 'https://claude.com/product/cowork',
        label: 'Claude Cowork product page',
        asOf: '2026-09-13',
      },
    },
    {
      title: 'Parallel sub-agent work',
      description: 'Cowork can divide complex work among coordinated sub-agents.',
      shortDescription: 'Coordinated sub-agents handle parts of a task in parallel.',
      source: {
        url: 'https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork',
        label: 'Get started with Claude Cowork',
        asOf: '2026-09-13',
      },
    },
    {
      title: 'Connector action controls',
      description:
        'Team and Enterprise owners can allow, require approval for, or block connector actions. Source-system permissions still apply.',
      shortDescription: 'Team and Enterprise admins can allow, gate, or block connector actions.',
      source: {
        url: 'https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities',
        label: 'Use connectors to extend Claude',
        asOf: '2026-09-13',
      },
    },
    {
      title: 'OpenTelemetry monitoring',
      description:
        'Team and Enterprise organizations can export prompts, tool calls, file access, approvals, and model-request events to an OTel collector.',
      shortDescription:
        'Team and Enterprise can stream tool, file, approval, and model events to a collector.',
      source: {
        url: 'https://support.claude.com/en/articles/14477985-monitor-claude-cowork-activity-with-opentelemetry',
        label: 'Monitor Cowork with OpenTelemetry',
        asOf: '2026-09-13',
      },
    },
    {
      title: 'Reusable plugins',
      description:
        'Plugins bundle skills, connectors, and sub-agents; Anthropic supplies templates and a Plugin Create assistant.',
      shortDescription: 'Install or customize packages of skills, connectors, and sub-agents.',
      source: {
        url: 'https://support.claude.com/en/articles/13837440-use-plugins-in-claude',
        label: 'Use plugins in Claude',
        asOf: '2026-09-13',
      },
    },
  ],
  limitations: [
    {
      title: 'Local access needs an online desktop',
      description:
        'Cloud sessions keep running remotely, but cannot access your computer when the Claude Desktop app is offline.',
      shortDescription: 'Local files and browser access depend on the desktop connection.',
      source: {
        url: 'https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview',
        label: 'Claude Cowork architecture overview',
        asOf: '2026-09-13',
      },
    },
    {
      title: 'Task scheduling has local-file constraints',
      description:
        'The scheduling guide confirms remote tasks using account files and connectors, but gives conflicting instructions about local-folder schedules; current local scheduling availability is unclear.',
      shortDescription:
        'Remote scheduling is documented; current local scheduling support is unclear.',
      source: {
        url: 'https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork',
        label: 'Schedule recurring tasks in Claude Cowork',
        asOf: '2026-09-13',
      },
    },
    {
      title: 'Session transcript APIs are read-only',
      description:
        'Enterprise Compliance API endpoints retrieve both local and remote Cowork transcripts, but neither session endpoint family supports deletion.',
      shortDescription: 'Transcript retrieval is supported; session deletion APIs are unavailable.',
      source: {
        url: 'https://platform.claude.com/docs/en/manage-claude/compliance-sessions',
        label: 'Retrieve session transcripts',
        asOf: '2026-09-13',
      },
    },
    {
      title: 'Permissions still govern real-world actions',
      description:
        'Sandbox isolation does not prevent harmful actions through tools you authorize. Anthropic documents prompt-injection risk and recommends limiting access.',
      shortDescription: 'Authorized tools can affect real files and services.',
      source: {
        url: 'https://support.claude.com/en/articles/13364135-use-claude-cowork-safely',
        label: 'Use Claude Cowork safely',
        asOf: '2026-09-13',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value: 'Conversational task agent',
        detail: 'Describe an outcome and steer Claude as it works across files and tools.',
        shortValue: 'Conversational task agent',
        confidence: 'verified',
        sources: [
          {
            url: 'https://claude.com/product/cowork',
            label: 'Claude Cowork product page',
            asOf: '2026-09-13',
          },
        ],
      },
      learningCurve: {
        value: 'Natural-language interaction',
        detail: 'No terminal is required; learning effort depends on the task and connected tools.',
        shortValue: 'No terminal required',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork',
            label: 'Get started with Claude Cowork',
            asOf: '2026-09-13',
          },
        ],
      },
      selfHostOption: {
        value: 'Anthropic-managed cloud; local desktop execution also exists',
        detail:
          'Local desktop execution is an application mode, not a documented self-hosted Cowork server distribution.',
        shortValue: 'Cloud/local desktop; self-hosted server unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview',
            label: 'Claude Cowork architecture overview',
            asOf: '2026-09-13',
          },
        ],
      },
      deploymentOptions: {
        value: 'macOS/Windows desktop, web, and mobile',
        detail:
          'Cloud sessions are in beta. Enterprise cloud availability requires administrator enablement.',
        shortValue: 'Cloud beta; desktop, web, and mobile',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork',
            label: 'Get started with Claude Cowork',
            asOf: '2026-09-13',
          },
        ],
      },
      templates: {
        value: 'Anthropic plugin templates and custom plugins',
        detail: 'Plugin Create helps users adapt templates or build a package.',
        shortValue: 'Plugin templates and customization',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13837440-use-plugins-in-claude',
            label: 'Use plugins in Claude',
            asOf: '2026-09-13',
          },
        ],
      },
      license: {
        value: 'Commercial Claude product',
        detail:
          'Cowork is included in paid Claude plans; no open-source Cowork platform license is documented.',
        shortValue: 'Commercial product; open-source license unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://claude.com/pricing',
            label: 'Claude pricing',
            asOf: '2026-09-13',
          },
        ],
      },
      environmentPromotion: {
        value: 'Not documented in the reviewed Cowork sources',
        detail:
          'Reviewed product documentation does not establish dev/test/production promotion for Cowork tasks.',
        shortValue: 'Not established in reviewed sources',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://claude.com/product/cowork',
            label: 'Claude Cowork product page',
            asOf: '2026-09-13',
          },
        ],
      },
      versionControlDepth: {
        value: 'Not documented in the reviewed Cowork sources',
        detail:
          'Task-level branching, visual diffs, and deployment rollback are not established by the reviewed documentation.',
        shortValue: 'Not established in reviewed sources',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork',
            label: 'Projects in Claude Cowork',
            asOf: '2026-09-13',
          },
        ],
      },
      realtimeCollaboration: {
        value: 'Shared projects on Team and Enterprise',
        detail:
          'Projects support view/edit access. Live concurrent editing of one task with shared cursors is not documented.',
        shortValue: 'Shared projects; live task editing unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork',
            label: 'Projects in Claude Cowork',
            asOf: '2026-09-13',
          },
        ],
      },
      nativeFileStorage: {
        value: 'Cloud files and project workspaces',
        detail:
          'Cloud projects persist with the Claude account; local-folder projects remain on that device. Folder sharing and recovery parity are unverified.',
        shortValue: 'Cloud/local files; recovery controls unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork',
            label: 'Projects in Claude Cowork',
            asOf: '2026-09-13',
          },
        ],
      },
      dataTables: {
        value: 'Not documented in the reviewed Cowork sources',
        detail:
          'Cowork creates and works with spreadsheets; a persistent native database-table object is not established.',
        shortValue: 'Not established in reviewed sources',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork',
            label: 'Get started with Claude Cowork',
            asOf: '2026-09-13',
          },
        ],
      },
      richTextEditor: {
        value: 'AI-assisted inline Markdown editing',
        detail:
          'Select draft text and request an in-place change with Edit with Claude. Full manual WYSIWYG editing is unverified.',
        shortValue: 'AI-assisted Markdown; full WYSIWYG unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork',
            label: 'Get started with Claude Cowork',
            asOf: '2026-09-13',
          },
        ],
      },
      subWorkflows: {
        value: 'Not documented in the reviewed Cowork sources',
        detail:
          'Sub-agent delegation is documented; invoking one saved task as a typed sub-workflow is not established.',
        shortValue: 'Not established in reviewed sources',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork',
            label: 'Get started with Claude Cowork',
            asOf: '2026-09-13',
          },
        ],
      },
      customBlocks: {
        value: 'Reusable skills and plugins',
        detail:
          'These package agent instructions and capabilities; they are not documented as published workflow blocks with generated input/output contracts.',
        shortValue: 'Skills/plugins; workflow block publishing unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13837440-use-plugins-in-claude',
            label: 'Use plugins in Claude',
            asOf: '2026-09-13',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value: 'Claude model selection',
        detail:
          'The reviewed Cowork materials document Claude models, without a third-party model-provider selector.',
        shortValue: 'Claude models; third-party providers unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://claude.com/pricing',
            label: 'Claude pricing',
            asOf: '2026-09-13',
          },
        ],
      },
      agentReasoningBlocks: {
        value: 'Agentic planning and execution',
        detail:
          'Cowork undertakes multi-step work; this is a task agent rather than a configurable reasoning node.',
        shortValue: 'Agentic planning and execution',
        confidence: 'verified',
        sources: [
          {
            url: 'https://claude.com/product/cowork',
            label: 'Claude Cowork product page',
            asOf: '2026-09-13',
          },
        ],
      },
      naturalLanguageBuilding: {
        value: 'Yes: describe the desired task',
        detail: 'Natural-language instructions define the work Claude should perform.',
        shortValue: 'Tasks defined in natural language',
        confidence: 'verified',
        sources: [
          {
            url: 'https://claude.com/product/cowork',
            label: 'Claude Cowork product page',
            asOf: '2026-09-13',
          },
        ],
      },
      knowledgeBaseRag: {
        value: 'Project files, context, and memory',
        detail:
          'Project memory carries context between related tasks. A configurable embedding/vector-store pipeline is not established.',
        shortValue: 'Project files/memory; RAG controls unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork',
            label: 'Projects in Claude Cowork',
            asOf: '2026-09-13',
          },
        ],
      },
      mcpSupport: {
        value: 'Yes: connectors and custom MCP servers',
        detail:
          'Connectors retrieve data and perform actions subject to source-system permissions.',
        shortValue: 'Connectors and custom MCP',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities',
            label: 'Use connectors to extend Claude',
            asOf: '2026-09-13',
          },
        ],
      },
      evaluationGuardrails: {
        value: 'Safety controls and content safeguards',
        detail:
          'Anthropic documents prompt-injection defenses and permissions; a task-evaluation suite is not established here.',
        shortValue: 'Safety controls; task eval suite unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13364135-use-claude-cowork-safely',
            label: 'Use Claude Cowork safely',
            asOf: '2026-09-13',
          },
        ],
      },
      humanInTheLoop: {
        value: 'Yes: tool approvals and administrator controls',
        detail:
          'Admins configure tool approvals. Help Center documentation describes controls for execution without per-call prompts, but the third-party feature comparison says Enterprise Auto/Skip modes are unavailable; current Enterprise availability is unresolved.',
        shortValue: 'Configurable tool approvals',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview',
            label: 'Claude Cowork architecture overview',
            asOf: '2026-09-13',
          },
          {
            url: 'https://support.claude.com/en/articles/13455879-use-claude-cowork-on-team-and-enterprise-plans',
            label: 'Cowork on Team and Enterprise plans',
            asOf: '2026-09-13',
          },
          {
            url: 'https://claude.com/docs/third-party/claude-desktop/feature-matrix',
            label: 'Claude Desktop on third-party platforms: Features',
            asOf: '2026-09-13',
          },
        ],
      },
      generativeMedia: {
        value: 'Not documented in the reviewed Cowork sources',
        detail:
          'The reviewed Cowork documentation does not establish native image, video, or audio generation blocks.',
        shortValue: 'Not established in reviewed sources',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://claude.com/product/cowork',
            label: 'Claude Cowork product page',
            asOf: '2026-09-13',
          },
        ],
      },
      dynamicToolUse: {
        value: 'Yes: Claude selects connected apps when relevant',
        detail: 'Users need not name a connected app on every request.',
        shortValue: 'Runtime selection of connected apps',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities',
            label: 'Use connectors to extend Claude',
            asOf: '2026-09-13',
          },
        ],
      },
      modelFallback: {
        value: 'Not documented in the reviewed Cowork sources',
        detail:
          'Automatic failover after a Cowork model error or rate limit is not established. Safety-triggered model switching is separately documented for supported Claude models.',
        shortValue: 'Error/rate-limit failover unverified',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork',
            label: 'Get started with Claude Cowork',
            asOf: '2026-09-13',
          },
          {
            url: 'https://support.claude.com/en/articles/16049681-why-claude-switched-models-in-your-conversation-with-opus-5',
            label: 'Why Claude switched models in your conversation with Opus 5',
            asOf: '2026-09-13',
          },
        ],
      },
      agentSkills: {
        value: 'Yes: reusable skills supplied through plugins',
        detail:
          'Skills can be invoked in chat and Cowork; plugin hooks and sub-agents run in Cowork.',
        shortValue: 'Reusable skills and plugin packages',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13837440-use-plugins-in-claude',
            label: 'Use plugins in Claude',
            asOf: '2026-09-13',
          },
        ],
      },
      nativeChatDeployment: {
        value: 'Not documented in the reviewed Cowork sources',
        detail:
          'Public deployment of a configured Cowork task as an embeddable chat agent is not established.',
        shortValue: 'Not established in reviewed sources',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://claude.com/product/cowork',
            label: 'Claude Cowork product page',
            asOf: '2026-09-13',
          },
        ],
      },
      kbChunkVisibility: {
        value: 'Not documented in the reviewed Cowork sources',
        detail:
          'Reviewed project documentation does not establish a retrieval-chunk inspection interface.',
        shortValue: 'Not established in reviewed sources',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/14116274-organize-your-tasks-with-projects-in-claude-cowork',
            label: 'Projects in Claude Cowork',
            asOf: '2026-09-13',
          },
        ],
      },
      parallelExecution: {
        value: 'Yes: coordinated parallel workstreams',
        detail:
          'Claude can split a task among sub-agents; Cowork-specific concurrency limits are not stated.',
        shortValue: 'Parallel sub-agent workstreams',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork',
            label: 'Get started with Claude Cowork',
            asOf: '2026-09-13',
          },
        ],
      },
      a2aProtocol: {
        value: 'Not documented in the reviewed Cowork sources',
        detail:
          'The reviewed Cowork integration documentation establishes MCP, not native A2A peer-protocol support.',
        shortValue: 'Not established in reviewed sources',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities',
            label: 'Use connectors to extend Claude',
            asOf: '2026-09-13',
          },
        ],
      },
      loopIteration: {
        value: 'Not documented in the reviewed Cowork sources',
        detail:
          'A configurable for-each/while workflow container is not established in the reviewed product materials.',
        shortValue: 'Not established in reviewed sources',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://claude.com/product/cowork',
            label: 'Claude Cowork product page',
            asOf: '2026-09-13',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value: 'Connector directory plus custom MCP',
        detail: 'The reviewed connector guide gives examples but no authoritative total.',
        shortValue: 'Directory and custom MCP; count unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities',
            label: 'Use connectors to extend Claude',
            asOf: '2026-09-13',
          },
        ],
      },
      triggerTypes: {
        value: 'User requests and scheduled tasks',
        detail:
          'The guide lists hourly, daily, weekly, weekday, and manual cadences. An inbound task-trigger webhook is unverified.',
        shortValue: 'Manual/scheduled; inbound webhooks unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork',
            label: 'Schedule recurring tasks in Claude Cowork',
            asOf: '2026-09-13',
          },
        ],
      },
      customCodeSteps: {
        value: 'Agent-executed code and shell commands',
        detail:
          'Cloud tasks run code in a temporary sandbox; existing local sessions use an isolated Linux VM for code execution.',
        shortValue: 'Agent-executed code in a sandbox',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview',
            label: 'Claude Cowork architecture overview',
            asOf: '2026-09-13',
          },
        ],
      },
      codeSandboxRuntime: {
        value: 'Temporary cloud sandboxes or local Linux VMs',
        detail:
          'Administrators configure network-access policy. A user-declared Cowork base image or package manifest is not established.',
        shortValue: 'Sandboxes; custom runtime manifests unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview',
            label: 'Claude Cowork architecture overview',
            asOf: '2026-09-13',
          },
        ],
      },
      apiPublishing: {
        value: 'Not documented in the reviewed Cowork sources',
        detail:
          'The reviewed product page does not establish publishing Cowork tasks as callable API endpoints.',
        shortValue: 'Not established in reviewed sources',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://claude.com/product/cowork',
            label: 'Claude Cowork product page',
            asOf: '2026-09-13',
          },
        ],
      },
      extensibilitySdk: {
        value: 'Skills, plugins, and MCP connectors',
        detail:
          'Custom plugins can be authored from Anthropic templates and the documented plugin format.',
        shortValue: 'Plugin authoring and MCP',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13837440-use-plugins-in-claude',
            label: 'Use plugins in Claude',
            asOf: '2026-09-13',
          },
        ],
      },
      mcpPublishing: {
        value: 'Not documented in the reviewed Cowork sources',
        detail:
          'Consuming MCP connectors is documented; publishing a Cowork task as an MCP server is not established.',
        shortValue: 'Not established in reviewed sources',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities',
            label: 'Use connectors to extend Claude',
            asOf: '2026-09-13',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value: 'Paid Claude plans, or provider-billed desktop deployment',
        detail:
          'Standard Claude plans have plan-dependent usage limits and charges. Claude Desktop on third-party platforms includes Cowork with token-based provider billing and no seat licensing.',
        shortValue: 'Claude plans or provider-billed desktop',
        confidence: 'verified',
        sources: [
          {
            url: 'https://claude.com/pricing',
            label: 'Claude pricing',
            asOf: '2026-09-13',
          },
          {
            url: 'https://claude.com/docs/third-party/claude-desktop/feature-matrix',
            label: 'Claude Desktop on third-party platforms: Features',
            asOf: '2026-09-13',
          },
        ],
      },
      entryPaidPlan: {
        value: 'Pro: $20/month, or $200 billed annually',
        detail:
          'The pricing page displays the annual offer as $17/month. Prices exclude applicable taxes.',
        shortValue: 'Pro: $20 monthly or $200 annually',
        confidence: 'verified',
        sources: [
          {
            url: 'https://claude.com/pricing',
            label: 'Claude pricing',
            asOf: '2026-09-13',
          },
        ],
      },
      freeTier: {
        value: 'Cowork is not included in Free',
        detail: 'The pricing comparison explicitly lists Cowork for Pro and Max, not Free.',
        shortValue: 'Unavailable on Claude Free',
        confidence: 'verified',
        sources: [
          {
            url: 'https://claude.com/pricing',
            label: 'Claude pricing',
            asOf: '2026-09-13',
          },
        ],
      },
      byok: {
        value: 'Yes, in Claude Desktop third-party deployment mode',
        detail:
          'Claude Desktop third-party deployment mode supports a supplied Anthropic API key or gateway key. This is separate from the standard Cowork cloud-session subscription.',
        shortValue: 'BYOK through configured desktop deployment',
        confidence: 'verified',
        sources: [
          {
            url: 'https://claude.com/docs/third-party/claude-desktop/overview',
            label: 'Claude Desktop on third-party platforms: Overview',
            asOf: '2026-09-13',
          },
          {
            url: 'https://claude.com/docs/third-party/claude-desktop/claude-api',
            label: 'Deploy Claude Desktop on 3P with the Claude API',
            asOf: '2026-09-13',
          },
          {
            url: 'https://claude.com/docs/third-party/claude-desktop/gateway',
            label: 'Deploy Claude Desktop on 3P with an LLM gateway',
            asOf: '2026-09-13',
          },
        ],
      },
    },
    security: {
      dataResidency: {
        value: 'US-only inference on usage-based Enterprise plans',
        detail:
          'The setting covers Claude apps. It does not control data storage or third-party connector processing.',
        shortValue: 'Enterprise US-only inference option',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/15422948-enable-us-only-inference-for-your-organization',
            label: 'Enable US-only inference',
            asOf: '2026-09-13',
          },
        ],
      },
      rbac: {
        value: 'Enterprise custom roles and groups',
        detail:
          'Roles grant capabilities and administrative permissions. Team uses organization-wide Cowork access controls.',
        shortValue: 'Enterprise custom roles',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13930452-manage-custom-roles-on-enterprise-plans',
            label: 'Manage custom roles on Enterprise plans',
            asOf: '2026-09-13',
          },
          {
            url: 'https://support.claude.com/en/articles/13455879-use-claude-cowork-on-team-and-enterprise-plans',
            label: 'Cowork on Team and Enterprise plans',
            asOf: '2026-09-13',
          },
        ],
      },
      auditLogging: {
        value: 'Enterprise Compliance API plus Team/Enterprise OTel',
        detail:
          'Compliance endpoints retrieve local and remote Cowork session transcripts. OTel provides operational events.',
        shortValue: 'Enterprise transcripts; Team/Enterprise operational events',
        confidence: 'verified',
        sources: [
          {
            url: 'https://platform.claude.com/docs/en/manage-claude/compliance-api',
            label: 'Claude Compliance API',
            asOf: '2026-09-13',
          },
          {
            url: 'https://support.claude.com/en/articles/14477985-monitor-claude-cowork-activity-with-opentelemetry',
            label: 'Monitor Cowork with OpenTelemetry',
            asOf: '2026-09-13',
          },
        ],
      },
      compliance: {
        value:
          'Anthropic commercial-product credentials: SOC 2 Type I/II, ISO 27001:2022, ISO/IEC 42001:2023; HIPAA-ready configuration',
        detail:
          'These are published commercial-product credentials, not a separate Cowork certification. Confirm product/configuration scope and BAA coverage in Anthropic compliance documents.',
        shortValue: 'Commercial-product SOC 2 and ISO; scoped HIPAA offering',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/10015870-what-certifications-has-anthropic-obtained',
            label: 'Anthropic compliance credentials',
            asOf: '2026-09-13',
          },
        ],
      },
      modelAndToolGovernance: {
        value: 'Enterprise model and connector permissions',
        detail:
          'Enterprise custom roles control Claude models (except always-available Haiku), effort, and organization connectors/tools under organization-wide limits. These connector policies exclude locally run connectors and third-party Cowork deployments.',
        shortValue: 'Model and per-tool role controls',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13930452-manage-custom-roles-on-enterprise-plans',
            label: 'Manage custom roles on Enterprise plans',
            asOf: '2026-09-13',
          },
        ],
      },
      credentialGovernance: {
        value: 'Connector/tool permissions; individual credential ACLs unverified',
        detail:
          'Connector authorization inherits source permissions. Per-role control of separately named credential instances is not established.',
        shortValue: 'Connector controls; credential-instance ACLs unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13930452-manage-custom-roles-on-enterprise-plans',
            label: 'Manage custom roles on Enterprise plans',
            asOf: '2026-09-13',
          },
          {
            url: 'https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities',
            label: 'Use connectors to extend Claude',
            asOf: '2026-09-13',
          },
        ],
      },
      whiteLabeling: {
        value: 'Organization branding on Team and Enterprise',
        detail:
          'Owners can configure company branding in Cowork. Full replacement of Claude product identity is not established.',
        shortValue: 'Organization branding; full white-label scope unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13455879-use-claude-cowork-on-team-and-enterprise-plans',
            label: 'Cowork on Team and Enterprise plans',
            asOf: '2026-09-13',
          },
        ],
      },
      dataRetention: {
        value: 'Enterprise retention varies by record type',
        detail:
          'Conversation/project controls have a 30-day minimum. Captured local transcripts default to six years or a finite custom conversation period; remote transcripts retain six years unless users delete them. On-device history is outside standard retention; session APIs cannot delete either transcript type.',
        shortValue: 'Retention differs for device history and transcripts',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://privacy.claude.com/en/articles/10440198-configure-custom-data-retention-controls-for-enterprise-plans',
            label: 'Enterprise data retention controls',
            asOf: '2026-09-13',
          },
          {
            url: 'https://support.claude.com/en/articles/13455879-use-claude-cowork-on-team-and-enterprise-plans',
            label: 'Cowork on Team and Enterprise plans',
            asOf: '2026-09-13',
          },
          {
            url: 'https://platform.claude.com/docs/en/manage-claude/compliance-sessions',
            label: 'Retrieve session transcripts',
            asOf: '2026-09-13',
          },
        ],
      },
      piiRedaction: {
        value: 'Enterprise inference hooks for custom DLP enforcement',
        detail:
          'Beta hooks inspect prompts, tool responses, and uploaded-file text through a customer-hosted allow/deny service. Built-in automatic PII masking is unverified.',
        shortValue: 'Custom DLP hooks; automatic PII masking unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/16059458-inference-hooks-overview',
            label: 'Inference hooks overview',
            asOf: '2026-09-13',
          },
        ],
      },
      sso: {
        value: 'SSO on Team and Enterprise; SCIM on Enterprise',
        detail:
          'SSO uses the organization identity provider. Provisioning availability depends on plan.',
        shortValue: 'SSO; Enterprise SCIM',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13132885-set-up-single-sign-on-sso',
            label: 'Set up single sign-on',
            asOf: '2026-09-13',
          },
          {
            url: 'https://claude.com/pricing',
            label: 'Claude pricing',
            asOf: '2026-09-13',
          },
        ],
      },
      sessionPolicy: {
        value: 'Enterprise absolute session limit: 1, 7, 14, or 28 days',
        detail:
          'The limit applies despite activity. Across organizations, the shortest setting wins. An administrator-configurable idle timeout is not documented.',
        shortValue: 'Enterprise absolute session lifetime controls',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13163631-configuring-session-security-settings',
            label: 'Session security settings',
            asOf: '2026-09-13',
          },
        ],
      },
      thirdPartyVetting: {
        value: 'Curated plugins plus optional Enterprise security scanning',
        detail:
          'Scanning can block malicious uploads/edits but is off by default; exclusions include MCP servers, hooks, existing installs, and specified protected configurations.',
        shortValue: 'Curated catalogs; optional Enterprise scanning',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/15927065-get-started-with-skill-and-plugin-scanning',
            label: 'Skill and plugin scanning',
            asOf: '2026-09-13',
          },
          {
            url: 'https://support.claude.com/en/articles/13837440-use-plugins-in-claude',
            label: 'Use plugins in Claude',
            asOf: '2026-09-13',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value: 'Team/Enterprise OTel events for prompts, tools, files, approvals, and API requests',
        detail:
          'Events include timing, outcomes, token counts, and estimated cost; prompt IDs link related activity.',
        shortValue: 'Team/Enterprise OTel activity events',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/14477985-monitor-claude-cowork-activity-with-opentelemetry',
            label: 'Monitor Cowork with OpenTelemetry',
            asOf: '2026-09-13',
          },
        ],
      },
      durabilityModel: {
        value: 'Cloud work continues without the client',
        detail:
          'This establishes remote execution, not a documented automatic crash-replay or exactly-once recovery guarantee.',
        shortValue: 'Cloud execution; recovery guarantees unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork',
            label: 'Get started with Claude Cowork',
            asOf: '2026-09-13',
          },
        ],
      },
      failureAlerting: {
        value: 'Team/Enterprise: build alerts from exported OTel events',
        detail:
          'Anthropic documents using existing monitoring pipelines for dashboards and alerts. A native Cowork failure notification guarantee is unverified.',
        shortValue: 'Team/Enterprise alerts through your monitoring pipeline',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/14477985-monitor-claude-cowork-activity-with-opentelemetry',
            label: 'Monitor Cowork with OpenTelemetry',
            asOf: '2026-09-13',
          },
        ],
      },
      dataDrains: {
        value: 'Team/Enterprise OTel streaming and Enterprise Compliance API',
        detail:
          'Operational events stream to a configured collector; compliance endpoints provide programmatic activity and session access.',
        shortValue: 'Team/Enterprise OTel; Enterprise Compliance API',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/14477985-monitor-claude-cowork-activity-with-opentelemetry',
            label: 'Monitor Cowork with OpenTelemetry',
            asOf: '2026-09-13',
          },
          {
            url: 'https://platform.claude.com/docs/en/manage-claude/compliance-api',
            label: 'Claude Compliance API',
            asOf: '2026-09-13',
          },
        ],
      },
      asyncExecution: {
        value: 'Yes: cloud sessions continue while you step away',
        detail: 'Local file/browser access still requires an online desktop connection.',
        shortValue: 'Cloud background execution',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork',
            label: 'Get started with Claude Cowork',
            asOf: '2026-09-14',
          },
          {
            url: 'https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile',
            label: 'Use Claude Cowork on web, desktop, and mobile',
            asOf: '2026-09-14',
          },
        ],
      },
      executionLimits: {
        value: 'Not documented in the reviewed Cowork sources',
        detail:
          'Cowork-specific maximum task duration and concurrent-task ceilings are not established. Claude Code retry/timeouts must not be treated as Cowork limits.',
        shortValue: 'Not established in reviewed sources',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork',
            label: 'Get started with Claude Cowork',
            asOf: '2026-09-13',
          },
        ],
      },
      partialFailureHandling: {
        value: 'Not documented in the reviewed Cowork sources',
        detail:
          'Parallel delegation is documented, but per-branch error routing and recovery semantics are not established for Cowork.',
        shortValue: 'Not established in reviewed sources',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork',
            label: 'Get started with Claude Cowork',
            asOf: '2026-09-13',
          },
        ],
      },
      unattendedExecution: {
        value: 'Yes: remote scheduled tasks',
        detail:
          'Remote schedules run with no device online and use account files/connectors. The guide both excludes local-folder schedules and describes local-only execution, leaving current local scheduling availability unclear.',
        shortValue: 'Remote schedules; local scheduling availability unclear',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork',
            label: 'Schedule recurring tasks in Claude Cowork',
            asOf: '2026-09-13',
          },
          {
            url: 'https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile',
            label: 'Use Claude Cowork on web, desktop, and mobile',
            asOf: '2026-09-13',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value: 'Support messenger and email; access varies by plan and role',
        detail:
          'Pro/Max and eligible organization contacts can reach human support. Anthropic does not offer phone or live chat support.',
        shortValue: 'Messenger/email with plan-dependent human support',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/9015913-how-to-get-support',
            label: 'How to get Claude support',
            asOf: '2026-09-13',
          },
        ],
      },
      sla: {
        value: 'Not documented in the reviewed Cowork sources',
        detail:
          'The reviewed pricing and support documentation does not establish a Cowork-specific contractual uptime or response-time SLA.',
        shortValue: 'Not established in reviewed sources',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/9015913-how-to-get-support',
            label: 'How to get Claude support',
            asOf: '2026-09-13',
          },
        ],
      },
      community: {
        value: 'Claude Community events, Discord, and Reddit',
        detail: 'Anthropic links online communities and an ambassador-led events program.',
        shortValue: 'Events, Discord, and Reddit',
        confidence: 'verified',
        sources: [
          {
            url: 'https://claude.com/community',
            label: 'Claude Community',
            asOf: '2026-09-13',
          },
        ],
      },
      companyMaturity: {
        value: 'Anthropic product; general availability announced April 9, 2026',
        detail:
          'The announcement made Cowork available across paid plans with enterprise controls.',
        shortValue: 'Generally available since April 2026',
        confidence: 'verified',
        sources: [
          {
            url: 'https://claude.com/blog/cowork-for-enterprise',
            label: 'Cowork general availability and enterprise controls',
            asOf: '2026-09-13',
          },
        ],
      },
      academy: {
        value: 'Claude Academy',
        detail: 'Official learning resources cover working and building with Claude.',
        shortValue: 'Official Claude Academy',
        confidence: 'verified',
        sources: [
          {
            url: 'https://academy.claude.com/',
            label: 'Claude Academy',
            asOf: '2026-09-13',
          },
        ],
      },
    },
  },
  oneLinerSources: [
    {
      url: 'https://claude.com/product/cowork',
      label: 'Claude Cowork product page',
      asOf: '2026-09-13',
    },
    {
      url: 'https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview',
      label: 'Claude Cowork architecture overview',
      asOf: '2026-09-13',
    },
    {
      url: 'https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile',
      label: 'Use Claude Cowork on web, desktop, and mobile',
      asOf: '2026-09-13',
    },
  ],
}
