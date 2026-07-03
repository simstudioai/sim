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
    'LangChain is an open-source Python/JavaScript framework for building LLM applications, paired with LangGraph (a low-level, code-first agent-orchestration library for stateful, long-running agents) and LangSmith (a commercial observability, evaluation, and deployment platform for both).',
  standoutFeatures: [
    {
      title: 'Durable execution via checkpointed graph state',
      description:
        "LangGraph's checkpointer snapshots the full graph state after every node completes. If a process crashes or an agent run is interrupted (timeout, human approval, service restart), execution resumes from the last checkpoint instead of restarting from scratch, and past checkpoints can be replayed for time-travel debugging.",
      shortDescription:
        'Snapshots graph state after every node so runs resume, not restart, on failure.',
      source: {
        url: 'https://www.langchain.com/blog/fault-tolerance-in-langgraph',
        label: 'Fault Tolerance in LangGraph (LangChain Blog)',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Dynamic parallel fan-out via the Send API',
      description:
        'A routing function can return a list of Send objects instead of a single next-node key, letting LangGraph spawn a runtime-determined number of parallel branches (e.g. one worker per item in a list of unknown length) that merge back through a state reducer, a native map-reduce pattern rather than a fixed number of parallel branches wired at build time.',
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
      title: 'SKILL.md-based reusable agent skills via Deep Agents SkillsMiddleware',
      description:
        "The Deep Agents harness (LangChain's batteries-included agent framework) ships a SkillsMiddleware that loads named SKILL.md files from a directory and injects them into the system prompt using progressive disclosure (metadata surfaced first, full instructions pulled in on demand), letting a team define a workflow once and reuse it as a named capability across multiple agents.",
      shortDescription:
        'SkillsMiddleware loads named SKILL.md files and injects them via progressive disclosure.',
      source: {
        url: 'https://reference.langchain.com/python/deepagents/middleware/skills',
        label: 'skills | deepagents | LangChain Reference',
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
      title: 'LangGraph Studio: a browser-based visual agent IDE with time-travel debugging',
      description:
        "Studio renders a running agent's graph (nodes, edges, conditional branches) visually, lets a developer inspect state at every node, rewind to a previous checkpoint, edit the state, and fork a new execution path from there, and hot-reloads when a prompt or tool signature changes in code.",
      shortDescription: 'Visual graph IDE with checkpoint rewind, state editing, and hot-reload.',
      source: {
        url: 'https://www.langchain.com/blog/langgraph-studio-the-first-agent-ide',
        label: 'LangGraph Studio: The first agent IDE',
        asOf: '2026-07-02',
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
      title: 'No native, publicly deployable chat UI shipped with the open-source libraries',
      description:
        'Neither LangChain nor LangGraph ships a first-party, hosted chat widget or public chat surface a builder can toggle on for an end user. Teams that want a deployed conversational UI build their own frontend (or use a separate framework like Chainlit/Streamlit) and call the LangGraph Agent Server as a backend.',
      shortDescription:
        'No first-party hosted chat UI; teams build their own frontend against the Agent Server.',
      source: {
        url: 'https://docs.langchain.com/langsmith/assistants',
        label: 'Assistants - Docs by LangChain',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Durability is checkpoint persistence, not automatic failure detection',
      description:
        "LangGraph's checkpointer saves state after every node, but production commentary notes there is no automatic detection of a crashed process; the checkpointer only lets a resumed process recover from the last saved state. An operator (or external process supervisor) still has to notice the failure and trigger the resume.",
      shortDescription:
        'Checkpointer saves state on failure, but nothing automatically detects a crashed process.',
      source: {
        url: 'https://www.diagrid.io/blog/checkpoints-are-not-durable-execution-why-langgraph-crewai-google-adk-and-others-fall-short-for-production-agent-workflows',
        label: "Why Checkpoints Aren't Durable Execution: LangGraph",
        asOf: '2026-07-02',
      },
    },
    {
      title: 'No dedicated native image/video/audio generation capability',
      description:
        'LangChain and LangGraph provide standardized model integrations, so an agent can call a multimodal provider (DALL-E, an image model via a provider integration) as a tool, but there is no first-party, dedicated generative-media node or block comparable to a purpose-built image/video-generation feature.',
      shortDescription:
        'Multimodal generation happens only through provider integrations, not a dedicated first-party block.',
      source: {
        url: 'https://docs.langchain.com/oss/python/langchain/mcp',
        label: 'Model Context Protocol (MCP) - Docs by LangChain',
        asOf: '2026-07-02',
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
          'Code-first Python/JavaScript framework (LangChain) plus a low-level graph-orchestration library (LangGraph) for building agents in code, with LangGraph Studio providing a browser-based visual IDE to render, inspect, and debug an already-coded agent graph, and Deep Agents providing a batteries-included harness on top of both',
        detail:
          'There is no drag-and-drop agent authoring surface; developers write Python or TypeScript against LangChain/LangGraph APIs, and Studio visualizes the resulting graph for debugging and time-travel, rather than authoring it visually from scratch.',
        shortValue:
          'Code framework plus a graph-visualization/debugging Studio, not a visual builder',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.langchain.com/blog/langgraph-studio-the-first-agent-ide',
            label: 'LangGraph Studio: The first agent IDE',
            asOf: '2026-07-02',
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
          'The framework assumes Python or JavaScript proficiency and introduces its own concepts (Runnables, graphs, checkpointers, reducers, Send/Command primitives) that take real ramp-up time even for experienced engineers; LangChain Academy exists specifically to address this learning curve.',
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
          'Yes: the LangChain/LangGraph open-source libraries run entirely self-hosted by default (no vendor service required), and LangGraph Platform (the deployment/runtime layer) can also be fully self-hosted so no agent data leaves the customer VPC',
        detail:
          'A basic LangGraph server can additionally be self-hosted for free on the Developer plan with up to 100k nodes executed per month; full self-hosting of the platform layer is typically an Enterprise offering.',
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
          'Any environment that runs Python/Node for the open-source libraries themselves; LangGraph Platform (renamed LangSmith Deployment) additionally offers a managed cloud service, a standalone self-hosted container (Docker/Kubernetes/VM with a Redis + Postgres backend), and a hybrid model',
        detail:
          'Standalone container deployment requires a REDIS_URI (background task queue) and a DATABASE_URI (Postgres, for assistants/threads/runs/state); langgraph deploy (introduced March 2026) is the current production deployment path, superseding the older langgraph up Docker Compose flow.',
        shortValue: 'OSS libraries anywhere, plus managed cloud, self-hosted container, or hybrid',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/langchain-ai/langgraph/blob/main/docs/docs/cloud/deployment/standalone_container.md',
            label: 'Standalone container deployment docs (langgraph GitHub)',
            asOf: '2026-07-02',
          },
        ],
      },
      templates: {
        value:
          'Yes: a small, official set of LangGraph templates (RAG Chatbot, ReAct Agent, Data Enrichment Agent, plus a blank starter) available in Python and JavaScript, downloadable via LangGraph Studio or as standalone GitHub repos, alongside a much larger informal ecosystem of community-published starter repos',
        detail:
          'The official template count is small and curated (four templates at launch) compared to marketplace-style template galleries seen on visual workflow builders; most reuse in practice comes from cloning community GitHub repos rather than an in-product template library.',
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
          'Partial: LangGraph Platform assistants are versioned (every edit creates a new version, with instant rollback to a prior version), but this is deployment/version management within one deployed service, not a Git-backed promotion of a whole project between separate dev/test/prod environments',
        detail:
          'A LangGraph Platform deployment automatically creates a default assistant per graph; the platform tracks assistant versions and lets an operator roll back, comparable to a single-service release history rather than a multi-environment promotion pipeline.',
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
          'Standard Git-based source control for agent code (since agents are code), plus LangGraph Platform assistant-level versioning with instant rollback; no in-product visual diff/compare UI beyond what Git tooling itself provides',
        detail:
          "Because the agent logic lives in a codebase, teams get full Git history, branching, and diffing for free through their own repository, distinct from a workflow builder's in-app version history panel; LangGraph Platform layers assistant versioning on top for the deployed configuration.",
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
          "No: there is no live, concurrent multi-user editing surface, agents are authored as code in each developer's own editor/IDE and merged via standard Git workflows, not edited simultaneously inside a shared canvas",
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
          'No: neither LangChain, LangGraph, nor LangSmith provides a Drive-like file storage system with folder hierarchy, link sharing, or a recycle bin. File handling is done in application code via document loaders and external storage integrations (S3, GCS, local filesystem) that a developer wires up themselves',
        detail:
          "Deep Agents provides a virtual/in-memory filesystem abstraction for an agent's own working context (planning, scratch files), which is a per-run working memory concept, not a persistent, user-facing file manager.",
        shortValue: 'No, file handling is via document-loader code, not a built-in file manager',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langchain.com/oss/python/deepagents/overview',
            label: 'Deep Agents overview - Docs by LangChain',
            asOf: '2026-07-02',
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
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Yes: LangChain provides a standardized interface (ChatModel/Runnable) to over 100 LLM providers and hundreds of documented integrations across providers, embeddings, and vector stores, including OpenAI, Anthropic, Google, AWS Bedrock, Azure OpenAI, Mistral, Cohere, and local models via Ollama',
        detail:
          "This is the framework's foundational design goal: swap providers by changing the model class instantiation, with the rest of a chain/graph remaining unchanged.",
        shortValue: '100+ LLM providers via a standardized model interface',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.langchain.com/langchain',
            label: 'LangChain: Open Source AI Agent Framework',
            asOf: '2026-07-02',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          'Yes: LangGraph is purpose-built low-level orchestration for stateful, reasoning-driven agents, distinct from a plain deterministic chain, supporting single-agent ReAct loops, multi-agent systems, and hierarchical/supervisor architectures within one graph-based framework',
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
            url: 'https://blog.langchain.com/launching-langgraph-templates/',
            label: 'Launching LangGraph Templates (LangChain Blog)',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpSupport: {
        value:
          'Yes: the official langchain-mcp-adapters library converts external MCP server tools into LangChain/LangGraph-compatible tools over stdio or streamable HTTP transport, letting an agent call tools across multiple MCP servers, and LangGraph agents can themselves be exposed for MCP consumption',
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
          'Yes: the standard ReAct-style agent pattern in LangChain/LangGraph binds a pool of tools to a model and lets the model choose, at each step, which tool (if any) to call based on its own reasoning, rather than following a fixed, pre-wired sequence of tool calls',
        detail:
          'This dynamic selection is the core mechanic LangGraph agent templates (e.g. the ReAct Agent template) are built around, and extends to MCP-provided tools loaded at runtime.',
        shortValue: 'Yes, ReAct-style agents dynamically pick from a bound tool pool at each step',
        confidence: 'verified',
        sources: [
          {
            url: 'https://blog.langchain.com/launching-langgraph-templates/',
            label: 'Launching LangGraph Templates (LangChain Blog)',
            asOf: '2026-07-02',
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
            url: 'https://python.langchain.com/v0.2/docs/how_to/fallbacks/',
            label: 'How to add fallbacks to a runnable | LangChain',
            asOf: '2026-07-02',
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
          'No: neither the open-source libraries nor LangGraph Platform ship a first-party, publicly deployable chat widget or hosted chat page. A team deploying a conversational agent builds its own frontend (or uses a separate UI framework) calling the LangGraph Agent Server as a backend',
        detail:
          'LangGraph Studio itself provides a chat-style interaction panel for testing/debugging a graph during development, but this is a developer tool, not a shippable end-user chat deployment target.',
        shortValue: 'No first-party public chat surface; teams build and host their own frontend',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/assistants',
            label: 'Assistants - Docs by LangChain',
            asOf: '2026-07-02',
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
            url: 'https://blog.langchain.com/launching-langgraph-templates/',
            label: 'Launching LangGraph Templates (LangChain Blog)',
            asOf: '2026-07-02',
          },
        ],
      },
      parallelExecution: {
        value:
          'Yes: the Send API lets a routing function dynamically spawn N parallel branches at runtime (not just a fixed number configured ahead of time), each processing a slice of state, with results merged back through a state reducer once all branches complete, a native map-reduce/fan-out-fan-in pattern',
        detail:
          'This differs from a small, statically fixed number of parallel branches: the number of concurrent executions is determined by the routing function at run time, based on the size of whatever collection it is fanning out over.',
        shortValue:
          'Yes, Send API dynamically fans out to N parallel branches, merged via a reducer',
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
          "Yes: LangChain shipped native A2A (Agent2Agent) support via langchain-adk (March 2026), letting any LangChain agent expose itself as an A2A server and call other A2A-compliant agents regardless of the framework that built them, with Agent Cards auto-generated from the agent's name/description/tool list; the local LangGraph dev server exposes A2A endpoints at /a2a/{assistant_id}",
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
    },
    integrations: {
      integrationCount: {
        value:
          "1,000+ integrations across model providers, vector stores, document loaders, and tools (per LangChain's own marketing), with a unified interface to 100+ LLM providers specifically",
        detail:
          'The langchain-community package hosts many additional community-maintained integrations beyond what is centrally documented, so the true count is larger and harder to pin to one authoritative live number, unlike a connector-count page some workflow builders publish.',
        shortValue: '1,000+ integrations; 100+ LLM providers via a unified interface',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.langchain.com/langchain',
            label: 'LangChain: Open Source AI Agent Framework',
            asOf: '2026-07-02',
          },
        ],
      },
      triggerTypes: {
        value:
          "Not a workflow-builder concept: agents are invoked programmatically (function/API call) or served over the LangGraph Agent Server's REST/SDK interface; the Agent Server also exposes protocol-level entry points (A2A, MCP) but there is no equivalent to a connector-event/schedule/webhook trigger picker",
        detail:
          'A developer wires up whatever trigger mechanism they need in their own application code (a cron job, a webhook handler, a queue consumer) that then calls the LangGraph SDK or REST API to start a run.',
        shortValue:
          'No trigger picker; runs are started by calling the Agent Server API from your own code',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/assistants',
            label: 'Assistants - Docs by LangChain',
            asOf: '2026-07-02',
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
          'Yes: the LangGraph Agent Server exposes deployed graphs over a REST API and SDKs (Python/JS), and additionally supports the Agent Protocol, MCP, and A2A as callable interfaces for the same deployed agent',
        detail:
          'A single deployed graph can be called via plain REST, the LangGraph SDK, or one of the standardized agent-interop protocols, depending on the caller.',
        shortValue: 'Yes, REST/SDK plus Agent Protocol, MCP, and A2A interfaces',
        confidence: 'verified',
        sources: [
          {
            url: 'https://forum.langchain.com/t/langgraph-platform-deployment-failing/443',
            label: 'LangGraph Platform - forum reference on deployment interfaces',
            asOf: '2026-07-02',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Official Python and JavaScript/TypeScript SDKs for both LangChain and LangGraph, a public REST API for the Agent Server, and an open, MIT-licensed codebase that any developer can extend, fork, or contribute integrations back to via langchain-community',
        detail:
          'Because the whole product is a set of open-source libraries, extensibility is inherent rather than a separately bolted-on SDK layer, distinct from a workflow builder that offers a custom-node development kit for an otherwise closed core product.',
        shortValue:
          'Official Python/JS SDKs, open MIT-licensed codebase, community integration package',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/langchain-ai/langchain',
            label: 'langchain-ai/langchain (GitHub)',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpPublishing: {
        value:
          'Yes: an agent built with LangChain/LangGraph can be exposed as MCP tools/resources for external AI clients to call, via the same langchain-mcp-adapters ecosystem used to consume external MCP servers, in addition to native A2A server exposure',
        detail:
          "This is the reverse direction from consuming an external MCP server's tools, publishing a LangGraph agent's own capabilities for other MCP clients to invoke.",
        shortValue: 'Yes, agents can be exposed as MCP tools via langchain-mcp-adapters',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/langchain-ai/langchain-mcp-adapters',
            label: 'langchain-ai/langchain-mcp-adapters (GitHub)',
            asOf: '2026-07-02',
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
          "Yes: the LangChain/LangGraph open-source libraries are free with no usage limits of their own, and LangSmith's Developer plan is $0/seat/month with up to 5,000 base traces/month and a free, limited self-hosted LangGraph server tier (up to 100,000 nodes executed/month)",
        detail:
          'The free LangSmith Developer tier is capped at a single seat and community-only support; higher usage or team seats require moving to the Plus or Enterprise tier.',
        shortValue: 'Free OSS libraries, plus a free single-seat LangSmith Developer tier',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.langchain.com/pricing',
            label: 'LangSmith Pricing',
            asOf: '2026-07-02',
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
          'Yes: LangSmith is SOC 2 Type II compliant, and LangGraph Platform separately achieved SOC 2 Type II compliance alongside LangSmith',
        detail:
          "Confirmed directly via LangChain's own changelog announcement and Trust Center; both LangSmith and LangGraph Platform (now branded LangSmith Deployment) carry the same SOC 2 Type II attestation.",
        shortValue: 'Yes, SOC 2 Type II for both LangSmith and LangGraph Platform',
        confidence: 'verified',
        sources: [
          {
            url: 'https://changelog.langchain.com/announcements/langsmith-is-now-soc-2-type-ii-compliant',
            label: 'LangSmith is now SOC 2 Type II compliant (LangChain Changelog)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://trust.langchain.com/',
            label: 'LangChain Trust Center',
            asOf: '2026-07-02',
          },
        ],
      },
      dataResidency: {
        value:
          'Yes: LangSmith offers selectable regions at no extra cost, US (GCP US, default), EU (GCP EU), APAC (GCP APAC), and a separate AWS US region, plus multi-geo data residency options for self-hosted deployments',
        detail:
          'Migrating an existing organization between regions is not supported; the region must be chosen at signup. Full self-hosting (of the OSS libraries or LangGraph Platform) is a further, absolute form of data residency control.',
        shortValue: 'Yes, US/EU/APAC/AWS-US selectable regions, no migration between them',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/regions-faq',
            label: 'Regions FAQ - Docs by LangChain',
            asOf: '2026-07-02',
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
          'Yes: LangSmith supports masking sensitive data before it reaches the backend via environment-variable-level hiding of all inputs/outputs, custom masking functions for selective redaction, and regex-based anonymizers (with a reference implementation in langsmith-pii-removal) covering emails, IPs, phone numbers, credit cards, SSNs, and dates, plus integration points for third-party tools like Microsoft Presidio',
        detail:
          "Redaction happens client-side, before the trace payload is serialized and sent, via a create_anonymizer hook, so sensitive data is stripped in the customer's own process rather than being redacted after ingestion.",
        shortValue: 'Yes, client-side masking/anonymizer hooks with regex PII detection',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/mask-inputs-outputs',
            label: 'Prevent logging of sensitive data in traces - Docs by LangChain',
            asOf: '2026-07-02',
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
            url: 'https://changelog.langchain.com/announcements/saml-sso-for-unified-access-to-langsmith',
            label: 'SAML SSO for unified access to LangSmith (LangChain Changelog)',
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
            url: 'https://www.langchain.com/blog/langgraph-studio-the-first-agent-ide',
            label: 'LangGraph Studio: The first agent IDE',
            asOf: '2026-07-02',
          },
        ],
      },
      durabilityModel: {
        value:
          'LangGraph\'s checkpointer snapshots full graph state after every node completes (a "super-step"), so a run resumes from the last checkpoint after an interruption, timeout, human-approval pause, or crash rather than restarting; RetryPolicy provides automatic per-node retries with backoff/jitter, and TimeoutPolicy caps a node attempt',
        detail:
          'Production commentary notes checkpointing alone does not include automatic failure detection, an external process still needs to notice a crash and trigger the resume, so durability here is a resumable-state primitive, not a fully autonomous self-healing system.',
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
          'Yes: the LangGraph Agent Server supports background/async execution, a run can be started and its result polled or streamed later via the SDK/REST API, and interrupt()-paused runs inherently execute asynchronously across a human-response gap by design',
        detail:
          "This is a natural consequence of the Agent Server's run/thread model, where a run's state persists server-side independent of any single blocking client connection.",
        shortValue: "Yes, via the Agent Server's run/thread API and checkpoint-backed pausing",
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langchain.com/langsmith/assistants',
            label: 'Assistants - Docs by LangChain',
            asOf: '2026-07-02',
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
          "Star counts and Fortune 500 adoption figure are per LangChain's own reporting around its October 2025 Series B announcement.",
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
          'LangChain Inc. Founded 2022 by Harrison Chase. Raised a $125M Series B led by IVP in October 2025 at a $1.25B valuation (total raised approximately $260M), with reported headcount in the roughly 260-325 employee range as of mid-2026',
        detail:
          'Prior rounds: a $10M seed from Benchmark (April 2023) and a $25M Series A led by Sequoia days later (reportedly a ~$200M valuation). Investors in the Series B include Sequoia, Benchmark, IVP, CapitalG, Sapphire Ventures, and strategic investors such as ServiceNow Ventures, Workday Ventures, Cisco Investments, Datadog Ventures, and Databricks Ventures. Employee-count sources vary by snapshot date (163 to 325 across different 2026 trackers), reflecting rapid hiring.',
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
