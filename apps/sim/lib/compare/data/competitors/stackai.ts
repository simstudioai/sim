import { StackAIIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Reviewed against public primary sources on 2026-09-04; unverified capabilities are labeled. */
export const stackaiProfile: CompetitorProfile = {
  id: 'stack-ai',
  name: 'StackAI',
  website: 'https://www.stackai.com',
  brand: {
    icon: StackAIIcon,
    selfFramed: true,
    colors: ['#8c8c8c', '#212121', '#d0d0d0'],
    source: 'Context.dev brand-intelligence API',
    asOf: '2026-07-02',
  },
  oneLiner:
    'StackAI, acquired by Asana in May 2026, is a commercial visual platform for building and governing AI agents, with hosted, VPC, and on-premise deployment options.',
  standoutFeatures: [
    {
      title: 'Reviewed deployment stages',
      description:
        'ADLC provides separate deployment URLs and reviews of frozen workflow versions before promotion. Enabling it applies stages to newly created projects.',
      shortDescription: 'Reviewed versions move through separate deployment stages.',
      source: {
        url: 'https://docs.stackai.com/welcome-to-stackai/security-and-governance/security-in-stackai/agentic-development-lifecycle-adlc.md',
        label: 'StackAI: Agentic Development Lifecycle (ADLC)',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Portable skills with version history',
      description:
        'Agents load reusable skills on demand. Builders can import and export Agent Skills-compatible bundles with SKILL.md and supporting files.',
      shortDescription: 'Portable SKILL.md bundles with on-demand loading.',
      source: {
        url: 'https://docs.stackai.com/workflow-builder/utils-logic-and-others/bonus-features/skills.md',
        label: 'StackAI: Skills',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Human approval in workflows',
      description:
        'A workflow can pause for a human to approve, reject, or provide feedback through a connected communication channel.',
      shortDescription: 'Workflows pause for approval before proceeding.',
      source: {
        url: 'https://www.stackai.com/blog/introducing-stackai-human-in-the-loop-agentic-workflows-you-can-trust',
        label: 'Introducing StackAI Human-in-the-Loop: Agentic Workflows You Can Trust',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Enterprise hosting choices',
      description:
        'Enterprise pricing includes dedicated infrastructure, on-premise deployment, and virtual private cloud deployment.',
      shortDescription: 'Enterprise supports dedicated, on-premise, and VPC deployment.',
      source: {
        url: 'https://www.stackai.com/pricing',
        label: 'StackAI Pricing – Plans for Teams & Enterprise',
        asOf: '2026-09-04',
      },
    },
  ],
  limitations: [
    {
      title: 'Small free allowance',
      description: 'The free plan includes 500 runs per month, 2 projects, and 1 seat.',
      shortDescription: 'Free includes 500 runs, 2 projects, and 1 seat.',
      source: {
        url: 'https://www.stackai.com/pricing',
        label: 'StackAI Pricing – Plans for Teams & Enterprise',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Paid pricing requires a quote',
      description:
        'The public paid offering is Enterprise with custom pricing, so a paid cost comparison requires a quote.',
      shortDescription: 'Enterprise pricing requires a quote.',
      source: {
        url: 'https://www.stackai.com/pricing',
        label: 'StackAI Pricing – Plans for Teams & Enterprise',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'PII protection requires configuration',
      description:
        'PII controls are off by default. Warning mode passes the original value to the model; Encrypt mode masks it for the model and restores it in output.',
      shortDescription: 'PII controls are optional and mode-dependent.',
      source: {
        url: 'https://docs.stackai.com/workflow-builder/core-nodes/ai-agent-node/advanced-settings.md',
        label: 'StackAI: Advanced Settings',
        asOf: '2026-09-04',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'Visual node-based workflow canvas with AI Agent nodes, a building assistant, and an MCP interface for creating and editing workflows.',
        shortValue: 'Visual canvas, agents, and AI-assisted building',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/overview/platform-overview',
            label: 'StackAI: Platform Overview',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/interface-and-deployment/mcp-reference/stackai-mcp-server',
            label: 'StackAI: StackAI MCP Server',
            asOf: '2026-09-04',
          },
        ],
      },
      learningCurve: {
        value:
          'Approachable for visual prototyping; production workflows still require knowledge of data, tools, and governance settings.',
        shortValue: 'Visual prototyping; production setup takes practice',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.stackai.com/getting-started/start-here',
            label: 'StackAI: Start Here',
            asOf: '2026-09-04',
          },
        ],
      },
      selfHostOption: {
        value: 'Yes: Enterprise offers on-premise and VPC deployment.',
        shortValue: 'Yes, Enterprise on-premise and VPC',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.stackai.com/pricing',
            label: 'StackAI Pricing – Plans for Teams & Enterprise',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/security-and-governance/on-premise.md',
            label: 'StackAI: On-Premise',
            asOf: '2026-09-04',
          },
        ],
      },
      deploymentOptions: {
        value:
          'Hosted service, dedicated infrastructure, customer VPC, or on-premise Enterprise deployment.',
        shortValue: 'Hosted, dedicated, VPC, or on-premise',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.stackai.com/pricing',
            label: 'StackAI Pricing – Plans for Teams & Enterprise',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/security-and-governance/on-premise.md',
            label: 'StackAI: On-Premise',
            asOf: '2026-09-04',
          },
        ],
      },
      templates: {
        value: 'Yes: prebuilt workflow templates and a Chat with Knowledge Base starter.',
        shortValue: 'Yes, prebuilt workflow templates',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/overview/platform-overview',
            label: 'StackAI: Platform Overview',
            asOf: '2026-09-04',
          },
        ],
      },
      license: {
        value:
          'Commercial platform offered under subscription terms for SaaS, on-premise, and bring-your-own-cloud purchases.',
        shortValue: 'Commercial subscription platform',
        confidence: 'verified',
        sources: [
          {
            url: 'https://asana.com/terms/asana-product-specific-terms',
            label: 'Asana Product-Specific Terms • Asana',
            asOf: '2026-09-04',
          },
        ],
      },
      environmentPromotion: {
        value:
          'Yes: ADLC promotes reviewed versions through Draft, Development, Staging, and Production, with separate deployed URLs.',
        shortValue: 'Yes, reviewed deployment stages',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/security-and-governance/security-in-stackai/agentic-development-lifecycle-adlc.md',
            label: 'StackAI: Agentic Development Lifecycle (ADLC)',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Admins enable Deployment Stages for new projects. Existing projects do not automatically gain ADLC stages; stage order must be followed, although a stage can be omitted by configuration.',
      },
      versionControlDepth: {
        value:
          'Published version history includes descriptions, authors, diffs, and reversion; ADLC adds frozen review snapshots and deployment history.',
        shortValue: 'Published versions, diffs, rollback, and deployment history',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/security-and-governance/security-in-stackai/project-controls.md',
            label: 'StackAI: Project Controls',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/security-and-governance/security-in-stackai/agentic-development-lifecycle-adlc.md',
            label: 'StackAI: Agentic Development Lifecycle (ADLC)',
            asOf: '2026-09-04',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          'Unknown: shared access and project locking are documented, but simultaneous editing with synchronized cursors and selections was not verified.',
        shortValue: 'Live canvas co-editing unverified',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/security-and-governance/security-in-stackai/project-controls.md',
            label: 'StackAI: Project Controls',
            asOf: '2026-09-04',
          },
        ],
      },
      nativeFileStorage: {
        value:
          'Partial: files can be uploaded for workflows; Code Node outputs are stored with short-lived download URLs. Shared folders, authenticated file links, and trash recovery were not verified.',
        shortValue: 'Workflow files; full file manager unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/inputs/files-node',
            label: 'StackAI: Files Node',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/workflow-builder/utils-logic-and-others/logic/code-node',
            label: 'StackAI: Code Node',
            asOf: '2026-09-04',
          },
        ],
      },
      dataTables: {
        value:
          'Unknown: a general-purpose native spreadsheet grid with documented row limits and keyboard editing was not verified.',
        shortValue: 'Native spreadsheet grid unverified',
        confidence: 'unknown',
        sources: [],
      },
      richTextEditor: {
        value:
          'Unknown: a native document editor with rich-text editing and stored documents was not verified.',
        shortValue: 'Native document editor unverified',
        confidence: 'unknown',
        sources: [],
      },
      subWorkflows: {
        value:
          'Yes: the StackAI Project Node calls another project and returns its outputs, with an optional loop over multiple inputs.',
        shortValue: 'Yes, reusable Project Node calls',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/utils-logic-and-others/utils/stackai-project-node',
            label: 'StackAI: StackAI Project Node',
            asOf: '2026-09-04',
          },
        ],
      },
      customBlocks: {
        value:
          'Partial: Project Nodes and named Subflow Tools provide reusable logic. Publishing each project as a distinct shared toolbar block was not verified.',
        shortValue: 'Project Nodes and named Subflow Tools',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/utils-logic-and-others/utils/stackai-project-node',
            label: 'StackAI: StackAI Project Node',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/workflow-builder/core-nodes/ai-agent-node/subflow-tools',
            label: 'StackAI: Subflow Tools',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Yes: multiple LLM providers, including OpenAI, Anthropic, Azure, Bedrock, Google, and local models.',
        shortValue: 'Multiple providers and local models',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/interface-and-deployment/api-reference/analytics.md',
            label: 'StackAI: Analytics',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/workflow-builder/core-nodes/ai-agent-node/llm-hosting-and-governance/llms-hosted-on-azure-and-aws-bedrock',
            label: 'StackAI: LLMs Hosted on Azure & AWS Bedrock',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/security-and-governance/on-premise.md',
            label: 'StackAI: On-Premise',
            asOf: '2026-09-04',
          },
        ],
      },
      agentReasoningBlocks: {
        value: 'Yes: AI Agent nodes choose tools and orchestrate named Subflow Tools.',
        shortValue: 'Yes, agents with tools and subflows',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/core-nodes/ai-agent-node/subflow-tools',
            label: 'StackAI: Subflow Tools',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/workflow-builder/core-nodes/ai-agent-node/tools.md',
            label: 'StackAI: Tools',
            asOf: '2026-09-04',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          'Yes: Chat with Workflow assists builders, and the StackAI MCP server lets connected AI assistants create and edit workflows from descriptions.',
        shortValue: 'Yes, builder assistant and MCP workflow creation',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/overview/platform-overview',
            label: 'StackAI: Platform Overview',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/interface-and-deployment/mcp-reference/stackai-mcp-server',
            label: 'StackAI: StackAI MCP Server',
            asOf: '2026-09-04',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          'Yes: indexed knowledge bases support retrieval with queries, metadata filters, and configurable result counts.',
        shortValue: 'Yes, indexed knowledge bases and filtered retrieval',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/apps/knowledge-base',
            label: 'StackAI: Knowledge Base',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpSupport: {
        value: 'Yes: workflows can call selected tools on remote MCP servers using the MCP node.',
        shortValue: 'Yes, remote MCP tool calls',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/apps/mcp',
            label: 'StackAI: MCP',
            asOf: '2026-09-04',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'Yes: Evaluator runs CSV input batches with LLM grading; optional LLM guardrails screen responses for configured content categories.',
        shortValue: 'Yes, batch evaluations and optional guardrails',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/overview/platform-overview',
            label: 'StackAI: Platform Overview',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/workflow-builder/core-nodes/ai-agent-node/advanced-settings.md',
            label: 'StackAI: Advanced Settings',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Guardrails are off by default. Supported categories include toxic content, legal advice, and suicidal thoughts; behavior can warn or block.',
      },
      humanInTheLoop: {
        value:
          'Yes: workflows can pause for a human to approve, reject, or provide feedback before proceeding.',
        shortValue: 'Yes, pause for human approval',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.stackai.com/blog/introducing-stackai-human-in-the-loop-agentic-workflows-you-can-trust',
            label: 'Introducing StackAI Human-in-the-Loop: Agentic Workflows You Can Trust',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Approval requests can be delivered through connected channels such as Slack, Teams, or email.',
      },
      generativeMedia: {
        value:
          'Yes: Image and Audio nodes generate images and speech; the RunwayML integration also generates video.',
        shortValue: 'Yes, image, speech, and video generation',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/outputs/audio-node',
            label: 'StackAI: Audio Node',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/workflow-builder/outputs/image-node',
            label: 'StackAI: Image Node',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/workflow-builder/apps/runwayml.md',
            label: 'StackAI: RunwayML',
            asOf: '2026-09-04',
          },
        ],
      },
      dynamicToolUse: {
        value:
          'Agents choose among tools attached by the builder. Broader runtime discovery of unconfigured tools was not verified.',
        shortValue: 'Agent selects from configured tools',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/core-nodes/ai-agent-node/tools.md',
            label: 'StackAI: Tools',
            asOf: '2026-09-04',
          },
        ],
      },
      modelFallback: {
        value:
          'Yes: optional LLM Fallback Mode switches to a chosen backup provider and model after primary-model failures and retries.',
        shortValue: 'Yes, configurable backup model and provider',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/core-nodes/ai-agent-node/advanced-settings.md',
            label: 'StackAI: Advanced Settings',
            asOf: '2026-09-04',
          },
        ],
        detail: 'Fallback and Retry on Failure are off by default.',
      },
      agentSkills: {
        value:
          'Yes: reusable, versioned skills load instructions on demand and support Agent Skills-compatible SKILL.md ZIP import and export.',
        shortValue: 'Yes, portable skills with on-demand loading',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/utils-logic-and-others/bonus-features/skills.md',
            label: 'StackAI: Skills',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Skills can include supporting files and integrations. Everyone in the organization can use them; creators and admins can edit them. Supporting files require the Terminal tool.',
      },
      nativeChatDeployment: {
        value:
          'Yes: hosted Chat Assistant and embedded Website Chatbot interfaces, alongside forms, API, Slack, and Teams deployment.',
        shortValue: 'Yes, hosted and embedded chat',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/interface-and-deployment/end-user-interfaces',
            label: 'StackAI: End-User Interfaces',
            asOf: '2026-09-04',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          'Yes: Knowledge Base search returns content chunks or document snippets with optional metadata.',
        shortValue: 'Yes, retrieved chunks and metadata',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/apps/knowledge-base',
            label: 'StackAI: Knowledge Base',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'This verifies chunk-level retrieval output, not a particular document-preview or indexing-debug interface.',
      },
      parallelExecution: {
        value:
          'AI Agents can call independent Subflow Tools in parallel. A general-purpose deterministic fan-out/fan-in container was not verified.',
        shortValue: 'Parallel Subflow Tools; general join container unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/core-nodes/ai-agent-node/subflow-tools',
            label: 'StackAI: Subflow Tools',
            asOf: '2026-09-04',
          },
        ],
      },
      a2aProtocol: {
        value:
          'Unknown: native Agent2Agent protocol support was not verified in the reviewed documentation.',
        shortValue: 'A2A support unverified',
        confidence: 'unknown',
        sources: [],
      },
      loopIteration: {
        value:
          'Yes: Loop Subflow processes a list, exposes the current item, and runs a Done branch after all items, aggregating explicitly emitted outputs.',
        shortValue: 'Yes, Loop and Done branches',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/utils-logic-and-others/logic/loop-subflow',
            label: 'StackAI: Loop Subflow',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value:
          'The documentation lists 70+ apps and services, plus Custom API and MCP connections.',
        shortValue: '70+ documented apps and services',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/apps',
            label: 'StackAI: Apps',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/workflow-builder/apps/mcp',
            label: 'StackAI: MCP',
            asOf: '2026-09-04',
          },
        ],
      },
      triggerTypes: {
        value:
          'Native app events, one-time and recurring schedules, workflow-completion events, and inbound HTTP calls through the API.',
        shortValue: 'App events, schedules, workflow completion, and HTTP',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/inputs/trigger-node.md',
            label: 'StackAI: Trigger Node',
            asOf: '2026-09-04',
          },
        ],
        detail: 'Triggers activate after the workflow is published.',
      },
      customCodeSteps: {
        value:
          'Yes: Code Node runs Python or TypeScript with an AI code assistant and custom dependencies.',
        shortValue: 'Yes, Python and TypeScript',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/utils-logic-and-others/logic/code-node',
            label: 'StackAI: Code Node',
            asOf: '2026-09-04',
          },
        ],
      },
      codeSandboxRuntime: {
        value:
          'Isolated code sandboxes support declared Python or TypeScript package dependencies. OS packages and custom runtime images were not verified.',
        shortValue: 'Isolated sandbox with declared package dependencies',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/utils-logic-and-others/logic/code-node',
            label: 'StackAI: Code Node',
            asOf: '2026-09-04',
          },
        ],
      },
      apiPublishing: {
        value:
          'Yes: published workflows expose a REST API with bearer authentication and Python, JavaScript, and cURL examples.',
        shortValue: 'Yes, authenticated REST API',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/interface-and-deployment/end-user-interfaces/api',
            label: 'StackAI: API',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/interface-and-deployment/api-reference/run-flow.md',
            label: 'StackAI: Run Flow',
            asOf: '2026-09-04',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'REST APIs, custom API tools, and the hosted MCP server support extension. A dedicated custom-node SDK or public plugin marketplace was not verified.',
        shortValue: 'REST, custom tools, and MCP',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.stackai.com/interface-and-deployment/end-user-interfaces/api',
            label: 'StackAI: API',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/interface-and-deployment/mcp-reference/stackai-mcp-server',
            label: 'StackAI: StackAI MCP Server',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/workflow-builder/core-nodes/ai-agent-node/tools.md',
            label: 'StackAI: Tools',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpPublishing: {
        value:
          'Yes: the hosted StackAI MCP server lets authorized external assistants run published workflows and manage permitted resources.',
        shortValue: 'Yes, workflows callable through hosted MCP',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/interface-and-deployment/mcp-reference/stackai-mcp-server',
            label: 'StackAI: StackAI MCP Server',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Access uses interactive StackAI sign-in and the connected user’s permissions; this is one hosted server, not a separately published server for every workflow.',
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Free plan and custom-quoted Enterprise subscriptions, with monthly run, project, and seat allowances.',
        shortValue: 'Free and custom-quoted Enterprise',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.stackai.com/pricing',
            label: 'StackAI Pricing – Plans for Teams & Enterprise',
            asOf: '2026-09-04',
          },
        ],
      },
      entryPaidPlan: {
        value:
          'Enterprise is custom quoted; the public pricing page does not publish a fixed paid entry price.',
        shortValue: 'Enterprise, custom quote',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.stackai.com/pricing',
            label: 'StackAI Pricing – Plans for Teams & Enterprise',
            asOf: '2026-09-04',
          },
        ],
      },
      freeTier: {
        value: 'Free: 500 runs per month, 2 projects, 1 seat, and community support on Discord.',
        shortValue: '500 monthly runs, 2 projects, 1 seat',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.stackai.com/pricing',
            label: 'StackAI Pricing – Plans for Teams & Enterprise',
            asOf: '2026-09-04',
          },
        ],
      },
      byok: {
        value: 'Yes: admins can configure LLM connections with their own API keys.',
        shortValue: 'Yes, administrator-managed LLM API keys',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/security-and-governance/security-in-stackai/feature-access',
            label: 'StackAI: Feature Access',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The documentation does not establish that bringing a key removes platform subscription or run charges.',
      },
    },
    security: {
      dataResidency: {
        value:
          'Enterprise can run in a customer VPC or on-premise, including local LLMs. Model and integration choices determine where data is sent.',
        shortValue: 'Enterprise VPC/on-premise and local LLM options',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/security-and-governance/on-premise.md',
            label: 'StackAI: On-Premise',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.stackai.com/pricing',
            label: 'StackAI Pricing – Plans for Teams & Enterprise',
            asOf: '2026-09-04',
          },
        ],
      },
      rbac: {
        value:
          'Yes: organization roles, groups, private folders, publishing controls, and per-resource permissions.',
        shortValue: 'Yes, roles, groups, folders, and resource permissions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/security-and-governance/ai-governance',
            label: 'StackAI: AI Governance',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/security-and-governance/security-in-stackai/workspace-and-folder-access',
            label: 'StackAI: Workspace and Folder Access',
            asOf: '2026-09-04',
          },
        ],
      },
      auditLogging: {
        value:
          'Yes: administrative activity logs are available through the MCP audit_logs_list tool; execution analytics are tracked separately.',
        shortValue: 'Yes, admin audit logs and separate execution analytics',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/interface-and-deployment/mcp-reference/stackai-mcp-server',
            label: 'StackAI: StackAI MCP Server',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/interface-and-deployment/api-reference/analytics.md',
            label: 'StackAI: Analytics',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The audit tool is for administrators and reports actions such as editing, exporting, or deleting resources.',
      },
      compliance: {
        value:
          'StackAI reports SOC 2 Type II and ISO 27001; it also states HIPAA and GDPR compliance.',
        shortValue: 'SOC 2 Type II and ISO 27001',
        confidence: 'verified',
        sources: [
          {
            url: 'https://trust.stackai.com/',
            label: 'StackAI | Trust Center',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.stackai.com/blog/soc2-type2-hipaa',
            label: 'Stack AI - SOC 2 Type II & HIPAA Compliant Platform',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.stackai.com/pricing',
            label: 'StackAI Pricing – Plans for Teams & Enterprise',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The Trust Center lists the audit and certificate, with full documents available on request. The HIPAA audit announcement covers March–May 2024. Public claims were checked; report scope and current coverage require the underlying documents.',
      },
      modelAndToolGovernance: {
        value:
          'Yes: Feature Access lets admins enable or disable individual LLMs, apps, tools, and knowledge bases for the organization.',
        shortValue: 'Yes, model, app, tool, and KB controls',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/security-and-governance/security-in-stackai/feature-access',
            label: 'StackAI: Feature Access',
            asOf: '2026-09-04',
          },
        ],
      },
      credentialGovernance: {
        value:
          'Yes: connections are private by default and can be shared with users or groups; admins can view and use all organization connections.',
        shortValue: 'Yes, connection sharing with users and groups',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/security-and-governance/security-in-stackai/connection-and-knowledge-base-permissions',
            label: 'StackAI: Connection and Knowledge Base Permissions',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Published workflows may use resources their end users cannot view directly. Sensitive workflows also need restricted folders and appropriate interface security.',
      },
      whiteLabeling: {
        value:
          'Published interfaces support custom names, logos, colors, and domains. Complete workspace-wide vendor-brand removal was not verified.',
        shortValue: 'Branded deployed interfaces; full workspace removal unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/overview/platform-overview',
            label: 'StackAI: Platform Overview',
            asOf: '2026-09-04',
          },
        ],
      },
      dataRetention: {
        value: 'Yes: the security documentation says organizations can define retention durations.',
        shortValue: 'Yes, organization-defined retention durations',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/security-and-governance/security-and-privacy',
            label: 'StackAI: Security & Privacy',
            asOf: '2026-09-04',
          },
          {
            url: 'https://trust.stackai.com/',
            label: 'StackAI | Trust Center',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The public sources do not specify every resource-specific range or plan restriction.',
      },
      piiRedaction: {
        value:
          'Yes: optional LLM-node PII controls detect email, phone, SSN, and credit-card data before model submission.',
        shortValue: 'Yes, optional PII warnings or reversible masking',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/core-nodes/ai-agent-node/advanced-settings.md',
            label: 'StackAI: Advanced Settings',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Off by default. Warning mode still sends the original value; Encrypt mode uses a placeholder and restores the original in output, so it is not permanent redaction of all logs or results.',
      },
      sso: {
        value:
          'Yes: SSO integrates with providers such as Okta and Entra ID; newly provisioned SSO users default to the User role.',
        shortValue: 'Yes, SSO and default-role provisioning',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/security-and-governance/ai-governance',
            label: 'StackAI: AI Governance',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/security-and-governance/security-in-stackai/authentication-and-mfa',
            label: 'StackAI: Authentication and MFA',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Admins can enforce SSO on published interfaces. Enterprise pricing lists SSO; protocol and deployment scope depend on configuration.',
      },
      sessionPolicy: {
        value:
          'Unknown: an administrator-configurable absolute session lifetime or inactivity timeout was not verified.',
        shortValue: 'Admin session lifetime controls unverified',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/security-and-governance/security-in-stackai/authentication-and-mfa',
            label: 'StackAI: Authentication and MFA',
            asOf: '2026-09-04',
          },
        ],
      },
      thirdPartyVetting: {
        value:
          'The platform supplies app integrations and supports customer-configured MCP servers, custom API tools, and imported skills. A universal vendor-vetting guarantee was not verified.',
        shortValue: 'Vendor integrations plus customer-configured extensions',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/apps',
            label: 'StackAI: Apps',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/workflow-builder/apps/mcp',
            label: 'StackAI: MCP',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/workflow-builder/utils-logic-and-others/bonus-features/skills.md',
            label: 'StackAI: Skills',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Analytics expose usage, latency, tokens, and run details; governance docs describe per-step traces including inputs, knowledge-base hits, and outputs.',
        shortValue: 'Run analytics and per-step traces',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/security-and-governance/ai-governance',
            label: 'StackAI: AI Governance',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/interface-and-deployment/api-reference/analytics.md',
            label: 'StackAI: Analytics',
            asOf: '2026-09-04',
          },
        ],
      },
      durabilityModel: {
        value:
          'Optional LLM retries and backup models handle transient errors; whole-run checkpoint recovery and replay guarantees were not verified.',
        shortValue: 'Configurable retries and model fallback',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/core-nodes/ai-agent-node/advanced-settings.md',
            label: 'StackAI: Advanced Settings',
            asOf: '2026-09-04',
          },
        ],
      },
      failureAlerting: {
        value:
          'Yes: email and in-app alerts fire after repeated failures, with organization and per-workflow thresholds.',
        shortValue: 'Yes, configurable failure alerts',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/security-and-governance/security-in-stackai/workflow-notifications.md',
            label: 'StackAI: Workflow Notifications',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The default threshold is three consecutive failures. Recipients default to the creator and organization admins and can be customized.',
      },
      dataDrains: {
        value:
          'Governance docs describe scheduled analytics exports and customer-webhook delivery for selected security use cases.',
        shortValue: 'Scheduled exports and webhook delivery',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/security-and-governance/ai-governance',
            label: 'StackAI: AI Governance',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'A universal continuous streaming drain and its availability by plan were not verified.',
      },
      asyncExecution: {
        value:
          'Background workflows are an administrator-controlled feature; a documented asynchronous run-submission and polling API contract was not verified.',
        shortValue: 'Background workflows; async API contract unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/security-and-governance/security-in-stackai/feature-access',
            label: 'StackAI: Feature Access',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/interface-and-deployment/api-reference/run-flow.md',
            label: 'StackAI: Run Flow',
            asOf: '2026-09-04',
          },
        ],
      },
      executionLimits: {
        value:
          'Unknown: a maximum workflow duration or concurrency ceiling was not verified. The free plan’s 500 monthly runs are a usage quota, not either limit.',
        shortValue: 'Duration and concurrency ceilings unverified',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://www.stackai.com/pricing',
            label: 'StackAI Pricing – Plans for Teams & Enterprise',
            asOf: '2026-09-04',
          },
        ],
      },
      partialFailureHandling: {
        value: 'Yes: optional fallback branches route node errors to alternate workflow paths.',
        shortValue: 'Yes, configurable error branches',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/guides-and-tips/stackai-hacks/handling-errors-and-fallback.md',
            label: 'StackAI: Handling Errors & Fallback',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/workflow-builder/utils-logic-and-others/logic/code-node',
            label: 'StackAI: Code Node',
            asOf: '2026-09-04',
          },
        ],
      },
      unattendedExecution: {
        value:
          'Yes: published workflows run automatically on schedules or connected application events using the deployed service.',
        shortValue: 'Yes, published event and scheduled workflows',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/workflow-builder/inputs/trigger-node.md',
            label: 'StackAI: Trigger Node',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/welcome-to-stackai/security-and-governance/on-premise.md',
            label: 'StackAI: On-Premise',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Free includes Discord community support; Enterprise includes dedicated solution engineers.',
        shortValue: 'Discord community; Enterprise solution engineers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.stackai.com/pricing',
            label: 'StackAI Pricing – Plans for Teams & Enterprise',
            asOf: '2026-09-04',
          },
        ],
      },
      sla: {
        value:
          'Unknown: binding uptime or support-response commitments were not verified in the public pricing and documentation.',
        shortValue: 'Contractual SLA unverified',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://www.stackai.com/pricing',
            label: 'StackAI Pricing – Plans for Teams & Enterprise',
            asOf: '2026-09-04',
          },
        ],
      },
      community: {
        value: 'Community Discord, public documentation, and StackAI Academy learning resources.',
        shortValue: 'Discord, documentation, and Academy',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.stackai.com/pricing',
            label: 'StackAI Pricing – Plans for Teams & Enterprise',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.stackai.com/getting-started/learning/stackai-academy',
            label: 'StackAI: StackAI Academy',
            asOf: '2026-09-04',
          },
        ],
      },
      companyMaturity: {
        value: 'Asana announced its completed acquisition of StackAI on May 28, 2026.',
        shortValue: 'Acquired by Asana in May 2026',
        confidence: 'verified',
        sources: [
          {
            url: 'https://investors.asana.com/news-releases/news-release-details/asana-acquires-stackai-adding-cross-system-execution-human-agent',
            label: 'Asana acquisition announcement',
            asOf: '2026-09-04',
          },
        ],
      },
      academy: {
        value:
          'Yes: StackAI Academy provides video modules covering workflow building, agents, data, interfaces, and governance.',
        shortValue: 'Yes, structured Academy video modules',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.stackai.com/getting-started/learning/stackai-academy',
            label: 'StackAI: StackAI Academy',
            asOf: '2026-09-04',
          },
        ],
      },
    },
  },
}
