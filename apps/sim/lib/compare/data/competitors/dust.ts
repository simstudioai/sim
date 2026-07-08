import { DustIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Researched and cross-verified against live vendor sources on 2026-07-02. */
export const dustProfile: CompetitorProfile = {
  id: 'dust',
  name: 'Dust',
  website: 'https://dust.tt',
  brand: {
    icon: DustIcon,
    selfFramed: true,
    colors: ['#FFAA0D', '#111418', '#1C91FF'],
    source: 'dust-tt/dust Sparkle design system (GitHub)',
    asOf: '2026-07-02',
  },
  oneLiner:
    'Dust is an enterprise AI agent platform where teams build no-code agents connected to company data and tools in a shared, multiplayer workspace, then deploy them to chat, Slack, and other surfaces.',
  standoutFeatures: [
    {
      title:
        'Zero visual/flow layer by design, building only through forms, text, and conversation',
      description:
        "Dust's Agent Builder is entirely form and text based, name, description, instructions, model, tools, knowledge, guided by a conversational 'Sidekick' assistant, with no visual canvas at all (its earlier block-based 'Dust Apps' product is deprecated). Agents deploy natively into a shared, multiplayer workspace and out to Slack, Teams, and other chat surfaces. A team that wants agents assembled purely from plain-language instructions and templates, with no drag-and-drop layer to learn or maintain, gets that directly. Teams that do want infrastructure-as-code can also define Skills and agent configurations as files in a Git repository and sync them via an official GitHub Action, with the same PR review and rollback workflow as application code.",
      shortDescription: 'No visual/flow canvas at all, only forms, text, and conversation.',
      source: {
        url: 'https://docs.dust.tt/changelog/gitops-sync-for-skills-agent-configurations-with-github-action',
        label: 'GitOps sync for Skills & Agent configurations | Dust changelog',
        asOf: '2026-07-02',
      },
    },
    {
      title: "'Skills' can attach to many agents at once, with one edit propagating to all of them",
      description:
        "A single Skill can be attached to multiple agents simultaneously, and updating its instructions once automatically propagates that change to every agent using it, rather than requiring each agent's copy to be edited individually.",
      shortDescription: 'One Skill edit auto-propagates to every agent it is attached to.',
      source: {
        url: 'https://docs.dust.tt/docs/skills',
        label: 'Skills | Dust Docs',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Natural-language scheduled triggers, no cron syntax',
      description:
        "Agents can run on a recurring schedule written in plain English (e.g. 'Every weekday at 8:30am'). Dust converts this into a cron expression and runs the agent automatically, without a manual chat invocation.",
      shortDescription: 'Schedule agents in plain English; Dust generates the cron expression.',
      source: {
        url: 'https://docs.dust.tt/docs/scheduling-your-agent-beta',
        label: 'Schedules | Dust Docs',
        asOf: '2026-07-02',
      },
    },
    {
      title: "Client-side MCP tools that execute locally in the end user's own environment",
      description:
        "Beyond remote MCP servers, Dust supports client-side MCP servers whose tools run directly in the end user's local environment rather than on Dust's own infrastructure, for sensitive operations that shouldn't leave the user's machine. Dust can also be exposed as an MCP server itself, so external MCP-compatible clients (e.g. Claude Desktop, Cursor) can call Dust agents and data as tools.",
      shortDescription:
        "MCP tools that run locally in the user's own environment for sensitive operations.",
      source: {
        url: 'https://docs.dust.tt/docs/client-side-mcp-server',
        label: 'Client Side MCP Server (Preview) | Dust Docs',
        asOf: '2026-07-02',
      },
    },
    {
      title: "'Frames': agent output rendered as interactive, shareable documents",
      description:
        'Frames turn an agent conversation into an interactive, website-like document teammates can explore together, hovering over charts for detail, clicking legend items to filter data, and switching views with buttons, instead of a static text or image reply.',
      shortDescription: 'Turns agent output into an interactive, explorable shared document.',
      source: {
        url: 'https://blog.dust.tt/introducing-frames-interactive-data-visualized/',
        label: 'Introducing Frames: Interactive data, visualized | Dust Blog',
        asOf: '2026-07-02',
      },
    },
  ],
  limitations: [
    {
      title: 'No visual, node-based canvas: agents are configured through forms and text',
      description:
        "Dust's agent builder is a form-based, instruction-driven interface (name, description, instructions, model, tools, knowledge), not a drag-and-drop node/flow canvas. Its earlier block-based visual orchestration product, 'Dust Apps', is deprecated: only apps created before October 2025 remain accessible, and creating new ones is disabled.",
      shortDescription:
        'Agent builder is form/instruction-based; the older visual block builder is deprecated.',
      source: {
        url: 'https://docs.dust.tt/reference/dust-apps-core-concepts',
        label: 'Dust Apps: Core Concepts | Dust Docs',
        asOf: '2026-07-02',
      },
    },
    {
      title:
        'No dedicated pre-deployment evaluation/dataset-testing framework, a gap shared with most agent builders',
      description:
        "Dust explicitly says it is 'not a pre-deployment evaluation platform': dataset-based regression testing belongs in CI/CD pipelines and specialized testing tools, and Dust builds observability signals into the agent-builder workflow instead of a formal eval-suite feature. This is a gap most agent builders share, including Sim, whose own Evaluator and Guardrails blocks are per-call scoring/validation primitives rather than a batch golden-dataset eval-suite runner.",
      shortDescription:
        'Dust says it is not a pre-deployment eval platform, a gap shared with most agent builders.',
      source: {
        url: 'https://dust.tt/blog/evaluation-to-maintenance',
        label: 'From Evaluation to Maintenance | Dust Blog',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Self-hosting is not a supported deployment path despite an MIT-licensed core',
      description:
        'The core dust-tt/dust repository is MIT-licensed on GitHub, but Dust is sold and operated only as hosted SaaS. There is no documented, supported way to self-host a production Dust workspace on customer infrastructure.',
      shortDescription:
        'Code is MIT-licensed on GitHub, but only a hosted SaaS deployment is supported.',
      source: {
        url: 'https://github.com/dust-tt/dust/blob/main/LICENSE',
        label: 'dust-tt/dust LICENSE (GitHub)',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'No native spreadsheet-like data table; structured data is queried, not edited',
      description:
        "Dust's Query Tables tool lets an agent generate and run SQL over structured sources (CSVs, Notion databases, Google Sheets, Snowflake, BigQuery), but Dust has no native, editable spreadsheet-grid feature with arrow-key navigation and copy-paste, unlike a dedicated data-table product.",
      shortDescription:
        'Query Tables runs SQL over external data; there is no native editable data grid.',
      source: {
        url: 'https://docs.dust.tt/docs/table-queries',
        label: 'Table queries | Dust Docs',
        asOf: '2026-07-02',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'Form-based, instruction-driven agent builder (name, description, instructions, model, tools, knowledge), not a visual node/flow canvas',
        detail:
          "Dust's Agent Builder manages agent metadata, model settings, instructions, actions/tools, Skills, triggers, and access permissions through structured form fields and natural-language instructions, guided by an 'Agent Builder Sidekick' conversational assistant. Its earlier visual, block-based orchestration product ('Dust Apps', with Input/Data/LLM/Code/Map/Reduce blocks) is deprecated as of October 2025.",
        shortValue: 'Form/instruction-based builder, not a node canvas',
        confidence: 'verified',
        sources: [
          {
            url: 'https://deepwiki.com/dust-tt/dust/3.2-agent-builder-interface',
            label: 'Agent Builder Interface | dust-tt/dust | DeepWiki',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.dust.tt/reference/dust-apps-core-concepts',
            label: 'Dust Apps: Core Concepts | Dust Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      learningCurve: {
        value:
          'Low for simple no-code agents from a template; steeper for custom MCP tool integrations, Query Tables/SQL, and GitOps-managed configurations',
        detail:
          'Dust markets itself as a no-code agent builder for business users starting from templates with Sidekick guidance, while custom MCP servers, SQL-based Query Tables, and Git-based configuration management assume technical familiarity.',
        shortValue: 'Easy for templated agents, steeper for custom tools/SQL/GitOps',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://dust.tt/blog/no-code-ai-agent-builder',
            label: 'No-Code AI Agent Builder | Dust Blog',
            asOf: '2026-07-02',
          },
        ],
      },
      selfHostOption: {
        value:
          "No: the core repository is MIT-licensed and public on GitHub, but self-hosting isn't an officially supported deployment path; Dust is sold and operated only as hosted SaaS",
        detail:
          'dust-tt/dust is publicly available and MIT-licensed, but Dust the company documents only its hosted product (with US/EU region choice), not a supported self-managed installation.',
        shortValue: 'No, MIT code exists but only SaaS is supported',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/dust-tt/dust/blob/main/LICENSE',
            label: 'dust-tt/dust LICENSE (GitHub)',
            asOf: '2026-07-02',
          },
        ],
      },
      deploymentOptions: {
        value:
          'Multi-tenant hosted cloud by default; an EU data-hosting option for databases, files, and vectors is available, documented as exclusive to Enterprise customers rather than a self-serve region choice on every tier',
        detail:
          "Dust's changelog states the EU data hosting option is 'available exclusively for enterprise customers' and covers 'storage of databases, files, and vectors' (calls to third-party LLM provider APIs remain outside this hosting boundary). No Dust source documents a selectable US-region toggle or a named single-tenant deployment tier.",
        shortValue: 'Multi-tenant cloud by default; EU data hosting is Enterprise-exclusive',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/changelog/eu-data-hosting-option-available',
            label: 'EU data hosting option available | Dust changelog',
            asOf: '2026-07-08',
          },
        ],
      },
      templates: {
        value:
          'Yes: a Template Gallery of pre-built agents organized by department/use case (Sales, Customer Support, Marketing, Engineering, Data Analytics, Knowledge Management, Recruiting, Product Design, Collaboration)',
        detail:
          "Selecting a template opens a Sidekick-guided creation flow pre-loaded with the template's instructions and suggested tools/data sources; templates are organized by department/use case including Sales, Customer Support, Marketing, Engineering, Data Analytics, Knowledge Management, Recruiting, Product Design, and Collaboration. The builder reviews, adjusts, and publishes from there.",
        shortValue: 'Template gallery organized by department/use case',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/templates',
            label: 'Templates | Dust Docs',
            asOf: '2026-07-08',
          },
        ],
      },
      license: {
        value:
          'Core repository MIT-licensed (dust-tt/dust), but commercially offered only as hosted SaaS',
        detail:
          'The dust-tt/dust GitHub repository, written primarily in TypeScript, is published under the permissive MIT License. The commercial dust.tt product is a proprietary hosted service on top of that code, and no self-hosted licensing tier is offered.',
        shortValue: 'MIT-licensed code; product sold only as SaaS',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/dust-tt/dust/blob/main/LICENSE',
            label: 'dust-tt/dust LICENSE (GitHub)',
            asOf: '2026-07-02',
          },
        ],
      },
      environmentPromotion: {
        value:
          'Partial: an official GitHub Action version-controls and syncs Skills/agent configurations from a Git repository into a workspace, but this is configuration sync, not a documented dev/test/prod promotion model',
        detail:
          'The dust-github-action lets teams define Skills and agent configurations as files, review changes via pull request, and sync them into a Dust workspace from CI/CD, giving change history and rollback. No separate-environment (e.g. staging vs. production workspace) promotion pipeline is documented beyond this Git-to-workspace sync.',
        shortValue: 'Git-based config sync/rollback, not a formal environment-promotion pipeline',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/changelog/gitops-sync-for-skills-agent-configurations-with-github-action',
            label: 'GitOps sync for Skills & Agent configurations | Dust changelog',
            asOf: '2026-07-02',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Agent configurations carry an incrementing version number, each prompt/instruction version is saved and recoverable, and Git-based rollback is available via the GitOps GitHub Action; no dedicated visual diff/compare view is documented',
        detail:
          "Each agent configuration change increments a version number, and 'each version of a prompt is now saved and accessible, with the ability to recover previous assistant instructions'. The GitOps GitHub Action separately provides Git history, PR review, and rollback for configurations managed as code.",
        shortValue: 'Versioned configs with prompt history and Git-based rollback',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/changelog/prompt-version-history',
            label: 'Prompt version history | Dust changelog',
            asOf: '2026-07-02',
          },
          {
            url: 'https://deepwiki.com/dust-tt/dust/3.1-agent-configuration-and-management',
            label: 'Agent Configuration and Management | dust-tt/dust | DeepWiki',
            asOf: '2026-07-02',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          "No: Dust calls itself 'multiplayer AI', with shared conversations, mentions, notifications, and to-dos between people and agents in a workspace, but this is asynchronous collaboration, not live concurrent editing of the same agent configuration with synced cursors",
        detail:
          "Dust's own materials describe a shared workspace where 'teams and agents work in the same workspace with shared projects, context, conversations, to-dos, notifications' rather than live co-editing of a single agent's configuration.",
        shortValue: 'Shared async workspace, not live co-editing of one config',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/collaboration',
            label: 'Collaboration | Dust Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeFileStorage: {
        value:
          'No: Dust has no folder-hierarchy, link-sharing, recycle-bin file manager of its own; files are handled as agent-conversation uploads/outputs or through connected external services (Google Drive, Notion, etc.)',
        detail:
          'Agents can generate, read, and edit files (PDF, Word, Excel, Google Docs/Sheets/Slides) within a conversation or a connected Drive/Notion account, but there is no standalone Dust-native shared-drive surface with folder hierarchy and permissioned link-sharing.',
        shortValue: 'No native file manager; files live in conversations or connectors',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/file-generation',
            label: 'File Generation | Dust Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      dataTables: {
        value:
          'No: Query Tables lets an agent generate and run SQL queries against structured sources (CSVs, Notion databases, Google Sheets, Snowflake, BigQuery), but there is no native, editable spreadsheet-grid feature with arrow-key navigation and copy-paste',
        detail:
          "Query Tables is described as letting agents 'execute SQL queries on structured data' and join tables across sources; this is a query layer over external/uploaded data, not an in-product spreadsheet UI a person edits directly.",
        shortValue: 'SQL query layer over external tables, not an editable grid',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/table-queries',
            label: 'Table queries | Dust Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      richTextEditor: {
        value:
          'Partial: agents can create and edit Google Docs/Sheets/Slides and generate Word/PDF files, and Frames render interactive documents from a conversation, but Dust has no inline, in-product WYSIWYG rich-text editing surface of its own',
        detail:
          "'Frames' turn agent output into an explorable, shareable interactive document (charts, filters, view switching), and agents can create/edit Google Drive documents directly, but document editing itself happens in the connected Google Docs surface or as generated file output, not a native Dust WYSIWYG editor.",
        shortValue: 'Generates/edits external docs and Frames, no native WYSIWYG editor',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://blog.dust.tt/introducing-frames-interactive-data-visualized/',
            label: 'Introducing Frames: Interactive data, visualized | Dust Blog',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.dust.tt/changelog/dust-agents-can-now-create-and-edit-google-drive-documents',
            label: 'Dust Agents Can Now Create and Edit Google Drive Documents | Dust changelog',
            asOf: '2026-07-02',
          },
        ],
      },
      subWorkflows: {
        value:
          'Yes: a "Run agent" tool lets one Dust agent call another saved agent as a step, waiting for it to finish and receiving its output back before continuing',
        detail:
          'By default the called agent runs in a separate conversation and returns its output to the calling agent, which then continues processing (the calling agent can also enable a handoff mode where the called agent responds directly to the user instead). Recursion is capped at a maximum depth of 4 nested calls.',
        shortValue: '"Run agent" tool calls a saved agent as a step and returns its output',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/run-agent',
            label: 'Run agent | Dust Docs',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Yes: agents can be configured with a choice of model (e.g. GPT-4 Turbo, Claude 3, Gemini Pro, Mistral Large) and a Reasoning Effort setting, selectable per agent',
        detail:
          'Advanced agent settings let a builder pick the model and a reasoning-effort level (Light, Medium, High); Dust docs name GPT-4 Turbo, Claude 3, Gemini Pro, and Mistral Large as selectable models.',
        shortValue: 'GPT-4 Turbo, Claude 3, Gemini Pro, Mistral Large selectable per agent',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/what-settings-model-should-i-use',
            label: 'What settings / model should I use? | Dust Docs',
            asOf: '2026-07-08',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          'Yes: agents autonomously select and call tools (data-source search, Query Tables, MCP tools, code execution, web search) based on the instructions and conversation, rather than following a fixed, pre-wired step sequence',
        detail:
          "Documented as 'multi-tool agents': a single agent can be given multiple tools/actions and picks which to invoke per user turn, distinct from Dust's deprecated block-based Dust Apps, which used a fixed chain of blocks.",
        shortValue: 'Agents dynamically pick from multiple configured tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://blog.dust.tt/introducing-multi-tool-assistants/',
            label: 'Introducing: multi-tool agents | Dust Blog',
            asOf: '2026-07-02',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          "Yes: an 'Agent Builder Sidekick' converses with the builder to draft instructions, and suggests tools/data sources, from a plain-language description or a selected template",
        detail:
          'Selecting a template opens a Sidekick-guided creation flow; Sidekick drafts initial instructions and suggests tools/data sources for the builder to review and adjust before publishing.',
        shortValue: 'Sidekick drafts agent instructions/tools conversationally',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/agent-builder-sidekick',
            label: 'Agent Builder Sidekick | Dust Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          'Yes: agents can be given Search/RAG access to connected Data Sources (Slack, Notion, Google Drive, Confluence, GitHub, and more), with semantic search over synced content',
        detail:
          "Dust's Search method retrieves and ranks relevant passages from selected Data Sources for an agent to ground its answer in, distinct from the Query Tables SQL-based tool used for structured data.",
        shortValue: 'RAG search over connected Slack/Notion/Drive/Confluence data',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/understanding-retrieval-augmented-generation-rag-and-the-search-method-in-dust',
            label: 'Understanding Retrieval Augmented Generation (RAG) | Dust Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpSupport: {
        value:
          'Yes: admins can add Remote MCP Servers (Dust-built or any public MCP server) to a Space, and Client-Side MCP Servers let a local client register tools for a specific conversation at runtime',
        detail:
          "Remote MCP Servers are added via Spaces > Tools > Add Tool; Client-Side MCP Servers execute tools in the client's own environment for sensitive local operations, distinct from server-hosted tools.",
        shortValue: 'Remote and client-side MCP server support for agent tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/remote-mcp-server',
            label: 'Adding an MCP Server | Dust Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.dust.tt/docs/client-side-mcp-server',
            label: 'Client Side MCP Server (Preview) | Dust Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          "No dedicated pre-deployment evaluation/guardrail framework: Dust says it is 'not a pre-deployment evaluation platform', and that dataset-based regression testing belongs in CI/CD pipelines, not a built-in feature",
        detail:
          'Dust instead builds observability signals (usage trends, tool execution patterns, feedback tracking, latency, RAG behavior) natively into the Agent Builder dashboard rather than a formal test-dataset evaluation suite comparable to a dedicated evals feature.',
        shortValue: 'Dust says it is not a pre-deployment eval platform',
        confidence: 'verified',
        sources: [
          {
            url: 'https://dust.tt/blog/evaluation-to-maintenance',
            label: 'From Evaluation to Maintenance | Dust Blog',
            asOf: '2026-07-02',
          },
        ],
      },
      humanInTheLoop: {
        value:
          "Yes: MCP tool execution uses a stakes-tiered approval model (high/medium/low-stake tools, with argument-level approval required for certain medium-stake tool parameters), not a simple 'always ask' vs. auto-execute toggle, and Dust's own guidance recommends human approval before irreversible agent actions",
        detail:
          "Dust's MCP tool architecture tiers tools by stake level and requires argument-level approval for certain medium-stake tool parameters before execution, and Dust recommends 'mandatory steps, and human approval points before any irreversible action' for consequential agent actions. This is a graduated tool-execution approval model, not a single named workflow node like a dedicated approval action in a workflow tool.",
        shortValue: 'Stakes-tiered MCP approval model; documented best-practice guidance',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://deepwiki.com/dust-tt/dust/4-agent-system',
            label: 'MCP Tool System | dust-tt/dust | DeepWiki',
            asOf: '2026-07-08',
          },
          {
            url: 'https://dust.tt/blog/ai-agent-workflows',
            label: 'AI agent workflows: How they work and how to build your own | Dust Blog',
            asOf: '2026-07-08',
          },
        ],
      },
      generativeMedia: {
        value:
          "Partial: native image generation (via Google's gemini-3-pro-image model) with reference-image consistency (up to 14 reference images) and parallel generation is built in; there is no dedicated native video-generation block, though a separate 'Voice and sound generation' tool exists for audio",
        detail:
          "Dust's Image Generation capability uses Google's gemini-3-pro-image model, supports up to 14 reference images for visual consistency across a series, and can run multiple generations in parallel; generated images are filtered for safety. A separate 'Voice and sound generation' tool provides native audio generation, but no dedicated native video-generation block was found.",
        shortValue:
          'Native image gen (gemini-3-pro-image) + reference images; separate audio tool; no native video',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/image-generation',
            label: 'Image Generation | Dust Docs',
            asOf: '2026-07-08',
          },
        ],
      },
      dynamicToolUse: {
        value:
          'Yes: a single agent can be configured with multiple tools/actions and dynamically chooses which to invoke per turn based on the conversation, rather than following one pre-wired tool call',
        detail:
          "Documented as 'multi-tool agents': the agent picks from its configured tool pool (data-source search, Query Tables, MCP tools, code execution, web search) at inference time.",
        shortValue: 'Agent dynamically selects among its configured tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://blog.dust.tt/introducing-multi-tool-assistants/',
            label: 'Introducing: multi-tool agents | Dust Blog',
            asOf: '2026-07-02',
          },
        ],
      },
      modelFallback: {
        value: 'Not publicly documented',
        detail:
          'No Dust source describes automatic fallback to a different model/provider on a failed or rate-limited call.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      agentSkills: {
        value:
          "Yes: 'Skills' are named, reusable packages of instructions, knowledge, and tools shareable across multiple agents, distinct from a one-off system prompt on a single agent",
        detail:
          "Updating a Skill's instructions automatically propagates the change to every agent using it. Skills can also be managed as files via the GitOps GitHub Action for version-controlled, PR-reviewed updates.",
        shortValue: "Named, reusable, cross-agent 'Skills' with GitOps management",
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/skills',
            label: 'Skills | Dust Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeChatDeployment: {
        value:
          'Yes: agents are used and deployed through a native web chat surface and directly inside Slack and Microsoft Teams, without a separate form/API/webhook deployment step',
        detail:
          "Agents are invoked with an '@handle' in Dust's own chat interface, in Slack, and in Teams; this is the primary interaction surface for the product, not an optional add-on channel.",
        shortValue: 'Native web chat plus Slack and Teams deployment',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/dust-in-teams',
            label: 'Dust in Teams | Dust Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          "Partial: Dust's product UI surfaces citations tied to a specific source document in agent answers, but there's no dedicated raw chunk-index/content debugging inspector distinct from those citations",
        detail:
          "Dust's general RAG/Search explainer describes semantic retrieval but doesn't itself document citation formatting; the citation behavior (source documents listed under an answer, or visible via 'tool inspection') is described in Dust's own community support threads rather than a product page, and appears to vary by model. Whether a raw chunk-content inspector exists as a separate debugging surface isn't confirmed in official docs.",
        shortValue:
          'Citations confirmed via product UI/community support, not a docs page; chunk inspector unconfirmed',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://community.dust.tt/x/03help/6ku3a37chfyo/how-to-access-documents-from-the-dust-agent-a-guid',
            label: 'How to Access Documents from the Dust Agent | Dust Community',
            asOf: '2026-07-08',
          },
        ],
      },
      parallelExecution: {
        value:
          'Partial: agents can run multiple tool calls (e.g. several image generations) concurrently within a turn, but Dust has no visual branch/fan-out-and-join execution model since it is not a node-based workflow builder',
        detail:
          'Documented parallel behavior is scoped to specific tools (e.g. simultaneous image generations for an asset pipeline), not a general-purpose concurrent-branch primitive across an agent run.',
        shortValue: 'Some tools run concurrently; no general branch/fan-out model',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/image-generation',
            label: 'Image Generation | Dust Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      a2aProtocol: {
        value: 'Not publicly documented',
        detail:
          'No official Dust documentation describes native Agent2Agent (A2A) protocol support; Dust appears only in third-party community lists of A2A-adjacent tools, not in its own docs or blog.',
        shortValue: 'Not publicly documented by Dust',
        confidence: 'unknown',
        sources: [],
      },
      loopIteration: {
        value:
          'No: Dust has no dedicated for-each/while loop container; its tools page lists default tools (data visualization, web search, file/image creation, agent memory, run-agent), third-party integrations, remote MCP servers, and Dust Apps, none of which is a loop/iterator block',
        detail:
          "Dust's agent builder is tool-and-instruction driven rather than a step-sequence canvas, so repeated execution over a list or count relies on the model's own reasoning (or delegating subtasks to sub-agents) rather than an explicit loop container that guarantees sequential per-item iteration.",
        shortValue: "No dedicated loop/for-each block found in Dust's tool catalog",
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/tools',
            label: 'Tools | Dust Docs',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value:
          '50+ native connections (Slack, Notion, Google Drive, Confluence, GitHub, Salesforce, HubSpot, Zendesk, and more), plus MCP servers for further extensibility',
        detail:
          "Dust's enterprise page states 'native integrations to 50+ business tools'; some third-party listings cite higher figures (100+) that likely include MCP-based and community integrations beyond the core native connector count.",
        shortValue: '50+ native connections per Dust',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://dust.tt/home/enterprise',
            label: 'Dust for Enterprise',
            asOf: '2026-07-02',
          },
        ],
      },
      triggerTypes: {
        value:
          'Natural-language scheduled triggers and event-based triggers from connected systems (e.g. GitHub, Jira, Zendesk, Linear, Fathom, or custom webhooks), invoked in addition to manual chat invocation',
        detail:
          "Scheduled triggers run an agent on a recurring, plain-language schedule ('Every weekday at 8:30am') without cron syntax; Dust's Webhook Triggers separately let agents react to events from built-in providers (GitHub, Jira, Zendesk, Linear, Fathom) or custom webhooks, rather than only manual chat.",
        shortValue:
          'Natural-language schedules plus webhook triggers (GitHub, Jira, Zendesk, Linear, Fathom)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/triggers',
            label: 'Triggers | Dust Docs',
            asOf: '2026-07-08',
          },
        ],
      },
      customCodeSteps: {
        value:
          'Partial: Val Town integration lets an agent create/deploy and call serverless JavaScript/TypeScript functions from a conversation; the legacy Dust Apps Code block is deprecated',
        detail:
          'The Val Town integration supports function creation and deployment of serverless JS/TS functions directly from agent conversations, with real-time results; the earlier general-purpose Code block belonged to the now-deprecated Dust Apps orchestration product.',
        shortValue: 'Val Town serverless functions; legacy Code block is deprecated',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/val-town',
            label: 'Val Town | Dust Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      apiPublishing: {
        value:
          'Yes: a documented Conversation API lets external applications create conversations and post messages to Dust agents programmatically, and a Developer Platform covers broader API access',
        detail:
          'Client-Side MCP Servers register local tools by creating conversations and posting messages through the Conversation API, which functions as a callable integration surface for external applications.',
        shortValue: 'Conversation API for external app integration',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/client-side-mcp-server',
            label: 'Client Side MCP Server (Preview) | Dust Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.dust.tt/reference/developer-platform-overview',
            label: 'Developer platform | Dust Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'MIT-licensed core repository (dust-tt/dust) on GitHub, a documented Developer Platform/API, an official GitHub Action for GitOps config sync, and community-built MCP bridges',
        detail:
          'There is no separate first-party multi-language client SDK beyond the API/GitHub Action; extensibility instead centers on the open MIT-licensed codebase, the public API, and the MCP ecosystem, including third-party community projects (e.g. a community-built dust-mcp-server bridge).',
        shortValue: 'Open MIT repo, API, GitHub Action, MCP ecosystem',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/dust-tt/dust',
            label: 'dust-tt/dust (GitHub)',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpPublishing: {
        value:
          'Yes: Dust can be exposed as an MCP server so external MCP-compatible clients (e.g. Claude Desktop, Cursor) can call Dust agents and data as tools, in addition to consuming external MCP servers itself',
        detail:
          "Dust's architecture is described as playing a dual role: a client (consuming external MCP tools) and a server (exposing its own agents/data sources) for external AI tools to call, positioning it as a hub rather than a one-directional MCP consumer.",
        shortValue: 'Dust agents/data can be called by external MCP clients',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://blog.dust.tt/mcp-emerging-enterprise-ai-os-layer/',
            label: 'MCP and the emerging enterprise AI OS layer | Dust Blog',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value: 'Per-seat subscription with a monthly AI-usage credit allocation per seat',
        detail:
          'Business plan seats (Pro, Max) each include a monthly credit allocation that resets every billing period; credit consumption depends on the model used, task complexity, and any tools the agent invokes (search, retrieval, code execution, connected-app actions).',
        shortValue: 'Per-seat pricing with monthly credit allocations',
        confidence: 'verified',
        sources: [
          {
            url: 'https://dust.tt/home/pricing',
            label: 'Dust Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      entryPaidPlan: {
        value: 'Business Pro: $30/month per seat ($24/month billed yearly), 8,000 credits/month',
        detail:
          "The Business plan's Pro tier is the entry paid tier above the free plan; a higher Max tier ($150/month, or $120/month billed yearly) includes 40,000 credits/month.",
        shortValue: '$30/month per seat (or $24/month annual), 8,000 credits',
        confidence: 'verified',
        sources: [
          {
            url: 'https://dust.tt/home/pricing',
            label: 'Dust Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      freeTier: {
        value:
          'Yes: a free Business tier for new workspaces, capped at 5 users, 3 connectors, and 5 Spaces, no credit card required',
        detail:
          'This free tier is what a new workspace gets by default without a paid subscription. It is distinct from what happens when an existing paid workspace downgrades: canceling removes all users except the earliest-assigned admin, deletes existing connections, and deletes data sources over 50MB combined after a 7-day warning period, while original source data in the connected provider itself is untouched.',
        shortValue: 'Free for new workspaces: up to 5 users, 3 connectors, 5 Spaces',
        confidence: 'verified',
        sources: [
          {
            url: 'https://dust.tt/home/pricing',
            label: 'Dust Pricing',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.dust.tt/docs/subscriptions',
            label: 'Subscriptions & Payments | Dust Docs',
            asOf: '2026-07-04',
          },
        ],
      },
      byok: {
        value:
          'No dedicated BYOK program: Dust bills usage via plan-included AI credits rather than a bring-your-own-provider-API-key option',
        detail:
          'Pricing is structured around per-seat monthly credits that scale with model/task/tool complexity; no Dust source describes letting a workspace supply its own OpenAI/Anthropic API key in place of credit consumption.',
        shortValue: 'Not documented; usage billed via included credits',
        confidence: 'unknown',
        sources: [],
      },
    },
    security: {
      soc2: {
        value: 'Yes: SOC 2 Type II certified, achieved audit readiness with Vanta in three weeks',
        detail:
          "Dust's own security page states SOC 2 Type II certification; a Vanta customer case study describes Dust achieving SOC 2 Type II audit readiness in three weeks using Vanta's automation, reducing compliance workload by roughly 50%. The report is downloadable via Dust's Trust Center.",
        shortValue: 'SOC 2 Type II certified, report via Trust Center',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.vanta.com/customers/dust',
            label: 'With Vanta, Dust achieved SOC 2 Type II audit readiness in three weeks',
            asOf: '2026-07-02',
          },
          {
            url: 'https://trust.dust.com/',
            label: 'Dust Trust Center',
            asOf: '2026-07-02',
          },
        ],
      },
      dataResidency: {
        value: 'Yes: selectable US or EU data-hosting region',
        detail:
          "Dust's changelog documents an 'EU data hosting option' becoming available, and the Enterprise plan page lists 'US & EU data residency options' as a named feature.",
        shortValue: 'Selectable US or EU hosting region',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/changelog/eu-data-hosting-option-available',
            label: 'EU data hosting option available | Dust changelog',
            asOf: '2026-07-02',
          },
        ],
      },
      rbac: {
        value:
          'Yes: three workspace roles (Member, Builder, Admin) plus per-Space access control, where only members of the Spaces an agent uses can see and use that agent',
        detail:
          'Members can chat with and build agents; Builders additionally manage Folders and use the API; Admins manage workspace settings, connections, and member roles. Spaces (open or restricted) gate which members can see specific data sources, tools, and the agents built on them.',
        shortValue: 'Member/Builder/Admin roles plus per-Space access gating',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/access-controls-and-permissions',
            label: 'Access Controls and Permissions | Dust Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      auditLogging: {
        value:
          'Yes: audit logs available on the Enterprise plan, admin-only, with CSV export and continuous streaming to a SIEM (Datadog, Splunk, AWS S3, GCP GCS, custom HTTPS endpoint); no retention period is documented',
        detail:
          "Dust's Audit Logs docs confirm the feature is Enterprise-only, accessible to workspace admins under Admin > People & Security > Audit Logs, with full-text search, time-range filtering, manual CSV export, and continuous streaming to external SIEM destinations. No page specifies how many days of audit history are retained.",
        shortValue: 'Enterprise-tier audit logs with SIEM export; retention period not documented',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/audit-logs',
            label: 'Audit Logs | Dust Docs',
            asOf: '2026-07-04',
          },
        ],
      },
      additionalCompliance: {
        value: 'GDPR compliant, HIPAA-capable, SOC 2 Type II; no ISO 27001, PCI, or FedRAMP',
        detail:
          "Dust's security page and enterprise materials state GDPR compliance and HIPAA-compliance capability alongside SOC 2 Type II. No source confirms ISO 27001, PCI-DSS, or FedRAMP.",
        shortValue: 'GDPR, HIPAA-capable, SOC 2 Type II',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://dust.tt/home/security',
            label: 'Dust Security',
            asOf: '2026-07-02',
          },
        ],
      },
      modelAndToolGovernance: {
        value: 'Not publicly documented',
        detail:
          'No Dust source describes admin-configurable restrictions on which LLM providers/models or which specific tools a role may use, beyond Space-level data/tool access and workspace-wide model settings.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      credentialGovernance: {
        value:
          'Partial: Space-based access control governs which members can use a given connection/data source, but no documented feature restricts which specific stored credential a role may use for the same connector',
        detail:
          'Only workspace admins can add data from Connections to a Space, and only members of that Space can use the agents/tools built on it; this gates access to a Connection as a whole rather than choosing among multiple stored credentials for the same service by role.',
        shortValue: 'Space-level connection gating, not per-credential role restriction',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/access-controls-and-permissions',
            label: 'Access Controls and Permissions | Dust Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      whiteLabeling: {
        value: 'Not publicly documented',
        detail:
          'No Dust source describes a white-label/custom-branding offering for the workspace or chat UI.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      dataRetention: {
        value: 'Yes: Enterprise plan documents custom data retention as a named feature',
        detail:
          "Dust's Enterprise plan page lists 'custom data retention' alongside SSO, SCIM, and audit logs; specific configurable windows were not detailed in available docs.",
        shortValue: 'Enterprise plan offers custom retention windows',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://dust.tt/home/enterprise',
            label: 'Dust for Enterprise',
            asOf: '2026-07-02',
          },
        ],
      },
      piiRedaction: {
        value: 'Not publicly documented',
        detail:
          'No Dust source describes a built-in PII detection/redaction feature for workflow content or retained logs.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      sso: {
        value:
          'Yes: SSO (e.g. Okta, Entra, JumpCloud) and SCIM user provisioning on the Enterprise plan',
        detail:
          'Enterprise plan materials name SSO and SCIM explicitly, and a third-party enterprise summary lists Okta/Entra/JumpCloud as example supported identity providers.',
        shortValue: 'SSO and SCIM provisioning, Enterprise plan',
        confidence: 'verified',
        sources: [
          {
            url: 'https://dust.tt/home/enterprise',
            label: 'Dust for Enterprise',
            asOf: '2026-07-02',
          },
        ],
      },
      thirdPartyVetting: {
        value:
          'Partial: native data connections (11 fully-managed sources including Google Drive, Notion, Confluence, GitHub, Salesforce, Microsoft, Snowflake, BigQuery, Zendesk, Gong, and Intercom) are first-party and built/maintained by the Dust team; Slack and dozens of other business tools (Airtable, Asana, HubSpot, Jira, Salesloft, and more) are documented as separate MCP-based Tools rather than native Connections, and agent tools can also be extended with any external MCP server by pasting its public URL, with no Dust-led vetting or review of that server',
        detail:
          "Docs list 11 fully-managed native Connections under Connections Management, while Dust's own Slack integration docs describe it as 'Slack MCP tools' added by selecting Slack 'from the available MCP servers,' distinct from that native Connections list. Dust's Tools catalog documents dozens of further business-tool integrations (Airtable, Asana, HubSpot, Jira, Salesloft, and more) alongside the ability to add any external MCP server by pasting its public URL, with workspace admins responsible for choosing and authenticating it. No formal Dust review process is described for pasted third-party MCP server URLs, and no publicly documented security incident involving a malicious or compromised third-party MCP server on Dust was found.",
        shortValue:
          '11 first-party Connections; Slack + dozens more via MCP-based Tools; open bring-your-own-URL MCP',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/connections',
            label: 'Connections | Dust Docs',
            asOf: '2026-07-08',
          },
          {
            url: 'https://docs.dust.tt/docs/slack-mcp',
            label: 'Slack tools | Dust Docs',
            asOf: '2026-07-08',
          },
          {
            url: 'https://docs.dust.tt/docs/tools',
            label: 'Tools | Dust Docs',
            asOf: '2026-07-08',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Partial: an Admin > Analytics dashboard shows workspace-wide credit consumption, message/conversation volume, tool execution patterns, and feedback tracking (thumb reactions/comments), broken out by agent, user, or message source, but it does not track latency metrics or RAG-specific behavior, and is not broken out by individual agent version',
        detail:
          "Dust's Workspace Analytics docs describe an Admin > Analytics dashboard for adoption, credit consumption, and usage patterns, including tool-execution counts/unique users per tool and message feedback, explicitly stating analytics never include message content and are not differentiated by agent version. Latency metrics and RAG-specific behavior are not part of this dashboard.",
        shortValue:
          'Workspace-wide usage/feedback/tool dashboard; no latency or RAG metrics, not per-version',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/workspace-analytics',
            label: 'Workspace Analytics | Dust Docs',
            asOf: '2026-07-08',
          },
        ],
      },
      durabilityModel: {
        value: 'Not publicly documented',
        detail:
          'No Dust source describes automatic retries, checkpointing, or replay of a past agent run with its original inputs.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      failureAlerting: {
        value: 'Not publicly documented',
        detail:
          'No Dust source describes proactive alerting when an agent run fails or crosses a cost/latency threshold.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      dataDrains: {
        value: 'Not publicly documented',
        detail:
          'No Dust source describes continuous export of execution/audit/usage data to an external destination (S3, BigQuery, webhook, etc.).',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      asyncExecution: {
        value:
          'Yes: scheduled and event-based Triggers run an agent in the background without a synchronous chat request, and results are delivered to a configured destination (e.g. Slack) rather than blocking a caller',
        detail:
          'Scheduled triggers execute on a recurring cadence (e.g. daily pipeline review posted to Slack every morning); this is inherently asynchronous relative to a live chat turn.',
        shortValue: 'Scheduled/event triggers run agents asynchronously',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/triggers',
            label: 'Triggers | Dust Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      executionLimits: {
        value: 'Not publicly documented',
        detail:
          'No Dust source publishes concrete numeric limits for maximum single-run duration or concurrent agent-run caps.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      partialFailureHandling: {
        value: 'Not publicly documented',
        detail:
          'No Dust source describes routing one failing tool call to an error-handling path while the rest of an agent turn continues, versus the whole turn failing.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      unattendedExecution: {
        value:
          "Yes: Dust is a hosted, multi-tenant (or single-tenant Enterprise) cloud product, and scheduled/event-based Triggers run an agent in the background on Dust's own servers with no client device involved",
        detail:
          "Dust offers no desktop app or local agent; the product is used through a web chat interface, Slack, and Teams, and scheduled triggers (e.g. a daily pipeline review posted to Slack every morning) fire on Dust's cloud infrastructure regardless of whether any user has a browser tab, laptop, or session open at the time.",
        shortValue: "Runs server-side on Dust's cloud; no client device dependency",
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/docs/triggers',
            label: 'Triggers | Dust Docs',
            asOf: '2026-07-04',
          },
          {
            url: 'https://docs.dust.tt/docs/scheduling-your-agent-beta',
            label: 'Schedules | Dust Docs',
            asOf: '2026-07-04',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Documentation (docs.dust.tt), a public community (community.dust.tt), a blog/changelog, and enterprise account support; Enterprise plans reference dedicated onboarding',
        detail:
          'Dust maintains a structured documentation site, a community forum, and a regularly updated changelog; enterprise customers are documented as receiving allocated onboarding/training hours scaled to customer segment.',
        shortValue: 'Docs, community forum, changelog, enterprise onboarding',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dust.tt/',
            label: 'Dust Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      sla: {
        value: 'Not publicly documented',
        detail: 'No Dust source publishes a product-specific uptime SLA percentage.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      community: {
        value:
          'Active: a public community forum (community.dust.tt) and Dust Academy course discussions',
        detail:
          'community.dust.tt hosts help/support threads (e.g. troubleshooting Table Query tool usage); it is smaller and newer than long-established open-source automation communities.',
        shortValue: 'Active but newer community forum plus Academy',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://community.dust.tt/x/03help/vgwnzcrq96s6/using-the-table-queries-tool-for-database-files',
            label: 'Using the Table Queries Tool for Database Files | Dust Community',
            asOf: '2026-07-02',
          },
        ],
      },
      companyMaturity: {
        value:
          'Dust, Inc. Founded 2022 in Paris by two former Stripe employees (one also ex-OpenAI). Raised a $40M Series B in May 2026 (co-led by Sequoia and Abstract, with Datadog and Snowflake participating), total funding over $60M. Reports 300,000+ agents deployed across 3,000+ organizations, 70% weekly active usage, and zero churn as of the raise',
        detail:
          "Customers named in Dust's own materials include Datadog, 1Password, and Qonto (Qonto reports 50+ specialized agents and 50,000+ hours saved annually). As a 2022-founded, venture-backed private company, it carries materially more switching risk than a large, publicly traded incumbent vendor, though it has real enterprise traction and revenue-retention metrics (240% net revenue retention reported at the raise).",
        shortValue: 'Founded 2022, Paris; $60M+ raised; 3,000+ orgs, 300,000+ agents',
        confidence: 'verified',
        sources: [
          {
            url: 'https://sifted.eu/articles/dust-series-b-40m',
            label: 'Sequoia backs AI agents scaleup Dust in $40m Series B | Sifted',
            asOf: '2026-07-02',
          },
          {
            url: 'https://dust.tt/blog/series-b-multiplayer-ai',
            label: 'Dust raises $40M Series B to scale multiplayer AI | Dust Blog',
            asOf: '2026-07-02',
          },
        ],
      },
      academy: {
        value:
          'Yes: Dust Academy (dust.tt/academy) offers structured, hands-on courses on navigating the platform, chaining agent calls, connecting company data, agent actions/integrations, and scheduling agents',
        detail:
          'Positioned explicitly as handling fundamentals so enterprise implementation teams can focus on customer-specific use cases rather than repeating basic training.',
        shortValue: 'Structured Dust Academy course library',
        confidence: 'verified',
        sources: [
          {
            url: 'https://dust.tt/academy',
            label: 'Dust Academy',
            asOf: '2026-07-02',
          },
          {
            url: 'https://dust.tt/blog/dust-academy',
            label: 'Introducing the Dust Academy | Dust Blog',
            asOf: '2026-07-02',
          },
        ],
      },
    },
  },
}
