import { CrewAIIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Researched and cross-verified against live vendor sources on 2026-07-02. */
export const crewaiProfile: CompetitorProfile = {
  id: 'crewai',
  name: 'CrewAI',
  website: 'https://www.crewai.com',
  oneLiner:
    'CrewAI is an open-source Python framework (MIT licensed) for orchestrating role-based, multi-agent AI systems via code (Crews and Flows), with a commercial CrewAI AMP platform layer that adds a visual Studio, hosted deployment, and enterprise governance.',
  isWorkflowBuilder: false,
  brand: {
    icon: CrewAIIcon,
    selfFramed: false,
    colors: ['#ff5a50'],
    source: 'CrewAI brand assets (crewai.com/brand)',
    asOf: '2026-07-02',
  },
  standoutFeatures: [
    {
      title: 'Dual programming model: autonomous Crews plus event-driven Flows',
      description:
        'CrewAI gives developers two composable abstractions: Crews, teams of role-based agents that collaborate with autonomy over how a task gets done, and Flows, a structured, event-driven layer (Python decorators like @start, @listen, @router) for precise, deterministic control over state and execution order. Flows can themselves orchestrate one or more Crews, letting a codebase mix free-form agent reasoning with explicit procedural logic in the same application.',
      shortDescription: 'Combines autonomous agent Crews with deterministic, event-driven Flows.',
      source: {
        url: 'https://docs.crewai.com/en/concepts/flows',
        label: 'Flows - CrewAI Docs',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Independent of LangChain, built from scratch',
      description:
        "CrewAI is built as a standalone Python framework independent of LangChain or other agent frameworks, giving it a lighter dependency footprint and its own LLM connection layer (native integrations for OpenAI, Anthropic, Gemini, and Bedrock, plus LiteLLM for 200+ additional providers) rather than inheriting an existing framework's abstractions.",
      shortDescription: 'A standalone framework, not built on top of LangChain.',
      source: {
        url: 'https://docs.crewai.com/en/concepts/llms',
        label: 'LLMs - CrewAI Docs',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Large, fast-growing open-source community',
      description:
        'The crewAIInc/crewAI GitHub repository has surpassed 54,800 stars and is MIT licensed, one of the most-starred open-source multi-agent orchestration frameworks. CrewAI states its open-source framework executes over 10 million agents per month and is used by roughly half of the Fortune 500.',
      shortDescription: '54,800+ GitHub stars, MIT licensed, widely adopted.',
      source: {
        url: 'https://github.com/crewAIInc/crewAI',
        label: 'crewAIInc/crewAI (GitHub)',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Native Agent2Agent (A2A) protocol support as a first-class primitive',
      description:
        'CrewAI treats the open Agent2Agent (A2A) protocol as a first-class delegation primitive: agents can be configured with an A2AClientConfig to delegate tasks to and request information from remote A2A-compliant agents (with Bearer, OAuth2, API key, or HTTP auth), and/or an A2AServerConfig to expose a CrewAI agent as an A2A-compliant server other frameworks can call, all via the optional crewai[a2a] extra.',
      shortDescription: 'Delegates to and serves as remote agents via the open A2A protocol.',
      source: {
        url: 'https://docs.crewai.com/en/learn/a2a-agent-delegation',
        label: 'Agent-to-Agent (A2A) Protocol - CrewAI Docs',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'CrewAI AMP: natural-language visual Studio on top of the code framework',
      description:
        'CrewAI AMP (the commercial Agent Management Platform) adds Crew Studio, a chat-and-canvas interface where a builder describes an automation in natural language and the AI generates agents, tasks, and tools as an editable drag-and-drop workflow, which can also be exported to Python code. This gives the fundamentally code-first framework an optional visual, non-developer-facing entry point.',
      shortDescription:
        'Natural-language chat generates an editable visual workflow, exportable to code.',
      source: {
        url: 'https://docs.crewai.com/en/enterprise/features/crew-studio',
        label: 'Crew Studio - CrewAI Docs',
        asOf: '2026-07-02',
      },
    },
  ],
  limitations: [
    {
      title: 'Core framework is code-only; no visual builder without the paid AMP platform',
      description:
        'The open-source crewAI framework is authored entirely in Python (classes, YAML configs, decorators). There is no built-in drag-and-drop canvas in the free/open-source package itself; visual building (Crew Studio) is a feature of the separate, commercial CrewAI AMP platform, not the framework a self-hoster runs for free.',
      shortDescription: 'No visual canvas in the free framework; Studio requires paid AMP.',
      source: {
        url: 'https://docs.crewai.com/en/enterprise/features/crew-studio',
        label: 'Crew Studio - CrewAI Docs',
        asOf: '2026-07-02',
      },
    },
    {
      title:
        'Human-in-the-loop input is a blocking, single-step primitive, not a rich approval workflow',
      description:
        "The framework's built-in human_input=True flag on a Task pauses for a human response, but community discussion and docs describe it as effectively limited to synchronous stdin-style input in local runs; production human-in-the-loop (via AMP webhooks and a pending-review state) requires the paid platform and custom webhook wiring rather than a built-in multi-channel approval UI.",
      shortDescription: 'Basic human_input flag is stdin-style; rich approval needs AMP webhooks.',
      source: {
        url: 'https://docs.crewai.com/en/learn/human-in-the-loop',
        label: 'Human-in-the-Loop (HITL) Workflows - CrewAI Docs',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Governance, security, and hosted deployment features gated to CrewAI AMP',
      description:
        'SSO (Microsoft Entra, Okta), role-based access control, dedicated VPC networking, on-premise/private-infrastructure deployment (AMP Factory), audit trails, and the SOC 2/HIPAA-compliant hosted environment are Enterprise-tier CrewAI AMP features, not part of the free, self-hosted open-source framework.',
      shortDescription:
        'SSO, RBAC, and compliance are Enterprise AMP features, not the free framework.',
      source: {
        url: 'https://crewai.com/pricing',
        label: 'CrewAI Pricing',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Native vector store support limited to two backends',
      description:
        "CrewAI's built-in RAG/knowledge system documents a provider-neutral abstraction, but currently ships native support for only ChromaDB (the default) and Qdrant as vector store backends. Broader vector database coverage (Pinecone, PGVector, Supabase, etc.) requires custom integration work rather than a documented first-party connector.",
      shortDescription: 'Native knowledge/RAG vector stores are limited to ChromaDB and Qdrant.',
      source: {
        url: 'https://docs.crewai.com/en/concepts/knowledge',
        label: 'Knowledge - CrewAI Docs',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Requires Python fluency; no low-code entry point in the core product',
      description:
        'Because Crews and Flows are authored as Python classes, decorators, and YAML configuration, using the core CrewAI framework directly assumes working knowledge of Python, virtual environments, and package management. Non-developers depend on the separate, paid AMP Studio layer rather than a built-in low-code mode in the open-source package.',
      shortDescription: 'Core framework requires Python; no low-code mode without paid AMP.',
      source: {
        url: 'https://docs.crewai.com/en/concepts/agents',
        label: 'Agents - CrewAI Docs',
        asOf: '2026-07-02',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'Code-first Python framework (Crews and Flows); visual Studio only via paid CrewAI AMP',
        detail:
          'The open-source core is authored in Python: Agents, Tasks, and Crews are Python classes/YAML config, and Flows use Python decorators (@start, @listen, @router) for event-driven orchestration. A drag-and-drop visual canvas (Crew Studio) exists only inside the commercial CrewAI AMP platform, generated from natural-language chat and exportable back to Python.',
        shortValue: 'Python code framework; visual builder is a paid AMP add-on',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/flows',
            label: 'Flows - CrewAI Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.crewai.com/en/enterprise/features/crew-studio',
            label: 'Crew Studio - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      learningCurve: {
        value: "Steep for the core framework; low for Crew Studio's natural-language mode",
        detail:
          'Using the open-source framework directly requires Python fluency (classes, YAML, async/await, package management). CrewAI markets Crew Studio, the paid AMP visual/chat layer, as accessible to non-developers who describe an automation in plain language.',
        shortValue: 'Steep in code; low via paid Studio chat interface',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/agents',
            label: 'Agents - CrewAI Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://blog.crewai.com/enabling-domain-experts-to-build-and-deploy-agentic-workflows-without-the-need-to-write-code/',
            label: 'Enabling domain experts to build agentic workflows without code - CrewAI Blog',
            asOf: '2026-07-02',
          },
        ],
      },
      selfHostOption: {
        value:
          'Yes: the open-source framework (MIT licensed) runs entirely on infrastructure you control, for free',
        detail:
          "CrewAI's own community guidance confirms the core engine is open source and can be run on your own infrastructure at no cost, with the tradeoff that the user takes on all operational overhead (servers, scaling). AMP Factory separately offers a paid, managed way to run the commercial AMP platform on private infrastructure.",
        shortValue: 'Yes, free self-hosted open-source framework',
        confidence: 'verified',
        sources: [
          {
            url: 'https://community.crewai.com/t/i-want-to-figure-out-how-to-self-host-crew-so-i-can-use-it-in-my-own-environment/2395',
            label: 'Self-host CrewAI (CrewAI Community)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/crewAIInc/crewAI',
            label: 'crewAIInc/crewAI (GitHub)',
            asOf: '2026-07-02',
          },
        ],
      },
      deploymentOptions: {
        value:
          'Self-hosted open-source framework (any Python environment); CrewAI AMP Cloud (hosted); AMP Factory for on-premise or private VPC (AWS, Azure, GCP)',
        detail:
          'AMP Factory is explicitly positioned as deploying "all the power of AMP Cloud" onto customer-owned infrastructure, on-premise or in a private VPC on AWS, Azure, or GCP, with SSO and dedicated VPC networking, an Enterprise-tier offering.',
        shortValue: 'Self-hosted OSS, AMP Cloud, or AMP Factory (on-prem/VPC)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://crewai.com/pricing',
            label: 'CrewAI Pricing',
            asOf: '2026-07-02',
          },
          {
            url: 'https://sambanova.ai/blog/sambanova-and-crewai-partner-to-deliver-agentic-ai-at-scale-on-crewai-amp',
            label: 'SambaNova and CrewAI Partner on CrewAI AMP',
            asOf: '2026-07-02',
          },
        ],
      },
      templates: {
        value:
          'Yes: CLI project scaffolding plus example crews/flows, not a large in-product gallery',
        detail:
          "The `crewai create crew` and `crewai create flow` CLI commands scaffold a new project with the standard folder structure, and crewAIInc maintains example repositories. This is developer-oriented starter scaffolding rather than a large, browsable template gallery like a no-code builder's.",
        shortValue: 'CLI scaffolding and example repos, not a large gallery',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/flows',
            label: 'Flows - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      license: {
        value:
          'MIT License (open source) for the core framework; CrewAI AMP is separate paid commercial software',
        detail:
          "The crewAIInc/crewAI GitHub repository's LICENSE file is the permissive MIT License, distinct from n8n or Power Automate's source-available/proprietary models. CrewAI AMP (Studio, hosted deployment, enterprise governance) is a separate, non-open-source commercial product layered on top.",
        shortValue: 'MIT (framework); AMP platform is proprietary/commercial',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/crewAIInc/crewAI/blob/main/LICENSE',
            label: 'crewAI/LICENSE (GitHub)',
            asOf: '2026-07-02',
          },
        ],
      },
      environmentPromotion: {
        value:
          'Not publicly documented as a distinct dev/test/prod promotion feature; deployment is Git-push-based to AMP',
        detail:
          "CrewAI AMP documents deploying a crew from a connected GitHub repository to the managed platform, but no CrewAI source describes a dedicated multi-environment (dev/staging/prod) promotion pipeline or environment-variable-swap mechanism comparable to n8n's Environments or Power Automate's Solutions/Pipelines.",
        shortValue: 'No documented dev/test/prod promotion pipeline',
        confidence: 'unknown',
        sources: [],
      },
      versionControlDepth: {
        value:
          'Git-based versioning of the underlying Python codebase, not an in-product visual version history/diff feature',
        detail:
          "Because Crews and Flows are Python code, version control is whatever the user's own Git workflow provides (commits, branches, PRs, diffs), a fundamentally different model from a no-code builder's in-app version history panel. CrewAI AMP documents deploying from a connected Git repository but no dedicated in-platform version-diff/restore UI was found.",
        shortValue: "Relies on the user's own Git workflow, no in-app version history",
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.crewai.com/en/enterprise/guides/deploy-to-amp',
            label: 'Deploy to AMP - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          'No: no live, concurrent multi-user editing is documented for either the code framework or Crew Studio',
        detail:
          "The open-source framework is edited in each developer's own IDE (collaboration happens via Git, not live co-editing). Crew Studio, the AMP visual/chat builder, is documented as an individual chat-and-canvas workspace; no source describes simultaneous multi-user cursors or synced live editing of the same crew.",
        shortValue: 'No live co-editing found in code or Studio',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.crewai.com/en/enterprise/features/crew-studio',
            label: 'Crew Studio - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeFileStorage: {
        value:
          'No: CrewAI has no Drive-like file storage system with folder hierarchy and link-based sharing',
        detail:
          "CrewAI's file-related capabilities are knowledge sources (uploading .txt/PDF/CSV/Excel/JSON files for an agent to reference) and file-operation tools (FileWriterTool, FileReadTool) that read/write to the local filesystem or a configured storage path, not a user-facing shared file manager with folders, sharing links, or a recycle bin.",
        shortValue: 'No, only per-agent knowledge files and file-operation tools',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/knowledge',
            label: 'Knowledge - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      dataTables: {
        value:
          'No: CrewAI has no native spreadsheet-like data table feature with keyboard navigation',
        detail:
          'Structured data is handled via knowledge sources (CSV/Excel/JSON files ingested for RAG) or database-connector tools (PGSearchTool, MySQLSearchTool), not a first-party grid UI for creating/editing rows and columns directly inside the product.',
        shortValue: 'No native spreadsheet-grid feature; only file/DB connectors',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/knowledge',
            label: 'Knowledge - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      richTextEditor: {
        value: 'No: CrewAI has no inline WYSIWYG rich-text/document editor',
        detail:
          'CrewAI is an agent-orchestration framework and platform; no source describes a built-in document-editing surface. Text content is produced as task output (Markdown/plain text) or ingested as a knowledge source file, not authored in an in-product rich-text editor.',
        shortValue: 'No native rich-text/WYSIWYG document editor',
        confidence: 'estimated',
        sources: [],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Yes: native OpenAI, Anthropic, Gemini, and Bedrock integrations, plus 200+ more via LiteLLM',
        detail:
          'CrewAI ships dedicated completion classes for OpenAI (Chat Completions and Responses API), Anthropic (Messages API), Google Gemini (Gen AI SDK), and AWS Bedrock (Converse API). Any other model falls back to LiteLLM, extending coverage to Mistral, Cohere, Azure OpenAI, Hugging Face, Ollama (local models), and dozens of other providers.',
        shortValue: 'OpenAI, Anthropic, Gemini, Bedrock native; 200+ via LiteLLM',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/llms',
            label: 'LLMs - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          'Yes: Agents are autonomous reasoning entities by design, distinct from the deterministic Flow control layer',
        detail:
          "An Agent (role, goal, backstory, LLM, tool list) is CrewAI's core reasoning primitive: it decides which of its assigned tools to call and how to accomplish its Task. Flows are the explicit, non-reasoning counterpart used for deterministic sequencing, so the framework treats agent reasoning and procedural control as two distinct, separately named layers.",
        shortValue: 'Yes, Agent is the dedicated autonomous-reasoning primitive',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/agents',
            label: 'Agents - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          'Yes: Crew Studio (CrewAI AMP) generates an editable workflow from a chat description',
        detail:
          'Crew Studio lets a builder describe an automation in natural language; the platform generates agents, tasks, and tools as an editable drag-and-drop canvas, exportable to Python. This is a CrewAI AMP (paid) feature, not part of the free open-source framework, where crews are still authored directly in code.',
        shortValue: 'Yes, via Crew Studio chat interface (paid AMP feature)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/enterprise/features/crew-studio',
            label: 'Crew Studio - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      knowledgeBaseRag: {
        value: 'Yes: built-in knowledge/RAG system with automatic chunking and query rewriting',
        detail:
          'CrewAI supports diverse knowledge source types (raw strings, .txt, PDF, CSV, Excel, JSON, web content via Docling) assignable at agent or crew level. Content is chunked with configurable overlap and embedded (default OpenAI text-embedding-3-small, with Voyage AI, Google, Azure OpenAI, or local Ollama embeddings as alternatives), stored in ChromaDB (default) or Qdrant, with automatic query rewriting to improve retrieval accuracy.',
        shortValue: 'Native RAG: ChromaDB/Qdrant, auto-chunking, query rewriting',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/knowledge',
            label: 'Knowledge - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpSupport: {
        value: 'Yes: MCPServerAdapter connects agents to external MCP servers over Stdio or SSE',
        detail:
          'The optional crewai-tools[mcp] extra provides MCPServerAdapter (built on mcpadapt), letting agents load and call all tools exposed by a given MCP server, supporting both local Stdio servers and remote Server-Sent Events (SSE) servers. Only MCP tools are adapted; other MCP primitives like prompts or resources are not directly integrated as of this check.',
        shortValue: 'Yes, MCPServerAdapter over Stdio and SSE, tools only',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/mcp/overview',
            label: 'MCP Servers as Tools in CrewAI - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'Yes: Task guardrails (function-based and LLM-based), plus an Enterprise Hallucination Guardrail',
        detail:
          "Task guardrails run immediately after a task produces output: function-based guardrails are custom Python validation logic, and string-based guardrails auto-generate an LLMGuardrail that uses the task's own LLM (via a temporary validation agent) to check output against natural-language criteria, covering categories like hate speech, PII exposure, hallucination, and prompt injection. A separate Hallucination Guardrail (an Enterprise/AMP feature) checks generated content against reference context for groundedness.",
        shortValue: 'Function/LLM-based guardrails; Hallucination Guardrail is Enterprise',
        confidence: 'verified',
        sources: [
          {
            url: 'https://towardsdatascience.com/how-to-implement-guardrails-for-your-ai-agents-with-crewai-80b8cb55fa43/',
            label: 'How to Implement Guardrails for Your AI Agents with CrewAI',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.crewai.com/en/enterprise/features/hallucination-guardrail',
            label: 'Hallucination Guardrail - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      humanInTheLoop: {
        value:
          'Yes: a human_input flag pauses a Task for review; AMP adds a webhook-driven pending-review state',
        detail:
          'Setting human_input=True on a Task pauses execution for human feedback before continuing, though community discussion notes the base mechanism is effectively a synchronous, stdin-style prompt in local runs. CrewAI AMP extends this to a documented "Pending Human Input" state for deployed crews, where a reviewer\'s feedback and approval are submitted via task/webhook URLs to resume execution asynchronously.',
        shortValue: 'Yes, human_input Task flag; async pending-review state on AMP',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/learn/human-in-the-loop',
            label: 'Human-in-the-Loop (HITL) Workflows - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      generativeMedia: {
        value:
          'Partial: image generation and vision tools exist via community/first-party tools, not a broad native suite',
        detail:
          'crewAI-tools includes a DallETool (image generation) and a VisionTool, giving CrewAI agents first-party access to image generation and image understanding. No dedicated native video-generation or text-to-speech/speech-to-text tool ships in the core crewAI-tools package; those require calling a provider directly through a custom or community tool.',
        shortValue: 'DallETool and VisionTool ship; no native video/TTS tool',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/crewAIInc/crewAI-tools',
            label: 'crewAIInc/crewAI-tools (GitHub)',
            asOf: '2026-07-02',
          },
        ],
      },
      dynamicToolUse: {
        value:
          'Yes: an Agent selects among all tools assigned to it at reasoning time, rather than a fixed pre-wired call',
        detail:
          "An Agent's `tools` list is the pool it reasons over; the agent's LLM decides at runtime which tool (if any) to invoke for a given step, including tools loaded dynamically from an MCP server via MCPServerAdapter. This is a design property of the Agent/Task model itself rather than a separately named feature.",
        shortValue: 'Yes, agents reason over their assigned tool pool at runtime',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/agents',
            label: 'Agents - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      modelFallback: {
        value: 'Not publicly documented as a first-class feature',
        detail:
          "No CrewAI source describes an automatic fallback to a different model/provider when a configured LLM call fails or is rate-limited; LiteLLM (which CrewAI uses under the hood for non-native providers) supports fallback configuration in general, but CrewAI's own docs do not document surfacing this as a built-in, named CrewAI feature.",
        shortValue: 'Not publicly documented as a built-in CrewAI feature',
        confidence: 'unknown',
        sources: [],
      },
      agentSkills: {
        value:
          'No dedicated named skills library; reuse comes from Python code structure and Tools',
        detail:
          'CrewAI has no first-class, named "skill" object distinct from an Agent\'s role/goal/backstory prompt or its assigned Tools. Reuse across agents/crews is achieved through ordinary Python code reuse (shared agent/task definitions, YAML configs, custom Tool classes), not a dedicated, invokable skill catalog.',
        shortValue: 'No, reuse is via Python code/Tools, not a named skills object',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/agents',
            label: 'Agents - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeChatDeployment: {
        value:
          'Partial: no first-party chat surface in the core framework; community and CopilotKit-based UIs exist',
        detail:
          'The open-source framework and CrewAI AMP center on REST API deployment (deployed crews expose a kickoff/status API) rather than a first-party, publicly deployable chat widget. Chat interfaces (e.g. the community crewai_chat_ui package, or wiring a crew through CopilotKit/AG-UI Protocol) are third-party or community additions layered on top, not a native CrewAI product surface.',
        shortValue: 'No first-party chat UI; only community/third-party wrappers',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/zinyando/crewai_chat_ui',
            label: 'crewai_chat_ui (GitHub, community package)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.copilotkit.ai/blog/how-to-add-a-frontend-to-any-crewai-agent-using-ag-ui-protocol',
            label: 'How to add a Frontend to any CrewAI Agent using AG-UI Protocol - CopilotKit',
            asOf: '2026-07-02',
          },
        ],
      },
      kbChunkVisibility: {
        value: 'Not publicly documented as an in-product debugging UI',
        detail:
          "CrewAI's knowledge system emits knowledge-related events during retrieval that a developer can log or listen to programmatically, but no CrewAI source describes a dedicated UI surface (in the open-source framework or in AMP) for browsing individual chunk index/content and per-chunk metadata after the fact.",
        shortValue: 'Not publicly documented as a dedicated chunk-debugging view',
        confidence: 'unknown',
        sources: [],
      },
      parallelExecution: {
        value:
          'Yes: async_execution=True on a Task, and Flows using asyncio.gather for concurrent branches',
        detail:
          "Setting async_execution=True on a Task lets it run in parallel with other tasks rather than waiting sequentially. At the Flow level, developers commonly implement fan-out/fan-in concurrency using Python's asyncio.gather across multiple @listen-triggered steps, and Flows support router-based conditional branching. This requires the developer to write the async pattern; it isn't a single-click visual parallel-branch node.",
        shortValue: 'Yes, via async_execution and asyncio-based Flow patterns',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/flows',
            label: 'Flows - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      a2aProtocol: {
        value:
          'Yes: native A2A client and server configuration (A2AClientConfig / A2AServerConfig)',
        detail:
          'CrewAI documents A2A as a first-class delegation primitive: an agent can be given an A2AClientConfig to delegate tasks to and request information from remote A2A-compliant agents (Bearer, OAuth2, API key, or HTTP auth supported), and/or an A2AServerConfig to expose itself as an A2A-compliant server. Requires the optional crewai[a2a] extra (a2a-sdk package).',
        shortValue: 'Yes, native A2AClientConfig/A2AServerConfig via optional extra',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/learn/a2a-agent-delegation',
            label: 'Agent-to-Agent (A2A) Protocol - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value:
          'crewAI-tools ships dozens of first-party tools; broader integration reach comes via Composio (1,000+ apps)',
        detail:
          'The official crewAIInc/crewAI-tools repository provides dozens of built-in tools spanning file operations, web scraping, database search (Postgres, MySQL), search APIs, and AI tools (DALL-E, Vision), without a single vendor-published total count. CrewAI docs separately show first-party ComposioTool integration, and Composio itself advertises 1,000+ pre-authenticated third-party apps pluggable into CrewAI agents.',
        shortValue: 'Dozens of first-party tools; 1,000+ apps via Composio',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/crewAIInc/crewAI-tools',
            label: 'crewAIInc/crewAI-tools (GitHub)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.crewai.com/en/tools/automation/composiotool',
            label: 'Composio Tool - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      triggerTypes: {
        value:
          'Webhook-based and cron/schedule triggers via CrewAI AMP, plus manual/API kickoff always available',
        detail:
          "A deployed crew always exposes a kickoff API endpoint that can be called manually or from any external scheduler. CrewAI AMP documents webhook automation (task/step/crew-level webhook URLs configured in the kickoff payload) and integration guidance for triggering runs from tools like ActivePieces, Zapier, or Make.com using their own cron/schedule triggers to call CrewAI's kickoff endpoint.",
        shortValue: 'API kickoff always available; webhooks and 3rd-party schedulers via AMP',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.crewai.com/en/enterprise/guides/webhook-automation',
            label: 'Webhook Automation - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      customCodeSteps: {
        value: 'Yes: the entire framework is Python code; custom Tools are ordinary Python classes',
        detail:
          'Because Crews and Flows are authored in Python, arbitrary custom logic is not a special "code step" distinct from the rest of the codebase, any function, class, or Tool subclass a developer writes runs as part of the crew. This is fundamentally different from a visual builder\'s isolated code-node/sandbox model.',
        shortValue: 'Yes, the whole framework is custom Python, not a sandboxed step',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/agents',
            label: 'Agents - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      apiPublishing: {
        value: 'Yes: CrewAI AMP deploys a crew as a callable REST API (kickoff/status endpoints)',
        detail:
          'Deploying to CrewAI AMP gives a crew a managed REST API for kickoff and status polling, documented as the standard way to integrate a deployed crew with existing systems. The open-source framework itself has no built-in HTTP server; self-hosters wrap it in their own API layer (e.g. FastAPI) if they want the same capability without AMP.',
        shortValue: 'Yes, via CrewAI AMP kickoff/status REST API',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/enterprise/guides/use-crew-api',
            label: 'Trigger Deployed Crew API - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'The framework itself is a Python SDK/library, plus a separate crewai-tools package and a CLI',
        detail:
          "crewAI is installed as a pip package and used as a Python SDK directly in application code (there is no separate 'client library' wrapping a remote service, the framework is the extensibility surface). A companion crewai-tools package holds reusable Tool implementations, and the crewai CLI scaffolds new crew/flow projects.",
        shortValue: 'The framework is itself a Python SDK, plus tools package and CLI',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/crewAIInc/crewAI',
            label: 'crewAIInc/crewAI (GitHub)',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpPublishing: {
        value:
          'Not publicly documented: CrewAI consumes MCP servers as a client; no documented feature exposes a crew as an MCP server',
        detail:
          "CrewAI's MCP documentation (MCPServerAdapter) covers agents calling tools hosted on external MCP servers. No CrewAI source describes the reverse direction, publishing a CrewAI crew or its tools as a callable MCP server for other AI clients to consume.",
        shortValue: 'Consumes MCP servers; no publish-crew-as-MCP-server feature found',
        confidence: 'unknown',
        sources: [],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Free open-source framework (self-hosted); CrewAI AMP tiers priced per monthly workflow execution plus seats',
        detail:
          'The open-source Python framework itself has no license cost. CrewAI AMP is priced on a Free/Basic tier (50 executions/month), a Professional tier ($25/month, roughly double the execution cap plus an extra seat), and custom-quoted Enterprise pricing for compliance, dedicated support, and private-infrastructure deployment.',
        shortValue: 'Free framework; AMP billed by monthly executions plus seats',
        confidence: 'verified',
        sources: [
          {
            url: 'https://crewai.com/pricing',
            label: 'CrewAI Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      entryPaidPlan: {
        value:
          'CrewAI AMP Professional: $25/month, roughly 100 workflow executions/month plus one added seat',
        detail:
          "The Free/Basic AMP tier includes 50 executions/month; the $25/month Professional tier is described by third-party pricing analyses as doubling that cap (about 100 executions/month) and adding a team seat. CrewAI's own pricing page does not spell out the exact numeric caps per tier beyond the free tier's 50 executions/month.",
        shortValue: '$25/month, ~100 executions/month, +1 seat',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://crewai.com/pricing',
            label: 'CrewAI Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      freeTier: {
        value:
          'Yes: free, unlimited-use open-source framework, plus a free AMP Basic tier (50 executions/month)',
        detail:
          "The MIT-licensed framework can be self-hosted and run at any scale for free. Separately, CrewAI AMP's Basic tier is a free hosted plan capped at 50 workflow executions per month with the visual editor and GitHub integration.",
        shortValue: 'Yes, free OSS framework and a capped free AMP tier',
        confidence: 'verified',
        sources: [
          {
            url: 'https://crewai.com/pricing',
            label: 'CrewAI Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      byok: {
        value:
          "Yes: the open-source framework requires the developer's own LLM provider API keys by default",
        detail:
          'Because agents call LLMs directly through native provider integrations or LiteLLM, every crew run in the open-source framework uses credentials the developer supplies (e.g. OPENAI_API_KEY, ANTHROPIC_API_KEY environment variables). CrewAI\'s own docs do not separately brand this as a "BYOK" feature, it is simply how the framework is configured; AMP\'s hosted execution may offer platform-provided model access for some plans, not independently confirmed.',
        shortValue: 'De facto yes for the OSS framework, via provider API keys',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/llms',
            label: 'LLMs - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    security: {
      soc2: {
        value:
          'Yes: CrewAI AMP has a SOC 2 Type 1 audit report (dated November 2025), available via its Trust Center',
        detail:
          "Third-party review coverage cites a CrewAI SOC 2 Type 1 Audit Report from November 2025, referenced through CrewAI's Trust Center (trust.crewai.com, indexed by Vanta). This applies to the Enterprise/AMP offering, not to a self-hosted deployment of the open-source framework, which has no compliance certification of its own since it isn't a hosted service.",
        shortValue: 'SOC 2 Type 1 report (Nov 2025) for the AMP platform',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://trust.crewai.com/',
            label: 'CrewAI Trust Center',
            asOf: '2026-07-02',
          },
        ],
      },
      dataResidency: {
        value:
          'Yes: achievable via self-hosting the OSS framework or AMP Factory (on-prem/private VPC)',
        detail:
          'Full self-hosting of the open-source framework gives complete control over data location. AMP Factory, the Enterprise-tier managed-on-your-infrastructure offering, explicitly supports on-premise servers or private VPCs in AWS, Azure, or GCP. No source confirms selectable data-residency regions for the standard multi-tenant AMP Cloud offering itself.',
        shortValue: 'Via self-hosting or AMP Factory; AMP Cloud regions unconfirmed',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://sambanova.ai/blog/sambanova-and-crewai-partner-to-deliver-agentic-ai-at-scale-on-crewai-amp',
            label: 'SambaNova and CrewAI Partner on CrewAI AMP',
            asOf: '2026-07-02',
          },
        ],
      },
      rbac: {
        value:
          'Yes: role-based access control is documented as an AMP Factory (Enterprise) feature',
        detail:
          "CrewAI AMP Factory's feature list includes role-based access control alongside SSO and dedicated VPC networking. No equivalent access-control system exists in the open-source framework itself, which has no multi-user account model.",
        shortValue: 'Yes, but only as an AMP Factory/Enterprise feature',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://sambanova.ai/blog/sambanova-and-crewai-partner-to-deliver-agentic-ai-at-scale-on-crewai-amp',
            label: 'SambaNova and CrewAI Partner on CrewAI AMP',
            asOf: '2026-07-02',
          },
        ],
      },
      auditLogging: {
        value: 'Yes: audit trails are listed among CrewAI AMP Enterprise security features',
        detail:
          "Third-party review coverage of CrewAI Enterprise lists audit trails alongside PII detection/masking, secret manager integration, and SSO as built-in Enterprise-tier security features. CrewAI's own pricing page does not itemize audit-log retention windows or export formats.",
        shortValue: 'Yes, as an AMP Enterprise feature; retention details unconfirmed',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://cybernews.com/ai-tools/crewai-review/',
            label: 'CrewAI Review 2026 - CyberNews',
            asOf: '2026-07-02',
          },
        ],
      },
      additionalCompliance: {
        value:
          'HIPAA (Enterprise edition, audit report dated February 2026); no ISO 27001, PCI, or FedRAMP certification confirmed',
        detail:
          "Trust Center coverage cites a HIPAA Audit Report dated February 2026 for the Enterprise edition, alongside the SOC 2 Type 1 report. CrewAI's pricing page separately references 'FedRamp High compliance' language for its Enterprise tier, but no independent FedRAMP authorization listing was found to corroborate that claim, so it is not treated as confirmed here.",
        shortValue: 'HIPAA audit (Feb 2026); FedRAMP claim unconfirmed independently',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://trust.crewai.com/',
            label: 'CrewAI Trust Center',
            asOf: '2026-07-02',
          },
          {
            url: 'https://crewai.com/pricing',
            label: 'CrewAI Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      modelAndToolGovernance: {
        value: 'Not publicly documented',
        detail:
          "No CrewAI source describes admin-configurable restrictions on which LLM providers/models or which specific tools a role/user may call, beyond the framework-level fact that a developer's own code controls which models and tools an agent is given.",
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      credentialGovernance: {
        value:
          'Yes: AMP Enterprise documents secret manager integration for governing stored credentials',
        detail:
          "Third-party review coverage of CrewAI Enterprise lists secret manager integration among its built-in security features, implying centralized credential storage/access rather than credentials embedded in code. Fine-grained per-role restriction of which specific credential a role may use is not itemized in CrewAI's own documentation.",
        shortValue: 'Yes, secret manager integration (Enterprise); role-level detail unconfirmed',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://cybernews.com/ai-tools/crewai-review/',
            label: 'CrewAI Review 2026 - CyberNews',
            asOf: '2026-07-02',
          },
        ],
      },
      whiteLabeling: {
        value: 'Not publicly documented',
        detail:
          'No CrewAI source describes a white-labeling or custom-branding option for the AMP platform UI or Crew Studio.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      dataRetention: {
        value: 'Not publicly documented',
        detail:
          "No CrewAI source specifies configurable retention windows for execution logs, traces, or other AMP-stored data. Self-hosted open-source runs store whatever the developer's own code persists, entirely under the operator's control by default.",
        shortValue: 'Not publicly documented for AMP; fully operator-controlled if self-hosted',
        confidence: 'unknown',
        sources: [],
      },
      piiRedaction: {
        value:
          'Yes: PII detection and masking is a documented CrewAI AMP Enterprise security feature',
        detail:
          "Third-party review coverage of CrewAI Enterprise explicitly lists 'PII detection and masking' among its built-in security features, alongside audit trails and secret manager integration. Separately, the framework's LLM-based task guardrails can be configured to check for PII exposure as one of several natural-language validation criteria, though that is a general-purpose guardrail, not dedicated PII tooling.",
        shortValue: 'Yes, PII detection/masking is an AMP Enterprise feature',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://cybernews.com/ai-tools/crewai-review/',
            label: 'CrewAI Review 2026 - CyberNews',
            asOf: '2026-07-02',
          },
        ],
      },
      sso: {
        value:
          'Yes: SSO via Microsoft Entra and Okta is documented for CrewAI AMP Factory (Enterprise)',
        detail:
          "CrewAI's own pricing page and third-party coverage of AMP Factory list SSO integration with Microsoft Entra and Okta as an Enterprise-tier feature, alongside role-based access control. No SSO capability exists in the self-hosted open-source framework, which has no built-in user/account system.",
        shortValue: 'Yes, Entra/Okta SSO, but only on Enterprise AMP',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://crewai.com/pricing',
            label: 'CrewAI Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Yes: built-in tracing of agent decisions, task execution timelines, tool usage, and LLM calls via CrewAI AMP',
        detail:
          "CrewAI's own docs describe built-in tracing capabilities viewable in the CrewAI AMP dashboard after a crew or flow runs, covering agent decisions, task execution timelines, tool usage, and LLM calls. This is a real-time, per-run trace view, distinct from the OSS framework alone, which has no bundled dashboard; third-party OpenTelemetry-based integrations (Datadog, Dynatrace, SigNoz, Instana) are also documented for exporting traces elsewhere.",
        shortValue: 'Yes, AMP dashboard traces agent/task/tool/LLM-call detail',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/en/observability/tracing',
            label: 'CrewAI Tracing - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      durabilityModel: {
        value:
          'Not publicly documented as a distinct feature beyond LLM-call retries and standard Python exception handling',
        detail:
          "LiteLLM (used for most non-native providers) and CrewAI's native provider clients handle standard API-level retry behavior for transient LLM call failures, but no CrewAI source describes a dedicated checkpointing/replay-from-history system for resuming a partially completed crew or flow run after a crash.",
        shortValue: 'Not publicly documented as a dedicated checkpoint/replay system',
        confidence: 'unknown',
        sources: [],
      },
      failureAlerting: {
        value: 'Not publicly documented as a proactive alerting feature',
        detail:
          "CrewAI AMP's webhook automation lets a developer wire crew/task/step completion (including failures) into external systems (e.g. Slack via Zapier/ActivePieces), but no CrewAI source describes a native, built-in failure-alert email or notification comparable to a first-party alerting feature.",
        shortValue: 'Achievable via webhooks to external tools, not a native alert feature',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.crewai.com/en/enterprise/guides/webhook-automation',
            label: 'Webhook Automation - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      dataDrains: {
        value:
          'Yes: third-party OpenTelemetry-based exports to Datadog, Dynatrace, SigNoz, and Instana are documented',
        detail:
          'CrewAI traces and execution data can be continuously exported to external observability platforms via OpenTelemetry-based integrations (documented by Datadog, Dynatrace, SigNoz, and IBM Instana themselves), beyond just viewing traces inside the native AMP dashboard.',
        shortValue: 'Yes, via OpenTelemetry to Datadog/Dynatrace/SigNoz/Instana',
        confidence: 'verified',
        sources: [
          {
            url: 'https://signoz.io/docs/crewai-observability/',
            label: 'CrewAI Observability & Monitoring with OpenTelemetry - SigNoz Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      asyncExecution: {
        value:
          'Yes: crews can be kicked off asynchronously (kickoff_async) and polled or awaited for a result',
        detail:
          "CrewAI's own docs cover kicking off a Crew asynchronously (kickoff_async) so the caller isn't blocked while the crew runs, and CrewAI AMP's deployed-crew API exposes kickoff plus a separate status-check endpoint for the same non-blocking pattern in production.",
        shortValue: 'Yes, via kickoff_async and AMP kickoff/status API polling',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.crewai.com/how-to/kickoff-async',
            label: 'Kickoff Crew Asynchronously - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      executionLimits: {
        value:
          'Not publicly documented as fixed numeric limits for the OSS framework; AMP plans are metered by monthly execution count',
        detail:
          "The self-hosted open-source framework has no CrewAI-imposed run-duration or concurrency ceiling, limits are whatever the operator's own infrastructure and chosen LLM provider allow. CrewAI AMP plans instead cap the number of monthly workflow executions (e.g. 50/month on the free Basic tier), a usage quota rather than a per-run duration/concurrency limit.",
        shortValue: 'No fixed OSS limits; AMP plans cap monthly execution count',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://crewai.com/pricing',
            label: 'CrewAI Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      partialFailureHandling: {
        value:
          'Yes: task-level guardrail retries and standard Python exception handling, not a distinct visual branch feature',
        detail:
          "A Task's guardrail can be configured with a retry count so a failed validation is retried rather than immediately failing the whole crew, and because Flows and Crews are plain Python, a developer can wrap any step in ordinary try/except logic to route around a single failure. There is no dedicated, named 'continue on failure' branching primitive comparable to a visual builder's per-step error path.",
        shortValue: 'Yes, via guardrail retries and standard Python exception handling',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://towardsdatascience.com/how-to-implement-guardrails-for-your-ai-agents-with-crewai-80b8cb55fa43/',
            label: 'How to Implement Guardrails for Your AI Agents with CrewAI',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Documentation (docs.crewai.com), an active community forum (community.crewai.com), and dedicated Enterprise support',
        detail:
          "CrewAI maintains a dedicated documentation site and a separate community discussion forum with active threads on framework usage and troubleshooting. CrewAI's pricing page lists 'on-site support and training' and dedicated support as part of its custom-quoted Enterprise tier.",
        shortValue: 'Docs, community forum, and paid Enterprise support',
        confidence: 'verified',
        sources: [
          {
            url: 'https://crewai.com/pricing',
            label: 'CrewAI Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      sla: {
        value: 'Not publicly documented: no product-specific uptime SLA percentage found',
        detail:
          "CrewAI's pricing page references dedicated support and training for Enterprise customers but does not publish a specific uptime SLA percentage for CrewAI AMP.",
        shortValue: 'No published SLA percentage found',
        confidence: 'unknown',
        sources: [],
      },
      community: {
        value: 'Large: 54,800+ GitHub stars and an active dedicated community forum',
        detail:
          'The crewAIInc/crewAI GitHub repository has over 54,800 stars as of this check, and CrewAI runs a separate, active community.crewai.com discussion forum with ongoing threads on framework usage, MCP integration, guardrails, and self-hosting.',
        shortValue: '54,800+ GitHub stars, active dedicated forum',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/crewAIInc/crewAI',
            label: 'crewAIInc/crewAI (GitHub)',
            asOf: '2026-07-02',
          },
        ],
      },
      companyMaturity: {
        value:
          'CrewAI Inc. Founded 2023 by João Moura. Raised $18M (seed + Series A led by Insight Partners, announced October 2024)',
        detail:
          'CrewAI Inc. was founded in 2023 and released the open-source framework the same year. The company raised $18M in total across a boldstart ventures-led seed round and an Insight Partners-led Series A (also including Blitzscaling Ventures, Craft Ventures, Earl Grey Capital, and angels including Andrew Ng and Dharmesh Shah), announced October 22, 2024. CrewAI states the open-source framework executes 10 million+ agents per month and is used by roughly half of the Fortune 500.',
        shortValue: 'Founded 2023, $18M raised (seed + Series A, Insight Partners)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://siliconangle.com/2024/10/22/agentic-ai-startup-crewai-closes-18m-funding-round/',
            label: 'Agentic AI startup CrewAI closes $18M funding round - SiliconANGLE',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.insightpartners.com/ideas/behind-the-investment-crewai/',
            label: 'Behind the Investment: CrewAI - Insight Partners',
            asOf: '2026-07-02',
          },
        ],
      },
      academy: {
        value: 'Yes: CrewAI offers free, structured courses at learn.crewai.com',
        detail:
          'CrewAI operates a dedicated learning platform with self-paced, structured courses covering the framework, Flows, and agent-building concepts, beyond ad hoc blog posts or docs pages alone.',
        shortValue: "Yes, free structured courses at CrewAI's learning platform",
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.crewai.com/en/concepts/agents',
            label: 'Agents - CrewAI Docs',
            asOf: '2026-07-02',
          },
        ],
      },
    },
  },
}
