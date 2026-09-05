import { MicrosoftCopilotIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Reviewed against current primary sources on 2026-09-04; unresolved claims remain qualified. */
export const microsoftCopilotProfile: CompetitorProfile = {
  id: 'microsoft-copilot',
  name: 'Microsoft Copilot Studio',
  website: 'https://www.microsoft.com/en-us/microsoft-365-copilot/microsoft-copilot-studio',
  brand: {
    icon: MicrosoftCopilotIcon,
    selfFramed: true,
    colors: ['#0736c4', '#8c48ff', '#00e5cc'],
    source: 'Official brand guidelines',
    asOf: '2026-07-02',
  },
  oneLiner:
    'Microsoft Copilot Studio is a low-code service for building and publishing conversational and autonomous agents, with generative orchestration, knowledge sources, connectors, and deterministic agent flows.',
  standoutFeatures: [
    {
      title: 'Microsoft compliance coverage',
      description:
        'Microsoft lists SOC, ISO, HIPAA BAA, HITRUST, PCI DSS and other programs for Copilot Studio. Applicable government services have FedRAMP coverage; report, cloud, feature and contractual scope must be checked.',
      shortDescription: 'Documented compliance programs, with cloud and contract scope.',
      source: {
        url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/admin-certification',
        label: 'Review ISO, SOC, and HIPAA compliance - Microsoft Copilot Studio | Microsoft Learn',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Generative orchestration',
      description:
        'Agents can choose among configured topics, tools, knowledge sources and other agents to carry out a request. Makers describe those capabilities and govern which are available.',
      shortDescription: 'Agents select configured tools, topics and knowledge at runtime.',
      source: {
        url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/generative-orchestration',
        label:
          'Apply generative orchestration capabilities - Microsoft Copilot Studio | Microsoft Learn',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Multiple model choices',
      description:
        'The model picker includes OpenAI and external models, with availability varying by model, region and release status. The default model is used if the selected model is disabled or unavailable.',
      shortDescription: 'Model selection with a documented default-model fallback.',
      source: {
        url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-select-agent-model',
        label:
          'Select a primary AI model for your agent - Microsoft Copilot Studio | Microsoft Learn',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Session monitoring',
      description:
        'The new agent experience provides session status, duration, message counts, tool usage and conversation transcripts. These views help makers investigate failed interactions.',
      shortDescription: 'Session transcripts and tool usage support troubleshooting.',
      source: {
        url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-experience/analytics-overview',
        label:
          'Monitor an agent overview - Microsoft Copilot Studio (GitHub Copilot) | Microsoft Learn',
        asOf: '2026-09-04',
      },
    },
  ],
  limitations: [
    {
      title: 'Usage depends on the capabilities invoked',
      description:
        'Copilot Credits meter answers, actions, grounding, flows and AI tools at different rates. Bring-your-own-model deployments have separate billing, and included Microsoft 365 Copilot usage has specific eligibility conditions.',
      shortDescription: 'Estimate credits across features and separately billed models.',
      source: {
        url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-messages-management',
        label: 'Billing rates and management - Microsoft Copilot Studio | Microsoft Learn',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Environment promotion needs additional configuration',
      description:
        'Solutions and pipelines support deployment, but channel settings, sharing, manual authentication and Application Insights settings require post-deployment steps.',
      shortDescription:
        'Some channel, authentication and monitoring settings need post-deployment setup.',
      source: {
        url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/alm',
        label:
          'Establish an Application Lifecycle Management (ALM) strategy - Microsoft Copilot Studio | Microsoft Learn',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Flows called by an agent have a response deadline',
      description:
        'A flow added as an agent tool must respond synchronously within 100 seconds. Its Respond to the agent action must have asynchronous response turned off.',
      shortDescription: 'Agent-invoked flows must respond within 100 seconds.',
      source: {
        url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/flow-agent',
        label:
          'Add an agent flow as a tool to an agent - Microsoft Copilot Studio | Microsoft Learn',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Model availability and residency vary',
      description:
        'Some models are previews or experiments; cross-geo models can process data outside the environment region. Microsoft recommends generally available models for production use.',
      shortDescription: 'Check model release status, region and cross-geo processing.',
      source: {
        url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-select-agent-model',
        label:
          'Select a primary AI model for your agent - Microsoft Copilot Studio | Microsoft Learn',
        asOf: '2026-09-04',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value: 'Low-code agent builder with topics, generative orchestration and agent flows',
        detail:
          'Agents use configured capabilities to respond or act; agent flows provide explicit trigger/action sequences.',
        shortValue: 'Topics, generative agents and deterministic flows',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/fundamentals-what-is-copilot-studio',
            label: 'Overview - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/flows-overview',
            label: 'Agent flows overview - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      learningCurve: {
        value:
          'Natural-language authoring lowers the starting barrier; production governance and deployment require additional design',
        detail:
          'This is an editorial assessment based on Microsoft guidance for instructions, environments, solutions and deployment pipelines.',
        shortValue: 'Accessible authoring; production setup takes planning',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/generative-mode-guidance',
            label:
              'Configure high-quality instructions for generative orchestration - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/alm',
            label:
              'Establish an Application Lifecycle Management (ALM) strategy - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      selfHostOption: {
        value:
          'Microsoft-operated online service; a customer-hosted core runtime is not established by the reviewed documentation',
        detail:
          'The documented government deployment also uses Microsoft cloud infrastructure. Connecting to local data does not establish a self-hosted agent service.',
        shortValue: 'Microsoft cloud; self-hosting not confirmed',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/admin-certification',
            label:
              'Review ISO, SOC, and HIPAA compliance - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-licensing-gcc',
            label: 'US Government customers - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      deploymentOptions: {
        value:
          'Microsoft cloud environments, including documented GCC and GCC High government plans',
        detail:
          'Eligibility and feature availability differ by cloud; the government feature table excludes autonomous triggers in GCC and GCC High.',
        shortValue: 'Commercial and government cloud options',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-licensing-gcc',
            label: 'US Government customers - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      templates: {
        value: 'Agent templates and an Agent Library provide customizable starting points',
        detail:
          'Templates provide predefined capabilities that makers configure for their environment.',
        shortValue: 'Agent templates and library',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/agent-library-overview',
            label:
              'Configure and deploy agents from the Agent Library - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/template-fundamentals',
            label:
              'Create a custom agent from a template - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      license: {
        value: 'Commercial Microsoft service licensed for organizations and makers',
        detail:
          'Tenant and user licensing governs access; trial licenses allow building and testing but not publishing.',
        shortValue: 'Proprietary commercial service',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-licensing',
            label:
              'Assign user licenses and manage access - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      environmentPromotion: {
        value:
          'Solutions, environment variables and deployment pipelines support promotion between environments',
        detail:
          'Microsoft recommends separate development, test and production environments. Some authentication, channel, sharing and telemetry settings need post-deployment configuration.',
        shortValue: 'Solutions and pipelines for dev/test/production',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/alm',
            label:
              'Establish an Application Lifecycle Management (ALM) strategy - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      versionControlDepth: {
        value: 'Solution-based source control and deployment, including native Git integration',
        detail:
          'The reviewed guidance documents source control and pipeline options; it does not establish a universal agent-level visual diff and rollback experience across all agent types.',
        shortValue: 'Git integration and solution-based lifecycle management',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/alm',
            label:
              'Establish an Application Lifecycle Management (ALM) strategy - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      realtimeCollaboration: {
        value: 'Shared authoring is supported; simultaneous cursor-level editing is not confirmed',
        detail:
          'Collaborators can edit, configure and publish agents. The Teams experience can show who is editing a topic, which does not by itself establish synchronized concurrent editing.',
        shortValue: 'Shared authoring; live canvas editing unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/admin-share-bots',
            label: 'Share agents with other users - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      nativeFileStorage: {
        value:
          'Files can be uploaded as knowledge; a general folder/share/recycle-bin file manager is not confirmed',
        detail:
          'The documented storage includes files uploaded to Dataverse and connections to SharePoint and OneDrive.',
        shortValue: 'Knowledge uploads; full file manager unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/knowledge-copilot-studio',
            label: 'Knowledge sources summary - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      dataTables: {
        value: 'Dataverse provides structured tables shared across Power Platform',
        detail:
          'Dataverse supports rows, columns, relationships, security and Excel integration. This is a shared data service rather than evidence of a spreadsheet editor inside the Copilot Studio canvas.',
        shortValue: 'Dataverse tables',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-apps/maker/data-platform/data-platform-intro',
            label: 'What is Microsoft Dataverse? - Power Apps | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      richTextEditor: {
        value: 'An inline WYSIWYG document editor is not confirmed',
        detail:
          'The reviewed skills documentation describes Markdown instruction files, not a general document-editing workspace.',
        shortValue: 'Document editor unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-experience/skills-overview',
            label:
              'Skills overview for agents - Microsoft Copilot Studio (GitHub Copilot) | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      subWorkflows: {
        value: 'Agent flows include child-flow actions for reuse',
        detail:
          'The agent-flow action catalog includes child flows alongside looping, branching and data operations.',
        shortValue: 'Child flows',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/flows-overview',
            label: 'Agent flows overview - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      customBlocks: {
        value: 'Reusable agent components, agent-flow tools and connected agents',
        detail:
          'Component collections share topics, knowledge, actions and entities across agents; published flows can be added as tools. This is not confirmation of an organization-wide workflow block publishing interface.',
        shortValue: 'Reusable components, flows and agents',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/alm',
            label:
              'Establish an Application Lifecycle Management (ALM) strategy - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/flow-agent',
            label:
              'Add an agent flow as a tool to an agent - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'OpenAI and external model choices; supported Foundry models can also power individual prompts',
        detail:
          'The model picker documents Anthropic, xAI and Mistral options with region and release-status limits. Foundry prompt connections support chat-completion endpoints and have model-specific exclusions.',
        shortValue: 'Multiple models; availability varies',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-select-agent-model',
            label:
              'Select a primary AI model for your agent - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/bring-your-own-model-prompts',
            label:
              'Bring your own model for your prompts - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      agentReasoningBlocks: {
        value: 'Generative orchestration and models suited to multistep reasoning',
        detail:
          'The orchestrator selects configured capabilities. Model availability and production readiness vary; the separate deep-reasoning feature remains documented as preview.',
        shortValue: 'Generative planning and reasoning models',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/generative-orchestration',
            label:
              'Apply generative orchestration capabilities - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-select-agent-model',
            label:
              'Select a primary AI model for your agent - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-reasoning-models',
            label:
              'Add a deep reasoning model for complex tasks (preview) - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      naturalLanguageBuilding: {
        value: 'Natural-language descriptions assist agent and topic creation',
        detail: 'Makers describe intended behavior and refine generated agent configuration.',
        shortValue: 'Natural-language agent authoring',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/nlu-gpt-overview',
            label: 'AI-based agent authoring overview - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          'Knowledge grounding from websites, uploaded files, SharePoint, Dataverse and supported connectors',
        detail:
          'Supported sources, authentication, limits and citation behavior vary by source and orchestration mode.',
        shortValue: 'Knowledge sources and retrieval-based answers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/knowledge-copilot-studio',
            label: 'Knowledge sources summary - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpSupport: {
        value: 'Agents can connect to existing MCP servers',
        detail:
          'The documented connection supports Streamable transport and authentication configuration; SSE is no longer supported.',
        shortValue: 'MCP client support',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent',
            label:
              'Connect your agent to an existing Model Context Protocol (MCP) server - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      evaluationGuardrails: {
        value: 'Test-set evaluations and content-safety filtering',
        detail:
          'Single-response evaluation sets support up to 100 test cases. Separate responsible-AI filters can block unsafe responses; evaluation does not guarantee correctness.',
        shortValue: 'Evaluations and content moderation',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/analytics-agent-evaluation-create',
            label: 'Create a single response test set - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/troubleshoot/power-platform/copilot-studio/generative-answers/agent-response-filtered-by-responsible-ai',
            label:
              'Resolve responsible AI content filter errors - Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      humanInTheLoop: {
        value:
          'Agent flows support approval and information requests; conversations can be handed to human agents',
        detail:
          'Flow actions can require human intervention. Live handoff depends on a configured engagement hub.',
        shortValue: 'Human input, approvals and conversational handoff',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/flows-overview',
            label: 'Agent flows overview - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-hand-off',
            label: 'Hand off to a live agent - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      generativeMedia: {
        value: 'Image generation uses external services through connectors',
        detail:
          'Microsoft explicitly states that image generation is not native to Copilot Studio agents. This finding does not establish the absence of every audio or video capability.',
        shortValue: 'External image-generation integrations',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-connectors',
            label:
              'Use connectors in Copilot Studio agents - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      dynamicToolUse: {
        value:
          'The orchestrator selects among the agent’s configured topics, tools, knowledge and agents',
        detail:
          'Makers define the available capabilities and descriptions; event-triggered agents do not create arbitrary new tools at runtime.',
        shortValue: 'Runtime selection from configured capabilities',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/generative-orchestration',
            label:
              'Apply generative orchestration capabilities - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-triggers-about',
            label: 'Event triggers overview - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      modelFallback: {
        value: 'The default model is used when a selected model is turned off or unavailable',
        detail:
          'Microsoft periodically changes the default model. The documented fallback does not establish a configurable provider chain for every rate limit or request failure.',
        shortValue: 'Default-model fallback',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-select-agent-model',
            label:
              'Select a primary AI model for your agent - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      agentSkills: {
        value: 'Reusable Markdown skills in the new agent experience',
        detail:
          'Skills have a name, description and instructions, can be reused across agents, and can be shared as Markdown files or ZIP packages.',
        shortValue: 'Reusable Markdown skills',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-experience/skills-overview',
            label:
              'Skills overview for agents - Microsoft Copilot Studio (GitHub Copilot) | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      nativeChatDeployment: {
        value:
          'Publish agents to web chat, Teams, Microsoft 365 Copilot and other supported channels',
        detail: 'Channels have different setup, authentication and availability requirements.',
        shortValue: 'Web and Microsoft chat channels',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/publication-fundamentals-publish-channels',
            label:
              'Key concepts - Publish and deploy your agent - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          'Knowledge citations and test traces are documented; a raw chunk inspector is not confirmed',
        detail:
          'The knowledge documentation describes source links and citation snippets. That does not establish editable chunk indices or a dedicated raw chunk-content view.',
        shortValue: 'Citations; raw chunk inspection unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/knowledge-copilot-studio',
            label: 'Knowledge sources summary - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/knowledge-test',
            label:
              "Test your agent's knowledge sources - Microsoft Copilot Studio | Microsoft Learn",
            asOf: '2026-09-04',
          },
        ],
      },
      parallelExecution: {
        value:
          'Agent-flow branching is documented; parallel execution follows the underlying flow model',
        detail:
          'Agent flows provide branching controls; Microsoft’s Power Automate guidance documents concurrent branches. This assessment is scoped to flows rather than every conversational agent step.',
        shortValue: 'Parallel branches in the flow layer',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/flows-overview',
            label: 'Agent flows overview - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/guidance/coding-guidelines/implement-parallel-execution',
            label:
              'Optimize flows with parallel execution and concurrency - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      a2aProtocol: {
        value: 'Agents can connect to external agents using the Agent2Agent protocol',
        detail:
          'Configuration uses an agent endpoint, optional Agent Card discovery and the supported authentication method. This does not establish publishing a Copilot Studio agent as an A2A server.',
        shortValue: 'Outbound A2A connections',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/add-agent-agent-to-agent',
            label:
              'Connect to an agent over the Agent2Agent (A2A) protocol - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      loopIteration: {
        value: 'Agent flows include Apply to each and Do until controls',
        detail:
          'Express-mode documentation specifies limits for both loop types; constraints depend on the execution mode.',
        shortValue: 'For-each and until loops',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/flows-overview',
            label: 'Agent flows overview - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/agent-flow-express-mode',
            label:
              'Speed up agent flow execution with express mode (preview) - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value: 'Uses the shared Power Platform connector catalog',
        detail:
          'Standard, premium and custom connectors are supported. No single Copilot Studio-specific connector total is established by the cited documentation.',
        shortValue: 'Shared Power Platform connector catalog',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-connectors',
            label:
              'Use connectors in Copilot Studio agents - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      triggerTypes: {
        value: 'Conversation topics, connector events and recurrence schedules',
        detail:
          'Event triggers require generative orchestration and can run an agent without a user message; autonomous authentication requirements apply.',
        shortValue: 'Conversation, event and scheduled triggers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-triggers-about',
            label: 'Event triggers overview - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      customCodeSteps: {
        value: 'Python code interpreter for prompts, plus external APIs and custom connectors',
        detail:
          'Code interpreter generates and executes Python in a sandbox; custom connectors expose external service operations.',
        shortValue: 'Python interpreter and custom integrations',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/faq-code-interpreter',
            label: 'FAQ for code interpreter - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-connectors',
            label:
              'Use connectors in Copilot Studio agents - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      codeSandboxRuntime: {
        value:
          'Microsoft-hosted ephemeral Python sandbox with network and system-command restrictions',
        detail:
          'The reviewed documentation does not establish customer-defined packages, system packages or a custom runtime image.',
        shortValue: 'Managed Python sandbox; restricted execution',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/faq-code-interpreter',
            label: 'FAQ for code interpreter - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      apiPublishing: {
        value:
          'Published agents can be called through the Microsoft 365 Agents SDK or Direct Line API',
        detail:
          'The documented integration uses the Copilot Studio client for web or native applications; authentication depends on the chosen channel and SDK.',
        shortValue: 'Agents SDK and Direct Line API',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/publication-integrate-web-or-native-app-m365-agents-sdk',
            label:
              'Integrate with web or native apps using Microsoft 365 Agents SDK - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      extensibilitySdk: {
        value: 'Microsoft 365 Agents SDK clients and Power Platform custom connectors',
        detail:
          'Microsoft provides .NET, JavaScript and Python client examples; connector definitions can extend the service integrations.',
        shortValue: 'Agents SDK and custom connectors',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/publication-integrate-web-or-native-app-m365-agents-sdk',
            label:
              'Integrate with web or native apps using Microsoft 365 Agents SDK - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-connectors',
            label:
              'Use connectors in Copilot Studio agents - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpPublishing: {
        value: 'Publishing an agent as a callable MCP server is not confirmed',
        detail:
          'The reviewed Copilot Studio documentation establishes consuming existing MCP servers. It does not establish the reverse publishing capability.',
        shortValue: 'Agent-to-MCP publishing unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent',
            label:
              'Connect your agent to an existing Model Context Protocol (MCP) server - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value: 'Copilot Credits through capacity packs, pay-as-you-go or a pre-purchase plan',
        detail:
          'Feature rates differ. Eligible authenticated Microsoft 365 Copilot employee-facing usage has specific inclusions; bring-your-own-model deployments are billed separately.',
        shortValue: 'Usage credits with multiple purchase options',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/microsoft-365-copilot/pricing/copilot-studio',
            label: 'Microsoft 365 Copilot Pricing – AI Agents | Copilot Studio',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-messages-management',
            label: 'Billing rates and management - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      entryPaidPlan: {
        value:
          'US pricing lists $200 per month for a 25,000-Copilot-Credit capacity pack; pay-as-you-go has no upfront commitment',
        detail:
          'Capacity packs and the pre-purchase commitment plan are separate purchase options. The pricing page does not state a per-credit PAYG amount; Azure billing and regional terms apply.',
        shortValue: '$200/month per 25,000-credit pack; PAYG available',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/microsoft-365-copilot/pricing/copilot-studio',
            label: 'Microsoft 365 Copilot Pricing – AI Agents | Copilot Studio',
            asOf: '2026-09-04',
          },
        ],
      },
      freeTier: {
        value: 'Trial authoring and testing; publishing requires an eligible paid entitlement',
        detail:
          'Microsoft 365 Copilot includes eligible internal agent use under that paid license. The Copilot Studio trial cannot publish an agent.',
        shortValue: 'Trial build/test; paid publishing',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-licensing',
            label:
              'Assign user licenses and manage access - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.microsoft.com/en-us/microsoft-365-copilot/pricing/copilot-studio',
            label: 'Microsoft 365 Copilot Pricing – AI Agents | Copilot Studio',
            asOf: '2026-09-04',
          },
        ],
      },
      byok: {
        value: 'Bring a supported Azure AI Foundry model deployment to prompts',
        detail:
          'This is a model deployment connection, not unrestricted support for every provider API key. Chat-completion endpoint and model restrictions apply; model billing is separate.',
        shortValue: 'Foundry model connections for prompts',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/bring-your-own-model-prompts',
            label:
              'Bring your own model for your prompts - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-messages-management',
            label: 'Billing rates and management - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    security: {
      dataResidency: {
        value:
          'Environment geography controls residency, with model-specific cross-region exceptions',
        detail:
          'Cross-geo models can process data outside the environment region. Check the selected model and tenant data-movement settings rather than assuming every AI request stays local.',
        shortValue: 'Regional environments; AI processing exceptions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/geo-data-residency-security',
            label:
              'Geographic data residency - Security - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-select-agent-model',
            label:
              'Select a primary AI model for your agent - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      rbac: {
        value:
          'Environment and agent roles control authoring, publishing, sharing and analytics access',
        detail:
          'Sharing for collaborative authoring requires appropriate Dataverse roles; analytics-only sharing grants a narrower role.',
        shortValue: 'Environment roles and agent sharing',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/admin-share-bots',
            label: 'Share agents with other users - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      auditLogging: {
        value: 'Copilot Studio activity can be audited in Microsoft Purview',
        detail:
          'Microsoft documents Copilot Studio-specific audit events and the required auditing configuration and access.',
        shortValue: 'Microsoft Purview audit integration',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/admin-logging-copilot-studio',
            label:
              'View Copilot Studio audit logs in Purview - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      compliance: {
        value:
          'Microsoft lists SOC, ISO 9001/20000-1/22301/27001/27017/27018/27701, HIPAA BAA, HITRUST, PCI DSS, CSA STAR, UK G-Cloud, OSPAR, MTCS Level 3, K-ISMS and Spain ENS; government-cloud FedRAMP coverage also applies',
        detail:
          'The SOC 2 Type 2 scope names Copilot Studio. These programs represent different assurances, not interchangeable certifications. Applicable cloud, features, contracts and current reports in the Service Trust Portal determine coverage.',
        shortValue: 'SOC 2, ISO and other scoped compliance programs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/admin-certification',
            label:
              'Review ISO, SOC, and HIPAA compliance - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/compliance/regulatory/offering-soc-2',
            label:
              'System and Organization Controls (SOC) 2 Type 2 - Microsoft Compliance | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-licensing-gcc',
            label: 'US Government customers - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      modelAndToolGovernance: {
        value: 'Admin controls govern model availability and connector-backed tools',
        detail:
          'Model access and cross-region settings are separate from Power Platform data policies governing connectors and tools.',
        shortValue: 'Model controls and connector data policies',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-select-agent-model',
            label:
              'Select a primary AI model for your agent - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/admin-data-loss-prevention',
            label:
              'Configure data policies for agents - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      credentialGovernance: {
        value: 'Tools can use the user’s connection or an author-provided connection',
        detail:
          'User authentication limits access to what that user can access and is supported only on specified channels. A role-based allowlist for individual stored connections is not confirmed.',
        shortValue: 'User or author authentication per tool',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/configure-enduser-authentication',
            label:
              'Configure user authentication for tools - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      whiteLabeling: {
        value: 'Web chat can be customized with CSS/JavaScript or a fully custom hosted canvas',
        detail:
          'Microsoft documents name, icon, styling and full custom-canvas control. Rebranding the authoring workspace is not established by this source.',
        shortValue: 'Customizable chat; builder rebranding unconfirmed',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/customize-default-canvas',
            label:
              'Customize the look and feel of an agent - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      dataRetention: {
        value:
          'Conversation transcript retention in Dataverse is configurable; direct CSV export has a shorter window',
        detail:
          'The direct transcript-download page currently states 28 days; the Monitor overview states 29. Dataverse defaults to 30 days and permits changes. Synapse exports need snapshots or append-only mode to preserve deleted records.',
        shortValue: 'Configurable Dataverse transcript retention',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/analytics-transcripts-studio',
            label:
              'Understand downloaded session data from Copilot Studio - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-experience/analytics-overview',
            label:
              'Monitor an agent overview - Microsoft Copilot Studio (GitHub Copilot) | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/custom-analytics-strategy',
            label:
              'Develop a custom analytics strategy - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      piiRedaction: {
        value:
          'Purview can restrict labeled SharePoint knowledge in supported agent channels; general inline PII redaction is not confirmed',
        detail:
          'The Copilot Studio-specific Purview page scopes DLP to sensitivity-labeled SharePoint content in Teams, SharePoint and Microsoft 365 Copilot. It does not establish universal SSN/prompt redaction.',
        shortValue: 'Label-based restrictions; inline redaction unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/purview/ai-copilot-studio',
            label:
              'Use Microsoft Purview to manage data security & compliance for Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      sso: {
        value:
          'Microsoft tenant identity and assigned maker licenses; channel-specific Microsoft authentication',
        detail:
          'Maker access requires assigned licensing and roles. Publishing documentation describes Microsoft authentication for supported channels; arbitrary SAML just-in-time provisioning is not established here.',
        shortValue: 'Microsoft identity; licensing and channel setup apply',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-licensing',
            label:
              'Assign user licenses and manage access - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/publication-fundamentals-publish-channels',
            label:
              'Key concepts - Publish and deploy your agent - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      sessionPolicy: {
        value:
          'Entra Conditional Access can require reauthentication; maker-portal inactivity controls are not confirmed',
        detail:
          'Sign-in frequency is an Entra policy. Dataverse application timeout settings should not be assumed to cover every Copilot Studio authoring surface.',
        shortValue: 'Identity-layer reauthentication policies',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-session-lifetime',
            label:
              'Conditional Access adaptive session lifetime policies - Microsoft Entra ID | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      thirdPartyVetting: {
        value:
          'Microsoft reviews connectors submitted for public certification; organizations can also build custom connectors',
        detail:
          'Certification includes technical review. Custom connectors are a separate extension route and remain subject to applicable data policies; certification does not guarantee every connected service’s security.',
        shortValue: 'Certified catalog and organization custom connectors',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/connectors/custom-connectors/submit-certification',
            label: 'Get your connector certified - Overview | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/dlp-connector-classification',
            label: 'Connector classification - Power Platform | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value: 'Session transcripts and tool/knowledge usage, plus Application Insights telemetry',
        detail:
          'The new Monitor experience shows session status and transcript details. Standard-harness telemetry supports node events and configurable conversation and tool details.',
        shortValue: 'Session detail and configurable telemetry',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-experience/analytics-overview',
            label:
              'Monitor an agent overview - Microsoft Copilot Studio (GitHub Copilot) | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-bot-framework-composer-capture-telemetry',
            label:
              'Agent-level telemetry with Application Insights - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      durabilityModel: {
        value:
          'Flow-action retry policies are available; universal conversational replay/checkpointing is not confirmed',
        detail:
          'Agent flows use the Power Automate action model. Microsoft’s flow guidance documents fixed and exponential retries; that does not establish replay semantics for every generative agent run.',
        shortValue: 'Flow retries; conversational replay unconfirmed',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/flows-overview',
            label: 'Agent flows overview - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/guidance/coding-guidelines/error-handling',
            label: 'Employ robust error handling - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      failureAlerting: {
        value:
          'Azure Monitor alerts can be configured over exported Application Insights telemetry',
        detail:
          'Agent telemetry and Azure Monitor alert rules are documented separately; native automatic failure emails for every Copilot Studio session are not confirmed.',
        shortValue: 'Alerts through Azure Monitor configuration',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-bot-framework-composer-capture-telemetry',
            label:
              'Agent-level telemetry with Application Insights - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/azure/azure-monitor/alerts/alerts-overview',
            label: 'Overview of Azure Monitor alerts - Azure Monitor | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      dataDrains: {
        value:
          'Application Insights telemetry and incremental Dataverse export through Synapse Link',
        detail:
          'Synapse Link can export transcripts to Azure Data Lake Storage. Mirrored deletions require append-only mode or snapshots when longer retention is needed.',
        shortValue: 'Application Insights and Synapse Link exports',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-bot-framework-composer-capture-telemetry',
            label:
              'Agent-level telemetry with Application Insights - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/custom-analytics-strategy',
            label:
              'Develop a custom analytics strategy - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      asyncExecution: {
        value:
          'Event and scheduled agents run without an open conversation; agent-invoked flow tools must respond synchronously',
        detail:
          'The flow-tool contract requires response within 100 seconds and asynchronous response disabled. It should not be described as a general HTTP 202 polling API.',
        shortValue: 'Background triggers; synchronous flow-tool responses',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-triggers-about',
            label: 'Event triggers overview - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/flow-agent',
            label:
              'Add an agent flow as a tool to an agent - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      executionLimits: {
        value:
          'Agent-invoked flows must respond within 100 seconds; express mode has additional limits',
        detail:
          'Express mode documents a 64 KB per-action message limit and a safe guideline of 100 executed actions, including loop iterations. These are scoped flow limits, not a universal agent-run duration.',
        shortValue: '100-second flow-tool response deadline',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/flow-agent',
            label:
              'Add an agent flow as a tool to an agent - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/agent-flow-express-mode',
            label:
              'Speed up agent flow execution with express mode (preview) - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      partialFailureHandling: {
        value: 'Flow actions can use run-after conditions and error-handling scopes',
        detail:
          'The supported flow pattern routes failed, skipped or timed-out actions to a recovery path. Conversational agent behavior depends on the configured topics and tools.',
        shortValue: 'Flow-layer error branches',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/flows-overview',
            label: 'Agent flows overview - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/guidance/coding-guidelines/error-handling',
            label: 'Employ robust error handling - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      unattendedExecution: {
        value: 'Autonomous event and scheduled triggers; availability differs in government clouds',
        detail:
          'The government table lists autonomous triggers as unavailable in GCC and GCC High. Autonomous actions need working maker authentication without interactive user prompts.',
        shortValue: 'Autonomous cloud triggers, with cloud-specific limits',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-triggers-about',
            label: 'Event triggers overview - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-licensing-gcc',
            label: 'US Government customers - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value: 'Microsoft Learn, community resources and Microsoft technical support',
        detail:
          'Support scope and initial response depend on the purchase agreement, plan and severity. Advisory and account-management services are plan-dependent.',
        shortValue: 'Documentation, community and paid support',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/support-overview',
            label:
              'Support for Microsoft Power Platform and Dynamics 365 apps - Power Platform | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/get-help-support',
            label:
              'Get support in the Power Platform admin center - Power Platform | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      sla: {
        value: 'The applicable contractual uptime commitment was not independently confirmed',
        detail:
          'Microsoft publishes Online Services SLA documents. Confirm the purchased service and applicable agreement rather than assuming a Microsoft-wide uptime percentage or claiming no SLA exists.',
        shortValue: 'Contract-specific SLA unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://www.microsoft.com/licensing/docs/view/Service-Level-Agreements-SLA-for-Online-Services?lang=1',
            label: 'Licensing Documents',
            asOf: '2026-09-04',
          },
        ],
      },
      community: {
        value: 'Microsoft-hosted Power Platform community and self-help resources',
        detail:
          'Microsoft’s support guidance directs customers to product communities and other self-help resources; no unverified membership or activity total is quoted.',
        shortValue: 'Power Platform community',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/get-help-support',
            label:
              'Get support in the Power Platform admin center - Power Platform | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      companyMaturity: {
        value: 'A Microsoft product within the established Power Platform portfolio',
        detail:
          'Microsoft provides product licensing, documentation and support through its broader Power Platform portfolio.',
        shortValue: 'Microsoft-backed Power Platform product',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/microsoft-365-copilot/pricing/copilot-studio',
            label: 'Microsoft 365 Copilot Pricing – AI Agents | Copilot Studio',
            asOf: '2026-09-04',
          },
        ],
      },
      academy: {
        value: 'Microsoft Learn provides structured Power Platform training and certifications',
        detail:
          'The Power Platform Fundamentals credential provides a formal learning and certification path; product-specific learning content supplements it.',
        shortValue: 'Microsoft Learn training and certifications',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/credentials/certifications/power-platform-fundamentals/',
            label:
              'Microsoft Certified: Power Platform Fundamentals - Certifications | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://microsoft.github.io/mcs-labs/labs/setup-for-success/',
            label:
              'Set yourself up for success & discover ALM best practices - Microsoft Copilot Agents Labs',
            asOf: '2026-09-04',
          },
        ],
      },
    },
  },
}
