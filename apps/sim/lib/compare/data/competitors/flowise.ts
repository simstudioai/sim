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
    'Flowise is an open-source, low-code visual builder for creating LLM chains, RAG pipelines, and multi-agent AI workflows, offered as self-hosted software or a managed cloud service, and owned by Workday since August 2025.',
  standoutFeatures: [
    {
      title: 'Native RAG / Document Store pipeline',
      description:
        "Flowise's Document Store handles the full RAG pipeline in one place. It offers multiple document loaders, the broadest range of native text-splitter types (character, token, recursive character, markdown, code, HTML-to-markdown) with configurable chunk size and overlap, a live preview before processing, per-chunk editing, and upsert into a wide range of vector store backends.",
      shortDescription:
        'Native RAG pipeline with the broadest built-in text-splitter and chunking options.',
      source: {
        url: 'https://docs.flowiseai.com/using-flowise/document-stores',
        label: 'Flowise Docs: Document Stores',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Agentflow V2 with built-in human-in-the-loop and evaluation',
      description:
        'Agentflow V2 supports loops, conditional branching, and a dedicated Human Input node that pauses execution for approve/reject feedback before sensitive tool calls (bookings, sends, orders) proceed. Flowise also ships a built-in Evaluations feature that runs chatflows/agentflows against a dataset and scores outputs with string, numeric, or LLM-as-judge evaluators, reporting pass/fail rate, average tokens, and latency.',
      shortDescription:
        'Native human-approval node plus built-in dataset-based LLM-judge evaluation reporting.',
      source: {
        url: 'https://docs.flowiseai.com/tutorials/human-in-the-loop',
        label: 'Flowise Docs: Human In The Loop',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Large open-source project with Apache 2.0 core',
      description:
        "Flowise's Community Edition is Apache License 2.0, and its GitHub repo has roughly 54,000 stars. It has an active Discord community and supports full self-hosting via Docker.",
      shortDescription:
        'Apache 2.0 licensed, ~54k GitHub stars, actively maintained open-source project.',
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
        'The n8n 2026 AI Agent Development Tools report scored Flowise at only 37% on "Enterpriseness," versus 63% on "Codability." The report cites gaps in security features, authentication mechanisms, and production-grade governance compared to top-performing platforms.',
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
        "Flowise's core canvas supports only one user editing a flow at a time. There is no built-in real-time co-editing (like Google Docs) of the same chatflow, and community members have requested true multi-user collaborative editing as a feature.",
      shortDescription: 'No live multi-cursor concurrent editing of the same flow.',
      source: {
        url: 'https://github.com/FlowiseAI/Flowise/issues/2661',
        label: 'GitHub Issue #2661: Multi User Support',
        asOf: '2026-07-02',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'Flowise is primarily a drag-and-drop visual canvas for wiring chatflow and agentflow nodes together, supplemented by Custom JS Function nodes for arbitrary code and a Custom Tool node for JS-based tools. There is no dedicated natural-language "describe it and I\'ll build it" flow generator documented.',
        detail: 'No confirmed natural-language workflow generation feature.',
        shortValue: 'Visual canvas plus custom-code nodes',
        confidence: 'verified',
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
          'Marketed as low-code/no-code and approachable for non-technical users via templates and drag-and-drop nodes, but third-party review found real production use (custom tools, external libraries, env vars) requires developer comfort with JavaScript and LangChain concepts.',
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
          "Yes: Flowise's Community Edition source is Apache 2.0 and can be self-hosted, including via Docker, on your own infrastructure.",
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
          'Flowise offers self-hosted open-source deployment (Docker/npm), a managed multi-tenant Cloud plan, and an Enterprise tier that supports on-premise or air-gapped deployment for regulated industries.',
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
          'Yes: Flowise ships a Marketplace of pre-built, production-ready chatflow and agentflow templates (e.g. document Q&A/RAG, SQL agents, multi-agent orchestration), filterable by type, framework, and use case, plus support for organizations to save their own custom templates.',
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
          "Flowise's Community Edition is licensed under the Apache License, Version 2.0. Enterprise-only modules (SSO, RBAC, audit logs, organization workspaces) ship under a separate Commercial License.",
        shortValue: 'Apache 2.0 (core), commercial license for enterprise modules',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/FlowiseAI/Flowise/blob/main/LICENSE.md',
            label: 'GitHub: Flowise LICENSE.md',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/FlowiseAI/Flowise/issues/5164',
            label: 'GitHub Issue #5164: Clarify Licensing Terms for Community vs Enterprise Code',
            asOf: '2026-07-02',
          },
        ],
      },
      environmentPromotion: {
        value:
          "Unknown: no public documentation found describing forking or cloning a whole project or workspace and promoting it between dev, QA, and production environments. Flowise's version control works at the level of individual chatflow/assistant history snapshots, not whole-environment promotion.",
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
          "No: Flowise's canvas supports only one user per session. There is no documented live, multi-cursor editing of the same flow, and this has been an open community feature request.",
        detail:
          'Cloud/Enterprise multi-user features (workspaces, RBAC) govern access, not concurrent editing.',
        shortValue: 'No live multi-user concurrent canvas editing',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/FlowiseAI/Flowise/issues/2661',
            label: 'GitHub Issue #2661: Multi User Support',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeFileStorage: {
        value:
          "Unknown: no public documentation found of a general-purpose file storage system with folder hierarchy, link-sharing with access controls, and recovery of deleted items. Flowise's file handling is scoped to per-node uploads and Document Store ingestion, not a standalone file manager.",
        shortValue: 'Unknown, only per-node file uploads documented',
        confidence: 'unknown',
        sources: [],
      },
      dataTables: {
        value:
          "Unknown: no public documentation found of a native spreadsheet-like data table feature with row/column limits and keyboard navigation. Flowise's structured-data support comes through external database and vector-store connector nodes instead.",
        shortValue: 'Unknown, not documented as a native feature',
        confidence: 'unknown',
        sources: [],
      },
      richTextEditor: {
        value:
          'Unknown: no public documentation found of an inline rich-text/WYSIWYG markdown editor for documents stored in Flowise.',
        shortValue: 'Unknown, not documented',
        confidence: 'unknown',
        sources: [],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Yes: Flowise integrates a broad set of LLM providers including OpenAI, Azure OpenAI, AWS Bedrock, Google PaLM/Vertex AI, Cohere, HuggingFace Inference, Ollama, Replicate, and Anthropic models (e.g. Claude 3.5/4), covering both hosted and self-hosted open-source models.',
        shortValue: 'Broad support: OpenAI, Azure, Bedrock, Google, Anthropic, Ollama, more',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/integrations/langchain/llms',
            label: 'Flowise Docs: LLMs',
            asOf: '2026-07-02',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          "Yes: Flowise's Agentflow V2 provides dedicated Agent nodes plus orchestration primitives (Condition, Iteration, Human Input) for building multi-step agent reasoning and tool-use loops, distinct from plain data-routing nodes.",
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
          'Unknown: no public documentation found of a feature letting a user describe an automation in plain language and have Flowise generate or edit the flow automatically.',
        shortValue: 'Unknown, not documented',
        confidence: 'unknown',
        sources: [],
      },
      knowledgeBaseRag: {
        value:
          "Yes: Flowise's Document Store provides a full RAG pipeline covering document loading (PDF, web pages, Word, etc.), configurable chunking/text-splitting, multiple embedding providers, and upsert into vector stores like Pinecone, Weaviate, Milvus, and FAISS.",
        detail:
          "n8n's 2026 report rated Flowise's chunking/splitter options as the broadest natively available among evaluated tools.",
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
          'Yes: Flowise has a built-in Evaluations feature that runs datasets through chatflows/agentflows and scores outputs with string-match, numeric, or LLM-as-judge evaluators, reporting pass/fail rate, average tokens consumed, and latency. No separate, dedicated "guardrail validation" block was documented beyond this.',
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
          'Partial: Flowise supports speech-to-text nodes and multi-modal image inputs. Image and audio generation can be wired in via custom tools calling providers like Replicate (Stable Diffusion) or ElevenLabs, but no dedicated, built-in image, video, or text-to-speech generation node was found in the standard node library as of this research.',
        detail:
          'Community discussions (e.g. GitHub issues) show text-to-speech and native image generation as requested but not confirmed shipped as first-class nodes.',
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
          "Yes: Flowise's Agent nodes and Custom MCP integration let an agent dynamically discover and select from a connected pool of tools/actions at inference time, rather than only calling a single pre-wired tool per step.",
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
          'Unknown: no public documentation found of automatic retry against a different model or provider on a failed/rate-limited LLM call.',
        shortValue: 'Unknown, not documented',
        confidence: 'unknown',
        sources: [],
      },
      agentSkills: {
        value:
          'Unknown: no public documentation found of a reusable, named prompt/knowledge-snippet feature invoked by reference across multiple agents, distinct from a one-off system prompt or Variables feature.',
        detail:
          'Flowise does have a general Variables feature (static/runtime key-value) but this is not documented as an agent-skill abstraction.',
        shortValue: 'Unknown, not documented as a distinct feature',
        confidence: 'unknown',
        sources: [],
      },
      nativeChatDeployment: {
        value:
          'Yes: a built flow can be deployed as a shareable public chat URL or an embeddable chat widget (popup bubble or full-page, via JS script or React components), in addition to a REST API endpoint.',
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
          'Yes: Flowise\'s Document Store lets users preview and edit individual chunks after ingestion (n8n\'s report calls this "post-processing" with individual chunk editing). The retrieval and upsertion views show chunk-level detail, not just whole-document results.',
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
          "No: AgentFlow V2 lets users draw a branching canvas layout, but users and Flowise's own issue tracker report that the execution engine processes the queue one node at a time and does not run parallel branches concurrently, causing chat-history and input-inheritance bugs when a canvas is arranged in a parallel shape.",
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
          'No: Google A2A (Agent2Agent) protocol support is an open, unimplemented GitHub feature request (opened April 2025), not a shipped capability. Flowise supports MCP for tool-calling but has no documented Agent Card or agent-to-agent discovery feature.',
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
    },
    integrations: {
      integrationCount: {
        value:
          'Flowise documents integration categories across LLMs, vector stores, document loaders, embeddings, tools, and MCP servers (referred to internally as "nodes"), but no official, currently-published exact total node/integration count was found.',
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
          'Flowise flows are triggered via the chat widget or public URL, direct REST API prediction calls (/api/v1/prediction/{chatflowId}), and Custom MCP/tool invocations. No dedicated cron/schedule trigger, or broad library of app-specific event triggers, was found documented.',
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
          'Yes: Flowise has a Custom JS Function node for arbitrary JavaScript (async functions, plus built-in and external Node modules) and a Custom Tool node for JS-based agent tools. No dedicated Python code-step node was found documented.',
        shortValue: 'Yes, custom JavaScript function/tool nodes; no native Python step found',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.flowiseai.com/integrations/utilities/custom-js-function',
            label: 'Flowise Docs: Custom JS Function',
            asOf: '2026-07-02',
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
          'Partial: Flowise provides official embed SDKs (a flowise-embed JS package and React BubbleChat/FullPageChat components) and a documented process for building custom nodes to contribute. No public, first-party marketplace for community-built node plugins was found beyond the flow-template Marketplace.',
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
          "No: Flowise's own documentation covers only consuming external MCP servers as an MCP client; no documented capability exists for publishing a deployed Flowise flow itself as a callable MCP server for other AI tools.",
        detail:
          'Third-party community wrapper packages (e.g. mcp-flowise) expose Flowise chatflows via MCP externally, but this is not a native Flowise feature.',
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
          "Pricing sourced from third-party aggregator coverage, not Flowise's own pricing page (which returned a login wall during this research); treat as estimated.",
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
          'Unknown: a third-party security-scan aggregator (Nudge Security) lists Flowise as SOC 2 compliant among several other certifications. No SOC 2 report, badge, or trust page was found published by Flowise itself, so this claim is unverified.',
        detail:
          'Treat with skepticism: the same third-party source also claims FedRAMP and PCI compliance for a small startup, which is atypical and could not be corroborated on flowiseai.com.',
        shortValue: 'Unverified third-party claim, no official confirmation found',
        confidence: 'unknown',
        sources: [],
      },
      dataResidency: {
        value:
          'Yes, indirectly: self-hosting (including on-prem/air-gapped Enterprise deployment) lets an organization fully control data location; no dedicated regional-cloud-hosting option was documented for the managed Cloud product.',
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
          'Unknown: beyond the unverified third-party SOC 2 claim, no official Flowise-published documentation of HIPAA, ISO 27001, PCI, or FedRAMP certification was found.',
        shortValue: 'Unknown, no official certifications published',
        confidence: 'unknown',
        sources: [],
      },
      modelAndToolGovernance: {
        value:
          "Unknown: no public documentation found of admin controls restricting which specific LLM providers/models or which tools/integrations a given role may use; Flowise's documented RBAC governs resource-level (create/edit/delete) permissions, not model/tool allowlists.",
        shortValue: 'Unknown, RBAC is resource-level not model/tool-specific',
        confidence: 'unknown',
        sources: [],
      },
      credentialGovernance: {
        value:
          "Partial: credentials can be shared across workspaces in Flowise's workspace model, but no documentation was found of restricting which specific stored credential a given role/permission group may use.",
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
          'Partial: the free plan includes Flowise\'s own embed branding, and paid plans support customizing the embedded chat widget\'s theme (colors, welcome message, tooltips). Community reports indicate fully removing the "Powered by Flowise" watermark is not cleanly supported out of the box and requires workarounds.',
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
          'Unknown: no public documentation found of org-configurable retention windows for execution logs or soft-deleted resources.',
        shortValue: 'Unknown, not documented',
        confidence: 'unknown',
        sources: [],
      },
      piiRedaction: {
        value:
          'Unknown: no public documentation found of a dedicated PII detection/redaction feature for workflow content or logs.',
        shortValue: 'Unknown, not documented',
        confidence: 'unknown',
        sources: [],
      },
      sso: {
        value:
          'Yes, with a caveat: Enterprise-plan SSO supports OIDC via Microsoft Azure/Entra ID, Google, and Auth0, but there is no automatic org auto-provisioning; invited users must be added first before SSO login works.',
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
          'Unknown: no public documentation found describing automatic retries, checkpointing, or replay of a past execution with its original inputs.',
        shortValue: 'Unknown, not documented',
        confidence: 'unknown',
        sources: [],
      },
      failureAlerting: {
        value:
          'Unknown: no public documentation found of proactive notification (email/Slack/webhook) when a run fails or crosses a cost/latency threshold, beyond viewing failures in logs/observability tools.',
        shortValue: 'Unknown, not documented',
        confidence: 'unknown',
        sources: [],
      },
      dataDrains: {
        value:
          'Partial: Flowise supports exporting execution traces to external observability platforms (Langfuse, Opik) on an ongoing basis, but no documentation was found of exporting raw execution/audit/usage data to generic destinations like S3, BigQuery, or Datadog.',
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
          'Partial: Flowise supports a queue-based execution mode ("Running Flowise using Queue") for scaling background job processing, but the standard /api/v1/prediction endpoint is documented as a synchronous call. No clear public documentation of a poll-for-result async API pattern was found.',
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
          'Unknown: no published, verified numbers were found for maximum single-execution duration or concurrency limits, beyond monthly prediction-count caps tied to Cloud pricing tiers.',
        shortValue: 'Unknown, only monthly prediction caps are published',
        confidence: 'unknown',
        sources: [],
      },
      partialFailureHandling: {
        value:
          'Yes: Agentflow V2\'s conditional branching and Human Input reject-path let a workflow route around a problematic step (e.g. loop back for refinement) rather than only halting entirely, though no dedicated "catch/error-handler" node distinct from conditional routing was documented.',
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
          'A formal SLA (reported as 99.99% uptime) is offered on the Enterprise plan according to third-party coverage; no SLA is documented for lower tiers.',
        detail: 'Not independently confirmed on an official Flowise SLA page.',
        shortValue: 'Yes, ~99.99% SLA claimed on Enterprise plan',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.aicuflow.com/blog/enterprise-ai-sso-rbac-audit',
            label: 'Aicuflow: Enterprise AI Platform with SSO, Role-Based Access, and Audit Trails',
            asOf: '2026-07-02',
          },
        ],
      },
      community: {
        value:
          "Flowise's GitHub repository has approximately 54,000 stars (Apache 2.0 licensed core), with an active Discord community; exact Discord member counts were not published.",
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
          'No official Flowise-run academy or certification program was found; third-party platforms (Coursera, Codecademy, Udemy) offer independent Flowise courses and certificates of completion, and Flowise maintains standard docs and YouTube tutorials.',
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
