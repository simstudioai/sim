import { MicrosoftIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Reviewed against current primary sources on 2026-09-04; unresolved claims remain qualified. */
export const powerAutomateProfile: CompetitorProfile = {
  id: 'power-automate',
  name: 'Microsoft Power Automate',
  website: 'https://www.microsoft.com/en-us/power-platform/products/power-automate',
  brand: {
    icon: MicrosoftIcon,
    colors: ['#04a4ec', '#bcbc04', '#286de8'],
    source: 'Context.dev brand-intelligence API',
    asOf: '2026-07-02',
  },
  oneLiner:
    'Microsoft Power Automate is a low-code automation service for connector-based cloud flows and Windows desktop RPA, with natural-language authoring, AI Builder prompts and integrations across Power Platform.',
  standoutFeatures: [
    {
      title: 'Cloud and desktop automation',
      description:
        'Power Automate combines connector-based cloud workflows with attended and unattended Windows desktop automation. Microsoft-hosted machines are available through the Hosted Process plan.',
      shortDescription: 'Cloud workflows and Windows RPA in one product family.',
      source: {
        url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate/pricing',
        label: 'Power Automate Pricing | Microsoft Power Platform',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Solution-based deployment',
      description:
        'Power Platform pipelines deploy solutions between environments, helping teams manage development, testing and production releases. Environment and licensing prerequisites apply.',
      shortDescription: 'Pipelines promote solutions across environments.',
      source: {
        url: 'https://learn.microsoft.com/en-us/power-platform/alm/pipelines',
        label: 'Overview of pipelines in Power Platform - Power Platform | Microsoft Learn',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Built-in approvals',
      description:
        'Start and wait for an approval pauses a run for human decisions. Supported patterns include first response, everyone must approve, custom responses and sequential approvals.',
      shortDescription: 'Approval actions pause and resume human decision workflows.',
      source: {
        url: 'https://learn.microsoft.com/en-us/power-automate/get-started-approvals',
        label: 'Get started with Power Automate approvals - Power Automate | Microsoft Learn',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Cloud-flow analytics',
      description:
        'The Power Platform admin center provides reports on runs, usage, errors, sharing and connectors. The documented analytics reports exclude solution-aware flows.',
      shortDescription: 'Admin reports cover runs, errors and connector use.',
      source: {
        url: 'https://learn.microsoft.com/en-us/power-platform/admin/analytics-flow',
        label: 'View analytics for Power Automate cloud flows - Power Platform | Microsoft Learn',
        asOf: '2026-09-04',
      },
    },
  ],
  limitations: [
    {
      title: 'Version history requires solution-aware cloud flows',
      description:
        'Drafts, publishing and version restore in the new cloud designer require a Dataverse solution. Cloud-flow version history does not provide a built-in side-by-side comparison.',
      shortDescription:
        'Cloud-flow versioning requires solutions; side-by-side comparison is unavailable.',
      source: {
        url: 'https://learn.microsoft.com/en-us/power-automate/drafts-versioning',
        label:
          'Drafts and versioning for solution-awarecloud flows - Power Automate | Microsoft Learn',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Unattended desktop automation needs additional licensing',
      description:
        'US annual-billing prices are $15 per user/month for Premium, $150 per bot/month for Process and $215 per bot/month for Hosted Process. Premium includes attended desktop automation; unattended RPA uses the higher plans.',
      shortDescription: 'Unattended RPA uses Process or Hosted Process licensing.',
      source: {
        url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate/pricing',
        label: 'Power Automate Pricing | Microsoft Power Platform',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Failure emails do not cover every failed run immediately',
      description:
        'Per-run alerts target known fixable issues and have a 28-day cooldown for the same flow. A weekly digest covers failures more broadly.',
      shortDescription: 'Per-run failure emails are selective and have a cooldown.',
      source: {
        url: 'https://learn.microsoft.com/en-us/power-automate/understand-flow-failure-notifications',
        label:
          'Understand flow failure notifications in Power Automate - Power Automate | Microsoft Learn',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Long-running flows have execution limits',
      description:
        'A cloud-flow run can last up to 30 days, including time waiting for approvals. Synchronous inbound and outbound requests have 120-second limits.',
      shortDescription: '30-day flow duration; 120-second synchronous request limits.',
      source: {
        url: 'https://learn.microsoft.com/en-us/power-automate/limits-and-config',
        label:
          'Limits of automated, scheduled, and instant flows - Power Automate | Microsoft Learn',
        asOf: '2026-09-04',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value: 'Visual cloud-flow automation, Windows desktop RPA and Copilot-assisted authoring',
        detail:
          'AI Builder adds prompt and other model actions. Copilot Studio is the related agent-building product.',
        shortValue: 'Cloud flows, desktop RPA and AI authoring',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate',
            label:
              'Power Automate: Business Process Workflow Automation | Microsoft Power Platform',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/ai-builder/use-in-flow-overview',
            label: 'AI Builder in Power Automate overview - AI Builder | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      learningCurve: {
        value:
          'Simple connector flows are accessible; desktop RPA and multi-environment deployment need additional planning',
        detail:
          'This is an editorial assessment of the visual authoring experience and the documented setup for environments and solution pipelines.',
        shortValue: 'Accessible flows; RPA and deployment add complexity',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate',
            label:
              'Power Automate: Business Process Workflow Automation | Microsoft Power Platform',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/alm/pipelines',
            label: 'Overview of pipelines in Power Platform - Power Platform | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      selfHostOption: {
        value:
          'Cloud orchestration is Microsoft-operated; desktop RPA and data gateways can run on customer machines',
        detail:
          'A local gateway connects cloud services to on-premises data; it is not a self-hosted cloud-flow engine.',
        shortValue: 'Cloud service with local RPA and gateways',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/data-integration/gateway/service-gateway-onprem',
            label: 'What is an on-premises data gateway? | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/desktop-flows/introduction',
            label: 'Introduction to desktop flows - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      deploymentOptions: {
        value:
          'Commercial cloud, eligible GCC/GCC High/DoD clouds, local desktop automation and on-premises gateways',
        detail:
          'Government eligibility and feature availability differ. Desktop flows execute on Windows machines, including Microsoft-hosted options.',
        shortValue: 'Cloud, government cloud, local RPA and gateways',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/us-govt',
            label: 'Power Automate US Government - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/desktop-flows/introduction',
            label: 'Introduction to desktop flows - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/data-integration/gateway/service-gateway-onprem',
            label: 'What is an on-premises data gateway? | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      templates: {
        value: 'Searchable cloud-flow templates for common automation scenarios',
        detail:
          'A template supplies triggers and actions that makers configure with their connections.',
        shortValue: 'Built-in template gallery',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/get-started-logic-template',
            label: 'Get started from a template - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      license: {
        value: 'Commercial Microsoft licensing, including paid and limited Free entitlements',
        detail: 'User and capacity licenses provide different connector and automation rights.',
        shortValue: 'Proprietary service with several license types',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/power-automate-licensing/types',
            label: 'Types of Power Automate licenses - Power Platform | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      environmentPromotion: {
        value: 'Solutions and Power Platform pipelines support deployment between environments',
        detail:
          'Connection references and environment variables support environment-specific configuration. Pipeline licensing and environment prerequisites apply.',
        shortValue: 'Solution export/import and pipelines',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/export-flow-solution',
            label: 'Export a solution - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/alm/pipelines',
            label: 'Overview of pipelines in Power Platform - Power Platform | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Cloud-flow draft history and restore; desktop flows also support version comparison',
        detail:
          'Cloud drafts and versioning require solution-aware flows in the new designer. That cloud-flow view lacks side-by-side comparison; desktop-flow version control has separate rollout and environment requirements.',
        shortValue: 'Cloud history/restore; desktop version comparison',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/drafts-versioning',
            label:
              'Drafts and versioning for solution-awarecloud flows - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/desktop-flows/version-control',
            label:
              'Version control in Power Automate for desktop - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      realtimeCollaboration: {
        value: 'Flows support co-owners; synchronized concurrent canvas editing is not confirmed',
        detail:
          'Sharing lets co-owners edit and manage a flow. The reviewed sharing documentation does not establish live cursors or merged simultaneous edits.',
        shortValue: 'Co-ownership; live editing unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/create-team-flows',
            label: 'Share a cloud flow - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      nativeFileStorage: {
        value:
          'Connector-based file operations are documented; a native folder/share/recycle-bin workspace is not confirmed',
        detail:
          'SharePoint actions operate on SharePoint files and folders. Those storage features belong to the connected service.',
        shortValue: 'File connectors; native file manager unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/desktop-flows/actions-reference/sharepoint',
            label: 'SharePoint - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      dataTables: {
        value: 'Dataverse supplies structured tables in the shared Power Platform',
        detail:
          'Dataverse provides rows, columns, relationships, security and Excel integration. Capacity depends on licensing; this is not evidence of a spreadsheet workspace in the flow designer.',
        shortValue: 'Dataverse tables and storage entitlements',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-apps/maker/data-platform/data-platform-intro',
            label: 'What is Microsoft Dataverse? - Power Apps | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate/pricing',
            label: 'Power Automate Pricing | Microsoft Power Platform',
            asOf: '2026-09-04',
          },
        ],
      },
      richTextEditor: {
        value: 'An inline rich-text document workspace is not confirmed',
        detail:
          'The reviewed product documentation establishes automation authoring, not a general WYSIWYG document editor.',
        shortValue: 'Document editor unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate',
            label:
              'Power Automate: Business Process Workflow Automation | Microsoft Power Platform',
            asOf: '2026-09-04',
          },
        ],
      },
      subWorkflows: {
        value: 'Run a Child Flow calls reusable flows within a solution',
        detail:
          'Parent and child flows must be created in the same solution; the child uses a manual trigger and can return outputs to its parent.',
        shortValue: 'Child flows within solutions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/create-child-flows',
            label: 'Create child Flows - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      customBlocks: {
        value: 'Child flows and custom connector actions provide reusable operations',
        detail:
          'Custom connectors define API actions; child flows compose saved flows. A publish-any-flow-to-the-block-toolbar interface is not confirmed by these sources.',
        shortValue: 'Child flows and custom connector actions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/create-child-flows',
            label: 'Create child Flows - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/connectors/custom-connectors/define-openapi-definition',
            label: 'Create a custom connector from an OpenAPI definition | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value: 'AI Builder prompts can connect to supported Azure AI Foundry models',
        detail:
          'Microsoft explicitly includes Power Automate in this capability. Supported chat-completion endpoints and model exclusions apply; Copilot Studio’s agent-model picker is a separate surface.',
        shortValue: 'Multiple models through Foundry prompt connections',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/bring-your-own-model-prompts',
            label:
              'Bring your own model for your prompts - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          'AI prompt actions are available; dynamic agent orchestration is documented in related Copilot Studio',
        detail:
          'Power Automate can run prompt actions. Do not treat Copilot Studio’s generative planner as a native capability of every cloud-flow step.',
        shortValue: 'Prompt actions; agent orchestration via Copilot Studio',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/ai-builder/use-a-custom-prompt-in-flow',
            label: 'Use your prompt in Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/generative-orchestration',
            label:
              'Apply generative orchestration capabilities - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      naturalLanguageBuilding: {
        value: 'Copilot helps create, edit and extend flows using natural language',
        detail: 'The official product page documents AI-assisted authoring for automation.',
        shortValue: 'Natural-language flow authoring',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate',
            label:
              'Power Automate: Business Process Workflow Automation | Microsoft Power Platform',
            asOf: '2026-09-04',
          },
        ],
      },
      knowledgeBaseRag: {
        value: 'Prompts can use Dataverse and supported connector data',
        detail:
          'The prompt-data documentation supports Dataverse and selected external tables; connector-based prompt data is scoped to Power Automate. This does not establish a separate native document-vector database.',
        shortValue: 'Data-grounded prompts',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/ai-builder/use-your-own-prompt-data',
            label: 'Add knowledge to your prompt - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpSupport: {
        value:
          'Process Mining exposes an MCP server in preview; Copilot Studio can consume MCP tools',
        detail:
          'The Process Mining server exposes analytics for ingested processes and needs a Process Mining license. General MCP-client behavior for arbitrary cloud-flow steps is not confirmed.',
        shortValue: 'Process Mining MCP preview; agent integration',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/process-mining-mcp-server-reference',
            label:
              'Process Mining Model Context Protocol (MCP) server reference (preview) - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent',
            label:
              'Connect your agent to an existing Model Context Protocol (MCP) server - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      evaluationGuardrails: {
        value: 'A flow-wide LLM evaluation and guardrail suite is not confirmed',
        detail:
          'AI Builder prompt actions and separate Copilot Studio evaluation tools should not be conflated with a dedicated Power Automate flow evaluation framework.',
        shortValue: 'Flow-wide AI evaluations unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/ai-builder/use-a-custom-prompt-in-flow',
            label: 'Use your prompt in Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      humanInTheLoop: {
        value: 'Start and wait for an approval pauses a flow for human decisions',
        detail:
          'Supports first response, all approvers, custom responses and sequential approvals. Responses can come through Outlook, Teams or the Power Automate action center.',
        shortValue: 'Built-in approval waits',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/get-started-approvals',
            label: 'Get started with Power Automate approvals - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      generativeMedia: {
        value:
          'AI Builder offers text generation and image description; a native image/video/audio generation suite is not confirmed',
        detail:
          'The AI Builder catalog documents prompt and image-description actions. Media-generating integrations need separate verification of the chosen provider and connector.',
        shortValue: 'Text generation; broader media generation unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/ai-builder/use-in-flow-overview',
            label: 'AI Builder in Power Automate overview - AI Builder | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      dynamicToolUse: {
        value:
          'Dynamic tool selection is documented for related Copilot Studio agents; native flow-wide selection is not confirmed',
        detail:
          'Ordinary cloud flows specify triggers and actions. Copilot Studio can select among capabilities configured on an agent.',
        shortValue: 'Agent-level selection via Copilot Studio',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/overview-cloud',
            label: 'Overview of cloud flows - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/generative-orchestration',
            label:
              'Apply generative orchestration capabilities - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      modelFallback: {
        value: 'Automatic cross-model fallback for Power Automate prompt actions is not confirmed',
        detail:
          'Copilot Studio documents a default-model fallback for its agent picker; that is not evidence of the same behavior for Power Automate prompt actions.',
        shortValue: 'Prompt-model fallback unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/ai-builder/use-a-custom-prompt-in-flow',
            label: 'Use your prompt in Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      agentSkills: {
        value:
          'Copilot Studio offers reusable Markdown skills; native Power Automate skill files are not confirmed',
        detail:
          'The skills documentation applies to Copilot Studio’s new agent experience, not directly to cloud-flow authoring.',
        shortValue: 'Skills belong to related Copilot Studio',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-experience/skills-overview',
            label:
              'Skills overview for agents - Microsoft Copilot Studio (GitHub Copilot) | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      nativeChatDeployment: {
        value: 'Chat deployment is available through a connected Copilot Studio agent',
        detail:
          'Copilot Studio publishes web and Microsoft chat channels and can call a flow as a tool. A flow itself is not established as a standalone native chat deployment.',
        shortValue: 'Chat through Copilot Studio integration',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/publication-fundamentals-publish-channels',
            label:
              'Key concepts - Publish and deploy your agent - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/flow-agent',
            label:
              'Add an agent flow as a tool to an agent - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      kbChunkVisibility: {
        value: 'A native raw knowledge-chunk inspector for Power Automate prompts is not confirmed',
        detail:
          'The prompt-data source documents table and field grounding, not a chunk-index/content debugging view.',
        shortValue: 'Raw chunk inspection unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/ai-builder/use-your-own-prompt-data',
            label: 'Add knowledge to your prompt - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      parallelExecution: {
        value: 'Cloud flows support concurrent parallel branches',
        detail:
          'Branches execute concurrently and the flow proceeds after their completion, subject to flow and connector limits.',
        shortValue: 'Native parallel branches',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/guidance/coding-guidelines/implement-parallel-execution',
            label:
              'Optimize flows with parallel execution and concurrency - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      a2aProtocol: {
        value:
          'Copilot Studio supports outbound A2A; native Power Automate A2A publishing or orchestration is not confirmed',
        detail:
          'The cited A2A connector belongs to Copilot Studio agents. It does not establish native A2A support for an arbitrary cloud flow.',
        shortValue: 'A2A through related Copilot Studio',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/add-agent-agent-to-agent',
            label:
              'Connect to an agent over the Agent2Agent (A2A) protocol - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      loopIteration: {
        value: 'Apply to each iterates collections; Until repeats until a condition is met',
        detail:
          'Loop iteration and concurrency limits depend on the flow’s performance profile and settings.',
        shortValue: 'For-each and until loops',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/apply-to-each',
            label:
              'Use the Apply to each action to process a list of items periodically - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/limits-and-config',
            label:
              'Limits of automated, scheduled, and instant flows - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value: 'More than 1,000 API connectors advertised on the current product page',
        detail:
          'This is Microsoft’s published lower bound, not an independently counted catalog total. Connector availability and licensing vary.',
        shortValue: '1,000+ API connectors',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate',
            label:
              'Power Automate: Business Process Workflow Automation | Microsoft Power Platform',
            asOf: '2026-09-04',
          },
        ],
      },
      triggerTypes: {
        value: 'Automated connector events, schedules, instant/manual triggers and HTTP requests',
        detail:
          'HTTP request triggers can restrict callers using Microsoft Entra authentication; behavior depends on the configured trigger.',
        shortValue: 'Event, scheduled, manual and HTTP triggers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/triggers-introduction',
            label: 'Triggers - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/oauth-authentication',
            label:
              'Add OAuth authentication for HTTP request triggers - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      customCodeSteps: {
        value:
          'Custom connectors can transform requests with C#; desktop flows provide scripting actions',
        detail:
          'Custom connectors also wrap external APIs. Desktop scripting runs on its Windows host and includes PowerShell, Python and other supported actions.',
        shortValue: 'Connector C# and desktop scripting',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/connectors/custom-connectors/write-code',
            label: 'Write code in a custom connector | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/desktop-flows/actions-reference/scripting',
            label: 'Scripting actions reference - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      codeSandboxRuntime: {
        value:
          'Cloud custom-connector code uses a restricted .NET runtime; desktop scripting uses a Windows machine',
        detail:
          'Microsoft enumerates supported C# namespaces. Desktop scripting supports external module or assembly paths, but this is different from configuring a hosted cloud-flow sandbox image.',
        shortValue: 'Restricted connector runtime; local desktop dependencies',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/connectors/custom-connectors/write-code',
            label: 'Write code in a custom connector | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/desktop-flows/actions-reference/scripting',
            label: 'Scripting actions reference - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      apiPublishing: {
        value: 'An HTTP request trigger exposes a callable flow endpoint',
        detail:
          'Microsoft documents caller authentication scopes for the HTTP trigger; access should be configured for the intended callers.',
        shortValue: 'HTTP-triggered endpoints',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/oauth-authentication',
            label:
              'Add OAuth authentication for HTTP request triggers - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      extensibilitySdk: {
        value: 'OpenAPI custom connectors and the public PowerPlatformConnectors repository',
        detail:
          'Developers define API operations and can submit connector definitions for Microsoft certification.',
        shortValue: 'Custom connectors and certification submissions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/connectors/custom-connectors/define-openapi-definition',
            label: 'Create a custom connector from an OpenAPI definition | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/microsoft/PowerPlatformConnectors',
            label:
              'GitHub - microsoft/PowerPlatformConnectors: This is a repository for Microsoft Power Automate, Power Apps, and Azure Logic Apps connectors · GitHub',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpPublishing: {
        value:
          'A Process Mining MCP server exists in preview; arbitrary flow-to-MCP publishing is not confirmed',
        detail:
          'The documented server exposes process discovery and analytics tools, not a user-defined flow as an MCP endpoint.',
        shortValue: 'Analytics MCP preview; flow publishing unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/process-mining-mcp-server-reference',
            label:
              'Process Mining Model Context Protocol (MCP) server reference (preview) - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value: 'User and capacity licensing, with annual-billing subscription prices',
        detail:
          'Premium is licensed per user. Process can be assigned to eligible cloud flows or machines; Hosted Process adds Microsoft-hosted machine capacity.',
        shortValue: 'Per-user and capacity plans',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate/pricing',
            label: 'Power Automate Pricing | Microsoft Power Platform',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/power-automate-licensing/types',
            label: 'Types of Power Automate licenses - Power Platform | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      entryPaidPlan: {
        value: 'US list price: Premium $15 per user/month, paid yearly',
        detail:
          'The pricing page also lists Process at $150 per bot/month and Hosted Process at $215 per bot/month, paid yearly. Currency, region, terms and checkout prices can differ.',
        shortValue: '$15/user/month, paid yearly',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate/pricing',
            label: 'Power Automate Pricing | Microsoft Power Platform',
            asOf: '2026-09-04',
          },
        ],
      },
      freeTier: {
        value:
          'Power Automate Free supports standard-connector cloud flows without sharing and local attended desktop flows',
        detail:
          'The Free license is available for work or school accounts in an Entra tenant. Paid entitlements are required for premium capabilities; trial terms vary by signup route.',
        shortValue: 'Free: standard connectors and local attended RPA',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/power-automate-licensing/types',
            label: 'Types of Power Automate licenses - Power Platform | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      byok: {
        value:
          'Azure OpenAI connector accepts customer API keys; supported Foundry models can also connect to prompts',
        detail:
          'The Azure OpenAI connector uses a customer resource name and API key and requires premium connector access. These connections do not replace platform licensing or provider charges.',
        shortValue: 'Azure OpenAI keys and Foundry model connections',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/connectors/azureopenai/',
            label: 'Azure OpenAI - Connectors | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/bring-your-own-model-prompts',
            label:
              'Bring your own model for your prompts - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    security: {
      dataResidency: {
        value:
          'Power Platform environments have a selected geography; AI and connected services can have separate processing locations',
        detail:
          'Environment location is visible in the admin center. Generative AI data movement depends on regional availability and configured consent; external connector data follows its service’s terms.',
        shortValue: 'Regional environments with processing exceptions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/regions-overview',
            label:
              'Choose the region when setting up an environment - Power Platform | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/geographical-availability-copilot',
            label:
              'Move data across regions for Copilots, AI agents, and generative AI features - Power Platform | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      rbac: {
        value: 'Environment roles, flow co-ownership/run-only access and Dataverse data roles',
        detail:
          'Run-only users can execute shared instant flows without editing them; Dataverse data access requires its own permissions.',
        shortValue: 'Environment, flow and data permissions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/guide-to-cloud-flow-sharing-permissions',
            label: 'Guide to cloud flow sharing and permissions - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      auditLogging: {
        value: 'Microsoft Purview logs cloud-flow lifecycle and permission changes',
        detail:
          'Microsoft documents creation, edits, deletion and permission events. Runtime runs and action details use run records, analytics or Application Insights; desktop auditing is in Dataverse.',
        shortValue: 'Purview cloud-flow audit logs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/activity-logging-auditing/activity-logs-power-automate',
            label:
              'View Power Automate activity logs in Microsoft Purview - Power Platform | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      compliance: {
        value:
          'Power Automate is named in Microsoft SOC 2 Type 2 scope; eligible government service is within the Azure Government FedRAMP ATO; Microsoft lists commercial HIPAA/HITECH coverage',
        detail:
          'SOC documentation includes Power Automate in Commercial, GCC and GCC High lists. HIPAA coverage is contractual BAA coverage, not a certification. Confirm the applicable service, cloud, agreement and current assurance report.',
        shortValue: 'Scoped SOC 2, FedRAMP and HIPAA coverage',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/compliance/regulatory/offering-soc-2',
            label:
              'System and Organization Controls (SOC) 2 Type 2 - Microsoft Compliance | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/us-govt',
            label: 'Power Automate US Government - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/compliance/regulatory/offering-hipaa-hitech',
            label:
              'Health Insurance Portability and Accountability Act (HIPAA) & Health Information Technology for Economic and Clinical Health (HITECH) Act - Microsoft Compliance | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      modelAndToolGovernance: {
        value:
          'Power Platform data policies govern connectors, including custom connector classification',
        detail:
          'Policies can block connectors and govern which connectors may be used together. Foundry prompt connections also support connector governance; a universal per-role model allowlist is not established.',
        shortValue: 'Connector policies and custom connector controls',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/wp-data-loss-prevention',
            label: 'Data policies - Power Platform | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/dlp-connector-classification',
            label: 'Connector classification - Power Platform | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/bring-your-own-model-prompts',
            label:
              'Bring your own model for your prompts - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      credentialGovernance: {
        value:
          'Flow owners control embedded connections and run-only users’ connection requirements',
        detail:
          'Owners can require run-only users to provide their own connection or use one defined in the flow. Shared connections are scoped to the flow; a role-based allowlist for every stored credential is not confirmed.',
        shortValue: 'Embedded versus user-provided connections',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/create-team-flows',
            label: 'Share a cloud flow - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      whiteLabeling: {
        value: 'Rebranding the Power Automate authoring workspace is not confirmed',
        detail:
          'The reviewed product sources do not establish a native workspace branding-removal option. Branding in separate Power Pages or custom applications is outside this claim.',
        shortValue: 'Workspace white-labeling unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate',
            label:
              'Power Automate: Business Process Workflow Automation | Microsoft Power Platform',
            asOf: '2026-09-04',
          },
        ],
      },
      dataRetention: {
        value: 'Dataverse cloud-flow run-record retention is configurable',
        detail:
          'The default is 28 days. Admin UI presets include 14 days, 7 days and disabled; a Dataverse setting supports other durations. This applies to eligible stored run records, not every log store.',
        shortValue: 'Configurable Dataverse run-record retention',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/dataverse/cloud-flow-run-metadata',
            label: 'Manage cloud flow run history in Dataverse - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      piiRedaction: {
        value: 'Automatic platform-wide PII redaction for flow inputs and logs is not confirmed',
        detail:
          'Connector data policies govern service use; they should not be described as content redaction. Microsoft 365 Copilot’s Purview protections do not establish native Power Automate log redaction.',
        shortValue: 'Automatic PII redaction unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/wp-data-loss-prevention',
            label: 'Data policies - Power Platform | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      sso: {
        value: 'Work or school Microsoft identity, with environment and licensing permissions',
        detail:
          'Power Automate requires a work or school account for cloud flows. Account authentication alone does not grant every environment, data or premium-feature permission.',
        shortValue: 'Microsoft organizational sign-in',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/sign-up-sign-in',
            label: 'Sign up and sign in - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/guide-to-cloud-flow-sharing-permissions',
            label: 'Guide to cloud flow sharing and permissions - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      sessionPolicy: {
        value:
          'Entra Conditional Access offers reauthentication controls; maker-portal inactivity enforcement is not confirmed',
        detail:
          'Sign-in frequency and browser-session policy depend on Entra configuration. Dataverse customer-engagement app timeouts should not be assumed to cover the Power Automate portal.',
        shortValue: 'Identity-layer sign-in controls',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-session-lifetime',
            label:
              'Conditional Access adaptive session lifetime policies - Microsoft Entra ID | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      thirdPartyVetting: {
        value:
          'Public connector certification includes Microsoft review; custom connectors are separately governed',
        detail:
          'Organizations can create custom connectors without public certification. Microsoft documents environment classification and tenant URL patterns for governing them.',
        shortValue: 'Certified catalog and custom connectors',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/connectors/custom-connectors/submit-certification',
            label: 'Get your connector certified - Overview | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/dlp-connector-classification',
            label: 'Connector classification - Power Platform | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Run history exposes action results and errors; admin analytics aggregates flow activity',
        detail:
          'Action inputs and outputs help diagnose failures. The cited admin analytics reports exclude solution-aware flows; permissions and configuration affect visibility.',
        shortValue: 'Action-level run history and admin analytics',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/fix-flow-failures',
            label: 'Troubleshoot a cloud flow - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/analytics-flow',
            label:
              'View analytics for Power Automate cloud flows - Power Platform | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      durabilityModel: {
        value: 'Action retries and resubmission of supported historical runs',
        detail:
          'Retry policies support fixed or exponential intervals. Resubmission executes a flow again and can repeat side effects; it is not checkpoint restoration.',
        shortValue: 'Retries and run resubmission',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/guidance/coding-guidelines/error-handling',
            label: 'Employ robust error handling - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/how-tos-bulk-resubmit',
            label:
              'Cancel or resubmit flow runs in bulk in Power Automate - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      failureAlerting: {
        value: 'Selective per-run failure emails and a weekly failure digest',
        detail:
          'Per-run emails cover known fixable failures and use a 28-day cooldown per flow. Owners and co-owners receive those alerts; admins should use monitoring views.',
        shortValue: 'Failure emails and weekly digest',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/understand-flow-failure-notifications',
            label:
              'Understand flow failure notifications in Power Automate - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      dataDrains: {
        value:
          'Audit events can be retrieved through the Office 365 Management API; runtime monitoring supports Application Insights',
        detail:
          'Audit export covers lifecycle and permission events. Application Insights runtime monitoring is documented for managed environments and requires configuration.',
        shortValue: 'Audit API and Application Insights integration',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/activity-logging-auditing/activity-logs-power-automate',
            label:
              'View Power Automate activity logs in Microsoft Purview - Power Platform | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      asyncExecution: {
        value: 'Flows can use asynchronous responses with HTTP 202 and a status URL',
        detail:
          'Enable asynchronous response on an appropriate Response action so a caller can check completion without blocking.',
        shortValue: 'Asynchronous response and status polling',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/guidance/coding-guidelines/asychronous-flow-pattern',
            label: 'Use asynchronous responses - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      executionLimits: {
        value: 'Cloud runs can last 30 days; synchronous requests have 120-second limits',
        detail:
          'Trigger concurrency is unlimited when its control is off, subject to other service limits. When enabled, the setting allows 1–100 concurrent runs and defaults to 25.',
        shortValue: '30-day runs; 120-second synchronous requests',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/limits-and-config',
            label:
              'Limits of automated, scheduled, and instant flows - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      partialFailureHandling: {
        value: 'Run-after conditions and scopes support recovery paths after failed actions',
        detail:
          'An action can run after failure, timeout, skip or success, allowing notification, logging or other recovery logic.',
        shortValue: 'Error branches and try/catch-style scopes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/guidance/coding-guidelines/error-handling',
            label: 'Employ robust error handling - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      unattendedExecution: {
        value:
          'Cloud flows run on schedules or events; unattended desktop flows require an available Windows machine',
        detail:
          'Unattended desktop runs require suitable licensing and machine availability. Microsoft-hosted machines are a separate plan; desktop session restrictions still apply.',
        shortValue: 'Server-side cloud flows; machine-based unattended RPA',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/overview-cloud',
            label: 'Overview of cloud flows - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/desktop-flows/run-unattended-desktop-flows',
            label: 'Run unattended desktop flows - Power Automate | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate/pricing',
            label: 'Power Automate Pricing | Microsoft Power Platform',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value: 'Microsoft Learn, community resources and Microsoft technical support',
        detail:
          'Support scope and initial response depend on the purchase agreement, plan and severity. Advisory and account-management services are plan-dependent.',
        shortValue: 'Documentation, community and paid support',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/support-overview',
            label:
              'Support for Microsoft Power Platform and Dynamics 365 apps - Power Platform | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/get-help-support',
            label:
              'Get support in the Power Platform admin center - Power Platform | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      sla: {
        value: 'The applicable contractual uptime commitment was not independently confirmed',
        detail:
          'Microsoft publishes Online Services SLA documents. Confirm the purchased service and applicable agreement rather than assuming a Microsoft-wide uptime percentage or claiming no SLA exists.',
        shortValue: 'Contract-specific SLA unconfirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://www.microsoft.com/licensing/docs/view/Service-Level-Agreements-SLA-for-Online-Services?lang=1',
            label: 'Licensing Documents',
            asOf: '2026-09-04',
          },
        ],
      },
      community: {
        value: 'Microsoft-hosted Power Platform community and self-help resources',
        detail:
          'Microsoft’s support guidance directs customers to product communities and other self-help resources; no unverified membership or activity total is quoted.',
        shortValue: 'Power Platform community',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/get-help-support',
            label:
              'Get support in the Power Platform admin center - Power Platform | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
      companyMaturity: {
        value: 'A Microsoft product within the established Power Platform portfolio',
        detail:
          'Microsoft provides product licensing, documentation and support through its broader Power Platform portfolio.',
        shortValue: 'Microsoft-backed Power Platform product',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate',
            label:
              'Power Automate: Business Process Workflow Automation | Microsoft Power Platform',
            asOf: '2026-09-04',
          },
        ],
      },
      academy: {
        value: 'Microsoft Learn provides structured Power Platform training and certifications',
        detail:
          'The Power Platform Fundamentals credential provides a formal learning and certification path; product-specific learning content supplements it.',
        shortValue: 'Microsoft Learn training and certifications',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/credentials/certifications/power-platform-fundamentals/',
            label:
              'Microsoft Certified: Power Platform Fundamentals - Certifications | Microsoft Learn',
            asOf: '2026-09-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/training/powerplatform/power-automate',
            label: 'Power Automate on Microsoft Learn | Microsoft Learn',
            asOf: '2026-09-04',
          },
        ],
      },
    },
  },
}
