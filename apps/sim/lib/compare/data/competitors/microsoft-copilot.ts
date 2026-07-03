import { MicrosoftCopilotIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Researched and cross-verified against live vendor sources on 2026-07-02. */
export const microsoftCopilotProfile: CompetitorProfile = {
  id: 'microsoft-copilot',
  name: 'Microsoft Copilot Studio',
  website: 'https://www.microsoft.com/en-us/microsoft-copilot-studio',
  brand: {
    icon: MicrosoftCopilotIcon,
    selfFramed: true,
    colors: ['#0736c4', '#8c48ff', '#00e5cc'],
    source: 'Official brand guidelines',
    asOf: '2026-07-02',
  },
  oneLiner:
    'Microsoft Copilot Studio is a low-code tool in the Microsoft ecosystem for building, testing, and publishing conversational and autonomous AI agents, using topics or LLM-driven generative orchestration, connectors, agent flows, and Dataverse-grounded knowledge.',
  standoutFeatures: [
    {
      title: 'Reusable, portable Agent Skills',
      description:
        'A Skill is a named capability defined once as a SKILL.md file (YAML front matter plus Markdown instructions, optionally bundled with scripts/templates/reference documents into a ZIP package). Skills can be authored in Copilot Studio or a text editor, attached to multiple agents, and exported to share with others, distinct from a one-off system prompt tied to a single agent.',
      shortDescription: 'Named, Markdown-defined capabilities reusable across multiple agents.',
      source: {
        url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-experience/skills-overview',
        label: 'Skills overview for agents (preview) - Microsoft Copilot Studio | Microsoft Learn',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Multi-model support including Anthropic Claude and bring-your-own-model',
      description:
        'Agents can use OpenAI GPT models, Anthropic Claude Sonnet 4 and Opus 4.1, any model in the Azure AI Model Catalog, or a bring-your-own-model connection to an Azure AI Foundry deployment (via endpoint URI, deployment name, and API key) for individual prompts. Admins enable or restrict non-default models tenant-wide, with automatic fallback to the default OpenAI model if a selected model is disabled.',
      shortDescription:
        'OpenAI, Anthropic Claude, Azure AI Model Catalog, or a bring-your-own model.',
      source: {
        url: 'https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/anthropic-joins-the-multi-model-lineup-in-microsoft-copilot-studio/',
        label: 'Anthropic joins the multi-model lineup in Microsoft Copilot Studio',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Deep, per-session orchestration traces',
      description:
        'Conversation transcripts capture which topic fired, which knowledge sources were consulted, which tools were called, which child agents or MCP servers were invoked, what the orchestration plan was, and how long each step took, viewable per-session in the Analytics area for the last 28 days (extendable via export to Azure Data Lake Storage).',
      shortDescription:
        'Per-session traces cover topics, tools, knowledge, sub-agents, and timing.',
      source: {
        url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-experience/analytics-overview',
        label: 'Monitor an agent overview (preview) - Microsoft Copilot Studio | Microsoft Learn',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Broad, independently audited compliance certification list',
      description:
        "Copilot Studio's own admin documentation lists coverage under HIPAA (BAA), HITRUST CSF, FedRAMP, SOC, multiple ISO standards (9001, 20000-1, 22301, 27001, 27017, 27018, 27701), PCI DSS, CSA STAR, UK G-Cloud, Singapore MTCS Level 3, Korea K-ISMS, and Spain ENS, each with an audit report on the Microsoft Service Trust Portal.",
      shortDescription:
        'HIPAA, FedRAMP, SOC, multiple ISO standards, PCI DSS, and more, each audited.',
      source: {
        url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/admin-certification',
        label: 'Review ISO, SOC, and HIPAA compliance - Microsoft Copilot Studio | Microsoft Learn',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Generative orchestration picks topics, tools, and knowledge dynamically',
      description:
        "Generative orchestration replaces fixed decision-tree topic flows with an LLM-driven planning layer that interprets user intent, selects from an agent's topics, tools, knowledge sources, and child agents at runtime, and executes multistep plans, rather than requiring every path to be hand-authored with trigger phrases in advance.",
      shortDescription:
        'An LLM planning layer selects topics/tools/knowledge at runtime, not a fixed script.',
      source: {
        url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/generative-orchestration',
        label:
          'Apply generative orchestration capabilities - Microsoft Copilot Studio | Microsoft Learn',
        asOf: '2026-07-02',
      },
    },
  ],
  limitations: [
    {
      title: 'Consumption pricing carries overage and cost-forecasting complexity',
      description:
        'Usage is billed in Copilot Credits across many separately metered feature rates (classic answer, generative answer, agent action, tenant graph grounding, agent flow actions per 100, three tiers of AI tools, three tiers of voice), and reasoning models add a second, separate premium-token charge on top of the base feature rate. Microsoft publishes a dedicated usage estimator tool because manually forecasting cost from these dimensions is otherwise difficult.',
      shortDescription:
        'Costs span many separately metered credit rates, needing a dedicated estimator tool.',
      source: {
        url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-messages-management',
        label: 'Billing rates and management - Microsoft Copilot Studio | Microsoft Learn',
        asOf: '2026-07-02',
      },
    },
    {
      title:
        'Full ALM tooling (pipelines, environment variables) is gated to solution-aware agents',
      description:
        'Version history, environment promotion via pipelines, and environment variables only apply to agents built inside a Dataverse solution. Agents created outside a solution, a common default for individual makers experimenting in Copilot Studio, do not get this ALM tooling.',
      shortDescription:
        'Pipelines and environment-variable promotion require building inside a solution.',
      source: {
        url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/alm',
        label:
          'Establish an Application Lifecycle Management (ALM) strategy - Microsoft Copilot Studio | Microsoft Learn',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Session transcript detail defaults to a 28-day window',
      description:
        "An agent's per-session transcripts, showing which topic fired, tools called, and knowledge consulted, are available in the Analytics area for the last 28 days by default. Retaining that level of detail longer requires a separate export pipeline (Azure Synapse Link for Dataverse into Azure Data Lake Storage Gen2), not a built-in retention setting.",
      shortDescription:
        'Detailed session transcripts default to 28 days; longer retention needs a manual export.',
      source: {
        url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/analytics-transcripts-studio',
        label:
          'Understand downloaded session data from Copilot Studio - Microsoft Copilot Studio | Microsoft Learn',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'No self-hosting; a Microsoft-operated cloud service only',
      description:
        "Copilot Studio's authoring, orchestration, and runtime are Microsoft-operated multi-tenant (or government-cloud) cloud services. There is no on-premises deployment option for the core agent-building and conversation-orchestration engine itself, unlike products that offer a self-hosted or air-gapped runtime.",
      shortDescription:
        'No on-premises option; agents run only on Microsoft-operated cloud infrastructure.',
      source: {
        url: 'https://learn.microsoft.com/en-us/compliance/regulatory/offering-soc-2',
        label: 'SOC 2 Type 2 - Microsoft Compliance | Microsoft Learn',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'No native white-labeling of the core builder or default chat UI',
      description:
        'Agent-level branding is limited to setting a name, icon, and accent color, or hosting a fully custom canvas web app for the chat window itself. There is no documented option to remove Microsoft/Copilot Studio branding from the authoring canvas or the default published chat surface the way a dedicated white-label offering would.',
      shortDescription:
        'Branding is limited to name/icon/color or a custom-built chat canvas, not full white-label.',
      source: {
        url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/customize-default-canvas',
        label:
          'Customize the look and feel of an agent - Microsoft Copilot Studio | Microsoft Learn',
        asOf: '2026-07-02',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'Low-code conversational/agent builder with a topics-based (trigger phrase) authoring mode, an alternative LLM-driven generative orchestration mode, natural-language agent creation, and separate agent flows for deterministic step sequences',
        detail:
          'Classic authoring uses topics triggered by phrases; generative orchestration lets the agent dynamically select topics/tools/knowledge based on a description of each. Agent flows (built on the Power Automate flow engine) handle deterministic, step-by-step logic invoked as agent tools.',
        shortValue: 'Topics or generative orchestration, plus deterministic agent flows',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/fundamentals-what-is-copilot-studio',
            label: 'Overview - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/generative-orchestration',
            label:
              'Apply generative orchestration capabilities - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/flows-overview',
            label: 'Agent flows overview - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      learningCurve: {
        value:
          'Low for a single-topic agent answering from one knowledge source; steep for generative orchestration instruction design, solution-based ALM, and Dataverse security modeling at production scale',
        detail:
          'Microsoft markets basic agent creation as accessible to non-developer makers via natural language and templates, while its own guidance devotes dedicated articles to writing effective generative-orchestration instructions and structuring solutions/environments/pipelines, both described as requiring deliberate design work.',
        shortValue: 'Easy for a single simple agent, steep for orchestration and ALM at scale',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/generative-mode-guidance',
            label:
              'Configure high-quality instructions for generative orchestration - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/alm',
            label:
              'Establish an Application Lifecycle Management (ALM) strategy - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      selfHostOption: {
        value:
          'No: Copilot Studio has no self-hosted deployment of its authoring or orchestration/runtime engine; it runs only as a Microsoft-operated cloud service (commercial or government cloud)',
        detail:
          "Microsoft's own compliance documentation describes Copilot Studio as an Online Service across Commercial, GCC, GCC High, and DoD environments, all Microsoft-operated; no on-premises or customer-hosted runtime is documented.",
        shortValue: 'No, Microsoft-operated cloud service only',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/compliance/regulatory/offering-soc-2',
            label: 'SOC 2 Type 2 - Microsoft Compliance | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      deploymentOptions: {
        value:
          'Commercial multi-tenant cloud, plus Office 365 GCC, GCC High, and DoD sovereign/government cloud environments',
        detail:
          "Confirmed via Microsoft's SOC 2 compliance documentation, which lists Copilot Studio among the Power Platform services in scope for Commercial and GCC environments.",
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
          'Yes: an Agent Library of ready-to-use, pre-built agent templates (e.g. Employee Self-Service, Prompt Coach, IT Helpdesk, Financial Insights) with preconfigured instructions, actions, topics, and starter knowledge, deployable into an environment and then customized',
        detail:
          'Templates are distributed both as a visual, guided-deployment catalog on Microsoft Marketplace and as raw solution files on GitHub for the same templates.',
        shortValue: 'Yes, Agent Library of pre-built, customizable templates',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/agent-library-overview',
            label:
              'Configure and deploy agents from the Agent Library - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/template-fundamentals',
            label:
              'Create a custom agent from a template - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      license: {
        value: 'Proprietary, commercial SaaS, not open source',
        detail:
          'Copilot Studio is a licensed Microsoft commercial cloud product billed via Copilot Credits (prepaid packs, pay-as-you-go, or annual commitment); no open-source licensing model exists for the product.',
        shortValue: 'Proprietary commercial SaaS',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-messages-management',
            label: 'Billing rates and management - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      environmentPromotion: {
        value:
          'Yes: agents built inside a Dataverse solution can be promoted dev to test to production via exported/imported managed and unmanaged solutions, Power Platform Pipelines for automated promotion, and environment variables for per-environment config, the same ALM model Power Automate uses',
        detail:
          'Copilot Studio agents are created inside a Power Platform solution; solutions are the transport container across environments, with pipelines or Azure DevOps/GitHub Actions automating the import chain and Git integration available for source control.',
        shortValue: 'Dataverse solutions plus Pipelines for dev/test/prod',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-solutions-overview',
            label:
              'Create and manage custom solutions - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/alm',
            label:
              'Establish an Application Lifecycle Management (ALM) strategy - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Solution-based promotion with Git integration and pipelines for solution-aware agents; no documented visual diff/compare view between two agent versions, and this ALM tooling does not apply to agents built outside a solution',
        detail:
          'Git integration lets a solution connect to a repository for version control and collaboration, and pipelines automate deployment between environments, but no dedicated side-by-side version-diff UI for an individual agent was found in vendor documentation.',
        shortValue: 'Git-backed solution promotion, no visual diff view found',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/alm',
            label:
              'Establish an Application Lifecycle Management (ALM) strategy - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          "No: Copilot Studio agents can be shared with co-owners and accessed by multiple makers, but there is no documented live, concurrent multi-user editing of the same agent with visible cursors and synced changes. Microsoft's live coauthoring feature (visible cursors, simultaneous editing) is documented for Power Apps Studio canvas apps, a separate product, not for the Copilot Studio agent designer.",
        detail:
          'Sharing an agent with other users grants asynchronous edit access, not simultaneous live co-editing; no vendor source documents cursor-level real-time collaboration in the Copilot Studio designer itself.',
        shortValue: 'No true live co-editing; only async sharing of an agent',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/admin-share-bots',
            label: 'Share agents with other users - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeFileStorage: {
        value:
          'No: Copilot Studio has no file storage system of its own (no folder hierarchy, link-based sharing, or recycle bin built into the product). Files used as knowledge sources or by connectors are stored in and managed through external services such as SharePoint, OneDrive, or Dataverse.',
        detail:
          'Knowledge sources reference SharePoint sites/document libraries or uploaded files stored in Dataverse; there is no first-party, user-facing file manager surface inside Copilot Studio itself.',
        shortValue: 'No native file store; relies on SharePoint/OneDrive/Dataverse',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/knowledge-copilot-studio',
            label: 'Knowledge sources summary - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      dataTables: {
        value:
          'No: Copilot Studio does not offer a lightweight, spreadsheet-like data table with arrow-key navigation and copy-paste. Its native structured-data store is Microsoft Dataverse, a full relational database with tables, relationships, and business rules, used both as an agent knowledge source and for storing conversation transcripts and custom analytics.',
        detail:
          'Dataverse is the same underlying data platform Power Automate uses; it is positioned as the agent data platform for grounding, but is a relational database product, not a simple spreadsheet-grid UI.',
        shortValue: 'Dataverse tables are a full DB, not a spreadsheet grid',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/power-platform/blog/2026/05/05/dataverse-agent-data-platform/',
            label: 'Dataverse Is Your Agent Data Platform - Microsoft Power Platform Blog',
            asOf: '2026-07-02',
          },
        ],
      },
      richTextEditor: {
        value:
          'No: Copilot Studio does not provide an inline rich-text/WYSIWYG document editor. Agent instructions, topic content, and Skill files (Markdown with YAML front matter) are authored as plain text or Markdown source, either inside the Copilot Studio UI or an external text editor, not through a WYSIWYG surface.',
        detail:
          'Skills are explicitly described as portable Markdown files a maker can author in Copilot Studio or "your favorite text editor," underscoring that authoring is raw-text/Markdown-based rather than WYSIWYG.',
        shortValue:
          'No WYSIWYG editor; instructions and Skills are authored as Markdown/plain text',
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
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Yes: agents can use OpenAI GPT models, Anthropic Claude Sonnet 4 and Opus 4.1, any model in the Azure AI Model Catalog, or a bring-your-own Azure AI Foundry model deployment for individual prompts',
        detail:
          'Admins enable or restrict non-default models tenant-wide in the Microsoft 365 Admin Center; if a selected alternate model is disabled or unavailable, agents fall back automatically to the default OpenAI model. Google Gemini is not a supported option.',
        shortValue: 'OpenAI, Anthropic Claude, Azure AI Model Catalog, or bring-your-own model',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/anthropic-joins-the-multi-model-lineup-in-microsoft-copilot-studio/',
            label: 'Anthropic joins the multi-model lineup in Microsoft Copilot Studio',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/bring-your-own-model-prompts',
            label:
              'Bring your own model for your prompts - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          "Yes: generative orchestration is an LLM-driven planning layer that selects among an agent's topics, tools, knowledge sources, and child agents at runtime, and an optional deep reasoning model (GPT-5.5 Reasoning) can be enabled for tasks requiring step-by-step logical analysis, distinct from a fixed decision-tree topic flow",
        detail:
          'Deep reasoning is currently regionally limited to the United States and the EU (excluding the UK) and trades response speed for accuracy on complex tasks; the agent decides when to apply it, or a maker can force it via a "reason" keyword in instructions.',
        shortValue: 'Generative orchestration planning plus an optional deep reasoning model',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/generative-orchestration',
            label:
              'Apply generative orchestration capabilities - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-reasoning-models',
            label:
              'Add a deep reasoning model for complex tasks (preview) - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          "Yes: makers can describe an agent in plain language and Copilot Studio's AI-based authoring drafts topics, instructions, and structure from that description, distinct from manually assembling a topic tree",
        detail:
          "Documented as the product's core AI-based agent authoring capability, letting non-developers describe the desired behavior instead of hand-building every topic and trigger phrase.",
        shortValue: 'Describe an agent in text; Copilot Studio drafts the topics/instructions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/nlu-gpt-overview',
            label: 'AI-based agent authoring overview - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          'Yes: agents can be grounded via retrieval-augmented generation over Dataverse tables, SharePoint/Office files, connectors to systems like Salesforce or ServiceNow, and a tenant-wide semantic search index (tenant graph grounding) over Microsoft Graph data including connector-synced external content',
        detail:
          'Tenant graph grounding is a distinctly billed, optional per-agent feature (10 Copilot Credits per message) layered on top of ordinary knowledge-source retrieval, aimed at higher-quality, up-to-date grounding.',
        shortValue: 'RAG over Dataverse, SharePoint, connectors, plus tenant graph grounding',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/knowledge-copilot-studio',
            label: 'Knowledge sources summary - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.microsoft.com/en-us/power-platform/blog/2026/05/05/dataverse-agent-data-platform/',
            label: 'Dataverse Is Your Agent Data Platform - Microsoft Power Platform Blog',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpSupport: {
        value:
          'Yes: agents connect to external MCP servers as tools directly from the Tools page (Add Tool > New Tool > MCP, specifying just a URL), and tools/resources the server publishes are automatically added as actions that inherit their name, description, inputs, and outputs, staying in sync as the server changes',
        detail:
          'MCP servers are wired in via connector infrastructure under the hood, so they inherit enterprise controls like Data Loss Prevention policies and virtual network integration alongside multiple authentication methods.',
        shortValue: 'Yes, connects to external MCP servers as auto-syncing tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent',
            label:
              'Connect your agent to an existing MCP server - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-components-to-agent',
            label:
              'Add tools and resources from a Model Context Protocol (MCP) server to your agent - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          "Yes: a dedicated test-set evaluation feature runs up to 100 test cases (authored manually, imported from a spreadsheet, or AI-generated from the agent's design/knowledge/topics) against an agent, alongside mandatory content moderation that screens both user input and agent responses for harmful content, jailbreaking, prompt injection, and prompt exfiltration",
        detail:
          'Content is evaluated twice per turn (at input and again before the response is returned); a detected violation blocks the response and shows an error rather than letting it through.',
        shortValue: 'Test-set evaluations (up to 100 cases) plus dual-stage content moderation',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/analytics-agent-evaluation-create',
            label: 'Create a single response test set - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/troubleshoot/power-platform/copilot-studio/generative-answers/agent-response-filtered-by-responsible-ai',
            label:
              'Resolve responsible AI content filter errors - Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      humanInTheLoop: {
        value:
          'Yes: a dedicated Request for Information action in agent flows pauses an automated run to collect structured input from a designated human reviewer via email, and a separate hand-off feature lets a conversational agent transfer an in-progress chat, with full history and variables, to a live human agent in a connected engagement hub',
        detail:
          'Request for Information targets agent-flow-style automation pausing on a decision point; hand-off targets live conversational escalation to a human, covering both the automation-approval and conversational-escalation senses of human-in-the-loop.',
        shortValue: 'Request-for-Information flow action, plus live-agent conversation hand-off',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/introducing-request-for-information-in-copilot-studio-agent-flows/',
            label:
              'Introducing request for information in Copilot Studio agent flows | Microsoft Copilot Blog',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-hand-off',
            label: 'Hand off to a live agent - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      generativeMedia: {
        value:
          'Partial: AI Builder, the shared Power Platform model catalog Copilot Studio prompts draw from, ships an image-description (captioning) model and GPT-based text generation, but no dedicated native image-generation, video-generation, or text-to-speech/speech-to-text model exists in that catalog. Generating images or audio requires calling an external connector, such as Azure OpenAI DALL-E or Azure AI Speech.',
        detail:
          'This is the same AI Builder model catalog Power Automate flows use; Copilot Studio prompts and agent flows both draw from it, so the gap in native generative-media models is shared across both products.',
        shortValue:
          'Captioning and text gen only; image/audio generation needs an external connector',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/ai-builder/use-in-flow-overview',
            label: 'AI Builder in Power Automate overview - Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      dynamicToolUse: {
        value:
          "Yes: with generative orchestration turned on, an agent's LLM-driven planner dynamically selects which topics, tools, and knowledge sources to invoke at runtime from the full set attached to the agent, rather than following only the specific tool-call path a maker pre-wired into a fixed topic",
        detail:
          'This is the explicit mechanism generative orchestration adds over classic topic-based authoring, where a maker had to hand-author which tool a given trigger phrase path calls.',
        shortValue: "Yes, via generative orchestration's runtime tool/topic selection",
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/generative-orchestration',
            label:
              'Apply generative orchestration capabilities - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      modelFallback: {
        value:
          'Yes: Copilot Studio automatically falls back to the default OpenAI GPT-4o model when a selected alternate model, such as Anthropic Claude, is disabled or unavailable for the tenant',
        detail:
          'Documented specifically as multi-model fallback behavior; not documented as a broader multi-provider retry-on-rate-limit policy beyond that single fallback path.',
        shortValue: 'Falls back to the default OpenAI GPT-4o model automatically',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/anthropic-joins-the-multi-model-lineup-in-microsoft-copilot-studio/',
            label: 'Anthropic joins the multi-model lineup in Microsoft Copilot Studio',
            asOf: '2026-07-02',
          },
        ],
      },
      agentSkills: {
        value:
          "Yes: Skills are named capabilities (name, description, Markdown instructions, optional supporting files) defined once, created in Copilot Studio or a text editor, added to multiple agents, and exported as a Markdown file or ZIP package for sharing, distinct from a single agent's own instructions",
        detail:
          'This is a preview feature in the new Copilot Studio agent-building experience; the standard SKILL.md format with YAML front matter makes skills portable between agents and organizations.',
        shortValue: 'Yes, named Markdown Skills reusable and exportable across agents',
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
          'Yes: an agent can be published directly to a live website chat widget, Microsoft Teams, Microsoft 365 Copilot Chat, SharePoint, Power Pages, mobile, and further channels via Azure Bot Service (Slack, Telegram, Twilio SMS, and more), not only a form/API/webhook',
        detail:
          'Publishing pushes the current agent version out to every connected channel at once; a channel is documented as "the integration point where an end-user can interact with a Copilot Studio agent."',
        shortValue: 'Yes, publishes to website, Teams, M365 Copilot Chat, and more channels',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/publication-fundamentals-publish-channels',
            label:
              'Key concepts - Publish and deploy your agent - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/publication-connect-bot-to-azure-bot-service-channels',
            label:
              'Publish an agent to Azure Bot Service channels - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          "Partial: Copilot Studio's test/preview panel shows a trace of which knowledge sources an agent consulted for an answer, with footnote-style citations tied to specific chunk metadata (e.g. document and page), and a maker can navigate from a citation to the source component to edit it, but a dedicated raw chunk-content inspector distinct from citation footnotes is not clearly documented.",
        detail:
          'Some knowledge formats, such as local JSON, are documented as lacking citation metadata entirely, so chunk-level detail is not uniformly available across every knowledge-source type.',
        shortValue:
          'Test panel shows citations/trace with chunk metadata, not a full chunk inspector',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/knowledge-test',
            label:
              "Test your agent's knowledge sources - Microsoft Copilot Studio | Microsoft Learn",
            asOf: '2026-07-02',
          },
        ],
      },
      parallelExecution: {
        value:
          'Yes: agent flows, built on the Power Automate flow engine, support native parallel branches so multiple actions run concurrently and the flow proceeds only once every branch completes; loop actions separately support a parallel (concurrency) mode for independent iterations',
        detail:
          'Vendor guidance notes parallel branches and concurrent loop iterations add complexity and can affect output quality when combining concurrent results, and flows must still return within a documented action-count/time budget.',
        shortValue: 'Yes, native parallel branches and concurrent loop iterations in agent flows',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/power-platform/blog/power-automate/parallel-actions/',
            label:
              'Add parallel branches in flows and five new services - Microsoft Power Platform Blog',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.candede.com/articles/copilot-studio-workflow-engine-loop-component/',
            label: 'Mastering Copilot Studio Workflows: The Loop Component',
            asOf: '2026-07-02',
          },
        ],
      },
      a2aProtocol: {
        value:
          "No native support: Copilot Studio does not ship a first-party Agent2Agent (A2A) implementation today. Third-party custom connectors can wrap an external A2A agent's JSON-RPC/HTTP+JSON endpoints, and Microsoft has stated native A2A support is planned for Copilot Studio and Azure AI Foundry, but no built-in Agent Card discovery or native peer-to-peer A2A calling ships as of this check.",
        detail:
          'Available A2A connectors today are community-built custom connectors translating Power Platform requests into A2A protocol calls, not a first-party Copilot Studio feature.',
        shortValue: 'No native A2A yet; only third-party custom connectors, native support planned',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://troystaylor.com/power%20platform/custom%20connectors/2026-05-05-agent-to-agent-a2a-connector-work-iq.html',
            label: 'Agent-to-Agent (A2A) connector for Copilot Studio and Power Automate',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value: "1,000+ pre-built connectors, per Copilot Studio's own connector documentation",
        detail:
          "Copilot Studio's connector documentation states its connector library gives access to pre-built integrations to 1,000+ services; this shares the same underlying connector catalog Power Automate uses, whose own product page cites 1,400+ certified connectors as a broader Power Platform-wide figure.",
        shortValue: '1,000+ connectors from the shared Power Platform catalog',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-connectors',
            label:
              'Use connectors in Copilot Studio agents - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      triggerTypes: {
        value:
          'Conversational trigger phrases (topics), autonomous event-based triggers that wait for a specific event to fire the agent without a user prompting it, connector-event triggers, and schedule-based triggers for agent flows',
        detail:
          'Autonomous triggers let an agent proactively respond to events (e.g. a new record, an incoming email) rather than only reacting to a live conversation.',
        shortValue: 'Trigger phrases, autonomous event triggers, connector events, schedules',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://adoption.microsoft.com/files/copilot-studio/Autonomous-agents-with-Microsoft-Copilot-Studio.pdf',
            label: 'Autonomous Agents with Microsoft Copilot Studio',
            asOf: '2026-07-02',
          },
        ],
      },
      customCodeSteps: {
        value:
          'No generic inline script step in the conversational designer; custom logic is reached via agent flows composed of Power Automate flow actions, or custom connectors wrapping an Azure Function or REST/SOAP API',
        detail:
          'Agent flows are built with the same low-code flow-action model as Power Automate, not an arbitrary code editor; a custom connector can front an Azure Function to run bespoke code as a callable action.',
        shortValue:
          'No inline script step; custom logic via agent flows or Azure Function connectors',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-flow-create',
            label: 'Create an agent flow as a tool - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      apiPublishing: {
        value:
          'Yes: a published agent is reachable over the Azure Bot Service Direct Line API/channel, giving external code a callable HTTP interface into the conversation, alongside the standard chat channels',
        detail:
          'Direct Line is the same Bot Framework mechanism used to embed a custom canvas or drive an agent from an external application, rather than a distinct, separately branded API-publishing feature.',
        shortValue: 'Yes, via the Azure Bot Service Direct Line channel/API',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/publication-connect-bot-to-azure-bot-service-channels',
            label:
              'Publish an agent to Azure Bot Service channels - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Microsoft Bot Framework SDK and custom-canvas hosting for programmatic chat-UI control, the Power Platform CLI (pac CLI) for solution/pipeline scripting, and the shared, open-source microsoft/PowerPlatformConnectors GitHub repo for community connector submissions',
        detail:
          'No separate, independently monetized third-party marketplace exists beyond the shared certified-connector catalog; custom canvas hosting lets a developer take full programmatic control of the chat surface via Bot Framework.',
        shortValue: 'Bot Framework SDK, custom canvas, pac CLI, open-source connector repo',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/customize-default-canvas',
            label:
              'Customize the look and feel of an agent - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/microsoft/PowerPlatformConnectors',
            label: 'microsoft/PowerPlatformConnectors GitHub repo',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpPublishing: {
        value:
          "No: public documentation describes Copilot Studio primarily consuming MCP servers (adding an existing server's tools/resources to an agent), the reverse direction. No documented feature lets a maker publish a specific Copilot Studio agent itself as its own callable MCP server for external AI tools to invoke.",
        detail:
          'Guidance on exposing an MCP server for Copilot Studio to reach describes hosting a custom MCP server separately (e.g. via Azure Container Apps or VS Code dev tunnels) and connecting Copilot Studio to it as a client, not publishing the agent as a server.',
        shortValue: 'Consumes MCP servers; no publish-your-own-agent-as-MCP feature found',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-components-to-agent',
            label:
              'Add tools and resources from a Model Context Protocol (MCP) server to your agent - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Consumption-based Copilot Credits, purchasable as prepaid capacity packs, pay-as-you-go against an Azure subscription, or a discounted annual commitment, billed across separately metered feature rates (classic/generative answers, agent actions, tenant graph grounding, agent flow actions, three tiers of AI tools, three tiers of voice)',
        detail:
          'Microsoft 365 Copilot licensed users get included usage at no additional Copilot Credit charge for employee-facing (business-to-employee) scenarios, up to documented fair-usage limits.',
        shortValue: 'Consumption-based Copilot Credits, several metered feature rates',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/requirements-messages-management',
            label: 'Billing rates and management - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      entryPaidPlan: {
        value:
          'Copilot Studio Pre-Purchase Plan: $200/month for a 25,000 Copilot Credit capacity pack (roughly 20% cheaper than pay-as-you-go), or pay-as-you-go at $0.01 per Copilot Credit with no upfront commitment',
        detail:
          'Both require an active Azure subscription for billing; a $200 free Azure credit is available for new accounts to trial the pay-as-you-go meter.',
        shortValue: '$200/month for 25,000 credits, or $0.01/credit pay-as-you-go',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/microsoft-365-copilot/pricing/copilot-studio',
            label: 'Microsoft 365 Copilot Pricing - AI Agents | Copilot Studio',
            asOf: '2026-07-02',
          },
        ],
      },
      freeTier: {
        value:
          'No permanent free tier for building/running agents at production scale; a $200 Azure account credit and a Copilot Studio trial are available for new users, and Microsoft 365 Copilot licensed users get included agent usage for internal, employee-facing scenarios',
        detail:
          "The $200 Azure credit functions as a one-time trial allowance against the pay-as-you-go Copilot Credit meter, not an ongoing free plan; Microsoft 365 Copilot's included usage only applies to authenticated, licensed-user interactions.",
        shortValue: 'Trial credit and licensed-user included usage, no ongoing free tier',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/microsoft-365-copilot/pricing/copilot-studio',
            label: 'Microsoft 365 Copilot Pricing - AI Agents | Copilot Studio',
            asOf: '2026-07-02',
          },
        ],
      },
      byok: {
        value:
          'Yes, for the underlying model rather than a raw provider API key: a maker can bring a specific Azure AI Foundry model deployment (via its endpoint URI, deployment name, and API key) into a prompt as a first-class Bring Your Own Model option, billed separately from the standard Copilot Credit meters',
        detail:
          "Documented as currently available for individual prompts/tools; Microsoft's release plan lists using a brought-in model as the agent's primary response model, not just in prompts, as a future preview capability.",
        shortValue: 'Yes, via a bring-your-own Azure AI Foundry model deployment',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/bring-your-own-model-prompts',
            label:
              'Bring your own model for your prompts - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    security: {
      soc2: {
        value:
          'Yes: Copilot Studio has been audited to be compliant with SOC, with SOC audit reports available from the Microsoft Service Trust Portal',
        detail:
          "Copilot Studio's own admin-certification documentation states it has been audited to be compliant with SOC, without specifying SOC 1 vs SOC 2 vs report Type on that particular page; the underlying Power Platform SOC 2 Type 2 attestation separately covers Commercial and GCC environments.",
        shortValue: 'Audited SOC compliant, reports via Microsoft Service Trust Portal',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/admin-certification',
            label:
              'Review ISO, SOC, and HIPAA compliance - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      dataResidency: {
        value:
          'Yes: organizations can create agents in a specific environment/region so agent data resides within that geography, with Microsoft replicating only within the same geographic area for durability',
        detail:
          "Covered in Copilot Studio's dedicated geographic data residency documentation, distinct from the general Power Platform environment-region setting.",
        shortValue: 'Region-selectable environments keep agent data in-geography',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/geo-data-residency-security',
            label:
              'Geographic data residency - Security - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      rbac: {
        value:
          'Yes: Dataverse-backed security roles (System Administrator, Environment Maker, Bot Contributor, Bot Transcript Viewer, Analytics Viewer, and others) scope who can author, publish, view transcripts for, or view analytics on an agent, assignable directly or via Microsoft Entra ID group teams',
        detail:
          'Controlling agent creation requires layering tenant-level licensing/Author-group access with environment-level security roles, since neither alone is sufficient; Bot Transcript Viewer specifically scopes access to conversation transcripts.',
        shortValue:
          'Dataverse security roles (System Admin, Bot Contributor, Transcript Viewer, etc.)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/sec-gov-phase3',
            label:
              'Secure your Copilot Studio projects - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      auditLogging: {
        value:
          'Yes: Copilot Studio provides dedicated audit logging covering admin, maker, and user activity across agents, viewable in the Microsoft Purview compliance portal',
        detail:
          'Documented in a Copilot Studio-specific audit-logging article, distinct from the general Microsoft 365 unified audit log Power Automate relies on for the same purpose.',
        shortValue: 'Yes, dedicated admin/maker/user audit logging via Microsoft Purview',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/admin-logging-copilot-studio',
            label:
              'View audit logs for admins, makers, and users of Copilot Studio - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      additionalCompliance: {
        value:
          'HIPAA (Business Associate Agreement), HITRUST CSF, FedRAMP, multiple ISO standards (9001, 20000-1, 22301, 27001, 27017, 27018, 27701), PCI DSS, CSA STAR, UK G-Cloud, Singapore MTCS Level 3, Korea K-ISMS, and Spain ENS, each with an audit report on the Microsoft Service Trust Portal',
        detail:
          "This is the full list from Copilot Studio's own admin-certification documentation; each certification links to a corresponding audit report or certificate rather than being a bare marketing claim.",
        shortValue: 'HIPAA, HITRUST, FedRAMP, multiple ISO standards, PCI DSS, CSA STAR, and more',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/admin-certification',
            label:
              'Review ISO, SOC, and HIPAA compliance - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      modelAndToolGovernance: {
        value:
          'Yes: admins can enable or restrict which non-default LLMs (e.g. Anthropic Claude) are available tenant-wide, and Data Loss Prevention policies classify connectors, and therefore the tools built from them, into Business/Non-Business/Blocked groups at the tenant or environment level',
        detail:
          'Model access control is a distinct admin toggle from DLP connector classification; together they cover both which model an agent may use and which connector-backed tools it may call.',
        shortValue: 'Yes, admin-toggled model access plus DLP-based connector/tool classification',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/anthropic-joins-the-multi-model-lineup-in-microsoft-copilot-studio/',
            label: 'Anthropic joins the multi-model lineup in Microsoft Copilot Studio',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/wp-data-loss-prevention',
            label: 'Data policies - Power Platform | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      credentialGovernance: {
        value:
          'No: Data Loss Prevention policies and Advanced Connector Policies govern access at the connector/action/endpoint level (e.g. blocking the SharePoint connector tenant-wide), not at the level of restricting which specific stored credential or connection a given role may use for the same connector',
        detail:
          'This is the same Power Platform DLP model Power Automate uses, since Copilot Studio agent flows and connectors sit on the same underlying platform.',
        shortValue: 'DLP governs connectors, not specific stored credentials by role',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-platform/admin/wp-data-loss-prevention',
            label: 'Data policies - Power Platform | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      whiteLabeling: {
        value:
          'No: agent-level branding is limited to a custom name, icon, and accent color in Settings, or fully hosting a custom canvas web app for the chat window (via CSS/JavaScript or the Bot Framework SDK); there is no documented option to remove Microsoft/Copilot Studio branding from the authoring canvas or the default published chat UI itself.',
        detail:
          'A custom canvas gives full programmatic control over the embedded chat experience, but that is a developer-built replacement UI, not a native white-labeling setting inside the product.',
        shortValue: 'No, only name/icon/color or a fully custom-built chat canvas',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/customize-default-canvas',
            label:
              'Customize the look and feel of an agent - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      dataRetention: {
        value:
          'Partial: session/transcript detail in the Analytics area defaults to a 28-day window (conversation transcripts downloadable for 29 days), extendable only via a separate export pipeline (Azure Synapse Link for Dataverse into Azure Data Lake Storage Gen2) rather than a built-in, admin-configurable retention setting for that transcript detail',
        detail:
          "This differs from Power Automate's own flow-run-history retention, which is directly admin-configurable in the Power Platform admin center (28/14/7 days or a custom Dataverse field edit); Copilot Studio's session-transcript detail requires the export workaround instead.",
        shortValue: '28-day default transcript window; longer retention needs a manual export',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/analytics-transcripts-studio',
            label:
              'Understand downloaded session data from Copilot Studio - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      piiRedaction: {
        value:
          'Yes, but as a block rather than in-line redaction: Microsoft Purview inline Data Loss Prevention for Copilot Studio agents (public preview) scans prompts sent to an agent in real time for Sensitive Information Types (SSNs, credit card numbers, custom types), and blocks the prompt from being processed, with no AI response generated, if one is detected before the agent is invoked.',
        detail:
          'This stops sensitive content from reaching the agent at all rather than redacting it in-line and continuing; it is configured as a Purview DLP policy targeting the Copilot Studio location, separate from the product itself.',
        shortValue: 'Purview inline DLP blocks prompts containing detected PII before invocation',
        confidence: 'verified',
        sources: [
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
          'Yes: Copilot Studio and the wider Power Platform are built on Microsoft Entra ID, which natively supports SAML/OIDC single sign-on plus automatic user/app provisioning (SAML just-in-time and SCIM-based), so signing in via Entra ID grants org-level access without manual per-user account setup',
        detail:
          "SSO/provisioning is inherited from the Microsoft 365/Entra ID tenant rather than a Copilot Studio-specific setting, consistent with the rest of Microsoft's enterprise stack.",
        shortValue: 'Yes, SSO via Entra ID (SAML/OIDC) with automatic provisioning',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/entra/identity/app-provisioning/user-provisioning',
            label:
              'What is automated app user provisioning in Microsoft Entra ID | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Yes: per-session conversation transcripts show which topic fired, which knowledge sources were consulted, which tools were called, which child agents or MCP servers were invoked, what the orchestration plan was, and how long each step took, alongside an Analytics dashboard with conversation volume, engagement, satisfaction, and response-quality metrics over time',
        detail:
          'Telemetry can additionally be sent to Azure Monitor Application Insights, with a dedicated Copilot Studio dashboard workbook surfacing total conversations, latency, exceptions, tool usage, and topic analytics in one view for deeper analysis beyond the native session view.',
        shortValue: 'Per-session traces (topic/tools/knowledge/timing) plus a metrics dashboard',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-experience/analytics-overview',
            label:
              'Monitor an agent overview (preview) - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-bot-framework-composer-capture-telemetry',
            label:
              'Capture telemetry with Application Insights - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      durabilityModel: {
        value:
          'Yes for agent-flow steps: because agent flows are built on the Power Automate flow engine, individual flow actions can use configurable retry policies with backoff, the same durability mechanism Power Automate exposes; a documented troubleshooting pattern for tool-call timeouts explicitly recommends adding retry with backoff',
        detail:
          'This durability applies to the deterministic agent-flow layer; no separate, distinct replay/checkpoint mechanism specific to the conversational/generative-orchestration layer itself was found.',
        shortValue:
          'Yes, per-action retry with backoff inherited from the Power Automate flow engine',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/troubleshoot/power-platform/copilot-studio/authoring/error-codes',
            label: 'Understand Error Codes - Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      failureAlerting: {
        value:
          "Partial: proactive failure alerting is reachable through Azure Monitor Application Insights alerts on exceptions/latency once telemetry is wired up, but no Copilot Studio-native, automatic per-run failure-email or weekly-digest feature (comparable to Power Automate's flow-failure notifications) was found in vendor documentation.",
        detail:
          "Copilot Studio's own Analytics area is dashboard/lookup-based (a maker must open it to see failures), whereas the alerting capability that pushes a notification depends on separately configuring Application Insights alert rules.",
        shortValue:
          'Alerting requires configuring Application Insights; no native failure-email feature found',
        confidence: 'unknown',
        sources: [],
      },
      dataDrains: {
        value:
          'Yes: telemetry can be continuously streamed to Azure Monitor Application Insights, and conversation transcripts/custom analytics data stored in Dataverse can be continuously exported via Azure Synapse Link for Dataverse into Azure Data Lake Storage Gen2 in Common Data Model format',
        detail:
          'This is the same Azure-native export pattern documented for Power Automate/Power Platform more broadly (Microsoft Sentinel for audit/activity logs, Application Insights for telemetry), not a generic user-configurable webhook/S3/BigQuery drain built directly into Copilot Studio.',
        shortValue: 'Yes, exports to Application Insights and Azure Data Lake via Synapse Link',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/custom-analytics-strategy',
            label:
              'Develop a custom analytics strategy - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      asyncExecution: {
        value:
          "Yes: agent flows inherit the Power Automate flow engine's asynchronous response pattern (an HTTP 202 plus a Location header the caller polls), letting a long-running flow action continue beyond a synchronous request's time limit",
        detail:
          'Agent flow actions invoked by an agent are still bound by a documented 100-second action limit within a conversational turn, distinct from the longer-running asynchronous pattern available to a flow triggered independently of a live conversation.',
        shortValue: 'Yes, via the same 202 + Location polling pattern as Power Automate',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/guidance/coding-guidelines/asychronous-flow-pattern',
            label: 'Use asynchronous responses - Power Automate | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      executionLimits: {
        value:
          'Microsoft publishes concrete limits: agent flow actions invoked by an agent must respond within roughly 100-120 seconds per conversational turn; express-mode flow runs are capped at 100 actions and a 64 KB message size per action; and generative AI/Copilot Credit throttling applies per Dataverse environment when consumption exceeds capacity.',
        detail:
          'These limits are specific to the agent-flow/tool-calling layer inside a live conversation; the underlying flow engine also carries the broader Power Automate execution limits (30-day max run, etc.) when a flow runs independently of an agent turn.',
        shortValue: '~100-120s per-turn action limit, 100-action/64KB express-mode cap',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/agent-flow-express-mode',
            label:
              'Speed up agent flow execution with express mode (preview) - Microsoft Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://learn.microsoft.com/en-us/troubleshoot/power-platform/copilot-studio/licensing/throttling-errors-agents',
            label:
              'Resolve usage limit and agent unavailable errors in Copilot Studio agents - Copilot Studio | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      partialFailureHandling: {
        value:
          'Yes for agent-flow steps: because agent flows run on the Power Automate flow engine, an individual failing action can be routed to an error-handling path via the same per-action "Configure run after" (has failed / is skipped / has timed out) setting, letting the rest of the flow continue rather than the whole run always halting',
        detail:
          'This inherits directly from the Power Automate flow-action model agent flows are built on; no separate, distinct partial-failure mechanism specific to the conversational/topic layer was found.',
        shortValue: "Yes, via the inherited per-action 'Configure run after' setting",
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/power-automate/guidance/coding-guidelines/error-handling',
            label: 'Employ robust error handling - Power Automate | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Documentation via Microsoft Learn, the Power Platform/Power Users community forum and Microsoft Q&A for general questions, and the Microsoft 365 Admin Center for business-critical, SLA-based support requests',
        detail:
          "Microsoft's own guidance distinguishes routine community/Q&A support from business-critical issues, which are directed specifically to the Microsoft 365 Admin Center support flow rather than the public forums.",
        shortValue: 'Docs, community/Q&A forums, and Admin Center for business-critical issues',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/feedback',
            label:
              'Microsoft 365 Copilot Developer Community Support and Feedback Channels | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      sla: {
        value:
          'Not publicly documented as a Copilot Studio-specific, financially backed SLA; general Microsoft Online Services SLA terms (covering Azure, Dynamics 365, Office 365) apply, with a widely cited 99.9% uptime commitment for other core Microsoft 365 services',
        detail:
          'Reporting on Copilot outages has specifically noted enterprise customers lack the same financially backed SLA protection for Copilot that exists for core services like Exchange Online or file storage.',
        shortValue: 'No product-specific SLA found; general Online Services SLA applies',
        confidence: 'unknown',
        sources: [],
      },
      community: {
        value:
          'Large: an active, Microsoft-hosted Power Platform/Power Users community forum with structured Q&A on building, publishing, and troubleshooting Copilot Studio agents, plus Microsoft Q&A for developer-specific questions',
        detail:
          'The same community forum infrastructure serves the broader Power Platform (Power Apps, Power Automate, Copilot Studio), rather than a dedicated, separately branded Copilot Studio-only forum.',
        shortValue: 'Large, shared Power Platform community forum plus Microsoft Q&A',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/feedback',
            label:
              'Microsoft 365 Copilot Developer Community Support and Feedback Channels | Microsoft Learn',
            asOf: '2026-07-02',
          },
        ],
      },
      companyMaturity: {
        value:
          'Microsoft Corporation. Founded April 4, 1975. Approximately 228,000 employees. Market capitalization approximately $2.8 trillion USD. Publicly traded (NASDAQ: MSFT) with quarterly revenue in the $80B+ range as of FY2026 SEC filings',
        detail:
          "Copilot Studio is a product within Microsoft's Power Platform/Business Applications segment, backed by Microsoft's overall corporate scale rather than an independent startup.",
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
        ],
      },
      academy: {
        value:
          'Yes: Microsoft Learn provides structured, self-paced training paths, hands-on labs (Microsoft Copilot Studio Labs, Agent Academy), and official certifications spanning Copilot Studio and the broader Power Platform, including Microsoft Certified: Power Platform Fundamentals (PL-900)',
        detail:
          'Beyond formal certification paths, Microsoft publishes dedicated, scenario-based hands-on labs (mcs-labs, agent-academy) specifically for Copilot Studio, going beyond ad hoc docs or blog content.',
        shortValue: 'Microsoft Learn courses, hands-on labs, and PL-900 certification',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.microsoft.com/en-us/credentials/certifications/power-platform-fundamentals/',
            label:
              'Microsoft Certified: Power Platform Fundamentals - Certifications | Microsoft Learn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://microsoft.github.io/mcs-labs/labs/setup-for-success/',
            label:
              'Set yourself up for success & discover ALM best practices | Microsoft Copilot Studio Labs',
            asOf: '2026-07-02',
          },
        ],
      },
    },
  },
}
