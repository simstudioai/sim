import { ZapierIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Researched and cross-verified against live vendor sources on 2026-07-02. */
export const zapierProfile: CompetitorProfile = {
  id: 'zapier',
  name: 'Zapier',
  website: 'https://zapier.com',
  brand: {
    icon: ZapierIcon,
    selfFramed: true,
    colors: ['#fc4c06', '#fcac7c', '#241414'],
    description:
      'Zapier is a cloud‑based automation platform that connects thousands of web applications, enabling users to create custom workflows without coding. By linking apps such as Gmail, Slack, Salesforce, and many more, Zapier automates repetitive tasks-moving data, triggering actions, and syncing information across services-so teams can focus on other work. Users build “Zaps” that define triggers and actions, allowing software to work together.',
    industries: [
      'Software (B2B)',
      'Developer Tools & APIs',
      'Artificial Intelligence & Machine Learning',
    ],
    socials: [
      { type: 'x', url: 'https://x.com/zapier' },
      { type: 'linkedin', url: 'https://linkedin.com/company/zapier' },
      { type: 'facebook', url: 'https://facebook.com/ZapierApp' },
      { type: 'youtube', url: 'https://youtube.com/user/ZapierApp' },
      { type: 'instagram', url: 'https://instagram.com/popular/zapiercom' },
    ],
    source: 'Context.dev brand-intelligence API',
    asOf: '2026-07-02',
  },
  oneLiner:
    'Zapier is a cloud-based, proprietary no-code/low-code automation platform built around "Zaps": trigger-action workflows connecting thousands of web apps. It has recently added AI features on top, including Copilot for building, Agents for autonomous multi-step tasks, and an MCP server.',
  standoutFeatures: [
    {
      title: '9,000+ pre-built app integrations',
      description: "Zapier's app directory lists 9,000+ supported apps and connectors.",
      shortDescription: 'Connects to 9,000+ apps.',
      source: { url: 'https://zapier.com/apps', label: 'Zapier App Directory', asOf: '2026-07-02' },
    },
    {
      title: 'Hosted MCP server',
      description:
        'Zapier MCP exposes 9,000+ app connections and 30,000+ actions as Model Context Protocol tools over Streamable HTTP, letting any MCP-compatible AI client call Zapier actions, at a cost of 2 tasks per tool call on all plans.',
      shortDescription: 'Exposes 9,000+ apps and 30,000+ actions as MCP tools for any AI client.',
      source: {
        url: 'https://zapier.com/blog/zapier-mcp-guide/',
        label: 'Zapier MCP: Perform 30,000+ actions in your AI tool',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Zapier Copilot (natural-language build assistant)',
      description:
        'Copilot lets users describe an automation or agent in plain language and generates a draft Zap or agent, including writing custom code steps to fill integration gaps. Currently in open beta.',
      shortDescription: 'Describe an automation and Copilot builds the Zap or agent for you.',
      source: {
        url: 'https://zapier.com/blog/zapier-copilot-guide/',
        label: 'Zapier Copilot: Build systems even faster with AI',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Multi-provider LLM support across Zaps/Agents/Chatbots',
      description:
        'Zapier lets users choose among OpenAI (GPT family), Anthropic (Claude family), and Google (Gemini family) models inside AI-powered steps and chatbots, including a BYOK option for OpenAI, Anthropic, Gemini, and Azure OpenAI keys.',
      shortDescription: 'Choose OpenAI, Anthropic, or Google models, with BYOK support.',
      source: {
        url: 'https://zapier.com/blog/ai-models-on-zapier/',
        label: 'Which AI models can you automate on Zapier?',
        asOf: '2026-07-02',
      },
    },
  ],
  limitations: [
    {
      title: 'No self-hosting / on-prem option',
      description:
        'Zapier is closed-source SaaS only, hosted on AWS in the US; there is no self-hosted, Docker, or on-prem deployment option, unlike open-source competitors such as n8n, Automatisch, or Sim.',
      shortDescription: 'Closed-source SaaS only, hosted on AWS in the US.',
      source: {
        url: 'https://zapier.com/security-compliance',
        label: 'Zapier Security & Compliance (via search cache)',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Task-based pricing scales quickly with usage',
      description:
        'Every Zap action step (and every MCP tool call, at 2 tasks each) consumes a metered task, so pricing and plan tier are driven by execution volume rather than a flat seat or workflow count, and costs rise fast as usage grows.',
      shortDescription: 'Costs scale with execution volume, not a flat seat count.',
      source: {
        url: 'https://www.activepieces.com/blog/zapier-pricing',
        label: 'Zapier Pricing Breakdown (third-party analysis)',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Free plan is heavily restricted',
      description:
        'The free plan is capped at 100 tasks/month and limited to two-step Zaps (one trigger, one action), which prevents building multi-step automations or agents without upgrading.',
      shortDescription: 'Capped at 100 tasks/month and two-step Zaps only.',
      source: {
        url: 'https://www.activepieces.com/blog/zapier-pricing',
        label: 'Zapier Pricing Breakdown (third-party analysis)',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'No documented data-residency choice',
      description:
        "Zapier's infrastructure runs on AWS in the United States, with no selectable regional data residency or EU-only hosting option for standard customers.",
      shortDescription: 'Runs on AWS in the US only, no regional hosting choice.',
      source: {
        url: 'https://zapier.com/security-compliance',
        label: 'Zapier Security & Compliance (via search cache)',
        asOf: '2026-07-02',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'Visual, trigger-action ("Zap") builder with an AI natural-language layer (Copilot) on top; also offers a separate Agents builder for AI agents and low-code custom-code steps',
        shortValue: 'Visual Zap builder plus Copilot and Agents',
        confidence: 'verified',
        sources: [
          {
            url: 'https://zapier.com/blog/zapier-copilot-guide/',
            label: 'Zapier Copilot guide',
            asOf: '2026-07-02',
          },
        ],
      },
      learningCurve: {
        value:
          'Easy for basic two-step Zaps; steeper for multi-step, branching Zaps and custom code steps',
        detail:
          'Basic Zaps are approachable for non-technical users, but multi-step and branching Zaps, along with code steps, require more technical skill to build well.',
        shortValue: 'Easy for basic Zaps, steeper for advanced ones',
        confidence: 'unknown',
        sources: [],
      },
      selfHostOption: {
        value: 'No',
        detail:
          'Zapier is a proprietary hosted SaaS product with no self-hosted or on-prem deployment option, unlike open-source alternatives such as n8n and Automatisch.',
        shortValue: 'Cloud-only SaaS, no self-hosting',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://alternativeto.net/software/zapier/?platform=self-hosted',
            label: 'AlternativeTo: Zapier self-hosted alternatives listing',
            asOf: '2026-07-02',
          },
        ],
      },
      deploymentOptions: {
        value: 'Cloud-only (multi-tenant SaaS), hosted on AWS in the United States',
        shortValue: 'Cloud-only, hosted on AWS (US)',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://zapier.com/security-compliance',
            label: 'Zapier Security & Compliance page (via fetch cache)',
            asOf: '2026-07-02',
          },
        ],
      },
      templates: {
        value: 'Yes',
        detail:
          'Zapier publishes a large library of pre-built Zap templates and app-specific workflow templates across its app directory and marketing pages.',
        shortValue: 'Large library of prebuilt templates',
        confidence: 'estimated',
        sources: [
          { url: 'https://zapier.com/apps', label: 'Zapier App Directory', asOf: '2026-07-02' },
        ],
      },
      license: {
        value: 'Proprietary',
        shortValue: 'Proprietary',
        confidence: 'verified',
        sources: [
          {
            url: 'https://zapier.com/pricing',
            label: 'Zapier Plans & Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      environmentPromotion: {
        value: 'No true environment-promotion model',
        detail:
          'Zapier has no dev/QA/prod project-forking or push/pull-between-environments mechanism. It only offers per-Zap workarounds: "Workspaces" for team delegation (not environment tiers), integration-level environment variables to point a connection at staging vs. production URLs, and private/draft Zap versions used informally as a test tier. Teams typically work around this by duplicating Zaps, swapping environment variables per Zap, or publishing separate integration versions.',
        shortValue: 'No native dev/prod promotion; manual workarounds only',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://community.zapier.com/how-do-i-3/zapier-application-lifecycle-management-how-do-i-manage-dev-and-production-versions-40833',
            label: 'Zapier Application Lifecycle Management - Dev/Production versions (Community)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://community.zapier.com/general-discussion-13/best-practice-for-managing-development-environments-13059',
            label: 'Best practice for managing development environments (Community)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.zapier.com/platform/quickstart/zapier-integration-structure',
            label: 'Zapier integration structure docs',
            asOf: '2026-07-02',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Server-persisted version history, rollback, and diff/compare; no branching; no native undo/redo',
        detail:
          'Zapier keeps a full Zap version history and lets you restore any prior version, which creates a new draft from that version. A compare view shows the currently published version next to the in-progress draft, and drafts let you edit a live Zap without turning it off. There is no branching model with named branches merged back, and no dedicated undo/redo inside the draft editor.',
        shortValue: 'Version history, rollback, and diff. No branching or undo',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/14094586364941-Restore-your-Zap-to-a-prior-version-with-version-rollback',
            label: 'Restore your Zap to a prior version with version rollback',
            asOf: '2026-07-02',
          },
          {
            url: 'https://community.zapier.com/product-updates/we-ve-added-version-history-for-your-zaps-18362',
            label: "We've added Version History for your Zaps! (Community)",
            asOf: '2026-07-02',
          },
          {
            url: 'https://zapier.com/blog/preview-zap-versions/',
            label: 'Zapier product announcement: Version Preview for your Zaps',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/9693520498445-Create-Zap-drafts-and-versions',
            label: 'Create Zap drafts and versions',
            asOf: '2026-07-02',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          'No: Zapier supports asynchronous sharing and collaboration (shared assets, folders, app connections, named versions), but not live, simultaneous multi-user editing on the same Zap at the same time.',
        detail:
          'Interfaces allow up to 10 members to be granted edit access, but this is shared access, not simultaneous live co-editing.',
        shortValue: 'No live multiplayer editing, async sharing only',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/40368119010701-Best-practices-for-sharing-collaborating-on-and-maintaining-workflows-in-Zapier',
            label:
              'Best practices for sharing, collaborating on, and maintaining workflows in Zapier',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/20897388284045-Invite-team-members-to-collaborate-on-Zapier-Interfaces',
            label: 'Invite team members to collaborate on Zapier Interfaces',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeFileStorage: {
        value:
          "No: Zapier has no dedicated file-storage system with folder hierarchy, link-sharing options, and recycle-bin recovery. 'Storage by Zapier' is a key-value data store (up to 25 KB per key, 500 keys per account) for small pieces of workflow data, not files. Actual file handling is done per-step through connected apps like Google Drive or Dropbox.",
        detail:
          'Zapier does offer folder-level permissions for organizing Zaps/Tables/Interfaces assets within the product, but that is asset organization, not a file-storage system for arbitrary documents.',
        shortValue: 'No: only a key-value store, not file storage',
        confidence: 'verified',
        sources: [
          {
            url: 'https://zapier.com/blog/storage-by-zapier-guide/',
            label: 'Storage by Zapier: A memory bank for your workflows',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496293271053-Save-and-retrieve-data-from-Zaps-using-Storage-by-Zapier',
            label: 'Save and retrieve data from Zaps using Storage by Zapier',
            asOf: '2026-07-02',
          },
        ],
      },
      dataTables: {
        value:
          'Yes: Zapier Tables is a native, spreadsheet-like data table feature (distinct from external DB connectors), with a spreadsheet-style grid interface and plan-based record limits (Free plan up to 2,500 records). Deleted records and fields go to a Trash with a 30-day recovery window.',
        detail:
          'Table components embedded in Interfaces/Forms display 20 rows by default (switchable to 10/20/50); exact keyboard-navigation parity with classic spreadsheets is not separately documented.',
        shortValue: 'Yes: native Zapier Tables with record limits',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/15721386410765-Zapier-Tables-usage-limits',
            label: 'Zapier Tables usage limits',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/45396606105741-Restore-deleted-records-and-fields-from-Trash-in-Zapier-Tables',
            label: 'Restore deleted records and fields from Trash in Zapier Tables',
            asOf: '2026-07-02',
          },
        ],
      },
      richTextEditor: {
        value:
          'Partial: Zapier supports markdown formatting (bold, italic, headings, lists, links, checkboxes) in specific surfaces like Canvas text boxes, Forms text components, and folder documentation notes, plus a Formatter step to convert between HTML and Markdown. This is markdown-syntax entry, not a true inline WYSIWYG rich-text editor for a stored document surface.',
        detail:
          'No public documentation describes a true inline rich-text/WYSIWYG editor comparable to a document editor; formatting is markdown-based.',
        shortValue: 'Markdown syntax support, not a WYSIWYG editor',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/43579890272653-Markdown-formatting-in-Zapier',
            label: 'Markdown formatting in Zapier',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496308580365-Change-your-Zap-data-to-HTML-Markdown-ASCII-or-plain-text',
            label: 'Change your Zap data to HTML, Markdown, ASCII, or plain text',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'OpenAI (GPT family), Anthropic (Claude family), and Google (Gemini family), with BYOK for OpenAI, Anthropic, Gemini, and Azure OpenAI in Chatbots',
        shortValue: 'OpenAI, Anthropic, and Google models, with BYOK',
        confidence: 'verified',
        sources: [
          {
            url: 'https://zapier.com/blog/ai-models-on-zapier/',
            label: 'Which AI models can you automate on Zapier?',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/21959873616013-Use-your-own-API-key-with-a-Zapier-Chatbot',
            label: 'Use your own API key with a Zapier Chatbot',
            asOf: '2026-07-02',
          },
        ],
      },
      agentReasoningBlocks: {
        value: 'Yes',
        detail:
          'Zapier Agents is a distinct product for building autonomous, multi-step AI agents, separate from plain trigger-action Zaps, that can reason across tasks and act across 9,000+ apps.',
        shortValue: 'Dedicated Agents product for multi-step AI tasks',
        confidence: 'estimated',
        sources: [
          { url: 'https://zapier.com/agents', label: 'Zapier Agents overview', asOf: '2026-07-02' },
        ],
      },
      naturalLanguageBuilding: {
        value: 'Yes',
        detail:
          'Zapier Copilot (open beta) lets a user describe an automation or agent in plain language and generates a draft workflow, including writing custom code to fill integration gaps.',
        shortValue: 'Copilot builds Zaps/agents from plain-language prompts',
        confidence: 'verified',
        sources: [
          {
            url: 'https://zapier.com/blog/zapier-copilot-guide/',
            label: 'Zapier Copilot: Build systems even faster with AI',
            asOf: '2026-07-02',
          },
        ],
      },
      knowledgeBaseRag: {
        value: 'Yes (limited)',
        detail:
          "Zapier Agents/chatbots support adding FAQs, docs, and public links as a knowledge source so the agent can answer from that content, though the underlying retrieval implementation isn't detailed publicly.",
        shortValue: 'Agents can reference uploaded docs/FAQs as knowledge',
        confidence: 'estimated',
        sources: [
          { url: 'https://zapier.com/agents', label: 'Zapier Agents overview', asOf: '2026-07-02' },
        ],
      },
      mcpSupport: {
        value: 'Yes',
        detail:
          'Zapier operates a hosted MCP server (Streamable HTTP) exposing 9,000+ app connections and 30,000+ actions to any MCP client, and also offers an "MCP Client by Zapier" integration for calling external MCP servers from within Zaps. Costs 2 tasks per tool call, available on all plans.',
        shortValue: 'Hosted MCP server plus an MCP client to call others',
        confidence: 'verified',
        sources: [
          {
            url: 'https://zapier.com/blog/zapier-mcp-guide/',
            label: 'Zapier MCP: Perform 30,000+ actions in your AI tool',
            asOf: '2026-07-02',
          },
          { url: 'https://docs.zapier.com/mcp/home', label: 'Zapier MCP docs', asOf: '2026-07-02' },
        ],
      },
      evaluationGuardrails: {
        value: 'Unknown',
        detail:
          'Not publicly documented beyond basic Zap testing during setup. No dedicated eval, guardrail, or testing tooling is described.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      humanInTheLoop: {
        value:
          'Yes: dedicated "Human in the Loop" app with a Request Approval action distinct from a delay/wait step',
        detail:
          'Human in the Loop is a built-in (premium) app whose Request Approval action pauses the Zap run mid-workflow and asks one or more reviewers to approve, decline, or edit the submitted data before the run resumes. Reviewers are notified via email, Slack, or by routing the request to another Zap. Behavior on decline is configurable (continue or stop the run). This is separate from plain Delay/Filter steps, which have no approval semantics.',
        shortValue: 'Dedicated approval step mid-workflow',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/38731463206029-Request-approval-to-keep-your-workflow-running-with-Human-in-the-Loop',
            label: 'Request approval to keep your workflow running with Human in the Loop',
            asOf: '2026-07-02',
          },
          {
            url: 'https://zapier.com/blog/human-in-the-loop-guide/',
            label: 'Human in the Loop: Pause Zaps for human review and approval',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/38733184458765-Use-Human-in-the-Loop-to-pause-Zaps-pending-human-review',
            label: 'Use Human in the Loop to pause Zaps pending human review',
            asOf: '2026-07-02',
          },
        ],
      },
      generativeMedia: {
        value:
          'No native built-in image/video/audio generation blocks; reached only via third-party app integrations, including a native "AI by Zapier" LLM connector',
        detail:
          'Zapier has no first-party image, video, or text-to-speech generation step. Generative media is accessed by wiring in provider apps from its 9,000+ app directory, such as OpenAI\'s image generation and text-to-speech actions, Ideogram, ElevenLabs, Stable Diffusion, and dedicated apps like Text to Speech PRO. "AI by Zapier" gives access to top LLMs for text and prompt tasks without needing your own API key, but it is text-oriented, not a media-generation engine.',
        shortValue: 'No native generation blocks; reached via integrations',
        confidence: 'verified',
        sources: [
          {
            url: 'https://zapier.com/blog/automate-ai-images/',
            label: 'How to automate AI image generation | Zapier',
            asOf: '2026-07-02',
          },
          {
            url: 'https://zapier.com/apps/ai-tools',
            label: 'Zapier AI Tools | AI Agents, MCP, Chatbots, and more',
            asOf: '2026-07-02',
          },
          {
            url: 'https://zapier.com/blog/ai-models-on-zapier/',
            label: 'Which AI models can you automate on Zapier?',
            asOf: '2026-07-02',
          },
          {
            url: 'https://zapier.com/apps/zapier-chatbots/integrations/text-to-speech-pro',
            label: 'Zapier Chatbots + Text to Speech PRO Integration',
            asOf: '2026-07-02',
          },
        ],
      },
      dynamicToolUse: {
        value: 'Unknown',
        detail: 'Not publicly documented.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      modelFallback: {
        value: 'Unknown',
        detail: 'Not publicly documented.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      agentSkills: {
        value:
          'No: Zapier Agents use per-agent instructions and attachable knowledge sources (files, tables, webpages), but there is no documented feature for defining a reusable prompt or knowledge snippet once and reusing it by reference across multiple agents. Reuse happens informally, via templates and copy-adapt patterns, not a shared, reusable skill object.',
        detail:
          "Zapier's own best-practices guidance recommends teams 'develop reusable patterns that team members can adapt' and use agent-to-agent calls, which implies there is no built-in mechanism for a single named skill referenced across agents.",
        shortValue: 'No dedicated reusable skill object',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/24593355420429-Best-practices-for-working-with-Zapier-Agents',
            label: 'Best practices for working with Zapier Agents',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/24393442652557-Build-an-agent-in-Zapier-Agents',
            label: 'Build an agent in Zapier Agents',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeChatDeployment: {
        value:
          'Yes: Zapier Chatbots let a builder create a conversational AI agent connected to knowledge sources and 9,000+ apps, then deploy it via a public shareable URL or embed it on a website, Slack, or Teams.',
        detail:
          "Chatbots and Interfaces are public by default unless restricted on a paid plan; the 'Built on Zapier' footer label can be removed on paid plans.",
        shortValue: 'Yes: public chatbot URL or embed',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/21958023866381-Share-and-embed-a-chatbot',
            label: 'Share and embed a chatbot',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/21960697323533-Set-up-a-chatbot',
            label: 'Set up a chatbot',
            asOf: '2026-07-02',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          "Unknown: Zapier documents how knowledge sources (files, tables, webpages) are attached and synced to Chatbots/AI by Zapier, and notes that a source's counted size is based on extracted text. No help article or blog post describes a chunk-level debugging view showing chunk index or individual chunk content in search results.",
        detail:
          'Zapier discloses sync/size mechanics but not a retrieval debugging UI exposing individual chunks.',
        shortValue: 'Unknown, no chunk-level view documented',
        confidence: 'unknown',
        sources: [],
      },
      parallelExecution: {
        value:
          'No dedicated fan-out/fan-in node. Paths lets multiple branches match and run at the same time, but Zapier is deprecating that behavior: new Paths only support sequential branch execution as of September 30, 2025, and existing Zaps are being migrated off parallel execution.',
        detail:
          'Zapier documents Paths as either running all matching branches at once (legacy default) or one after another (sequential, now the only option for new Paths). There is no join step that fans a run out and merges branch results back into one output.',
        shortValue: 'No, Paths is moving to sequential-only',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/37562074726029-Now-available-sequential-path-runs',
            label: 'Now available: sequential path runs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496288555917-Add-branching-logic-to-Zap-workflows-with-Paths',
            label: 'Add branching logic to Zap workflows with Paths',
            asOf: '2026-07-02',
          },
        ],
      },
      a2aProtocol: {
        value:
          'No documented support. Zapier has published an explainer on the Agent2Agent (A2A) protocol as an industry standard, but no Zapier help article, changelog, or product page states that Zapier Agents implement A2A or expose an Agent Card for peer-to-peer agent discovery.',
        detail:
          "Zapier's own A2A blog post describes the protocol generically and only references Zapier Agents' existing ability to connect to other apps, not A2A compliance.",
        shortValue: 'No, not documented',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://zapier.com/blog/a2a-protocol/',
            label: 'What is the A2A protocol? (Zapier blog)',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value: '9,000+ apps',
        detail:
          'Zapier\'s own app directory states "9,000+ apps" and "No-code automation across 9,000+ apps."',
        shortValue: '9,000+ apps',
        confidence: 'verified',
        sources: [
          { url: 'https://zapier.com/apps', label: 'Zapier App Directory', asOf: '2026-07-02' },
        ],
      },
      triggerTypes: {
        value:
          'App-event triggers (via 9,000+ app integrations), scheduled triggers, webhooks, and chat/agent triggers',
        detail:
          "Zapier's core model is app-event triggers per integration; it also supports Webhooks by Zapier and Schedule by Zapier as generic trigger apps, plus chat-based triggers for Agents/Chatbots.",
        shortValue: 'App events, schedules, webhooks, and chat triggers',
        confidence: 'estimated',
        sources: [
          { url: 'https://zapier.com/apps', label: 'Zapier App Directory', asOf: '2026-07-02' },
        ],
      },
      customCodeSteps: {
        value: 'Yes: JavaScript and Python code steps',
        detail:
          "Zapier's Code by Zapier step lets users run custom JavaScript or Python within a Zap; Copilot can also auto-generate code steps to fill integration gaps.",
        shortValue: 'JavaScript and Python code steps',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://zapier.com/blog/zapier-copilot-guide/',
            label: 'Zapier Copilot: Build systems even faster with AI',
            asOf: '2026-07-02',
          },
        ],
      },
      apiPublishing: {
        value: 'Unknown',
        detail:
          'Not documented as a first-class option for publishing a Zap or agent directly as a REST API or SDK endpoint, distinct from webhook triggers or MCP tool exposure.',
        shortValue: 'Not documented as a first-class API',
        confidence: 'unknown',
        sources: [],
      },
      extensibilitySdk: {
        value:
          'Official Zapier Platform CLI/SDK (Node.js/TypeScript) plus a low-code Platform UI builder, publishing to a public app marketplace',
        detail:
          "Zapier's Developer Platform offers two paths: the visual Platform UI (low-code) and the Zapier Platform CLI/SDK (open-sourced on GitHub) for writing custom integrations in JavaScript/TypeScript, including custom auth and deployment. No separate SDK is offered in other languages. Completed integrations can be published to Zapier's public marketplace (9,000+ apps, 1M+ users) or kept private. A companion Workflow API also lets third parties embed Zapier's automation marketplace into their own products.",
        shortValue: 'Platform CLI/SDK (Node/TS) plus low-code builder',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.zapier.com/platform/home',
            label: 'Zapier Developer Platform docs: Welcome',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/zapier/zapier-platform-cli',
            label: 'GitHub: zapier/zapier-platform-cli',
            asOf: '2026-07-02',
          },
          {
            url: 'https://zapier.com/developer-platform',
            label: 'Power your product or AI agent with 9,000 app integrations | Zapier',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developer.zapier.com/cli-guide',
            label: 'Platform UI | Zapier developer docs',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpPublishing: {
        value:
          "No: Zapier MCP works in one direction only. It runs a hosted MCP server that exposes Zapier's own library of 9,000+ app actions for external AI clients (Claude, Cursor, etc.) to call, but there is no documented feature letting a user publish their own Zap or workflow as a callable MCP endpoint for outside consumers.",
        detail:
          "All Zapier MCP documentation frames the flow as 'connect your AI client into Zapier's actions', never the reverse of exposing a user's Zap as an MCP server.",
        shortValue: 'No: MCP is Zapier-to-client only, not publishable',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.zapier.com/mcp/home',
            label: 'Zapier MCP docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://zapier.com/mcp',
            label: 'Connect AI tools to 9,000 apps with Zapier MCP',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Metered task-based (per successfully completed action step), tiered by monthly task allotment plus seat-gated Team/Enterprise tiers',
        detail:
          'A task is one completed action step in a Zap; trigger steps are free. MCP tool calls cost 2 tasks each. Plans are sold as monthly task blocks (e.g., 750, 2,000) with per-user limits on Team/Enterprise.',
        shortValue: 'Metered per-task pricing, tiered by monthly allotment',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.activepieces.com/blog/zapier-pricing',
            label: 'Zapier Pricing Breakdown (third-party)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://zapier.com/blog/zapier-mcp-guide/',
            label: 'Zapier MCP guide (task cost per tool call)',
            asOf: '2026-07-02',
          },
        ],
      },
      entryPaidPlan: {
        value:
          'Professional plan, from $19.99/month (annual billing) or $29.99/month (monthly billing) for 750 tasks',
        detail:
          "Includes unlimited Zaps, multi-step Zaps, and premium app access beyond the free tier's 2-step limit.",
        shortValue: 'Professional plan from $19.99/mo for 750 tasks',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.activepieces.com/blog/zapier-pricing',
            label: 'Zapier Pricing Breakdown (third-party)',
            asOf: '2026-07-02',
          },
        ],
      },
      freeTier: {
        value: 'Yes: 100 tasks/month, limited to 2-step Zaps (one trigger, one action)',
        shortValue: '100 tasks/month, two-step Zaps only',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.activepieces.com/blog/zapier-pricing',
            label: 'Zapier Pricing Breakdown (third-party)',
            asOf: '2026-07-02',
          },
        ],
      },
      byok: {
        value: 'Yes, for Chatbots/AI steps',
        detail:
          "Zapier Chatbots default to GPT-4.1 mini but let users add their own API key for OpenAI, Anthropic Claude, Google Gemini, or Azure OpenAI, with usage billed directly to the user's own provider account.",
        shortValue: 'Bring your own key for Chatbots/AI steps',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/21959873616013-Use-your-own-API-key-with-a-Zapier-Chatbot',
            label: 'Use your own API key with a Zapier Chatbot',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    security: {
      soc2: {
        value: 'SOC 2 Type II and SOC 3 certified',
        detail:
          'Reports are published and available via the Zapier Trust Center (trust.zapier.com); Zapier also references GDPR and CCPA compliance.',
        shortValue: 'SOC 2 Type II and SOC 3 certified',
        confidence: 'verified',
        sources: [
          {
            url: 'https://zapier.com/blog/zapier-completes-soc-2-compliance-audit/',
            label: 'Zapier completes SOC 2 compliance audit',
            asOf: '2026-07-02',
          },
          { url: 'https://trust.zapier.com/', label: 'Zapier Trust Center', asOf: '2026-07-02' },
        ],
      },
      dataResidency: {
        value: 'No selectable data residency documented',
        detail:
          "Zapier's security page states its infrastructure runs on AWS in the United States, with no alternative region or EU-hosting option documented for standard customers.",
        shortValue: 'No selectable region; US-only (AWS)',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://zapier.com/security-compliance',
            label: 'Zapier Security & Compliance (via fetch cache)',
            asOf: '2026-07-02',
          },
        ],
      },
      rbac: {
        value: 'Yes',
        detail:
          'Team-based access controls, app allowlisting/blocklisting, endpoint-level action restrictions, domain restrictions, and workspace/federated governance on Team/Enterprise plans.',
        shortValue: 'Team-based access controls and app allowlisting',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://zapier.com/security-compliance',
            label: 'Zapier Security & Compliance (via fetch cache)',
            asOf: '2026-07-02',
          },
        ],
      },
      auditLogging: {
        value: 'Yes',
        detail:
          'Zapier describes immutable audit records tracking every workflow, change, and data flow; plan-level gating (Team vs. Enterprise) is not specified.',
        shortValue: 'Immutable audit records across workflows and changes',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://zapier.com/security-compliance',
            label: 'Zapier Security & Compliance (via fetch cache)',
            asOf: '2026-07-02',
          },
        ],
      },
      additionalCompliance: {
        value:
          "SOC 2 Type II, SOC 3, GDPR, and CCPA compliant. Not HIPAA-compliant (no BAAs, PHI unsupported). Some third-party sources also cite ISO 27001 and PCI DSS, though these aren't confirmed on Zapier's own trust page.",
        detail:
          "Zapier's security page states it maintains SOC 2 Type II, SOC 3, GDPR, and CCPA compliance, with enterprise customers auto-opted-out of AI data training and full reports available via the Zapier Trust Center. Zapier explicitly does not support regulated healthcare or PHI data under HIPAA and will not sign BAAs. It also certifies to the EU-US/UK/Swiss-US Data Privacy Framework. ISO 27001 and PCI DSS are cited by secondary sources only, and are not listed on Zapier's own trust or security page.",
        shortValue: 'SOC 2, SOC 3, GDPR, CCPA. Not HIPAA-compliant',
        confidence: 'verified',
        sources: [
          {
            url: 'https://zapier.com/security-compliance',
            label: 'Zapier | Secure and Compliant AI Orchestration at Scale',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496181993613-Security-and-Compliance',
            label: 'Security and Compliance – Zapier Help Center',
            asOf: '2026-07-02',
          },
          {
            url: 'https://trust.zapier.com/',
            label: 'Zapier Trust Center | Powered by Conveyor',
            asOf: '2026-07-02',
          },
          {
            url: 'https://zapier.com/legal/data-privacy',
            label: 'Data Privacy Overview | Zapier',
            asOf: '2026-07-02',
          },
        ],
      },
      modelAndToolGovernance: {
        value: 'Unknown',
        detail: 'Not publicly documented.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      credentialGovernance: {
        value:
          "Yes, but coarser than per-role credential controls: Zapier lets an owner share a specific app connection with chosen users or teams (Enterprise), and Enterprise 'managed apps' let admins mark specific apps as admin-only, so only admins can create or share connections for that app while members can still use admin-shared ones. This governs connections at the app/sharing level, not a fine-grained per-role permission matrix over individual stored credentials.",
        detail:
          'Admins can also globally restrict connection sharing account-wide via a toggle in the Admin Center.',
        shortValue: 'Coarse: connection sharing plus admin-managed apps',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496326497037-Share-app-connections-with-members-of-your-Team-or-Enterprise-account',
            label: 'Share app connections with members of your Team or Enterprise account',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/44795921426317-Manage-app-connections-with-managed-apps',
            label: 'Manage app connections with managed apps',
            asOf: '2026-07-02',
          },
        ],
      },
      whiteLabeling: {
        value:
          "Yes, but partial and tiered: Zapier offers a White Label product for embedding automation UI into a customer's own product (Company/Enterprise pricing). Separately, paid-plan customers can remove the 'Built on Zapier' label from Chatbots and Forms and apply custom brand colors and a logo to Forms. There is no full platform-wide white-labeling of the core Zap editor or workspace itself.",
        detail:
          'White Label is a distinct embedded product for SaaS builders; branding removal on Chatbots/Forms is a separate, narrower feature gated behind paid plans.',
        shortValue: 'Partial: White Label embed product, tiered branding removal',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.zapier.com/white-label/getting-started',
            label: 'White Label getting started',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/15932034572685-Customize-branding-and-colors-in-Zapier-Forms',
            label: 'Customize branding and colors in Zapier Forms',
            asOf: '2026-07-02',
          },
        ],
      },
      dataRetention: {
        value:
          'Yes, but Enterprise-only: Enterprise admins can customize Zap history retention to 7-30 days. Free, Professional, and Team plans keep the default retention window and cannot customize it.',
        detail:
          'The setting is account-wide, affecting all shared and unshared Zap history, and changes can take up to 24 hours to apply.',
        shortValue: 'Yes, Enterprise-only: 7-30 day configurable retention',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496327478413-Customize-data-retention-in-Zapier',
            label: 'Customize Zap history retention in Zapier',
            asOf: '2026-07-02',
          },
        ],
      },
      piiRedaction: {
        value:
          "No: no dedicated PII detection/redaction feature is documented. Zapier's public data-privacy material addresses it as a data processor with SOC 2 Type 2 / SOC 3 certifications and explicitly states it does not support regulated PHI/HIPAA data or sign BAAs, but does not describe an automatic PII-scanning or redaction capability for workflow content or logs.",
        detail:
          'Any PII handling would rely on third-party formatter steps or external tools, not a native Zapier guardrail.',
        shortValue: 'No documented PII detection or redaction',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://zapier.com/legal/data-privacy',
            label: 'Data Privacy Overview',
            asOf: '2026-07-02',
          },
          {
            url: 'https://zapier.com/legal/data-retention-deletion',
            label: 'Data Retention/Deletion/Export',
            asOf: '2026-07-02',
          },
        ],
      },
      sso: {
        value:
          'Yes: Zapier supports SAML 2.0 single sign-on (both Zapier-initiated and IdP-initiated), with Just-in-Time provisioning to auto-create user accounts on first login and optional Single Logout, on Team plans (SSO now included) and Enterprise plans.',
        detail:
          'Documented integration guides exist for Okta, Google Workspace, Microsoft Entra, JumpCloud, Duo, and OneLogin.',
        shortValue: 'Yes: SAML SSO with JIT auto-provisioning',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496279747085-Set-up-single-sign-on-with-SAML',
            label: 'Set up single sign-on with SAML',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/33678718215309-Team-plan-updates-SSO-is-now-included-and-new-user-limits',
            label: 'Team plan updates: SSO is now included and new user limits',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Customer-facing per-run/per-step execution detail (Zap History) plus an account-level Analytics dashboard with success/error rate and task-usage metrics; no distributed-tracing spans or latency-percentile metrics',
        detail:
          "Zap History logs every Zap run (up to 60 days / 10,000 runs) with per-step input/output detail and run status. The Analytics dashboard (Team/Enterprise) shows success-vs-error run percentages and task usage over time. Log Streams push real-time webhook events to a customer's own endpoint for external monitoring or SIEM dashboards. There is no built-in latency-percentile view or distributed trace graph.",
        shortValue: 'Per-run/step history and analytics, no distributed tracing',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496291148685-View-and-manage-your-Zap-history',
            label: 'View and manage your Zap history – Zapier',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/20512774106125-View-specific-Zap-run-details',
            label: 'View specific Zap run details – Zapier',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/25444544607373-Review-your-account-usage-in-the-analytics-dashboard',
            label: 'Review your account usage in the analytics dashboard – Zapier',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/43732241361421-Set-up-log-streams-to-monitor-Zap-activity',
            label: 'Set up log streams to monitor Zap activity – Zapier',
            asOf: '2026-07-02',
          },
        ],
      },
      durabilityModel: {
        value:
          'Automatic retries (Autoreplay) on a fixed backoff schedule, plus manual replay of a past run using its original captured input data. No arbitrary mid-run checkpointing',
        detail:
          'Autoreplay (Professional plan and up) automatically retries an errored Zap run on a fixed schedule: 5 min, 30 min, 1 hr, 3 hr, and 6 hr after the initial failure (about a 10-hour window). Users can also manually replay any past Zap run from Zap History, which re-executes it using the exact original input data. Replay operates at the whole-run level, not an arbitrary intermediate checkpoint, and editing a Zap after a failure changes what a later Autoreplay attempt runs.',
        shortValue: 'Fixed-schedule autoretries plus manual replay of runs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/19220226086797-What-is-replay',
            label: 'What is replay? – Zapier',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496241726989-Replay-Zap-runs',
            label: 'Replay Zap runs – Zapier',
            asOf: '2026-07-02',
          },
          {
            url: 'https://zapier.com/help/autoreplay/',
            label: 'Autoreplay Tasks - Integration Help & Support | Zapier',
            asOf: '2026-07-02',
          },
        ],
      },
      failureAlerting: {
        value:
          'Yes: proactive default email alerts on Zap errors, configurable per-app frequency, plus auto-turn-off warnings and a dedicated "Zapier Manager" app for routing failure and pause events anywhere',
        detail:
          'By default, Zapier emails the account owner when a Zap errors, with per-app notification frequency configurable. If a Zap crosses a 95% error-rate threshold over 7 days, Zapier auto-turns it off, first sending a warning email with a grace period (24 hours on Team, 72 hours on Enterprise). The Zapier Manager app can trigger a Zap whenever any other Zap errors, is turned off, or is paused, so alerts can route to Slack, SMS, PagerDuty, or elsewhere. While Autoreplay is actively retrying, no error email is sent until the final attempt fails.',
        shortValue: 'Default error emails, shutoff warnings, routable alerts',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496289225229-Manage-notifications-when-errors-occur-in-Zap-workflows',
            label: 'Manage notifications when errors occur in Zap workflows – Zapier',
            asOf: '2026-07-02',
          },
          {
            url: 'https://zapier.com/apps/email/integrations/zapier-manager/60539/send-emails-with-new-zap-errors',
            label: 'Send emails with new Zap errors (Zapier Manager template)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://zapier.com/apps/email/integrations/zapier-manager/152952/send-notification-emails-for-new-zaps-turned-off',
            label: 'Send notification emails for new Zaps turned off (Zapier Manager template)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://zapier.com/help/autoreplay/',
            label: 'Autoreplay Tasks - Integration Help & Support | Zapier',
            asOf: '2026-07-02',
          },
        ],
      },
      dataDrains: {
        value:
          "Yes: Zapier offers 'Log streams' (Enterprise) that continuously stream Zap configuration-change and run-outcome events to an external SIEM/monitoring destination such as Datadog or Splunk, in addition to an in-product account-wide audit log with a Zap Runs API for pulling history.",
        detail:
          "Log streams only capture events going forward from when they're configured, not historical backfill.",
        shortValue: 'Yes: log streams to Datadog, Splunk, SIEM',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/43732241361421-Set-up-log-streams-to-monitor-Zap-activity',
            label: 'Set up log streams to monitor Zap activity',
            asOf: '2026-07-02',
          },
          {
            url: 'https://zapier.com/blog/mpe-admin-center-audit-logs/',
            label: 'Complete Control: Multi-Product Experience & Admin Center',
            asOf: '2026-07-02',
          },
        ],
      },
      asyncExecution: {
        value:
          "Yes: Zapier's webhook trigger is asynchronous by design. It returns an HTTP 200 immediately upon receipt, then runs the rest of the Zap in the background rather than holding the connection open until the workflow finishes. However, Zapier has no native way to poll for a specific run's later result inside that same Zap. Teams that need to check back for a result must build a second Zap plus a Zapier Table (or similar external store) to record and later retrieve completion status, per Zapier's own documentation and community guidance.",
        detail:
          "Zapier's Webhooks by Zapier trigger explicitly does not keep the request open to return final JSON from later steps. Zapier's own recommended pattern for checking a result later is two separate Zaps coordinated through a Table, not a built-in job-status or polling API.",
        shortValue: 'Fire-and-forget webhooks, no native result polling',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496288690317-Trigger-Zaps-from-webhooks',
            label: 'Zapier Help: Trigger Zap workflows from webhooks',
            asOf: '2026-07-02',
          },
          {
            url: 'https://community.zapier.com/code-webhooks-52/using-a-webhook-api-to-process-responses-in-zapier-52858',
            label: 'Zapier Community: Using a Webhook API to process responses in Zapier',
            asOf: '2026-07-02',
          },
        ],
      },
      executionLimits: {
        value:
          "Zapier publishes several concrete limits. A standard action or search step must finish in 30 seconds or it times out. Code by Zapier steps are capped at 10 seconds of script runtime on Starter plans and 30 seconds on Pro, Team, and Company plans. Zap workflows are capped at 100 total steps (including all steps within Paths). Instant triggers are rate-limited to 20,000 requests per 5 minutes per user (429 errors beyond that). Polling triggers on Free/Trial plans are limited to 200 requests per 10 minutes per Zap. Private-app API calls are limited to 100 requests per 60 seconds on Free/Professional plans and 5,000 requests per 60 seconds on Team/Enterprise plans. Zapier also applies 'flood protection' that holds and throttles trigger events when 100+ fire at once for the same Zap.",
        detail:
          "Zapier does not publish a single named 'concurrency limit' per account/org the way some platforms do; concurrency is effectively bounded indirectly through the per-Zap/per-user rate limits and flood-protection holding above 100 simultaneous trigger events.",
        shortValue: '30s step timeout, 100-step cap, published rate limits',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.zapier.com/platform/build/troubleshoot-action-timeouts',
            label: 'Zapier Platform Docs: Troubleshoot action timeouts',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496181445261-Zap-limits',
            label: 'Zapier Help: Zap limits',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/14166919366413-Run-more-Code-by-Zapier-steps-with-increased-timeouts-and-throttle-limits',
            label:
              'Zapier Help: Run more Code by Zapier steps with increased timeouts and throttle limits',
            asOf: '2026-07-02',
          },
        ],
      },
      partialFailureHandling: {
        value:
          "Yes: Zapier supports custom error handling. Adding an error handler to a step splits the Zap into a Success path and an Error path, and the Error path runs automatically in place of the normal flow whenever that specific step fails, letting the Zap take a defined alternate action instead of simply halting. This differs from the Zap's generic error-ratio auto-shutoff behavior for unhandled failures, and error handlers are only available on Professional, Team, and Enterprise plans, not Free.",
        detail:
          'The failed step itself still produces no output and its fields are not passed downstream, but the error handler path executes as a defined replacement branch rather than the whole Zap simply stopping. This capability is plan-gated (not available on Free).',
        shortValue: 'Error handler paths reroute on step failure',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.zapier.com/hc/en-us/articles/22495436062605-Set-up-custom-error-handling',
            label: 'Zapier Help: Set up custom error handling',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Email/ticket support for all paid plans, Zapier Community forum (public, no account required), plus premium support (chat/priority) on Team and above',
        shortValue: 'Email support, community forum, premium chat on Team+',
        confidence: 'estimated',
        sources: [
          { url: 'https://community.zapier.com/', label: 'Zapier Community', asOf: '2026-07-02' },
          {
            url: 'https://help.zapier.com/hc/en-us/articles/8496213764877-Get-help-and-support-with-Zapier',
            label: 'Get help and support with Zapier',
            asOf: '2026-07-02',
          },
        ],
      },
      sla: {
        value:
          'Tiered response-time targets: Professional ~8hr weekday/24hr weekend; Team ~1hr first response/4hr follow-up; Enterprise ~30min first response/15min for critical issues, with a Technical Account Manager offering ~6 hours/month of support',
        shortValue: 'Tiered response times, fastest on Enterprise',
        confidence: 'estimated',
        sources: [
          { url: 'https://zapier.com/enterprise', label: 'Zapier Enterprise', asOf: '2026-07-02' },
        ],
      },
      community: {
        value: 'Unknown exact size',
        detail:
          'Zapier operates a public Community forum open to all without an account requirement, but no member-count figure is publicly published.',
        shortValue: 'Public forum, member count not published',
        confidence: 'unknown',
        sources: [],
      },
      companyMaturity: {
        value:
          'Founded 2011/2012 (Y Combinator), started in Columbia, MO and now remote-first; ~1,482 employees (as of May 2026); ~$5B valuation on only ~$1.4M total outside funding raised; profitable since 2014',
        detail:
          'Zapier was founded in 2011 by Wade Foster, Bryan Helmig, and Mike Knoop, launching out of Y Combinator in 2012. It raised only about $1.2M in seed funding (Bessemer, DFJ, angels, Oct 2012), roughly $1.4M in total outside funding, while reaching a reported $5B valuation (as of Feb 2026) and maintaining profitability since 2014. Employee count is approximately 1,482 as of May 31, 2026, per third-party company data.',
        shortValue: 'Founded 2011, ~1,482 employees, profitable since 2014',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.crunchbase.com/organization/zapier',
            label: 'Zapier - Crunchbase Company Profile & Funding',
            asOf: '2026-07-02',
          },
          {
            url: 'https://en.wikipedia.org/wiki/Zapier',
            label: 'Zapier - Wikipedia',
            asOf: '2026-07-02',
          },
          {
            url: 'https://tracxn.com/d/companies/zapier/__M0GRI5XzSGaxAGJkKBYUSwpVmq148p0Ngn32DrgXz90',
            label: 'Zapier - 2026 Company Profile, Team, Funding & Competitors - Tracxn',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pitchbook.com/profiles/company/55509-31',
            label: 'Zapier 2026 Company Profile: Valuation, Funding & Investors | PitchBook',
            asOf: '2026-07-02',
          },
        ],
      },
      academy: {
        value:
          'Yes: Zapier operates Zapier Academy (learn.zapier.com), a structured hub of self-paced courses, tutorials, and learning paths, plus a Certified Zapier Expert program with an application, an exam, and an expert directory listing.',
        detail:
          'Zapier Academy covers beginner to advanced automation topics; certification is a separate application-based exam program leading to a badge and directory listing.',
        shortValue: 'Yes: Academy plus expert certification program',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.zapier.com/',
            label: 'Zapier Academy',
            asOf: '2026-07-02',
          },
          {
            url: 'https://community.zapier.com/show-tell-5/zapier-certification-42220',
            label: 'Zapier Certification community thread',
            asOf: '2026-07-02',
          },
        ],
      },
    },
  },
}
