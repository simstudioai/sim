import { N8nIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Reviewed against public vendor sources on 2026-09-04; uncertainties are labeled. */
export const n8nProfile: CompetitorProfile = {
  id: 'n8n',
  name: 'n8n',
  website: 'https://n8n.io',
  brand: {
    icon: N8nIcon,
    selfFramed: true,
    colors: ['#040404', '#eb4c74', '#e6a3bc'],
    description:
      'n8n is a workflow automation platform that enables technical teams to build AI solutions and automate business processes. It combines the flexibility of code with the speed of no-code, allowing users to integrate with any app or API. With its open and self-hostable model, n8n provides an extendable tool for connecting various systems and applications, giving users the freedom to automate workflows at their own pace.',
    industries: [
      'Software (B2B)',
      'Developer Tools & APIs',
      'Artificial Intelligence & Machine Learning',
    ],
    socials: [
      {
        type: 'linkedin',
        url: 'https://linkedin.com/company/n8n',
      },
      {
        type: 'discord',
        url: 'https://discord.gg/xpkekxeb7d',
      },
      {
        type: 'youtube',
        url: 'https://youtube.com/c/n8n-io',
      },
      {
        type: 'x',
        url: 'https://x.com/n8n_io',
      },
      {
        type: 'facebook',
        url: 'https://facebook.com/n8nio',
      },
      {
        type: 'instagram',
        url: 'https://instagram.com/n8n.io',
      },
    ],
    source: 'Context.dev brand-intelligence API',
    asOf: '2026-07-02',
  },
  oneLiner:
    'n8n combines visual workflows, code steps, and AI agents, with managed Cloud and source-available self-hosted editions.',
  standoutFeatures: [
    {
      title: 'Execution-based plans with unlimited users',
      description:
        'Paid plans meter full workflow executions and include unlimited users; the advertised Starter price is €20/month when billed annually.',
      shortDescription: 'Unlimited users; full-workflow execution billing.',
      source: {
        url: 'https://n8n.io/pricing/',
        label: 'n8n pricing',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Native MCP tools and workflow management',
      description:
        'The instance-level MCP server lets compatible clients discover, build, edit, and run workflows subject to permissions and workflow exposure settings.',
      shortDescription: 'Build and run workflows from an MCP client.',
      source: {
        url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/connect/connect-to-n8n-mcp-server.md',
        label: 'n8n docs: Set up and use n8n MCP server',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Dataset evaluations with quality metrics',
      description:
        'Evaluate workflow outputs against test datasets using built-in or custom metrics. Evaluation availability depends on plan.',
      shortDescription: 'Dataset evaluations with built-in and custom metrics.',
      source: {
        url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/integrate-ai/test-and-improve-ai-workflows/use-metrics-to-measure-quality.md',
        label: 'n8n docs: Metric-based evaluations',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Free source-available self-hosted edition',
      description:
        'Community Edition runs on customer infrastructure. The Sustainable Use License permits internal business and non-commercial use within its stated restrictions.',
      shortDescription: 'Self-hosted core under the Sustainable Use License.',
      source: {
        url: 'https://raw.githubusercontent.com/n8n-io/n8n/master/LICENSE.md',
        label: 'n8n license',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Agents with named skills and sub-agents in preview',
      description:
        'Agents preview bundles models, instructions, tools, named skills, knowledge, and delegation in project-level agents. Self-hosted Enterprise support is not yet ready.',
      shortDescription: 'Named skills, knowledge, and sub-agent delegation (preview).',
      source: {
        url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/build-and-manage-agents.md',
        label: 'n8n docs: Build and manage agents',
        asOf: '2026-09-04',
      },
    },
  ],
  limitations: [
    {
      title: 'Advanced collaboration requires a paid plan',
      description:
        'Community Edition excludes shared projects and workflow/credential sharing; only the creator and instance owner can access those resources.',
      shortDescription: 'Community excludes project and resource sharing.',
      source: {
        url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/deploy/host-n8n/community-edition-features.md',
        label: 'n8n docs: Compare plans and editions',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'AI Assistant remains in preview',
      description:
        'The current AI Assistant is available on Cloud Starter/Pro and self-hosted Community/Business. Enterprise customers must contact their account team about preview access.',
      shortDescription: 'Preview availability varies by edition.',
      source: {
        url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/ways-of-building-workflows/ai-assistant.md',
        label: 'n8n docs: Use AI Assistant',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Self-hosting requires infrastructure maintenance',
      description:
        'Customers who self-host are responsible for installation, configuration, infrastructure, and maintenance. Cloud transfers those operational responsibilities to n8n.',
      shortDescription: 'Self-hosted operation needs technical resources.',
      source: {
        url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/get-started/choose-how-to-use-n8n.md',
        label: 'n8n docs: choose-how-to-use-n8n',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Simple Vector Store is for development',
      description:
        'The in-memory Simple Vector Store loses data on restart and exposes its global memory keys to all instance users. n8n recommends it for development use only.',
      shortDescription: 'In-memory vector storage is not persistent or project-isolated.',
      source: {
        url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.vectorstoreinmemory.md',
        label: 'n8n docs: Simple Vector Store node documentation',
        asOf: '2026-09-04',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value: 'Visual workflow canvas with code and AI-assisted building',
        detail:
          'Build workflows from connected nodes, add JavaScript or Python Code steps, or create and edit workflows through the AI Assistant preview.',
        shortValue: 'Visual canvas, code, and AI Assistant',
        confidence: 'verified',
        sources: [
          {
            url: 'https://n8n.io/pricing/',
            label: 'n8n pricing',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/ways-of-building-workflows/ai-assistant.md',
            label: 'n8n docs: Use AI Assistant',
            asOf: '2026-09-04',
          },
        ],
      },
      learningCurve: {
        value: 'Not independently measured',
        detail:
          'The documentation supports both visual building and custom code. Learning effort depends on the workflow and the builder’s experience; this comparison does not assign a measured difficulty score.',
        shortValue: 'Depends on workflow and experience',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/get-started/choose-how-to-use-n8n.md',
            label: 'n8n docs: choose-how-to-use-n8n',
            asOf: '2026-09-04',
          },
        ],
      },
      selfHostOption: {
        value: 'Yes: free Community and paid self-hosted editions',
        detail:
          'Self-hosted Community and Registered Community are free. Business and Enterprise subscriptions unlock additional features.',
        shortValue: 'Free Community; paid Business and Enterprise',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/deploy/host-n8n/community-edition-features.md',
            label: 'n8n docs: Compare plans and editions',
            asOf: '2026-09-04',
          },
        ],
      },
      deploymentOptions: {
        value: 'Managed Cloud or deployment on your own infrastructure',
        detail:
          'n8n documents self-hosting through npm, Docker, or a server, with infrastructure operation and maintenance handled by the customer.',
        shortValue: 'Cloud or self-hosted npm/Docker/server',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/get-started/choose-how-to-use-n8n.md',
            label: 'n8n docs: choose-how-to-use-n8n',
            asOf: '2026-09-04',
          },
        ],
      },
      templates: {
        value: 'Yes: more than 12,000 workflow templates',
        detail:
          'The public template directory displayed 12,116 templates during this review, including an AI category. Directory totals change over time.',
        shortValue: '12,000+ public workflow templates',
        confidence: 'verified',
        sources: [
          {
            url: 'https://n8n.io/workflows/',
            label: 'n8n workflow templates',
            asOf: '2026-09-04',
          },
        ],
      },
      license: {
        value: 'Source-available Sustainable Use License with separate Enterprise terms',
        detail:
          'The Sustainable Use License permits internal business, non-commercial, and personal use subject to its restrictions. Enterprise files require the separate Enterprise license; modifications must preserve required notices.',
        shortValue: 'Sustainable Use License; separate Enterprise license',
        confidence: 'verified',
        sources: [
          {
            url: 'https://raw.githubusercontent.com/n8n-io/n8n/master/LICENSE.md',
            label: 'n8n license',
            asOf: '2026-09-04',
          },
        ],
      },
      environmentPromotion: {
        value: 'Yes: Git-backed source control and environments',
        detail:
          'Push workflows and supporting resource definitions to Git and pull them into another instance. Secret credential values must be provisioned separately. Business includes Git and environments; Enterprise adds further options.',
        shortValue: 'Git-backed promotion on Business and Enterprise',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/administer/use-source-control-and-environments/push-and-pull-changes.md',
            label: 'n8n docs: Push and pull',
            asOf: '2026-09-04',
          },
          {
            url: 'https://n8n.io/pricing/',
            label: 'n8n pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      versionControlDepth: {
        value: 'Saved workflow history with restore, copy, and comparison',
        detail:
          'History is stored in the instance database. All users receive 24 hours; Cloud Pro receives five days and Enterprise receives full history. Named versions are excluded from automatic pruning on eligible plans.',
        shortValue: 'Workflow history and restore; retention varies',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/manage-workflows/view-change-history.md',
            label: 'n8n docs: Workflow history',
            asOf: '2026-09-04',
          },
        ],
      },
      realtimeCollaboration: {
        value: 'Workflow sharing is documented; live co-editing not confirmed',
        detail:
          'Paid plans provide projects and workflow sharing. The reviewed sources do not establish synchronized canvas editing with live cursors. Community restricts workflow access to its creator and the instance owner.',
        shortValue: 'Sharing; live co-editing unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/deploy/host-n8n/community-edition-features.md',
            label: 'n8n docs: Compare plans and editions',
            asOf: '2026-09-04',
          },
          {
            url: 'https://n8n.io/pricing/',
            label: 'n8n pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      nativeFileStorage: {
        value: 'Execution binary storage; shared file-manager functionality unconfirmed',
        detail:
          'n8n documents binary data storage for workflow executions. This does not establish a native shared drive with folders, sharing links, and deleted-file recovery.',
        shortValue: 'Execution files; shared drive unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/deploy/host-n8n/configure-n8n/scaling/handle-binary-data.md',
            label: 'n8n docs: Scaling binary data in n8n',
            asOf: '2026-09-04',
          },
        ],
      },
      dataTables: {
        value: 'Yes: native tables with a UI, node, and API',
        detail:
          'Data tables store structured rows across workflows in a project. The documented default total capacity is 200 MiB per instance, configurable when self-hosting.',
        shortValue: 'Native Data Tables; 200 MiB default',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/work-with-data/data-tables.md',
            label: 'n8n docs: Data tables',
            asOf: '2026-09-04',
          },
        ],
      },
      richTextEditor: {
        value: 'Markdown canvas notes; document editor unconfirmed',
        detail:
          'Sticky Notes support Markdown annotations on the workflow canvas. A separate document-oriented rich-text editor is not established by the reviewed source.',
        shortValue: 'Markdown notes; document editor unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/understand-workflows/workflow-components/add-notes-and-documentation.md',
            label: 'n8n docs: add-notes-and-documentation',
            asOf: '2026-09-04',
          },
        ],
      },
      subWorkflows: {
        value: 'Yes: Execute Sub-workflow node',
        detail:
          'Call another workflow with mapped inputs. The parent can wait for the child to complete or continue without waiting.',
        shortValue: 'Reusable sub-workflows with optional waiting',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow.md',
            label: 'n8n docs: Execute Sub-workflow',
            asOf: '2026-09-04',
          },
        ],
      },
      customBlocks: {
        value: 'Reusable sub-workflows and code-authored custom nodes',
        detail:
          'Execute Sub-workflow calls saved workflows. The n8n-node development tool scaffolds and validates custom integration nodes; publishing a visual workflow as its own named node is not confirmed here.',
        shortValue: 'Sub-workflows and custom node development',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow.md',
            label: 'n8n docs: Execute Sub-workflow',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/connect/create-nodes/build-your-node/using-the-n8n-node-tool.md',
            label: 'n8n docs: using-the-n8n-node-tool',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value: 'Yes: multiple model providers',
        detail:
          'First-party Chat Model documentation covers OpenAI, Anthropic, and Google Gemini, among other integrations.',
        shortValue: 'OpenAI, Anthropic, Gemini, and more',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.lmchatopenai/README.md',
            label: 'n8n docs: OpenAI Chat Model node documentation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.lmchatanthropic.md',
            label: 'n8n docs: Anthropic Chat Model node documentation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.lmchatgooglegemini.md',
            label: 'n8n docs: Google Gemini Chat Model node documentation',
            asOf: '2026-09-04',
          },
        ],
      },
      agentReasoningBlocks: {
        value: 'Yes: AI Agent node and separate Agents preview',
        detail:
          'The AI Agent node uses a connected model to choose and call tools. The Agents preview adds project-level agents with instructions, tools, skills, knowledge, and sub-agents.',
        shortValue: 'AI Agent node; first-class Agents in preview',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/README.md',
            label: 'n8n docs: AI Agent node documentation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/build-and-manage-agents.md',
            label: 'n8n docs: Build and manage agents',
            asOf: '2026-09-04',
          },
        ],
      },
      naturalLanguageBuilding: {
        value: 'Yes: AI Assistant preview on Cloud and self-hosted',
        detail:
          'The AI Assistant creates, edits, tests, and troubleshoots workflows. Current docs list Cloud Starter/Pro and self-hosted Community/Registered Community/Business; Enterprise customers must contact their account team about preview access.',
        shortValue: 'AI Assistant preview, including self-hosted',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/ways-of-building-workflows/ai-assistant.md',
            label: 'n8n docs: Use AI Assistant',
            asOf: '2026-09-04',
          },
        ],
      },
      knowledgeBaseRag: {
        value: 'Yes: vector-store workflows and agent knowledge bases',
        detail:
          'Vector-store nodes provide retrieval for AI workflows. Agents preview can search uploaded CSV, PDF, Markdown, and text files; self-hosted agent knowledge bases require a Daytona sandbox and are also in preview.',
        shortValue: 'Vector-store RAG and agent file knowledge',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.vectorstoreinmemory.md',
            label: 'n8n docs: Simple Vector Store node documentation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/build-and-manage-agents.md',
            label: 'n8n docs: Build and manage agents',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpSupport: {
        value: 'Yes: MCP client, server trigger, and instance server',
        detail:
          'MCP Client Tool connects agents to external tools. MCP Server Trigger exposes connected tools, while the instance server supports workflow management and execution.',
        shortValue: 'Native MCP client and server support',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp.md',
            label: 'n8n docs: MCP Client Tool node documentation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/core-nodes/n8n-nodes-langchain.mcptrigger.md',
            label: 'n8n docs: MCP Server Trigger node documentation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/connect/connect-to-n8n-mcp-server.md',
            label: 'n8n docs: Set up and use n8n MCP server',
            asOf: '2026-09-04',
          },
        ],
      },
      evaluationGuardrails: {
        value: 'Yes: dataset evaluations and a Guardrails node',
        detail:
          'Metric-based evaluations score test cases with built-in or custom metrics; availability depends on plan. Guardrails can check inputs or outputs for policy violations and sanitize text.',
        shortValue: 'Dataset evaluations and native Guardrails',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/integrate-ai/test-and-improve-ai-workflows/use-metrics-to-measure-quality.md',
            label: 'n8n docs: Metric-based evaluations',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/core-nodes/n8n-nodes-langchain.guardrails.md',
            label: 'n8n docs: Guardrails node documentation',
            asOf: '2026-09-04',
          },
        ],
      },
      humanInTheLoop: {
        value: 'Yes: human review before selected AI tool calls',
        detail:
          'Connect sensitive tools through a human-review step. The workflow pauses for approval or denial through channels including Chat, Slack, Telegram, Gmail, and Microsoft Teams.',
        shortValue: 'Per-tool approval and denial',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/integrate-ai/ai-examples/human-in-the-loop-for-tools.md',
            label: 'n8n docs: Human-in-the-loop for AI tool calls',
            asOf: '2026-09-04',
          },
        ],
      },
      generativeMedia: {
        value: 'Yes: media generation through provider nodes',
        detail:
          'The native MiniMax integration supports image generation, text-to-speech, and video generation from text or an image. OpenAI audio operations also support speech generation and transcription.',
        shortValue: 'Image, video, and speech provider integrations',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/app-nodes/n8n-nodes-langchain.minimax.md',
            label: 'n8n docs: MiniMax node documentation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/app-nodes/n8n-nodes-langchain.openai/audio-operations.md',
            label: 'n8n docs: OpenAI Audio operations',
            asOf: '2026-09-04',
          },
        ],
      },
      dynamicToolUse: {
        value: 'Selection among configured tools; broader discovery unconfirmed',
        detail:
          'The AI Agent selects tools based on the task and their capabilities. Agents preview also chooses tools and skills in a reasoning loop. This verifies runtime selection, not unrestricted creation of new tools.',
        shortValue: 'Runtime selection of configured tools',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/README.md',
            label: 'n8n docs: AI Agent node documentation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/build-and-manage-agents.md',
            label: 'n8n docs: Build and manage agents',
            asOf: '2026-09-04',
          },
        ],
      },
      modelFallback: {
        value: 'Automatic cross-provider fallback not confirmed',
        detail:
          'The reviewed Chat Model and Agent documentation does not establish a general automatic model failover policy.',
        shortValue: 'Automatic model fallback unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/README.md',
            label: 'n8n docs: AI Agent node documentation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.lmchatopenai/README.md',
            label: 'n8n docs: OpenAI Chat Model node documentation',
            asOf: '2026-09-04',
          },
        ],
      },
      agentSkills: {
        value: 'Yes: named skills in Agents preview',
        detail:
          'A skill bundles instructions and selected tools under a name and description. Agents choose a skill based on its description and the current request. Agents remain in preview.',
        shortValue: 'Named instruction-and-tool skills (preview)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/build-and-manage-agents.md',
            label: 'n8n docs: Build and manage agents',
            asOf: '2026-09-04',
          },
        ],
      },
      nativeChatDeployment: {
        value: 'Yes: hosted or embedded chat and Chat Hub',
        detail:
          'Chat Trigger supports hosted chat, an embeddable widget, and streaming responses. Chat Hub provides multi-model chat and a restricted Chat user role on eligible plans.',
        shortValue: 'Hosted/embedded chat, streaming, and Chat Hub',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/core-nodes/n8n-nodes-langchain.chattrigger/README.md',
            label: 'n8n docs: Chat Trigger node documentation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/ways-of-building-workflows/chat-hub.md',
            label: 'n8n docs: Chat Hub',
            asOf: '2026-09-04',
          },
        ],
      },
      kbChunkVisibility: {
        value: 'Vector retrieval is documented; dedicated chunk inspection unconfirmed',
        detail:
          'The Simple Vector Store supports inserting and retrieving documents. The reviewed source does not establish a dedicated interface for browsing every stored chunk and its metadata.',
        shortValue: 'Retrieval nodes; dedicated chunk browser unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.vectorstoreinmemory.md',
            label: 'n8n docs: Simple Vector Store node documentation',
            asOf: '2026-09-04',
          },
        ],
      },
      parallelExecution: {
        value: 'Sequential workflow branches; parallel sub-agents in preview',
        detail:
          'The current workflow execution order completes one branch before another. Separately, Agents preview lets builders configure the maximum number of sub-agents that run in parallel.',
        shortValue: 'Sequential branches; parallel sub-agents (preview)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/flow-logic/understand-execution-order.md',
            label: 'n8n docs: Execution order in multi-branch workflows',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/build-and-manage-agents.md',
            label: 'n8n docs: Build and manage agents',
            asOf: '2026-09-04',
          },
        ],
      },
      a2aProtocol: {
        value: 'Community A2A integration is documented',
        detail:
          'n8n’s official A2A article points to a community-published node for protocol-level communication. This establishes an ecosystem option, not a first-party protocol guarantee.',
        shortValue: 'A2A through a community node',
        confidence: 'verified',
        sources: [
          {
            url: 'https://blog.n8n.io/agent-to-agent-protocol/',
            label: 'n8n: Agent-to-Agent protocol',
            asOf: '2026-09-04',
          },
        ],
      },
      loopIteration: {
        value: 'Yes: Loop Over Items with configurable batches',
        detail:
          'The node returns a batch through its loop output on each iteration and combines processed data through its done output. Many nodes already process lists without an explicit loop.',
        shortValue: 'Batch iteration and combined results',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/core-nodes/n8n-nodes-base.splitinbatches.md',
            label: 'n8n docs: Loop Over Items (Split in Batches)',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value: '2,147 entries in the integration directory',
        detail:
          'The public directory displayed 2,147 entries during review. Its count includes different node types and partner-built entries, so it is not a count of distinct apps or exclusively first-party connectors.',
        shortValue: '2,147 directory entries',
        confidence: 'verified',
        sources: [
          {
            url: 'https://n8n.io/integrations/',
            label: 'n8n integrations directory',
            asOf: '2026-09-04',
          },
        ],
      },
      triggerTypes: {
        value: 'Webhooks, schedules, app events, chat, manual, and MCP',
        detail:
          'The node interface supports multiple trigger categories. Dedicated Chat Trigger and MCP Server Trigger nodes expose workflows to chat and MCP clients.',
        shortValue: 'Webhook, schedule, app-event, chat, and MCP triggers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/understand-workflows/workflow-components/work-with-nodes.md',
            label: 'n8n docs: work-with-nodes',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/core-nodes/n8n-nodes-langchain.chattrigger/README.md',
            label: 'n8n docs: Chat Trigger node documentation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/core-nodes/n8n-nodes-langchain.mcptrigger.md',
            label: 'n8n docs: MCP Server Trigger node documentation',
            asOf: '2026-09-04',
          },
        ],
      },
      customCodeSteps: {
        value: 'Yes: JavaScript and Python Code steps',
        detail:
          'n8n pricing lists JavaScript/Python code steps. A Custom Code Tool also exposes code to AI agents.',
        shortValue: 'JavaScript and Python',
        confidence: 'verified',
        sources: [
          {
            url: 'https://n8n.io/pricing/',
            label: 'n8n pricing',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolcode.md',
            label: 'n8n docs: Custom Code Tool node documentation',
            asOf: '2026-09-04',
          },
        ],
      },
      codeSandboxRuntime: {
        value: 'Self-hosted task runners with configurable dependency allowlists',
        detail:
          'Task runners execute Code nodes. Self-hosted configuration controls permitted JavaScript and Python modules; third-party Python packages must also be installed in the runner image. Dependency availability is managed by the deployment.',
        shortValue: 'Task runners; deployment-managed dependencies',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/deploy/host-n8n/configure-n8n/basic-configuration/use-environment-variables/task-runners.md',
            label: 'n8n docs: Task runner environment variables',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/deploy/host-n8n/configure-n8n/basic-configuration/configuration-examples/enable-modules-in-code-node.md',
            label: 'n8n docs: Enable modules in Code node',
            asOf: '2026-09-04',
          },
        ],
      },
      apiPublishing: {
        value: 'Yes: HTTP webhook endpoints and MCP tools',
        detail:
          'Webhook nodes expose callable production URLs, with configurable response behavior. MCP Server Trigger exposes its connected tools through a production MCP URL.',
        shortValue: 'Webhook APIs and MCP tool endpoints',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/core-nodes/n8n-nodes-base.webhook/README.md',
            label: 'n8n docs: Webhook node documentation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/core-nodes/n8n-nodes-langchain.mcptrigger.md',
            label: 'n8n docs: MCP Server Trigger node documentation',
            asOf: '2026-09-04',
          },
        ],
      },
      extensibilitySdk: {
        value: 'Public REST API and custom-node development tools',
        detail:
          'n8n documents a public API for programmatic administration and an n8n-node CLI for creating, testing, and publishing custom nodes. Broader language SDK coverage is not assessed here.',
        shortValue: 'REST API and n8n-node CLI',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/connect/n8n-api/README.md',
            label: 'n8n docs: n8n public REST API Documentation and Guides',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/connect/create-nodes/build-your-node/using-the-n8n-node-tool.md',
            label: 'n8n docs: using-the-n8n-node-tool',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpPublishing: {
        value: 'Yes: workflow-level and instance-level MCP servers',
        detail:
          'MCP Server Trigger supports SSE and Streamable HTTP and publishes connected tools. The instance server supports finding, building, editing, and running workflows subject to access settings.',
        shortValue: 'Native MCP publishing and workflow management',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/core-nodes/n8n-nodes-langchain.mcptrigger.md',
            label: 'n8n docs: MCP Server Trigger node documentation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/connect/connect-to-n8n-mcp-server.md',
            label: 'n8n docs: Set up and use n8n MCP server',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value: 'Workflow-execution quotas with unlimited users',
        detail:
          'A complete workflow run counts as one execution regardless of its step count. Agents preview counts each agent turn against the shared execution quota.',
        shortValue: 'Per-execution billing; unlimited users',
        confidence: 'verified',
        sources: [
          {
            url: 'https://n8n.io/pricing/',
            label: 'n8n pricing',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/build-and-manage-agents.md',
            label: 'n8n docs: Build and manage agents',
            asOf: '2026-09-04',
          },
        ],
      },
      entryPaidPlan: {
        value: 'Starter: €20/month billed annually',
        detail:
          'The advertised entry plan includes 2,500 monthly workflow executions, one shared project, and five concurrent executions on n8n Cloud.',
        shortValue: '€20/month annually; 2,500 executions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://n8n.io/pricing/',
            label: 'n8n pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      freeTier: {
        value: 'Free self-hosted Community edition; Cloud trial',
        detail:
          'Community and Registered Community are free. n8n Cloud offers a trial without a credit card; continued Cloud use requires a paid plan.',
        shortValue: 'Free self-hosted edition; Cloud trial',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/deploy/host-n8n/community-edition-features.md',
            label: 'n8n docs: Compare plans and editions',
            asOf: '2026-09-04',
          },
          {
            url: 'https://n8n.io/pricing/',
            label: 'n8n pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      byok: {
        value: 'Yes: provider API credentials; hosted credits also available',
        detail:
          'OpenAI and Anthropic credentials accept users’ provider API keys. Supported Cloud nodes can also use Gateway credits; MiniMax documents that option. Self-hosted AI Assistant requires a model-provider configuration.',
        shortValue: 'Own API keys or supported Cloud Gateway credits',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/credentials/openai.md',
            label: 'n8n docs: OpenAI credentials',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/credentials/anthropic.md',
            label: 'n8n docs: Anthropic credentials',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/app-nodes/n8n-nodes-langchain.minimax.md',
            label: 'n8n docs: MiniMax node documentation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/deploy/host-n8n/configure-n8n/set-up-ai-assistant.md',
            label: 'n8n docs: set-up-ai-assistant',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    security: {
      dataResidency: {
        value: 'Cloud hosted in Frankfurt, Germany; self-hosted location chosen by you',
        detail:
          'The pricing FAQ places hosted-plan data in Frankfurt in the EU. Self-hosted deployments let the customer choose the hosting location; connected providers have their own data handling.',
        shortValue: 'Frankfurt/EU Cloud; self-hosted location control',
        confidence: 'verified',
        sources: [
          {
            url: 'https://n8n.io/pricing/',
            label: 'n8n pricing',
            asOf: '2026-09-04',
          },
          {
            url: 'https://n8n.io/legal/security/',
            label: 'n8n security',
            asOf: '2026-09-04',
          },
        ],
      },
      rbac: {
        value: 'Instance roles plus plan-dependent project access controls',
        detail:
          'n8n distinguishes instance Owner/Admin/Member roles from project roles. Community has owner and creator access but excludes shared projects and workflow/credential sharing. Paid features and custom roles vary by plan.',
        shortValue: 'Instance roles; advanced project access is plan-gated',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/administer/manage-users-and-access/understand-instance-roles.md',
            label: 'n8n docs: understand-instance-roles',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/deploy/host-n8n/community-edition-features.md',
            label: 'n8n docs: Compare plans and editions',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/administer/manage-users-and-access/set-permissions-and-roles-rbac/see-available-roles.md',
            label: 'n8n docs: RBAC role types',
            asOf: '2026-09-04',
          },
        ],
      },
      auditLogging: {
        value: 'Yes: Enterprise log streaming includes audit events',
        detail:
          'The Enterprise log stream covers user, credential, workflow, and other administrative events. This is customer-facing audit functionality; internal corporate log-retention statements are not a product retention guarantee.',
        shortValue: 'Enterprise audit-event streaming',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/administer/observe-and-log/stream-logs-to-external-systems.md',
            label: 'n8n docs: stream-logs-to-external-systems',
            asOf: '2026-09-04',
          },
        ],
      },
      compliance: {
        value: 'SOC 2 Type II and SOC 3 reports; GDPR documentation',
        detail:
          'n8n’s Trust Center lists SOC 2 Type 2, SOC 3, and GDPR. Its security page offers the SOC 2 report to Enterprise customers and links a public SOC 3 report. Other frameworks and contractual requirements need separate confirmation.',
        shortValue: 'SOC 2 Type II, SOC 3, and GDPR documentation',
        confidence: 'verified',
        sources: [
          {
            url: 'https://trust.n8n.io/',
            label: 'n8n Trust Center',
            asOf: '2026-09-04',
          },
          {
            url: 'https://n8n.io/legal/security/',
            label: 'n8n security',
            asOf: '2026-09-04',
          },
        ],
      },
      modelAndToolGovernance: {
        value: 'Chat Hub model controls and per-tool approval',
        detail:
          'Chat Hub admins can enable or disable models/providers and restrict custom credentials. AI workflows can require human approval for selected tool calls; these are documented controls with different scopes.',
        shortValue: 'Chat model controls and tool approvals',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/ways-of-building-workflows/chat-hub.md',
            label: 'n8n docs: Chat Hub',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/integrate-ai/ai-examples/human-in-the-loop-for-tools.md',
            label: 'n8n docs: Human-in-the-loop for AI tool calls',
            asOf: '2026-09-04',
          },
        ],
      },
      credentialGovernance: {
        value: 'Project-based credential access and custom roles',
        detail:
          'Project roles govern credentials alongside workflows and executions. Custom roles provide more granular permissions on eligible plans; external secret-store integration is listed on Enterprise.',
        shortValue: 'Project credential permissions and custom roles',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/administer/manage-users-and-access/set-permissions-and-roles-rbac/see-available-roles.md',
            label: 'n8n docs: RBAC role types',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/administer/manage-users-and-access/set-permissions-and-roles-rbac/create-custom-roles.md',
            label: 'n8n docs: Custom roles',
            asOf: '2026-09-04',
          },
          {
            url: 'https://n8n.io/pricing/',
            label: 'n8n pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      whiteLabeling: {
        value: 'OEM embedding retains n8n branding',
        detail:
          'The OEM FAQ explicitly says the embedded editor remains branded as n8n and does not support full white-labeling. OEM has separate commercial terms.',
        shortValue: 'Embedded OEM editor retains n8n branding',
        confidence: 'verified',
        sources: [
          {
            url: 'https://n8n.io/oem/',
            label: 'n8n OEM',
            asOf: '2026-09-04',
          },
        ],
      },
      dataRetention: {
        value: 'Configurable self-hosted execution pruning; Cloud plan limits',
        detail:
          'Self-hosted defaults prune finished executions after 14 days or when the count exceeds 10,000, with exceptions for annotated and unfinished runs. Cloud retention is constrained by plan-specific age, count, and storage limits.',
        shortValue: 'Self-hosted pruning and tiered Cloud retention',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/deploy/host-n8n/configure-n8n/scaling/manage-execution-data.md',
            label: 'n8n docs: manage-execution-data',
            asOf: '2026-09-04',
          },
          {
            url: 'https://n8n.io/pricing/',
            label: 'n8n pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      piiRedaction: {
        value: 'Yes: text sanitization and Enterprise execution-data redaction',
        detail:
          'Guardrails can detect and replace PII and secrets in text. Enterprise can redact execution payloads while retaining metadata, with controlled reveal access; this hides data on read rather than deleting stored values.',
        shortValue: 'Native PII sanitization; Enterprise log redaction',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/core-nodes/n8n-nodes-langchain.guardrails.md',
            label: 'n8n docs: Guardrails node documentation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/deploy/host-n8n/configure-n8n/security/redact-execution-data.md',
            label: 'n8n docs: Execution data redaction',
            asOf: '2026-09-04',
          },
        ],
      },
      sso: {
        value: 'Yes: SAML and OIDC on eligible paid plans',
        detail:
          'n8n documents SAML and OIDC configuration. Pricing includes SSO on Business and Enterprise; supported provisioning and role-mapping options depend on the plan and identity provider.',
        shortValue: 'SAML/OIDC; Business and Enterprise',
        confidence: 'verified',
        sources: [
          {
            url: 'https://n8n.io/pricing/',
            label: 'n8n pricing',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/administer/manage-users-and-access/verify-user-identity/use-saml/README.md',
            label: 'n8n docs: README',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/administer/manage-users-and-access/verify-user-identity/use-oidc/README.md',
            label: 'n8n docs: README',
            asOf: '2026-09-04',
          },
        ],
      },
      sessionPolicy: {
        value: 'Configurable session lifetime for self-hosted instances',
        detail:
          'Self-hosted environment variables set JWT lifetime (168 hours by default) and refresh behavior. A refresh timeout of -1 disables refresh and forces sign-in after the configured lifetime.',
        shortValue: 'Self-hosted JWT lifetime and refresh settings',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/deploy/host-n8n/configure-n8n/basic-configuration/use-environment-variables/user-management-and-2fa.md',
            label:
              "n8n docs: 'User management SMTP, and two-factor authentication environment variables'",
            asOf: '2026-09-04',
          },
          {
            url: 'https://n8n.io/legal/security/',
            label: 'n8n security',
            asOf: '2026-09-04',
          },
        ],
      },
      thirdPartyVetting: {
        value: 'Built-in integrations and a separately reviewed community-node subset',
        detail:
          'n8n warns that unverified community packages can access the host and workflow data. Verified community nodes must meet documented source, dependency, and security requirements; administrators can disable community nodes.',
        shortValue: 'Verified community program; unverified nodes carry risk',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/community-nodes/risks.md',
            label: 'n8n docs: risks',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/connect/create-nodes/build-your-node/reference/verification-guidelines.md',
            label: 'n8n docs: verification-guidelines',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value: 'Execution debugging and workflow-level Insights metrics',
        detail:
          'Insights reports production execution counts, failures, failure rate, time saved, and average runtime. Its detailed dashboard is available on Cloud Pro/Enterprise and self-hosted Business/Enterprise.',
        shortValue: 'Execution debugging and Insights dashboards',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/administer/observe-and-log/track-usage-with-insights.md',
            label: 'n8n docs: track-usage-with-insights',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/understand-workflows/understand-executions/debug-executions.md',
            label: 'n8n docs: Debug and re-run past executions',
            asOf: '2026-09-04',
          },
        ],
      },
      durabilityModel: {
        value: 'Node retries, error workflows, and execution-data debugging',
        detail:
          'Nodes expose Retry on Fail and configurable error behavior. Error workflows handle failed runs, and saved execution data can be loaded into the editor for debugging. These sources do not establish arbitrary crash recovery guarantees.',
        shortValue: 'Retries, error workflows, and saved-run debugging',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/understand-workflows/workflow-components/work-with-nodes.md',
            label: 'n8n docs: work-with-nodes',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/flow-logic/handle-errors-gracefully.md',
            label: 'n8n docs: handle-errors-gracefully',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/understand-workflows/understand-executions/debug-executions.md',
            label: 'n8n docs: Debug and re-run past executions',
            asOf: '2026-09-04',
          },
        ],
      },
      failureAlerting: {
        value: 'Yes: error workflows can send notifications',
        detail:
          'An Error Trigger starts a designated error workflow when an automatic workflow execution fails. That workflow can send an alert through connected services.',
        shortValue: 'Error-triggered notification workflows',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/flow-logic/handle-errors-gracefully.md',
            label: 'n8n docs: handle-errors-gracefully',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/core-nodes/n8n-nodes-base.errortrigger.md',
            label: 'n8n docs: Error Trigger node documentation',
            asOf: '2026-09-04',
          },
        ],
      },
      dataDrains: {
        value: 'Yes: Enterprise log streaming',
        detail:
          'Stream workflow, node, audit, and AI events to a webhook, syslog server, or Sentry client.',
        shortValue: 'Enterprise webhook/syslog/Sentry streams',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/administer/observe-and-log/stream-logs-to-external-systems.md',
            label: 'n8n docs: stream-logs-to-external-systems',
            asOf: '2026-09-04',
          },
        ],
      },
      asyncExecution: {
        value: 'Yes: immediate webhook responses and resumable Wait nodes',
        detail:
          'A Webhook node can respond immediately while the workflow continues. Wait nodes pause and later resume execution based on time or a callback.',
        shortValue: 'Respond immediately; pause and resume with Wait',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/core-nodes/n8n-nodes-base.webhook/README.md',
            label: 'n8n docs: Webhook node documentation',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/integrations/builtin/core-nodes/n8n-nodes-base.wait.md',
            label: 'n8n docs: Wait',
            asOf: '2026-09-04',
          },
        ],
      },
      executionLimits: {
        value: 'Cloud concurrency quotas and self-hosted timeout controls',
        detail:
          'Cloud Starter lists five concurrent executions and Pro lists 20. Self-hosted operators can configure production concurrency and execution timeouts; excess production runs are queued when concurrency control is enabled.',
        shortValue: 'Tiered Cloud limits; self-hosted configuration',
        confidence: 'verified',
        sources: [
          {
            url: 'https://n8n.io/pricing/',
            label: 'n8n pricing',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/deploy/host-n8n/configure-n8n/scaling/control-concurrency.md',
            label: 'n8n docs: control-concurrency',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/deploy/host-n8n/configure-n8n/basic-configuration/use-environment-variables/executions.md',
            label: 'n8n docs: Executions environment variables',
            asOf: '2026-09-04',
          },
        ],
      },
      partialFailureHandling: {
        value: 'Yes: per-node continue and error-output behaviors',
        detail:
          'Node settings support stopping the workflow, continuing, or continuing through an error output. A separate error workflow can handle a failed workflow execution.',
        shortValue: 'Per-node error routing and error workflows',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/understand-workflows/workflow-components/work-with-nodes.md',
            label: 'n8n docs: work-with-nodes',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/build/flow-logic/handle-errors-gracefully.md',
            label: 'n8n docs: handle-errors-gracefully',
            asOf: '2026-09-04',
          },
        ],
      },
      unattendedExecution: {
        value: 'Yes: production triggers run on the n8n instance',
        detail:
          'Production webhook and trigger executions are handled by the n8n server, whether managed Cloud or self-hosted. Availability depends on that server and connected services.',
        shortValue: 'Server-side Cloud or self-hosted execution',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/deploy/host-n8n/configure-n8n/scaling/control-concurrency.md',
            label: 'n8n docs: control-concurrency',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/n8n-io/n8n-docs/blob/main/docs/get-started/choose-how-to-use-n8n.md',
            label: 'n8n docs: choose-how-to-use-n8n',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value: 'Community forum and Enterprise dedicated support',
        detail:
          'Pricing lists forum support and Enterprise dedicated support. Business is described as self-serve; dedicated support requires Enterprise.',
        shortValue: 'Forum support; dedicated support on Enterprise',
        confidence: 'verified',
        sources: [
          {
            url: 'https://n8n.io/pricing/',
            label: 'n8n pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      sla: {
        value: 'Enterprise includes dedicated support with an SLA',
        detail:
          'Public pricing confirms SLA-backed support on Enterprise but does not specify a universal response-time commitment. Exact terms depend on the contract.',
        shortValue: 'Enterprise support SLA; contract-specific terms',
        confidence: 'verified',
        sources: [
          {
            url: 'https://n8n.io/pricing/',
            label: 'n8n pricing',
            asOf: '2026-09-04',
          },
        ],
      },
      community: {
        value: 'Active public template and contributor ecosystem',
        detail:
          'The vendor maintains a public workflow template directory with more than 12,000 entries. Community membership and GitHub stars are not treated as equivalent measures.',
        shortValue: 'Public templates and contributor community',
        confidence: 'verified',
        sources: [
          {
            url: 'https://n8n.io/workflows/',
            label: 'n8n workflow templates',
            asOf: '2026-09-04',
          },
        ],
      },
      companyMaturity: {
        value: 'Building since 2019; Series C and SAP investment announced',
        detail:
          'n8n announced a $180 million Series C in October 2025 and a SAP investment at a $5.2 billion valuation in May 2026. These are dated company announcements, not current employee-count estimates.',
        shortValue: 'Since 2019; Series C and SAP investment',
        confidence: 'verified',
        sources: [
          {
            url: 'https://blog.n8n.io/series-c/',
            label: 'n8n Series C announcement',
            asOf: '2026-09-04',
          },
          {
            url: 'https://blog.n8n.io/n8n-sap/',
            label: 'n8n SAP investment announcement',
            asOf: '2026-09-04',
          },
        ],
      },
      academy: {
        value: 'Yes: n8n Academy',
        detail:
          'The Academy lists Essentials, Integrations, AI/Testing/Best Practices, and Quickstart courses. Certification or badge entitlement is not inferred from the catalog.',
        shortValue: 'Official Academy with structured courses',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.n8n.io/',
            label: 'n8n Academy',
            asOf: '2026-09-04',
          },
        ],
      },
    },
  },
}
