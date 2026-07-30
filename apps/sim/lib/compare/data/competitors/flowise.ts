import { FlowiseIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Researched and cross-verified against live vendor sources on 2026-07-02. */
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
    'Flowise is an open-source, low-code visual builder for LLM chains, RAG pipelines, and multi-agent AI workflows, available self-hosted or as a managed cloud service, and owned by Workday since August 2025.',
  standoutFeatures: [
    {
      title: 'Choice of vector-store backend, with the broadest native text-splitter menu',
      description:
        "Flowise's Document Store lets a builder pick from a wide range of vector store backends to upsert into (Pinecone, Weaviate, Milvus, FAISS, and more), and offers the broadest range of native text-splitter types (character, token, recursive character, markdown, code, HTML-to-markdown) with configurable chunk size and overlap, a live preview before processing, and per-chunk editing.",
      shortDescription:
        'Pick your own vector-store backend, with the broadest built-in text-splitter menu.',
      source: {
        url: 'https://docs.flowiseai.com/using-flowise/document-stores',
        label: 'Flowise Docs: Document Stores',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Built-in dataset-based batch evaluation',
      description:
        "Flowise ships an Evaluations feature, available on Flowise Cloud/Enterprise plans (not the open-source self-hosted product), that runs chatflows/agentflows against a saved dataset in one batch, scoring outputs with string, numeric, or LLM-as-judge evaluators and reporting pass/fail rate, average tokens, and latency across the whole run. Sim's own Evaluator block scores individual calls against user-defined metrics, but has no equivalent golden-dataset batch runner. (Flowise's Agentflow V2 also has a Human Input node for pausing on approve/reject feedback, comparable to Sim's own human-in-the-loop approval block.)",
      shortDescription:
        'Built-in dataset-based batch evaluation (Cloud/Enterprise plans) with LLM-judge scoring and pass/fail reporting.',
      source: {
        url: 'https://docs.flowiseai.com/using-flowise/evaluations',
        label: 'Flowise Docs: Evaluations',
        asOf: '2026-07-08',
      },
    },
    {
      title: 'Larger existing open-source community, on the same Apache 2.0 license as Sim',
      description:
        'Both Flowise and Sim are Apache License 2.0 and self-hostable, so the license itself is not a differentiator. Where Flowise stands out is community scale: its GitHub repo has roughly 54,000 stars and an active Discord community built up since 2023.',
      shortDescription:
        'Same Apache 2.0 license as Sim, but a larger existing community: ~54k GitHub stars, active Discord.',
      source: {
        url: 'https://github.com/FlowiseAI/Flowise',
        label: 'GitHub: FlowiseAI/Flowise',
        asOf: '2026-07-02',
      },
    },
  ],
  limitations: [
    {
      title: 'Low enterprise-readiness score in third-party benchmarking',
      description:
        'The n8n 2026 AI Agent Development Tools report scored Flowise at 37% on "Enterpriseness," versus 63% on "Codability," citing gaps in security features, authentication mechanisms, and production-grade governance compared to top-performing platforms.',
      shortDescription:
        'Scored only 37% on enterprise-readiness in a third-party 2026 vendor report.',
      source: {
        url: 'https://n8n.io/reports/2026-ai-agent-development-tools/#vendors',
        label: 'n8n: 2026 AI Agent Development Tools report',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'No native real-time multiplayer canvas editing',
      description:
        "Flowise's core canvas supports only one user editing a flow at a time, with no built-in real-time co-editing of the same chatflow. A related multi-user/collaboration feature request (GitHub issue #2661) was closed as not planned.",
      shortDescription: 'No live multi-cursor concurrent editing of the same flow.',
      source: {
        url: 'https://github.com/FlowiseAI/Flowise/issues/2661',
        label: 'GitHub Issue #2661: Multi User Support (closed, not planned)',
        asOf: '2026-07-08',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'Flowise is primarily a drag-and-drop visual canvas for wiring chatflow and agentflow nodes together, supplemented by Custom JS Function nodes for arbitrary code and a Custom Tool node for JS-based tools. There is no natural-language "describe it and I\'ll build it" flow generator.',
        detail: 'No natural-language workflow generation feature.',
        shortValue: 'Visual canvas plus custom-code nodes',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.flowiseai.com/integrations/utilities/custom-js-function',
            label: 'Flowise Docs: Custom JS Function',
            asOf: '2026-07-02',
          },
        ],
      },
      learningCurve: {
        value:
          'Approachable for non-technical users via templates and drag-and-drop nodes, but real production use (custom tools, external libraries, env vars) requires developer comfort with JavaScript and LangChain concepts.',
        shortValue: 'Easy to start, technical depth needed for production',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.flowiseai.com/integrations/utilities/custom-js-function',
            label: 'Flowise Docs: Custom JS Function',
            asOf: '2026-07-02',
          },
        ],
      },
      selfHostOption: {
        value:
          "Yes: Flowise's Community Edition is Apache 2.0 and can be self-hosted, including via Docker, on your own infrastructure.",
        shortValue: 'Yes, self-hostable via Docker',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/FlowiseAI/Flowise/blob/main/LICENSE.md',
            label: 'GitHub: Flowise LICENSE.md',
            asOf: '2026-07-02',
          },
        ],
      },
      deploymentOptions: {
        value:
          'Flowise offers self-hosted open-source deployment (Docker/npm), a managed multi-tenant Cloud plan, and an Enterprise tier supporting on-premise or air-gapped deployment for regulated industries.',
        shortValue: 'Self-hosted, cloud, and enterprise on-prem/air-gapped',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.lindy.ai/blog/flowise-pricing',
            label: 'Lindy: Flowise Pricing, Features, and Alternatives for 2026',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.flowiseai.com/using-flowise/workspaces',
            label: 'Flowise Docs: Workspaces',
            asOf: '2026-07-02',
          },
        ],
      },
      templates: {
        value:
          'Yes: Flowise ships a Marketplace of pre-built, production-ready chatflow and agentflow templates (document Q&A/RAG, SQL agents, multi-agent orchestration), filterable by type, framework, and use case, plus support for organizations to save their own custom templates.',
        shortValue: 'Yes, built-in marketplace of chatflow/agentflow templates',
        confidence: 'verified',
        sources: [
          {
            url: 'https://deepwiki.com/FlowiseAI/Flowise/11.1-marketplace-and-template-flows',
            label: 'DeepWiki: Marketplace & Template Flows',
            asOf: '2026-07-02',
          },
        ],
      },
      license: {
        value:
          "Flowise's Community Edition is licensed under the Apache License, Version 2.0. Paid-tier-only modules ship under a separate Commercial License: RBAC, audit/login-activity logs, and organization workspaces are available on both the Cloud and Enterprise plans, while SSO is restricted to the Enterprise plan only.",
        shortValue: 'Apache 2.0 (core); RBAC/audit on Cloud+Enterprise, SSO Enterprise-only',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/FlowiseAI/Flowise/blob/main/LICENSE.md',
            label: 'GitHub: Flowise LICENSE.md',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.flowiseai.com/using-flowise/workspaces',
            label: 'Flowise Docs: Workspaces',
            asOf: '2026-07-08',
          },
          {
            url: 'https://docs.flowiseai.com/configuration/sso',
            label: 'Flowise Docs: SSO',
            asOf: '2026-07-08',
          },
        ],
      },
      environmentPromotion: {
        value:
          "Unknown: no documentation describes forking or cloning a whole project or workspace and promoting it between dev, QA, and production environments. Flowise's version control works at the level of individual chatflow/assistant history snapshots, not whole-environment promotion.",
        shortValue: 'Unknown / not documented',
        confidence: 'unknown',
        sources: [],
      },
      versionControlDepth: {
        value:
          'Yes: Flowise automatically saves a version snapshot every time you save a ChatFlow or Assistant, with a history view to restore prior versions. This is snapshot-and-restore depth, not full diff or branching.',
        shortValue: 'Snapshot history with restore, no diff/branching shown',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/FlowiseAI/Flowise/pull/5024',
            label: 'GitHub PR #5024: Implement version control system for ChatFlows and Assistants',
            asOf: '2026-07-02',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          "No: Flowise's canvas supports only one user per session, with no live, multi-cursor editing of the same flow. Cloud/Enterprise multi-user features (workspaces, RBAC) govern access, not concurrent editing.",
        detail:
          'No public Flowise GitHub issue specifically tracks multi-cursor/real-time canvas collaboration as a feature request; GitHub issue #2661, sometimes cited for this, is actually a closed request about user authentication, RBAC, and audit trails, not concurrent editing.',
        shortValue: 'No live multi-user concurrent canvas editing',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/workspaces',
            label: 'Flowise Docs: Workspaces',
            asOf: '2026-07-08',
          },
        ],
      },
      nativeFileStorage: {
        value:
          "Unknown: no documented general-purpose file storage system with folder hierarchy, link-sharing with access controls, or recovery of deleted items. Flowise's file handling is scoped to per-node uploads and Document Store ingestion, not a standalone file manager.",
        shortValue: 'Unknown, only per-node file uploads documented',
        confidence: 'unknown',
        sources: [],
      },
      dataTables: {
        value:
          "Unknown: no native spreadsheet-like data table feature with row/column limits and keyboard navigation is documented. Flowise's structured-data support comes through external database and vector-store connector nodes instead.",
        shortValue: 'Unknown, not documented as a native feature',
        confidence: 'unknown',
        sources: [],
      },
      richTextEditor: {
        value:
          'Unknown: no documented inline rich-text/WYSIWYG markdown editor for documents stored in Flowise.',
        shortValue: 'Unknown, not documented',
        confidence: 'unknown',
        sources: [],
      },
      subWorkflows: {
        value:
          "Yes: Flowise's Execute Flow node calls another saved Chatflow or Agentflow as a step, passes it input, waits for the child flow to finish, and receives its output back to continue the parent flow.",
        shortValue: 'Yes, via the Execute Flow node',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
            label: 'Flowise Docs: Agentflow V2 (Execute Flow node)',
            asOf: '2026-07-02',
          },
        ],
      },
      customBlocks: {
        value:
          "No: Flowise has no feature for publishing a deployed chatflow/agentflow as a named, encapsulated block that appears in the node palette for other users across an organization. Its closest feature, the Execute Flow node, only lets a flow call another saved flow by name or ID from within the same Flowise instance, passing input and receiving output; the docs describe this as invoking an existing flow, not publishing a version-synced, credential-hidden component into a shared toolbar. Flowise's Custom Tool node is likewise scoped to inline JavaScript written within a single flow, not a published workflow-as-block. There is no documented mechanism that hides a source flow's internal steps/credentials from consumers, restricts a published block via access control/permission groups, or automatically points every consumer at the source flow's latest deployed version.",
        detail:
          "This is distinct from Flowise's Execute Flow sub-workflow calling (see subWorkflows above), which is same-instance flow-to-flow composition, not org-wide reuse of a hidden, centrally-updated block by other users.",
        shortValue: 'No, only same-instance Execute Flow calls; no published org-wide block',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
            label: 'Flowise Docs: Agentflow V2 (Execute Flow node)',
            asOf: '2026-07-08',
          },
          {
            url: 'https://docs.flowiseai.com/integrations/langchain/tools/custom-tool',
            label: 'Flowise Docs: Custom Tool',
            asOf: '2026-07-08',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Yes: Flowise integrates a broad set of LLM providers including OpenAI, Azure OpenAI, AWS Bedrock, Google Vertex AI, Cohere, HuggingFace Inference, Ollama, and Replicate, plus (via its separate Chat Models integrations, e.g. ChatAnthropic) Anthropic Claude models, covering both hosted and self-hosted open-source models.',
        shortValue: 'Broad support: OpenAI, Azure, Bedrock, Google, Anthropic, Ollama, more',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/integrations/langchain/llms',
            label: 'Flowise Docs: LLMs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.flowiseai.com/integrations/langchain/chat-models',
            label: 'Flowise Docs: Chat Models (incl. ChatAnthropic)',
            asOf: '2026-07-08',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          "Yes: Flowise's Agentflow V2 provides dedicated Agent nodes plus orchestration primitives (Condition, Iteration, Human Input) for multi-step agent reasoning and tool-use loops, distinct from plain data-routing nodes.",
        shortValue: 'Yes, dedicated Agent/Condition/Iteration nodes in Agentflow V2',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
            label: 'Flowise Docs: Agentflow V2',
            asOf: '2026-07-02',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          'No: no documented feature lets a user describe an automation in plain language and have Flowise generate or edit the flow automatically. Flowise is primarily a drag-and-drop visual canvas, supplemented by Custom JS Function nodes for arbitrary code, with no natural-language "describe it and I\'ll build it" flow generator.',
        shortValue: 'No, not documented as a feature',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.flowiseai.com/integrations/utilities/custom-js-function',
            label: 'Flowise Docs: Custom JS Function',
            asOf: '2026-07-02',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          "Yes: Flowise's Document Store provides a full RAG pipeline covering document loading (PDF, web pages, Word, etc.), configurable chunking/text-splitting, multiple embedding providers, and upsert into vector stores like Pinecone, Weaviate, Milvus, and FAISS.",
        detail:
          "n8n's 2026 report rated Flowise's chunking/splitter options the broadest natively available among evaluated tools.",
        shortValue: 'Yes, full built-in Document Store RAG pipeline',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/document-stores',
            label: 'Flowise Docs: Document Stores',
            asOf: '2026-07-02',
          },
          {
            url: 'https://n8n.io/reports/2026-ai-agent-development-tools/#vendors',
            label: 'n8n: 2026 AI Agent Development Tools report',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpSupport: {
        value:
          'Yes: Flowise acts as an MCP client, consuming external MCP servers as tools via Stdio (NPX/Docker) or Streamable HTTP transports, with prebuilt MCP integrations (GitHub, Atlassian Jira, Brave Search) and a Custom MCP node for any server.',
        shortValue: 'Yes, MCP client consuming external servers as tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/tutorials/tools-and-mcp',
            label: 'Flowise Docs: Tools & MCP',
            asOf: '2026-07-02',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'Yes: Flowise has a built-in Evaluations feature that runs datasets through chatflows/agentflows and scores outputs with string-match, numeric, or LLM-as-judge evaluators, reporting pass/fail rate, average tokens consumed, and latency. There is no separate, dedicated "guardrail validation" block beyond this.',
        shortValue: 'Yes, built-in dataset-based evaluation with LLM-judge scoring',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/evaluations',
            label: 'Flowise Docs: Evaluations',
            asOf: '2026-07-02',
          },
        ],
      },
      humanInTheLoop: {
        value:
          'Yes: Agentflow V2 includes a dedicated Human Input node that pauses execution and resumes only after a human approves or rejects the pending action, with separate output paths for each outcome.',
        shortValue: 'Yes, dedicated Human Input approve/reject node',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/tutorials/human-in-the-loop',
            label: 'Flowise Docs: Human In The Loop',
            asOf: '2026-07-02',
          },
        ],
      },
      generativeMedia: {
        value:
          'Partial: Flowise supports speech-to-text nodes and multi-modal image inputs. Image and audio generation can be wired in via custom tools calling providers like Replicate (Stable Diffusion) or ElevenLabs, but the standard node library has no dedicated, built-in image, video, or text-to-speech generation node.',
        detail:
          'Community GitHub issues show text-to-speech and native image generation as requested but not shipped as first-class nodes.',
        shortValue: 'Partial: STT built in, image/TTS via custom tools only',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/FlowiseAI/Flowise/issues/2385',
            label: 'GitHub Issue #2385: Text To Speech',
            asOf: '2026-07-02',
          },
        ],
      },
      dynamicToolUse: {
        value:
          "Yes: Flowise's Agent nodes and Custom MCP integration let an agent dynamically discover and select from a connected pool of tools/actions at inference time, rather than calling only a single pre-wired tool per step.",
        shortValue: 'Yes, agents can dynamically pick from connected tools/MCP servers',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.flowiseai.com/tutorials/tools-and-mcp',
            label: 'Flowise Docs: Tools & MCP',
            asOf: '2026-07-02',
          },
        ],
      },
      modelFallback: {
        value:
          'Unknown: no documented automatic retry against a different model or provider on a failed/rate-limited LLM call.',
        shortValue: 'Unknown, not documented',
        confidence: 'unknown',
        sources: [],
      },
      agentSkills: {
        value:
          'Unknown: no documented reusable, named prompt/knowledge-snippet feature invoked by reference across multiple agents, distinct from a one-off system prompt or Variables feature.',
        detail:
          'Flowise has a general Variables feature (static/runtime key-value), but it is not documented as an agent-skill abstraction.',
        shortValue: 'Unknown, not documented as a distinct feature',
        confidence: 'unknown',
        sources: [],
      },
      nativeChatDeployment: {
        value:
          'Yes: a built flow can be deployed as a shareable public chat URL or an embeddable chat widget (popup bubble or full-page, via JS script or React components), plus a REST API endpoint.',
        shortValue: 'Yes, public chat URL and embeddable widget deployment',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/embed',
            label: 'Flowise Docs: Embed',
            asOf: '2026-07-02',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          'Yes: Flowise\'s Document Store lets users preview and edit individual chunks after ingestion (n8n\'s report calls this "post-processing"). Retrieval and upsertion views show chunk-level detail, not just whole-document results.',
        shortValue: 'Yes, per-chunk preview and editing in Document Store',
        confidence: 'verified',
        sources: [
          {
            url: 'https://n8n.io/reports/2026-ai-agent-development-tools/#vendors',
            label: 'n8n: 2026 AI Agent Development Tools report',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.flowiseai.com/using-flowise/upsertion',
            label: 'Flowise Docs: Upsertion',
            asOf: '2026-07-02',
          },
        ],
      },
      parallelExecution: {
        value:
          "No: AgentFlow V2 lets users draw a branching canvas layout, but the execution engine processes the queue one node at a time and does not run parallel branches concurrently, per user reports and Flowise's own issue tracker. This causes chat-history and input-inheritance bugs when a canvas is arranged in a parallel shape.",
        shortValue: 'No, branches in AgentFlow V2 execute sequentially, not concurrently',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/FlowiseAI/Flowise/issues/4673',
            label: 'Flowise GitHub: "Not working parallel Node in AgentFlow 2" (#4673)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/FlowiseAI/Flowise/issues/4710',
            label:
              'Flowise GitHub: "Parallel Node Execution is causing State Contamination" (#4710)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
            label: 'Flowise Docs: Agentflow V2',
            asOf: '2026-07-02',
          },
        ],
      },
      a2aProtocol: {
        value:
          'No: Google A2A (Agent2Agent) protocol support is an open, unimplemented GitHub feature request (opened April 2025). Flowise supports MCP for tool-calling but has no Agent Card or agent-to-agent discovery feature.',
        shortValue: 'No, A2A support is an open feature request, not implemented',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/FlowiseAI/Flowise/issues/4283',
            label: 'Flowise GitHub: "Support the Google A2A (Agent2Agent) Protocol" (#4283, open)',
            asOf: '2026-07-02',
          },
        ],
      },
      loopIteration: {
        value:
          "Yes: Flowise's Agentflow V2 has a dedicated Iteration node that takes an array and executes a nested sub-flow of steps once per item, running sequentially. Its separate Loop node instead jumps backward to re-run an earlier node, a retry cycle rather than a collection iterator.",
        shortValue: 'Yes, via the Iteration node (separate Loop node is retry-only)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
            label: 'Flowise Docs: Agentflow V2 (Iteration and Loop nodes)',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value:
          'Flowise documents integration categories across LLMs, vector stores, document loaders, embeddings, tools, and MCP servers (referred to internally as "nodes"), but publishes no exact total node/integration count.',
        shortValue: 'Broad multi-category node library, exact count unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.flowiseai.com/integrations',
            label: 'Flowise Docs: Integrations',
            asOf: '2026-07-02',
          },
        ],
      },
      triggerTypes: {
        value:
          'Flowise flows are triggered via the chat widget or public URL, direct REST API prediction calls (/api/v1/prediction/{chatflowId}), and Custom MCP/tool invocations. There is no dedicated cron/schedule trigger or broad library of app-specific event triggers.',
        shortValue: 'Chat, API/webhook-style prediction calls; no schedule trigger found',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://agentsapis.com/flowise-api/',
            label: 'Flowise API: Complete Developer Guide',
            asOf: '2026-07-02',
          },
        ],
      },
      customCodeSteps: {
        value:
          'Yes: Flowise has a Custom JS Function node for arbitrary JavaScript (async functions, plus built-in and external Node modules) and a Custom Tool node for JS-based agent tools. There is no dedicated Python code-step node.',
        shortValue: 'Yes, custom JavaScript function/tool nodes; no native Python step found',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/integrations/langchain/tools/custom-tool',
            label: 'Flowise Docs: Custom Tool (JS function support, built-in/external modules)',
            asOf: '2026-07-08',
          },
        ],
      },
      apiPublishing: {
        value:
          'Yes: any chatflow can be called as a REST API via /api/v1/prediction/{chatflowId}, with client code generated for Python, JavaScript, and cURL, and sessionId support for maintaining conversation context.',
        shortValue: 'Yes, REST API endpoint per flow with generated client code',
        confidence: 'verified',
        sources: [
          {
            url: 'https://agentsapis.com/flowise-api/',
            label: 'Flowise API: Complete Developer Guide',
            asOf: '2026-07-02',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Partial: Flowise provides official embed SDKs (a flowise-embed JS package and React BubbleChat/FullPageChat components) and a documented process for building custom nodes to contribute. There is no first-party marketplace for community-built node plugins beyond the flow-template Marketplace.',
        shortValue: 'Embed SDKs and custom-node dev docs; no plugin marketplace found',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.npmjs.com/package/flowise-embed',
            label: 'npm: flowise-embed',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.flowiseai.com/contributing/building-node',
            label: 'Flowise Docs: Building Node',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpPublishing: {
        value:
          "No: Flowise's documentation covers only consuming external MCP servers as an MCP client. It has no capability for publishing a deployed Flowise flow itself as a callable MCP server for other AI tools.",
        detail:
          'Third-party community wrapper packages (e.g. mcp-flowise) expose Flowise chatflows via MCP externally, but this is not native.',
        shortValue: 'No, cannot publish a flow as an MCP server',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/tutorials/tools-and-mcp',
            label: 'Flowise Docs: Tools & MCP',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Flowise Cloud prices by monthly prediction (execution) volume plus storage tier, with separate paid plans; self-hosting is free aside from your own infrastructure and LLM costs.',
        shortValue: 'Prediction-volume based tiers (cloud), free self-hosting',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.lindy.ai/blog/flowise-pricing',
            label: 'Lindy: Flowise Pricing, Features, and Alternatives for 2026',
            asOf: '2026-07-02',
          },
        ],
      },
      entryPaidPlan: {
        value:
          'The cheapest paid Cloud plan (Starter) is reported at $35/month, including unlimited flows, 10,000 predictions/month, and 1GB storage.',
        detail:
          "Sourced from third-party aggregator coverage; Flowise's own pricing page sits behind a login wall.",
        shortValue: '$35/month Starter: unlimited flows, 10k predictions, 1GB storage',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.lindy.ai/blog/flowise-pricing',
            label: 'Lindy: Flowise Pricing, Features, and Alternatives for 2026',
            asOf: '2026-07-02',
          },
        ],
      },
      freeTier: {
        value:
          'Yes: a free Cloud plan exists with 2 flows/assistants, 100 predictions per month, and 5MB storage, with community support and Flowise embed branding.',
        shortValue: 'Yes: 2 flows, 100 predictions/month, 5MB storage',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.lindy.ai/blog/flowise-pricing',
            label: 'Lindy: Flowise Pricing, Features, and Alternatives for 2026',
            asOf: '2026-07-02',
          },
        ],
      },
      byok: {
        value:
          'Yes: users configure their own LLM provider API keys as encrypted credentials within Flowise (self-hosted or cloud), so LLM usage is billed directly by the provider rather than metered by Flowise beyond its own prediction-count limits.',
        detail: 'Flowise Cloud plans still cap by predictions/month regardless of BYOK.',
        shortValue: 'Yes, bring your own LLM provider API keys',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.flowiseai.com/configuration/environment-variables',
            label: 'Flowise Docs: Environment Variables',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    security: {
      soc2: {
        value:
          'Unknown: a third-party security-scan aggregator (Nudge Security) lists Flowise as SOC 2 compliant among several other certifications, but Flowise has published no SOC 2 report, badge, or trust page of its own.',
        detail:
          'The same third-party source also claims FedRAMP and PCI compliance for a small startup, an atypical combination not corroborated on flowiseai.com.',
        shortValue: 'No official confirmation found',
        confidence: 'unknown',
        sources: [],
      },
      dataResidency: {
        value:
          'Yes, indirectly: self-hosting (including on-prem/air-gapped Enterprise deployment) lets an organization fully control data location. There is no dedicated regional-cloud-hosting option for the managed Cloud product.',
        shortValue: 'Yes via self-hosting/on-prem; no documented regional cloud option',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.lindy.ai/blog/flowise-pricing',
            label: 'Lindy: Flowise Pricing, Features, and Alternatives for 2026',
            asOf: '2026-07-02',
          },
        ],
      },
      rbac: {
        value:
          'Yes: Enterprise and Cloud Workspaces support custom roles with granular per-resource permissions (full access vs. view-only). User and Workspace Management resources (Roles, Users, Workspaces, Login Activity) are restricted to Account Admins only.',
        shortValue: 'Yes, custom roles with granular per-resource permissions (Enterprise/Cloud)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/workspaces',
            label: 'Flowise Docs: Workspaces',
            asOf: '2026-07-02',
          },
        ],
      },
      auditLogging: {
        value:
          'Yes: Workspaces (Cloud and Enterprise plans) let Account Admins see every login and logout across all users. The docs do not show a separate detailed action-by-action audit trail beyond this login activity log.',
        shortValue: 'Yes, login activity log on Cloud and Enterprise plans',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/workspaces',
            label: 'Flowise Docs: Workspaces',
            asOf: '2026-07-02',
          },
        ],
      },
      additionalCompliance: {
        value:
          'Unknown: beyond the unconfirmed third-party SOC 2 claim, Flowise has published no HIPAA, ISO 27001, PCI, or FedRAMP certification.',
        shortValue: 'Unknown, no official certifications published',
        confidence: 'unknown',
        sources: [],
      },
      modelAndToolGovernance: {
        value:
          "Unknown: no documented admin controls restrict which specific LLM providers/models or which tools/integrations a given role may use. Flowise's RBAC governs resource-level (create/edit/delete) permissions, not model/tool allowlists.",
        shortValue: 'Unknown, RBAC is resource-level not model/tool-specific',
        confidence: 'unknown',
        sources: [],
      },
      credentialGovernance: {
        value:
          "Partial: credentials can be shared across workspaces in Flowise's workspace model, but there is no documented way to restrict which specific stored credential a given role/permission group may use.",
        shortValue: 'Credentials shareable across workspaces; per-role credential limits unclear',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/workspaces',
            label: 'Flowise Docs: Workspaces',
            asOf: '2026-07-02',
          },
        ],
      },
      whiteLabeling: {
        value:
          'Partial: the free plan includes Flowise\'s own embed branding, and paid plans support customizing the embedded chat widget\'s theme (colors, welcome message, tooltips). Community reports indicate fully removing the "Powered by Flowise" watermark requires workarounds, not a clean built-in option.',
        shortValue: 'Partial: widget theming yes, full logo/brand removal unclear',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/FlowiseAI/Flowise/discussions/626',
            label: 'GitHub Discussion #626: remove the Powered by flowise watermark',
            asOf: '2026-07-02',
          },
        ],
      },
      dataRetention: {
        value:
          'Unknown: no documented org-configurable retention windows for execution logs or soft-deleted resources.',
        shortValue: 'Unknown, not documented',
        confidence: 'unknown',
        sources: [],
      },
      piiRedaction: {
        value:
          'Unknown: no documented PII detection/redaction feature for workflow content or logs.',
        shortValue: 'Unknown, not documented',
        confidence: 'unknown',
        sources: [],
      },
      sso: {
        value:
          'Yes, with a caveat: Enterprise-plan SSO supports OIDC via Microsoft Azure/Entra ID, Google, and Auth0, but has no automatic org auto-provisioning. Invited users must be added first before SSO login works.',
        detail: 'No SAML support documented.',
        shortValue: 'Yes (OIDC, Enterprise plan), but no auto-provisioning',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/configuration/sso',
            label: 'Flowise Docs: SSO',
            asOf: '2026-07-02',
          },
        ],
      },
      thirdPartyVetting: {
        value:
          "Yes: Flowise's nodes (LLMs, tools, vector stores, document loaders) live in the packages/components/nodes folder of the core FlowiseAI/Flowise monorepo. New nodes are contributed via GitHub pull request and reviewed/merged by the Flowise team before shipping in an official release, rather than published independently by third parties into an open, unreviewed marketplace. The separate Marketplace feature distributes JSON chatflow/agentflow templates, not installable executable code.",
        detail:
          "That PR-review process has not stopped a critical incident in vetted, first-party code: CVE-2025-59528 (CVSS 10.0) was an unauthenticated remote code execution flaw in the official CustomMCP node, where user-supplied mcpServerConfig input was passed into a JavaScript Function() constructor. Patched in 3.0.6, but VulnCheck observed in-the-wild exploitation starting April 2026 against thousands of still-exposed instances. By contrast, Sim documents its own thirdPartyVetting fact as every one of its 302 blocks being first-party authored and code-reviewed with no public marketplace for third-party executable code either, so the two products share the same no-open-marketplace posture; the difference is that Flowise's own review pipeline has already shipped one CVSS-10 RCE into a first-party node, which is the concrete cost of that model rather than of an unreviewed community ecosystem.",
        shortValue:
          'Yes, PR-reviewed into the core repo, but that pipeline already shipped a CVSS-10 RCE',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/contributing/building-node',
            label: 'Flowise Docs: Building Node',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/FlowiseAI/Flowise/security/advisories/GHSA-3gcm-f6qx-ff7p',
            label: 'GitHub Security Advisory GHSA-3gcm-f6qx-ff7p (CVE-2025-59528)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.csoonline.com/article/4155680/hackers-exploit-a-critical-flowise-flaw-affecting-thousands-of-ai-workflows.html',
            label:
              'CSO Online: Hackers exploit a critical Flowise flaw affecting thousands of AI workflows',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Yes: Flowise provides built-in analytics/observability and integrates with third-party tracing tools (Langfuse, Opik) for per-execution, block-level trace views including duration, cost, and token usage, beyond simple aggregate stats.',
        shortValue:
          'Yes, per-block trace views via built-in analytics and Langfuse/Opik integration',
        confidence: 'verified',
        sources: [
          {
            url: 'https://langfuse.com/integrations/no-code/flowise',
            label: 'Langfuse: Observability and Tracing for Flowise',
            asOf: '2026-07-02',
          },
        ],
      },
      durabilityModel: {
        value:
          'Unknown: no documentation describes automatic retries, checkpointing, or replay of a past execution with its original inputs.',
        shortValue: 'Unknown, not documented',
        confidence: 'unknown',
        sources: [],
      },
      failureAlerting: {
        value:
          'Unknown: no documented proactive notification (email/Slack/webhook) when a run fails or crosses a cost/latency threshold, beyond viewing failures in logs/observability tools.',
        shortValue: 'Unknown, not documented',
        confidence: 'unknown',
        sources: [],
      },
      dataDrains: {
        value:
          'Partial: Flowise supports exporting execution traces to external observability platforms (Langfuse, Opik) on an ongoing basis, but has no documented way to export raw execution/audit/usage data to generic destinations like S3, BigQuery, or Datadog.',
        shortValue: 'Partial: trace export to Langfuse/Opik only, no generic data-drain found',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://langfuse.com/integrations/no-code/flowise',
            label: 'Langfuse: Observability and Tracing for Flowise',
            asOf: '2026-07-02',
          },
        ],
      },
      asyncExecution: {
        value:
          'Partial: Flowise supports a queue-based execution mode ("Running Flowise using Queue") for scaling background job processing, but the standard /api/v1/prediction endpoint is documented as a synchronous call, with no clear poll-for-result async API pattern.',
        shortValue: 'Partial: queue mode exists, prediction API is documented as synchronous',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.flowiseai.com/configuration/running-flowise-using-queue',
            label: 'Flowise Docs: Running Flowise using Queue',
            asOf: '2026-07-02',
          },
        ],
      },
      executionLimits: {
        value:
          'Unknown: Flowise publishes no numbers for maximum single-execution duration or concurrency limits, beyond monthly prediction-count caps tied to Cloud pricing tiers.',
        shortValue: 'Unknown, only monthly prediction caps are published',
        confidence: 'unknown',
        sources: [],
      },
      partialFailureHandling: {
        value:
          'Yes: Agentflow V2\'s conditional branching and Human Input reject-path let a workflow route around a problematic step (e.g. loop back for refinement) rather than only halting entirely, though there is no dedicated "catch/error-handler" node distinct from conditional routing.',
        shortValue: 'Yes, via conditional branching / reject-loop paths in Agentflow V2',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.flowiseai.com/using-flowise/agentflowv2',
            label: 'Flowise Docs: Agentflow V2',
            asOf: '2026-07-02',
          },
        ],
      },
      unattendedExecution: {
        value:
          'Yes, for the triggers Flowise has: a chat message, a REST API prediction call, or an MCP tool invocation all execute entirely on the Flowise server (self-hosted or Flowise Cloud), with no dependency on a client device staying open, awake, or connected. Flowise has no dedicated cron/schedule trigger of its own, so a genuinely unattended, time-based run has to come from an external scheduler (e.g. a cron job or another system calling the prediction API) rather than a built-in scheduling engine.',
        detail:
          'Once a run is invoked by any supported means, closing the browser tab or disconnecting the calling client has no effect on that run completing server-side; the caveat is only that Flowise itself cannot originate a scheduled run without an outside trigger.',
        shortValue: 'Yes for triggered runs; no built-in scheduler to originate one unattended',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://agentsapis.com/flowise-api/',
            label: 'Flowise API: Complete Developer Guide',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.flowiseai.com/configuration/running-flowise-using-queue',
            label: 'Flowise Docs: Running Flowise using Queue',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Flowise offers community support (GitHub, Discord) on free/self-hosted tiers, priority support on the Pro Cloud plan, and personalized/dedicated support on Enterprise.',
        shortValue: 'Community (free), priority (Pro), dedicated (Enterprise)',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.lindy.ai/blog/flowise-pricing',
            label: 'Lindy: Flowise Pricing, Features, and Alternatives for 2026',
            asOf: '2026-07-02',
          },
        ],
      },
      sla: {
        value:
          'A formal SLA (99.99% uptime) is offered on the Enterprise plan per third-party coverage; no SLA is documented for lower tiers.',
        detail: 'No official Flowise SLA page confirms this figure.',
        shortValue: 'Yes, ~99.99% SLA claimed on Enterprise plan',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.lindy.ai/blog/flowise-pricing',
            label: 'Lindy: Flowise Pricing, Features, and Alternatives for 2026',
            asOf: '2026-07-08',
          },
        ],
      },
      community: {
        value:
          "Flowise's GitHub repository has approximately 54,000 stars (Apache 2.0 licensed core), with an active Discord community whose exact member count is not published.",
        shortValue: '~54,000 GitHub stars, active Discord community',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/FlowiseAI/Flowise',
            label: 'GitHub: FlowiseAI/Flowise',
            asOf: '2026-07-02',
          },
        ],
      },
      companyMaturity: {
        value:
          'Flowise was founded in April 2023 (Y Combinator-backed), raised approximately $500K in early funding, and was acquired by Workday in August 2025, bringing enterprise backing while keeping the open-source Community Edition intact.',
        shortValue: 'Founded 2023 (YC), acquired by Workday Aug 2025',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.prnewswire.com/news-releases/workday-acquires-flowise-bringing-powerful-ai-agent-builder-capabilities-to-the-workday-platform-302530557.html',
            label: 'PR Newswire: Workday Acquires Flowise',
            asOf: '2026-07-02',
          },
        ],
      },
      academy: {
        value:
          'Flowise runs no official academy or certification program. Third-party platforms (Coursera, Codecademy, Udemy) offer independent Flowise courses and certificates of completion, and Flowise maintains standard docs and YouTube tutorials.',
        shortValue: 'No official academy; only third-party courses exist',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.coursera.org/learn/designing-a-customer-support-chatbot-using-flowise',
            label: 'Coursera: Designing a Customer Support Chatbot Using Flowise',
            asOf: '2026-07-02',
          },
        ],
      },
    },
  },
}
