import { LangflowIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Reviewed against current primary sources on 2026-09-04; uncertainty is labeled. */
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
    'Langflow is a visual, Python-based builder for AI agents and RAG, with MIT-licensed source, self-managed deployment, and an optional IBM support offering.',
  standoutFeatures: [
    {
      title: 'Installable provider extensions',
      description:
        'Install provider bundles as extensions that register components when Langflow starts. Langflow 1.12 includes a curated provider set by default, with additional packages available separately.',
      shortDescription: 'Curated default providers with additional installable bundles.',
      source: {
        url: 'https://docs.langflow.org/extensions-overview',
        label: 'Langflow: Extensions',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Projects can expose flows through MCP',
      description:
        'Project MCP servers expose selected flows with Chat Output components as tools for external clients. Automatic setup is enabled by default; operators can disable it and users can choose which flows are exposed.',
      shortDescription: 'Project MCP servers with selectable flow tools.',
      source: {
        url: 'https://docs.langflow.org/mcp-server',
        label: 'Langflow: MCP server',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Flow snapshots and restore',
      description:
        'Save explicit flow versions, preview or export a prior version, and restore it with an optional backup of the current draft.',
      shortDescription: 'Explicit flow snapshots, preview, export, and restore.',
      source: {
        url: 'https://docs.langflow.org/concepts-flows',
        label: 'Langflow: Build flows and save versions',
        asOf: '2026-09-04',
      },
    },
  ],
  limitations: [
    {
      title: 'Infrastructure must isolate untrusted users',
      description:
        'Langflow documents its UI as a code execution environment with host filesystem and network access. Multi-tenant installations require infrastructure isolation; application access controls alone do not provide it.',
      shortDescription: 'Operators must isolate untrusted code and tenants.',
      source: {
        url: 'https://docs.langflow.org/security',
        label: 'Langflow: Security and infrastructure isolation',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Astra-hosted Langflow was removed',
      description:
        'DataStax removed its Langflow service from Astra on April 9, 2026 and directs users to Langflow OSS. Historical Astra cloud offers should not be used as current Langflow plan information.',
      shortDescription: 'Former Astra-hosted service removed April 9, 2026.',
      source: {
        url: 'https://docs.datastax.com/en/astra-db-serverless/release-notes.html',
        label: 'DataStax: Astra release notes, April 9, 2026',
        asOf: '2026-09-04',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'Visual flow canvas with editable Python components and a natural-language Langflow Assistant.',
        shortValue: 'Visual canvas, Python, and natural-language assistance',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/concepts-components',
            label: 'Langflow: Components overview',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/langflow-assistant',
            label: 'Langflow: Assistant',
            asOf: '2026-09-04',
          },
        ],
      },
      learningCurve: {
        value:
          'Templates ease initial setup; custom components and production deployment require familiarity with Python, model APIs, and infrastructure. This is an editorial assessment.',
        shortValue: 'Moderate; production use requires technical skills',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langflow.org/concepts-flows',
            label: 'Langflow: Build flows and save versions',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/install-custom-dependencies',
            label: 'Langflow: Install custom dependencies',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/security',
            label: 'Langflow: Security and infrastructure isolation',
            asOf: '2026-09-04',
          },
        ],
      },
      selfHostOption: {
        value:
          'Yes: install the MIT-licensed source as a Python package, Docker deployment, or local desktop application.',
        shortValue: 'Yes, Python, Docker, and desktop',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/get-started-installation',
            label: 'Langflow: Installation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/langflow-ai/langflow',
            label: 'Langflow: Source repository and MIT license',
            asOf: '2026-09-04',
          },
        ],
      },
      deploymentOptions: {
        value:
          'Desktop, Python, Docker, and self-managed infrastructure are documented. IBM also lists watsonx Orchestrate integration; the former DataStax Langflow service was removed from Astra on April 9, 2026.',
        shortValue: 'Desktop and self-managed; Astra service removed',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/get-started-installation',
            label: 'Langflow: Installation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.ibm.com/products/langflow',
            label: 'IBM: Langflow editions and support',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.datastax.com/en/astra-db-serverless/release-notes.html',
            label: 'DataStax: Astra release notes, April 9, 2026',
            asOf: '2026-09-04',
          },
        ],
      },
      templates: {
        value:
          'Yes: the New Flow menu includes templates such as Basic Prompting and Vector Store RAG, alongside blank flows, duplication, and import.',
        shortValue: 'Yes, built-in flow templates',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/concepts-flows',
            label: 'Langflow: Build flows and save versions',
            asOf: '2026-09-04',
          },
        ],
      },
      license: {
        value:
          'The public Langflow source is MIT licensed. Commercial support and infrastructure have separate terms.',
        shortValue: 'MIT-licensed source',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/langflow-ai/langflow',
            label: 'Langflow: Source repository and MIT license',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.ibm.com/products/langflow',
            label: 'IBM: Langflow editions and support',
            asOf: '2026-09-04',
          },
        ],
      },
      environmentPromotion: {
        value:
          'Partial: portable flow definitions can be deployed across dev, QA, and production. A managed whole-environment promotion workflow was not verified.',
        shortValue: 'Portable flows; environment promotion not verified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.ibm.com/products/langflow',
            label: 'IBM: Langflow editions and support',
            asOf: '2026-09-04',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Yes: explicitly save flow versions, preview them read-only, export or delete versions, and restore with an optional backup of the draft. Automatic draft saving is separate.',
        shortValue: 'Saved versions, preview, export, and restore',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/concepts-flows',
            label: 'Langflow: Build flows and save versions',
            asOf: '2026-09-04',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          'Unknown: live simultaneous editing with cursors and synchronized canvas operations was not verified. Flow sharing and snapshots do not establish that capability.',
        shortValue: 'Not verified in reviewed documentation',
        confidence: 'unknown',
        sources: [],
      },
      nativeFileStorage: {
        value:
          'Partial: server file management supports reusable uploads, local or S3 storage, rename, download, and delete. Folder hierarchies, sharing links, and deleted-file recovery were not verified.',
        shortValue: 'Reusable files with local or S3 storage',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/concepts-file-management',
            label: 'Langflow: File management',
            asOf: '2026-09-04',
          },
        ],
      },
      dataTables: {
        value:
          'Partial: Table/DataFrame objects support structured data inside flows. A persistent spreadsheet-style application database was not verified.',
        shortValue: 'Table data objects; persistent grid not verified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langflow.org/data-types',
            label: 'Langflow: Data types',
            asOf: '2026-09-04',
          },
        ],
      },
      richTextEditor: {
        value: 'Unknown: an in-app rich-text document editor was not verified.',
        shortValue: 'Not verified in reviewed documentation',
        confidence: 'unknown',
        sources: [],
      },
      subWorkflows: {
        value:
          'Yes: Run Flow invokes another saved flow with generated input/output fields, including use as an agent tool. Nested flows cannot pause for human input; approval belongs in the parent.',
        shortValue: 'Run Flow; nested human approval unsupported',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/run-flow',
            label: 'Langflow: Run Flow',
            asOf: '2026-09-04',
          },
        ],
      },
      customBlocks: {
        value:
          'Partial: group and save components for reuse, or install extension bundles. Components added to flows are detached copies; a centrally updated, credential-hidden workflow block was not verified.',
        shortValue: 'Saved component groups and extension bundles',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/concepts-components',
            label: 'Langflow: Components overview',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/extensions-overview',
            label: 'Langflow: Extensions',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Yes: configure multiple providers and models, including Ollama and OpenAI-compatible endpoints, or install additional provider components.',
        shortValue: 'Multiple providers, local models, and compatible endpoints',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/components-models',
            label: 'Langflow: Language models and RAG',
            asOf: '2026-09-04',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          'Yes: Agent components use LLMs to select tools and perform multi-step tasks; other agents and flows can be attached as tools.',
        shortValue: 'Yes, agents with tool calling',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/components-agents',
            label: 'Langflow: Agent component',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/agents-tools',
            label: 'Langflow: Agent tools and approvals',
            asOf: '2026-09-04',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          'Yes: Langflow Assistant builds or edits flows and components from prompts. It requires a configured tool-calling model and enabled component-authoring permissions.',
        shortValue: 'Yes, Assistant with model and authoring permissions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/langflow-assistant',
            label: 'Langflow: Assistant',
            asOf: '2026-09-04',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          'Yes: RAG flows combine document loading, text splitting, embeddings, vector storage, retrieval, and prompt context. The template separates ingestion from querying.',
        shortValue: 'Yes, configurable ingestion and retrieval flows',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/components-models',
            label: 'Langflow: Language models and RAG',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpSupport: {
        value:
          'Yes: register external MCP servers and add their tools to flows. A component can target one action or leave the tool selection blank to expose all server tools.',
        shortValue: 'Yes, external MCP tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/mcp-tools',
            label: 'Langflow: MCP Tools component',
            asOf: '2026-09-04',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'Yes: Guardrails routes text through pass/fail outputs after safety checks. The Policies component is beta and generates tool guards from business rules; neither guarantees perfect detection.',
        shortValue: 'Guardrails and beta tool policy enforcement',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/guardrails',
            label: 'Langflow: Guardrails',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/policies',
            label: 'Langflow: Policies (Beta)',
            asOf: '2026-09-04',
          },
        ],
      },
      humanInTheLoop: {
        value:
          'Yes: Human Input and agent tool approvals pause a run at a checkpoint and resume after a decision without rerunning completed steps.',
        shortValue: 'Yes, checkpointed human input and tool approvals',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/human-in-the-loop',
            label: 'Langflow: Human-in-the-Loop',
            asOf: '2026-09-04',
          },
        ],
      },
      generativeMedia: {
        value:
          'Unknown: a current native image/video generation suite was not verified. The Playground microphone performs transcription; the former full voice mode was deprecated in 1.10.',
        shortValue: 'Generation unverified; Playground supports transcription',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.langflow.org/concepts-voice-mode',
            label: 'Langflow: Voice mode deprecation',
            asOf: '2026-09-04',
          },
        ],
      },
      dynamicToolUse: {
        value:
          'Partial: agents select among connected tools and enabled actions at runtime, including MCP tool sets. Autonomous discovery beyond configured connections was not verified.',
        shortValue: 'Runtime choice among configured tools and MCP actions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/agents-tools',
            label: 'Langflow: Agent tools and approvals',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/mcp-tools',
            label: 'Langflow: MCP Tools component',
            asOf: '2026-09-04',
          },
        ],
      },
      modelFallback: {
        value:
          'Unknown: automatic cross-provider failover after model errors or rate limits was not verified. Model selection or manually composed routing is a separate capability.',
        shortValue: 'Not verified in reviewed documentation',
        confidence: 'unknown',
        sources: [],
      },
      agentSkills: {
        value: 'Unknown: a named skill library loaded by reference across agents was not verified.',
        shortValue: 'Not verified in reviewed documentation',
        confidence: 'unknown',
        sources: [],
      },
      nativeChatDeployment: {
        value:
          'Yes: server deployments support a shareable Playground and the official Embedded Chat widget. The shareable Playground is not available in Langflow Desktop.',
        shortValue: 'Shareable Playground and embed; desktop restrictions apply',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/concepts-playground',
            label: 'Langflow: Playground',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/get-started-installation',
            label: 'Langflow: Installation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/langflow-ai/langflow-embedded-chat',
            label: 'Langflow: Embedded Chat source and options',
            asOf: '2026-09-04',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          'Yes: after a retrieval flow runs, Inspect output on the vector-store component shows raw search results. This is component inspection rather than a separate knowledge-base console.',
        shortValue: 'Yes, inspect raw vector search results',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/components-models',
            label: 'Langflow: Language models and RAG',
            asOf: '2026-09-04',
          },
        ],
      },
      parallelExecution: {
        value:
          'The documented graph processes components sequentially in dependency order. A native concurrent branch-and-join primitive was not verified.',
        shortValue: 'Sequential graph documented; concurrent branches not verified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langflow.org/concepts-flows',
            label: 'Langflow: Build flows and save versions',
            asOf: '2026-09-04',
          },
        ],
      },
      a2aProtocol: {
        value:
          'Yes: the A2A Agent component calls remote or same-project agents. Publishing Langflow A2A endpoints and calling them in Internal mode requires LANGFLOW_A2A_ENABLED=true; remote External mode does not.',
        shortValue: 'Yes; A2A server endpoints require opt-in',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/a2a-agent-component',
            label: 'Langflow: A2A Agent',
            asOf: '2026-09-04',
          },
        ],
      },
      loopIteration: {
        value:
          'Yes: Loop processes a list of JSON/Table items sequentially through its Item path and returns aggregated results through Done.',
        shortValue: 'Yes, sequential Loop component',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/loop',
            label: 'Langflow: Loop component',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value:
          'Provider integrations are organized in bundles. Langflow 1.12 installs a curated subset by default, with additional bundles supplied as pip-installable extensions; counts depend on the installation.',
        shortValue: 'Provider bundles; count depends on installed extensions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/components-bundle-components',
            label: 'Langflow: Provider bundles',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/extensions-overview',
            label: 'Langflow: Extensions',
            asOf: '2026-09-04',
          },
        ],
      },
      triggerTypes: {
        value:
          'Flows can run through the Playground, authenticated API requests, or webhook POSTs. External systems can invoke these endpoints for event-driven automation.',
        shortValue: 'Playground, API, and webhook triggers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/concepts-playground',
            label: 'Langflow: Playground',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/api-flows-run',
            label: 'Langflow: Flow trigger endpoints',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/webhook',
            label: 'Langflow: Webhook triggers',
            asOf: '2026-09-04',
          },
        ],
      },
      customCodeSteps: {
        value:
          'Yes: custom Python components define inputs, outputs, lifecycle methods, and arbitrary flow logic, subject to deployment permissions.',
        shortValue: 'Yes, custom Python components',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/components-custom-components',
            label: 'Langflow: Custom Python components',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/langflow-assistant',
            label: 'Langflow: Assistant',
            asOf: '2026-09-04',
          },
        ],
      },
      codeSandboxRuntime: {
        value:
          'Operators control the Python environment and install dependencies; Desktop reads requirements.txt on restart. This is not an isolated per-step sandbox: custom code can access the host process, filesystem, and network.',
        shortValue: 'Configurable Python environment; infrastructure isolation required',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/install-custom-dependencies',
            label: 'Langflow: Install custom dependencies',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/security',
            label: 'Langflow: Security and infrastructure isolation',
            asOf: '2026-09-04',
          },
        ],
      },
      apiPublishing: {
        value:
          'Yes: flows expose run endpoints. The optional beta Developer Workflow API additionally supports sync, stream, and background modes.',
        shortValue: 'Yes, run API and optional beta Workflow API',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/api-flows-run',
            label: 'Langflow: Flow trigger endpoints',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/workflow-api',
            label: 'Langflow: Workflow API (Beta)',
            asOf: '2026-09-04',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Yes: documented Python component and extension interfaces, an official TypeScript API client, and an open-source Embedded Chat widget.',
        shortValue: 'Python extensions, TypeScript client, and chat embed',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/extensions-overview',
            label: 'Langflow: Extensions',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/typescript-client',
            label: 'Langflow: TypeScript client',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/langflow-ai/langflow-embedded-chat',
            label: 'Langflow: Embedded Chat source and options',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpPublishing: {
        value:
          'Yes: project MCP servers expose selected flows with Chat Output components as tools over Streamable HTTP, with legacy SSE available. Automatic project registration is configurable and enabled by default.',
        shortValue: 'Yes, configurable project MCP servers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/mcp-server',
            label: 'Langflow: MCP server',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'MIT-licensed software has no source license fee; operators fund infrastructure and model usage. IBM offers optional professional support. The former Astra-hosted service has been removed.',
        shortValue: 'Free source; infrastructure, models, and optional support extra',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/langflow-ai/langflow',
            label: 'Langflow: Source repository and MIT license',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.ibm.com/products/langflow',
            label: 'IBM: Langflow editions and support',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.datastax.com/en/astra-db-serverless/release-notes.html',
            label: 'DataStax: Astra release notes, April 9, 2026',
            asOf: '2026-09-04',
          },
        ],
      },
      entryPaidPlan: {
        value:
          'Unknown: a current entry price for commercial Langflow support or hosted service was not verified. IBM lists Elite Support without a public price on its product page.',
        shortValue: 'Commercial entry price not publicly confirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://www.ibm.com/products/langflow',
            label: 'IBM: Langflow editions and support',
            asOf: '2026-09-04',
          },
        ],
      },
      freeTier: {
        value:
          'Yes: MIT-licensed source can be self-hosted without a software license fee. Infrastructure and provider usage still cost money; this does not establish a current free managed-cloud tier.',
        shortValue: 'Free source; infrastructure and model usage extra',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/langflow-ai/langflow',
            label: 'Langflow: Source repository and MIT license',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.datastax.com/en/astra-db-serverless/release-notes.html',
            label: 'DataStax: Astra release notes, April 9, 2026',
            asOf: '2026-09-04',
          },
        ],
      },
      byok: {
        value:
          'Yes: configure provider API keys or connect a local/OpenAI-compatible model endpoint. Provider permissions and available credits govern model access.',
        shortValue: 'Yes, provider credentials or local model endpoints',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/components-models',
            label: 'Langflow: Language models and RAG',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    security: {
      dataResidency: {
        value:
          'Self-hosters choose the server and storage locations. External model, vector-store, and MCP connections can still transmit data outside that infrastructure.',
        shortValue: 'Self-host location control; external connections still matter',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/security',
            label: 'Langflow: Security and infrastructure isolation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/components-models',
            label: 'Langflow: Language models and RAG',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/mcp-tools',
            label: 'Langflow: MCP Tools component',
            asOf: '2026-09-04',
          },
        ],
      },
      rbac: {
        value:
          'Partial: Langflow has role, share, and authorization APIs, but OSS registers a pass-through service. Per-resource enforcement requires an installed, registered authorization plugin; setting the flag alone is insufficient.',
        shortValue: 'Enforcement plugin required; OSS defaults to pass-through',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/authorization',
            label: 'Langflow: Authorization, audit and retention',
            asOf: '2026-09-04',
          },
        ],
      },
      auditLogging: {
        value:
          'Yes: optional authorization audit logging records access decisions and share administration, with a paginated superuser API. Durable mode must be explicitly enabled before treating it as reliable compliance evidence.',
        shortValue: 'Optional authorization audit; durable mode requires opt-in',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/authorization',
            label: 'Langflow: Authorization, audit and retention',
            asOf: '2026-09-04',
          },
        ],
      },
      compliance: {
        value:
          'Unknown: a Langflow-specific SOC 2 report or ISO 27001 certificate was not verified. IBM affiliation does not establish certification coverage for a self-hosted deployment.',
        shortValue: 'Langflow-specific certification coverage unverified',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://www.ibm.com/products/langflow',
            label: 'IBM: Langflow editions and support',
            asOf: '2026-09-04',
          },
        ],
      },
      modelAndToolGovernance: {
        value:
          'Yes: superusers can set a server policy through APIs to block components, templates, and models or allow selected providers. OSS has no visual policy editor; policies default to unrestricted.',
        shortValue: 'Server-wide catalog and model policies via API',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/api-governance-policy',
            label: 'Langflow: Catalog and model policy',
            asOf: '2026-09-04',
          },
        ],
      },
      credentialGovernance: {
        value:
          'Partial: authorization plugins can govern variables and shared resources. Shared-flow execution uses the caller’s namespace, so dependencies must be owned by or separately shared with that caller. Infrastructure isolation is still required.',
        shortValue: 'Caller-scoped dependencies; plugin-based resource controls',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/authorization',
            label: 'Langflow: Authorization, audit and retention',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/security',
            label: 'Langflow: Security and infrastructure isolation',
            asOf: '2026-09-04',
          },
        ],
      },
      whiteLabeling: {
        value:
          'Partial: the official Embedded Chat package exposes UI customization options and source code. A turnkey organization-wide rebranding control for the full builder was not verified.',
        shortValue: 'Customizable chat embed; full-builder branding unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/langflow-ai/langflow-embedded-chat',
            label: 'Langflow: Embedded Chat source and options',
            asOf: '2026-09-04',
          },
        ],
      },
      dataRetention: {
        value:
          'Partial: authorization audit retention is configurable, defaulting to 90 days; zero disables automatic pruning. General execution-trace and deleted-resource retention policies were not verified.',
        shortValue: 'Configurable audit retention; broader retention unverified',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/authorization',
            label: 'Langflow: Authorization, audit and retention',
            asOf: '2026-09-04',
          },
        ],
      },
      piiRedaction: {
        value:
          'Partial: Guardrails detects PII and routes failures. Structured logs scrub sensitive keys and accept extra keys to redact; automatic content-level PII redaction across all traces was not verified.',
        shortValue: 'PII checks and log-key scrubbing; scope limited',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/guardrails',
            label: 'Langflow: Guardrails',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/logging',
            label: 'Langflow: Logging and secret-key scrubbing',
            asOf: '2026-09-04',
          },
        ],
      },
      sso: {
        value:
          'Yes: external authentication accepts tokens from an upstream SSO/OIDC gateway, validates them against configured identity-provider settings, and automatically provisions a local user. Operators configure the gateway and server.',
        shortValue: 'Yes, external SSO/OIDC with local provisioning',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/external-authentication',
            label: 'Langflow: External authentication',
            asOf: '2026-09-04',
          },
        ],
      },
      sessionPolicy: {
        value:
          'Partial: operators configure access- and refresh-token lifetimes through server settings. Defaults are one hour and seven days respectively. These are token-expiry controls; an inactivity timeout was not verified.',
        shortValue: 'Server-configured access and refresh token lifetimes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/api-keys-and-authentication',
            label: 'Langflow: API keys and JWT settings',
            asOf: '2026-09-04',
          },
        ],
      },
      thirdPartyVetting: {
        value:
          'Extensions add installable provider code, and custom components execute Python. A blanket guarantee that all installable code is vendor-vetted was not verified; operators must review dependencies and isolate execution.',
        shortValue: 'Installable extensions and custom code require operator review',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langflow.org/extensions-overview',
            label: 'Langflow: Extensions',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/security',
            label: 'Langflow: Security and infrastructure isolation',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Yes: native traces record flow status, component inputs/outputs, latency, errors, and deeper LLM/tool spans with token usage where available. The UI and API expose traces, including human decisions.',
        shortValue: 'Yes, native flow and component traces',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/traces',
            label: 'Langflow: Native traces',
            asOf: '2026-09-04',
          },
        ],
      },
      durabilityModel: {
        value:
          'Partial: human-input gates checkpoint state and resume without repeating completed steps. This does not establish arbitrary crash recovery or automatic retry for every component.',
        shortValue: 'Checkpointed human approval; general crash recovery unverified',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/human-in-the-loop',
            label: 'Langflow: Human-in-the-Loop',
            asOf: '2026-09-04',
          },
        ],
      },
      failureAlerting: {
        value:
          'Unknown: native proactive run-failure or cost/latency-threshold notifications were not verified. External observability services may provide their own alerts.',
        shortValue: 'Not verified in reviewed documentation',
        confidence: 'unknown',
        sources: [],
      },
      dataDrains: {
        value:
          'Partial: the Langfuse integration forwards traces, and native traces are downloadable or queryable through APIs. A generic managed export of every audit and usage dataset was not verified.',
        shortValue: 'Trace forwarding and API export; broader drains unverified',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/integrations-langfuse',
            label: 'Langflow: Langfuse integration',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/traces',
            label: 'Langflow: Native traces',
            asOf: '2026-09-04',
          },
        ],
      },
      asyncExecution: {
        value:
          'Yes: the opt-in beta Workflow API returns a job ID immediately in background mode, supports polling status/results, and allows event-stream reattachment and cancellation.',
        shortValue: 'Yes, beta background jobs with polling and cancellation',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/workflow-api',
            label: 'Langflow: Workflow API (Beta)',
            asOf: '2026-09-04',
          },
        ],
      },
      executionLimits: {
        value:
          'Limits depend on deployment and component settings. MCP tool calls default to a configurable 180-second timeout; the beta Workflow API also reports timed-out jobs. No single universal run/concurrency ceiling was verified.',
        shortValue: 'Deployment-specific limits and configurable component timeouts',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langflow.org/mcp-server',
            label: 'Langflow: MCP server',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/workflow-api',
            label: 'Langflow: Workflow API (Beta)',
            asOf: '2026-09-04',
          },
        ],
      },
      partialFailureHandling: {
        value:
          'Unknown: a general automatic error branch for arbitrary failed components was not verified. Guardrail fail outputs and human rejection paths are separate control-flow features.',
        shortValue: 'Not verified in reviewed documentation',
        confidence: 'unknown',
        sources: [],
      },
      unattendedExecution: {
        value:
          'Yes for server deployments: beta background jobs return immediately and can be checked later. The Langflow server must stay running; a local Desktop installation depends on that local process and machine.',
        shortValue: 'Server background jobs; local process must remain running',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/workflow-api',
            label: 'Langflow: Workflow API (Beta)',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/get-started-installation',
            label: 'Langflow: Installation',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Community help is available through Discord and GitHub. IBM also offers Elite Support for Langflow OSS users.',
        shortValue: 'Discord/GitHub plus optional IBM Elite Support',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.langflow.org/contributing-community',
            label: 'Langflow: Community and support',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.ibm.com/products/langflow',
            label: 'IBM: Langflow editions and support',
            asOf: '2026-09-04',
          },
        ],
      },
      sla: {
        value:
          'IBM lists Elite Support for enterprises needing SLAs. Exact response times, coverage, and availability commitments require the applicable agreement; no uptime percentage was verified.',
        shortValue: 'IBM support SLAs; exact contractual terms unverified',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.ibm.com/products/langflow',
            label: 'IBM: Langflow editions and support',
            asOf: '2026-09-04',
          },
        ],
      },
      community: {
        value:
          'The public GitHub repository and Discord provide community participation and support channels. Community size is not a service-quality guarantee.',
        shortValue: 'Public GitHub and Discord community',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/langflow-ai/langflow',
            label: 'Langflow: Source repository and MIT license',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/contributing-community',
            label: 'Langflow: Community and support',
            asOf: '2026-09-04',
          },
        ],
      },
      companyMaturity: {
        value:
          'Langflow is an IBM product with OSS, Desktop, professional support, and watsonx Orchestrate integration listed as editions or offerings.',
        shortValue: 'IBM-backed OSS and commercial support offerings',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.ibm.com/products/langflow',
            label: 'IBM: Langflow editions and support',
            asOf: '2026-09-04',
          },
        ],
      },
      academy: {
        value:
          'Official documentation includes tutorials and community learning resources. A formal vendor-issued certification program was not verified.',
        shortValue: 'Official tutorials; certification program unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.langflow.org/contributing-community',
            label: 'Langflow: Community and support',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.langflow.org/get-started-installation',
            label: 'Langflow: Installation',
            asOf: '2026-09-04',
          },
        ],
      },
    },
  },
}
