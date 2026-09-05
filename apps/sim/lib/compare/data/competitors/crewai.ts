import { CrewAIIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Reviewed against live primary sources on 2026-09-04; unresolved claims remain marked unknown. */
export const crewaiProfile: CompetitorProfile = {
  id: 'crewai',
  name: 'CrewAI',
  website: 'https://www.crewai.com',
  oneLiner:
    'CrewAI combines an open-source Python framework for collaborating agents and event-driven flows with CrewAI AMP, a managed platform offering a visual Studio, deployment, and operational controls.',
  isWorkflowBuilder: true,
  brand: {
    icon: CrewAIIcon,
    selfFramed: false,
    colors: ['#ff5a50'],
    source: 'CrewAI brand assets (crewai.com/brand)',
    asOf: '2026-07-02',
  },
  standoutFeatures: [
    {
      title: 'Agent teams and explicit flow control',
      description:
        'CrewAI combines collaborating agents in Crews with event-driven Flows for state and execution control. Teams can compose agents, crews, and ordinary Python functions.',
      shortDescription: 'Combine agent teams with explicit flow orchestration.',
      source: {
        url: 'https://docs.crewai.com/en/concepts/flows',
        label: 'Flows',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Reusable agent skills',
      description:
        'CrewAI supports named SKILL.md packages, progressive loading, organization-scoped publishing, and version pinning for instructions reused across agents.',
      shortDescription: 'Publish and reuse versioned agent instruction packages.',
      source: {
        url: 'https://docs.crewai.com/en/concepts/skills',
        label: 'Skills',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Checkpoint, resume, and fork',
      description:
        'Optional checkpointing captures execution state for crews, flows, and agents. Saved runs can resume after failures or fork into alternative branches.',
      shortDescription: 'Recover or branch execution from configured checkpoints.',
      source: {
        url: 'https://docs.crewai.com/en/concepts/checkpointing',
        label: 'Checkpointing',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'A2A client and server support',
      description:
        'CrewAI agents can delegate work to remote A2A agents and expose themselves as A2A servers through documented client and server configurations.',
      shortDescription: 'Call remote agents and expose A2A servers.',
      source: {
        url: 'https://docs.crewai.com/en/learn/a2a-agent-delegation',
        label: 'Agent-to-Agent (A2A) Protocol',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Natural-language and visual Studio',
      description:
        'AMP Studio generates workflows from descriptions, supports canvas editing and testing, and publishes automations with chat, component-export, and MCP-export options.',
      shortDescription: 'Build visually, test, and publish connected automations.',
      source: {
        url: 'https://docs-platform.crewai.com/platform/en/features/crew-studio',
        label: 'Crew Studio',
        asOf: '2026-09-04',
      },
    },
  ],
  limitations: [
    {
      title: 'Studio code export is one-way',
      description:
        'Exported Studio code can be modified and deployed separately, but those changes cannot be imported back into the original Studio project.',
      shortDescription: 'Exported code changes do not round-trip into Studio.',
      source: {
        url: 'https://docs-platform.crewai.com/platform/en/features/crew-studio',
        label: 'Crew Studio',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Core framework development requires Python',
      description:
        'Using the framework directly involves agent configuration, Python classes, and tool definitions. Teams need programming skills for custom runtime behavior.',
      shortDescription: 'Custom framework behavior requires Python expertise.',
      source: {
        url: 'https://docs.crewai.com/en/concepts/agents',
        label: 'Agents',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Advanced governance requires Enterprise',
      description:
        'The public pricing page places SSO, RBAC, and PII redaction in the Enterprise offering, with custom pricing.',
      shortDescription: 'Advanced governance is part of custom-priced Enterprise.',
      source: {
        url: 'https://crewai.com/pricing',
        label: 'CrewAI pricing',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Code execution needs a separate sandbox choice',
      description:
        'CodeInterpreterTool has been removed from crewai-tools. The current documentation recommends dedicated services such as E2B or Modal for isolated execution.',
      shortDescription: 'Choose an external sandbox for isolated generated-code execution.',
      source: {
        url: 'https://docs.crewai.com/en/tools/ai-ml/codeinterpretertool',
        label: 'Code Interpreter',
        asOf: '2026-09-04',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'Python agent framework plus CrewAI AMP Studio, a visual editor with AI-assisted creation.',
        detail:
          'Studio supports prompt-based creation and drag-and-drop editing. The current Basic plan includes the visual editor and AI copilot.',
        shortValue: 'Python framework plus visual AI-assisted Studio',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/crew-studio',
            label: 'Crew Studio',
            asOf: '2026-09-04',
          },
          {
            url: 'https://crewai.com/pricing',
            label: 'CrewAI pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      learningCurve: {
        value:
          'The framework requires Python skills; Studio offers a visual and natural-language entry point.',
        detail:
          'This is an editorial assessment of the documented workflows, not a benchmark of learning time.',
        shortValue: 'Python for code; visual/natural-language Studio',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/agents',
            label: 'Agents',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/crew-studio',
            label: 'Crew Studio',
            asOf: '2026-09-04',
          },
        ],
      },
      selfHostOption: {
        value: 'Yes: the MIT-licensed framework runs on infrastructure you operate.',
        detail:
          'AMP Enterprise also offers customer infrastructure deployment. Model access and operating costs remain separate from the open-source license.',
        shortValue: 'Self-host the framework; Enterprise platform options',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/crewAIInc/crewAI',
            label: 'CrewAI repository',
            asOf: '2026-09-04',
          },
          {
            url: 'https://crewai.com/pricing',
            label: 'CrewAI pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      deploymentOptions: {
        value: 'Run the Python framework yourself or deploy through CrewAI AMP.',
        detail:
          'Enterprise offers CrewAI cloud, customer VPC, and customer infrastructure options.',
        shortValue: 'Self-run Python, hosted AMP, or Enterprise infrastructure',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/introduction',
            label: 'CrewAI AMP',
            asOf: '2026-09-04',
          },
          {
            url: 'https://crewai.com/pricing',
            label: 'CrewAI pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      templates: {
        value: 'Yes: CrewAI provides project scaffolding and platform workflow templates.',
        detail:
          'The framework scaffolds crews and flows; the AMP marketplace contains prebuilt workflows that can be customized.',
        shortValue: 'CLI scaffolding and workflow templates',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/flows',
            label: 'Flows',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/marketplace',
            label: 'Marketplace',
            asOf: '2026-09-04',
          },
        ],
      },
      license: {
        value: 'MIT for the open-source CrewAI framework; AMP has separate commercial plans.',
        detail:
          'The framework license permits use and modification subject to its terms. Hosted-platform terms and entitlements are separate.',
        shortValue: 'MIT framework; separate AMP plans',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/crewAIInc/crewAI/blob/main/LICENSE',
            label: 'CrewAI MIT license',
            asOf: '2026-09-04',
          },
          {
            url: 'https://crewai.com/pricing',
            label: 'CrewAI pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      environmentPromotion: {
        value: 'Partial: AMP deploys from GitHub branches and can redeploy on new commits.',
        detail:
          'A built-in whole-project promotion workflow across dev/test/prod is not confirmed in the reviewed deployment guide.',
        shortValue: 'Branch-based deployment; environment promotion unconfirmed',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/automations',
            label: 'Automations',
            asOf: '2026-09-04',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Git-based source history, AMP deployment history, and Studio-managed versions are documented.',
        detail:
          'Studio source export is one-way: edited exported code cannot be imported back into the Studio project.',
        shortValue: 'Git and platform history; one-way Studio export',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/crew-studio',
            label: 'Crew Studio',
            asOf: '2026-09-04',
          },
          {
            url: 'https://crewai.com/pricing',
            label: 'CrewAI pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      realtimeCollaboration: {
        value: 'Live concurrent editing with shared cursors is not confirmed.',
        detail:
          'Studio documents shared state between its chat and canvas views; that does not establish simultaneous editing by multiple users.',
        shortValue: 'Live multi-user editing not confirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/crew-studio',
            label: 'Crew Studio',
            asOf: '2026-09-04',
          },
        ],
      },
      nativeFileStorage: {
        value:
          'A native shared drive with link permissions and deleted-item recovery is not confirmed.',
        detail:
          'The framework accepts local knowledge files and storage integrations. These do not establish that full in-product file-management feature set.',
        shortValue: 'Shared-drive features not confirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/knowledge',
            label: 'Knowledge',
            asOf: '2026-09-04',
          },
        ],
      },
      dataTables: {
        value: 'A native spreadsheet-style table editor is not confirmed.',
        detail:
          'CrewAI documents integrations with external data services, which do not establish a built-in spreadsheet grid.',
        shortValue: 'Native data tables not confirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/tools-and-integrations',
            label: 'Tools & Integrations',
            asOf: '2026-09-04',
          },
        ],
      },
      richTextEditor: {
        value: 'A document-focused WYSIWYG editor is not confirmed.',
        detail:
          'The reviewed Studio documentation describes workflow creation and editing, not a general document editor.',
        shortValue: 'Document editor not confirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/crew-studio',
            label: 'Crew Studio',
            asOf: '2026-09-04',
          },
        ],
      },
      subWorkflows: {
        value:
          'Yes: flows can invoke crews, and a dedicated tool invokes deployed AMP automations.',
        detail:
          'InvokeCrewAIAutomationTool starts an automation, polls for completion, and returns its result to the caller.',
        shortValue: 'Compose crews and call deployed automations',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/flows',
            label: 'Flows',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.crewai.com/en/tools/integration/crewaiautomationtool',
            label: 'CrewAI Run Automation Tool',
            asOf: '2026-09-04',
          },
        ],
      },
      customBlocks: {
        value: 'Partial: shared agent repositories and callable automation tools support reuse.',
        detail:
          'A published whole-flow block with automatically derived inputs/outputs in every user’s visual toolbar is not confirmed.',
        shortValue: 'Agent/automation reuse; whole-flow block publishing unconfirmed',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/agent-repositories',
            label: 'Agent Repositories',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.crewai.com/en/tools/integration/crewaiautomationtool',
            label: 'CrewAI Run Automation Tool',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Yes: native integrations cover several providers, with additional integrations through LiteLLM.',
        detail:
          'The docs cover OpenAI, Anthropic, Google Gemini, Azure, Bedrock, and other providers. Supported features depend on the provider.',
        shortValue: 'Multiple native providers plus LiteLLM',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/llms',
            label: 'LLMs',
            asOf: '2026-09-04',
          },
        ],
      },
      agentReasoningBlocks: {
        value: 'Yes: agents can use tools, delegate tasks, and plan before execution.',
        detail:
          'Crews organize agents and tasks; Flows provide explicit event-driven orchestration.',
        shortValue: 'Reasoning agents, crews, and orchestration flows',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/agents',
            label: 'Agents',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.crewai.com/en/concepts/flows',
            label: 'Flows',
            asOf: '2026-09-04',
          },
        ],
      },
      naturalLanguageBuilding: {
        value: 'Yes: Crew Studio generates agents, tasks, and tools from a description.',
        detail: 'The resulting workflow can be edited through the visual canvas or chat.',
        shortValue: 'Prompt-to-workflow creation in Studio',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/crew-studio',
            label: 'Crew Studio',
            asOf: '2026-09-04',
          },
        ],
      },
      knowledgeBaseRag: {
        value: 'Yes: CrewAI Knowledge supports file and text sources, embeddings, and retrieval.',
        detail:
          'Knowledge can be assigned to an individual agent or shared across a crew, with configurable chunking and embedding settings.',
        shortValue: 'Agent/crew knowledge with chunking and retrieval',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/knowledge',
            label: 'Knowledge',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpSupport: {
        value: 'Yes: agents can consume MCP tools over stdio, SSE, or streamable HTTP.',
        detail:
          'The mcps configuration discovers tools from configured servers and supports tool filtering; MCPServerAdapter remains available for manual connection management.',
        shortValue: 'MCP client with three documented transports',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/mcp/overview',
            label: 'MCP Servers as Tools in CrewAI',
            asOf: '2026-09-04',
          },
        ],
      },
      evaluationGuardrails: {
        value: 'Yes: task outputs support Python-function and LLM-based guardrails.',
        detail:
          'Guardrails validate or transform output and can retry failed validation. AMP also documents a hallucination guardrail.',
        shortValue: 'Task validators, retries, and hallucination checks',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/tasks',
            label: 'Tasks',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/hallucination-guardrail',
            label: 'Hallucination Guardrail',
            asOf: '2026-09-04',
          },
        ],
      },
      humanInTheLoop: {
        value: 'Yes: flows support human-feedback pauses and resumption.',
        detail:
          'The default provider uses console input; custom nonblocking providers can integrate Slack or webhooks. AMP adds centralized review management.',
        shortValue: 'Console or asynchronous approval and resume',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/learn/human-feedback-in-flows',
            label: 'Human Feedback in Flows',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/flow-hitl-management',
            label: 'Flow HITL Management',
            asOf: '2026-09-04',
          },
        ],
      },
      generativeMedia: {
        value: 'Yes for image generation through the documented DallETool.',
        detail:
          'The tool calls OpenAI image generation. A comprehensive native video/audio-generation suite is not established by this source.',
        shortValue: 'Provider-backed image generation',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/tools/ai-ml/dalletool',
            label: 'DALL-E Tool',
            asOf: '2026-09-04',
          },
        ],
      },
      dynamicToolUse: {
        value:
          'Partial: MCP tools are discovered from configured servers, with configurable filtering.',
        detail:
          'Agents choose among available tools during execution. Autonomous discovery across an unrestricted tool catalog is not confirmed.',
        shortValue: 'Configured MCP discovery and runtime tool choice',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.crewai.com/en/mcp/overview',
            label: 'MCP Servers as Tools in CrewAI',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.crewai.com/en/concepts/agents',
            label: 'Agents',
            asOf: '2026-09-04',
          },
        ],
      },
      modelFallback: {
        value: 'Automatic cross-model failover is not confirmed as a core framework feature.',
        detail:
          'The reviewed LLM documentation describes multiple providers and configuration, but does not establish a built-in ordered failover policy.',
        shortValue: 'Built-in model failover not confirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/llms',
            label: 'LLMs',
            asOf: '2026-09-04',
          },
        ],
      },
      agentSkills: {
        value: 'Yes: named SKILL.md packages supply reusable instructions to agents and crews.',
        detail:
          'Skills support progressive loading and organization-scoped publishing, installation, and version pinning.',
        shortValue: 'Reusable, versioned SKILL.md packages',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/skills',
            label: 'Skills',
            asOf: '2026-09-04',
          },
        ],
      },
      nativeChatDeployment: {
        value: 'Yes: AMP provides chat with deployed automations and React component export.',
        detail:
          'Experimental Conversational Flow APIs add session-based chat with streaming and history. Public embedding and authentication must be configured for the application.',
        shortValue: 'Hosted automation chat and component export',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/automations',
            label: 'Automations',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs-platform.crewai.com/platform/en/guides/conversational-flow-chat',
            label: 'Conversational Flow Chat API',
            asOf: '2026-09-04',
          },
        ],
      },
      kbChunkVisibility: {
        value: 'Chunk-level inspection in a dedicated platform UI is not confirmed.',
        detail:
          'Knowledge documentation describes chunking and programmatic retrieval. It does not establish a built-in visual chunk browser.',
        shortValue: 'Visual chunk browser not confirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/knowledge',
            label: 'Knowledge',
            asOf: '2026-09-04',
          },
        ],
      },
      parallelExecution: {
        value:
          'Yes: tasks support asynchronous execution and flows can run independent branches concurrently.',
        detail:
          'Task context dependencies and flow listeners determine when downstream work can proceed.',
        shortValue: 'Async tasks and concurrent flow branches',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/tasks',
            label: 'Tasks',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.crewai.com/en/concepts/flows',
            label: 'Flows',
            asOf: '2026-09-04',
          },
        ],
      },
      a2aProtocol: {
        value: 'Yes: CrewAI documents A2A client and server configurations.',
        detail:
          'Agents can delegate to remote A2A agents or expose themselves through an A2A server.',
        shortValue: 'A2A client and server support',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/learn/a2a-agent-delegation',
            label: 'Agent-to-Agent (A2A) Protocol',
            asOf: '2026-09-04',
          },
        ],
      },
      loopIteration: {
        value: 'Partial: flows support looping through routing and Python control flow.',
        detail:
          'The reviewed documentation establishes programmatic repetition; a dedicated visual loop container is not confirmed.',
        shortValue: 'Code-defined loops and conditional routing',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/flows',
            label: 'Flows',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value:
          'CrewAI provides its own tool library, AMP integrations, and external MCP connections.',
        detail:
          'A stable, directly comparable count of unique business-app connectors is not confirmed. Tool actions and connected services are different measures.',
        shortValue: 'Tool library, AMP apps, and MCP; count unconfirmed',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/tools',
            label: 'Tools',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/tools-and-integrations',
            label: 'Tools & Integrations',
            asOf: '2026-09-04',
          },
        ],
      },
      triggerTypes: {
        value: 'AMP supports API kickoff, connector events, webhooks, and cron scheduling.',
        detail:
          'The trigger guide documents integration-specific events; available triggers depend on the connected application.',
        shortValue: 'API, app events, webhooks, and cron',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/guides/automation-triggers',
            label: 'Triggers Overview',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs-platform.crewai.com/platform/en/guides/webhook-automation',
            label: 'Webhook Automation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://crewai.com/pricing',
            label: 'CrewAI pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      customCodeSteps: {
        value: 'Yes: CrewAI supports Python flow methods and custom tools.',
        detail:
          'Custom tools can be defined with a decorator or BaseTool class and called by agents.',
        shortValue: 'Python methods and custom tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/tools',
            label: 'Tools',
            asOf: '2026-09-04',
          },
        ],
      },
      codeSandboxRuntime: {
        value:
          'Partial: the former CodeInterpreterTool is removed; current docs recommend external sandbox services.',
        detail:
          'AMP deployments can install project dependencies, including private Python packages. Configuring an isolated code sandbox depends on the chosen provider.',
        shortValue: 'External sandbox; configurable deployment dependencies',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.crewai.com/en/tools/ai-ml/codeinterpretertool',
            label: 'Code Interpreter',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs-platform.crewai.com/platform/en/guides/private-package-registry',
            label: 'Private Package Registries',
            asOf: '2026-09-04',
          },
        ],
      },
      apiPublishing: {
        value: 'Yes: AMP exposes kickoff, status, and related deployment API endpoints.',
        detail: 'Clients authenticate to start an automation and retrieve its execution result.',
        shortValue: 'Authenticated automation API',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/guides/kickoff-crew',
            label: 'Kickoff Crew',
            asOf: '2026-09-04',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Python framework, custom-tool APIs, a CLI, and tool repositories support extensions.',
        detail:
          'Developers can author tools in code and distribute versions through AMP’s tool repository.',
        shortValue: 'Python SDK, CLI, and tool repositories',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/tools',
            label: 'Tools',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs-platform.crewai.com/platform/en/guides/tool-repository',
            label: 'Tool Repository',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpPublishing: {
        value: 'Yes: published AMP automations offer Export as MCP.',
        detail: 'The automation and Studio documentation describe this export option.',
        shortValue: 'Export deployed automations as MCP',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/automations',
            label: 'Automations',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value: 'Free MIT framework; AMP has free Basic and custom-priced Enterprise plans.',
        detail: 'Model and infrastructure costs depend on how the application runs.',
        shortValue: 'Free framework/Basic; custom Enterprise',
        confidence: 'verified',
        sources: [
          {
            url: 'https://crewai.com/pricing',
            label: 'CrewAI pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      entryPaidPlan: {
        value: 'The public paid offering is custom-priced Enterprise.',
        detail: 'The current pricing page does not list a fixed-price intermediate paid tier.',
        shortValue: 'Enterprise: contact sales',
        confidence: 'verified',
        sources: [
          {
            url: 'https://crewai.com/pricing',
            label: 'CrewAI pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      freeTier: {
        value: 'AMP Basic is free with two automations and 50 workflow executions per month.',
        detail: 'Studio, AI copilot, and standard tools and triggers are included.',
        shortValue: 'Basic: 2 automations, 50 executions/month',
        confidence: 'verified',
        sources: [
          {
            url: 'https://crewai.com/pricing',
            label: 'CrewAI pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      byok: {
        value: 'Yes: the framework accepts model-provider credentials.',
        detail:
          'The LLM documentation shows environment variables and provider-specific authentication. Provider usage is billed according to that account’s terms.',
        shortValue: 'Provider credentials in framework configuration',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/llms',
            label: 'LLMs',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    security: {
      dataResidency: {
        value: 'Enterprise offers deployment in customer VPCs or customer infrastructure.',
        detail:
          'Self-operated deployments let the customer select infrastructure; external model and tool traffic still depends on configuration. Standard cloud region selection is not confirmed.',
        shortValue: 'Customer infrastructure options; cloud regions unconfirmed',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://crewai.com/pricing',
            label: 'CrewAI pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      rbac: {
        value: 'Yes: AMP has role and entity-level permissions; pricing places RBAC in Enterprise.',
        detail:
          'Roles control platform features, while resource permissions cover individual automations and selected configuration objects.',
        shortValue: 'Enterprise roles and entity-level permissions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/rbac',
            label: 'Role-Based Access Control (RBAC)',
            asOf: '2026-09-04',
          },
          {
            url: 'https://crewai.com/pricing',
            label: 'CrewAI pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      auditLogging: {
        value: 'A dedicated administrative audit log is not confirmed in the reviewed public docs.',
        detail:
          'Execution traces and resource permissions are documented, but they do not establish an immutable or exportable administrative event log.',
        shortValue: 'Administrative audit logging not confirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/rbac',
            label: 'Role-Based Access Control (RBAC)',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/traces',
            label: 'Traces',
            asOf: '2026-09-04',
          },
        ],
      },
      compliance: {
        value:
          'The pricing page lists Fed Ramp High under Enterprise infrastructure; independent authorization is not confirmed.',
        detail:
          'The public Trust Center did not expose inspectable audit reports during this review. SOC 2, HIPAA, ISO 27001, PCI DSS, and FedRAMP attestation scope remain unverified here.',
        shortValue: 'Vendor infrastructure claim; attestations unverified',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://crewai.com/pricing',
            label: 'CrewAI pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      modelAndToolGovernance: {
        value: 'Partial: AMP roles govern tool management and access to LLM connections.',
        detail:
          'Entity-level RBAC can restrict specific LLM provider configurations when enabled. A universal per-model and per-tool execution allowlist is not established.',
        shortValue: 'Tool permissions and scoped LLM connections',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/rbac',
            label: 'Role-Based Access Control (RBAC)',
            asOf: '2026-09-04',
          },
        ],
      },
      credentialGovernance: {
        value:
          'Yes: enabled entity-level RBAC restricts access to specific environment variables and LLM connections.',
        detail:
          'Secret-provider integrations add role permissions for centrally managed credentials. Availability depends on the organization’s enabled features.',
        shortValue: 'Entity-level credential access and secret providers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/rbac',
            label: 'Role-Based Access Control (RBAC)',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/secrets-manager/usage',
            label: 'Using the Secrets Manager',
            asOf: '2026-09-04',
          },
        ],
      },
      whiteLabeling: {
        value: 'Full replacement of platform branding is not confirmed.',
        detail:
          'Studio can export application components, but that does not establish white-labeling of the AMP workspace itself.',
        shortValue: 'Full platform white-labeling not confirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/crew-studio',
            label: 'Crew Studio',
            asOf: '2026-09-04',
          },
        ],
      },
      dataRetention: {
        value: 'Customer-configurable AMP trace-retention windows are not confirmed.',
        detail:
          'The reviewed trace documentation describes execution records and debugging, but does not specify organization-level retention settings.',
        shortValue: 'AMP trace-retention controls not confirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/traces',
            label: 'Traces',
            asOf: '2026-09-04',
          },
        ],
      },
      piiRedaction: {
        value: 'Yes: AMP Enterprise detects and masks sensitive data before storing traces.',
        detail: 'Administrators choose entity types, masking or removal, and custom recognizers.',
        shortValue: 'Enterprise PII redaction for traces',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/pii-trace-redactions',
            label: 'PII Redaction for Traces',
            asOf: '2026-09-04',
          },
        ],
      },
      sso: {
        value: 'Yes: enterprise SSO is documented for managed AMP and self-hosted Factory.',
        detail:
          'Supported configurations include Entra ID, Okta, and Auth0; Factory additionally documents Keycloak.',
        shortValue: 'Enterprise SSO for SaaS and Factory',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/sso',
            label: 'Single Sign-On (SSO)',
            asOf: '2026-09-04',
          },
        ],
      },
      sessionPolicy: {
        value: 'An admin-configurable session lifetime or idle timeout is not confirmed.',
        detail:
          'The reviewed SSO and Factory authentication configuration documents identity-provider setup, but does not establish a customer session-duration control.',
        shortValue: 'Session-duration controls not confirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/sso',
            label: 'Single Sign-On (SSO)',
            asOf: '2026-09-04',
          },
          {
            url: 'https://enterprise-docs.crewai.com/features/workos-sso',
            label: 'WorkOS SSO',
            asOf: '2026-09-04',
          },
        ],
      },
      thirdPartyVetting: {
        value:
          'Partial: the Tool Repository documents automated security checks before installation.',
        detail:
          'Its guide also permits public tool publication. This does not establish human security review of every tool or of external MCP servers.',
        shortValue: 'Automated repository checks; broader review unconfirmed',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/guides/tool-repository',
            label: 'Tool Repository',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value: 'Yes: AMP traces include agent activity, tasks, tool calls, and model interactions.',
        detail:
          'Execution views provide timelines, inputs, outputs, token usage, and errors for investigation.',
        shortValue: 'Agent, task, tool, and model traces',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/features/traces',
            label: 'Traces',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.crewai.com/en/observability/tracing',
            label: 'CrewAI Tracing',
            asOf: '2026-09-04',
          },
        ],
      },
      durabilityModel: {
        value:
          'Yes: optional checkpointing saves execution state and can resume or fork crews, flows, and agents.',
        detail:
          'Checkpoint storage supports JSON or SQLite. Automatic checkpoint writes are best-effort; persistence must be configured for the deployment.',
        shortValue: 'Configurable checkpoint, resume, and fork',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/checkpointing',
            label: 'Checkpointing',
            asOf: '2026-09-04',
          },
        ],
      },
      failureAlerting: {
        value:
          'Partial: deployment completion webhooks can be connected to external notification systems.',
        detail:
          'The reviewed guide documents completion callbacks. Dedicated failure notifications and native threshold alerts are not confirmed.',
        shortValue: 'Webhook-based notifications; native alerts unconfirmed',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/guides/webhook-automation',
            label: 'Webhook Automation',
            asOf: '2026-09-04',
          },
        ],
      },
      dataDrains: {
        value: 'Yes: AMP exports OpenTelemetry traces and logs to external collectors.',
        detail:
          'The setup supports generic OTLP-compatible backends and a Datadog integration, with multiple collectors configurable.',
        shortValue: 'Continuous OpenTelemetry trace/log export',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/guides/capture_telemetry_logs',
            label: 'OpenTelemetry Export',
            asOf: '2026-09-04',
          },
        ],
      },
      asyncExecution: {
        value:
          'Yes: asynchronous kickoff and AMP kickoff/status APIs support background execution.',
        detail:
          'The caller can await a local async run or poll a deployed automation for its result.',
        shortValue: 'Async kickoff and deployed status polling',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/learn/kickoff-async',
            label: 'Kickoff Crew Asynchronously',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs-platform.crewai.com/platform/en/guides/kickoff-crew',
            label: 'Kickoff Crew',
            asOf: '2026-09-04',
          },
        ],
      },
      executionLimits: {
        value: 'A universal AMP run-duration or concurrency ceiling is not confirmed.',
        detail:
          'Monthly execution allowances are plan quotas, not per-run limits. Framework agents also expose configurable iteration, request-rate, and execution-time limits.',
        shortValue: 'Plan quotas; universal run/concurrency cap unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/agents',
            label: 'Agents',
            asOf: '2026-09-04',
          },
        ],
      },
      partialFailureHandling: {
        value:
          'Partial: task guardrails can retry validation failures, and Python code can handle other errors.',
        detail:
          'This provides recovery mechanisms; it does not guarantee that every unhandled failure continues the remainder of a run.',
        shortValue: 'Guardrail retries and programmatic error handling',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/tasks',
            label: 'Tasks',
            asOf: '2026-09-04',
          },
        ],
      },
      unattendedExecution: {
        value: 'Yes: deployed AMP automations run through server-side APIs and triggers.',
        detail:
          'A browser does not need to remain open for the deployment to execute. Self-hosted framework runs require infrastructure that the operator keeps available.',
        shortValue: 'Server-side AMP execution and triggers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs-platform.crewai.com/platform/en/guides/kickoff-crew',
            label: 'Kickoff Crew',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs-platform.crewai.com/platform/en/guides/automation-triggers',
            label: 'Triggers Overview',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value: 'Documentation and community support, with dedicated support for Enterprise.',
        detail:
          'CrewAI pricing lists dedicated and Slack/Teams support options for Enterprise customers.',
        shortValue: 'Docs/community; dedicated Enterprise support',
        confidence: 'verified',
        sources: [
          {
            url: 'https://crewai.com/pricing',
            label: 'CrewAI pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      sla: {
        value: 'A public product-wide uptime percentage is not confirmed.',
        detail:
          'The pricing page lists Enterprise support services without specifying a universal uptime SLA.',
        shortValue: 'Public uptime SLA not confirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://crewai.com/pricing',
            label: 'CrewAI pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      community: {
        value: 'Public GitHub development and a dedicated community forum.',
        detail:
          'The repository and CrewAI website link public development and discussion resources.',
        shortValue: 'GitHub and community forum',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/crewAIInc/crewAI',
            label: 'CrewAI repository',
            asOf: '2026-09-04',
          },
        ],
      },
      companyMaturity: {
        value:
          'CrewAI’s open-source project launched in November 2023; Insight Partners announced leading its Series A in October 2024.',
        detail:
          'The investor’s announcement identifies founder João Moura and the launch of the Enterprise platform. No current total funding or valuation is inferred.',
        shortValue: 'OSS launch in 2023; Series A announced in 2024',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.insightpartners.com/ideas/behind-the-investment-crewai/',
            label: 'Behind the Investment: CrewAI — Insight Partners',
            asOf: '2026-09-04',
          },
        ],
      },
      academy: {
        value: 'Yes: CrewAI links structured multi-agent coursework hosted by DeepLearning.AI.',
        detail:
          'Its learning site links enrollment and a completion badge. Current course access terms should be checked with the course provider.',
        shortValue: 'Structured coursework through DeepLearning.AI',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.crewai.com',
            label: 'CrewAI learning resources',
            asOf: '2026-09-04',
          },
        ],
      },
    },
  },
}
