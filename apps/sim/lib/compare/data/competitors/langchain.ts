import { LangChainIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Researched and cross-verified against live vendor sources on 2026-07-02. */
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
    'LangChain is an open-source Python/JavaScript framework for building LLM applications. LangGraph is its low-level, code-first agent-orchestration library for stateful, long-running agents, and LangSmith is the commercial observability, evaluation, and deployment platform for both.',
  standoutFeatures: [
    {
      title: 'Durable execution via checkpointed graph state',
      description:
        "LangGraph's checkpointer snapshots the full graph state after every node completes. If a process crashes or an agent run is interrupted (timeout, human approval, service restart), execution resumes from the last checkpoint instead of restarting from scratch, and past checkpoints can be replayed for time-travel debugging.",
      shortDescription:
        'Snapshots graph state after every node so runs resume, not restart, on failure.',
      source: {
        url: 'https://docs.langchain.com/oss/python/langgraph/use-time-travel',
        label: 'Time travel - Docs by LangChain',
        asOf: '2026-07-08',
      },
    },
    {
      title: 'Dynamic parallel fan-out via the Send API',
      description:
        'A routing function can return a list of Send objects instead of a single next-node key, letting LangGraph spawn a runtime-determined number of parallel branches (e.g. one worker per item in a list of unknown length) that merge back through a state reducer. Because the merge step is arbitrary code, a developer can implement any custom aggregation logic, not just a fixed join behavior.',
      shortDescription:
        'Send API spawns a runtime-determined number of parallel branches that merge via a reducer.',
      source: {
        url: 'https://docs.langchain.com/oss/python/langgraph/use-graph-api',
        label: 'Use the graph API - Docs by LangChain',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'LangSmith evaluation stack: datasets, LLM-as-judge, annotation queues, Align Evals',
      description:
        'LangSmith supports building test datasets from production traces, scoring runs with configurable LLM-as-judge evaluators or heuristic/pairwise comparisons, routing outputs to human annotation queues for review, and an Align Evals feature that calibrates an LLM-judge against accumulated human corrections over time.',
      shortDescription:
        'Datasets, LLM-as-judge, human annotation queues, and judge-calibration in one eval stack.',
      source: {
        url: 'https://www.langchain.com/langsmith/evaluation',
        label: 'LangSmith Evaluations',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Native A2A protocol support as both server and client',
      description:
        "A locally run LangGraph dev server exposes A2A protocol endpoints at /a2a/{assistant_id}, and the LangSmith Deployment A2A endpoint maps the protocol's contextId to a LangGraph thread_id for tracing continuity, so any LangChain/LangGraph agent can expose itself as an A2A server and call other A2A-compliant agents built on different frameworks.",
      shortDescription:
        'Agents expose themselves as A2A servers and call other A2A agents across frameworks.',
      source: {
        url: 'https://docs.langchain.com/langsmith/server-a2a',
        label: 'A2A endpoint in Agent Server - Docs by LangChain',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'LangGraph Studio: browser-based execution visualization with hot-reload',
      description:
        "Studio is a browser-based UI (hosted at smith.langchain.com/studio) that connects to a locally running agent and shows each execution step, prompt, and tool call, and hot-reloads when a prompt or tool signature changes in code. LangGraph's time-travel capability (inspecting, editing, and forking from a prior checkpoint) is a separate, SDK-level feature exposed via code (get_state_history / update_state), not a point-and-click Studio UI.",
      shortDescription:
        'Browser-based execution viewer with hot-reload; checkpoint rewind/fork is a separate SDK capability.',
      source: {
        url: 'https://docs.langchain.com/oss/python/langgraph/studio',
        label: 'LangGraph Studio - Docs by LangChain',
        asOf: '2026-07-08',
      },
    },
  ],
  limitations: [
    {
      title: 'Code-first framework, not a visual builder for non-developers',
      description:
        'Building an agent means writing Python or JavaScript against the LangChain/LangGraph APIs. LangGraph Studio visualizes and debugs an already-coded graph, but it does not let a non-developer assemble agent logic from scratch by dragging and connecting blocks the way a visual workflow builder does.',
      shortDescription:
        'Building agents means writing code; Studio only visualizes and debugs graphs already written.',
      source: {
        url: 'https://docs.langchain.com/oss/python/langgraph/use-graph-api',
        label: 'Use the graph API - Docs by LangChain',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'No one-click chat deployment tied to a specific agent',
      description:
        'Neither LangChain, LangGraph, nor LangSmith Deployment lets a builder toggle a hosted chat surface on for one specific agent the way a platform-managed deployment target would. LangChain does host a shared, generic "Agent Chat UI" instance at agentchat.vercel.app that any team can point at their own LangGraph Agent Server URL and API key, or a team can deploy the open-source Next.js app themselves (or use a separate framework like Chainlit/Streamlit).',
      shortDescription:
        'No per-agent hosted chat toggle; a shared generic Agent Chat UI instance exists, or self-deploy.',
      source: {
        url: 'https://github.com/langchain-ai/agent-chat-ui',
        label: 'langchain-ai/agent-chat-ui (GitHub)',
        asOf: '2026-07-08',
      },
    },
    {
      title: 'No dedicated native image/video/audio generation capability',
      description:
        'LangChain and LangGraph provide standardized model integrations, so an agent can call a multimodal provider (DALL-E, an image model via a provider integration) as a tool, but there is no first-party, dedicated generative-media node or block comparable to a purpose-built image/video-generation feature.',
      shortDescription:
        'Multimodal generation happens only through provider integrations, not a dedicated first-party block.',
      source: {
        url: 'https://docs.langchain.com/oss/python/langchain/models',
        label: 'Models - Docs by LangChain',
        asOf: '2026-07-04',
      },
    },
    {
      title: 'Full white-labeling and org-level credential governance are not documented',
      description:
        'No LangSmith or LangGraph Platform documentation describes rebranding the platform UI with customer branding, or restricting a specific role/permission group to a specific stored credential/connection distinct from workspace-level RBAC and API-key scoping.',
      shortDescription:
        'No documented white-labeling, and credential access is scoped by workspace RBAC, not per-credential.',
      source: {
        url: 'https://docs.langchain.com/langsmith/user-management',
        label: 'User management - Docs by LangChain',
        asOf: '2026-07-02',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'Code-first Python/JavaScript framework (LangChain) plus a low-level graph-orchestration library (LangGraph) for building agents in code. LangGraph Studio adds a browser-based visual IDE to render, inspect, and debug an already-coded agent graph, and Deep Agents provides a batteries-included harness on top of both.',
        detail:
          'There is no drag-and-drop agent authoring surface; developers write Python or TypeScript against LangChain/LangGraph APIs, and Studio visualizes execution steps for debugging (time-travel checkpoint rewind/fork is a separate SDK-level feature) rather than authoring the graph visually from scratch.',
        shortValue:
          'Code framework plus a graph-visualization/debugging Studio, not a visual builder',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/langgraph/studio',
            label: 'LangGraph Studio - Docs by LangChain',
            asOf: '2026-07-08',
          },
          {
            url: 'https://github.com/langchain-ai/deepagents',
            label: 'langchain-ai/deepagents (GitHub)',
            asOf: '2026-07-02',
          },
        ],
      },
      learningCurve: {
        value:
          'Steep for non-developers; moderate to steep for developers new to graph-based state machines and LLM orchestration concepts',
        detail:
          'The framework assumes Python or JavaScript proficiency and introduces its own concepts (Runnables, graphs, checkpointers, reducers, Send/Command primitives) that take real ramp-up time even for experienced engineers. LangChain Academy exists specifically to address this learning curve.',
        shortValue: 'Requires coding proficiency; own vocabulary (graphs, checkpointers, reducers)',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://academy.langchain.com/',
            label: 'LangChain Academy',
            asOf: '2026-07-02',
          },
        ],
      },
      selfHostOption: {
        value:
          'Yes: the LangChain/LangGraph open-source libraries run entirely self-hosted by default (no vendor service required). LangGraph Platform (the deployment/runtime layer) can also be fully self-hosted, so no agent data leaves the customer VPC.',
        detail:
          'A basic LangGraph server can additionally be self-hosted for free on the Developer plan with up to 100k nodes executed per month. Full self-hosting of the platform layer is typically an Enterprise offering.',
        shortValue: 'Yes, both the OSS libraries and LangGraph Platform can be fully self-hosted',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/deploy-standalone-server',
            label: 'Self-host standalone servers - Docs by LangChain',
            asOf: '2026-07-02',
          },
        ],
      },
      deploymentOptions: {
        value:
          'Any environment that runs Python/Node for the open-source libraries themselves. LangGraph Platform (renamed LangSmith Deployment) additionally offers a managed cloud service, a standalone self-hosted container (Docker/Kubernetes/VM with a Redis + Postgres backend), and a hybrid model.',
        detail:
          'Standalone container deployment requires a REDIS_URI (background task queue) and a DATABASE_URI (Postgres, for assistants/threads/runs/state). langgraph deploy (introduced March 2026) is the current production deployment path, superseding the older langgraph up Docker Compose flow.',
        shortValue: 'OSS libraries anywhere, plus managed cloud, self-hosted container, or hybrid',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/deploy-standalone-server',
            label: 'Self-host standalone servers - Docs by LangChain',
            asOf: '2026-07-04',
          },
        ],
      },
      templates: {
        value:
          'Yes: a small, official set of LangGraph templates (RAG Chatbot, ReAct Agent, Data Enrichment Agent, plus a blank starter) available in Python and JavaScript, downloadable via LangGraph Studio or as standalone GitHub repos. A much larger, informal ecosystem of community-published starter repos exists alongside them.',
        detail:
          'The official template count is small and curated (four templates at launch) compared to marketplace-style template galleries seen on visual workflow builders. Most reuse in practice comes from cloning community GitHub repos rather than an in-product template library.',
        shortValue:
          'A handful of official templates (RAG, ReAct, Data Enrichment), plus community repos',
        confidence: 'verified',
        sources: [
          {
            url: 'https://blog.langchain.com/launching-langgraph-templates/',
            label: 'Launching LangGraph Templates (LangChain Blog)',
            asOf: '2026-07-02',
          },
        ],
      },
      license: {
        value:
          'MIT License (LangChain and LangGraph open-source libraries); LangSmith and LangGraph Platform are proprietary commercial SaaS/self-hosted products',
        detail:
          "Both the langchain-ai/langchain and langchain-ai/langgraph GitHub repos are MIT-licensed. LangSmith (observability/evaluation) and LangGraph Platform's managed/enterprise deployment tooling are commercial products layered on top of the free libraries, not covered by the MIT license.",
        shortValue: 'MIT for the OSS libraries; LangSmith/Platform are commercial',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/langchain-ai/langchain',
            label: 'langchain-ai/langchain (GitHub)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/langchain-ai/langgraph',
            label: 'langchain-ai/langgraph (GitHub)',
            asOf: '2026-07-02',
          },
        ],
      },
      environmentPromotion: {
        value:
          'Partial: LangGraph Platform assistants are versioned (every edit creates a new version, with instant rollback to a prior version). But this is deployment/version management within one deployed service, not a Git-backed promotion of a whole project between separate dev/test/prod environments.',
        detail:
          'A LangGraph Platform deployment automatically creates a default assistant per graph. The platform tracks assistant versions and lets an operator roll back, comparable to a single-service release history rather than a multi-environment promotion pipeline.',
        shortValue:
          'Assistant versioning with rollback, not whole-project multi-environment promotion',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/assistants',
            label: 'Assistants - Docs by LangChain',
            asOf: '2026-07-02',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Standard Git-based source control for agent code (since agents are code), plus LangGraph Platform assistant-level versioning with instant rollback. No in-product visual diff/compare UI exists beyond what Git tooling itself provides.',
        detail:
          "Because the agent logic lives in a codebase, teams get full Git history, branching, and diffing for free through their own repository, distinct from a workflow builder's in-app version history panel. LangGraph Platform layers assistant versioning on top for the deployed configuration.",
        shortValue: 'Git for code; assistant versioning/rollback for deployed configs',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/assistants',
            label: 'Assistants - Docs by LangChain',
            asOf: '2026-07-02',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          "No: there is no live, concurrent multi-user editing surface. Agents are authored as code in each developer's own editor/IDE and merged via standard Git workflows, not edited simultaneously inside a shared canvas.",
        detail:
          'LangGraph Studio is a debugging/visualization tool for a single running graph, not a multiplayer authoring surface with visible cursors or synced edits.',
        shortValue: 'No, collaboration happens through Git, not live co-editing',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.langchain.com/blog/langgraph-studio-the-first-agent-ide',
            label: 'LangGraph Studio: The first agent IDE',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeFileStorage: {
        value:
          "No: neither LangChain, LangGraph, nor LangSmith provides a Drive-like file storage system with folder hierarchy, link sharing, or a recycle bin. Deep Agents offers a virtual filesystem abstraction (in-memory, local disk, LangGraph store, or custom backends) for an agent's own working context, but persistent storage still relies on external integrations (S3, GCS, local filesystem) a developer wires up themselves",
        detail:
          "Deep Agents provides a virtual/in-memory filesystem abstraction for an agent's own working context (planning, scratch files), which is a per-run working memory concept, not a persistent, user-facing file manager.",
        shortValue: 'No, file handling is via document-loader code, not a built-in file manager',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/deepagents/overview',
            label: 'Deep Agents overview - Docs by LangChain',
            asOf: '2026-07-08',
          },
        ],
      },
      dataTables: {
        value:
          'No: there is no native, in-product spreadsheet-like data table feature. Structured data storage is left entirely to whatever external database or vector store a developer integrates (Postgres, a vector store, etc.) via code',
        detail:
          "LangGraph's own persistence layer (checkpointer/store) is a state and memory backend for agent execution, not a user-facing spreadsheet grid for arbitrary structured data.",
        shortValue:
          'No, no built-in spreadsheet-like table; state store is for agent memory, not data',
        confidence: 'estimated',
        sources: [],
      },
      richTextEditor: {
        value:
          'No: there is no inline WYSIWYG rich-text/document editor in any LangChain, LangGraph, or LangSmith product surface. Content is authored as code, markdown files (e.g. SKILL.md), or plain-text prompts',
        detail:
          "SKILL.md files used by Deep Agents' SkillsMiddleware are edited as raw Markdown in a code editor, not through an in-product WYSIWYG surface.",
        shortValue: 'No, content is authored as code or raw Markdown, not WYSIWYG',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://reference.langchain.com/python/deepagents/middleware/skills',
            label: 'skills | deepagents | LangChain Reference',
            asOf: '2026-07-02',
          },
        ],
      },
      subWorkflows: {
        value:
          "Yes: LangGraph's subgraph feature lets a compiled graph be added directly as a node in a parent graph via add_node. The parent waits for the subgraph to finish before continuing, and when state keys overlap, the subgraph reads from and writes to the parent's state channels automatically. When schemas differ, a wrapper node function maps parent state to subgraph input and back.",
        detail:
          'This is a code-level composition primitive (one compiled graph nested inside another), not a drag-and-drop "call another workflow" block in a visual builder, but it satisfies the same synchronous parent-waits-for-child, data-in/data-out contract.',
        shortValue: 'Yes, LangGraph subgraphs: compiled graph nested as a node, parent waits',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/langgraph/use-subgraphs',
            label: 'Subgraphs - Docs by LangChain',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Yes: LangChain provides a standardized model interface and advertises 1,000+ documented integrations across providers, embeddings, and vector stores, including OpenAI, Anthropic, Google, AWS, Groq, Hugging Face, Databricks, Mistral, and local models via Ollama',
        detail:
          "This is the framework's foundational design goal: swap providers by changing the model class instantiation, with the rest of a chain/graph remaining unchanged.",
        shortValue: '1,000+ integrations via a standardized model interface',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.langchain.com/langchain',
            label: 'LangChain: Open Source AI Agent Framework',
            asOf: '2026-07-08',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          'Yes: LangGraph is purpose-built low-level orchestration for stateful, reasoning-driven agents, distinct from a plain deterministic chain. It supports single-agent ReAct loops, multi-agent systems, and hierarchical/supervisor architectures within one graph-based framework.',
        detail:
          'Graphs model explicit decision points, conditional edges, and tool-calling loops as first-class constructs, giving low-level control over exactly how an agent reasons and branches, rather than a black-box agent abstraction.',
        shortValue:
          'LangGraph provides low-level graph primitives for single- and multi-agent reasoning',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.langchain.com/langgraph',
            label: 'LangGraph: Agent Orchestration Framework for Reliable AI Agents',
            asOf: '2026-07-02',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          'No: there is no feature that converts a plain-text description into a working, editable agent graph. Agents are built by writing code against the LangChain/LangGraph APIs',
        detail:
          'LangGraph Studio hot-reloads and visualizes changes made in code, but does not itself generate agent logic from a natural-language prompt.',
        shortValue: 'No natural-language-to-agent generation feature found',
        confidence: 'estimated',
        sources: [],
      },
      knowledgeBaseRag: {
        value:
          'Yes: LangChain ships a full RAG toolkit (document loaders, text splitters, embeddings interfaces, and a standardized VectorStore interface) with integrations for Pinecone, Qdrant, Chroma, PGVector, Weaviate, and many others, usable as a retriever or wrapped as a callable tool for a LangGraph agent',
        detail:
          'The official RAG Chatbot LangGraph template packages this pattern (retrieval step against a search index, then a generation step) as a ready-made starting point.',
        shortValue:
          'Full RAG toolkit: loaders, splitters, and a standardized vector-store interface',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/langchain/retrieval',
            label: 'Retrieval - Docs by LangChain',
            asOf: '2026-07-08',
          },
          {
            url: 'https://docs.langchain.com/oss/python/integrations/vectorstores',
            label: 'VectorStore Interface and Integrations - Docs by LangChain',
            asOf: '2026-07-08',
          },
        ],
      },
      mcpSupport: {
        value:
          'Yes: the official langchain-mcp-adapters library converts external MCP server tools into LangChain/LangGraph-compatible tools over stdio or streamable HTTP transport, letting an agent call tools across multiple MCP servers. LangGraph agents can themselves be exposed for MCP consumption.',
        detail:
          'Interceptors give access to LangGraph runtime context during MCP tool execution, adding middleware-like control (modify requests, retries, dynamic headers) around MCP tool calls.',
        shortValue: 'Official langchain-mcp-adapters library, stdio and streamable HTTP',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/langchain-ai/langchain-mcp-adapters',
            label: 'langchain-ai/langchain-mcp-adapters (GitHub)',
            asOf: '2026-07-02',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'Yes: LangSmith provides a dedicated evaluation stack, datasets built from sampled production traces, LLM-as-judge evaluators scored against defined criteria, heuristic checks, pairwise comparisons, human annotation queues, and an Align Evals feature that calibrates judges against accumulated human corrections over time',
        detail:
          "This is LangSmith (the commercial platform), not the free open-source libraries; the evaluation stack is one of LangSmith's core paid product surfaces alongside tracing.",
        shortValue: 'LangSmith: datasets, LLM-as-judge, human annotation queues, judge calibration',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.langchain.com/langsmith/evaluation',
            label: 'LangSmith Evaluations',
            asOf: '2026-07-02',
          },
        ],
      },
      humanInTheLoop: {
        value:
          "Yes: a dedicated interrupt() function pauses a running graph at an exact line and returns a payload to the caller; Command(resume=...) resumes execution with the human's response (approve, edit, reject, or respond), all backed by the checkpointer so the pause survives a process restart",
        detail:
          'The same thread_id must be used for the initial invocation and the resume call, since that is how the checkpointer identifies which frozen state to restore.',
        shortValue:
          'interrupt()/Command(resume=...) primitives with checkpoint-backed pause/resume',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/langchain/human-in-the-loop',
            label: 'Human-in-the-loop - Docs by LangChain',
            asOf: '2026-07-02',
          },
        ],
      },
      generativeMedia: {
        value:
          "Partial: no dedicated, first-party image/video/audio-generation node exists. Generative media is reached only by calling a provider's multimodal model (e.g. an image-generation model) through LangChain's standard model-integration interface, the same as any other model call",
        detail:
          'There is no purpose-built "generate an image" or "generate a video" abstraction distinct from a generic chat-model or tool call to a multimodal provider.',
        shortValue:
          'Only via generic provider-model integrations, no dedicated media-gen abstraction',
        confidence: 'estimated',
        sources: [],
      },
      dynamicToolUse: {
        value:
          "No: the standard ReAct-style agent pattern in LangChain/LangGraph binds a pool of developer-selected tools to a model at build time, and the model only chooses among that bound pool at each step, rather than browsing or picking from a broader catalog (e.g. an entire MCP server's full tool list) at inference time",
        detail:
          "This is the same closed-list function-calling mechanism as Sim's Agent block: the tool pool, including any MCP-provided tools, is bound ahead of time by the developer, not browsed at runtime.",
        shortValue: 'No, agent picks only among tools bound in at build time',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/langchain/models',
            label: 'Models - Docs by LangChain',
            asOf: '2026-07-08',
          },
        ],
      },
      modelFallback: {
        value:
          "Yes: LangChain's with_fallbacks() method (RunnableWithFallbacks) lets a developer chain a primary model with one or more fallback models or providers, tried in order until one succeeds, at either a single model call or a whole-chain level",
        detail:
          "Documentation notes that a wrapper's own internal retry logic should typically be disabled when using fallbacks, otherwise the primary model keeps retrying instead of failing over to the fallback.",
        shortValue: 'Yes, with_fallbacks() chains ordered fallback models/providers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://reference.langchain.com/python/langchain-core/runnables/fallbacks/RunnableWithFallbacks',
            label: 'RunnableWithFallbacks - LangChain Reference',
            asOf: '2026-07-08',
          },
        ],
      },
      agentSkills: {
        value:
          'Yes: the Deep Agents harness ships a SkillsMiddleware that loads named SKILL.md files (metadata plus full Markdown instructions) from a directory and injects them into the system prompt using progressive disclosure, giving a reusable, named capability invokable across multiple agents, distinct from a one-off system prompt',
        detail:
          'Static skill/memory content is automatically prompt-cached for Anthropic and Amazon Bedrock models to avoid reprocessing the same tokens on every turn.',
        shortValue: 'Deep Agents SkillsMiddleware: named, reusable SKILL.md files across agents',
        confidence: 'verified',
        sources: [
          {
            url: 'https://reference.langchain.com/python/deepagents/middleware/skills',
            label: 'skills | deepagents | LangChain Reference',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeChatDeployment: {
        value:
          'Partial: neither the open-source libraries nor LangSmith Deployment let a builder toggle a hosted chat surface on for one specific agent. LangChain hosts a shared, generic "Agent Chat UI" instance at agentchat.vercel.app that any team can point at their own LangGraph Agent Server URL and API key, or a team can deploy the open-source Next.js app itself',
        detail:
          'LangGraph Studio itself provides a chat-style interaction panel for testing/debugging a graph during development, but this is a developer tool, not a shippable end-user chat deployment target.',
        shortValue: 'Partial: shared generic hosted chat client, no per-agent one-click toggle',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/langchain-ai/agent-chat-ui',
            label: 'langchain-ai/agent-chat-ui (GitHub)',
            asOf: '2026-07-08',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          "Yes: LangChain's Document abstraction returned by any VectorStore retriever carries per-chunk page_content and per-chunk metadata (source, page, chunk index), and LangSmith's trace view shows this document-level detail for each retrieval step in an agent run",
        detail:
          'This chunk-level detail is a property of the standard LangChain Document object used across all vector-store integrations, not a bespoke debugging UI feature.',
        shortValue:
          'Yes, Document objects carry per-chunk content/metadata, visible in LangSmith traces',
        confidence: 'verified',
        sources: [
          {
            url: 'https://reference.langchain.com/python/langchain-core/documents/base/Document',
            label: 'Document - LangChain Reference',
            asOf: '2026-07-08',
          },
        ],
      },
      parallelExecution: {
        value:
          'Yes: the Send API lets a routing function dynamically spawn one parallel branch per item in a collection of unknown length at runtime, each processing a slice of state, with results merged back through a state reducer once all branches complete. This is a native map-reduce/fan-out-fan-in pattern.',
        detail:
          "This is a code-level equivalent of a 'fan out one branch per list item' pattern: the number of concurrent executions is determined by the routing function at run time, based on the size of whatever collection it is fanning out over, the same run-time-determined-count model that block-based parallel constructs also support alongside a fixed-count mode.",
        shortValue:
          'Yes, Send API fans out one branch per list item at runtime, merged via a reducer',
        confidence: 'verified',
        sources: [
          {
            url: 'https://machinelearningplus.com/gen-ai/langgraph-map-reduce-parallel-execution/',
            label: 'LangGraph Map-Reduce: Parallel Execution with Send API',
            asOf: '2026-07-02',
          },
        ],
      },
      a2aProtocol: {
        value:
          "Yes: the local LangGraph dev server and the LangSmith Deployment Agent Server both expose native A2A (Agent2Agent) endpoints at /a2a/{assistant_id}, letting any LangChain/LangGraph agent expose itself as an A2A server and call other A2A-compliant agents regardless of the framework that built them, with Agent Cards auto-generated from the agent's name/description/tool list.",
        detail:
          "The LangSmith Deployment A2A endpoint maps the protocol's contextId to a LangGraph thread_id automatically, so A2A conversations get the same tracing/observability as native LangGraph runs.",
        shortValue: 'Yes, native A2A server/client support with auto-generated Agent Cards',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/server-a2a',
            label: 'A2A endpoint in Agent Server - Docs by LangChain',
            asOf: '2026-07-02',
          },
        ],
      },
      loopIteration: {
        value:
          'No: there is no dedicated for-each/while/Loop container node. Sequential repetition over a list, a fixed count, or a condition is built by wiring a conditional edge back to an earlier node (a cycle in the graph) with the loop-continuation check written in a routing function, capped by a default recursion_limit of 25 super-steps unless raised',
        detail:
          'This is a general graph-cycle capability, not a purpose-built "Loop"/"Repeat" block a builder drops in and configures declaratively; a developer writes the state counter, the exit condition, and the conditional edge by hand. The Send API covers the concurrent/parallel case, sequential iteration is left to hand-built cycles.',
        shortValue:
          'No dedicated loop block; sequential iteration is a hand-built conditional-edge cycle',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/langgraph/use-graph-api',
            label: 'Use the graph API - Docs by LangChain',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value: '1,000+ integrations, spanning model providers, data sources, and tools',
        detail:
          'Community-maintained integrations beyond what LangChain centrally documents also exist across dedicated integration repos, so the true count is larger and harder to pin to one authoritative live number, unlike a connector-count page some workflow builders publish.',
        shortValue: '1,000+ integrations',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.langchain.com/langchain',
            label: 'LangChain: Open Source AI Agent Framework',
            asOf: '2026-07-08',
          },
        ],
      },
      triggerTypes: {
        value:
          "Not a workflow-builder concept: agents are invoked programmatically (function/API call) or served over the LangGraph Agent Server's REST interface. The Agent Server also exposes protocol-level entry points (A2A), but there is no equivalent to a connector-event/schedule/webhook trigger picker.",
        detail:
          'A developer wires up whatever trigger mechanism they need in their own application code (a cron job, a webhook handler, a queue consumer) that then calls the LangGraph SDK or REST API to start a run.',
        shortValue:
          'No trigger picker; runs are started by calling the Agent Server API from your own code',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/server-api-ref',
            label: 'Agent Server API reference - Docs by LangChain',
            asOf: '2026-07-08',
          },
        ],
      },
      customCodeSteps: {
        value:
          'Yes, by definition: every node in a LangGraph graph is arbitrary Python or JavaScript code, and the entire LangChain framework is consumed as a library inside a codebase, not a sandboxed code step within a separate visual builder',
        detail:
          'There is no separate "custom code node" concept because the whole agent, not just one step, is written in code.',
        shortValue: 'Yes, every node is Python/JavaScript code by design',
        confidence: 'verified',
        sources: [],
      },
      apiPublishing: {
        value:
          'Yes: the LangGraph Agent Server exposes deployed graphs over a REST API, and additionally supports A2A as a callable interface for the same deployed agent',
        detail:
          'A single deployed graph can be called via plain REST or the standardized A2A agent-interop protocol, depending on the caller.',
        shortValue: 'Yes, REST API plus an A2A interface',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/server-api-ref',
            label: 'Agent Server API reference - Docs by LangChain',
            asOf: '2026-07-08',
          },
          {
            url: 'https://docs.langchain.com/langsmith/server-a2a',
            label: 'A2A endpoint in Agent Server - Docs by LangChain',
            asOf: '2026-07-08',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Official Python and JavaScript/TypeScript SDKs for both LangChain and LangGraph, a public REST API for the Agent Server, and an open, MIT-licensed codebase that any developer can extend or fork; community integrations now live in their own dedicated repositories rather than the sunset langchain-community package',
        detail:
          'Because the whole product is a set of open-source libraries, extensibility is inherent rather than a separately bolted-on SDK layer, distinct from a workflow builder that offers a custom-node development kit for an otherwise closed core product.',
        shortValue:
          'Official Python/JS SDKs, open MIT-licensed codebase, integrations in standalone repos',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/langchain-ai/langchain',
            label: 'langchain-ai/langchain (GitHub)',
            asOf: '2026-07-08',
          },
          {
            url: 'https://pypi.org/project/langchain-community/',
            label: 'langchain-community on PyPI (sunset notice)',
            asOf: '2026-07-08',
          },
        ],
      },
      mcpPublishing: {
        value:
          "Yes: a LangGraph agent deployed on LangGraph Server is automatically exposed as an MCP-compatible tool via the server's built-in /mcp endpoint (Streamable HTTP), a separate mechanism from langchain-mcp-adapters, which is used only to consume external MCP servers as LangChain tools. LangGraph also supports native A2A server exposure",
        detail:
          "This is the reverse direction from consuming an external MCP server's tools, publishing a LangGraph agent's own capabilities for other MCP clients to invoke.",
        shortValue: 'Yes, LangGraph Server exposes deployed agents via a built-in /mcp endpoint',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/server-api-ref',
            label: 'Agent Server API reference - Docs by LangChain',
            asOf: '2026-07-08',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'The LangChain/LangGraph libraries themselves are free and open source (MIT); LangSmith (observability, evaluation, deployment) is a separate commercial product billed per-seat plus usage (traces, deployment uptime-minutes, compute units, sandbox resources)',
        detail:
          'Usage-based components include base/extended trace pricing (different retention windows), dev vs. production deployment uptime rates, LangChain Compute Units (LCUs) for the underlying execution engine, and sandbox CPU/memory/storage rates.',
        shortValue: 'Free OSS libraries; LangSmith is per-seat plus usage-based billing',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.langchain.com/pricing',
            label: 'LangSmith Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      entryPaidPlan: {
        value:
          'LangSmith Plus: $39/seat/month, up to 10,000 base traces/month included, then pay-as-you-go, unlimited seats, one complimentary dev deployment, email support',
        detail:
          'The Developer plan below it is $0/seat/month (single seat, up to 5,000 base traces/month, community support only), so Plus is the first genuinely paid tier.',
        shortValue: '$39/seat/month, 10,000 base traces included',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.langchain.com/pricing',
            label: 'LangSmith Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      freeTier: {
        value:
          "Yes: the LangChain/LangGraph open-source libraries are free with no usage limits of their own, and LangSmith's Developer plan is $0/seat/month with up to 5,000 base traces/month. Self-hosted LangGraph deployment is now an Enterprise (custom-priced) offering rather than a free tier",
        detail:
          'The free LangSmith Developer tier is capped at a single seat and community-only support; higher usage, team seats, or self-hosted deployment require moving to a paid or Enterprise tier.',
        shortValue: 'Free OSS libraries, plus a free single-seat LangSmith Developer tier',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.langchain.com/pricing',
            label: 'LangSmith Pricing',
            asOf: '2026-07-08',
          },
        ],
      },
      byok: {
        value:
          "Yes, by default: every model call in LangChain/LangGraph requires the developer's own provider API credentials (OpenAI, Anthropic, etc.) configured directly in application code or environment variables; LangSmith itself does not resell or proxy model access",
        detail:
          'This is the inherent architecture of a code library calling out to providers directly, not a named "BYOK" toggle in a UI.',
        shortValue:
          'Yes, de facto by architecture; every model call uses your own provider credentials',
        confidence: 'verified',
        sources: [],
      },
    },
    security: {
      soc2: {
        value:
          "Yes: LangSmith is SOC 2 Type II certified. LangGraph Platform (now branded LangSmith Deployment) is publicly announced as carrying the same attestation, sharing LangSmith's infrastructure and compliance posture.",
        detail:
          "LangChain's Trust Center (trust.langchain.com) is the canonical source but renders via client-side JavaScript, so it could not be directly verified by an automated fetch; the LangSmith-side certification is independently confirmed on a static docs page.",
        shortValue: 'Yes, SOC 2 Type II for LangSmith; LangGraph Platform shares it',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/regions-faq',
            label: 'Regions FAQ - Docs by LangChain (confirms SOC 2 Type 2)',
            asOf: '2026-07-08',
          },
        ],
      },
      dataResidency: {
        value:
          'Yes: LangSmith offers selectable regions at no extra cost — US (GCP US), EU (GCP EU), APAC (GCP APAC), and a separate AWS US region',
        detail:
          'Migrating an existing organization between regions is not supported; the region must be chosen at signup. Full self-hosting (of the OSS libraries or LangGraph Platform) is a further, absolute form of data residency control.',
        shortValue: 'Yes, US/EU/APAC/AWS-US selectable regions, no migration between them',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/regions-faq',
            label: 'Regions FAQ - Docs by LangChain',
            asOf: '2026-07-08',
          },
        ],
      },
      rbac: {
        value:
          'Yes: LangSmith Role-Based Access Control is available to Enterprise customers, with three built-in system roles (Admin, Editor, Viewer) and custom roles with granular, per-entity permissions assignable at the workspace or organization level',
        detail:
          'Editor has full permissions except workspace management (adding/removing users, changing roles, configuring service keys), which is reserved for Admin.',
        shortValue: 'Yes, on Enterprise: Admin/Editor/Viewer plus custom granular roles',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.langchain.com/blog/access-control-updates-for-langsmith',
            label: 'Role Based Access Control (RBAC) for LangSmith',
            asOf: '2026-07-02',
          },
        ],
      },
      auditLogging: {
        value:
          'Not publicly documented: no LangSmith or LangGraph Platform page describes a dedicated, exportable audit-log feature distinct from run tracing and RBAC',
        detail:
          'LangSmith exposes rich execution traces and OpenTelemetry-based export of those traces to external observability backends, but that is run/execution telemetry rather than a documented admin-activity audit log (user logins, permission changes, etc.).',
        shortValue: 'Not publicly documented as a distinct admin-activity audit log',
        confidence: 'unknown',
        sources: [],
      },
      additionalCompliance: {
        value: 'HIPAA and GDPR, in addition to SOC 2 Type II',
        detail:
          "LangChain's own docs and Trust Center state LangSmith is SOC 2 Type II, HIPAA compliant, and GDPR compliant; no ISO 27001, PCI-DSS, or FedRAMP attestation was found on LangChain's own compliance materials.",
        shortValue: 'HIPAA and GDPR compliant, alongside SOC 2 Type II',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/regions-faq',
            label: 'Regions FAQ - Docs by LangChain',
            asOf: '2026-07-02',
          },
          {
            url: 'https://trust.langchain.com/',
            label: 'LangChain Trust Center',
            asOf: '2026-07-02',
          },
        ],
      },
      modelAndToolGovernance: {
        value:
          'Not publicly documented: no LangSmith/LangGraph Platform feature restricts which LLM providers or tools a given role/user may invoke beyond general workspace RBAC and API-key scoping',
        detail:
          'Because agents are code, provider/tool selection is a decision made in the codebase itself; there is no admin console toggle limiting which model or tool a deployed agent is allowed to call at the platform level.',
        shortValue:
          'Not publicly documented; provider/tool choice lives in agent code, not an admin toggle',
        confidence: 'unknown',
        sources: [],
      },
      credentialGovernance: {
        value:
          'No: RBAC in LangSmith is scoped to workspace/organization entities (traces, datasets, deployments) via custom roles, not to individual stored provider credentials or connections',
        detail:
          "Provider API keys are typically supplied as environment variables or secrets in the developer's own deployment environment, outside any LangSmith-native credential-governance layer.",
        shortValue: 'No, RBAC governs LangSmith entities, not specific stored provider credentials',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/user-management',
            label: 'User management - Docs by LangChain',
            asOf: '2026-07-02',
          },
        ],
      },
      whiteLabeling: {
        value:
          "Not publicly documented: no LangSmith or LangGraph Platform page describes an option to replace LangChain/LangSmith branding with a customer's own across the product UI",
        detail:
          'No official documentation on customer-facing white-labeling or OEM/embed branding controls was found.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      dataRetention: {
        value:
          "Yes: LangSmith's usage-based trace pricing offers two retention tiers a customer chooses per trace, base traces (14-day retention) and extended traces (400-day retention), giving org-level control over how long execution data is kept",
        detail:
          'This retention choice is made at billing/trace-ingestion time (base vs. extended), rather than a single fixed platform-wide default.',
        shortValue: 'Yes, choose 14-day (base) or 400-day (extended) trace retention',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.langchain.com/pricing',
            label: 'LangSmith Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      piiRedaction: {
        value:
          'Yes: LangSmith supports masking sensitive data before it reaches the backend via environment-variable-level hiding of all inputs/outputs, custom masking functions for selective redaction, and a reference regex-based anonymizer example covering emails, phone numbers, full names, credit cards, and SSNs. It also integrates with third-party tools like Microsoft Presidio.',
        detail:
          "Redaction happens client-side, before the trace payload is serialized and sent, via a create_anonymizer hook, so sensitive data is stripped in the customer's own process rather than being redacted after ingestion.",
        shortValue: 'Yes, client-side masking/anonymizer hooks with regex PII detection',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/mask-inputs-outputs',
            label: 'Prevent logging of sensitive data in traces - Docs by LangChain',
            asOf: '2026-07-08',
          },
        ],
      },
      sso: {
        value:
          'Yes: LangSmith supports SAML 2.0 single sign-on for Enterprise Cloud customers, letting organizations centrally manage team access through a single authentication source',
        detail:
          'SSO is documented as an Enterprise Cloud feature rather than available to lower tiers.',
        shortValue: 'Yes, SAML 2.0 SSO, Enterprise Cloud tier',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/user-management',
            label: 'User management - Docs by LangChain',
            asOf: '2026-07-08',
          },
        ],
      },
      thirdPartyVetting: {
        value:
          "Partial: the core langchain and langchain-core packages plus a set of popular integrations are maintained and security-reviewed by LangChain's own team, but the much larger integration surface lives in the community-driven langchain-community package (and hundreds of separately published community PyPI packages), which LangChain's own security policy states is not eligible for its bug bounty program",
        detail:
          "LangChain's published security policy excludes langchain-community from bug bounty eligibility due to its community-driven nature, while still accepting and addressing reports for it. This is a lighter, best-effort review tier for community-contributed integration code compared to the core libraries and officially maintained popular integrations. No documented incident exists of a malicious or credential-stealing community-published LangChain integration package; the closest public security incident (CVE-2025-68664, a serialization-injection vulnerability nicknamed LangGrinch, CVSS 9.3) was in the core langchain-core library itself, not a third-party community integration.",
        shortValue:
          'Partial: core/popular integrations vendor-reviewed; langchain-community is community-maintained, excluded from bug bounty',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/security-policy',
            label: 'Security policy - Docs by LangChain',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/advisories/GHSA-c67j-w6g6-q2cm',
            label:
              'LangChain serialization injection vulnerability (CVE-2025-68664) - GitHub Advisory Database',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          "Yes: LangSmith provides full span-level distributed tracing of every LLM call, tool call, and intermediate step in a run, plus LangGraph Studio's time-travel debugging that lets a developer rewind to any prior checkpoint, inspect state, and fork a new execution path from it",
        detail:
          'This is deeper than dashboard-level metrics: LangSmith traces are span-based (individual step-by-step execution detail), not just aggregate run counts/success rates.',
        shortValue: 'Yes, full span-level tracing plus checkpoint-based time-travel debugging',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/observability-concepts',
            label: 'Observability concepts - Docs by LangChain',
            asOf: '2026-07-08',
          },
          {
            url: 'https://docs.langchain.com/oss/python/langgraph/use-time-travel',
            label: 'Time travel - Docs by LangChain',
            asOf: '2026-07-08',
          },
        ],
      },
      durabilityModel: {
        value:
          'LangGraph\'s checkpointer snapshots full graph state after every node completes (a "super-step"), so a run resumes from the last checkpoint after an interruption, timeout, human-approval pause, or crash rather than restarting. RetryPolicy provides automatic per-node retries with backoff/jitter, and TimeoutPolicy caps a node attempt.',
        detail:
          'Checkpointing alone does not include automatic failure detection; an external process still needs to notice a crash and trigger the resume. Durability here is a resumable-state primitive, not a fully autonomous self-healing system.',
        shortValue:
          'Checkpoint-based resume plus per-node RetryPolicy/TimeoutPolicy, no auto failure detection',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.langchain.com/blog/fault-tolerance-in-langgraph',
            label: 'Fault Tolerance in LangGraph (LangChain Blog)',
            asOf: '2026-07-02',
          },
        ],
      },
      failureAlerting: {
        value:
          'Not publicly documented: no LangSmith or LangGraph Platform page describes an automatic, proactive failure-alert notification (e.g. email/Slack) distinct from viewing failures in the trace dashboard',
        detail:
          "LangSmith surfaces failed runs and errors in its tracing UI, but no source confirms an automatic push notification/digest comparable to some workflow builders' failure-alert emails.",
        shortValue: 'Not publicly documented as a proactive alert feature',
        confidence: 'unknown',
        sources: [],
      },
      dataDrains: {
        value:
          'Yes: LangSmith services emit OpenTelemetry traces that can be exported to an observability backend of choice by configuring an OTel/Prometheus collector endpoint, letting execution data flow continuously into external systems like Datadog rather than only being viewable in LangSmith itself',
        detail:
          'This is a generic OTel-based export mechanism, not named, pre-built connectors to specific destinations like S3 or BigQuery.',
        shortValue: 'Yes, OpenTelemetry export to any OTel-compatible backend',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/export-backend',
            label: 'Export LangSmith telemetry to your observability backend - Docs by LangChain',
            asOf: '2026-07-02',
          },
        ],
      },
      asyncExecution: {
        value:
          'Yes: the LangGraph Agent Server enqueues each run for a queue worker to pick up, and its result can be polled or streamed later via the REST API, independent of the client connection that started it.',
        detail:
          "This is a natural consequence of the Agent Server's run/thread model, where a run's state persists server-side independent of any single blocking client connection.",
        shortValue: "Yes, via the Agent Server's queued run/thread API",
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/agent-server',
            label: 'Agent Server - Docs by LangChain',
            asOf: '2026-07-08',
          },
        ],
      },
      executionLimits: {
        value:
          "Not publicly documented as concrete published numbers: no LangGraph Platform or LangSmith page states a maximum run duration or a fixed concurrency ceiling comparable to some workflow builders' published limits",
        detail:
          "Execution duration and concurrency are effectively bounded by the customer's own compute/infrastructure configuration (self-hosted) or the specific managed-plan resources purchased, rather than a single documented platform-wide ceiling.",
        shortValue: 'Not publicly documented as fixed platform-wide numbers',
        confidence: 'unknown',
        sources: [],
      },
      partialFailureHandling: {
        value:
          "Yes: LangGraph's per-node RetryPolicy and TimeoutPolicy let a single failing node retry or time out independently, and a developer can route a node's error to a dedicated error-handling branch in the graph, so one step failing does not necessarily halt the entire run",
        detail:
          "This is implemented in code as explicit graph edges/conditional routing around a node's exception, rather than a single toggle exposed in a visual builder.",
        shortValue: 'Yes, per-node retry/timeout policies plus code-defined error-handling edges',
        confidence: 'verified',
        sources: [
          {
            url: 'https://deepwiki.com/langchain-ai/langgraph/3.8-error-handling-and-retry-policies',
            label: 'Error Handling and Retry Policies | langchain-ai/langgraph | DeepWiki',
            asOf: '2026-07-02',
          },
        ],
      },
      unattendedExecution: {
        value:
          'Yes, once deployed: a run started against the LangGraph Agent Server (managed LangSmith Deployment cloud, a self-hosted container, or hybrid) executes entirely server-side against its Redis/Postgres backend, with no dependency on a client device staying open, awake, or connected; interrupt()-paused runs likewise sit server-side across an arbitrary human-response gap.',
        detail:
          "This requires the graph to already be deployed to the Agent Server; LangChain/LangGraph itself has no built-in trigger picker (schedule, webhook, connector event), so a developer's own cron job, webhook handler, or queue consumer is what calls the Agent Server API to start the run in the first place. Once that call is made, the run's execution has no further tie to the caller's device.",
        shortValue: 'Yes once deployed to the Agent Server; the trigger itself is hand-wired',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/assistants',
            label: 'Assistants - Docs by LangChain',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.langchain.com/langsmith/deploy-standalone-server',
            label: 'Self-host standalone servers - Docs by LangChain',
            asOf: '2026-07-04',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Documentation via docs.langchain.com and reference.langchain.com, a public LangChain Forum, a Community Slack, GitHub issues on the open-source repos, and paid email/Enterprise support tiers through LangSmith plans',
        detail:
          'Community support is the default at the free Developer tier; email support is included starting at the Plus tier, with dedicated SLA-backed support at Enterprise.',
        shortValue: 'Docs, forum, Slack, GitHub issues, plus paid email/Enterprise tiers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.langchain.com/pricing',
            label: 'LangSmith Pricing',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.langchain.com/join-community',
            label: 'LangChain Community Slack',
            asOf: '2026-07-02',
          },
        ],
      },
      sla: {
        value:
          'Not publicly documented as a specific uptime percentage: LangSmith Enterprise lists "SLA guarantees" as an included feature, but no page publishes a concrete SLA number',
        detail:
          'The LangSmith pricing page names "SLA guarantees" under the Enterprise tier without stating the specific percentage or terms publicly.',
        shortValue: 'Enterprise includes SLA guarantees, exact terms not publicly stated',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.langchain.com/pricing',
            label: 'LangSmith Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      community: {
        value:
          'Large: 141,000+ GitHub stars on langchain-ai/langchain and 36,000+ on langchain-ai/langgraph, an active Community Slack, a dedicated LangChain Forum, and reported adoption by roughly 35% of the Fortune 500',
        detail:
          "Star counts and the Fortune 500 adoption figure are from LangChain's October 2025 Series B announcement.",
        shortValue: '141k+ and 36k+ GitHub stars; Slack and Forum communities',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/langchain-ai/langchain',
            label: 'langchain-ai/langchain (GitHub)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/langchain-ai/langgraph',
            label: 'langchain-ai/langgraph (GitHub)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.langchain.com/blog/series-b',
            label: 'LangChain raises $125M to build the platform for agent engineering',
            asOf: '2026-07-02',
          },
        ],
      },
      companyMaturity: {
        value:
          'LangChain Inc. Founded 2022 by Harrison Chase. Raised a $125M Series B led by IVP in October 2025 at a $1.25B valuation (total raised approximately $160M across seed, Series A, and Series B), with reported headcount in the roughly 260-325 employee range as of mid-2026',
        detail:
          "Prior rounds: a $10M seed from Benchmark (April 2023) and a $25M Series A led by Sequoia days later (reported at a ~$200M valuation). $10M + $25M + $125M totals approximately $160M; some third-party trackers report a higher ~$260M cumulative figure, which appears to double-count TechCrunch's July 2025 report of an in-progress raise (at a reported $1.1B valuation) as a separate round from its October 2025 close (the same round, at $1.25B) rather than an additional close, so $160M is the figure directly supported by LangChain's own funding announcement and primary reporting. Investors in the Series B include Sequoia, Benchmark, IVP, CapitalG, Sapphire Ventures, and strategic investors such as ServiceNow Ventures, Workday Ventures, Cisco Investments, Datadog Ventures, and Databricks Ventures. Employee-count sources vary by snapshot date (163 to 325 across different 2026 trackers), reflecting rapid hiring.",
        shortValue:
          'Founded 2022; $125M Series B (Oct 2025) at $1.25B valuation; ~260-325 employees',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.langchain.com/blog/series-b',
            label: 'LangChain raises $125M to build the platform for agent engineering',
            asOf: '2026-07-02',
          },
          {
            url: 'https://techcrunch.com/2025/10/21/open-source-agentic-startup-langchain-hits-1-25b-valuation/',
            label: 'Open source agentic startup LangChain hits $1.25B valuation | TechCrunch',
            asOf: '2026-07-02',
          },
        ],
      },
      academy: {
        value:
          'Yes: LangChain Academy (academy.langchain.com) is a free, structured learning platform built by the LangChain team, offering courses (video lessons, code exercises, Jupyter notebooks) on LangChain and LangGraph fundamentals, agent architectures, and advanced patterns, with completion certificates',
        detail:
          'Course content spans introductory quickstarts through advanced multi-agent and observability-focused material; roughly 13 hours of core LangGraph-focused content across the primary course sequence.',
        shortValue: 'Yes, free structured courses with certificates at LangChain Academy',
        confidence: 'verified',
        sources: [
          { url: 'https://academy.langchain.com/', label: 'LangChain Academy', asOf: '2026-07-02' },
        ],
      },
    },
  },
}
