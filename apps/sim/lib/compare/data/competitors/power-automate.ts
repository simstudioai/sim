import { MicrosoftIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Researched and cross-verified against live vendor sources on 2026-07-02. */
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
    'Microsoft Power Automate is a low-code cloud automation service in the Power Platform. It builds cloud flows (connector-based triggers/actions), desktop flows (RPA), and AI-assisted/agentic workflows using 1,400+ connectors and Copilot/AI Builder.',
  standoutFeatures: [
    {
      title: 'Native Microsoft 365/Dataverse RPA + cloud flow combination',
      description:
        'Power Automate combines attended/unattended desktop RPA (legacy app automation) with cloud connector flows and Dataverse-grounded agents in one licensed product family, automating a legacy desktop app and a modern SaaS API on the same platform.',
      shortDescription: 'Combines desktop RPA and cloud connector flows in one licensed platform.',
      source: {
        url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate',
        label: 'Power Automate product page',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Solutions-based ALM with managed/unmanaged packages and pipelines',
      description:
        'Flows package into Dataverse Solutions (managed vs. unmanaged) and promote from dev to test to production via Power Platform Pipelines, with environment variables swapping per-environment references. The promotion is tied to Dataverse as a shared enterprise data platform, with centralized admin governance over which environments a solution can move into.',
      shortDescription:
        'Flows promote dev to test to production via Dataverse Solutions and Pipelines.',
      source: {
        url: 'https://learn.microsoft.com/en-us/power-automate/export-flow-solution',
        label: 'Export a solution - Power Automate | Microsoft Learn',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'MCP support in Copilot Studio agents',
      description:
        'Copilot Studio agents (the agent-building surface adjacent to Power Automate) can connect to external Model Context Protocol servers and add their tools/resources to an agent. This is consumption only: there is no feature that publishes a Power Automate flow itself as an MCP server for external AI clients to call.',
      shortDescription: 'Agents can connect to external MCP servers as tools, consumption only.',
      source: {
        url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent',
        label: 'Connect your agent to an existing MCP server - Microsoft Learn',
        asOf: '2026-07-04',
      },
    },
    {
      title: 'Tenant-wide admin gating with automatic model fallback in Copilot Studio',
      description:
        'Copilot Studio lets admins enable or restrict which models (including Anthropic Claude Sonnet 4 and Opus 4.1 alongside OpenAI GPT models) are available tenant-wide from the Microsoft 365 Admin Center, and agents automatically fall back to the default OpenAI GPT-4o model if their selected model is disabled, with no additional configuration required.',
      shortDescription:
        'Admins gate model access tenant-wide, with automatic fallback to the default model.',
      source: {
        url: 'https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/anthropic-joins-the-multi-model-lineup-in-microsoft-copilot-studio/',
        label: 'Anthropic joins the multi-model lineup in Microsoft Copilot Studio',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Built-in per-run analytics dashboard and proactive failure alerting',
      description:
        'Each flow has an Analytics dashboard (run counts, success/failure rate, average execution time, 30-day rolling history) plus automatic per-run failure alert emails and a weekly failure digest, without needing a third-party observability tool.',
      shortDescription:
        'Native run analytics and automatic failure alert emails, no third-party tool needed.',
      source: {
        url: 'https://learn.microsoft.com/en-us/power-automate/understand-flow-failure-notifications',
        label: 'Understand flow failure notifications - Power Automate | Microsoft Learn',
        asOf: '2026-07-02',
      },
    },
  ],
  limitations: [
    {
      title: 'No live, concurrent multi-user editing in the flow designer',
      description:
        "Power Automate's cloud flow designer supports sharing a flow with co-owners and commenting on steps, but not live, concurrent multi-user editing with visible cursors and synced changes on the same flow. Microsoft's live coauthoring feature exists for Power Apps Studio canvas apps, a separate product, not the Power Automate flow designer.",
      shortDescription: 'No true live co-editing in the flow designer, only sharing and comments.',
      source: {
        url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate',
        label: 'Power Automate product page',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'No dedicated built-in image/video/audio generation blocks',
      description:
        'AI Builder ships prebuilt models for document processing, prediction, image description (captioning), and GPT-based text/prompt generation, but no dedicated image-generation, video-generation, or text-to-speech/speech-to-text action exists in its catalog. Image and audio generation require calling external connectors like Azure OpenAI DALL-E or Azure AI Speech rather than a first-party AI Builder block.',
      shortDescription: 'Image and audio generation require calling an external connector.',
      source: {
        url: 'https://learn.microsoft.com/en-us/ai-builder/use-in-flow-overview',
        label: 'AI Builder in Power Automate overview - Microsoft Learn',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Solution-aware versioning/ALM features gated to Dataverse solutions',
      description:
        "Version history, environment promotion via pipelines, and environment variables only apply to 'solution-aware' cloud flows inside a Dataverse solution. Flows created outside a solution (a common default for individual makers) lack this ALM tooling.",
      shortDescription:
        'Version history and environment promotion only work inside a Dataverse solution.',
      source: {
        url: 'https://learn.microsoft.com/en-us/power-automate/drafts-versioning',
        label:
          'Drafts and versioning for solution-aware cloud flows - Power Automate | Microsoft Learn',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Pricing is per-user/per-bot with a steep jump to unattended RPA',
      description:
        'Premium (per-user cloud/attended RPA) is $15/user/month, but unattended desktop RPA (Process plan) jumps to $150/bot/month, and Microsoft-hosted unattended bots cost $215/bot/month, a much higher cost tier for any fully automated scenario with no human at the desktop.',
      shortDescription:
        'Unattended RPA jumps to $150-$215 per bot/month, well above the base plan.',
      source: {
        url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate/pricing',
        label: 'Power Automate pricing page',
        asOf: '2026-07-02',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'Low-code visual flow builder (trigger/action steps) for cloud flows, a desktop recorder for RPA (desktop flows), Copilot natural-language flow authoring, and AI Builder for embedded AI models. Copilot Studio, a related product, covers conversational/autonomous agent building.',
        detail:
          'Cloud flows are built visually with connectors; desktop flows are recorded/RPA-based; Copilot can draft flows from natural language descriptions.',
        shortValue: 'Visual canvas, desktop RPA recorder, Copilot NL, AI Builder',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate',
            label: 'Power Automate product page',
            asOf: '2026-07-02',
          },
        ],
      },
      learningCurve: {
        value:
          'Low for single connector-to-connector flows; steep for solutions, environments, ALM pipelines, and desktop-flow RPA at scale',
        detail:
          'Accessible to non-developer makers for simple flows, but production-grade multi-environment deployment (solutions, managed/unmanaged packages, pipelines, environment variables) requires dedicated admin/ALM training.',
        shortValue: 'Easy for simple flows, steep for ALM/RPA at scale',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate',
            label: 'Power Automate product page',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.matthewdevaney.com/the-complete-power-platform-pipelines-alm-setup-guide/create-power-platform-environments-for-dev-test-prod/',
            label: 'The Complete Power Platform Pipelines ALM Setup Guide',
            asOf: '2026-07-02',
          },
        ],
      },
      selfHostOption: {
        value:
          'The core cloud-flow service cannot be self-hosted. Only the on-premises data gateway and attended/unattended desktop-flow (RPA) runtime execute on customer-managed Windows machines.',
        detail:
          "Power Automate's orchestration/cloud-flow engine is a Microsoft-operated multi-tenant cloud service (with Azure Government/GCC/GCC High/DoD sovereign variants); there is no on-prem deployment of that engine.",
        shortValue: 'No: only the data gateway and RPA runtime run locally',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/data-integration/gateway/service-gateway-onprem',
            label: 'What is an on-premises data gateway? - Microsoft Learn',
            asOf: '2026-07-04',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/desktop-flows/introduction',
            label: 'Introduction to desktop flows - Power Automate | Microsoft Learn',
            asOf: '2026-07-04',
          },
        ],
      },
      deploymentOptions: {
        value:
          'Commercial multi-tenant cloud; Office 365 GCC, GCC High, and DoD sovereign/government cloud environments; on-prem gateway and desktop-flow runtime for local systems',
        detail:
          "Microsoft's SOC 2 compliance documentation lists Commercial/GCC/GCC High/DoD as in-scope environments for Power Apps/Power Automate.",
        shortValue: 'Commercial cloud plus GCC/GCC High/DoD government clouds',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/compliance/regulatory/offering-soc-2',
            label: 'SOC 2 Type 2 - Microsoft Compliance | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      templates: {
        value:
          'Large built-in template gallery for common connector-to-connector automations (approvals, notifications, file sync) accessible from the flow creation screen',
        detail:
          'Templates surface directly on the flow creation screen for common automation patterns.',
        shortValue: 'Large built-in template gallery',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate',
            label: 'Power Automate product page',
            asOf: '2026-07-02',
          },
        ],
      },
      license: {
        value: 'Proprietary, commercial SaaS, not open source',
        detail:
          'Power Automate is a licensed Microsoft commercial cloud product sold via per-user/per-bot subscription plans; no open-source licensing model exists.',
        shortValue: 'Proprietary commercial SaaS',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate/pricing',
            label: 'Power Automate pricing page',
            asOf: '2026-07-02',
          },
        ],
      },
      environmentPromotion: {
        value:
          'Yes: full dev/test/prod environment promotion exists via Dataverse Solutions (managed vs. unmanaged) exported/imported between environments, plus Power Platform Pipelines for automated promotion and environment variables for per-environment config swaps',
        detail:
          'A Solution bundles flows, tables, connectors, and other assets; unmanaged solutions are used in development, managed solutions are locked down for test/production, and Pipelines automate the import chain across environments.',
        shortValue: 'Dataverse Solutions + Pipelines for dev/test/prod',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/export-flow-solution',
            label: 'Export a solution - Power Automate | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.matthewdevaney.com/the-complete-power-platform-pipelines-alm-setup-guide/deploy-a-solution-to-the-production-environment/',
            label: 'Deploy A Solution To The Production Environment - Matthew Devaney',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-apps/maker/data-platform/environmentvariables',
            label: 'Use environment variables in Power Platform solutions - Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Server-persisted version history with restore, for solution-aware cloud flows only; no native visual diff/compare between versions; no explicit undo/redo in the flow editor; no branching model',
        detail:
          'The Version History panel lists timestamped snapshots and lets a user preview/restore a prior version as a new draft; desktop flows have a separate read-only version-comparison view. There is no branch-and-merge version control or in-editor undo/redo stack for cloud flows.',
        shortValue: 'Version history with restore, no diff view, no branching',
        confidence: 'verified',
        sources: [
          {
            url: 'https://sharepains.com/2024/04/26/version-history-in-power-automate-flows/',
            label: 'Version history in Power Automate flows',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/drafts-versioning',
            label: 'Drafts and versioning for solution-aware cloud flows - Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/desktop-flows/version-control',
            label: 'Version control in Power Automate for desktop - Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          "No: Power Automate's cloud flow designer supports sharing a flow with co-owners and commenting on steps, but not live, concurrent multi-user editing with visible cursors and synced changes on the same flow. Microsoft's live coauthoring feature (visible cursors, simultaneous editing) exists for Power Apps Studio canvas apps, a separate product, not the Power Automate flow designer.",
        detail:
          'Power Automate flows are shared/co-owned (sequential editing, comments). Power Apps Studio, a different Power Platform product, has live coauthoring with cursors, but this is not documented for the Power Automate cloud flow designer itself.',
        shortValue: 'No true live co-editing in flow designer',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/create-team-flows',
            label: 'Share a cloud flow - Power Automate | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.microsoft.com/en-us/power-platform/blog/power-apps/build-apps-as-a-team-with-live-coauthoring/',
            label:
              'Build apps as a team with live coauthoring - Power Platform Blog (Power Apps Studio, not Power Automate)',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeFileStorage: {
        value:
          "No: Power Automate has no file storage system of its own, no folder hierarchy, link-sharing, or recycle bin built into the product. File handling goes entirely through connectors to external services like SharePoint, OneDrive, or Dataverse, so those services' own sharing and recycle-bin features apply, not a Power Automate-native store.",
        detail:
          "File paths/links used in flows must point to an external SharePoint/OneDrive location; sharing-link mistakes are a documented common error, since there's no first-party file store inside Power Automate.",
        shortValue: 'No native file store, relies on SharePoint/OneDrive connectors',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/desktop-flows/actions-reference/sharepoint',
            label: 'SharePoint actions reference - Power Automate | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://elliskarim.com/2025/05/05/how-to-get-sharepoint-file-content-in-power-automate-file-paths-vs-urls/',
            label: 'How to Get SharePoint File Content in Power Automate: File Paths vs URLs',
            asOf: '2026-07-02',
          },
        ],
      },
      dataTables: {
        value:
          'No: Power Automate/Power Platform has no lightweight, spreadsheet-like data table with arrow-key navigation and copy-paste. Its native structured-data store is Microsoft Dataverse, a full relational database with tables, relationships, and business rules built for enterprise data modeling rather than a simple spreadsheet UI. Default query limits, 5,000 rows per call, extendable to 100,000 via pagination, reflect a database, not a spreadsheet grid.',
        detail:
          'No lightweight spreadsheet-grid UI exists akin to Airtable/Sim Tables; Dataverse is the closest analog but is a relational database product.',
        shortValue: 'Dataverse tables are a full DB, not a spreadsheet grid',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.encorebusiness.com/blog/power-automate-how-to-get-more-than-100000-rows-from-a-dataverse-table/',
            label: 'Power Automate: How to Get More Than 100,000 Rows From a Dataverse Table',
            asOf: '2026-07-02',
          },
          {
            url: 'https://hiredgun.tech/power-automate-row-limits/',
            label: 'Power Automate Row Limits for Dataverse & SharePoint',
            asOf: '2026-07-02',
          },
        ],
      },
      richTextEditor: {
        value:
          'No: Power Automate has no inline rich-text/WYSIWYG editor for documents stored in the platform. It is a workflow-automation tool with action inputs (plain text boxes, expression editors) rather than a document-editing surface. Rich text is produced or consumed via connectors like Word Online or SharePoint, not a native editor inside Power Automate itself.',
        detail:
          'No built-in WYSIWYG document editor exists in Power Automate; document editing happens through separate connected apps like Word/SharePoint.',
        shortValue: 'No native document rich-text editor',
        confidence: 'estimated',
        sources: [],
      },
      subWorkflows: {
        value:
          'Yes: Power Automate supports child flows via the built-in "Run a Child Flow" action, which calls another flow as a step, waits for it to finish, and can pass inputs and receive its outputs back into the parent flow.',
        detail:
          'Child flows must use the "Manually trigger a flow" trigger and must be part of a solution to be callable this way; this is distinct from firing an independent flow asynchronously via HTTP/webhook.',
        shortValue: 'Yes, via the "Run a Child Flow" action',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/create-child-flows',
            label: 'Create child flows - Power Automate | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Yes: Copilot Studio (the agent-building surface Power Automate integrates with) supports OpenAI GPT models plus Anthropic Claude Sonnet 4/Opus 4.1, and any model in the Azure AI Model Catalog, selectable per-prompt/per-agent; OpenAI remains the default',
        detail:
          'Admins enable/restrict Anthropic models tenant-wide in the Microsoft 365 Admin Center; if disabled, agents automatically fall back to the default OpenAI GPT-4o model. Google Gemini is not a supported option.',
        shortValue: 'OpenAI, Anthropic Claude, and Azure AI Model Catalog',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/anthropic-joins-the-multi-model-lineup-in-microsoft-copilot-studio/',
            label: 'Anthropic joins the multi-model lineup in Microsoft Copilot Studio',
            asOf: '2026-07-02',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          "Copilot Studio offers 'generative orchestration', autonomous, reasoning-driven tool/action selection, as an alternative to a fixed decision-tree/topic flow, plus multi-agent orchestration across specialized agents",
        detail:
          'Generative orchestration lets an agent choose actions dynamically instead of following a fixed topic flow, and multi-agent setups can route work to specialized agents, potentially using different models per task.',
        shortValue: 'Generative orchestration plus multi-agent routing',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/agent-extend-action-mcp',
            label:
              'Extend your agent with Model Context Protocol - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          'Yes: Copilot in Power Automate lets makers create, edit, and extend process automation faster using natural language',
        detail: 'Stated directly on the official product page as an AI Authoring capability.',
        shortValue: 'Copilot drafts and edits flows from natural language',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate',
            label: 'Power Automate product page',
            asOf: '2026-07-02',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          'Yes: agents can be grounded via Retrieval-Augmented Generation over Dataverse tables, SharePoint/Office files, and connectors to systems like Salesforce/ServiceNow, using a semantic index with vector embeddings',
        detail:
          'Dataverse is positioned as the agent data platform: the same semantic search index powering Power Apps global search provides retrieval/grounding for Copilot, agents, and MCP tools.',
        shortValue: 'RAG grounding over Dataverse, SharePoint, connectors',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/power-platform/blog/2026/05/05/dataverse-agent-data-platform/',
            label: 'Dataverse Is Your Agent Data Platform - Microsoft Power Platform Blog',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/ai-builder/use-your-own-prompt-data',
            label: 'Add knowledge to your prompt - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpSupport: {
        value:
          'Yes, as a client: Copilot Studio agents can connect to external MCP servers and add their tools/resources. Power Automate has no feature that publishes a flow as its own MCP server for external AI clients to call; see integrations.mcpPublishing for that reverse-direction detail.',
        detail:
          'Requires generative orchestration to be enabled on the agent; tools/resources dynamically update as the connected MCP server changes. The separate Power Apps MCP Server is a fixed, Microsoft-defined server with a small predefined toolset, not a way to publish a custom flow as an MCP endpoint.',
        shortValue: 'Consumes external MCP servers as a client; cannot publish a flow as one',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent',
            label:
              'Connect your agent to an existing MCP server - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/introducing-model-context-protocol-mcp-in-copilot-studio-simplified-integration-with-ai-apps-and-agents/',
            label: 'Introducing MCP in Copilot Studio - Microsoft Copilot Blog',
            asOf: '2026-07-02',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          "Not publicly documented: Power Automate has no dedicated eval/guardrail testing framework for flows, distinct from Copilot Studio's general content moderation and data loss prevention controls",
        detail:
          'Data Loss Prevention policies restrict which connectors can be combined, but there is no dedicated LLM-output evaluation or guardrail testing harness specific to flows.',
        shortValue: 'No dedicated eval/guardrail framework found',
        confidence: 'unknown',
        sources: [],
      },
      humanInTheLoop: {
        value:
          "Yes: a dedicated 'Start and wait for an approval' action pauses the flow run until a designated approver responds via the Power Automate mobile app, email, or Microsoft Teams notification, then resumes down Approve/Reject/custom-response branches",
        detail:
          'Supports first-to-respond or everybody-must-approve modes, custom response options beyond approve/reject, and timeout/escalation branches for production-grade approval chains.',
        shortValue: 'Built-in approval action with Teams/email/mobile response',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/get-started-approvals',
            label: 'Get started with Power Automate approvals - Power Automate | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/all-assigned-must-approve',
            label: 'Create an approval flow that requires everyone to approve - Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      generativeMedia: {
        value:
          'Partial: AI Builder ships an image-description (captioning) model and GPT-based text generation/summarization prompts, but no dedicated native image-generation, video-generation, or text-to-speech/speech-to-text block exists in its catalog',
        detail:
          'Generating images or audio requires calling an external connector, such as Azure OpenAI DALL-E or Azure AI Speech, rather than a first-party AI Builder generative-media model.',
        shortValue: 'Captioning and text gen only, no native image/audio generation',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/ai-builder/use-in-flow-overview',
            label: 'AI Builder in Power Automate overview - Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/ai-builder/azure-openai-model-pauto',
            label: 'Use the text generation model in Power Automate - Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      dynamicToolUse: {
        value: 'Not publicly documented',
        detail:
          'No confirmed information found on dynamic tool-selection behavior for Power Automate/Copilot Studio agents.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      modelFallback: {
        value:
          'Yes: Copilot Studio automatically falls back to the default OpenAI GPT-4o model when a selected alternate model (such as Anthropic Claude) is disabled or unavailable',
        detail:
          "Documented directly for Copilot Studio's multi-model support ('If Anthropic models are disabled, agents built with it will automatically switch to the default model, OpenAI GPT-4o, with no additional configuration required'); a separate confirmation specific to Power Automate flows themselves was not found.",
        shortValue: 'Falls back to default OpenAI GPT-4o model',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/anthropic-joins-the-multi-model-lineup-in-microsoft-copilot-studio/',
            label: 'Anthropic joins the multi-model lineup in Microsoft Copilot Studio',
            asOf: '2026-07-04',
          },
        ],
      },
      agentSkills: {
        value:
          "Yes: Microsoft Copilot Studio (the same agent layer Power Automate's agentic flows build on) supports 'Skills', reusable capabilities defined once (name, description, Markdown instructions) using the same open, portable Markdown/SKILL.md-style format underlying the broader Agent Skills ecosystem, exported as Markdown/ZIP packages and reused across multiple agents, distinct from a one-off system prompt.",
        detail:
          'This is a preview feature in the new Copilot Studio agent experience (part of the Power Platform, adjacent to Power Automate); skills are self-contained, portable instruction sets separate from tools/knowledge, the same open-format approach Sim uses, rather than a proprietary lock-in format.',
        shortValue: "Copilot Studio 'Skills': reusable, portable, cross-agent (open format)",
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-experience/skills-overview',
            label:
              'Skills overview for agents (preview) - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeChatDeployment: {
        value:
          "Yes: Copilot Studio, the Power Platform's agent-building tool that natively integrates with Power Automate (agents can trigger cloud flows), lets builders publish agents as a deployable chat surface, a website chat widget, Teams, and other channels, not just a form, API, or webhook.",
        detail:
          'Chat deployment lives in Copilot Studio rather than Power Automate proper, but the two products are integrated (flows can be triggered from or trigger Copilot Studio agents).',
        shortValue: 'Copilot Studio publishes agents as web/Teams chat',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/microsoft-365-copilot/microsoft-copilot-studio',
            label: 'Microsoft Copilot Studio | Create AI Agents',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/fundamentals-what-is-copilot-studio',
            label: 'Overview - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          "Yes: Copilot Studio's test/preview panel shows a trace of which knowledge sources and citations an agent consulted for an answer, including footnote-style citations tied to specific chunk metadata (document/page). A builder can navigate from a cited source directly to that component to edit it. Whether raw chunk index/content is exposed as its own debugging view, versus just citation footnotes, is undocumented.",
        detail:
          "Chunk-based citations (e.g., 'Document - Page X') appear in the test/preview trace; some formats like local JSON lack citation metadata entirely. A full raw chunk-content inspector is not documented.",
        shortValue: 'Test panel shows citations/trace, chunk-level detail partial',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/knowledge-test',
            label:
              "Test your agent's knowledge sources - Microsoft Copilot Studio | Microsoft Learn",
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-experience/preview-overview',
            label:
              'Preview and test an agent (preview) - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      parallelExecution: {
        value:
          "Yes: a flow can add a dedicated 'Parallel branch' from any step, so multiple branches of actions execute concurrently rather than sequentially, and the flow only continues once all parallel branches complete. Power Automate supports up to 50 total branches (main path plus up to 49 parallel branches) in a single flow.",
        detail:
          "Added via the '+' icon between steps, then 'Add a parallel branch'; this is a native canvas feature, not a workaround using separate flows or a sequential loop.",
        shortValue: 'Yes, native parallel branch (up to 50 concurrent branches)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/guidance/coding-guidelines/implement-parallel-execution',
            label:
              'Optimize flows with parallel execution and concurrency - Power Automate | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.microsoft.com/en-us/power-platform/blog/power-automate/parallel-actions/',
            label: 'Add parallel branches in flows - Microsoft Power Platform Blog',
            asOf: '2026-07-02',
          },
        ],
      },
      a2aProtocol: {
        value:
          "No native support: Power Automate/Copilot Studio do not ship a first-party Agent2Agent (A2A) implementation. A third-party custom connector (built on the standard Custom Connector framework) can wrap an external A2A v1.0 agent's JSON-RPC or HTTP+JSON endpoints, and Microsoft has stated A2A is 'coming soon' to Azure AI Foundry and Copilot Studio as of mid-2026, but no built-in Agent Card discovery or native A2A peer-to-peer calling feature ships today.",
        detail:
          'The available A2A connectors, such as the community-built Agent2Agent/Power A2A Template connectors for Work IQ, are custom connectors that translate Power Platform requests into A2A protocol calls; they are not a native, first-party A2A feature in the Power Automate or Copilot Studio product surface.',
        shortValue:
          'No native A2A; only third-party custom connectors, native support "coming soon"',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://troystaylor.com/power%20platform/custom%20connectors/2026-05-05-agent-to-agent-a2a-connector-work-iq.html',
            label: 'Agent-to-Agent (A2A) connector for Copilot Studio and Power Automate',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.powercommunity.com/empowering-multi-agent-apps-with-the-open-agent2agent-a2a-protocol/',
            label:
              'Empowering multi-agent apps with the open Agent2Agent (A2A) protocol - Power Community',
            asOf: '2026-07-02',
          },
        ],
      },
      loopIteration: {
        value:
          'Yes: Power Automate provides built-in loop containers, the "Apply to each" action iterates over a list/array and the "Do until" action repeats a set of actions until a condition or state is met, each running its iterations sequentially by default.',
        detail:
          'Apply to each can optionally run with concurrency (parallel iteration) via a setting, but sequential execution is the default behavior; Do until requires a defined exit condition and has a configurable iteration/timeout limit.',
        shortValue: 'Yes, via "Apply to each" and "Do until" actions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/apply-to-each',
            label: 'Use the Apply to each action - Power Automate | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-control-flow-loops',
            label: 'Repeat actions with loops in workflows - Azure Logic Apps | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value:
          '1,400+ certified connectors (per current Power Automate product page), up from the 1,000-connector milestone announced May 2023',
        detail:
          'Connectors span first-party, verified-publisher, and independent-publisher tiers, split into Standard and Premium.',
        shortValue: '1,400+ certified connectors',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/power-platform/blog/2023/05/11/microsoft-power-platform-celebrates-1000-certified-connectors/',
            label: 'Power Platform celebrates 1000 certified connectors',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/connectors/connector-reference/connector-reference-powerautomate-connectors',
            label: 'List of all Power Automate connectors - Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate',
            label: 'Microsoft Power Automate product page',
            asOf: '2026-07-02',
          },
        ],
      },
      triggerTypes: {
        value:
          'Connector-event triggers (e.g., new email, new SharePoint item), scheduled/recurrence triggers, manual/button triggers (incl. Mobile), HTTP request/webhook triggers, Dataverse record-change triggers, and desktop-flow/UI-automation triggers',
        detail:
          'Trigger types span connector events, schedules, manual buttons, HTTP webhooks, Dataverse record changes, and desktop UI-automation events.',
        shortValue: 'Connector, schedule, manual, webhook, Dataverse, desktop triggers',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate',
            label: 'Power Automate product page',
            asOf: '2026-07-02',
          },
        ],
      },
      customCodeSteps: {
        value:
          "Yes: custom connectors can wrap Azure Functions or any REST/SOAP API and optionally support uploaded code for request/response transformation. There is no generic 'run inline script' step in a standard cloud flow, though Power Automate for desktop supports scripting actions like PowerShell/VBScript.",
        detail:
          'Custom Connectors wrap a Web API or Azure Function; code upload in a custom connector applies transformation logic to requests/responses.',
        shortValue: 'Custom connectors wrap Azure Functions/REST APIs, no inline script step',
        confidence: 'verified',
        sources: [
          {
            url: 'https://blog.cropley.info/custom-connector-for-an-azure-function-used-with-power-automate/',
            label: 'Custom Connector for an Azure Function used with Power Automate',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/connectors/custom-connectors/',
            label: 'Custom connectors overview - Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      apiPublishing: {
        value:
          'Flows can be triggered via HTTP Request triggers (effectively exposing a flow as a callable webhook/API endpoint); Dataverse/Power Platform also expose Web API endpoints for programmatic access',
        detail:
          'HTTP-triggered flows are a widely used pattern for exposing a flow as a lightweight API endpoint, and Dataverse/Power Platform separately expose Web API endpoints for programmatic access.',
        shortValue: 'HTTP-triggered flows act as callable API endpoints',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate',
            label: 'Power Automate product page',
            asOf: '2026-07-02',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Custom connector SDK/framework (OpenAPI-based definitions, code plug-ins), Power Platform CLI (pac CLI) for solution/connector development, and the open-source PowerPlatformConnectors GitHub repo for community-contributed connector certification submissions. There is no separate marketplace of independently monetized third-party integrations distinct from the certified connector catalog.',
        detail:
          'microsoft/PowerPlatformConnectors is the public GitHub repo where community and partners submit connector definitions for certification into the shared Power Automate/Power Apps/Logic Apps connector catalog.',
        shortValue: 'Custom connector SDK, pac CLI, open-source connector repo',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/microsoft/PowerPlatformConnectors',
            label: 'microsoft/PowerPlatformConnectors GitHub repo',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/connectors/custom-connectors/define-blank',
            label: 'Create a custom connector from scratch - Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpPublishing: {
        value:
          "No: Power Platform/Copilot Studio primarily consumes MCP servers (adding an existing MCP server's tools/resources to an agent), the reverse direction. Microsoft offers its own fixed 'Power Apps MCP Server' with a handful of predefined tools that agents call into, plus a Dataverse MCP connector, but no feature lets a builder publish an arbitrary custom Power Automate flow as its own callable MCP server for external AI tools to invoke.",
        detail:
          "Microsoft's own Power Apps MCP Server and a Dataverse MCP connector expose fixed, Microsoft-defined tool sets, distinct from a maker publishing a specific custom flow as its own MCP endpoint.",
        shortValue: 'Consumes MCP servers; no publish-your-own-flow-as-MCP feature',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-components-to-agent',
            label:
              'Add tools and resources from a Model Context Protocol (MCP) server to your agent - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-apps/maker/model-driven-apps/power-apps-mcp-server',
            label: 'Work with Power Apps MCP server - Power Apps | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Per-user/month and per-bot/month subscription tiers, billed annually, layered on top of Microsoft 365/Dynamics 365 licensing (some Power Automate capability is bundled into certain Microsoft 365 plans at limited scope)',
        detail:
          'Three primary paid SKUs: Premium (per user), Process (per unattended bot), Hosted Process (per hosted unattended bot); plus a $5,000/tenant/month Process Mining add-on.',
        shortValue: 'Per-user/per-bot subscription tiers, billed annually',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate/pricing',
            label: 'Power Automate pricing page',
            asOf: '2026-07-02',
          },
        ],
      },
      entryPaidPlan: {
        value: 'Power Automate Premium. $15.00 per user/month, billed yearly',
        detail:
          'Includes cloud flows, attended desktop flows (RPA), and process/task mining with limited storage (50 MB storage, 250 MB Dataverse database, 2 GB file capacity).',
        shortValue: '$15/user/month billed yearly',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate/pricing',
            label: 'Power Automate pricing page',
            asOf: '2026-07-02',
          },
        ],
      },
      freeTier: {
        value:
          '30-day free trial of premium features (UI-based cloud flows and standard connectors), no permanent free tier on the official pricing page',
        detail:
          'Some Power Automate capability ships bundled inside certain Microsoft 365 subscriptions, but the dedicated Power Automate pricing page lists only a time-limited trial, not an ongoing free plan.',
        shortValue: '30-day trial only, no permanent free tier',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate/pricing',
            label: 'Power Automate pricing page',
            asOf: '2026-07-02',
          },
        ],
      },
      byok: {
        value:
          'Not publicly documented: no bring-your-own-key option exists for Power Automate/Copilot Studio AI features',
        detail:
          'Model selection (OpenAI, Anthropic, Azure AI Model Catalog) is admin-toggled at the tenant level via Microsoft-hosted model access, rather than a customer-supplied API key.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
    },
    security: {
      soc2: {
        value:
          "Power Automate is SOC 2 Type 2 in-scope for Commercial and GCC environments only. It is not in-scope for GCC High or DoD in that attestation, separate from the product's general availability in those government clouds.",
        detail:
          "Microsoft's compliance documentation lists Power Automate among in-scope Commercial/GCC services.",
        shortValue: 'SOC 2 Type 2 in-scope for Commercial and GCC only',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/compliance/regulatory/offering-soc-2',
            label:
              'System and Organization Controls (SOC) 2 Type 2 - Microsoft Compliance | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      dataResidency: {
        value:
          'Yes: environments/regions can be selected at creation to control where Dataverse and related customer data resides, with data kept within the chosen geography (Microsoft may replicate only within the same geographic area for resiliency)',
        detail:
          "Per Microsoft's SOC 2 documentation on Office 365 environments (Commercial, GCC, GCC High, DoD) and Power Platform admin guidance on selecting environment region for residency.",
        shortValue: 'Region-selectable environments keep data in-geography',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/compliance/regulatory/offering-soc-2',
            label: 'SOC 2 Type 2 - Microsoft Compliance | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      rbac: {
        value:
          'Yes: Dataverse role-based security roles control access to environment resources, apps, tables, and specific records; Environment Admin/Power Platform Admin roles govern DLP and environment-level administration',
        detail:
          'Security roles can be scoped to an entire environment or to specific apps/data; separate from Data Loss Prevention (DLP) policies which restrict which connectors can be combined in a flow.',
        shortValue: 'Dataverse security roles plus environment admin roles',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/database-security',
            label: 'Role-based security roles for Dataverse - Power Platform | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/wp-data-loss-prevention',
            label: 'Data policies - Power Platform | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      auditLogging: {
        value:
          'Not fully confirmed: the Microsoft 365 unified audit log captures Power Platform admin and maker activity, but no dedicated documentation confirms flow-level audit logging specific to Power Automate',
        detail:
          'General Microsoft 365 audit logging likely covers Power Automate activity, but a Power Automate-specific audit logging reference does not exist.',
        shortValue: 'Likely covered by M365 unified audit log, not confirmed',
        confidence: 'unknown',
        sources: [],
      },
      additionalCompliance: {
        value:
          'HIPAA/HITECH (Microsoft will sign a BAA as a business associate) and inclusion in the broader Office 365/Azure compliance program, which separately covers ISO 27001, FedRAMP, and other certifications at the Azure/Office 365 platform level. The SOC 2 Type 2 report also incorporates the Cloud Security Alliance CCM and German BSI C5:2020 criteria.',
        detail:
          "HIPAA/BAA support and CSA CCM/BSI C5:2020 coverage are documented directly in Microsoft's SOC 2 documentation. No Power Automate-specific ISO 27001/FedRAMP attestation page exists, so treat those two as platform-level coverage rather than product-specific certification.",
        shortValue: 'HIPAA/BAA, CSA CCM, BSI C5:2020; ISO/FedRAMP at platform level',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/compliance/regulatory/offering-soc-2',
            label: 'SOC 2 Type 2 - Microsoft Compliance | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.keragon.com/hipaa/hipaa-compliant-checker/microsoft-powerautomate',
            label: 'Is Microsoft Power Automate HIPAA Compliant? - Keragon',
            asOf: '2026-07-02',
          },
        ],
      },
      modelAndToolGovernance: {
        value: 'Not publicly documented',
        detail:
          'No dedicated model/tool governance controls exist for Power Automate agents beyond general DLP and security roles.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      credentialGovernance: {
        value:
          'No: Power Platform governs connectors through Data Loss Prevention (DLP) policies that classify entire connectors into Business/Non-Business/Blocked groups at the tenant or environment level, plus Advanced Connector Policies that can restrict specific connector actions/endpoints. This is connector- and action-level governance and does not let admins restrict which specific stored credential or connection a given role or permission group may use.',
        detail:
          "DLP policies and Advanced Connector Policies operate at the connector/action/endpoint level (e.g., block the SharePoint connector tenant-wide), not at the level of 'this role may only use credential X, not credential Y' for the same connector.",
        shortValue: 'DLP governs connectors, not specific stored credentials by role',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/wp-data-loss-prevention',
            label: 'Data policies - Power Platform | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/dlp-connector-classification',
            label: 'Connector classification - Power Platform | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      whiteLabeling: {
        value:
          'No: Power Platform offers only partial branding options, such as custom domains for Power Pages/portals, and lacks native white-labeling for the core app/flow UI. There is no native way to rebrand or remove Microsoft branding from canvas apps or the Power Apps/Power Automate product UI itself.',
        detail:
          'Custom domains exist only for Power Pages (portals), not for canvas apps, model-driven apps, or the Power Automate flow designer itself.',
        shortValue: 'No native full white-labeling of core product UI',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://d365update.com/power-apps-portal-custom-domains/',
            label: 'Power Apps Portal Custom Domains - d365update.com',
            asOf: '2026-07-02',
          },
          {
            url: 'https://powerusers.microsoft.com/t5/Building-Power-Apps/Can-we-Rebrand-Power-APP-mobile-app-for-our-own-company-or/td-p/690023',
            label:
              'Can we Rebrand Power APP mobile app for our own company - Power Platform Community',
            asOf: '2026-07-02',
          },
        ],
      },
      dataRetention: {
        value:
          "Yes: Power Platform admins can configure the run-history retention (time-to-live) for cloud flow runs stored in Dataverse via the Power Platform admin center, choosing 28 days (default), 14 days, 7 days, or Disabled, and can set a fully custom retention value directly via the Dataverse Organization table's FlowRunTimeToLiveInSeconds field.",
        detail:
          'Configured per environment in the Power Platform admin center (Environments > Settings > Product > Features); custom values beyond the UI presets require a direct Dataverse table edit.',
        shortValue: 'Admin-configurable flow run-history retention (28/14/7 days or custom)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/dataverse/cloud-flow-run-metadata',
            label: 'Manage cloud flow run history in Dataverse - Power Automate | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://manueltgomes.com/microsoft/power-platform/powerautomate/power-automate-common-questions/how-to-change-the-run-history-from-28-days/',
            label: 'Power Automate: How to change the run history from 28 days',
            asOf: '2026-07-02',
          },
        ],
      },
      piiRedaction: {
        value:
          "Yes, but as a block rather than a redaction: Microsoft Purview Data Loss Prevention (DLP) for Microsoft 365 Copilot (GA per Ignite 2025) scans Copilot prompts for sensitive content like SSNs and credit card numbers and blocks processing when it finds them. This protection extends to agents built in Copilot Studio, the Power Platform's agent surface. It stops sensitive content from being processed rather than redacting it in-line, and is not a feature built into Power Automate flows themselves.",
        detail:
          'This is Microsoft Purview functionality (a separate, integrated compliance product) covering Microsoft 365 Copilot and Copilot Studio agents; it blocks processing rather than performing in-line redaction, and is not a native Power Automate flow-content feature.',
        shortValue: 'Purview DLP blocks/detects PII in Copilot prompts (incl. Studio agents)',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/purview/dlp-microsoft365-copilot-location-learn-about',
            label:
              'Microsoft Purview DLP for Microsoft 365 Copilot and Copilot Chat | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/purview/ai-copilot-studio',
            label:
              'Use Microsoft Purview to manage data security & compliance for Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      sso: {
        value:
          'Yes: Power Platform is built on Microsoft Entra ID (Azure AD), which natively supports SAML/OIDC single sign-on plus automatic user/app provisioning (SAML Just-in-Time and SCIM-based). Organizations signing in via Entra ID SSO get org-level access without manual per-user account setup. Power Pages/portals additionally document explicit SAML 2.0 setup with Entra ID as an identity provider.',
        detail:
          "SSO/provisioning is inherited from the Microsoft 365/Entra ID tenant rather than a Power Automate-specific setting, standard for Microsoft's enterprise stack.",
        shortValue: 'SSO via Entra ID (SAML/OIDC), JIT/SCIM auto-provisioning',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-pages/security/authentication/saml2-settings-azure-ad',
            label:
              'Set up a SAML 2.0 provider with Microsoft Entra ID - Power Pages | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/entra/identity/app-provisioning/user-provisioning',
            label:
              'What is automated app user provisioning in Microsoft Entra ID | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      thirdPartyVetting: {
        value:
          "Partial: the certified connector catalog (1,400+ connectors, including third-party 'Independent Publisher' submissions) goes through a Microsoft Certification team review, identity/credential verification of the publisher, and swagger/endpoint/security validation before being listed. But any user or org can also build and share 'custom connectors' that call arbitrary APIs, bypassing the certification catalog entirely with no Microsoft security review. Zenity's security research found custom connectors can reach connectors otherwise blocked by Data Loss Prevention (DLP) policies, a documented DLP-bypass tied to the custom-connector path specifically.",
        detail:
          "This is not an open, install-anything marketplace like n8n community nodes: independent publishers must pass identity verification and a Microsoft-run technical/security review to appear in the shared connector catalog. The gap is the separate custom-connector mechanism, which lets any maker define and use an unreviewed connector inside their own environment, and which Zenity's research showed can be abused to bypass connector-level DLP blocks.",
        shortValue: 'Certified catalog is vetted; custom connectors bypass review and DLP',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/connectors/custom-connectors/certification-submission-ip',
            label: 'Independent publisher certification process - Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://zenity.io/blog/research/microsoft-power-platform-dlp-bypass-uncovered-finding-3-custom-connectors',
            label:
              'AI Agent Security | Microsoft Power Platform DLP Bypass Uncovered - Finding #3 - Custom Connectors | Zenity',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          "Yes: per-run execution detail shows each action's inputs/outputs/duration/errors, plus a customer-facing Analytics dashboard summarizing run counts, success/failure rate, average execution time, and a 30-day rolling run history",
        detail:
          "The Analytics dashboard is available directly on a flow's details page; individual run details expose a per-action execution trace.",
        shortValue: 'Per-action trace plus a 30-day run analytics dashboard',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/guidance/coding-guidelines/monitoring-and-alerting',
            label: 'Monitor your flows - Power Automate | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/fix-flow-failures',
            label: 'Troubleshoot a cloud flow - Power Automate | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      durabilityModel: {
        value:
          "Yes: configurable retry policies with exponential backoff on individual actions, and flow run history (including a Dataverse-backed FlowRun table option) that lets a user review a past run's inputs/outputs; resubmission/resubmit-from-history is a documented pattern for reprocessing a failed run",
        detail:
          "Retry policies are set per-action with configurable interval/count and exponential backoff; run history in Dataverse's FlowRun table records start/end time, duration, status, and error detail for large-scale tracking.",
        shortValue: 'Per-action retries with backoff plus resubmit-from-history',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.citrincooperman.com/In-Focus-Resource-Center/How-to-Automatically-Retry-a-Flow-in-Power-Automate',
            label: 'Power Automate Flow: How to Automatically Retry When Flows Fail',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/guidance/coding-guidelines/monitoring-and-alerting',
            label: 'Monitor your flows - Power Automate | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      failureAlerting: {
        value:
          'Yes: per-run failure alert emails for known fixable issues (with a 28-day cooldown per flow) plus a weekly failure digest email summarizing all flow failures across environments',
        detail:
          'Per-run alerts fire shortly after a failure is detected as a known/fixable issue; separately, a weekly digest covers all failures regardless of type.',
        shortValue: 'Per-run failure alerts plus a weekly failure digest',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/understand-flow-failure-notifications',
            label: 'Understand flow failure notifications - Power Automate | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      dataDrains: {
        value:
          'Yes: Power Platform supports continuous export of activity/audit logs to external destinations via the Microsoft Sentinel solution for Power Platform, built on Azure Monitor/Log Analytics with roughly a 60-minute ingestion delay, and more broadly, any log sink that accepts Azure Monitor/Log Analytics data. Audit logs are also searchable in the Microsoft Purview/Office 365 Security & Compliance Center.',
        detail:
          'This is achieved via the dedicated Microsoft Sentinel solution for Power Platform/Dynamics 365, not a generic user-configurable webhook/S3/BigQuery export built into Power Automate itself.',
        shortValue: 'Exports logs to Microsoft Sentinel/Azure Monitor continuously',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/azure/sentinel/business-applications/deploy-power-platform-solution',
            label: 'Connect Microsoft Power Platform to Microsoft Sentinel | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/azure/sentinel/business-applications/power-platform-solution-overview',
            label: 'Microsoft Sentinel Solution for MS Business Apps | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      asyncExecution: {
        value:
          'Yes: Power Automate supports asynchronous execution. A flow can respond with an HTTP 202 status code plus a Location header pointing to a status-check URL, letting the caller poll for the result instead of blocking, and long-running actions can use an asynchronous polling pattern (or an Until loop) instead of a synchronous call.',
        detail:
          "Configured by enabling 'Asynchronous response' on a Response action; inbound HTTP-triggered flows still must return within 120 seconds, but actions after a response action, or separately started child flows, continue running in the background beyond that limit.",
        shortValue: 'Yes, via 202 + Location polling pattern',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/guidance/coding-guidelines/asychronous-flow-pattern',
            label: 'Use asynchronous responses - Power Automate | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/limits-and-config',
            label:
              'Limits of automated, scheduled, and instant flows - Power Automate | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      executionLimits: {
        value:
          'A single flow run may last up to 30 days, after which pending steps like approvals time out. An outbound synchronous HTTP request times out at 120 seconds, while an outbound asynchronous request is configurable up to 30 days. An inbound HTTP-triggered flow must return a response within 120 seconds. Concurrent runs per flow are unlimited by default, or capped between 1 and 100 (default 25) if Concurrency Control is turned on, with a waiting-runs queue of 10 plus the configured degree of parallelism.',
        detail:
          'Additional caps: Power Platform requests are limited to 100,000 per 5 minutes and 10,000 to 10,000,000 per 24 hours depending on license tier; concurrent outbound calls are capped at 500 (Low tier) or 2,500 (other tiers); flows throttled for 14 consecutive days are automatically turned off.',
        shortValue: '30-day max run, 120s HTTP timeout, 1-100 concurrency',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/limits-and-config',
            label:
              'Limits of automated, scheduled, and instant flows - Power Automate | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      partialFailureHandling: {
        value:
          "Yes: Power Automate lets a single failing step be routed to an error-handling path while the rest of the run continues, via the 'Configure run after' setting on each action, which can be set to trigger on 'has failed', 'is skipped', or 'has timed out' in addition to the default 'is successful'.",
        detail:
          'This lets a designer branch to a notification, logging, or retry action after a failure and continue the flow, rather than having any single failure always halt the entire run; scopes are also commonly used to group a try/catch-style block.',
        shortValue: "Yes, via per-action 'Configure run after'",
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/guidance/coding-guidelines/error-handling',
            label: 'Employ robust error handling - Power Automate | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      unattendedExecution: {
        value:
          "Yes for cloud flows: scheduled, connector-event, and webhook-triggered cloud flows run entirely on Microsoft's multi-tenant cloud service, with no dependency on any client device staying open, awake, or connected. Desktop flows (RPA) are the documented exception: unattended desktop flows still require a persistent Windows machine, either a customer-managed on-premises machine kept logged in, or a Microsoft-hosted unattended bot (the $215/bot/month tier) that removes the customer-managed-device requirement but is still a distinct, higher-cost execution mode from ordinary cloud flows.",
        detail:
          'Cloud flows are the default and most common Power Automate scenario; desktop flows only apply when automating legacy desktop/UI-based applications via RPA, and even the Microsoft-hosted unattended option runs on a machine instance rather than a lightweight, always-on cloud function.',
        shortValue: 'Yes for cloud flows; unattended RPA needs a persistent machine',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/overview-cloud',
            label: 'Overview of cloud flows - Power Automate | Microsoft Learn',
            asOf: '2026-07-04',
          },
          {
            url: 'https://www.microsoft.com/en-us/power-platform/products/power-automate/pricing',
            label: 'Power Automate pricing page',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/desktop-flows/run-unattended-desktop-flows',
            label: 'Run unattended desktop flows - Power Automate | Microsoft Learn',
            asOf: '2026-07-04',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Documentation via Microsoft Learn, the large Power Users community forum, and paid Microsoft support plans. Enterprise customers typically get support through their Microsoft account or Unified Support contract.',
        detail:
          "Drawn from Microsoft's broader support ecosystem and the active Power Platform community forum, rather than a single Power Automate-specific support-tier page.",
        shortValue: 'Docs, community forum, and paid Microsoft support plans',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://powerusers.microsoft.com/t5/Building-Flows/How-to-restore-a-previous-version-of-a-flow/td-p/288145',
            label: 'Power Platform Community forum example thread',
            asOf: '2026-07-02',
          },
        ],
      },
      sla: {
        value:
          'Not publicly documented: Power Automate does not publish a product-specific SLA, though Microsoft publishes general Online Services SLAs',
        detail:
          "No Power Automate-specific uptime percentage exists; Microsoft's general Online Services SLA terms would apply.",
        shortValue: 'No product-specific SLA found',
        confidence: 'unknown',
        sources: [],
      },
      community: {
        value:
          'Large. Active official Power Platform/Power Users community forums with structured Q&A on building, approvals, and troubleshooting flows',
        detail:
          'Multiple community threads on powerusers.microsoft.com cover real production troubleshooting scenarios, such as restoring flow versions, showing an active, Microsoft-hosted community forum.',
        shortValue: 'Large, active Power Platform community forum',
        confidence: 'verified',
        sources: [
          {
            url: 'https://powerusers.microsoft.com/t5/Building-Flows/How-to-restore-a-previous-version-of-a-flow/td-p/288145',
            label: 'Power Platform Community - How to restore a previous version of a flow',
            asOf: '2026-07-02',
          },
        ],
      },
      companyMaturity: {
        value:
          'Microsoft Corporation. Founded April 4, 1975. Approximately 228,000 employees. Market capitalization approximately $2.8 trillion USD. Publicly traded (NASDAQ: MSFT) with quarterly revenue in the $80B+ range as of FY2026 SEC filings',
        detail:
          "Power Automate is a product line within Microsoft's Power Platform/Business Applications segment, backed by Microsoft's overall corporate scale rather than an independent startup.",
        shortValue: 'Microsoft Corporation. Public, ~228,000 employees',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.sec.gov/Archives/edgar/data/0000789019/000119312526191457/msft-ex99_1.htm',
            label: 'Microsoft Corp 8-K FY2026 filing',
            asOf: '2026-07-02',
          },
          {
            url: 'https://stockanalysis.com/stocks/msft/market-cap/',
            label: 'Microsoft (MSFT) Market Cap - StockAnalysis.com',
            asOf: '2026-07-02',
          },
          {
            url: 'https://en.wikipedia.org/wiki/Microsoft',
            label: 'Microsoft - Wikipedia',
            asOf: '2026-07-02',
          },
        ],
      },
      academy: {
        value:
          'Yes: Microsoft Learn provides structured, self-paced training paths and official certifications for Power Automate and the broader Power Platform, including the Microsoft Certified: Power Platform Fundamentals (PL-900) and Power Platform Developer Associate certifications, plus dedicated Power Automate learning modules and instructor-led courses.',
        detail:
          "Delivered through Microsoft Learn's training paths and official Microsoft Certified credentials, a substantial structured-education program.",
        shortValue: 'Microsoft Learn: structured courses + PL-900/Developer certifications',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/credentials/certifications/power-platform-fundamentals/',
            label:
              'Microsoft Certified: Power Platform Fundamentals - Certifications | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/training/powerplatform/power-automate',
            label: 'Power Automate on Microsoft Learn | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
    },
  },
}
