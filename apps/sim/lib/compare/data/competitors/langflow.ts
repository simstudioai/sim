import { LangflowIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Researched and cross-verified against live vendor sources on 2026-07-02. */
export const langflowProfile: CompetitorProfile = {
  id: 'langflow',
  name: 'Langflow',
  website: 'https://www.langflow.org',
  brand: {
    icon: LangflowIcon,
    selfFramed: true,
    colors: ['#D31E47', '#7A7272'],
    source: 'GitHub organization avatar',
    asOf: '2026-07-02',
  },
  oneLiner:
    'Langflow is an open-source, Python-based visual builder for creating and deploying AI agents and RAG (retrieval-augmented generation) applications, owned by DataStax (an IBM company).',
  standoutFeatures: [
    {
      title: 'Deep LangChain/Python component ecosystem',
      description:
        "Langflow ships hundreds of drag-and-drop components organized into core groups and provider bundles (Google, OpenAI, LangChain, Elastic, Composio, and more). Any component's underlying Python code can also be edited directly for full customization.",
      shortDescription:
        'Hundreds of customizable Python/LangChain components and provider bundles.',
      source: {
        url: 'https://docs.langflow.org/concepts-components',
        label: 'Langflow Docs: Components overview',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Dual-direction MCP support',
      description:
        'Langflow can act as an MCP client, connecting to external MCP servers as tool sources. It also automatically exposes every flow with a Chat Output as its own MCP server, so any flow becomes a callable tool for outside MCP clients.',
      shortDescription: 'Both consumes external MCP servers and publishes flows as MCP servers.',
      source: {
        url: 'https://docs.langflow.org/mcp-server',
        label: 'Langflow Docs: Use Langflow as an MCP server',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Explicit flow version history with restore',
      description:
        'The flow editor has a Version History panel where users manually save named snapshots, preview a prior version in read-only mode, and restore it. It can optionally auto-back up the current draft first, and this is separate from the continuous auto-save of the working draft.',
      shortDescription: 'Manual flow snapshots with preview and one-click restore.',
      source: {
        url: 'https://docs.langflow.org/concepts-flows',
        label: 'Langflow Docs: Build flows',
        asOf: '2026-07-02',
      },
    },
  ],
  limitations: [
    {
      title: 'No real-time multiplayer editing',
      description:
        "Multiple users cannot co-edit the same flow with live cursors or synced operations. There's an open community feature request for real-time collaboration like Figma or n8n's. Current practice is exporting flows as JSON and merging changes like code, or sharing an account.",
      shortDescription:
        'No live multi-user co-editing; only JSON export/import or shared accounts.',
      source: {
        url: 'https://github.com/langflow-ai/langflow/issues/1864',
        label: 'GitHub Issue 1864: Collaborative/Access Control enhancement',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Lowest enterprise-readiness scores in third-party benchmark',
      description:
        "n8n's 2026 AI Agent Development Tools report scored Langflow 35 percent on Codability and 30 percent on Enterprisiness, the lowest of the vendors evaluated, citing gaps in agent sandboxing, security guardrail maturity, and evaluation frameworks.",
      shortDescription:
        "Scored lowest on codability (35%) and enterprisiness (30%) in n8n's 2026 report.",
      source: {
        url: 'https://n8n.io/reports/2026-ai-agent-development-tools/#vendors',
        label: 'n8n: 2026 AI Agent Development Tools report',
        asOf: '2026-07-02',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          "Langflow is primarily a visual drag-and-drop canvas builder for connecting components into a flow. Every component's Python source is directly editable for code-level customization, and a Langflow Assistant can help build or edit flows conversationally.",
        detail: 'Core paradigm is visual; code editing and an AI assistant are supplementary.',
        shortValue: 'Visual canvas plus editable Python code, some NL assist',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/concepts-components',
            label: 'Langflow Docs: Components overview',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.langflow.org/langflow-assistant',
            label: 'Langflow Docs: Langflow Assistant',
            asOf: '2026-07-02',
          },
        ],
      },
      learningCurve: {
        value:
          'Langflow targets developers comfortable with Python and LangChain concepts such as embeddings, vector stores, chunking, and prompt chains. Non-technical users can use starter templates, but customizing components or debugging chains requires a technical background.',
        shortValue: 'Moderate to steep, aimed at developers',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langflow.org/starter-projects-vector-store-rag',
            label: 'Langflow Docs: Vector store RAG starter project',
            asOf: '2026-07-02',
          },
        ],
      },
      selfHostOption: {
        value:
          'Yes: Langflow is fully open source (MIT licensed) and can be self-hosted via pip/uv local install, Docker, or Kubernetes, in addition to a desktop app and Langflow Cloud.',
        shortValue: 'Yes, self-hostable (pip, Docker, K8s)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/get-started-installation',
            label: 'Langflow Docs: Install Langflow',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/langflow-ai/langflow',
            label: 'GitHub: langflow-ai/langflow',
            asOf: '2026-07-02',
          },
        ],
      },
      deploymentOptions: {
        value:
          'Langflow can run as a desktop app on Windows/macOS, a local pip/uv install, a Docker container, or a Kubernetes deployment, plus a hosted Langflow Cloud option with a free account tier. Multi-worker setups are documented for scaling self-hosted instances.',
        shortValue: 'Desktop, local, Docker/K8s, cloud, self-hosted',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/get-started-installation',
            label: 'Langflow Docs: Install Langflow',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.langflow.org/deployment-kubernetes-dev',
            label: 'Langflow Docs: Kubernetes deployment',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.langflow.org/deployment-multi-worker',
            label: 'Langflow Docs: Deploy Langflow with multiple workers',
            asOf: '2026-07-02',
          },
        ],
      },
      templates: {
        value:
          'Yes: Langflow ships starter projects and templates, including Basic Prompting, Vector Store RAG, Document Q&A, Memory Chatbot, Blog Writer, and Simple Agent. These are accessible from a Templates modal when creating a new flow, plus a public templates gallery on langflow.org.',
        shortValue: 'Yes, built-in starter project templates',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/starter-projects-basic-prompting',
            label: 'Langflow Docs: Basic prompting starter project',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.langflow.org/templates/use-langflow-to-build-local-rag-pipeline-with-ollama-and-chromadb',
            label: 'Langflow templates gallery example',
            asOf: '2026-07-02',
          },
        ],
      },
      license: {
        value:
          "Langflow's core is MIT licensed, a permissive open-source license, per its public GitHub repository.",
        shortValue: 'MIT license',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/langflow-ai/langflow',
            label: 'GitHub: langflow-ai/langflow (License: MIT)',
            asOf: '2026-07-02',
          },
        ],
      },
      environmentPromotion: {
        value:
          "Unknown: no public documentation describes forking or cloning a full project or workspace and promoting changes between separate dev/qa/prod environments. Langflow's version history operates at the single-flow level, not the project or environment level.",
        detail: 'Version history is per-flow snapshotting, not multi-environment promotion.',
        shortValue: 'Unknown, no project-level env promotion documented',
        confidence: 'unknown',
        sources: [],
      },
      versionControlDepth: {
        value:
          'Yes: Langflow has a Version History menu for saving named snapshots of a flow, previewing a saved version in read-only mode, and restoring it, with an optional auto-backup of the current draft first. Auto-save of the working draft runs separately from these explicit versions.',
        detail: 'No diff/compare view or branching documented.',
        shortValue: 'Manual snapshots, preview, and restore',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/concepts-flows',
            label: 'Langflow Docs: Build flows',
            asOf: '2026-07-02',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          "No: real-time multi-user editing of the same flow isn't available. It's an open community feature request; current practice is JSON export/import or Git-based merging of flows between teammates.",
        shortValue: 'No live multi-user co-editing',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/langflow-ai/langflow/issues/1864',
            label: 'GitHub Issue 1864: Collaborative/Access Control enhancement',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeFileStorage: {
        value:
          'Partial: Langflow has a per-server File Management system with a local or S3 storage backend, letting files be uploaded once and reused across flows. There is no documented folder hierarchy, link-based sharing with auth options, or deleted-item recovery.',
        shortValue: 'Basic shared file store, no folders/sharing/trash',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/concepts-file-management',
            label: 'Langflow Docs: Manage files',
            asOf: '2026-07-02',
          },
        ],
      },
      dataTables: {
        value:
          "No: Langflow's documentation does not describe a native spreadsheet-like data table feature. It exposes Data and DataFrame object types used to pass structured data between components, not a persistent spreadsheet UI.",
        shortValue: 'No native spreadsheet-style data table',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langflow.org/components-data',
            label: 'Langflow Docs: Data components',
            asOf: '2026-07-02',
          },
        ],
      },
      richTextEditor: {
        value:
          'Unknown: no public documentation describes an inline rich-text or WYSIWYG markdown editor for documents stored in Langflow; file handling documentation covers upload and parsing, not in-app document editing.',
        shortValue: 'Unknown, no WYSIWYG editor documented',
        confidence: 'unknown',
        sources: [],
      },
      subWorkflows: {
        value:
          "Yes: Langflow's Run Flow component runs another saved flow as a subprocess of the current flow, dynamically generating input and output fields from the target flow's graph so the parent flow passes data in and receives the child flow's outputs back. It can also be attached to an Agent component as a callable tool.",
        shortValue: 'Yes, via the Run Flow component',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/run-flow',
            label: 'Langflow Docs: Run Flow component',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          "Langflow supports configuring multiple LLM providers globally via Settings > Model Providers, each with its own API key, including OpenAI and Ollama for local or self-hosted models. The full list of supported providers is only shown in the running app's UI, not enumerated in the docs.",
        detail: 'Exact provider count not fully published in docs.',
        shortValue: 'Multiple providers via global Model Providers settings',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langflow.org/components-models',
            label: 'Langflow Docs: Language Model component',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.langflow.org/blog/local-ai-using-ollama-with-agents',
            label: 'Langflow blog: Using Ollama with agents',
            asOf: '2026-07-02',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          'Yes: Langflow has a dedicated Agent and Tool Calling Agent component that uses a connected LLM to reason over input and select among connected tools to complete a task, distinct from plain data-routing components.',
        shortValue: 'Yes, dedicated Agent and Tool Calling Agent components',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/agents',
            label: 'Langflow Docs: Use Langflow agents',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.langflow.org/components-agents',
            label: 'Langflow Docs: Agents component',
            asOf: '2026-07-02',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          'Yes: Langflow Assistant lets users build and edit flows and components using natural language prompts inside the editor.',
        shortValue: 'Yes, via Langflow Assistant',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/langflow-assistant',
            label: 'Langflow Docs: Langflow Assistant',
            asOf: '2026-07-02',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          'Yes: Langflow has a documented Vector Store RAG (retrieval-augmented generation) pattern with a two-flow setup for ingestion and query, a Split Text component for chunking, embedding-model components, and connectors to vector stores such as Astra DB and Milvus.',
        shortValue: 'Yes, built-in RAG pipeline components and vector store connectors',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/starter-projects-vector-store-rag',
            label: 'Langflow Docs: Vector store RAG starter project',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpSupport: {
        value:
          'Yes: Langflow can act as an MCP client via the MCP Tools component, connecting to external MCP servers (using JSON config, STDIO, or HTTP/SSE) and exposing their functions as tools for agents.',
        shortValue: 'Yes, consumes external MCP servers as tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/mcp-client',
            label: 'Langflow Docs: Use Langflow as an MCP client',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.langflow.org/mcp-tools',
            label: 'Langflow Docs: MCP Tools component',
            asOf: '2026-07-02',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'Yes: Langflow has a Guardrails component that uses an LLM to check input against built-in categories such as PII, tokens and passwords, jailbreak attempts, offensive content, malicious code, and prompt injection. It also has evaluation components and integrations like Cleanlab Evaluator and LangWatch Evaluator for scoring responses.',
        shortValue: 'Yes, Guardrails component plus Cleanlab/LangWatch evaluators',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/guardrails',
            label: 'Langflow Docs: Guardrails',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.langflow.org/bundles-cleanlab',
            label: 'Langflow Docs: Cleanlab bundle',
            asOf: '2026-07-02',
          },
        ],
      },
      humanInTheLoop: {
        value:
          'Unknown: no official Langflow documentation describes a dedicated pause-and-wait-for-human-approval mechanism mid-run. A community GitHub discussion asking how to implement human-in-the-loop suggests it is not a standard built-in feature, unlike LangGraph or FlowiseAI, which do document this.',
        detail:
          'A user discussion asked how to build this, implying no first-class component exists.',
        shortValue: 'Unknown, not documented as a built-in feature',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/langflow-ai/langflow/discussions/4399',
            label: 'GitHub Discussion 4399: How to implement human in the loop?',
            asOf: '2026-07-02',
          },
        ],
      },
      generativeMedia: {
        value:
          'Unknown: no official Langflow documentation describes built-in image, video, or audio generation components. Community discussions show users integrating image generation via custom components or external APIs, not a native block.',
        shortValue: 'Unknown, no native generative media blocks documented',
        confidence: 'unknown',
        sources: [],
      },
      dynamicToolUse: {
        value:
          "Yes: Langflow agents receive a registered list of tools at setup, and the connected LLM decides at run time which registered tool to call based on each tool's description. This includes flows exposed as tools and MCP-server tools.",
        detail: 'Tool pool is whatever is registered to that agent, not the entire platform.',
        shortValue: 'Yes, agent picks among registered tools at inference',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/agents-tools',
            label: 'Langflow Docs: Configure tools for agents',
            asOf: '2026-07-02',
          },
        ],
      },
      modelFallback: {
        value:
          'Unknown: no public Langflow documentation describes automatic fallback or retry to a different model or provider on a failed or rate-limited LLM call. A blog post shows manually building smart model routing as a custom flow rather than a built-in fallback feature.',
        detail: 'Users can hand-build routing flows, but it is not an automatic platform feature.',
        shortValue: 'Unknown, no built-in automatic model fallback documented',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.langflow.org/blog/how-to-build-your-own-gpt-5',
            label: 'Langflow blog: Build Your Own GPT-5 with Smart Model Routing',
            asOf: '2026-07-02',
          },
        ],
      },
      agentSkills: {
        value:
          'Unknown: no public documentation describes a reusable, named prompt or knowledge-snippet library invokable by reference across agents, distinct from a one-off system prompt field on each agent component.',
        shortValue: 'Unknown, no named reusable skill library documented',
        confidence: 'unknown',
        sources: [],
      },
      nativeChatDeployment: {
        value:
          'Yes: Langflow provides a Shareable Playground at a public flow link and an official Embedded Chat widget that can be added to any website to expose a flow as a conversational chat surface.',
        shortValue: 'Yes, shareable playground and embeddable chat widget',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/embedded-chat-widget',
            label: 'Langflow Docs: Embedded chat widget',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.langflow.org/concepts-playground',
            label: 'Langflow Docs: Test flows in the Playground',
            asOf: '2026-07-02',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          'Unknown: no public documentation was found showing a dedicated chunk-level debugging or search-result view that surfaces individual chunk index or content for a knowledge-base query, beyond the general chunking configuration in the Split Text component.',
        shortValue: 'Unknown, no dedicated chunk-level results view documented',
        confidence: 'unknown',
        sources: [],
      },
      parallelExecution: {
        value:
          'No dedicated fan-out/fan-in feature is documented. Langflow builds a flow into a Directed Acyclic Graph and executes nodes in dependency order, each node run using the results of the nodes it depends on: sequential DAG traversal, not a native concurrent-branch-then-join primitive.',
        shortValue: 'Not documented, execution model is sequential DAG traversal',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langflow.org/concepts-flows',
            label: 'Langflow Docs: Build flows (DAG execution order)',
            asOf: '2026-07-02',
          },
        ],
      },
      a2aProtocol: {
        value:
          'No. Native A2A protocol support is not shipped in Langflow core. A community member submitted a working implementation and feature request in November 2025, but it remains an open enhancement request (closed as a duplicate of an earlier tracking issue), not a merged feature. The only path to A2A interoperability is third-party custom components.',
        shortValue: 'No, open feature request only, not shipped in core',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/langflow-ai/langflow/issues/10658',
            label: 'GitHub langflow-ai/langflow Issue #10658: Add A2A Protocol Support',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/langflow-ai/langflow/issues/10241',
            label: 'GitHub langflow-ai/langflow Issue #10241: A2A (tracking issue)',
            asOf: '2026-07-02',
          },
        ],
      },
      loopIteration: {
        value:
          'Yes: Langflow ships a dedicated Loop component that takes a list of JSON or Table items (for example CSV rows), passes items one at a time through its Item output port to a chain of connected components, and loops back until every item is processed sequentially, before emitting the aggregated result from its Done port.',
        shortValue: 'Yes, via the Loop component (sequential, Item/Done ports)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/loop',
            label: 'Langflow Docs: Loop component',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value:
          "Langflow organizes third-party integrations as component bundles grouped by provider, such as Google, OpenAI, LangChain, Elastic, and Composio. The full current list of bundles and components is only visible in the app's Bundles panel, not enumerated on the docs site.",
        shortValue: 'Dozens of provider bundles; full count only in-app',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langflow.org/components-bundle-components',
            label: 'Langflow Docs: About bundles',
            asOf: '2026-07-02',
          },
        ],
      },
      triggerTypes: {
        value:
          'Yes: Langflow flows can be triggered via the REST API run and advanced run endpoints, a dedicated Webhook component for event-driven HTTP POST triggers, the Playground or chat interface, or external schedulers like cron or Airflow calling the API.',
        detail: 'Scheduling itself is via external tools, not a native in-app scheduler.',
        shortValue: 'API run, webhook, chat, and external cron/scheduler calls',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/webhook',
            label: 'Langflow Docs: Trigger flows with webhooks',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.langflow.org/api-flows-run',
            label: 'Langflow Docs: Flow trigger endpoints',
            asOf: '2026-07-02',
          },
        ],
      },
      customCodeSteps: {
        value:
          "Yes: Langflow supports custom Python components with full source-code editing, including lifecycle hooks like pre-run setup and typed inputs/outputs from Langflow's own component library (the `lfx.io` module), for arbitrary custom logic inside a flow.",
        shortValue: 'Yes, custom Python components with full code access',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/components-custom-components',
            label: 'Langflow Docs: Create custom Python components',
            asOf: '2026-07-02',
          },
        ],
      },
      apiPublishing: {
        value:
          "Yes: any flow can be called as a REST API via documented run endpoints, with an auto-generated API reference (OpenAPI spec) available at the deployment's docs endpoint.",
        shortValue: 'Yes, flows callable via REST API with OpenAPI spec',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/api-reference-api-examples',
            label: 'Langflow Docs: Get started with the Langflow API',
            asOf: '2026-07-02',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Yes: Langflow supports custom Python component development with documented input and output classes, plus a separate open-source Embedded Chat widget package for embedding. Community members can also contribute components, bundles, and templates back via GitHub, but there is no formal third-party marketplace documented.',
        detail: 'No formal marketplace documented.',
        shortValue: 'Custom component SDK, embed widget, community contributions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/components-custom-components',
            label: 'Langflow Docs: Create custom Python components',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/langflow-ai/langflow-embedded-chat',
            label: 'GitHub: langflow-ai/langflow-embedded-chat',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpPublishing: {
        value:
          'Yes: Langflow automatically registers each project as an MCP server when created, exposing every flow that has a Chat Output component as a callable MCP tool for any external MCP client.',
        shortValue: 'Yes, every project auto-exposed as an MCP server',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/mcp-server',
            label: 'Langflow Docs: Use Langflow as an MCP server',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          "Langflow's core software is free and open source, with no license fee for self-hosting. Third-party sources describe Langflow Cloud as offering a free account tier plus a paid tier around $25 per month for higher usage limits, and separate enterprise pricing; Langflow's official pricing page does not confirm these figures directly.",
        detail:
          "Based on third-party summaries; the official pricing page doesn't confirm these figures.",
        shortValue: 'Free open-source core; cloud free tier plus paid/enterprise tiers',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.lindy.ai/blog/langflow-pricing',
            label: 'Lindy: Langflow Pricing',
            asOf: '2026-07-02',
          },
          {
            url: 'https://automationatlas.io/tools/langflow/',
            label: 'Automation Atlas: Langflow pricing summary',
            asOf: '2026-07-02',
          },
        ],
      },
      entryPaidPlan: {
        value:
          "Unknown: the exact entry paid-plan price and inclusions aren't confirmed on Langflow's own official pricing page. Third-party summaries cite a cloud paid tier starting around $25 per month.",
        detail: 'Not confirmed against an official Langflow source.',
        shortValue: 'Unverified; third parties cite roughly $25/month',
        confidence: 'unknown',
        sources: [],
      },
      freeTier: {
        value:
          'Yes: the open-source core is free to self-host, with no usage caps beyond your own infrastructure. Langflow Cloud reportedly offers a free account tier before infrastructure and API costs apply.',
        detail: 'Exact cloud free-tier limits not officially confirmed.',
        shortValue: 'Yes, free self-hosted core plus a free cloud tier',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.lindy.ai/blog/langflow-pricing',
            label: 'Lindy: Langflow Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      byok: {
        value:
          'Yes: Langflow requires users to configure their own LLM provider API keys per provider in Settings > Model Providers, meaning usage is billed directly by the LLM provider, not marked up by Langflow.',
        shortValue: 'Yes, users supply their own provider API keys',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/agents',
            label: 'Langflow Docs: Use Langflow agents',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    security: {
      soc2: {
        value:
          "Unknown: no public documentation or official page states a SOC 2 certification for Langflow. The docs' Security page discusses infrastructure-level responsibility for operators, not a compliance certification.",
        detail:
          'Security docs place isolation and compliance burden on the deploying organization.',
        shortValue: 'Unknown, no SOC2 certification documented',
        confidence: 'unknown',
        sources: [],
      },
      dataResidency: {
        value:
          'Yes via self-hosting: Langflow can be fully self-hosted on Docker, Kubernetes, on-prem, or any cloud region, giving organizations full control over data residency. No dedicated managed regional-hosting product is documented for Langflow Cloud.',
        shortValue: 'Yes via self-hosting; no documented managed regional cloud',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langflow.org/get-started-installation',
            label: 'Langflow Docs: Install Langflow',
            asOf: '2026-07-02',
          },
        ],
      },
      rbac: {
        value:
          "Unknown: Langflow's own Security documentation states it neither enforces isolation between users within a single Langflow process nor restricts access to local disk or network resources, relying on infrastructure-level security for multi-tenant deployments. No native role-based access control system with distinct roles or scopes is documented.",
        shortValue: 'Unknown/limited, docs say isolation is infra-level not built-in',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/security',
            label: 'Langflow Docs: Security',
            asOf: '2026-07-02',
          },
        ],
      },
      auditLogging: {
        value:
          'Unknown: no official documentation describes a queryable or exportable audit log of user actions gated by plan. Langflow does document general execution and system logging for debugging, which is distinct from a security audit trail.',
        shortValue: 'Unknown, only general execution logs documented',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langflow.org/concepts-flows',
            label: 'Langflow Docs: Build flows',
            asOf: '2026-07-02',
          },
        ],
      },
      additionalCompliance: {
        value:
          'Unknown: no public documentation or official page confirms HIPAA, ISO 27001, GDPR-specific attestation, PCI, or FedRAMP certification for Langflow.',
        shortValue: 'Unknown, no compliance certifications documented',
        confidence: 'unknown',
        sources: [],
      },
      modelAndToolGovernance: {
        value:
          'Unknown: no public documentation describes an admin-configurable restriction on which LLM providers, models, or tools a given role or user may use. Model Providers configuration in Settings appears to be workspace-wide rather than per-role gated.',
        shortValue: 'Unknown, no per-role model/tool restriction documented',
        confidence: 'unknown',
        sources: [],
      },
      credentialGovernance: {
        value:
          'Unknown: no public documentation describes restricting which specific stored credentials a role or permission group may use, beyond standard per-user API key configuration.',
        shortValue: 'Unknown, no per-role credential restriction documented',
        confidence: 'unknown',
        sources: [],
      },
      whiteLabeling: {
        value:
          "Unknown: no public documentation describes replacing Langflow's branding, such as logo, product name, or theme, in the self-hosted UI or embedded chat widget, beyond basic widget style customization exposed as embed props.",
        detail:
          'The embed widget supports styling props but full logo and name replacement across the whole app was not confirmed.',
        shortValue: 'Unknown; only chat-widget style props documented, not full rebrand',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/langflow-ai/langflow-embedded-chat',
            label: 'GitHub: langflow-ai/langflow-embedded-chat',
            asOf: '2026-07-02',
          },
        ],
      },
      dataRetention: {
        value:
          'Unknown: no public documentation describes an org-configurable retention window for execution logs or soft-deleted resources. Self-hosters control their own database and log retention at the infrastructure level, since Langflow stores data in a configured database plus local or S3 file storage.',
        shortValue: 'Unknown, retention managed at self-hosted infra level',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langflow.org/concepts-file-management',
            label: 'Langflow Docs: Manage files',
            asOf: '2026-07-02',
          },
        ],
      },
      piiRedaction: {
        value:
          'Yes: the built-in Guardrails component includes a documented PII category that uses an LLM check to detect names, addresses, phone numbers, emails, social security numbers, and credit card numbers in workflow content. This is detection and validation, not confirmed automatic redaction of retained logs.',
        detail:
          'Documented as detection and validation; automatic redaction of stored logs specifically was not confirmed.',
        shortValue: 'Yes, Guardrails component detects PII in content',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/guardrails',
            label: 'Langflow Docs: Guardrails',
            asOf: '2026-07-02',
          },
        ],
      },
      sso: {
        value:
          'Unknown: no official Langflow documentation confirms SAML or OIDC single sign-on with organization auto-provisioning. Authentication docs cover API-key-based authentication, and third-party summaries mention SSO as a roadmap item, not a shipped, documented feature.',
        detail: 'Some community sources describe SSO as planned rather than confirmed shipped.',
        shortValue: 'Unknown, not confirmed as a documented shipped feature',
        confidence: 'unknown',
        sources: [],
      },
      thirdPartyVetting: {
        value:
          'Partial: most built-in integration bundles are contributed as pull requests to the official langflow-ai/langflow codebase and merged by core maintainers, but Langflow also ships a community Store where users can share and install flows and components with lighter, informal vetting, plus a custom-component system that lets any user author and run their own Python code with full server access. This code-execution model has a disclosed security incident: CVE-2025-3248, an unauthenticated remote code execution flaw in the custom-component code-validation endpoint (fixed in 1.3.0), actively exploited in the wild to deploy the Flodrix botnet on unpatched instances.',
        detail:
          'Langflow documents that it does not enforce isolation between users or restrict local disk/network access, so both bundle and custom-component code run with the same trust level as the core server.',
        shortValue:
          'Partial: reviewed bundles plus a lighter-vetted community Store and custom code',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/components-bundle-components',
            label: 'Langflow Docs - About bundles',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.langflow.org/components-custom-components',
            label: 'Langflow Docs - Create custom Python components',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.langflow.org/security',
            label: 'Langflow Docs - Security',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/langflow-ai/langflow/security/advisories/GHSA-vwmf-pq79-vjvx',
            label: 'GitHub Security Advisory GHSA-vwmf-pq79-vjvx (CVE-2025-3248)',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Yes: Langflow automatically captures step-by-step execution traces within a flow run. It can forward detailed traces, including prompts, responses, token usage, latency, and intermediate steps, to external observability platforms such as LangSmith, Langfuse, and LangWatch via environment-variable configuration.',
        detail:
          'Deep trace visualization relies on integrating an external observability platform.',
        shortValue: 'Per-step traces, exportable to LangSmith/Langfuse/LangWatch',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/integrations-langfuse',
            label: 'Langflow Docs: Langfuse integration',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.langflow.org/integrations-langsmith',
            label: 'Langflow Docs: LangSmith integration',
            asOf: '2026-07-02',
          },
        ],
      },
      durabilityModel: {
        value:
          'Unknown: no public documentation describes automatic retries, checkpointing, or replaying a past execution with its original inputs at the platform level. This is a documented LangGraph capability, not confirmed for Langflow flows specifically.',
        shortValue: 'Unknown, no documented replay/checkpoint model for flows',
        confidence: 'unknown',
        sources: [],
      },
      failureAlerting: {
        value:
          'Unknown: no public documentation describes proactive notification, such as email, Slack, or webhook alerts, when a flow run fails or crosses a cost or latency threshold. Available integrations focus on logging and tracing rather than alerting.',
        shortValue: 'Unknown, no proactive failure alerting documented',
        confidence: 'unknown',
        sources: [],
      },
      dataDrains: {
        value:
          'Partial: Langflow supports continuously forwarding execution trace data to external observability platforms such as LangSmith, Langfuse, and LangWatch via configuration. No general-purpose data drain to arbitrary destinations like S3, BigQuery, or a generic webhook for audit or usage data was found documented.',
        shortValue: 'Trace export to LangSmith/Langfuse/LangWatch only',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langflow.org/integrations-langfuse',
            label: 'Langflow Docs: Langfuse integration',
            asOf: '2026-07-02',
          },
        ],
      },
      asyncExecution: {
        value:
          "Partial: Langflow documents a webhook-triggered flow execution pattern and a Monitor endpoints page for checking flow build and run status, giving some support for background triggering and later status checks. A dedicated async job-polling API pattern isn't fully documented.",
        shortValue: 'Some support via webhook trigger plus monitor endpoints',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langflow.org/api-monitor',
            label: 'Langflow Docs: Monitor endpoints',
            asOf: '2026-07-02',
          },
        ],
      },
      executionLimits: {
        value:
          "Unknown: Langflow's official documentation publishes no concrete numbers for maximum single-execution duration or concurrent run limits. Self-hosted deployments are bounded only by the operator's own infrastructure and worker configuration.",
        shortValue: 'Unknown, no published execution/concurrency limits',
        confidence: 'unknown',
        sources: [],
      },
      partialFailureHandling: {
        value:
          'Unknown: no public documentation describes routing a single failing step to an error-handling path while the rest of the flow continues; this was not confirmed as a native feature in the documentation reviewed.',
        shortValue: 'Unknown, no documented per-step error-routing feature',
        confidence: 'unknown',
        sources: [],
      },
    },
    support: {
      supportChannels: {
        value:
          "Langflow's primary support channel is a public Discord community server, plus GitHub Discussions and Issues for questions and feature requests. No official documentation confirms a paid or dedicated enterprise support tier separate from DataStax or IBM commercial channels.",
        shortValue: 'Discord and GitHub community support; no confirmed paid tier',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/contributing-community',
            label: 'Langflow Docs: Join the Langflow community',
            asOf: '2026-07-02',
          },
        ],
      },
      sla: {
        value:
          'Unknown: no public documentation confirms a formal SLA for response time or uptime guarantee offered for Langflow, on any plan.',
        shortValue: 'Unknown, no SLA documented',
        confidence: 'unknown',
        sources: [],
      },
      community: {
        value:
          "Langflow's GitHub repository has approximately 150,700 stars and 9,395 forks, alongside an active public Discord server. Industry coverage frequently describes it as a widely used open-source AI-agent and RAG (retrieval-augmented generation) builder.",
        shortValue: 'About 150,700 GitHub stars, 9,400 forks',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/langflow-ai/langflow',
            label: 'GitHub: langflow-ai/langflow',
            asOf: '2026-07-02',
          },
        ],
      },
      companyMaturity: {
        value:
          "Langflow started as a self-funded startup called Logspace before DataStax acquired it in April 2024. DataStax, including Langflow, was then acquired by IBM as announced in February 2025, making Langflow part of IBM's watsonx portfolio.",
        shortValue: 'Acquired by DataStax 2024, then folded into IBM 2025',
        confidence: 'verified',
        sources: [
          {
            url: 'https://techcrunch.com/2024/04/04/datastax-acquires-logspace-the-startup-behind-the-langflow-low-code-tool-for-building-rag-based-chatbots/',
            label: 'TechCrunch: DataStax acquires Langflow (Logspace)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://newsroom.ibm.com/2025-02-25-ibm-to-acquire-datastax,-deepening-watsonx-capabilities-and-addressing-generative-ai-data-needs-for-the-enterprise',
            label: 'IBM Newsroom: IBM to acquire DataStax',
            asOf: '2026-07-02',
          },
        ],
      },
      academy: {
        value:
          "Unknown: Langflow doesn't run an official structured course, certification, or academy program. Third-party paid courses exist on platforms like Udemy that teach LangChain and Langflow, but these aren't an official Langflow product.",
        shortValue: 'No official academy; only third-party courses found',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.udemy.com/course/langchain-masterclass/',
            label: 'Udemy: Master LangChain with No-Code tools: Flowise and LangFlow',
            asOf: '2026-07-02',
          },
        ],
      },
    },
  },
}
