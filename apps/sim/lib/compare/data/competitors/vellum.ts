import { VellumIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Reviewed against public primary sources on 2026-09-04; uncertainties are labeled. */
export const vellumProfile: CompetitorProfile = {
  id: 'vellum',
  name: 'Vellum',
  website: 'https://www.vellum.ai',
  isWorkflowBuilder: true,
  brand: {
    icon: VellumIcon,
    selfFramed: true,
    colors: ['#5c54dd', '#aca4ec', '#442c6c'],
    source: 'Context.dev brand-intelligence API',
    asOf: '2026-07-02',
  },
  oneLiner:
    'Vellum’s documented AI development platform combines visual workflows, a Python SDK, evaluations, and deployment management. This comparison covers that platform; its current main website also markets a separate personal assistant.',
  standoutFeatures: [
    {
      title: 'Visual and code workflow development',
      description:
        'The open-source Workflows SDK supports bidirectional editing between Python code and Vellum’s visual workflow editor.',
      shortDescription: 'Build workflows in Python or the visual editor.',
      source: {
        url: 'https://docs.vellum.ai/developers/workflows-sdk/introduction.md',
        label: 'docs.vellum.ai: Introduction',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Enterprise self-hosting',
      description:
        'Vellum documents running its complete platform in customer infrastructure, including air-gapped environments, with vendor deployment support.',
      shortDescription: 'Enterprise platform deployment in customer infrastructure.',
      source: {
        url: 'https://docs.vellum.ai/self-hosting/getting-started/introduction',
        label: 'docs.vellum.ai: Introduction',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Deployment promotion and rollback',
      description:
        'Promote prompt and workflow releases across environments and revert to an earlier release from deployment history.',
      shortDescription: 'Environment promotion and release rollback.',
      source: {
        url: 'https://docs.vellum.ai/product/deployments/deployment-lifecycle-management',
        label: 'docs.vellum.ai: Deployment Lifecycle Management',
        asOf: '2026-09-04',
      },
    },
  ],
  limitations: [
    {
      title: 'Confirm the product and commercial terms',
      description:
        'The current pricing page sells Vellum Assistant plans. Those prices do not establish the commercial terms for the workflow and evaluation platform compared here.',
      shortDescription: 'Assistant pricing does not establish workflow-platform pricing.',
      source: {
        url: 'https://www.vellum.ai/pricing',
        label: 'www.vellum.ai: Pricing',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Agent Builder has documented input limits',
      description:
        'Agent Builder does not perform web search and cannot read document inputs held only inside an existing workflow unless they are passed in again or indexed.',
      shortDescription: 'Builder cannot search the web or implicitly read existing documents.',
      source: {
        url: 'https://docs.vellum.ai/product/agent-builder/agent-builder-sme.md',
        label: 'docs.vellum.ai: Agent Builder Sme',
        asOf: '2026-09-04',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value: 'Visual workflow editor, Python Workflows SDK, and natural-language Agent Builder',
        shortValue: 'Visual, Python, and natural-language building',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/developers/workflows-sdk/introduction.md',
            label: 'docs.vellum.ai: Introduction',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.vellum.ai/product/agent-builder/agent-builder-sme.md',
            label: 'docs.vellum.ai: Agent Builder Sme',
            asOf: '2026-09-04',
          },
        ],
      },
      learningCurve: {
        value:
          'Visual and conversational entry points; advanced workflows require technical configuration',
        shortValue: 'Varies with workflow complexity',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.vellum.ai/developers/workflows-sdk/introduction.md',
            label: 'docs.vellum.ai: Introduction',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.vellum.ai/product/agent-builder/agent-builder-sme.md',
            label: 'docs.vellum.ai: Agent Builder Sme',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'This is an assessment of the documented authoring surfaces, not a measured learning-time comparison.',
      },
      selfHostOption: {
        value: 'Yes: the complete platform can run in customer infrastructure',
        shortValue: 'Enterprise self-hosting',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/self-hosting/getting-started/introduction',
            label: 'docs.vellum.ai: Introduction',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Vellum offers installation, architecture, training, and maintenance assistance; confirm commercial terms with the vendor.',
      },
      deploymentOptions: {
        value: 'Vellum cloud hosting and customer-managed self-hosted/VPC deployments',
        shortValue: 'Cloud or customer infrastructure',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/developers/client-sdk/introduction.md',
            label: 'docs.vellum.ai: Introduction',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.vellum.ai/self-hosting/getting-started/introduction',
            label: 'docs.vellum.ai: Introduction',
            asOf: '2026-09-04',
          },
        ],
      },
      templates: {
        value: 'Documented workflow examples and common-architecture tutorials',
        shortValue: 'Examples and architecture tutorials',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/workflows/common-architectures',
            label: 'docs.vellum.ai: Common Architectures',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Examples include RAG, prompt chains, and multi-agent workflows; a current template-gallery inventory was not established.',
      },
      license: {
        value: 'Open-source Workflows SDK; platform licensing should be confirmed separately',
        shortValue: 'Open-source SDK; separate platform terms',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.vellum.ai/developers/workflows-sdk/introduction.md',
            label: 'docs.vellum.ai: Introduction',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.vellum.ai/self-hosting/getting-started/introduction',
            label: 'docs.vellum.ai: Introduction',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The separate Vellum Assistant repository is MIT-licensed; that does not establish a license for the full workflow platform.',
      },
      environmentPromotion: {
        value:
          'Yes: promote releases between environments with separate keys, releases, and monitoring data',
        shortValue: 'Environment-specific releases and promotion',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/deployments/environments',
            label: 'docs.vellum.ai: Environments',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Sandbox definitions are shared across environments; deployed releases and configuration are environment-scoped.',
      },
      versionControlDepth: {
        value: 'Release history, rollback, release tags, and publish-time workflow code comparison',
        shortValue: 'History, rollback, tags, and code comparison',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/deployments/deployment-lifecycle-management',
            label: 'docs.vellum.ai: Deployment Lifecycle Management',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.vellum.ai/changelog/2025/2025-11',
            label: 'docs.vellum.ai: 2025 11',
            asOf: '2026-09-04',
          },
        ],
      },
      realtimeCollaboration: {
        value: 'Not confirmed in the reviewed public documentation',
        shortValue: 'Not confirmed in public documentation',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/prompts/collaboration',
            label: 'docs.vellum.ai: Collaboration',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Prompt collaboration documents shared history and invitations; simultaneous editing with live cursors was not established.',
      },
      nativeFileStorage: {
        value: 'Document Indexes store uploaded documents for retrieval',
        shortValue: 'Stored RAG documents',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/documents/uploading-documents',
            label: 'docs.vellum.ai: Uploading Documents',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The reviewed document feature is indexed storage; general file-sharing links and recovery controls were not established.',
      },
      dataTables: {
        value: 'Not confirmed in the reviewed public documentation',
        shortValue: 'Not confirmed in public documentation',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/documents/uploading-documents',
            label: 'docs.vellum.ai: Uploading Documents',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'CSV/XLS/XLSX ingestion and structured document extraction are documented, but a general editable database grid was not established.',
      },
      richTextEditor: {
        value: 'Not confirmed in the reviewed public documentation',
        shortValue: 'Not confirmed in public documentation',
        confidence: 'unknown',
        sources: [],
        detail:
          'An inline rich-text document editor for the workflow platform was not established; separate Vellum Assistant features are outside this profile.',
      },
      subWorkflows: {
        value: 'Yes: inline and deployed subworkflows can be called from workflows and agents',
        shortValue: 'Inline and deployed subworkflows',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/developers/workflows-sdk/api-reference/nodes/subworkflow-deployment-node',
            label: 'docs.vellum.ai: Subworkflow Deployment Node',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.vellum.ai/product/workflows/nodes/agent-node',
            label: 'docs.vellum.ai: Agent Node',
            asOf: '2026-09-04',
          },
        ],
      },
      customBlocks: {
        value: 'Yes: custom nodes packaged in a Docker image appear in the workflow node panel',
        shortValue: 'Custom nodes in the workflow palette',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/developers/workflows-sdk/custom-container-images',
            label: 'docs.vellum.ai: Custom Container Images',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Selecting the custom image exposes its nodes for drag-and-drop use. Deployed subworkflows provide a separate reuse mechanism.',
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value: 'Multiple model providers, including OpenAI, Anthropic, and Google',
        shortValue: 'Multiple model providers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/changelog/2025/2025-08',
            label: 'docs.vellum.ai: 2025 08',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The reviewed changelog documents a provider catalog and per-provider configuration; no current numerical model count is asserted.',
      },
      agentReasoningBlocks: {
        value: 'Agent Node selects and calls configured tools until it returns a response',
        shortValue: 'Agent Node with iterative tool calling',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/workflows/nodes/agent-node',
            label: 'docs.vellum.ai: Agent Node',
            asOf: '2026-09-04',
          },
        ],
      },
      naturalLanguageBuilding: {
        value: 'Yes: Agent Builder creates and modifies workflows from instructions',
        shortValue: 'Natural-language Agent Builder',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/agent-builder/agent-builder-sme.md',
            label: 'docs.vellum.ai: Agent Builder Sme',
            asOf: '2026-09-04',
          },
        ],
      },
      knowledgeBaseRag: {
        value: 'Yes: Document Indexes, Search Nodes, and RAG evaluation metrics',
        shortValue: 'Indexed document retrieval and RAG evaluation',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/evaluation/evaluating-rag-pipelines',
            label: 'docs.vellum.ai: Evaluating Rag Pipelines',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpSupport: {
        value: 'Yes: Agent Nodes can connect to remote MCP servers',
        shortValue: 'Remote MCP tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/changelog/2025/2025-08',
            label: 'docs.vellum.ai: 2025 08',
            asOf: '2026-09-04',
          },
        ],
      },
      evaluationGuardrails: {
        value: 'Test Suites and reusable metrics, plus inline Guardrail Nodes',
        shortValue: 'Evaluations and inline guardrails',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/evaluation/quantitative-evaluation',
            label: 'docs.vellum.ai: Quantitative Evaluation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.vellum.ai/product/workflows/nodes/overview',
            label: 'docs.vellum.ai: Overview',
            asOf: '2026-09-04',
          },
        ],
      },
      humanInTheLoop: {
        value: 'Yes: workflows can pause for human or external input',
        shortValue: 'Pause for external input',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/developers/workflows-sdk/introduction.md',
            label: 'docs.vellum.ai: Introduction',
            asOf: '2026-09-04',
          },
        ],
      },
      generativeMedia: {
        value: 'Not confirmed in the reviewed public documentation',
        shortValue: 'Not confirmed in public documentation',
        confidence: 'unknown',
        sources: [],
        detail:
          'Dedicated image, audio, and video generation capabilities were not established for the workflow platform; Assistant pricing is not evidence for those features.',
      },
      dynamicToolUse: {
        value: 'Yes: the model chooses among configured Agent Node tools at runtime',
        shortValue: 'Runtime selection among configured tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/workflows/nodes/agent-node',
            label: 'docs.vellum.ai: Agent Node',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Tool selection is dynamic within the configured tool set; arbitrary tool discovery was not established.',
      },
      modelFallback: {
        value: 'Yes: workflow expressions and error paths can select fallback models',
        shortValue: 'Configurable fallback workflow paths',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/workflows/common-architectures/fallback-models.md',
            label: 'docs.vellum.ai: Fallback Models',
            asOf: '2026-09-04',
          },
        ],
        detail: 'The documented pattern requires explicit workflow configuration.',
      },
      agentSkills: {
        value: 'Not confirmed in the reviewed public documentation',
        shortValue: 'Not confirmed in public documentation',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/workflows/nodes/agent-node',
            label: 'docs.vellum.ai: Agent Node',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Named SKILL.md packages are documented for Vellum Assistant, but were not established for the workflow platform. Subworkflows and deployed prompts are its documented reuse primitives.',
      },
      nativeChatDeployment: {
        value: 'Chat Message Triggers support an interactive sandbox panel and deployed API calls',
        shortValue: 'Chat triggers, sandbox chat, and API',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.vellum.ai/changelog/2026/2026-01',
            label: 'docs.vellum.ai: 2026 01',
            asOf: '2026-09-04',
          },
        ],
        detail: 'A hosted public chat widget was not established by this documentation.',
      },
      kbChunkVisibility: {
        value: 'Yes: Advanced Chunking returns source-page metadata on search chunks',
        shortValue: 'Chunk metadata in search results',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/documents/uploading-documents',
            label: 'docs.vellum.ai: Uploading Documents',
            asOf: '2026-09-04',
          },
        ],
      },
      parallelExecution: {
        value: 'Yes: Map Nodes run subworkflows in parallel for array items',
        shortValue: 'Parallel Map execution',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/workflows/nodes/map-node',
            label: 'docs.vellum.ai: Map Node',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The page documents up to 96 concurrent Map executions; this is not an account-wide quota.',
      },
      a2aProtocol: {
        value: 'Not confirmed in the reviewed public documentation',
        shortValue: 'Not confirmed in public documentation',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.vellum.ai/',
            label: 'docs.vellum.ai: Docs.Vellum.Ai',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'A workflow-platform implementation of the Agent2Agent protocol was not established in the reviewed documentation.',
      },
      loopIteration: {
        value: 'Yes: Map supports sequential iteration, and workflow graphs support loops',
        shortValue: 'Sequential Map iteration and graph loops',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/workflows/nodes/map-node',
            label: 'docs.vellum.ai: Map Node',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.vellum.ai/developers/workflows-sdk/introduction.md',
            label: 'docs.vellum.ai: Introduction',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value: 'Native integrations and Composio tools; a current app count is unconfirmed',
        shortValue: 'Native integrations and Composio tools',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.vellum.ai/changelog/2025/2025-11',
            label: 'docs.vellum.ai: 2025 11',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.vellum.ai/blog/vellum-composio-new-partnership-for-ai-agent-building',
            label: 'www.vellum.ai: Vellum Composio New Partnership For Ai Agent Building',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The 2025 partnership announcement describes Composio’s tool library; tool actions should not be counted as distinct integrated apps.',
      },
      triggerTypes: {
        value: 'API calls, scheduled triggers, integration webhook events, and chat messages',
        shortValue: 'API, schedules, integration events, and chat',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/changelog/2025/2025-11',
            label: 'docs.vellum.ai: 2025 11',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.vellum.ai/changelog/2026/2026-01',
            label: 'docs.vellum.ai: 2026 01',
            asOf: '2026-09-04',
          },
        ],
      },
      customCodeSteps: {
        value: 'Yes: Python and TypeScript Code Execution Nodes',
        shortValue: 'Python and TypeScript nodes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/workflows/nodes/code-execution-node',
            label: 'docs.vellum.ai: Code Execution Node',
            asOf: '2026-09-04',
          },
        ],
      },
      codeSandboxRuntime: {
        value: 'Custom Docker images support added dependencies and custom nodes',
        shortValue: 'Custom Docker runtime images',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/developers/workflows-sdk/custom-container-images',
            label: 'docs.vellum.ai: Custom Container Images',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Images inherit Vellum’s runtime and target linux/amd64; the documented default memory limit is 2 GB per instance, with higher limits by arrangement.',
      },
      apiPublishing: {
        value: 'Yes: deployed workflows are callable through Vellum’s API',
        shortValue: 'Deployed workflow API',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/workflows/api-integration',
            label: 'docs.vellum.ai: Api Integration',
            asOf: '2026-09-04',
          },
        ],
      },
      extensibilitySdk: {
        value: 'Python Workflows SDK plus Python, TypeScript, and Go API clients',
        shortValue: 'Workflow SDK and three API client languages',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/developers/workflows-sdk/introduction.md',
            label: 'docs.vellum.ai: Introduction',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.vellum.ai/developers/client-sdk/introduction.md',
            label: 'docs.vellum.ai: Introduction',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpPublishing: {
        value: 'Not confirmed in the reviewed public documentation',
        shortValue: 'Not confirmed in public documentation',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.vellum.ai/changelog/2025/2025-08',
            label: 'docs.vellum.ai: 2025 08',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Remote MCP consumption is documented, but publishing workflow deployments as MCP servers was not established.',
      },
    },
    pricing: {
      pricingModel: {
        value: 'Not confirmed in the reviewed public documentation',
        shortValue: 'Not confirmed in public documentation',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://www.vellum.ai/pricing',
            label: 'www.vellum.ai: Pricing',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The current pricing page describes Vellum Assistant. Current workflow-platform pricing, entry price, and free-plan allowances must be confirmed separately.',
      },
      entryPaidPlan: {
        value: 'Not confirmed in the reviewed public documentation',
        shortValue: 'Not confirmed in public documentation',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://www.vellum.ai/pricing',
            label: 'www.vellum.ai: Pricing',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The current pricing page describes Vellum Assistant. Current workflow-platform pricing, entry price, and free-plan allowances must be confirmed separately.',
      },
      freeTier: {
        value: 'Not confirmed in the reviewed public documentation',
        shortValue: 'Not confirmed in public documentation',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://www.vellum.ai/pricing',
            label: 'www.vellum.ai: Pricing',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The current pricing page describes Vellum Assistant. Current workflow-platform pricing, entry price, and free-plan allowances must be confirmed separately.',
      },
      byok: {
        value: 'Yes: provider pages accept the customer’s LLM provider API keys',
        shortValue: 'Provider API keys supported',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/changelog/2025/2025-08',
            label: 'docs.vellum.ai: 2025 08',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Platform fees, model charges, and any commercial restrictions need separate confirmation.',
      },
    },
    security: {
      dataResidency: {
        value: 'Customer infrastructure/VPC deployment supports location control',
        shortValue: 'Customer-hosted residency options',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/self-hosting/getting-started/introduction',
            label: 'docs.vellum.ai: Introduction',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.vellum.ai/blog/announcing-vellum-vpc',
            label: 'www.vellum.ai: Announcing Vellum Vpc',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Model and integration data may leave that infrastructure unless their endpoints are also privately hosted. Managed-service region options were not established.',
      },
      rbac: {
        value: 'Yes: six workspace roles govern editing and administration',
        shortValue: 'Six workspace roles',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/security/rbac-permissions',
            label: 'docs.vellum.ai: Rbac Permissions',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Roles include Admin, Deployment Editor, Document Index Editor, Test Suite Editor, Playground Editor, and read-only Member.',
      },
      auditLogging: {
        value: 'Execution history and monitoring webhooks can support execution auditing',
        shortValue: 'Execution records and audit webhooks',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/monitoring/webhooks',
            label: 'docs.vellum.ai: Webhooks',
            asOf: '2026-09-04',
          },
        ],
        detail: 'This does not establish a comprehensive administrative activity audit log.',
      },
      compliance: {
        value: 'Vellum states SOC 2 Type 2 and HIPAA compliance',
        shortValue: 'Vendor-stated SOC 2 Type 2 and HIPAA',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/security/data-privacy-and-storage.md',
            label: 'docs.vellum.ai: Data Privacy And Storage',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The public documentation states these claims; a current audit report, scope, and BAA terms were not inspected. Other certifications are unconfirmed.',
      },
      modelAndToolGovernance: {
        value: 'Admins manage models; workflow authors configure permitted Agent Node tools',
        shortValue: 'Admin model settings and configured tools',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/security/rbac-permissions',
            label: 'docs.vellum.ai: Rbac Permissions',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.vellum.ai/product/workflows/nodes/agent-node',
            label: 'docs.vellum.ai: Agent Node',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Organization-wide model/tool allowlists beyond these controls were not established.',
      },
      credentialGovernance: {
        value: 'Admin role controls provider-credential and secret management',
        shortValue: 'Admin-managed credentials and secrets',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/security/rbac-permissions',
            label: 'docs.vellum.ai: Rbac Permissions',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Per-credential usage permissions were not established in the reviewed role documentation.',
      },
      whiteLabeling: {
        value: 'Not confirmed in the reviewed public documentation',
        shortValue: 'Not confirmed in public documentation',
        confidence: 'unknown',
        sources: [],
        detail: 'Customer branding controls for the workflow platform were not established.',
      },
      dataRetention: {
        value: 'Enterprise retention policies support 30, 60, 90, or 365 days',
        shortValue: 'Enterprise-configurable monitoring retention',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/security/data-privacy-and-storage.md',
            label: 'docs.vellum.ai: Data Privacy And Storage',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Interaction data is retained indefinitely by default; the configurable policy deletes monitoring data.',
      },
      piiRedaction: {
        value: 'Not confirmed in the reviewed public documentation',
        shortValue: 'Not confirmed in public documentation',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/security/data-privacy-and-storage.md',
            label: 'docs.vellum.ai: Data Privacy And Storage',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'A dedicated PII detection/redaction feature for workflow content or logs was not established.',
      },
      sso: {
        value: 'Not confirmed in the reviewed public documentation',
        shortValue: 'Not confirmed in public documentation',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/organizations/manage-access.md',
            label: 'docs.vellum.ai: Manage Access',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'A first-party SAML/OIDC configuration or provisioning policy for the workflow platform was not established.',
      },
      sessionPolicy: {
        value: 'Not confirmed in the reviewed public documentation',
        shortValue: 'Not confirmed in public documentation',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/organizations/manage-access.md',
            label: 'docs.vellum.ai: Manage Access',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Administrator-configured login lifetime and idle-timeout controls were not established in the access documentation.',
      },
      thirdPartyVetting: {
        value: 'Not confirmed in the reviewed public documentation',
        shortValue: 'Not confirmed in public documentation',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://www.vellum.ai/blog/vellum-composio-new-partnership-for-ai-agent-building',
            label: 'www.vellum.ai: Vellum Composio New Partnership For Ai Agent Building',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.vellum.ai/developers/workflows-sdk/custom-container-images',
            label: 'docs.vellum.ai: Custom Container Images',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Composio integration and customer-authored custom nodes are documented, but a uniform security-review guarantee for all tools was not established.',
      },
    },
    observability: {
      tracingDepth: {
        value: 'Execution tables, per-node analysis, cost/latency views, and visual replay',
        shortValue: 'Execution and node-level observability',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/deployments/observability.md',
            label: 'docs.vellum.ai: Observability',
            asOf: '2026-09-04',
          },
        ],
      },
      durabilityModel: {
        value: 'Retry adornments and workflow replay/debugging controls',
        shortValue: 'Node retries and execution replay',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/workflows/nodes/overview',
            label: 'docs.vellum.ai: Overview',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.vellum.ai/product/deployments/observability.md',
            label: 'docs.vellum.ai: Observability',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Visual replay of execution history is not a guarantee of checkpoint recovery after infrastructure failure.',
      },
      failureAlerting: {
        value: 'Failure events can be delivered to a custom alerting webhook',
        shortValue: 'Failure-event webhooks',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/monitoring/webhooks',
            label: 'docs.vellum.ai: Webhooks',
            asOf: '2026-09-04',
          },
        ],
        detail: 'The receiving system implements notification routing and threshold logic.',
      },
      dataDrains: {
        value: 'Yes: monitoring webhooks stream execution, usage, and metric events',
        shortValue: 'Monitoring event webhooks',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/monitoring/webhooks',
            label: 'docs.vellum.ai: Webhooks',
            asOf: '2026-09-04',
          },
        ],
      },
      asyncExecution: {
        value: 'Yes: async workflow execution returns an execution ID immediately',
        shortValue: 'Asynchronous execution API',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/developers/client-sdk/workflows/execute-workflow-async',
            label: 'docs.vellum.ai: Execute Workflow Async',
            asOf: '2026-09-04',
          },
        ],
      },
      executionLimits: {
        value:
          'Async executions queue when account concurrency is exceeded; quotas require confirmation',
        shortValue: 'Account quotas require confirmation',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/workflows/advanced/long-running-workflows.md',
            label: 'docs.vellum.ai: Long Running Workflows',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The docs do not establish a universal numeric execution limit; client timeout examples are not platform ceilings.',
      },
      partialFailureHandling: {
        value: 'Yes: Try adornments expose errors; Retry adornments reattempt nodes',
        shortValue: 'Try and Retry adornments',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/product/workflows/nodes/overview',
            label: 'docs.vellum.ai: Overview',
            asOf: '2026-09-04',
          },
        ],
      },
      unattendedExecution: {
        value: 'Yes: deployed scheduled and integration triggers execute automatically',
        shortValue: 'Automatic deployed triggers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/changelog/2025/2025-11',
            label: 'docs.vellum.ai: 2025 11',
            asOf: '2026-09-04',
          },
        ],
        detail: 'Availability depends on the hosted or self-hosted runtime being available.',
      },
    },
    support: {
      supportChannels: {
        value: 'Email, in-app chat, documentation, and shared customer Slack channels',
        shortValue: 'Email, in-app chat, docs, and customer Slack',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/home/getting-started/support',
            label: 'docs.vellum.ai: Support',
            asOf: '2026-09-04',
          },
        ],
      },
      sla: {
        value: 'Not confirmed in the reviewed public documentation',
        shortValue: 'Not confirmed in public documentation',
        confidence: 'unknown',
        sources: [],
        detail:
          'A current contractual uptime or support-response commitment for the workflow platform was not established.',
      },
      community: {
        value: 'Public SDK repository and workflow development resources',
        shortValue: 'Public SDK and developer resources',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.vellum.ai/developers/workflows-sdk/introduction.md',
            label: 'docs.vellum.ai: Introduction',
            asOf: '2026-09-04',
          },
        ],
      },
      companyMaturity: {
        value: 'Founded in 2023; Y Combinator Winter 2023; announced a $20M Series A in July 2025',
        shortValue: 'Founded 2023; $20M Series A in 2025',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.ycombinator.com/companies/vellum',
            label: 'www.ycombinator.com: Vellum',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.vellum.ai/blog/announcing-our-20m-series-a',
            label: 'www.vellum.ai: Announcing Our 20M Series A',
            asOf: '2026-09-04',
          },
        ],
      },
      academy: {
        value: 'Documentation, webinars, and recorded practical workflow sessions',
        shortValue: 'Docs and practical webinars',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.vellum.ai/home/getting-started/support',
            label: 'docs.vellum.ai: Support',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.vellum.ai/webinars',
            label: 'www.vellum.ai: Webinars',
            asOf: '2026-09-04',
          },
        ],
        detail: 'A formal certification curriculum was not established.',
      },
    },
  },
}
