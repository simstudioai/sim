import { FlowiseIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Reviewed against current primary sources on 2026-09-04; uncertainty is labeled. */
export const flowiseProfile: CompetitorProfile = {
  id: 'flowise',
  name: 'Flowise',
  website: 'https://flowiseai.com',
  brand: {
    icon: FlowiseIcon,
    selfFramed: true,
    colors: ['#5D5DFF', '#1F1F2E'],
    source: 'GitHub organization avatar',
    asOf: '2026-07-02',
  },
  oneLiner:
    'Flowise is a visual AI-agent and RAG builder whose official project reached end of life on August 31, 2026; its archived source remains available for self-maintained deployments.',
  standoutFeatures: [
    {
      title: 'Forkable code for self-maintained deployments',
      description:
        'The Apache-2.0 portions remain available to fork after official end of life. Teams adopting the code now take responsibility for maintenance and updates.',
      shortDescription: 'Forkable core with operator-owned maintenance after end of life.',
      source: {
        url: 'https://flowiseai.com/sunset',
        label: 'Flowise: Official sunset and end-of-life notice',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Document Store inspection',
      description:
        'Document Stores let users preview and refine chunks, configure embeddings and vector storage, and test retrieval before using the data in a flow.',
      shortDescription: 'Prepare, inspect, and test RAG document chunks.',
      source: {
        url: 'https://docs.flowiseai.com/using-flowise/document-stores',
        label: 'Flowise: Document Stores',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Checkpointed human review',
      description:
        'Agentflow V2 supports Human Input nodes and tool approvals, saving checkpoints so paused runs can resume after a decision and application restart.',
      shortDescription: 'Human approval with persisted checkpoints.',
      source: {
        url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
        label: 'Flowise: Agentflow V2',
        asOf: '2026-09-04',
      },
    },
  ],
  limitations: [
    {
      title: 'Official project has reached end of life',
      description:
        'The sunset notice ended feature development on July 29 and official core-team community presence on August 31, 2026. Existing installations require their own maintenance plan.',
      shortDescription: 'Official development and core-team support have ended.',
      source: {
        url: 'https://flowiseai.com/sunset',
        label: 'Flowise: Official sunset and end-of-life notice',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Commercial service status needs confirmation',
      description:
        'The end-of-life notice does not establish continued commercial sales or support, or a separate Cloud shutdown date. Historical commercial capabilities should be checked against an existing agreement.',
      shortDescription: 'Legacy Cloud listings do not confirm current service availability.',
      source: {
        url: 'https://flowiseai.com/sunset',
        label: 'Flowise: Official sunset and end-of-life notice',
        asOf: '2026-09-04',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'Visual Chatflow and Agentflow canvases connect model, tool, retrieval, and control nodes. Custom JavaScript extends the archived implementation.',
        shortValue: 'Visual canvas with custom JavaScript',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
            label: 'Flowise: Agentflow V2',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/FlowiseAI/Flowise',
            label: 'Flowise: Archived source repository',
            asOf: '2026-09-04',
          },
        ],
      },
      learningCurve: {
        value:
          'Templates support initial exploration; custom JavaScript, provider credentials, and operating an unmaintained deployment require technical skills. This is an editorial assessment.',
        shortValue: 'Technical skills needed for self-maintained production use',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.flowiseai.com/integrations/langchain/tools/custom-tool',
            label: 'Flowise: Custom Tool and dependencies',
            asOf: '2026-09-04',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-04',
          },
        ],
      },
      selfHostOption: {
        value:
          'Yes: the archived source supports self-hosting, including Docker. Operators must maintain their deployment after official end of life; commercial modules retain separate license terms.',
        shortValue: 'Yes, archived code; operator maintenance required',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/FlowiseAI/Flowise',
            label: 'Flowise: Archived source repository',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/FlowiseAI/Flowise/blob/main/LICENSE.md',
            label: 'Flowise: Apache-2.0 and Commercial License scope',
            asOf: '2026-09-04',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-04',
          },
        ],
      },
      deploymentOptions: {
        value:
          'Self-hosted Node.js and Docker deployments remain documented. Cloud and commercial deployments were offered, but continued managed-service availability after end of life is not verified.',
        shortValue: 'Self-hosted code; current managed service status unverified',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/FlowiseAI/Flowise',
            label: 'Flowise: Archived source repository',
            asOf: '2026-09-04',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-04',
          },
        ],
      },
      templates: {
        value:
          'Yes: archived releases include Marketplace templates; the Custom Tool tutorial starts from an OpenAI Function Agent template. Template availability does not establish ongoing maintenance or production suitability.',
        shortValue: 'Yes, Marketplace templates in archived releases',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/integrations/langchain/tools/custom-tool',
            label: 'Flowise: Custom Tool and dependencies',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/FlowiseAI/Flowise',
            label: 'Flowise: Archived source repository',
            asOf: '2026-09-04',
          },
        ],
      },
      license: {
        value:
          'Apache-2.0 applies outside the enterprise directory and explicitly excluded files. Enterprise code uses a Commercial License, and third-party components keep their own licenses.',
        shortValue: 'Apache-2.0 core; separately licensed commercial modules',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/FlowiseAI/Flowise/blob/main/LICENSE.md',
            label: 'Flowise: Apache-2.0 and Commercial License scope',
            asOf: '2026-09-04',
          },
        ],
      },
      environmentPromotion: {
        value:
          'Unknown: a native whole-workspace dev/QA/production promotion workflow was not verified.',
        shortValue: 'Not verified in reviewed documentation',
        confidence: 'unknown',
        sources: [],
      },
      versionControlDepth: {
        value:
          'Unknown: shipped automatic flow snapshots and restoration were not verified in the retained release documentation.',
        shortValue: 'Not verified in reviewed documentation',
        confidence: 'unknown',
        sources: [],
      },
      realtimeCollaboration: {
        value:
          'Unknown: simultaneous canvas editing with live cursors and synchronized operations was not verified. Commercial workspaces establish access control, not this capability.',
        shortValue: 'Live collaborative canvas editing unverified',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/workspaces',
            label: 'Flowise: Commercial workspaces and permissions',
            asOf: '2026-09-04',
          },
        ],
      },
      nativeFileStorage: {
        value:
          'Partial: Document Stores manage uploaded content, ingestion, and chunks. A general file drive with sharing links, folders, and deleted-item recovery was not verified.',
        shortValue: 'Document ingestion storage; general file drive unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/document-stores',
            label: 'Flowise: Document Stores',
            asOf: '2026-09-04',
          },
        ],
      },
      dataTables: {
        value:
          'Unknown: a native persistent spreadsheet-style table UI with documented row limits was not verified.',
        shortValue: 'Not verified in reviewed documentation',
        confidence: 'unknown',
        sources: [],
      },
      richTextEditor: {
        value: 'Unknown: an in-app rich-text document editor was not verified.',
        shortValue: 'Not verified in reviewed documentation',
        confidence: 'unknown',
        sources: [],
      },
      subWorkflows: {
        value:
          'Yes: Execute Flow calls a saved Chatflow or Agentflow, passes input and optional overrides, and receives output. It can specify an alternative Flowise base URL and authentication.',
        shortValue: 'Yes, Execute Flow with optional remote base URL',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
            label: 'Flowise: Agentflow V2',
            asOf: '2026-09-04',
          },
        ],
      },
      customBlocks: {
        value:
          'Partial: saved Custom Tools can be reused by Agent or Tool nodes, and Execute Flow composes saved workflows. A centrally versioned, credential-hidden workflow block in an organization palette was not verified.',
        shortValue: 'Reusable custom tools and flow calls',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/tutorials/tools-and-mcp',
            label: 'Flowise: Tools and MCP',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
            label: 'Flowise: Agentflow V2',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Yes: documented model integrations include OpenAI, Anthropic, Azure, Bedrock, Google, Ollama, and other providers. Compatibility depends on the archived implementation and provider APIs.',
        shortValue: 'Multiple hosted and local model integrations',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/integrations/langchain/chat-models',
            label: 'Flowise: Chat model integrations',
            asOf: '2026-09-04',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          'Yes: Agentflow V2 includes LLM-driven Agent nodes that choose configured tools or knowledge sources, alongside deterministic workflow nodes.',
        shortValue: 'Yes, agent reasoning and tool-use nodes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
            label: 'Flowise: Agentflow V2',
            asOf: '2026-09-04',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          'Unknown: a native prompt-to-flow builder was not verified in the retained release documentation.',
        shortValue: 'Not verified in reviewed documentation',
        confidence: 'unknown',
        sources: [],
      },
      knowledgeBaseRag: {
        value:
          'Yes: Document Stores cover loaders, chunking, embeddings, vector-store upsertion, and retrieval testing, with APIs to refresh content.',
        shortValue: 'Yes, Document Store ingestion and retrieval',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/document-stores',
            label: 'Flowise: Document Stores',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpSupport: {
        value:
          'Yes: Custom MCP connects external servers and imports available actions. Streamable HTTP is recommended; local stdio requires suitable host process/package access.',
        shortValue: 'Yes, external MCP client with configurable actions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/tutorials/tools-and-mcp',
            label: 'Flowise: Tools and MCP',
            asOf: '2026-09-04',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'Partial: dataset evaluations are documented for commercial Cloud/Enterprise editions, with text, numeric, and LLM scoring. Integration docs also list moderation nodes; current commercial availability needs confirmation after end of life.',
        shortValue: 'Commercial evaluations and moderation integrations',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/evaluations',
            label: 'Flowise: Commercial evaluations',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.flowiseai.com/integrations/langchain/moderation',
            label: 'Flowise: Moderation nodes',
            asOf: '2026-09-04',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-04',
          },
        ],
      },
      humanInTheLoop: {
        value:
          'Yes: Human Input and optional agent tool approval pause execution, save a checkpoint, and resume after approval or rejection.',
        shortValue: 'Yes, checkpointed approval and rejection paths',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
            label: 'Flowise: Agentflow V2',
            asOf: '2026-09-04',
          },
        ],
      },
      generativeMedia: {
        value:
          'Unknown: a comprehensive native image/video/audio generation suite was not verified. Documented image inputs and audio transcription are input-processing features.',
        shortValue: 'Generation suite unverified; multimodal inputs documented',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/prediction',
            label: 'Flowise: Prediction API and official SDKs',
            asOf: '2026-09-04',
          },
        ],
      },
      dynamicToolUse: {
        value:
          'Partial: agents choose from configured tools at runtime. Custom MCP refreshes the connected server’s available actions; discovery beyond configured servers was not verified.',
        shortValue: 'Runtime selection from configured tools and MCP actions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
            label: 'Flowise: Agentflow V2',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.flowiseai.com/tutorials/tools-and-mcp',
            label: 'Flowise: Tools and MCP',
            asOf: '2026-09-04',
          },
        ],
      },
      modelFallback: {
        value:
          'Unknown: automatic failover to a different model or provider after a failed call was not verified.',
        shortValue: 'Not verified in reviewed documentation',
        confidence: 'unknown',
        sources: [],
      },
      agentSkills: {
        value:
          'Unknown: a reusable named skill library loaded by reference across agents was not verified.',
        shortValue: 'Not verified in reviewed documentation',
        confidence: 'unknown',
        sources: [],
      },
      nativeChatDeployment: {
        value:
          'Yes: the archived implementation supports an embedded chat widget connected to a Flowise-hosted flow, alongside the Prediction API. Current vendor hosting is not assumed.',
        shortValue: 'Yes, chat embed backed by a running Flowise server',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/embed',
            label: 'Flowise: Embed and theming',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.flowiseai.com/using-flowise/prediction',
            label: 'Flowise: Prediction API and official SDKs',
            asOf: '2026-09-04',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          'Yes: Document Stores support previewing and editing individual chunks and testing retrieval queries with returned chunks.',
        shortValue: 'Yes, chunk editing and retrieval-query inspection',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/document-stores',
            label: 'Flowise: Document Stores',
            asOf: '2026-09-04',
          },
        ],
      },
      parallelExecution: {
        value:
          'Unknown: native concurrent branch-and-join execution was not verified. The documented Iteration node processes items sequentially; queue workers can run separate predictions concurrently.',
        shortValue: 'Concurrent branches unverified; workers handle parallel predictions',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
            label: 'Flowise: Agentflow V2',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.flowiseai.com/configuration/running-flowise-using-queue',
            label: 'Flowise: Queue workers and concurrency',
            asOf: '2026-09-04',
          },
        ],
      },
      a2aProtocol: {
        value:
          'Unknown: native Agent2Agent protocol endpoints or agent-card discovery were not verified. Multi-agent orchestration is not itself proof of A2A protocol support.',
        shortValue: 'Not verified in reviewed documentation',
        confidence: 'unknown',
        sources: [],
      },
      loopIteration: {
        value:
          'Yes: Iteration executes nested steps sequentially for each array item. Loop jumps back to an earlier node and has a configurable maximum loop count.',
        shortValue: 'Yes, sequential iteration and bounded backward loops',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
            label: 'Flowise: Agentflow V2',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value:
          'The archived integration catalog covers model providers, tools, embeddings, vector stores, loaders, and other node categories. A current exact count was not independently established.',
        shortValue: 'Broad node categories; exact count not verified',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/integrations',
            label: 'Flowise: Integration categories',
            asOf: '2026-09-04',
          },
        ],
      },
      triggerTypes: {
        value:
          'Chat or form input and Prediction API calls invoke flows. A native scheduler or broad app-event trigger catalog was not verified.',
        shortValue: 'Chat, form, and Prediction API calls',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
            label: 'Flowise: Agentflow V2',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.flowiseai.com/using-flowise/prediction',
            label: 'Flowise: Prediction API and official SDKs',
            asOf: '2026-09-04',
          },
        ],
      },
      customCodeSteps: {
        value:
          'Yes: Custom Function and Custom Tool run server-side JavaScript with configured inputs and flow context.',
        shortValue: 'Yes, JavaScript functions and custom tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
            label: 'Flowise: Agentflow V2',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.flowiseai.com/tutorials/tools-and-mcp',
            label: 'Flowise: Tools and MCP',
            asOf: '2026-09-04',
          },
        ],
      },
      codeSandboxRuntime: {
        value:
          'Self-hosted operators configure allowed Node.js modules through environment variables. Adding external dependencies may require modifying packages/components, rebuilding, and restarting; host and package controls are deployment responsibilities.',
        shortValue: 'Operator-configured Node modules; rebuild for additional dependencies',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/configuration/environment-variables',
            label: 'Flowise: Server environment variables',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.flowiseai.com/integrations/langchain/tools/custom-tool',
            label: 'Flowise: Custom Tool and dependencies',
            asOf: '2026-09-04',
          },
        ],
      },
      apiPublishing: {
        value:
          'Yes: POST /api/v1/prediction/:id invokes a flow, with streaming, session context, file inputs, and human-input resume supported.',
        shortValue: 'Yes, Prediction API with streaming and session context',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/prediction',
            label: 'Flowise: Prediction API and official SDKs',
            asOf: '2026-09-04',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Yes: official Python and TypeScript/JavaScript prediction SDKs, a chat embed package, and custom-node development instructions remain documented. These belong to the sunset project.',
        shortValue: 'Python/TypeScript SDKs, embed, and custom nodes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/prediction',
            label: 'Flowise: Prediction API and official SDKs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.flowiseai.com/contributing/building-node',
            label: 'Flowise: Building nodes',
            asOf: '2026-09-04',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpPublishing: {
        value:
          'Unknown: native publishing of a Flowise flow as an MCP server was not verified. The retained documentation demonstrates consuming external MCP servers.',
        shortValue: 'Native flow-to-MCP publishing unverified',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.flowiseai.com/tutorials/tools-and-mcp',
            label: 'Flowise: Tools and MCP',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'The Apache-2.0 portions can be self-hosted with operator-funded infrastructure and provider usage. Legacy Cloud pricing is prediction/storage based, but current sales and service terms after end of life are unverified.',
        shortValue: 'Free core; legacy Cloud terms require confirmation',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/FlowiseAI/Flowise/blob/main/LICENSE.md',
            label: 'Flowise: Apache-2.0 and Commercial License scope',
            asOf: '2026-09-04',
          },
          {
            url: 'https://flowiseai.com/',
            label: 'Flowise: Product and legacy displayed pricing',
            asOf: '2026-09-04',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-04',
          },
        ],
      },
      entryPaidPlan: {
        value:
          'Unknown: current paid service availability is unverified. The website still lists Starter at $35/month, 10,000 monthly predictions and 1GB storage, but that legacy listing is not proof of an active supported offer.',
        shortValue: 'Legacy $35/month listing; current availability unverified',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://flowiseai.com/',
            label: 'Flowise: Product and legacy displayed pricing',
            asOf: '2026-09-04',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-04',
          },
        ],
      },
      freeTier: {
        value:
          'Yes for the Apache-2.0 source, excluding infrastructure and provider costs. The website’s legacy Free Cloud listing is 2 flows, 100 monthly predictions and 5MB storage; current Cloud availability is unverified.',
        shortValue: 'Free source; legacy Cloud availability unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/FlowiseAI/Flowise/blob/main/LICENSE.md',
            label: 'Flowise: Apache-2.0 and Commercial License scope',
            asOf: '2026-09-04',
          },
          {
            url: 'https://flowiseai.com/',
            label: 'Flowise: Product and legacy displayed pricing',
            asOf: '2026-09-04',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-04',
          },
        ],
      },
      byok: {
        value:
          'Yes: model credentials are configured in Flowise, with credential encryption controlled by the server secret. Provider usage and any applicable infrastructure or service fees remain separate.',
        shortValue: 'Yes, user-configured provider credentials',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/configuration/environment-variables',
            label: 'Flowise: Server environment variables',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.flowiseai.com/using-flowise/document-stores',
            label: 'Flowise: Document Stores',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    security: {
      dataResidency: {
        value:
          'Self-hosted operators choose infrastructure and storage locations. External model, vector-store, tool, and MCP calls can still send data elsewhere. Current managed-cloud residency options were not verified.',
        shortValue: 'Self-host location control; external calls remain relevant',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/FlowiseAI/Flowise',
            label: 'Flowise: Archived source repository',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.flowiseai.com/using-flowise/document-stores',
            label: 'Flowise: Document Stores',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.flowiseai.com/tutorials/tools-and-mcp',
            label: 'Flowise: Tools and MCP',
            asOf: '2026-09-04',
          },
        ],
      },
      rbac: {
        value:
          'Yes in documented commercial Workspaces: roles define resource permissions and workspace membership. This is not Apache-core entitlement; current commercial support after end of life needs confirmation.',
        shortValue: 'Commercial workspace roles; current support requires confirmation',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/workspaces',
            label: 'Flowise: Commercial workspaces and permissions',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/FlowiseAI/Flowise/blob/main/LICENSE.md',
            label: 'Flowise: Apache-2.0 and Commercial License scope',
            asOf: '2026-09-04',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-04',
          },
        ],
      },
      auditLogging: {
        value:
          'Partial: commercial Workspaces document login and logout activity visible to account administrators. A comprehensive action-by-action audit trail was not verified.',
        shortValue: 'Commercial login activity; broader audit coverage unverified',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/workspaces',
            label: 'Flowise: Commercial workspaces and permissions',
            asOf: '2026-09-04',
          },
        ],
      },
      compliance: {
        value:
          'Unknown: a Flowise-specific SOC 2 report, ISO 27001 certificate, or other vendor attestation was not verified. Self-hosting alone does not establish compliance.',
        shortValue: 'Vendor certification coverage unverified',
        confidence: 'unknown',
        sources: [],
      },
      modelAndToolGovernance: {
        value:
          'Partial: self-hosted operators can supply a model-list configuration, disable nodes, and configure HTTP/MCP restrictions. Role-specific model/provider allowlists were not verified.',
        shortValue: 'Server-level model, node, and MCP controls',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/configuration/environment-variables',
            label: 'Flowise: Server environment variables',
            asOf: '2026-09-04',
          },
        ],
      },
      credentialGovernance: {
        value:
          'Partial: commercial Workspaces support sharing credentials to selected workspaces. Sharing requires the corresponding permission; recipients cannot edit the shared credential.',
        shortValue: 'Permission-controlled credential sharing between commercial workspaces',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/workspaces',
            label: 'Flowise: Commercial workspaces and permissions',
            asOf: '2026-09-04',
          },
        ],
      },
      whiteLabeling: {
        value:
          'Partial: the embed supports custom icons, titles, colors, messages, footer settings, CSS, and source modifications. Full-builder organization-wide rebranding was not verified.',
        shortValue: 'Extensive embed customization; full-builder rebranding unverified',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/embed',
            label: 'Flowise: Embed and theming',
            asOf: '2026-09-04',
          },
        ],
      },
      dataRetention: {
        value:
          'Partial: self-hosted queue examples expose completed-job age/count cleanup settings. A unified organization policy for execution, audit, and deleted-resource retention was not verified.',
        shortValue: 'Queue cleanup controls; organization retention policy unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.flowiseai.com/configuration/running-flowise-using-queue',
            label: 'Flowise: Queue workers and concurrency',
            asOf: '2026-09-04',
          },
        ],
      },
      piiRedaction: {
        value:
          'Unknown: automatic PII redaction across workflow content and retained logs was not verified. Content moderation is a separate capability.',
        shortValue: 'Not verified in reviewed documentation',
        confidence: 'unknown',
        sources: [],
      },
      sso: {
        value:
          'Yes in the documented Enterprise edition: Microsoft, Google, and Auth0 SSO require users to be invited with a workspace and role before sign-in. Current commercial availability needs confirmation.',
        shortValue: 'Enterprise SSO; invitations required',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/configuration/sso',
            label: 'Flowise: Enterprise SSO',
            asOf: '2026-09-04',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-04',
          },
        ],
      },
      sessionPolicy: {
        value:
          'Partial: self-hosted server variables configure access- and refresh-token lifetimes and token invalidation on restart. An organization-admin inactivity timeout was not verified.',
        shortValue: 'Server-configured JWT expiry and restart invalidation',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/configuration/authorization/app-level',
            label: 'Flowise: Application authentication',
            asOf: '2026-09-04',
          },
        ],
      },
      thirdPartyVetting: {
        value:
          'The archived code supports custom nodes and external MCP servers. Official development and PR review ended under the sunset plan, so operators must review and maintain any retained or added executable code.',
        shortValue: 'Archived project; operator review and maintenance required',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/contributing/building-node',
            label: 'Flowise: Building nodes',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.flowiseai.com/tutorials/tools-and-mcp',
            label: 'Flowise: Tools and MCP',
            asOf: '2026-09-04',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Yes: the Langfuse integration traces Flowise interactions from the UI, API, and embeds. Built-in Prometheus/OpenTelemetry monitoring primarily covers aggregate API and runtime metrics.',
        shortValue: 'External execution traces plus aggregate runtime metrics',
        confidence: 'verified',
        sources: [
          {
            url: 'https://langfuse.com/integrations/no-code/flowise',
            label: 'Langfuse: Flowise tracing integration',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.flowiseai.com/using-flowise/monitoring',
            label: 'Flowise: Prometheus and OpenTelemetry monitoring',
            asOf: '2026-09-04',
          },
        ],
      },
      durabilityModel: {
        value:
          'Partial: Agentflow V2 saves human-input checkpoints and documents resuming them after an application restart. General automatic crash recovery or replay for every node was not verified.',
        shortValue: 'Persisted human-input checkpoints; broader recovery unverified',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
            label: 'Flowise: Agentflow V2',
            asOf: '2026-09-04',
          },
        ],
      },
      failureAlerting: {
        value:
          'Partial: documented Prometheus/Grafana monitoring can feed externally configured alerting. Native per-run failure or cost-threshold notifications were not verified.',
        shortValue: 'External monitoring alerts; native run notifications unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/monitoring',
            label: 'Flowise: Prometheus and OpenTelemetry monitoring',
            asOf: '2026-09-04',
          },
        ],
      },
      dataDrains: {
        value:
          'Partial: server logs can stream to S3 or Google Cloud Logging, traces to Langfuse, and metrics to OpenTelemetry collectors with Datadog/Prometheus exporters. A unified audit/usage export service was not verified.',
        shortValue: 'Log, trace, and metric exports to external destinations',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/configuration/environment-variables',
            label: 'Flowise: Server environment variables',
            asOf: '2026-09-04',
          },
          {
            url: 'https://langfuse.com/integrations/no-code/flowise',
            label: 'Langfuse: Flowise tracing integration',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.flowiseai.com/using-flowise/monitoring',
            label: 'Flowise: Prometheus and OpenTelemetry monitoring',
            asOf: '2026-09-04',
          },
        ],
      },
      asyncExecution: {
        value:
          'Partial: queue mode dispatches predictions to workers, but the documented HTTP request waits for the worker’s result. A submit-and-poll job API was not verified.',
        shortValue: 'Worker queues; HTTP request still waits for completion',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/configuration/running-flowise-using-queue',
            label: 'Flowise: Queue workers and concurrency',
            asOf: '2026-09-04',
          },
        ],
      },
      executionLimits: {
        value:
          'Self-hosted worker concurrency is configurable with WORKER_CONCURRENCY, and Loop nodes have a maximum iteration setting. No universal wall-clock or supported Cloud concurrency guarantee was verified.',
        shortValue: 'Configurable worker concurrency and loop caps',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.flowiseai.com/configuration/running-flowise-using-queue',
            label: 'Flowise: Queue workers and concurrency',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
            label: 'Flowise: Agentflow V2',
            asOf: '2026-09-04',
          },
        ],
      },
      partialFailureHandling: {
        value:
          'Unknown: a general exception-catching branch for failed nodes was not verified. Condition routing and human rejection paths do not establish automatic error recovery.',
        shortValue: 'Not verified in reviewed documentation',
        confidence: 'unknown',
        sources: [],
      },
      unattendedExecution: {
        value:
          'Server and worker deployments process API-triggered runs without an interactive desktop UI. They must remain running; client-disconnect behavior and built-in scheduling were not verified.',
        shortValue: 'Server/worker execution; connection and scheduling guarantees unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.flowiseai.com/configuration/running-flowise-using-queue',
            label: 'Flowise: Queue workers and concurrency',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'The sunset notice ends official core-team presence on GitHub and Discord on August 31, 2026. Community-led forks or any separate commercial agreement must be assessed independently.',
        shortValue: 'Official core-team support ended August 31, 2026',
        confidence: 'verified',
        sources: [
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-04',
          },
        ],
      },
      sla: {
        value:
          'Unknown: a current enforceable uptime or support SLA was not verified after the sunset; applicable commitments require a specific agreement.',
        shortValue: 'Current contractual SLA unverified',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-04',
          },
        ],
      },
      community: {
        value:
          'The repository is read-only and shows an actual archival date of August 13, 2026. The sunset notice encourages forks; continued community activity is not a vendor support commitment.',
        shortValue: 'Archived repository; community-led maintenance encouraged',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/FlowiseAI/Flowise',
            label: 'Flowise: Archived source repository',
            asOf: '2026-09-04',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-04',
          },
        ],
      },
      companyMaturity: {
        value:
          'Workday announced its acquisition of Flowise in August 2025. Flowise subsequently announced a wind-down, with official end of life on August 31, 2026.',
        shortValue: 'Workday acquisition followed by August 2026 end of life',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.prnewswire.com/news-releases/workday-acquires-flowise-bringing-powerful-ai-agent-builder-capabilities-to-the-workday-platform-302530557.html',
            label: 'Workday: Acquisition of Flowise announcement',
            asOf: '2026-09-04',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-04',
          },
        ],
      },
      academy: {
        value:
          'Official documentation, video tutorials, and recorded webinars remain accessible. A current vendor certification or maintained academy program was not verified after end of life.',
        shortValue: 'Docs and recordings remain; current certification unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://flowiseai.com/',
            label: 'Flowise: Product and legacy displayed pricing',
            asOf: '2026-09-04',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-04',
          },
        ],
      },
    },
  },
}
