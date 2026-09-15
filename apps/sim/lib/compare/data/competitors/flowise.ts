import { FlowiseIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Reviewed against current primary sources on 2026-09-13; uncertainty is labeled. */
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
        asOf: '2026-09-13',
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
        asOf: '2026-09-13',
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
        asOf: '2026-09-13',
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
        asOf: '2026-09-13',
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
        asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://github.com/FlowiseAI/Flowise',
            label: 'Flowise: Archived source repository',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://github.com/FlowiseAI/Flowise/blob/main/LICENSE.md',
            label: 'Flowise: Apache-2.0 and Commercial License scope',
            asOf: '2026-09-13',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://github.com/FlowiseAI/Flowise',
            label: 'Flowise: Archived source repository',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
            label: 'Flowise: Agentflow V2',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          'Yes in archived source: Agentflow V2 includes a generator that accepts a natural-language request and selected chat model and returns validated nodes and edges. Current hosted availability and production reliability are not established.',
        shortValue: 'Archived Agentflow V2 prompt-to-flow generator',
        confidence: 'verified',
        sources: [
          {
            url: 'https://raw.githubusercontent.com/FlowiseAI/Flowise/main/packages/server/src/services/agentflowv2-generator/index.ts',
            label: 'Flowise: Archived Agentflow V2 generator',
            asOf: '2026-09-13',
          },
          {
            url: 'https://raw.githubusercontent.com/FlowiseAI/Flowise/main/packages/server/src/controllers/agentflowv2-generator/index.ts',
            label: 'Flowise: Generator request controller',
            asOf: '2026-09-13',
          },
        ],
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'Partial: dataset evaluations are documented for commercial Cloud/Enterprise editions, with text, numeric, and LLM scoring. Integration docs also list moderation nodes; current commercial availability needs confirmation after end of life.',
        shortValue: 'Commercial evaluations; current availability unverified',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/evaluations',
            label: 'Flowise: Commercial evaluations',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.flowiseai.com/integrations/langchain/moderation',
            label: 'Flowise: Moderation nodes',
            asOf: '2026-09-13',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
        ],
      },
      generativeMedia: {
        value:
          'Partial: the archived implementation includes streaming text-to-speech using OpenAI or ElevenLabs, alongside documented image inputs and audio transcription. A comprehensive native image/video generation suite was not verified.',
        shortValue: 'Archived OpenAI/ElevenLabs TTS; broader generation unverified',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/prediction',
            label: 'Flowise: Prediction API and official SDKs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://raw.githubusercontent.com/FlowiseAI/Flowise/main/packages/server/src/controllers/text-to-speech/index.ts',
            label: 'Flowise: Archived text-to-speech controller',
            asOf: '2026-09-13',
          },
          {
            url: 'https://raw.githubusercontent.com/FlowiseAI/Flowise/main/packages/server/src/services/text-to-speech/index.ts',
            label: 'Flowise: Text-to-speech providers',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.flowiseai.com/tutorials/tools-and-mcp',
            label: 'Flowise: Tools and MCP',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.flowiseai.com/using-flowise/prediction',
            label: 'Flowise: Prediction API and official SDKs',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
        ],
      },
      parallelExecution: {
        value:
          'Partial: deprecated Agentflow V1 Sequential Agents document concurrent branches within one workflow. Agentflow V2 Iteration processes items sequentially; V2 branch-and-join semantics were not verified. Queue workers can execute separate predictions concurrently.',
        shortValue: 'Legacy V1 concurrent branches; V2 branch/join unverified',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
            label: 'Flowise: Agentflow V2',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.flowiseai.com/configuration/running-flowise-using-queue',
            label: 'Flowise: Queue workers and concurrency',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.flowiseai.com/using-flowise/agentflowv1/sequential-agents',
            label: 'Flowise: Deprecated V1 Sequential Agents',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
        ],
      },
      triggerTypes: {
        value:
          'Chat/form inputs and Prediction API calls invoke eligible flows. Archived Flowise 3.1.3 also includes native Agentflow V2 schedules and webhook triggers. A broad app-specific event-trigger catalog was not verified.',
        shortValue: 'Chat/form/API; archived 3.1.3 schedules and webhooks',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
            label: 'Flowise: Agentflow V2',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.flowiseai.com/using-flowise/prediction',
            label: 'Flowise: Prediction API and official SDKs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://github.com/FlowiseAI/Flowise/releases/tag/flowise@3.1.3',
            label: 'Flowise: 3.1.3 release notes',
            asOf: '2026-09-13',
          },
          {
            url: 'https://github.com/FlowiseAI/Flowise/pull/5971',
            label: 'Flowise: Agentflow V2 scheduling',
            asOf: '2026-09-13',
          },
          {
            url: 'https://github.com/FlowiseAI/Flowise/pull/6283',
            label: 'Flowise: Webhook triggers',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.flowiseai.com/tutorials/tools-and-mcp',
            label: 'Flowise: Tools and MCP',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.flowiseai.com/integrations/langchain/tools/custom-tool',
            label: 'Flowise: Custom Tool and dependencies',
            asOf: '2026-09-13',
          },
        ],
      },
      apiPublishing: {
        value:
          'Yes: POST /api/v1/prediction/:id invokes eligible chat/form flows, supporting streaming, session context, file inputs and human-input resume. Webhook and scheduled Agentflows use their dedicated trigger paths.',
        shortValue: 'Yes, Prediction API with streaming and session context',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/prediction',
            label: 'Flowise: Prediction API and official SDKs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://github.com/FlowiseAI/Flowise/pull/6361',
            label: 'Flowise: Prediction trigger guard',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.flowiseai.com/contributing/building-node',
            label: 'Flowise: Building nodes',
            asOf: '2026-09-13',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.flowiseai.com/using-flowise/embed',
            label: 'Flowise: Embed package and theming',
            asOf: '2026-09-13',
          },
        ],
      },
      mcpPublishing: {
        value:
          'Yes: archived Flowise 3.1.3 supports publishing Chatflows and Agentflows as MCP servers over a Streamable HTTP endpoint, with a configuration UI. An SSE transport was implemented then removed before the feature merged.',
        shortValue: 'Archived 3.1.3 native flow publishing as MCP servers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/FlowiseAI/Flowise/releases/tag/flowise@3.1.3',
            label: 'Flowise: 3.1.3 release notes',
            asOf: '2026-09-13',
          },
          {
            url: 'https://github.com/FlowiseAI/Flowise/pull/5930',
            label: 'Flowise: Flow publishing as MCP server',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://flowiseai.com/',
            label: 'Flowise: Product and legacy displayed pricing',
            asOf: '2026-09-13',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://flowiseai.com/',
            label: 'Flowise: Product and legacy displayed pricing',
            asOf: '2026-09-13',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.flowiseai.com/using-flowise/document-stores',
            label: 'Flowise: Document Stores',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.flowiseai.com/using-flowise/document-stores',
            label: 'Flowise: Document Stores',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.flowiseai.com/tutorials/tools-and-mcp',
            label: 'Flowise: Tools and MCP',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://github.com/FlowiseAI/Flowise/blob/main/LICENSE.md',
            label: 'Flowise: Apache-2.0 and Commercial License scope',
            asOf: '2026-09-13',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
        ],
      },
      piiRedaction: {
        value:
          'Partial: archived audit logging masks IP addresses and redacts metadata values under sensitive keys, including SSN and credit-card keys. General PII detection/redaction across arbitrary workflow content and all retained logs was not verified.',
        shortValue: 'Audit metadata/IP masking; broader PII redaction unverified',
        confidence: 'verified',
        sources: [
          {
            url: 'https://raw.githubusercontent.com/FlowiseAI/Flowise/main/packages/server/src/utils/sanitize.util.ts',
            label: 'Flowise: Audit metadata and IP sanitizers',
            asOf: '2026-09-13',
          },
          {
            url: 'https://raw.githubusercontent.com/FlowiseAI/Flowise/main/packages/server/src/utils/telemetry.ts',
            label: 'Flowise: Audit-event emission',
            asOf: '2026-09-13',
          },
        ],
      },
      sso: {
        value:
          'Yes in the documented Enterprise edition: Microsoft, Google, and Auth0 SSO require users to be invited with a workspace and role before sign-in. Current commercial availability needs confirmation.',
        shortValue: 'Enterprise SSO; invitations required; current availability unverified',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/configuration/sso',
            label: 'Flowise: Enterprise SSO',
            asOf: '2026-09-13',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.flowiseai.com/tutorials/tools-and-mcp',
            label: 'Flowise: Tools and MCP',
            asOf: '2026-09-13',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.flowiseai.com/using-flowise/monitoring',
            label: 'Flowise: Prometheus and OpenTelemetry monitoring',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://langfuse.com/integrations/no-code/flowise',
            label: 'Langfuse: Flowise tracing integration',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.flowiseai.com/using-flowise/monitoring',
            label: 'Flowise: Prometheus and OpenTelemetry monitoring',
            asOf: '2026-09-13',
          },
        ],
      },
      asyncExecution: {
        value:
          'Yes for webhook flows: archived 3.1.3 includes an asynchronous response mode that acknowledges the request and delivers the result to a configured callback. Ordinary queue-mode Prediction API requests still wait for workers; a general submit-and-poll API was not verified.',
        shortValue: 'Archived async webhook callbacks; queued predictions wait',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/configuration/running-flowise-using-queue',
            label: 'Flowise: Queue workers and concurrency',
            asOf: '2026-09-13',
          },
          {
            url: 'https://github.com/FlowiseAI/Flowise/releases/tag/flowise@3.1.3',
            label: 'Flowise: 3.1.3 release notes',
            asOf: '2026-09-13',
          },
          {
            url: 'https://github.com/FlowiseAI/Flowise/pull/6283',
            label: 'Flowise: Asynchronous webhook responses',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
            label: 'Flowise: Agentflow V2',
            asOf: '2026-09-13',
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
          'Server and worker deployments run without an interactive desktop UI. Archived 3.1.3 supports server-side Agentflow V2 schedules and asynchronous webhook callbacks. The deployment must remain running; general crash-recovery guarantees were not verified.',
        shortValue: 'Archived schedules/webhooks; deployment must remain running',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/configuration/running-flowise-using-queue',
            label: 'Flowise: Queue workers and concurrency',
            asOf: '2026-09-13',
          },
          {
            url: 'https://github.com/FlowiseAI/Flowise/releases/tag/flowise@3.1.3',
            label: 'Flowise: 3.1.3 release notes',
            asOf: '2026-09-13',
          },
          {
            url: 'https://github.com/FlowiseAI/Flowise/pull/5971',
            label: 'Flowise: Agentflow V2 scheduling',
            asOf: '2026-09-13',
          },
          {
            url: 'https://github.com/FlowiseAI/Flowise/pull/6283',
            label: 'Flowise: Asynchronous webhook responses',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-13',
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
            asOf: '2026-09-13',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-13',
          },
        ],
      },
      academy: {
        value:
          'Official documentation remains accessible, and the website still links video tutorials and recorded webinars. Recording playback and a current vendor certification or maintained academy program were not verified after end of life.',
        shortValue: 'Docs and recording links; playback and certification unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://flowiseai.com/',
            label: 'Flowise: Product and legacy displayed pricing',
            asOf: '2026-09-13',
          },
          {
            url: 'https://flowiseai.com/sunset',
            label: 'Flowise: Official sunset and end-of-life notice',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
            label: 'Flowise: Agentflow V2 documentation',
            asOf: '2026-09-13',
          },
        ],
      },
    },
  },
  oneLinerSources: [
    {
      url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
      label: 'Flowise: Agentflow V2',
      asOf: '2026-09-13',
    },
    {
      url: 'https://github.com/FlowiseAI/Flowise',
      label: 'Flowise: Archived source repository',
      asOf: '2026-09-13',
    },
    {
      url: 'https://flowiseai.com/sunset',
      label: 'Flowise: Official sunset and end-of-life notice',
      asOf: '2026-09-13',
    },
  ],
}
