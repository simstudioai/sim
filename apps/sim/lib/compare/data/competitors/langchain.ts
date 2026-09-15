import { LangChainIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Reviewed against live primary sources on 2026-09-13; unresolved claims remain marked unknown. */
export const langchainProfile: CompetitorProfile = {
  id: 'langchain',
  name: 'LangChain',
  website: 'https://www.langchain.com',
  isWorkflowBuilder: false,
  brand: {
    icon: LangChainIcon,
    selfFramed: false,
    colors: ['#1c3c34', '#3f7255', '#000000'],
    source: 'Official brand guidelines',
    asOf: '2026-07-02',
  },
  oneLiner:
    'LangChain and LangGraph are open-source libraries for building agents in code. The separate LangSmith platform provides observability, evaluation, deployment, and Fleet, a no-code agent builder.',
  standoutFeatures: [
    {
      title: 'Checkpointed graph execution',
      description:
        'LangGraph saves graph state at super-step boundaries. With persistent storage, agents can resume after interruptions, replay past execution, and fork alternative paths.',
      shortDescription: 'Persistent checkpoints support recovery, replay, and branching.',
      source: {
        url: 'https://docs.langchain.com/oss/python/langgraph/checkpointers',
        label: 'Checkpointers',
        asOf: '2026-09-13',
      },
    },
    {
      title: 'Dynamic parallel orchestration',
      description:
        'LangGraph supports concurrent branches and Send-based map-reduce. Developers control routing and the reducers that combine branch results.',
      shortDescription: 'Parallel branches with programmable routing and aggregation.',
      source: {
        url: 'https://docs.langchain.com/oss/python/langgraph/use-graph-api',
        label: 'Use the graph API',
        asOf: '2026-09-13',
      },
    },
    {
      title: 'Integrated agent evaluation',
      description:
        'LangSmith evaluates agent outputs against datasets and production traces, with automated scoring and human review workflows.',
      shortDescription: 'Dataset evaluations, production scoring, and human review.',
      source: {
        url: 'https://docs.langchain.com/langsmith/evaluation',
        label: 'LangSmith Evaluation',
        asOf: '2026-09-13',
      },
    },
    {
      title: 'No-code agents with Fleet',
      description:
        'LangSmith Fleet creates agents from descriptions or templates and connects them to tools, chat, and event channels. It is a separate platform surface from the open-source frameworks.',
      shortDescription: 'Build agents through descriptions and connected tools.',
      source: {
        url: 'https://docs.langchain.com/langsmith/fleet',
        label: 'No-code agents with LangSmith Fleet',
        asOf: '2026-09-13',
      },
    },
    {
      title: 'Interactive debugging in Studio',
      description:
        'LangSmith Studio connects to a running agent to inspect prompts, tool calls, results, and intermediate state. Its local development server supports hot reload and rerunning conversation steps.',
      shortDescription: 'Inspect execution and rerun steps while iterating locally.',
      source: {
        url: 'https://docs.langchain.com/oss/python/langgraph/studio',
        label: 'LangSmith Studio',
        asOf: '2026-09-13',
      },
    },
  ],
  limitations: [
    {
      title: 'Graph-level customization requires code',
      description:
        'The LangGraph Graph API expresses state, nodes, edges, and control flow in code. Teams choosing this authoring path need programming expertise.',
      shortDescription: 'LangGraph orchestration requires programming.',
      source: {
        url: 'https://docs.langchain.com/oss/python/langgraph/use-graph-api',
        label: 'Use the graph API',
        asOf: '2026-09-13',
      },
    },
    {
      title: 'Managed services introduce additional usage charges',
      description:
        'LangSmith services have their own usage charges alongside paid seats. A free open-source library does not include unlimited hosted operations.',
      shortDescription: 'Account for seats and managed-service usage.',
      source: {
        url: 'https://www.langchain.com/pricing',
        label: 'LangSmith plans and pricing',
        asOf: '2026-09-13',
      },
    },
    {
      title: 'Advanced platform governance requires Enterprise',
      description:
        'Custom RBAC and resource policies are LangSmith Enterprise features. Evaluate the required platform tier separately from the open-source libraries.',
      shortDescription: 'Enterprise is required for advanced platform access controls.',
      source: {
        url: 'https://docs.langchain.com/langsmith/enterprise',
        label: 'LangSmith for Enterprise',
        asOf: '2026-09-13',
      },
    },
    {
      title: 'Cloud deployment type is fixed after creation',
      description:
        'LangSmith distinguishes serverless and dedicated deployments. The deployment size can change, but the type cannot be changed after creation.',
      shortDescription: 'Choose serverless or dedicated before creating a deployment.',
      source: {
        url: 'https://docs.langchain.com/langsmith/cloud-platform-features',
        label: 'Cloud platform features',
        asOf: '2026-09-13',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'Python/JavaScript agent frameworks, with a separate no-code agent builder in LangSmith Fleet.',
        detail:
          'LangGraph defines orchestration in code; LangSmith Studio helps inspect and test execution. Fleet creates agents from descriptions or templates.',
        shortValue: 'Code frameworks plus no-code Fleet',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/langgraph/studio',
            label: 'LangSmith Studio',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/langsmith/fleet',
            label: 'No-code agents with LangSmith Fleet',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/oss/javascript/langgraph/use-graph-api',
            label: 'Use the graph API (JavaScript)',
            asOf: '2026-09-13',
          },
        ],
      },
      learningCurve: {
        value:
          'The open-source frameworks require programming; Fleet offers an entry point through natural language.',
        detail:
          'This is an editorial assessment of the documented authoring approaches, not a measured learning-time benchmark.',
        shortValue: 'Coding for frameworks; natural-language entry through Fleet',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/langgraph/use-graph-api',
            label: 'Use the graph API',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/langsmith/fleet',
            label: 'No-code agents with LangSmith Fleet',
            asOf: '2026-09-13',
          },
        ],
      },
      selfHostOption: {
        value:
          'Yes: run the open-source libraries yourself; licensed LangSmith components also support self-hosting.',
        detail:
          'Standalone Agent Server requires a LangSmith license and backing services. Self-hosted Fleet is documented as beta. External model and tool calls depend on your configuration.',
        shortValue: 'OSS self-hosting; licensed platform options',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/deploy-standalone-server',
            label: 'Self-host standalone servers',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/langsmith/fleet',
            label: 'No-code agents with LangSmith Fleet',
            asOf: '2026-09-13',
          },
          {
            url: 'https://github.com/langchain-ai/langgraph',
            label: 'langchain-ai/langgraph',
            asOf: '2026-09-13',
          },
        ],
      },
      deploymentOptions: {
        value:
          'Open-source libraries run in your application; LangSmith supports cloud, hybrid, and self-hosted deployments.',
        detail:
          'Standalone Agent Server can run in containers with PostgreSQL and Redis. The hosting model determines which infrastructure your team operates.',
        shortValue: 'Application code, cloud, hybrid, or self-hosted',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/deploy-standalone-server',
            label: 'Self-host standalone servers',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/langsmith/enterprise',
            label: 'LangSmith for Enterprise',
            asOf: '2026-09-13',
          },
          {
            url: 'https://github.com/langchain-ai/langgraph',
            label: 'langchain-ai/langgraph',
            asOf: '2026-09-13',
          },
        ],
      },
      templates: {
        value:
          'Yes: Fleet has curated agent templates with instructions, tools, and optional event channels.',
        detail:
          'Templates can be cloned and customized. The available collection changes over time.',
        shortValue: 'Curated, customizable Fleet agent templates',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/fleet/templates',
            label: 'Templates',
            asOf: '2026-09-13',
          },
        ],
      },
      license: {
        value:
          'MIT for the LangChain and LangGraph libraries; LangSmith is a separate commercial platform.',
        detail:
          'The repositories publish MIT licenses. That license does not grant rights to the separately licensed LangSmith deployment services.',
        shortValue: 'MIT libraries; commercial LangSmith',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/langchain-ai/langchain',
            label: 'LangChain repository and MIT license',
            asOf: '2026-09-13',
          },
          {
            url: 'https://github.com/langchain-ai/langgraph',
            label: 'LangGraph repository and MIT license',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/langsmith/deploy-standalone-server',
            label: 'Self-host standalone servers',
            asOf: '2026-09-13',
          },
        ],
      },
      environmentPromotion: {
        value:
          'Yes through code and CI/CD: LangSmith documents preview deployments and quality-gated production releases.',
        detail:
          'The documented GitHub Actions example creates preview environments for pull requests and production revisions after merge. Teams configure this pipeline.',
        shortValue: 'Preview-to-production CI/CD through code',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/cicd-pipeline-example',
            label: 'Implement a CI/CD pipeline using LangSmith Deployment and Evaluation',
            asOf: '2026-09-13',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Git for agent source code, plus versioned assistant configurations in LangSmith Deployment.',
        detail:
          'Assistant configuration changes create versions that can be selected later. GitHub-based CI/CD manages source revisions.',
        shortValue: 'Git history and assistant configuration versions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/assistants',
            label: 'Assistants',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/langsmith/cicd-pipeline-example',
            label: 'Implement a CI/CD pipeline using LangSmith Deployment and Evaluation',
            asOf: '2026-09-13',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          'Simultaneous live editing with shared cursors is not confirmed in the reviewed documentation.',
        detail:
          'Fleet documents sharing and edit permissions. Those capabilities alone do not establish concurrent editing behavior.',
        shortValue: 'Live co-editing not confirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/fleet/access-and-oversight',
            label: 'Access & oversight',
            asOf: '2026-09-13',
          },
        ],
      },
      nativeFileStorage: {
        value:
          'Partial: Fleet computers on Plus and Enterprise provide persistent agent files; a shared drive with link permissions and deleted-file recovery is not confirmed.',
        detail:
          'Shared computers can retain files across conversations. This is agent execution storage; the full file-management feature set remains unverified.',
        shortValue: 'Plus/Enterprise agent files; shared-drive features unconfirmed',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/fleet/computer-use',
            label: 'Computer use',
            asOf: '2026-09-13',
          },
        ],
      },
      dataTables: {
        value: 'A native spreadsheet-style data table is not confirmed.',
        detail:
          'The reviewed Fleet documentation describes agent tools and connected services, but does not establish the requested built-in table editor.',
        shortValue: 'Native data tables not confirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/fleet/tools',
            label: 'Tool integrations',
            asOf: '2026-09-13',
          },
        ],
      },
      richTextEditor: {
        value: 'A document-focused WYSIWYG editor is not confirmed.',
        detail:
          'Fleet supports agent instructions and skills; those do not by themselves establish an inline document editor.',
        shortValue: 'Document editor not confirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/fleet/skills',
            label: 'Skills',
            asOf: '2026-09-13',
          },
        ],
      },
      subWorkflows: {
        value: 'Yes: LangGraph composes graphs by using a subgraph as a node in a parent graph.',
        detail:
          'Shared state keys can pass data directly; differing schemas require a wrapper that maps inputs and outputs.',
        shortValue: 'Reusable subgraphs in parent graphs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/langgraph/use-subgraphs',
            label: 'Subgraphs',
            asOf: '2026-09-13',
          },
        ],
      },
      customBlocks: {
        value: 'Partial: RemoteGraph can reuse a graph from another deployment through code.',
        detail:
          'The documentation warns against RemoteGraph calls within the same deployment because they can deadlock. A shared visual block palette with automatically derived input/output fields is not confirmed.',
        shortValue: 'Cross-deployment reuse; visual block publishing unconfirmed',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/use-remote-graph',
            label: 'How to interact with a deployment using RemoteGraph',
            asOf: '2026-09-13',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value: 'Yes: LangChain has a common model interface with provider integrations.',
        detail:
          'Developers configure supported providers and their credentials; model capabilities still vary by provider.',
        shortValue: 'Common interface for multiple model providers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/langchain/models',
            label: 'Models',
            asOf: '2026-09-13',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          'Yes: LangChain offers tool-using agents, and LangGraph provides explicit orchestration graphs.',
        detail:
          'Agent tool loops and conditional graph routing allow reasoning-driven behavior alongside deterministic steps.',
        shortValue: 'Tool-using agents with graph orchestration',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/langchain/agents',
            label: 'Agents',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/oss/python/langgraph/use-graph-api',
            label: 'Use the graph API',
            asOf: '2026-09-13',
          },
        ],
      },
      naturalLanguageBuilding: {
        value: 'Yes: LangSmith Fleet builds agents from natural-language descriptions.',
        detail:
          'Fleet configures an agent and pauses for input during creation. This is a LangSmith capability, separate from authoring the open-source libraries in code.',
        shortValue: 'Describe an agent in Fleet',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/fleet',
            label: 'No-code agents with LangSmith Fleet',
            asOf: '2026-09-13',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          'Yes: document loading, splitting, embeddings, vector stores, and retrievers support RAG.',
        detail:
          'Teams assemble retrieval pipelines in code and can expose retrieval as an agent tool.',
        shortValue: 'Document ingestion and retrieval toolkit',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/langchain/retrieval',
            label: 'Retrieval',
            asOf: '2026-09-13',
          },
        ],
      },
      mcpSupport: {
        value: 'Yes: LangChain consumes MCP tools through its MCP adapters.',
        detail:
          'The official adapters support stdio and streamable HTTP connections to multiple servers. The newer langchain.mcp namespace is documented as beta.',
        shortValue: 'MCP client via official adapters',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/langchain/mcp',
            label: 'Model Context Protocol (MCP)',
            asOf: '2026-09-13',
          },
          {
            url: 'https://github.com/langchain-ai/langchain-mcp-adapters',
            label: 'langchain-ai/langchain-mcp-adapters',
            asOf: '2026-09-13',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'Yes: LangSmith supports dataset-based evaluation and evaluation of production traces.',
        detail:
          'Evaluators score application outputs; annotation queues add human review. Open-source agent middleware also provides runtime controls.',
        shortValue: 'Offline/online evaluations and human review',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/evaluation',
            label: 'LangSmith Evaluation',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/oss/python/langchain/middleware/built-in',
            label: 'Prebuilt middleware',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/langsmith/annotation-queues',
            label: 'Use annotation queues',
            asOf: '2026-09-13',
          },
        ],
      },
      humanInTheLoop: {
        value:
          'Yes: checkpoint-backed interrupts pause agents for approval, editing, or rejection.',
        detail:
          'A persistent checkpointer is needed for pauses that must survive process restarts. Fleet adds a review inbox.',
        shortValue: 'Checkpoint-backed approval and resume',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/langchain/human-in-the-loop',
            label: 'Human-in-the-loop',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/langsmith/fleet/access-and-oversight',
            label: 'Access & oversight',
            asOf: '2026-09-13',
          },
        ],
      },
      generativeMedia: {
        value: 'Yes through provider integrations, including OpenAI image-generation tool calls.',
        detail:
          'OpenAI audio generation is documented as Preview; image generation carries no preview label and requires langchain-openai>=0.3.19. Supported models can return multimodal content. Availability and output formats depend on the selected provider.',
        shortValue: 'Provider-backed image and multimodal generation',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/integrations/chat/openai',
            label: 'ChatOpenAI integration',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/oss/python/langchain/models',
            label: 'Models',
            asOf: '2026-09-13',
          },
        ],
      },
      dynamicToolUse: {
        value:
          'Yes: tools can be loaded or filtered at runtime, and middleware can select relevant tools before a model call.',
        detail:
          'LangChain documents dynamic tool selection; its LLM tool selector reduces a larger configured tool set to relevant tools.',
        shortValue: 'Runtime tool selection and loading',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/langchain/tools',
            label: 'Tools',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/oss/python/langchain/middleware/built-in',
            label: 'Prebuilt middleware',
            asOf: '2026-09-13',
          },
        ],
      },
      modelFallback: {
        value:
          'Yes: model fallback middleware retries with alternative models when the primary fails.',
        detail:
          'The separate LangSmith LLM Gateway also supports ordered cross-provider fallback chains and is currently beta.',
        shortValue: 'Fallback middleware; beta gateway fallback chains',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/langchain/middleware/built-in',
            label: 'Prebuilt middleware',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/langsmith/llm-gateway-fallbacks',
            label: 'Model fallbacks',
            asOf: '2026-09-13',
          },
        ],
      },
      agentSkills: {
        value: 'Yes: Deep Agents supports reusable SKILL.md packages with progressive loading.',
        detail:
          'Agents discover skill metadata first and load instructions and supporting files when relevant. Fleet also exposes skills.',
        shortValue: 'Reusable SKILL.md packages and Fleet skills',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/deepagents/skills',
            label: 'Skills',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/langsmith/fleet/skills',
            label: 'Skills',
            asOf: '2026-09-13',
          },
        ],
      },
      nativeChatDeployment: {
        value:
          'Partial: Fleet provides hosted agent chat; public application chat can use the official Agent Chat UI.',
        detail:
          'Agent Chat UI connects to a deployed agent and can be self-deployed. The reviewed Fleet docs establish workspace chat, not anonymous public sharing.',
        shortValue: 'Fleet chat; deployable Agent Chat UI',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/fleet',
            label: 'No-code agents with LangSmith Fleet',
            asOf: '2026-09-13',
          },
          {
            url: 'https://github.com/langchain-ai/agent-chat-ui',
            label: 'Agent Chat UI',
            asOf: '2026-09-13',
          },
        ],
      },
      kbChunkVisibility: {
        value: 'Partial: retrieval exposes chunk content and metadata in code.',
        detail:
          'LangChain documents splitting documents into chunks and retrieving relevant documents. A dedicated built-in knowledge-base chunk browser is not confirmed.',
        shortValue: 'Chunk data in code; dedicated browser unconfirmed',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/langchain/retrieval',
            label: 'Retrieval',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/oss/python/langchain/knowledge-base',
            label: 'Build a semantic search engine with LangChain',
            asOf: '2026-09-13',
          },
        ],
      },
      parallelExecution: {
        value: 'Yes: LangGraph supports concurrent branches and dynamic map-reduce with Send.',
        detail: 'State reducers combine results from parallel branches.',
        shortValue: 'Concurrent branches and dynamic fan-out',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/langgraph/use-graph-api',
            label: 'Use the graph API',
            asOf: '2026-09-13',
          },
        ],
      },
      a2aProtocol: {
        value: 'Yes: Agent Server exposes A2A endpoints for deployed agents.',
        detail:
          'The A2A guide documents agent cards, message exchange, task retrieval, and streaming, with examples of agents calling each other.',
        shortValue: 'A2A server endpoints and inter-agent calls',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/server-a2a',
            label: 'A2A endpoint in Agent Server',
            asOf: '2026-09-13',
          },
        ],
      },
      loopIteration: {
        value:
          'Partial: LangGraph implements loops through graph cycles and conditional routing in code.',
        detail:
          'The documented loop patterns are programmatic; a dedicated visual loop container is not confirmed.',
        shortValue: 'Code-defined cycles and loop conditions',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/langgraph/use-graph-api',
            label: 'Use the graph API',
            asOf: '2026-09-13',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value: 'LangChain advertises 1,000+ integrations across models, tools, and databases.',
        detail:
          'This is a vendor-reported ecosystem total, not a count of unique business-app connectors.',
        shortValue: '1,000+ integrations; mixed integration types',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.langchain.com/langchain',
            label: 'LangChain: Open Source AI Agent Framework for Any Model',
            asOf: '2026-09-13',
          },
        ],
      },
      triggerTypes: {
        value: 'API calls, scheduled runs, and Fleet event channels are supported.',
        detail:
          'Fleet documents Gmail, Slack, and Teams channels plus recurring schedules. Agent Server also supports cron jobs.',
        shortValue: 'API, schedules, and connected event channels',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/fleet/channels',
            label: 'Channels',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/langsmith/fleet/schedules',
            label: 'Schedules',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/langsmith/agent-server',
            label: 'Agent Server',
            asOf: '2026-09-13',
          },
        ],
      },
      customCodeSteps: {
        value: 'Yes: graph nodes and custom tools are authored in Python or JavaScript.',
        detail: 'Developers supply the functions that implement application behavior.',
        shortValue: 'Custom code in graph nodes and tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/langgraph/use-graph-api',
            label: 'Use the graph API',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/oss/python/langchain/tools',
            label: 'Tools',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/oss/javascript/langgraph/use-graph-api',
            label: 'Use the graph API (JavaScript)',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/oss/javascript/langchain/tools',
            label: 'Tools (JavaScript)',
            asOf: '2026-09-13',
          },
        ],
      },
      codeSandboxRuntime: {
        value: 'Yes: LangSmith Sandboxes can boot from custom Docker-image snapshots.',
        detail:
          'Snapshots can also capture a running environment after dependencies are installed. Sandbox resources and lifecycle are configured separately.',
        shortValue: 'Custom image snapshots for isolated execution',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/sandbox-snapshots',
            label: 'Sandbox snapshots',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/langsmith/sandboxes',
            label: 'LangSmith Sandboxes',
            asOf: '2026-09-13',
          },
        ],
      },
      apiPublishing: {
        value: 'Yes: Agent Server publishes deployed agents through a REST API.',
        detail: 'The API manages assistants, threads, runs, state, and background execution.',
        shortValue: 'REST API for deployed agents',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/agent-server',
            label: 'Agent Server',
            asOf: '2026-09-13',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Python and JavaScript libraries, custom tools, and Agent Server APIs support extensions.',
        detail:
          'LangChain and LangGraph can be extended in code; custom tool definitions connect application functions to agents.',
        shortValue: 'Libraries, custom tools, and server APIs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/langchain/tools',
            label: 'Tools',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/langsmith/agent-server',
            label: 'Agent Server',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/oss/javascript/langgraph/use-graph-api',
            label: 'Use the graph API (JavaScript)',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/oss/javascript/langchain/tools',
            label: 'Tools (JavaScript)',
            asOf: '2026-09-13',
          },
        ],
      },
      mcpPublishing: {
        value: 'Yes: Agent Server exposes deployed agents as MCP tools.',
        detail:
          'Its /mcp endpoint uses streamable HTTP. This is separate from consuming external MCP servers.',
        shortValue: 'Deployed agents exposed through /mcp',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/server-mcp',
            label: 'MCP endpoint in Agent Server',
            asOf: '2026-09-13',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value: 'Free MIT libraries; LangSmith charges for seats and service usage.',
        detail:
          'Current usage pricing uses compute and storage units, with additional model-access billing where applicable.',
        shortValue: 'Free libraries; seats plus platform usage',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.langchain.com/pricing',
            label: 'LangSmith plans and pricing',
            asOf: '2026-09-13',
          },
          {
            url: 'https://www.langchain.com/langchain',
            label: 'LangChain: Open Source AI Agent Framework for Any Model',
            asOf: '2026-09-13',
          },
        ],
      },
      entryPaidPlan: {
        value: 'LangSmith Plus starts at $39 per seat per month, plus usage.',
        detail: 'Includes 10,000 base traces monthly and one small serverless deployment.',
        shortValue: 'Plus: $39/seat/month plus usage',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.langchain.com/pricing',
            label: 'LangSmith plans and pricing',
            asOf: '2026-09-13',
          },
        ],
      },
      freeTier: {
        value: 'LangSmith Developer includes one free seat and 5,000 base traces monthly.',
        detail:
          'The open-source libraries are also free; infrastructure and model costs remain separate.',
        shortValue: 'Free libraries; Developer includes 5,000 traces',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.langchain.com/pricing',
            label: 'LangSmith plans and pricing',
            asOf: '2026-09-13',
          },
          {
            url: 'https://www.langchain.com/langchain',
            label: 'LangChain: Open Source AI Agent Framework for Any Model',
            asOf: '2026-09-13',
          },
        ],
      },
      byok: {
        value: 'Yes: use provider credentials directly or through LangSmith LLM Gateway.',
        detail:
          'Gateway also offers LangSmith-billed model access without your own provider key. It is currently beta.',
        shortValue: 'Direct BYOK or beta gateway model access',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/llm-gateway',
            label: 'LLM Gateway',
            asOf: '2026-09-13',
          },
        ],
      },
    },
    security: {
      dataResidency: {
        value: 'LangSmith documents GCP US, GCP EU, GCP APAC, and AWS US regional instances.',
        detail:
          'Organizations select a region; cross-region migration is not supported. Feature availability can differ during regional rollouts.',
        shortValue: 'US, EU, and APAC instances',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/regions-faq',
            label: 'Regions FAQ',
            asOf: '2026-09-13',
          },
        ],
      },
      rbac: {
        value: 'Yes: Enterprise supports workspace roles and granular permissions.',
        detail: 'Built-in and custom roles control access; ABAC adds resource-level policies.',
        shortValue: 'Enterprise RBAC and resource policies',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/rbac',
            label: 'Role-based access control',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/langsmith/enterprise',
            label: 'LangSmith for Enterprise',
            asOf: '2026-09-13',
          },
        ],
      },
      auditLogging: {
        value: 'Yes: LangSmith Enterprise records administrative audit events.',
        detail:
          'Admins can inspect events in the UI or API. The docs describe up to 400 days of retention and scheduled forwarding to external systems.',
        shortValue: 'Enterprise admin audit logs with API access',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/audit-logs',
            label: 'Audit logs',
            asOf: '2026-09-13',
          },
        ],
      },
      compliance: {
        value:
          'LangChain states that LangSmith maintains SOC 2 Type II, HIPAA, and GDPR compliance.',
        detail:
          'This is a vendor statement in its shared-responsibility documentation. Audit reports were not inspected; it is not an attestation for an independently operated open-source deployment.',
        shortValue: 'Vendor-stated SOC 2 II, HIPAA, and GDPR posture',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/shared-responsibility-model',
            label: 'LangSmith shared responsibility model',
            asOf: '2026-09-13',
          },
        ],
      },
      modelAndToolGovernance: {
        value:
          'Yes: Fleet Enterprise can restrict tools with roles, resource policies, and workspace integration controls.',
        detail:
          'LangSmith LLM Gateway separately adds model-call permissions and centralized usage policies; the gateway is beta.',
        shortValue: 'Enterprise Fleet tool policies; beta gateway controls',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/fleet/access-and-oversight',
            label: 'Access & oversight',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/langsmith/llm-gateway-access',
            label: 'Traces and access control',
            asOf: '2026-09-13',
          },
        ],
      },
      credentialGovernance: {
        value:
          'Partial: Fleet supports shared or per-user credentials, and the beta gateway centralizes provider keys.',
        detail:
          'The reviewed docs establish agent identity and tool-resource controls. A general per-credential role allowlist across all stored connections is not confirmed.',
        shortValue: 'Credential isolation; general credential allowlists unconfirmed',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/fleet/access-and-oversight',
            label: 'Access & oversight',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/langsmith/llm-gateway-access',
            label: 'Traces and access control',
            asOf: '2026-09-13',
          },
        ],
      },
      whiteLabeling: {
        value: 'Full platform white-labeling is not confirmed.',
        detail:
          'The reviewed Fleet settings document agent configuration and sharing, but do not establish replacement of LangSmith branding across the platform.',
        shortValue: 'Full white-labeling not confirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/fleet/manage-agent-settings',
            label: 'Manage agent settings',
            asOf: '2026-09-13',
          },
        ],
      },
      dataRetention: {
        value:
          'LangSmith lists 14-day base traces; the pricing page states 400-day extended traces while the documentation retention table already lists 180 days, the new SaaS maximum from September 14, 2026.',
        detail:
          'The two vendor sources disagree on the current extended figure, so treat 180 days as the forward-looking maximum. Existing traces are unaffected by that change. Enterprise customers can customize extended retention per workspace up to the new maximum and have deletion controls.',
        shortValue: '14-day base; extended listed as 400 or 180 days, 180 from Sep 14, 2026',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.langchain.com/pricing',
            label: 'LangSmith plans and pricing',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/langsmith/enterprise',
            label: 'LangSmith for Enterprise',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/langsmith/usage-and-billing',
            label: 'Usage and billing',
            asOf: '2026-09-13',
          },
        ],
      },
      piiRedaction: {
        value: 'Yes: LangSmith supports hiding inputs/outputs and custom masking before ingestion.',
        detail:
          'LangChain also offers PII middleware for agent conversations. Configure the appropriate control for the data path being protected.',
        shortValue: 'Trace masking and agent PII middleware',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/mask-inputs-outputs',
            label: 'Prevent logging of sensitive data in traces',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/oss/python/langchain/middleware/built-in',
            label: 'Prebuilt middleware',
            asOf: '2026-09-13',
          },
        ],
      },
      sso: {
        value: 'Yes: LangSmith Enterprise documents SAML and OIDC single sign-on.',
        detail:
          'The enterprise documentation includes just-in-time provisioning and user-management controls.',
        shortValue: 'Enterprise SAML/OIDC SSO',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/enterprise',
            label: 'LangSmith for Enterprise',
            asOf: '2026-09-13',
          },
        ],
      },
      sessionPolicy: {
        value:
          'Partial: self-hosted LangSmith documents configurable authentication-session lifetimes.',
        detail:
          'The OAuth and basic-auth lifetime settings apply to self-hosted installations. A corresponding customer-configurable Cloud session policy is not confirmed.',
        shortValue: 'Configurable self-hosted session lifetime',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://kb.langchain.com/articles/9515017706-session-timeout-configuration-for-langsmith-self-hosted',
            label:
              'Session Timeout Configuration for LangSmith Self-Hosted | LangChain Knowledge Base',
            asOf: '2026-09-13',
          },
        ],
      },
      thirdPartyVetting: {
        value: 'Mixed: integration security coverage depends on the package and maintainer.',
        detail:
          'LangChain publishes a security scope for its maintained packages and integrations. Third-party packages and MCP servers should not be treated as uniformly vendor-vetted.',
        shortValue: 'Package-specific security coverage',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/security-policy',
            label: 'Security policy',
            asOf: '2026-09-13',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value: 'Yes: LangSmith traces application runs and nested LLM/tool calls.',
        detail:
          'Studio shows prompts, tool arguments, results, and intermediate execution state for debugging.',
        shortValue: 'Run, model, tool, and state inspection',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/observability-concepts',
            label: 'Observability concepts',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/oss/python/langgraph/studio',
            label: 'LangSmith Studio',
            asOf: '2026-09-13',
          },
        ],
      },
      durabilityModel: {
        value:
          'LangGraph checkpointers persist graph state at super-step boundaries and support recovery and replay.',
        detail:
          'Successful per-node writes can survive another node failing in the same step. Use persistent storage for recovery across process restarts.',
        shortValue: 'Checkpoint recovery, replay, and pending-write reuse',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/langgraph/checkpointers',
            label: 'Checkpointers',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/oss/python/langgraph/persistence',
            label: 'Persistence',
            asOf: '2026-09-13',
          },
        ],
      },
      failureAlerting: {
        value: 'Yes: LangSmith alerts on errors, latency, cost, and feedback metrics.',
        detail:
          'Notifications can route to PagerDuty or HTTP webhooks. Native Slack notifications are available on Cloud; self-hosted deployments can use a webhook.',
        shortValue: 'Threshold alerts with notification channels',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/alerts',
            label: 'Alerts in LangSmith',
            asOf: '2026-09-13',
          },
        ],
      },
      dataDrains: {
        value:
          'Yes: Enterprise supports scheduled bulk trace exports to S3-compatible storage, with transitional access for some earlier Plus accounts.',
        detail:
          'Bulk export is Enterprise for new accounts; some earlier Plus accounts have transitional access. Self-hosted Kubernetes telemetry can also be exported to external collectors.',
        shortValue: 'Enterprise trace exports; self-hosted telemetry',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/data-export',
            label: 'Bulk export trace data',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/langsmith/export-backend',
            label: 'Export LangSmith telemetry to your observability backend',
            asOf: '2026-09-13',
          },
        ],
      },
      asyncExecution: {
        value: 'Yes: Agent Server queues runs for background execution.',
        detail: 'Clients can reconnect to stream output or retrieve run state through the API.',
        shortValue: 'Queued runs with later result access',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/agent-server',
            label: 'Agent Server',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/langsmith/env-var-self-hosted',
            label: 'Self-hosted Agent Server environment variables',
            asOf: '2026-09-13',
          },
        ],
      },
      executionLimits: {
        value:
          'Self-hosted Agent Server defaults to a 24-hour run timeout and 10 concurrent runs per queue worker; a Cloud API connection timeout is not documented.',
        detail:
          'Cloud request bodies are limited to 25 MB. Self-hosted timeout and worker concurrency are configurable. Worker concurrency is not a deployment-wide request cap. No Cloud connection-timeout duration was found in the reviewed LangChain documentation.',
        shortValue: 'Self-hosted defaults: 24h, 10 runs/worker; Cloud timeout undocumented',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/cloud-platform-features',
            label: 'Cloud platform features',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/langsmith/env-var-self-hosted',
            label: 'Self-hosted Agent Server environment variables',
            asOf: '2026-09-13',
          },
        ],
      },
      partialFailureHandling: {
        value:
          'Yes: LangGraph supports per-node retries, async-node timeout policies, and error handlers.',
        detail:
          'Timeout and error-handler APIs require LangGraph 1.2 or newer. Error handlers can route recovery after retries are exhausted; pending writes avoid repeating successful parallel work on resume.',
        shortValue: 'Node retries, async timeouts, and recovery paths',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/langgraph/use-graph-api',
            label: 'Use the graph API',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/oss/python/langgraph/checkpointers',
            label: 'Checkpointers',
            asOf: '2026-09-13',
          },
        ],
      },
      unattendedExecution: {
        value: 'Yes: deployed Agent Server runs execute on server infrastructure.',
        detail:
          'Fleet recurring schedules start agents automatically. Self-hosted deployments require infrastructure operated by the team.',
        shortValue: 'Server-side runs and recurring schedules',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/agent-server',
            label: 'Agent Server',
            asOf: '2026-09-13',
          },
          {
            url: 'https://docs.langchain.com/langsmith/fleet/schedules',
            label: 'Schedules',
            asOf: '2026-09-13',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value: 'Documentation, the LangChain community, and plan-dependent vendor support.',
        detail:
          'The community page directs product-support questions to the forum and reserves Slack for broader discussion. Vendor support options depend on the LangSmith plan.',
        shortValue: 'Docs, community, and plan-dependent support',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.langchain.com/join-community',
            label: 'LangChain Community Slack for GenAI Developers',
            asOf: '2026-09-13',
          },
          {
            url: 'https://www.langchain.com/pricing',
            label: 'LangSmith plans and pricing',
            asOf: '2026-09-13',
          },
        ],
      },
      sla: {
        value:
          'LangSmith advertises a support SLA and publishes 99.5% quarterly API uptime terms for SaaS and the BYOC control plane.',
        detail:
          'The published uptime terms include exclusions and service-credit conditions. They do not establish the same commitment for customer-operated data planes or every hosting model.',
        shortValue: '99.5% quarterly API uptime: SaaS/BYOC control plane',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.langchain.com/pricing',
            label: 'LangSmith plans and pricing',
            asOf: '2026-09-13',
          },
          {
            url: 'https://www.langchain.com/support-plans',
            label: 'Support Plans',
            asOf: '2026-09-13',
          },
        ],
      },
      community: {
        value: 'Public open-source repositories and dedicated community channels.',
        detail:
          'LangChain links its forum, Slack community, GitHub, and events for discussion and project participation.',
        shortValue: 'GitHub, forum, Slack, and events',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.langchain.com/join-community',
            label: 'LangChain Community Slack for GenAI Developers',
            asOf: '2026-09-13',
          },
          {
            url: 'https://github.com/langchain-ai/langchain',
            label: 'langchain-ai/langchain',
            asOf: '2026-09-13',
          },
        ],
      },
      companyMaturity: {
        value:
          'LangChain announced a $125 million funding round at a $1.25 billion valuation in October 2025.',
        detail:
          'Its dated announcement identifies IVP as the lead investor. This is a historical financing event, not an estimate of current valuation or total funding.',
        shortValue: 'October 2025: $125M financing announcement',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.langchain.com/blog/series-b',
            label: 'LangChain Series B announcement',
            asOf: '2026-09-13',
          },
        ],
      },
      academy: {
        value:
          'Yes: LangChain Academy offers structured self-paced courses and certification resources.',
        detail: 'The catalog includes Deep Agents, LangSmith essentials, and deployment courses.',
        shortValue: 'Structured Academy courses and certification resources',
        confidence: 'verified',
        sources: [
          {
            url: 'https://academy.langchain.com/',
            label: 'LangChain Academy',
            asOf: '2026-09-13',
          },
          {
            url: 'https://academy.langchain.com/courses/foundation-introduction-to-deepagents',
            label: 'LangChain Deep Agents Course',
            asOf: '2026-09-13',
          },
          {
            url: 'https://www.langchain.com/support-plans',
            label: 'Support Plans',
            asOf: '2026-09-13',
          },
        ],
      },
    },
  },
  oneLinerSources: [
    {
      url: 'https://docs.langchain.com/oss/python/langgraph/studio',
      label: 'LangSmith Studio',
      asOf: '2026-09-13',
    },
    {
      url: 'https://docs.langchain.com/langsmith/fleet',
      label: 'No-code agents with LangSmith Fleet',
      asOf: '2026-09-13',
    },
    {
      url: 'https://github.com/langchain-ai/langchain',
      label: 'langchain-ai/langchain',
      asOf: '2026-09-13',
    },
    {
      url: 'https://github.com/langchain-ai/langgraph',
      label: 'langchain-ai/langgraph',
      asOf: '2026-09-13',
    },
  ],
}
