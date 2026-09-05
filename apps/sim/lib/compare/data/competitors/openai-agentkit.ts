import { OpenAIIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Reviewed against live primary sources on 2026-09-04; undocumented capabilities remain qualified. */
export const openaiAgentkitProfile: CompetitorProfile = {
  id: 'openai-agentkit',
  name: 'OpenAI AgentKit',
  website: 'https://openai.com/index/introducing-agentkit/',
  brand: {
    icon: OpenAIIcon,
    colors: ['#848484', '#141414', '#dddddd'],
    description:
      'OpenAI is an artificial intelligence research and deployment company dedicated to building safe, beneficial artificial general intelligence (AGI). Founded in 2015, it creates advanced AI models such as GPT‑5.5, Codex, and specialized tools for chat, coding, and enterprise use. OpenAI offers products like ChatGPT, ChatGPT Business, and ChatGPT Enterprise, as well as APIs for developers to integrate AI into apps, workflows, and research. The organization publishes AI research, works on AI safety, security, and transparency, and partners with businesses to automate tasks, improve decision‑making, and unlock new capabilities across industries. Its mission is to ensure that AGI benefits all of humanity.',
    industries: [
      'Artificial Intelligence & Machine Learning',
      'Developer Tools & APIs',
      'Software (B2B)',
      'Software (B2C)',
    ],
    socials: [
      {
        type: 'x',
        url: 'https://x.com/openai',
      },
      {
        type: 'instagram',
        url: 'https://instagram.com/openai',
      },
      {
        type: 'linkedin',
        url: 'https://linkedin.com/company/openai',
      },
      {
        type: 'youtube',
        url: 'https://youtube.com/openai',
      },
      {
        type: 'tiktok',
        url: 'https://tiktok.com/@openai',
      },
      {
        type: 'github',
        url: 'https://github.com/openai',
      },
      {
        type: 'discord',
        url: 'https://discord.gg/openai',
      },
    ],
    source: 'Context.dev brand-intelligence API',
    asOf: '2026-07-02',
  },
  oneLiner:
    "AgentKit introduced OpenAI's visual Agent Builder, ChatKit, and Connector Registry. Agent Builder and the Evals platform are scheduled to shut down November 30, 2026; ChatKit and the code-based Agents SDK remain available.",
  standoutFeatures: [
    {
      title: 'Open-source Agents SDK',
      description:
        'The MIT-licensed SDK supports agent orchestration, tools, guardrails, and tracing, with Python and TypeScript implementations.',
      shortDescription: 'An open-source SDK for building agent workflows in code.',
      source: {
        url: 'https://github.com/openai/openai-agents-python',
        label: 'OpenAI Agents SDK repository',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'OpenAI connectors and custom MCP servers',
      description:
        'The Responses API supports OpenAI-maintained connectors and remote MCP servers, with configurable approval requirements.',
      shortDescription: 'Connect maintained integrations or your own MCP tools.',
      source: {
        url: 'https://developers.openai.com/api/docs/guides/tools-connectors-mcp',
        label: 'MCP and Connectors',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Embeddable ChatKit interface',
      description:
        'ChatKit supplies customizable chat UI and file attachments. New integrations use a customer-operated server; existing hosted workflows have a transition window.',
      shortDescription: 'Customizable chat UI with your own agent backend.',
      source: {
        url: 'https://developers.openai.com/api/docs/guides/chatkit',
        label: 'ChatKit integration paths',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Automatic checks and human review',
      description:
        'SDK guardrails validate inputs, outputs, and tools; approval flows pause sensitive actions for review.',
      shortDescription: 'Combine validation checks with resumable human approvals.',
      source: {
        url: 'https://developers.openai.com/api/docs/guides/agents/guardrails-approvals',
        label: 'SDK guardrails and human review',
        asOf: '2026-09-04',
      },
    },
  ],
  limitations: [
    {
      title: 'Agent Builder and Evals are being retired',
      description:
        'Evals becomes read-only October 31, 2026. Agent Builder and the Evals dashboard/API are scheduled to shut down November 30, 2026.',
      shortDescription: 'Visual builder and Evals shutdown scheduled for November 30, 2026.',
      source: {
        url: 'https://developers.openai.com/api/docs/deprecations',
        label: 'OpenAI API deprecations',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Migration requires implementation and testing',
      description:
        'OpenAI does not promise automatic graph conversion or identical behavior. Teams must validate exported SDK code or recreate and test a ChatGPT Workspace Agent.',
      shortDescription: 'Exported workflows require configuration and behavior checks.',
      source: {
        url: 'https://developers.openai.com/api/docs/guides/agent-builder/migrate-from-agent-builder',
        label: 'Migrate from Agent Builder',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Costs vary with model and tool usage',
      description:
        'API charges depend on the model, tokens, tools, and storage used. A workflow budget therefore depends on its workload.',
      shortDescription: 'Model, tool, and storage usage determine costs.',
      source: {
        url: 'https://developers.openai.com/api/docs/pricing',
        label: 'OpenAI API pricing',
        asOf: '2026-09-04',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value: 'Visual Agent Builder plus code-based Agents SDK',
        detail:
          'The visual builder is in its deprecation transition; the SDK provides Python/TypeScript agent development.',
        shortValue: 'Visual builder retiring; code-based SDK remains',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agent-builder',
            label: 'Agent Builder',
            asOf: '2026-09-04',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/agents',
            label: 'Agents SDK overview',
            asOf: '2026-09-04',
          },
        ],
      },
      learningCurve: {
        value: 'Not documented in the reviewed sources',
        detail:
          'Learning effort is not quantified; the SDK requires application development and operational configuration.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agents',
            label: 'Agents SDK overview',
            asOf: '2026-09-04',
          },
        ],
      },
      selfHostOption: {
        value: 'Agents SDK and ChatKit server can run on your infrastructure',
        detail:
          'This is a custom application deployment, not a self-hosted distribution of the Agent Builder visual service.',
        shortValue: 'Host SDK code and a ChatKit server',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/chatkit',
            label: 'ChatKit integration paths',
            asOf: '2026-09-04',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/agents',
            label: 'Agents SDK overview',
            asOf: '2026-09-04',
          },
        ],
      },
      deploymentOptions: {
        value: 'Existing hosted workflows or your own SDK application',
        detail:
          'New ChatKit work uses a custom server. Existing Agent Builder hosting ends with its scheduled shutdown.',
        shortValue: 'Custom application hosting; legacy managed workflows',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/chatkit',
            label: 'ChatKit integration paths',
            asOf: '2026-09-04',
          },
        ],
      },
      templates: {
        value: 'Agent Builder workflow templates',
        detail:
          'Templates remain part of the documented visual builder during its transition window.',
        shortValue: 'Visual workflow templates during transition',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agent-builder',
            label: 'Agent Builder',
            asOf: '2026-09-04',
          },
        ],
      },
      license: {
        value: 'MIT-licensed Agents SDK; hosted products have separate terms',
        detail:
          'The SDK repository is open source; that license does not make Agent Builder a self-hosted product.',
        shortValue: 'MIT SDK; separate hosted-service terms',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/openai/openai-agents-python',
            label: 'OpenAI Agents SDK repository',
            asOf: '2026-09-04',
          },
        ],
      },
      environmentPromotion: {
        value: 'Code export for application-managed deployment',
        detail:
          'The migration guide describes exporting Python/TypeScript; built-in full-project environment promotion is not established.',
        shortValue: 'Code export; native environment promotion unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agent-builder/migrate-from-agent-builder',
            label: 'Migrate from Agent Builder',
            asOf: '2026-09-04',
          },
        ],
      },
      versionControlDepth: {
        value: 'Published snapshots and version targeting',
        detail:
          'Agent Builder autosaves and publishes major versions; API calls can select an older version. Branching and visual diffs are unverified.',
        shortValue: 'Version snapshots; branching/diffs unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agent-builder',
            label: 'Agent Builder',
            asOf: '2026-09-04',
          },
        ],
      },
      realtimeCollaboration: {
        value: 'Not documented in the reviewed sources',
        detail:
          'The reviewed Agent Builder guide does not establish live concurrent canvas editing with shared cursors.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agent-builder',
            label: 'Agent Builder',
            asOf: '2026-09-04',
          },
        ],
      },
      nativeFileStorage: {
        value: 'Files and vector stores for retrieval',
        detail:
          'OpenAI stores uploaded files for knowledge retrieval. Folder sharing and deleted-item recovery parity are not established.',
        shortValue: 'File/vector-store storage; full file manager unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/tools-file-search',
            label: 'File search',
            asOf: '2026-09-04',
          },
        ],
      },
      dataTables: {
        value: 'Not documented in the reviewed sources',
        detail:
          'The node reference describes workflow variables and transformations, not a persistent spreadsheet-like table product.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/node-reference',
            label: 'Agent Builder node reference',
            asOf: '2026-09-04',
          },
        ],
      },
      richTextEditor: {
        value: 'Not documented in the reviewed sources',
        detail:
          'The reviewed builder and ChatKit documentation does not establish a native WYSIWYG document editor.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agent-builder',
            label: 'Agent Builder',
            asOf: '2026-09-04',
          },
        ],
      },
      subWorkflows: {
        value: 'SDK specialists can be exposed as tools',
        detail:
          'Agents-as-tools composes agent logic in code. Calling a separately saved visual workflow as a child node is unverified.',
        shortValue: 'SDK agent composition; visual sub-workflows unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agents/orchestration',
            label: 'SDK orchestration and handoffs',
            asOf: '2026-09-04',
          },
        ],
      },
      customBlocks: {
        value: 'Not documented in the reviewed sources',
        detail:
          'Publishing a saved visual workflow as a reusable organization block is not established by the node reference.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/node-reference',
            label: 'Agent Builder node reference',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value: 'Agents SDK supports mixed-provider implementations',
        detail:
          'The SDK documents provider/adapter interfaces for non-OpenAI models; this does not establish equivalent visual-builder model selection.',
        shortValue: 'Multi-provider SDK; visual selector scope differs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agents/models',
            label: 'Agents SDK models and providers',
            asOf: '2026-09-04',
          },
        ],
      },
      agentReasoningBlocks: {
        value: 'Agent nodes and SDK agents',
        detail:
          'Agent nodes configure instructions, tools, and models; the SDK runs tool and handoff loops.',
        shortValue: 'Configurable agents and agent loops',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/node-reference',
            label: 'Agent Builder node reference',
            asOf: '2026-09-04',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/agents/running-agents',
            label: 'Running agents',
            asOf: '2026-09-04',
          },
        ],
      },
      naturalLanguageBuilding: {
        value: 'Not documented in the reviewed sources',
        detail:
          'Prompt-based creation is documented for the separate ChatGPT Workspace Agents migration path, not established for Agent Builder itself.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agent-builder/migrate-from-agent-builder',
            label: 'Migrate from Agent Builder',
            asOf: '2026-09-04',
          },
        ],
      },
      knowledgeBaseRag: {
        value: 'Yes: hosted File Search and vector stores',
        detail: 'Uploaded files support semantic and keyword retrieval through the Responses API.',
        shortValue: 'Hosted vector-store retrieval',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/tools-file-search',
            label: 'File search',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpSupport: {
        value: 'Yes: hosted and runtime-managed MCP',
        detail:
          'SDK applications can connect to remote MCP tools or manage local/private MCP connections themselves.',
        shortValue: 'Remote and runtime-managed MCP',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agents/integrations-observability',
            label: 'Agents SDK integrations and observability',
            asOf: '2026-09-04',
          },
        ],
      },
      evaluationGuardrails: {
        value: 'SDK guardrails; legacy Evals is being retired',
        detail:
          'Input, output, and tool checks remain available in the SDK. Evals platform shutdown is scheduled for November 30, 2026.',
        shortValue: 'SDK guardrails remain; Evals retiring',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agents/guardrails-approvals',
            label: 'SDK guardrails and human review',
            asOf: '2026-09-04',
          },
          {
            url: 'https://developers.openai.com/api/docs/deprecations',
            label: 'OpenAI API deprecations',
            asOf: '2026-09-04',
          },
        ],
      },
      humanInTheLoop: {
        value: 'Yes: approval pauses',
        detail:
          'SDK human review pauses sensitive actions for approval or rejection; Agent Builder also documents a Human approval node.',
        shortValue: 'SDK approvals and visual approval node',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agents/guardrails-approvals',
            label: 'SDK guardrails and human review',
            asOf: '2026-09-04',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/node-reference',
            label: 'Agent Builder node reference',
            asOf: '2026-09-04',
          },
        ],
      },
      generativeMedia: {
        value: 'SDK voice pipelines',
        detail:
          'The SDK includes speech-to-text/agent/text-to-speech pipelines. This is not a claim that Agent Builder has matching media-generation nodes.',
        shortValue: 'SDK voice pipelines; canvas media parity unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/openai/openai-agents-python',
            label: 'OpenAI Agents SDK repository',
            asOf: '2026-09-04',
          },
        ],
      },
      dynamicToolUse: {
        value: 'Yes: runtime tool choice and deferred tool loading',
        detail:
          'The API supports tool search and model-selected tool calls; supported models and tool configuration govern availability.',
        shortValue: 'Runtime tools and tool search',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/tools',
            label: 'Using tools in the OpenAI API',
            asOf: '2026-09-04',
          },
        ],
      },
      modelFallback: {
        value: 'Not documented in the reviewed sources',
        detail:
          'Model selection and provider adapters are documented, but automatic cross-provider failover on errors is not established here.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agents/models',
            label: 'Agents SDK models and providers',
            asOf: '2026-09-04',
          },
        ],
      },
      agentSkills: {
        value: 'Yes: API skills for hosted/local shell environments',
        detail:
          'Skills are reusable, versioned bundles with a SKILL.md manifest. This API capability is distinct from a visual-builder skill node.',
        shortValue: 'Versioned API skills; canvas support unverified',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/tools-skills',
            label: 'API Agent Skills',
            asOf: '2026-09-04',
          },
        ],
      },
      nativeChatDeployment: {
        value: 'Yes: ChatKit embed',
        detail:
          'ChatKit provides a configurable chat surface backed by your server-side agent implementation.',
        shortValue: 'Embeddable ChatKit chat',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/chatkit',
            label: 'ChatKit integration paths',
            asOf: '2026-09-04',
          },
        ],
      },
      kbChunkVisibility: {
        value: 'Yes: retrieval results expose matching text and scores',
        detail:
          'The Retrieval API returns source-file identifiers and matching content, allowing applications to inspect retrieved passages.',
        shortValue: 'Matching passages, file IDs, and scores',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/retrieval',
            label: 'Retrieval API',
            asOf: '2026-09-04',
          },
        ],
      },
      parallelExecution: {
        value: 'Yes in SDK code; visual parallel node unverified',
        detail:
          'Official Python guidance demonstrates parallel agents with asyncio.gather. The visual node reference does not establish a fan-out/join node.',
        shortValue: 'SDK concurrency; visual parallel node unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://openai.github.io/openai-agents-python/multi_agent/',
            label: 'Agents SDK orchestration patterns',
            asOf: '2026-09-04',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/node-reference',
            label: 'Agent Builder node reference',
            asOf: '2026-09-04',
          },
        ],
      },
      a2aProtocol: {
        value: 'Not documented in the reviewed sources',
        detail:
          'Reviewed SDK integration documentation establishes MCP, not native A2A peer-protocol support.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agents/integrations-observability',
            label: 'Agents SDK integrations and observability',
            asOf: '2026-09-04',
          },
        ],
      },
      loopIteration: {
        value: 'Yes: While node and code-driven loops',
        detail:
          'Agent Builder conditions use CEL. SDK workflows can iterate using normal programming-language control flow.',
        shortValue: 'Visual While node and SDK loops',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/node-reference',
            label: 'Agent Builder node reference',
            asOf: '2026-09-04',
          },
          {
            url: 'https://openai.github.io/openai-agents-python/multi_agent/',
            label: 'Agents SDK orchestration patterns',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value: 'OpenAI-maintained connectors plus custom MCP',
        detail: 'The reviewed guide does not provide a comprehensive integration count.',
        shortValue: 'Connector count not verified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/tools-connectors-mcp',
            label: 'MCP and Connectors',
            asOf: '2026-09-04',
          },
        ],
      },
      triggerTypes: {
        value: 'ChatKit interaction and application-controlled invocation',
        detail:
          'SDK applications supply their own execution entry points; a native Agent Builder scheduling catalog is not established.',
        shortValue: 'Chat and code invocation; scheduling scope unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agents',
            label: 'Agents SDK overview',
            asOf: '2026-09-04',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/chatkit',
            label: 'ChatKit integration paths',
            asOf: '2026-09-04',
          },
        ],
      },
      customCodeSteps: {
        value: 'Yes: Python/TypeScript SDK and function tools',
        detail:
          'The SDK lets your application implement tools and orchestration. Code Interpreter separately runs model-generated Python in a sandbox.',
        shortValue: 'SDK function tools and sandboxed Python',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agents',
            label: 'Agents SDK overview',
            asOf: '2026-09-04',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/tools-code-interpreter',
            label: 'Code Interpreter',
            asOf: '2026-09-04',
          },
        ],
      },
      codeSandboxRuntime: {
        value: 'Beta SDK sandbox agents with configurable environments',
        detail:
          'Manifests define initial files, mounts, and environment; clients connect to local, Docker, or hosted sandboxes. Hosted Code Interpreter is a separate tool.',
        shortValue: 'Configurable SDK sandbox environments',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agents/sandboxes',
            label: 'Sandbox agents',
            asOf: '2026-09-04',
          },
        ],
      },
      apiPublishing: {
        value: 'Implement an endpoint in your SDK application',
        detail:
          'OpenAI documents application deployment and ChatKit integration; automatic generation of a public REST endpoint from the canvas is unverified.',
        shortValue: 'SDK endpoints; canvas API publishing unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agent-builder/migrate-from-agent-builder',
            label: 'Migrate from Agent Builder',
            asOf: '2026-09-04',
          },
        ],
      },
      extensibilitySdk: {
        value: 'Official Python and TypeScript Agents SDKs',
        detail:
          'Extend agents with application tools and MCP connections. ChatGPT plugin publishing is a separate product surface.',
        shortValue: 'Python/TypeScript SDKs and MCP',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/openai/openai-agents-python',
            label: 'OpenAI Agents SDK repository',
            asOf: '2026-09-04',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/agents/integrations-observability',
            label: 'Agents SDK integrations and observability',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpPublishing: {
        value: 'Not documented in the reviewed sources',
        detail:
          'Consuming MCP is supported; one-click publication of an Agent Builder workflow as an MCP server is not established.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/tools-connectors-mcp',
            label: 'MCP and Connectors',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value: 'Usage-based model, tool, and storage charges',
        detail:
          'File Search costs $0.10/GB-day after 1 GB free plus $2.50 per 1,000 tool calls. Model tokens are billed separately.',
        shortValue: 'Token, tool, and storage metering',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/pricing',
            label: 'OpenAI API pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      entryPaidPlan: {
        value: 'Metered API pricing; no AgentKit subscription tier listed',
        detail:
          'The reviewed price sheet lists model and tool charges rather than an AgentKit seat plan.',
        shortValue: 'Usage-based API pricing',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/pricing',
            label: 'OpenAI API pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      freeTier: {
        value: 'Limited storage allowances',
        detail:
          'File Search includes 1 GB free; ChatKit upload storage includes 1 GB per account per month. These are not free workflow execution allowances.',
        shortValue: 'Free storage allowances; execution remains metered',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/pricing',
            label: 'OpenAI API pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      byok: {
        value: 'Provider credentials can be configured in SDK code',
        detail:
          'The provider-agnostic SDK supports non-OpenAI models. This does not establish third-party key configuration in the visual builder.',
        shortValue: 'SDK provider keys; visual BYOK unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agents/models',
            label: 'Agents SDK models and providers',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/openai/openai-agents-python',
            label: 'OpenAI Agents SDK repository',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    security: {
      dataResidency: {
        value: 'Regional storage and processing for eligible API usage',
        detail:
          'Coverage depends on region, endpoint, and model; storage residency does not imply regional inference. Third-party MCP services follow their own policies.',
        shortValue: 'Eligible API residency; scope varies',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/your-data',
            label: 'OpenAI API data controls',
            asOf: '2026-09-04',
          },
        ],
      },
      rbac: {
        value: 'Organization/project roles and groups in the API Platform',
        detail:
          'Custom roles govern API and dashboard actions, including model requests, files, and key management.',
        shortValue: 'API organization/project RBAC',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/rbac',
            label: 'API organization and project permissions',
            asOf: '2026-09-04',
          },
        ],
      },
      auditLogging: {
        value: 'API Platform administrative audit logs',
        detail:
          'Logs cover users, keys, service accounts, projects, and configuration. These are separate from workflow traces and request/response content.',
        shortValue: 'Administrative audit logs; separate run traces',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.openai.com/en/articles/9687866-admin-and-audit-logs-api-for-the-api-platform',
            label: 'API Platform admin and audit logs',
            asOf: '2026-09-04',
          },
        ],
      },
      compliance: {
        value:
          'API Platform: SOC 2 Type 2, ISO/IEC 27001:2022 and 27701:2019; separate government offerings have FedRAMP Moderate',
        detail:
          'OpenAI does not separately list AgentKit in its product matrix. FedRAMP applies to designated ChatGPT/API government offerings, not automatically to ordinary AgentKit deployments.',
        shortValue: 'API SOC 2/ISO; FedRAMP is product-specific',
        confidence: 'verified',
        sources: [
          {
            url: 'https://openai.com/product-compliance-status/',
            label: 'OpenAI product compliance scopes',
            asOf: '2026-09-04',
          },
        ],
      },
      modelAndToolGovernance: {
        value: 'API project controls plus application tool policy',
        detail:
          'Project settings can govern model and tool access. SDK deployments also control which tools and approvals they expose.',
        shortValue: 'Project controls and application tool policy',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/terraform/project-controls',
            label: 'API project model, tool, and data controls',
            asOf: '2026-09-04',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/agents',
            label: 'Agents SDK overview',
            asOf: '2026-09-04',
          },
        ],
      },
      credentialGovernance: {
        value: 'Project-scoped permissions and key management',
        detail:
          'Per-role ACLs for individual stored connector credential instances are not established.',
        shortValue: 'Project/key controls; credential-instance ACLs unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/rbac',
            label: 'API organization and project permissions',
            asOf: '2026-09-04',
          },
        ],
      },
      whiteLabeling: {
        value: 'ChatKit theme and interface customization',
        detail:
          'Colors, typography, density, greetings, and prompts are configurable. Complete product-identity replacement is not established.',
        shortValue: 'ChatKit theming; full white-label scope unverified',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/chatkit-themes',
            label: 'ChatKit theming and customization',
            asOf: '2026-09-04',
          },
        ],
      },
      dataRetention: {
        value: 'Endpoint-specific API controls and separate audit retention',
        detail:
          'Eligible organizations can request ZDR or Modified Abuse Monitoring. Administrative audit logs have no fixed TTL and should be exported for customer retention requirements.',
        shortValue: 'API retention controls; audit logs differ',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/your-data',
            label: 'OpenAI API data controls',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.openai.com/en/articles/9687866-admin-and-audit-logs-api-for-the-api-platform',
            label: 'API Platform admin and audit logs',
            asOf: '2026-09-04',
          },
        ],
      },
      piiRedaction: {
        value: 'Yes: Agent Builder input guardrails',
        detail:
          'OpenAI documents redacting PII and detecting jailbreak attempts; these checks do not guarantee complete protection.',
        shortValue: 'PII redaction guardrails',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agent-builder-safety',
            label: 'Safety in building agents',
            asOf: '2026-09-04',
          },
        ],
      },
      sso: {
        value: 'SSO for eligible API organizations',
        detail:
          'Availability and setup depend on product, plan, and tenant. SSO does not itself provision product membership.',
        shortValue: 'Eligible API SSO; plan-dependent',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.openai.com/en/articles/9534785-configuring-sso',
            label: 'OpenAI SSO setup',
            asOf: '2026-09-04',
          },
        ],
      },
      sessionPolicy: {
        value: 'Not documented in the reviewed sources',
        detail:
          'The reviewed API identity documentation does not establish an AgentKit-specific administrator-set session lifetime or idle timeout.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://help.openai.com/en/articles/9534785-configuring-sso',
            label: 'OpenAI SSO setup',
            asOf: '2026-09-04',
          },
        ],
      },
      thirdPartyVetting: {
        value: 'Maintained connectors and arbitrary MCP connections',
        detail:
          'OpenAI-maintained connectors coexist with servers supplied by developers. Connecting a custom MCP server does not establish OpenAI review of its code.',
        shortValue: 'Maintained connectors; custom MCP trust varies',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/tools-connectors-mcp',
            label: 'MCP and Connectors',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value: 'SDK run traces with model, tool, handoff, and guardrail spans',
        detail:
          'Tracing is enabled by default in normal server-side SDK use, with a dashboard for inspection. OpenAI-hosted tracing is unavailable under ZDR.',
        shortValue: 'Detailed SDK traces',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agents/integrations-observability',
            label: 'Agents SDK integrations and observability',
            asOf: '2026-09-04',
          },
          {
            url: 'https://openai.github.io/openai-agents-python/tracing/',
            label: 'Agents SDK tracing and export processors',
            asOf: '2026-09-04',
          },
        ],
      },
      durabilityModel: {
        value: 'SDK state and resumable approval flows',
        detail:
          'Sessions and saved run state support continuation; the application owns persistence and deployment. A universal crash-replay guarantee is not established.',
        shortValue: 'SDK continuation; application-managed durability',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agents/running-agents',
            label: 'Running agents',
            asOf: '2026-09-04',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/agents',
            label: 'Agents SDK overview',
            asOf: '2026-09-04',
          },
        ],
      },
      failureAlerting: {
        value: 'Background-response failure webhooks',
        detail:
          'The API publishes response.failed when a background response fails; applications can consume these events for alerts.',
        shortValue: 'Background response failure webhooks',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/reference/resources/webhooks',
            label: 'OpenAI API webhook events',
            asOf: '2026-09-04',
          },
        ],
      },
      dataDrains: {
        value: 'SDK trace processors and administrative audit export',
        detail:
          'Custom trace processors send SDK traces to additional or replacement backends. Administrative audit events are available separately through the API.',
        shortValue: 'SDK trace export and separate audit API',
        confidence: 'verified',
        sources: [
          {
            url: 'https://openai.github.io/openai-agents-python/tracing/',
            label: 'Agents SDK tracing and export processors',
            asOf: '2026-09-04',
          },
          {
            url: 'https://help.openai.com/en/articles/9687866-admin-and-audit-logs-api-for-the-api-platform',
            label: 'API Platform admin and audit logs',
            asOf: '2026-09-04',
          },
        ],
      },
      asyncExecution: {
        value: 'Yes: Responses API background mode',
        detail:
          'Background requests return control for later polling. Current docs describe temporary polling storage even for ZDR requests using store=false.',
        shortValue: 'Server-side background responses',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/background',
            label: 'Responses API background mode',
            asOf: '2026-09-04',
          },
        ],
      },
      executionLimits: {
        value: 'Not documented in the reviewed sources',
        detail:
          'A single fixed duration/concurrency ceiling for all Agent Builder or SDK workflows is not established. Polling retention is not an execution timeout.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agents/running-agents',
            label: 'Running agents',
            asOf: '2026-09-04',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/background',
            label: 'Responses API background mode',
            asOf: '2026-09-04',
          },
        ],
      },
      partialFailureHandling: {
        value: 'Guardrail routing and developer-written error handling',
        detail:
          'Visual guardrails provide pass/fail routing; SDK applications implement their own recovery. Automatic isolation of every failing visual branch is unverified.',
        shortValue: 'Guardrail routing; broader recovery is application-defined',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/node-reference',
            label: 'Agent Builder node reference',
            asOf: '2026-09-04',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/agents/guardrails-approvals',
            label: 'SDK guardrails and human review',
            asOf: '2026-09-04',
          },
        ],
      },
      unattendedExecution: {
        value: 'Server-side execution with application-managed orchestration',
        detail:
          "Background API work can outlive a client connection. SDK scheduling and worker deployment are the application developer's responsibility.",
        shortValue: 'Server execution; scheduling is application-managed',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/background',
            label: 'Responses API background mode',
            asOf: '2026-09-04',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/agents',
            label: 'Agents SDK overview',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value: 'Help Center support messenger',
        detail:
          'Support starts with a virtual assistant and may be escalated to a human. Contractual enterprise support depends on the agreement.',
        shortValue: 'Help Center support',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.openai.com/en/articles/6614161-how-can-i-contact-support',
            label: 'Contact OpenAI Support',
            asOf: '2026-09-04',
          },
        ],
      },
      sla: {
        value: '99.9% uptime SLA for eligible Scale Tier traffic',
        detail:
          'Scale Tier applies to supported pre-GPT-5.6 models and enterprise agreements. It is not a blanket AgentKit workflow SLA.',
        shortValue: 'Scale Tier SLA; scope limited',
        confidence: 'verified',
        sources: [
          {
            url: 'https://openai.com/api-scale-tier/',
            label: 'OpenAI API Scale Tier',
            asOf: '2026-09-04',
          },
        ],
      },
      community: {
        value: 'Open-source SDK and developer community',
        detail: 'OpenAI maintains a public SDK repository and developer community resources.',
        shortValue: 'Public SDK and developer community',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/openai/openai-agents-python',
            label: 'OpenAI Agents SDK repository',
            asOf: '2026-09-04',
          },
          {
            url: 'https://developers.openai.com/community',
            label: 'OpenAI developer community',
            asOf: '2026-09-04',
          },
        ],
      },
      companyMaturity: {
        value: 'OpenAI product suite introduced October 6, 2025',
        detail:
          "AgentKit's announcement now includes the Agent Builder/Evals winddown. SDK and ChatKit continuity should be considered separately.",
        shortValue: 'Introduced October 2025; visual products retiring',
        confidence: 'verified',
        sources: [
          {
            url: 'https://openai.com/index/introducing-agentkit/',
            label: 'Introducing AgentKit',
            asOf: '2026-09-04',
          },
        ],
      },
      academy: {
        value: 'OpenAI Academy courses and events',
        detail: 'Courses include AI Foundations, Applied AI Foundations, and Agents and Workflows.',
        shortValue: 'Official courses and events',
        confidence: 'verified',
        sources: [
          {
            url: 'https://academy.openai.com/',
            label: 'OpenAI Academy',
            asOf: '2026-09-04',
          },
        ],
      },
    },
  },
}
