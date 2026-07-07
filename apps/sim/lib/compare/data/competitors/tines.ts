import { TinesIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Researched and cross-verified against live vendor sources on 2026-07-02. */
export const tinesProfile: CompetitorProfile = {
  id: 'tines',
  name: 'Tines',
  website: 'https://www.tines.com',
  brand: {
    icon: TinesIcon,
    selfFramed: true,
    colors: ['#8c74e3', '#c4b4dd', '#f2eef7'],
    source: 'Context.dev brand-intelligence API',
    asOf: '2026-07-02',
  },
  oneLiner:
    'Tines is a proprietary workflow automation platform, available cloud-hosted or self-hosted, originally built for security operations. Teams build event-driven "Stories" via a visual no/low-code canvas, natural language, or the API. It recently added native AI agent, MCP, and copilot capabilities.',
  standoutFeatures: [
    {
      title: 'ISO 42001 AI-governance certification',
      description:
        'Tines announced the "ISO trifecta" on April 14, 2026: ISO 27001, ISO 27701, and ISO 42001, the international standard for AI management systems.',
      shortDescription: 'Holds ISO 27001, ISO 27701, and ISO 42001 AI-governance certification.',
      source: {
        url: 'https://www.tines.com/blog/tines-achieves-the-iso-trifecta-iso-27001-iso-27701-and-iso-42001-certification/',
        label: 'Tines achieves the ISO trifecta',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'API-centric integration model',
      description:
        'Instead of a fixed library of app connectors, Tines is built around a generic HTTP Request action that calls any API directly, trading pre-built connectors for broader reach and more manual setup.',
      shortDescription:
        'A generic HTTP Request action reaches any API instead of fixed connectors.',
      source: {
        url: 'https://www.tines.com/blog/solving-the-integrations-problem/',
        label: 'Solving the integrations problem',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Tines University certification ladder',
      description:
        'Tines University pairs free foundational courses with instructor-led and self-paced Bootcamps and two certification tiers, Core and Advanced, that builders can share on LinkedIn. Sim Academy is a structured docs section without a formal certification path.',
      shortDescription: 'Core and Advanced certifications builders can share on LinkedIn.',
      source: {
        url: 'https://www.tines.com/get-certified/',
        label: 'Get certified | Tines',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Story version history with diff preview and rollback',
      description:
        'Every Story auto-saves versions (on a 5-minute inactivity timer or manually), with a preview mode that highlights exactly what changed between versions and one-click restore.',
      shortDescription: 'Auto-saved versions with diff preview and one-click rollback.',
      source: {
        url: 'https://www.tines.com/docs/stories/story-versioning/',
        label: 'Story versions docs',
        asOf: '2026-07-02',
      },
    },
  ],
  limitations: [
    {
      title: 'No public pricing above the free tier',
      description:
        'Business and Enterprise plans have no published dollar pricing. Buyers must contact sales to get a quote, making self-serve cost comparison impossible.',
      shortDescription: 'Business and Enterprise pricing requires contacting sales.',
      source: {
        url: 'https://explained.tines.com/en/articles/9620399-understanding-tines-pricing-and-packaging',
        label: 'Understanding Tines pricing and packaging',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'No cross-environment (dev/qa/prod) promotion model',
      description:
        'Version control is scoped to a single Story (auto-saved versions, diff, restore), not a fork/branch model for promoting a whole project between environments. The closest analog is in-place "Change Control" approval gating on edits.',
      shortDescription: 'No dev/qa/prod promotion model, only in-place change approval.',
      source: {
        url: 'https://www.tines.com/docs/stories/change-control/',
        label: 'Change Control docs',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'No documented built-in generative media blocks',
      description:
        'Public docs show text-oriented AI features (AI Action, Agents, Workbench) via LLM providers, but no dedicated image, video, or text-to-speech/speech-to-text generation blocks. Those calls would need to go through the generic HTTP Request action against a third-party API.',
      shortDescription: 'No built-in image, video, or speech generation blocks.',
      source: { url: 'https://www.tines.com/docs/admin/ai/', label: 'AI docs', asOf: '2026-07-02' },
    },
    {
      title: 'Not open source',
      description:
        'Tines is a closed-source commercial SaaS/self-hosted product; the free "Community Edition" is a limited product tier (1 builder, 3 flows, 25,000 monthly events), not an open-source license.',
      shortDescription: 'Closed-source SaaS with a limited free tier, not an open-source license.',
      source: {
        url: 'https://explained.tines.com/en/articles/9620399-understanding-tines-pricing-and-packaging',
        label: 'Understanding Tines pricing and packaging',
        asOf: '2026-07-02',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          "Visual event-driven builder ('Stories') plus 'Workbench,' a natural-language AI copilot for building and editing stories. Workbench absorbed the former 'Story Copilot,' which was renamed 'Workbench for Storyboard' on June 2, 2026.",
        shortValue: 'Visual Stories canvas plus Workbench AI copilot',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/platform/',
            label: 'Tines Platform overview',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/blog/intelligent-workflow-automation/',
            label: 'Intelligent workflow automation explained',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/whats-new/workbench-for-stories/',
            label: "Tines What's New",
            asOf: '2026-07-02',
          },
        ],
      },
      learningCurve: {
        value:
          'Moderate. Tines favors direct HTTP/API actions over pre-built app connectors, giving flexibility but requiring more configuration knowledge than typical no-code tools',
        shortValue: 'Moderate. API-centric, more setup than typical no-code',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/blog/solving-the-integrations-problem/',
            label: 'Solving the integrations problem (API-centric approach)',
            asOf: '2026-07-02',
          },
        ],
      },
      selfHostOption: {
        value:
          'Yes: self-hosted deployment available on Business and Enterprise editions, alongside cloud-hosted',
        shortValue: 'Self-hosted on Business/Enterprise, plus cloud',
        confidence: 'verified',
        sources: [
          {
            url: 'https://explained.tines.com/en/articles/9620399-understanding-tines-pricing-and-packaging',
            label: 'Understanding Tines pricing and packaging',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/security/',
            label: 'Security at Tines',
            asOf: '2026-07-02',
          },
        ],
      },
      deploymentOptions: {
        value:
          "Tines-hosted cloud, and self-hosted (customer's own data center/cloud) for Business/Enterprise",
        shortValue: 'Cloud-hosted or self-hosted (Business/Enterprise)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/security/',
            label: 'Security at Tines',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/docs/self-hosted/monitoring-tines/tenant-health-dashboard/',
            label: 'Self-hosted tenant health dashboard docs',
            asOf: '2026-07-02',
          },
        ],
      },
      templates: {
        value:
          'Large public "Tines library" of pre-built Story and Action templates across security, IT, HR, and other use cases',
        shortValue: 'Large public library across security, IT, HR',
        confidence: 'verified',
        sources: [
          { url: 'https://www.tines.com/library/', label: 'Tines Library', asOf: '2026-07-02' },
        ],
      },
      license: {
        value:
          'Proprietary, closed-source commercial SaaS product. Offers a permanently free "Community Edition" tier, not an open-source license',
        shortValue: 'Proprietary SaaS; free Community Edition tier',
        confidence: 'verified',
        sources: [
          {
            url: 'https://explained.tines.com/en/articles/9620399-understanding-tines-pricing-and-packaging',
            label: 'Understanding Tines pricing and packaging',
            asOf: '2026-07-02',
          },
        ],
      },
      environmentPromotion: {
        value:
          'No dev/qa/prod environment-promotion feature. Tines provides in-place "Change Control" (approval gating on edits to a single Story) and multi-team separation instead of cross-environment promotion of a whole project',
        shortValue: 'No cross-environment promotion; in-place Change Control only',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/docs/stories/change-control/',
            label: 'Change Control docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/security/',
            label: 'Security at Tines (Teams-based separation)',
            asOf: '2026-07-02',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Per-Story version history with auto-saved versions (every 5 min of inactivity or manual snapshot), diff preview between versions, and one-click restore. Scoped to a single Story, not a whole-project branch model',
        shortValue: 'Per-Story auto-save, diff preview, one-click rollback',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/docs/stories/story-versioning/',
            label: 'Story versions docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/blog/story-versioning/',
            label: 'Introducing Story versioning blog',
            asOf: '2026-07-02',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          'No: Tines has no live, concurrent multi-user editing of the same Story canvas (shared cursors, selections, synced changes in real time). Its collaboration model centers on Cases (async, ticket-like collaboration on top of Records) and Send to Story (passing execution between stories), not simultaneous canvas co-editing.',
        detail:
          'Story editing follows a draft/versioning model rather than Figma/Google-Docs-style live co-editing. No evidence found of a lock-based alternative.',
        shortValue: 'No: no live multi-user canvas editing',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/docs/records-cases/cases/',
            label: 'Cases | Docs | Tines',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/docs/stories/send-to-story/',
            label: 'Send to Story | Docs | Tines',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeFileStorage: {
        value:
          'No: Tines has no native, standalone file storage system with folder hierarchy, link-based sharing with auth options, or deleted-item recovery. File handling is per-feature: any action/tool can return a file to a Workbench user, and Pages can display file-related content, but there is no dedicated file-storage product.',
        detail:
          "Workbench file returns are scoped to a single user's chat session, not a shared workspace file store with folders/trash.",
        shortValue: 'No: no dedicated file storage system',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/docs/workbench/',
            label: 'Workbench | Docs | Tines',
            asOf: '2026-07-02',
          },
        ],
      },
      dataTables: {
        value:
          'No: Records and Cases is a structured-data feature where record types define fields (text, number, boolean, timestamp, fixed values). Its table view lets you rearrange or filter columns and export to CSV, but lacks spreadsheet-style keyboard navigation (arrow keys, copy-paste across cells) and the row/column limits of a true spreadsheet grid.',
        detail:
          'The closest analog, Records/Cases, is a data table by record type with customizable row counts (e.g. up to 50 rows shown), not a general-purpose spreadsheet.',
        shortValue: 'No: structured records, not spreadsheet grid',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/docs/records-cases/records/',
            label: 'Records | Docs | Tines',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/whats-new/introducing-cases-and-records/',
            label: 'Introducing cases and records | Tines',
            asOf: '2026-07-02',
          },
        ],
      },
      richTextEditor: {
        value:
          "Yes: Tines Pages has a rich text page element (renamed from 'paragraph') that supports Markdown formatting, and Markdown is also supported inline within Pages table cells.",
        detail:
          'Markdown-based rich text, not a full WYSIWYG document editor, but a genuine inline formatted-text authoring feature within the platform.',
        shortValue: 'Yes: Markdown-based rich text in Pages',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/whats-new/rich-text-in-pages-with-markdown/',
            label: "Rich text in pages with Markdown | What's New at Tines",
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/whats-new/markdown-support-in-page-table-cells/',
            label: "Markdown support in page table cells | What's New at Tines",
            asOf: '2026-07-02',
          },
        ],
      },
      subWorkflows: {
        value:
          "Yes: Tines' Send to Story action lets a parent Story call a separate sub-Story as a reusable step. The sub-story is configured with a webhook input action and a message-only output action; the parent's Send to Story action passes a payload, execution blocks until the sub-story finishes, and the sub-story's output event is returned to the calling action.",
        detail:
          'This is synchronous parent-waits-for-child composition with data passed in and returned, distinct from firing an independent story asynchronously via a plain webhook.',
        shortValue: 'Yes: Send to Story calls a sub-story, waits, returns data',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/docs/stories/send-to-story/',
            label: 'Send to Story | Docs | Tines',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/docs/stories/apis/',
            label: 'Workflows as APIs | Docs | Tines',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Yes: default AI runs on Anthropic Claude via AWS Bedrock (Tines-hosted), and customers can bring their own AI provider/key: OpenAI, Anthropic direct, or a custom AWS Bedrock account with any enabled model',
        shortValue: 'Bedrock-hosted Claude by default, BYO OpenAI/Anthropic/Bedrock',
        confidence: 'verified',
        sources: [
          { url: 'https://www.tines.com/docs/admin/ai/', label: 'AI docs', asOf: '2026-07-02' },
          {
            url: 'https://explained.tines.com/en/articles/10371885-use-a-preferred-ai-provider-in-tines',
            label: 'Use a preferred AI provider in Tines',
            asOf: '2026-07-02',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          'Yes: dedicated "Agents" capability for building autonomous/semi-autonomous AI agents and multi-agent orchestration inside workflows (e.g., multi-agent security investigation), separate from the core deterministic Story/Action model',
        shortValue: 'Dedicated Agents for autonomous multi-agent workflows',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/platform/agents/',
            label: 'Agents | Tines',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/platform/ai/',
            label: 'AI Agents, Copilots & MCP | Tines',
            asOf: '2026-07-02',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          "Story Copilot and Workbench are now one product. Story Copilot was rebranded 'Workbench for Storyboard' on June 2, 2026, and the same Workbench assistant covers both general chat and in-story building/editing.",
        shortValue: 'Workbench assistant builds and edits Stories from chat',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/platform/ai/',
            label: 'AI Agents, Copilots & MCP | Tines',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/whats-new/workbench-for-stories/',
            label: "Tines What's New",
            asOf: '2026-07-02',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          'Supports connecting to external knowledge sources (e.g. Notion, Glean, Confluence) for enterprise knowledge/RAG-style context in workflows, rather than a built-in vector database product',
        shortValue: 'Connects to Notion, Glean, Confluence for context',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/platform/ai/',
            label: 'AI Agents, Copilots & MCP | Tines',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpSupport: {
        value:
          'Yes: native support for both MCP servers and MCP clients, positioned as a governed way to expose Tines actions to AI and to consume external MCP tools',
        shortValue: 'Native MCP server and client support',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/platform/ai/',
            label: 'AI Agents, Copilots & MCP | Tines',
            asOf: '2026-07-02',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'Governance-oriented controls (policy-aligned MCP access, approvals, oversight), not a dedicated LLM-output evaluation/testing framework. No eval/guardrail product (output scoring, red-teaming) is documented',
        shortValue: 'Governance controls, no dedicated eval/guardrail product',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/platform/ai/',
            label: 'AI Agents, Copilots & MCP | Tines',
            asOf: '2026-07-02',
          },
        ],
      },
      humanInTheLoop: {
        value:
          '"Pages" let a running Story present a web form to a person for input mid-run, used for requester/approver flows. Exact pause/resume and notification mechanics are not publicly documented.',
        shortValue: '"Pages" collect mid-run input from people',
        confidence: 'estimated',
        sources: [
          { url: 'https://www.tines.com/docs/pages/', label: 'Pages docs', asOf: '2026-07-02' },
          {
            url: 'https://www.tines.com/library/stories/1144336/',
            label: 'Facilitate & approve user requests to specific tools (library story)',
            asOf: '2026-07-02',
          },
        ],
      },
      generativeMedia: {
        value:
          "No built-in image, video, or TTS/STT generation blocks. Tines' AI surface is text-oriented (AI Action, Agents, Workbench) via LLM providers; media generation requires the generic HTTP Request action against a third-party API.",
        shortValue: 'No built-in image/video/TTS/STT generation blocks',
        confidence: 'estimated',
        sources: [
          { url: 'https://www.tines.com/docs/admin/ai/', label: 'AI docs', asOf: '2026-07-02' },
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
          "Yes: Tines Workbench supports Agent Skills, an open standard for packaging specialized knowledge or workflows as a SKILL.md file (name, description, instructions) that the AI loads on demand. Skills are created and managed in a team's Skills section alongside credentials and templates, are team-scoped, and toggle per preset for reuse across the team.",
        detail:
          'Distinct from Presets (which bundle templates/stories/instructions); Skills specifically are reusable named knowledge snippets loaded on demand.',
        shortValue: 'Yes: Workbench Agent Skills (SKILL.md)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/whats-new/workbench-skills/',
            label: "Workbench skills | What's New at Tines",
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/docs/workbench/',
            label: 'Workbench | Docs | Tines',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeChatDeployment: {
        value:
          "Yes: Tines' AI Agent action supports a Chat mode that can be deployed as a public-facing page with an 'Anyone with the link' access option, requiring no Tines login for external users; it supports a configurable URL, theming, an initial message, and idle timeout.",
        detail:
          "This is a deployable chat surface built on the AI Agent action rather than a separate 'Chat' module, but it meets the bar of a publicly deployable conversational surface.",
        shortValue: 'Yes: public AI Agent chat pages',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/whats-new/public-ai-agent-action-chats/',
            label: '"Anyone with the link" access for AI agent chat | What\'s New at Tines',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/docs/actions/types/ai-agent/',
            label: 'AI Agent | Docs | Tines',
            asOf: '2026-07-02',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          'Unknown: Tines has no documented native knowledge-base feature with chunk-level indexing or a debugging view exposing individual chunk index/content. Its AI Agent action can connect to external knowledge sources (e.g. Notion, Glean, Confluence), but the retrieval/chunk mechanics and any chunk-level visibility in the UI are undocumented.',
        detail:
          'Tines leans on external knowledge sources plus its AI Agent action rather than a first-party knowledge base UI with visible chunk debugging.',
        shortValue: 'Unknown: no documented chunk-level KB view',
        confidence: 'unknown',
        sources: [],
      },
      parallelExecution: {
        value:
          'Yes: Tines supports native fan-out/fan-in via its Explode and Implode actions. Explode splits an array into individual events that flow through the rest of the story concurrently while sharing the same story run GUID; Implode recombines those parallel branches back into a single event using that shared GUID plus an item count.',
        detail:
          'Explode/Implode is Tines’ dedicated split-and-rejoin mechanism, distinct from a single sequential loop over an array.',
        shortValue: 'Yes: Explode/Implode fan-out and fan-in actions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://explained.tines.com/en/articles/9361913-do-events-passed-from-an-explode-action-run-in-parallel-or-sequentially',
            label:
              'Do events passed from an explode action run in parallel or sequentially? | Tines Explained',
            asOf: '2026-07-02',
          },
        ],
      },
      a2aProtocol: {
        value:
          "No documented support. Tines' AI Agent action integrates with the Model Context Protocol (MCP) for connecting to remote tool servers, but no Tines documentation, changelog, or help center article describes support for the Agent2Agent (A2A) protocol or an Agent Card-based peer-to-peer agent discovery mechanism.",
        detail:
          'Tines documents MCP tool-calling explicitly. A2A is a distinct, newer standard for agent-to-agent (not agent-to-tool) communication and isn’t mentioned anywhere in Tines’ public docs.',
        shortValue: 'No documented A2A protocol support',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/docs/actions/types/ai-agent/',
            label: 'AI Agent | Docs | Tines',
            asOf: '2026-07-02',
          },
        ],
      },
      loopIteration: {
        value:
          'Yes: Tines actions (including Event Transform in message-only mode and Send to Story) support a Loop attribute that points at a list or object field on the incoming event and invokes the action once per element, exposing a LOOP object for the current item on each pass. This is a per-action for-each attribute rather than a visual loop container block, and runs one item at a time rather than concurrently, distinct from the Explode/Implode parallel fan-out mechanism.',
        detail:
          'Tines caps a single loop at fewer than 20,000 elements. The dedicated concurrent-fan-out counterpart is Explode/Implode, documented separately as parallelExecution.',
        shortValue: 'Yes: per-action Loop attribute, for-each over a list',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/university/advanced/looping/',
            label: 'Looping in Tines | Tines University',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/docs/actions/types/send-to-story/',
            label: 'Send to Story | Docs | Tines',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value:
          'Tines does not market a fixed integration count. It is deliberately API-centric (the "HTTP Request" action can call any API) while also offering "1000s of preconfigured Action templates" for tools like Jira, Slack, and CrowdStrike',
        shortValue: 'API-centric; 1000s of preconfigured Action templates',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/blog/solving-the-integrations-problem/',
            label: 'Solving the integrations problem',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/library/tools/',
            label: 'Tools | Tines library',
            asOf: '2026-07-02',
          },
        ],
      },
      triggerTypes: {
        value:
          'Webhook actions (unique inbound URL), scheduled/interval runs, Receive Email (IMAP or generated address), and Send-to-Story (synchronous inbound API call)',
        shortValue: 'Webhook, schedule, email, and Send-to-Story',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/docs/actions/types/webhook/',
            label: 'Webhook action docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/whats-new/schedule-with-cron-expressions/',
            label: 'Schedule with cron expressions',
            asOf: '2026-07-04',
          },
          {
            url: 'https://www.tines.com/docs/actions/types/receive-email/',
            label: 'Receive Email docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/docs/actions/types/send-to-story/',
            label: 'Send to Story docs',
            asOf: '2026-07-02',
          },
        ],
      },
      customCodeSteps: {
        value:
          'No general-purpose custom-code action. Logic is expressed via built-in "Formulas"/functions and HTTP Request actions rather than a Python/JS code node',
        shortValue: 'No general-purpose code step; Formulas and HTTP actions',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/docs/formulas/functions/',
            label: 'Functions docs',
            asOf: '2026-07-02',
          },
        ],
      },
      apiPublishing: {
        value:
          'Yes: "Workflows as APIs": a Story can be exposed via Send-to-Story so external callers can invoke it synchronously and optionally wait for a response',
        shortValue: 'Stories callable synchronously as APIs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/docs/stories/apis/',
            label: 'Workflows as APIs docs',
            asOf: '2026-07-02',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Full REST API (https://<tenant>/api/v1/...) covering Stories, Actions, Cases, audit logs, and more, but no dedicated client SDK or third-party integration marketplace. Extensibility runs through the generic HTTP Request action rather than an SDK/plugin marketplace',
        shortValue: 'Full REST API; no client SDK or marketplace',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/docs/api/welcome/',
            label: 'API welcome docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/blog/solving-the-integrations-problem/',
            label: 'Solving the integrations problem',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpPublishing: {
        value:
          'Yes: Tines lets you build an MCP server action directly on the storyboard, turning a Story into a callable MCP endpoint for external AI clients (e.g. Claude Desktop). The MCP server action configures which Tools (Public Templates, Private Templates, Send to Story) are exposed, supports HTTP Authorization header or URL-based secret auth, and the build panel provides ready-to-copy configuration for popular MCP clients.',
        detail:
          'Confirms the prior signal: any Story can be exposed as an MCP endpoint with configurable access/auth, the reverse direction of ordinary MCP client consumption.',
        shortValue: 'Yes: publish Stories as MCP servers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/docs/actions/templates/mcp-server/',
            label: 'MCP server | Docs | Tines',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/blog/introducing-mcp-servers/',
            label: 'New: Building MCP servers on Tines',
            asOf: '2026-07-02',
          },
          {
            url: 'https://explained.tines.com/en/articles/11931662-how-to-set-up-an-mcp-server-in-tines',
            label: 'How to set up an MCP server in Tines',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Tiered platform-fee model (Community / Business / Enterprise) with add-ons to expand capacity (flows, teams, apps, AI credits, tunnels). No self-serve published dollar pricing; Business/Enterprise are "Contact Tines"',
        shortValue: 'Tiered platform fee; Business/Enterprise are quote-only',
        confidence: 'verified',
        sources: [
          { url: 'https://www.tines.com/pricing/', label: 'Pricing | Tines', asOf: '2026-07-02' },
          {
            url: 'https://explained.tines.com/en/articles/9620399-understanding-tines-pricing-and-packaging',
            label: 'Understanding Tines pricing and packaging',
            asOf: '2026-07-02',
          },
        ],
      },
      entryPaidPlan: {
        value:
          'Business Edition. No public price; starts around 30 flows / 1 team / 100 users / 1.5M daily events per the pricing explainer, with self-hosting available',
        shortValue: 'Business Edition, price on request',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://explained.tines.com/en/articles/9620399-understanding-tines-pricing-and-packaging',
            label: 'Understanding Tines pricing and packaging',
            asOf: '2026-07-02',
          },
        ],
      },
      freeTier: {
        value:
          'Community Edition is free forever: 1 builder, 3 flows/apps, 1 team, 25,000 monthly events, 50 AI runtime credits/month, unlimited viewers, SSO included',
        shortValue: 'Community Edition free forever, limited usage',
        confidence: 'verified',
        sources: [
          {
            url: 'https://explained.tines.com/en/articles/9620399-understanding-tines-pricing-and-packaging',
            label: 'Understanding Tines pricing and packaging',
            asOf: '2026-07-02',
          },
        ],
      },
      byok: {
        value:
          "Yes, for AI/LLM keys. Customers can bring their own AI provider (OpenAI, Anthropic, or a custom AWS Bedrock account) instead of Tines' default Bedrock-hosted Claude, though the pricing page doesn't use the term BYOK",
        shortValue: 'Bring your own AI provider key',
        confidence: 'verified',
        sources: [
          {
            url: 'https://explained.tines.com/en/articles/10371885-use-a-preferred-ai-provider-in-tines',
            label: 'Use a preferred AI provider in Tines',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    security: {
      soc2: {
        value: 'Yes: SOC 2 Type II, audited annually',
        shortValue: 'SOC 2 Type II, audited annually',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/security/',
            label: 'Security at Tines',
            asOf: '2026-07-02',
          },
        ],
      },
      dataResidency: {
        value:
          "Cloud-hosted (Tines-managed, AWS-based) or self-hosted in the customer's own data center/region for data-residency requirements; granular data retention controls provided",
        shortValue: 'Cloud or self-hosted for residency, retention controls',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/security/',
            label: 'Security at Tines',
            asOf: '2026-07-02',
          },
        ],
      },
      rbac: {
        value:
          'Yes: Teams-based separation lets admins logically separate users, credentials, resources, and Stories; role-based permissions across the tenant',
        shortValue: 'Teams-based separation with role permissions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/security/',
            label: 'Security at Tines',
            asOf: '2026-07-02',
          },
        ],
      },
      auditLogging: {
        value:
          'Yes: automatic audit log capturing any data/configuration change in the tenant, accessible via UI and API',
        shortValue: 'Automatic audit log via UI and API',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/security/',
            label: 'Security at Tines',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/docs/admin/audit-logs/',
            label: 'Audit logs docs',
            asOf: '2026-07-02',
          },
        ],
      },
      additionalCompliance: {
        value:
          'ISO 27001, ISO 27701, and ISO 42001 (AI management systems), announced April 14, 2026 as the "ISO trifecta." No HIPAA, PCI, or FedRAMP certification; Tines says self-hosting can help meet regimes like FedRAMP, not that it holds FedRAMP certification',
        shortValue: 'ISO 27001, 27701, and 42001 certified',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/blog/tines-achieves-the-iso-trifecta-iso-27001-iso-27701-and-iso-42001-certification/',
            label: 'Tines achieves the ISO trifecta (27001, 27701, 42001)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/security/',
            label: 'Security at Tines',
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
          "Yes: credentials are scoped to Teams by default, and Team Admin/Editor roles control which teams a credential can be shared with. Sensitive settings like Access (where a credential can be used) and Domains (allowed outbound hosts/paths) are restricted to Team Admins or the credential's creator. Custom roles can extend the default viewer/builder/manager roles for finer-grained control.",
        detail:
          "Governance operates at the team/role level with per-credential Access and Domain restrictions, not a credential-to-role assignment matrix like Sim's, but reaches a similar outcome.",
        shortValue: 'Yes: team-scoped credential access rules',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/docs/credentials/credential-configuration/access/',
            label: 'Access | Docs | Tines',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/docs/admin/user-administration/custom-roles/',
            label: 'Custom roles | Docs | Tines',
            asOf: '2026-07-02',
          },
        ],
      },
      whiteLabeling: {
        value:
          'No: branding customization is scoped to Pages (custom logo, background/action colors, light/dark mode, saved Page themes), not the whole workspace or product UI. No evidence of full white-labeling (removing the Tines name/logo tenant-wide) was found.',
        detail:
          'Page themes let you brand individual deployed pages differently per audience, which is narrower than workspace-wide white-labeling.',
        shortValue: 'No: only per-Page branding, not full white-label',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/docs/pages/branding-and-style/',
            label: 'Branding and style | Docs | Tines',
            asOf: '2026-07-02',
          },
        ],
      },
      dataRetention: {
        value:
          'No: audit logs have a fixed two-year retention period, with no org-configurable retention window for logs or soft-deleted resources. Self-hosted deployments expose configurable event/rate limits via environment variables, but not data retention windows.',
        detail:
          'Org can extend retention indirectly by exporting audit logs to their own S3 bucket, but the in-product retention period itself is not shown as configurable.',
        shortValue: 'No: fixed 2-year audit log retention',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/docs/admin/audit-logs/',
            label: 'Audit logs | Docs | Tines',
            asOf: '2026-07-02',
          },
        ],
      },
      piiRedaction: {
        value:
          'Unknown: no documented built-in detection or redaction of PII (emails, SSNs, etc.) in workflow content or retained logs. Tines markets credential/secret protection and access controls, but not a dedicated PII-scanning/redaction capability.',
        shortValue: 'Unknown: no documented PII redaction',
        confidence: 'unknown',
        sources: [],
      },
      sso: {
        value:
          'Yes: SSO via SAML or OIDC, configured at the tenant Authentication settings, with certified integrations for Okta, Duo, and CyberArk among others. Docs describe validating the IdP connection and redirecting users to the identity provider on sign-in.',
        detail:
          "Public docs describe the IdP handshake and setup steps but do not explicitly detail 'organization auto-provisioning on first login' (JIT provisioning) as a named capability.",
        shortValue: 'Yes: SAML and OIDC SSO',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/docs/admin/single-sign-on/',
            label: 'Single sign-on | Docs | Tines',
            asOf: '2026-07-02',
          },
          {
            url: 'https://saml-doc.okta.com/SAML_Docs/How-to-Configure-SAML-2.0-for-Tines.html',
            label: 'How to Configure SAML 2.0 for Tines - Okta',
            asOf: '2026-07-02',
          },
        ],
      },
      thirdPartyVetting: {
        value:
          "Yes: Tines' executable actions (HTTP Request, webhooks, email, Send to Story, AI Agent, etc.) are a fixed, first-party set built and maintained by Tines, not a plugin/node marketplace. Third-party integrations go through the generic HTTP Request action against that tool's API, or by importing a pre-built 'Story' (a workflow template/JSON config, not installable code) from the community Story Library. No mechanism lets a third party publish executable custom actions/nodes that other tenants install.",
        detail:
          "The public Story Library has a 'Community selection' of user-submitted Story templates alongside Tines-authored ones, but these are shareable workflow configurations built from the same fixed first-party action set, not third-party executable plugins with their own code/dependencies (unlike n8n community nodes or a skill/plugin registry). No public vetting process for community Story submissions is documented, and no public security incident involving Tines' Story Library or action set was found.",
        shortValue: 'Yes: fixed first-party action set, no plugin marketplace',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/library',
            label: 'Story Library | Tines',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/docs/actions/',
            label: 'Actions overview | Docs | Tines',
            asOf: '2026-07-04',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Each workflow run ("Story run") gets a unique ID and a full, action-by-action event chain viewable in the UI or API. A Tenant Health dashboard (self-hosted) and Story/Action status views surface errors, run volume, and worker capacity, but this isn\'t OpenTelemetry-style distributed tracing by default; a separate community guide shows customers wiring up their own OpenTelemetry dashboard',
        shortValue: 'Per-run GUID trace; no built-in OpenTelemetry dashboards',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/docs/stories/story-runs/',
            label: 'Story runs docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/docs/self-hosted/monitoring-tines/tenant-health-dashboard/',
            label: 'Tenant health dashboard docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://explained.tines.com/en/articles/14120923-opentelemetry-designing-a-dashboard',
            label: 'OpenTelemetry: Designing a Dashboard',
            asOf: '2026-07-02',
          },
        ],
      },
      durabilityModel: {
        value:
          'HTTP Request actions support configurable automatic retries with "retry on status" behavior, notifying only if the final retry fails. Story version history lets you restore a prior configuration, but no explicit feature to replay a past execution with its original captured inputs is confirmed',
        shortValue: 'Configurable HTTP retries; no confirmed execution replay',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/whats-new/http-request-action-retries-without-notification/',
            label: 'HTTP Request action retries without notification',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/whats-new/better-handling-of-retry-failures/',
            label: 'Emit event on HTTP request action retry failures',
            asOf: '2026-07-02',
          },
        ],
      },
      failureAlerting: {
        value:
          'Yes: per-action "log error if" / status-based error conditions can emit events, and action monitoring can notify on errors; retry notifications only fire on final failure (not every retry), reducing noise',
        shortValue: 'Error-based alerts with de-duped retry notifications',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/whats-new/new-log-error-if-option/',
            label: "New 'log error if' option",
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/whats-new/http-request-action-retries-without-notification/',
            label: 'HTTP Request action retries without notification',
            asOf: '2026-07-02',
          },
        ],
      },
      dataDrains: {
        value:
          'No: Tines documents scheduled export of audit logs to Amazon S3 every 15 minutes, but no general-purpose, continuous data-drain feature for execution/workflow data to destinations like BigQuery, Datadog, or generic webhooks.',
        detail:
          'The audit-log-to-S3 export is the only continuous export destination found; broader execution-data drains are not documented.',
        shortValue: 'Partial: audit logs to S3 only',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.tines.com/docs/admin/audit-logs/',
            label: 'Audit logs | Docs | Tines',
            asOf: '2026-07-02',
          },
        ],
      },
      asyncExecution: {
        value:
          'Yes: Tines supports asynchronous execution for Workflows as APIs. Triggering a story via an API request runs it in the background. If an Exit Action produces an event within 30 seconds, the response returns that data immediately. If it takes longer, the API returns an HTTP 504 with a response_url (also given in the X-Tines-Response-Location header) that can be polled later to fetch the eventual result, while the story keeps running regardless of the timeout.',
        detail:
          'The 30-second window only affects whether the HTTP response can return data immediately; the underlying story execution is not bound by it and continues in the background.',
        shortValue: 'Yes, via response_url polling after 30s',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/docs/stories/apis/',
            label: 'Tines Docs: Workflows as APIs',
            asOf: '2026-07-02',
          },
        ],
      },
      executionLimits: {
        value:
          'Tines publishes per-action timeout figures rather than one global run timeout: HTTP Request and AI Agent (LLM) actions default to a 30-second timeout, Run Script actions default to 10 seconds with a 110-second maximum, and MCP server tool responses cannot exceed 30 seconds before the client sees a timeout error. For Workflows as APIs, an Exit Action must emit an event within 30 seconds of the API request or the call returns a 504 Gateway Timeout (story execution continues regardless). Tines also caps the number of simultaneous API requests to a story; when exceeded it returns HTTP 201 Created instead of 200, signaled via the X-Tines-Status and X-Tines-Limit-Reached headers, without publishing an exact numeric concurrency ceiling.',
        detail:
          "No single 'max execution time per run' number is published; limits are per action-type. The exact numeric concurrency ceiling for simultaneous story API requests isn't disclosed in public docs, only that exceeding it changes the response status code.",
        shortValue: '30s per-action timeouts; concurrency capped, unpublished number',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/docs/actions/types/http-request/',
            label: 'Tines Docs: HTTP Request action (30s default timeout, retry_on_status)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/docs/actions/tools/run-script/',
            label: 'Tines Docs: Run Script action (10s default, 110s max)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/docs/actions/types/ai-agent/',
            label: 'Tines Docs: AI Agent action (30s LLM timeout)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/docs/actions/templates/mcp-server/',
            label: 'Tines Docs: MCP server (30s tool response cap)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/docs/stories/apis/',
            label: 'Tines Docs: Workflows as APIs (504 timeout, concurrency 201 status)',
            asOf: '2026-07-02',
          },
        ],
      },
      partialFailureHandling: {
        value:
          "Yes: Tines lets you connect a dedicated failure path from an action, so any action that errors emits its event down that path to a separate error-handling action instead of halting the whole story. This is configured via the action's context menu ('set failure path') and pairs with retry logic (e.g. HTTP Request actions retry on configured status codes, up to 25 retries with exponential backoff plus jitter) and an emit_failure_event option that fires once retries are exhausted, so downstream actions can react while the rest of the run proceeds.",
        detail:
          "Historically a failed HTTP Request action after exhausted retries would stop the story; Tines added error-event emission plus explicit 'failure path' routing so the rest of the story is not forced to halt.",
        shortValue: 'Yes, dedicated failure paths per action',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/whats-new/failure-path-for-actions/',
            label: "Tines What's New: Failure path for actions",
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/docs/actions/types/http-request/',
            label: 'Tines Docs: HTTP Request action (retry_on_status, emit_failure_event)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/whats-new/better-handling-of-retry-failures/',
            label: "Tines What's New: Better handling of retry failures",
            asOf: '2026-07-02',
          },
        ],
      },
      unattendedExecution: {
        value:
          "Yes: standard Stories (webhook, scheduled HTTP Request actions, Receive Email) run entirely server-side on Tines infrastructure, cloud-hosted or self-hosted, with no dependency on a browser tab or desktop client staying open. The one documented exception is a Story explicitly set to 'Workbench' mode, which can only be invoked interactively through Workbench chat and will not fire on its own schedule or accept external webhook events unless switched to a standard or 'Workbench and Send to Story' mode.",
        detail:
          'Workbench-only stories are intentionally excluded from license story limits precisely because they cannot run autonomously, confirming that autonomous (non-Workbench) stories are the default, unattended execution model.',
        shortValue: 'Yes: runs server-side; Workbench-only mode is the one exception',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/docs/actions/types/webhook/',
            label: 'Webhook | Docs | Tines',
            asOf: '2026-07-02',
          },
          {
            url: 'https://explained.tines.com/en/articles/9855926-using-stories-with-workbench',
            label: 'Using stories with Workbench | Tines Explained',
            asOf: '2026-07-04',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Dedicated support and training for Business/Enterprise plans; community Slack and documentation for lower tiers',
        shortValue: 'Dedicated support for Business/Enterprise, Slack for others',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://explained.tines.com/en/articles/9620399-understanding-tines-pricing-and-packaging',
            label: 'Understanding Tines pricing and packaging',
            asOf: '2026-07-02',
          },
        ],
      },
      sla: {
        value: 'Unknown',
        shortValue: 'Not publicly disclosed',
        confidence: 'unknown',
        sources: [],
      },
      community: {
        value:
          'Public "Tines Library" of shared Story/Action templates, a "Tines University"/bootcamp learning program, and a community Slack referenced in documentation',
        shortValue: 'Public library, university/bootcamp, community Slack',
        confidence: 'verified',
        sources: [
          { url: 'https://www.tines.com/library/', label: 'Tines Library', asOf: '2026-07-02' },
          {
            url: 'https://www.tines.com/bootcamp-fundamentals/',
            label: 'Tines Fundamentals Bootcamp Guide',
            asOf: '2026-07-02',
          },
        ],
      },
      companyMaturity: {
        value:
          'Founded 2018 (Dublin/Boston) by Eoin Hinchy and Thomas Kinsella; raised ~$272M total across 6 rounds, most recently a $125M Series C (Feb 2025) led by Goldman Sachs at unicorn valuation (~$1.125B); reported headcount roughly 500-550 as of early-to-mid 2026',
        detail:
          "No funding round beyond the Feb 2025 Series C is publicly confirmed as of this profile's research date; headcount reflects the most recently reported figures (around 548 employees as of March 2026), not necessarily the current count.",
        shortValue: 'Founded 2018, ~$272M raised, ~500-550 employees',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.crunchbase.com/organization/tines',
            label: 'Tines: Crunchbase Company Profile',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.irishtimes.com/business/2026/05/28/tines-doubled-revenue-ahead-of-125m-funding-round/',
            label: 'Tines doubled revenue ahead of $125m funding round: Irish Times',
            asOf: '2026-07-02',
          },
          {
            url: 'https://tracxn.com/d/companies/tines/__vhdOz5rrILYCmI2TCvs_islx2OCpdITCseVJD-QhsR0',
            label: 'Tines: Tracxn Company Profile',
            asOf: '2026-07-02',
          },
        ],
      },
      academy: {
        value:
          'Yes: Tines offers a structured learning program, Tines University, with free foundational courses (about 30 minutes each), instructor-led and self-paced Bootcamps (fundamentals and advanced), and two certification tiers (Core and Advanced) that builders can share on LinkedIn.',
        detail:
          'Available free even on Community Edition; Advanced certification is hands-on labs, roughly 3 hours.',
        shortValue: 'Yes: University, bootcamps, certifications',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.tines.com/university/',
            label: 'Tines University',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/get-certified/',
            label: 'Get certified | Tines',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.tines.com/bootcamps/',
            label: 'Tines Bootcamp Series',
            asOf: '2026-07-02',
          },
        ],
      },
    },
  },
}
