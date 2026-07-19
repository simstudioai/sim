import { MakeIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Researched and cross-verified against live vendor sources on 2026-07-02. */
export const makeProfile: CompetitorProfile = {
  id: 'make',
  name: 'Make',
  website: 'https://www.make.com',
  brand: {
    icon: MakeIcon,
    selfFramed: true,
    colors: ['#9108f9', '#f5eef7', '#040404'],
    description:
      'Make is a visual‑first, no‑code automation platform that lets teams build, orchestrate, and scale AI‑powered workflows and agents in real time. By offering a drag‑and‑drop interface, a library of 3,000+ pre‑built app integrations (including OpenAI, Salesforce, HubSpot, and more), and security compliance (GDPR, SOC 2/3), Make enables businesses of any size to automate simple tasks or complex, enterprise‑wide processes without writing code. Users can design autonomous AI agents, monitor them on a live visual map, and customize automations to boost efficiency, reduce manual work, and accelerate innovation across IT, marketing, sales, finance, and CX functions. Over 350,000 organizations trust Make to streamline operations, improve collaboration, and unlock the full potential of AI and automation.',
    industries: [
      'Software (B2B)',
      'Developer Tools & APIs',
      'Artificial Intelligence & Machine Learning',
    ],
    socials: [
      { type: 'linkedin', url: 'https://linkedin.com/company/itsmakehq' },
      { type: 'x', url: 'https://x.com/integromat' },
      { type: 'instagram', url: 'https://instagram.com/itsmakehq' },
      { type: 'facebook', url: 'https://facebook.com/itsmakehq' },
      { type: 'youtube', url: 'https://youtube.com/@itsmake' },
    ],
    source: 'Context.dev brand-intelligence API',
    asOf: '2026-07-02',
  },
  oneLiner:
    'Make (make.com) is a closed-source, cloud-only visual workflow-automation platform where users connect app "modules" on a canvas into scenarios. It now also offers AI Agent blocks, an MCP server, and a JS/Python code step, billed on a per-module-execution credit model.',
  standoutFeatures: [
    {
      title: '3,000+ integrations and an 8,000+ template gallery',
      description:
        'Make lists 3,000+ integration apps and a public gallery of over 8,000 pre-built, importable scenario templates, free to browse on every plan including Free.',
      shortDescription: '3,000+ integrations and an 8,000+ template gallery, free on every plan.',
      source: {
        url: 'https://www.make.com/en/templates',
        label: 'Make Templates gallery',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Visual AI Agent reasoning panel',
      description:
        "AI Agent blocks run inside the same canvas as regular scenarios and expose a step-by-step 'Reasoning panel' showing every decision the agent makes, plus configurable manual-approval/stop points so agents run alongside deterministic logic rather than replacing it.",
      shortDescription: 'Step-by-step reasoning panel with configurable approval stop-points.',
      source: {
        url: 'https://www.make.com/en/ai-agents',
        label: 'Make AI Agents page',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'MCP Toolboxes for team-level shared servers',
      description:
        'Beyond exposing a single scenario as an MCP tool, Make offers MCP Toolboxes: team-level dedicated MCP servers that bundle a curated subset of multiple scenarios behind one shared endpoint for external AI clients to call.',
      shortDescription: 'Team-level MCP servers bundling multiple scenarios as tools.',
      source: {
        url: 'https://help.make.com/mcp-toolboxes',
        label: 'MCP toolboxes - Make Help Center',
        asOf: '2026-07-02',
      },
    },
  ],
  limitations: [
    {
      title: 'No self-hosting of the core platform',
      description:
        "Make is a fully managed multi-tenant SaaS; there is no option to run the Make engine itself on customer infrastructure. The only on-prem artifact is a lightweight 'agent' that bridges Make's cloud to a private network, not a self-hosted deployment of the platform.",
      shortDescription: 'No self-hosted deployment; only a network-bridging on-prem agent.',
      source: {
        url: 'https://www.make.com/en/on-prem-agents',
        label: 'Make on-prem agents page',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Proprietary, closed-source license',
      description:
        "Unlike open-source workflow tools, Make's codebase is not published; Celonis (Make's owner) retains exclusive ownership of the Services, and customers are contractually barred from copying, modifying, creating derivative works from, or reverse-engineering the platform, so there is no community fork/self-audit path and organizations depend entirely on Celonis's roadmap and infrastructure.",
      shortDescription: 'Closed-source codebase with no community fork or audit path.',
      source: {
        url: 'https://www.make.com/master-service-agreement.pdf',
        label: 'Master Services Agreement for Make, Section 4.4 & 6.1 (Celonis)',
        asOf: '2026-07-08',
      },
    },
    {
      title: 'Code step allows direct HTTP calls; custom package installs need Enterprise',
      description:
        "The native Make Code (JS/Python) module can make direct HTTP requests, though Make recommends using the dedicated HTTP module instead to avoid exposing credentials. Enterprise-plan customers can import custom third-party npm/PyPI libraries as declared dependencies; lower tiers only get Make's pre-installed common libraries.",
      shortDescription:
        'Code step permits HTTP calls; custom package installs are Enterprise-only.',
      source: {
        url: 'https://apps.make.com/code',
        label: 'Make Code app docs',
        asOf: '2026-07-08',
      },
    },
    {
      title: 'Granular RBAC gated to the Teams plan and above',
      description:
        "Full team/role-based permission management ('Teams and team roles', letting admins manage unlimited team permissions for scenario apps, templates, and connections) is only listed as a feature starting on the Teams plan ($38/mo) and Enterprise; lower tiers (Free, Core, Pro) get unlimited users but no role-based access controls, unlike Sim, which ships admin/write/read roles on every tier.",
      shortDescription: 'RBAC needs the Teams plan ($38/mo) or above.',
      source: {
        url: 'https://www.make.com/en/pricing',
        label: 'Make Pricing page',
        asOf: '2026-07-08',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value: 'Visual, node/module-based drag-and-drop scenario builder',
        detail:
          "Make's core paradigm is a visual canvas where users connect 'modules' (app actions/triggers) with routers, filters, iterators, and aggregators into a 'scenario'. AI Agents (2026) are built as blocks inside the same visual canvas, not a separate code environment. A 'Make Code' module (JS/Python) can be dropped in for pro-code logic, making it primarily visual with an optional code escape hatch (hybrid).",
        shortValue: 'Visual drag-and-drop canvas with optional code step',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/ai-agents',
            label: 'Make AI Agents page',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.make.com/en/pricing',
            label: 'Make Pricing page',
            asOf: '2026-07-02',
          },
        ],
      },
      learningCurve: {
        value:
          'Low for simple linear automations; moderate-to-steep for complex branching/error-handling logic',
        detail:
          'Third-party reviews consistently describe Make as having a steeper learning curve than simpler tools like Zapier: new users need time to understand field mapping and branching, while routers, filters, iterators/aggregators, and error handlers give more control for complex, multi-step workflows once learned.',
        shortValue: 'Easy for basics, steep for advanced logic',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://learn.g2.com/make-vs-zapier',
            label: 'Make vs. Zapier - G2 Learn',
            asOf: '2026-07-08',
          },
          {
            url: 'https://www.lindy.ai/blog/make-review',
            label: 'Make Review 2026 - Lindy',
            asOf: '2026-07-08',
          },
        ],
      },
      selfHostOption: {
        value:
          "No general self-hosting; cloud SaaS only, with a limited 'on-premise agent' for connecting internal networks",
        detail:
          "Make is a fully managed SaaS platform. Scenarios, credentials, and execution run on Make's own AWS infrastructure (US or EU data centers). There is no option to run the full Make engine on customer infrastructure. Make does offer an installable 'on-premise agent' (Java-based) that lets scenarios reach systems inside a private network, but this is a connectivity bridge, not a self-hosted deployment of Make itself.",
        shortValue: 'Cloud-only, no self-hosted engine',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/on-prem-agents',
            label: 'Make on-prem agents page',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.make.com/en/help/connections/using-an-on-premise-agent',
            label: 'On-premise agent help doc',
            asOf: '2026-07-02',
          },
        ],
      },
      deploymentOptions: {
        value:
          'Cloud only (multi-tenant SaaS), with a separately isolated AWS environment for Enterprise',
        detail:
          "Runs on Amazon AWS EC2 within Amazon VPC, multi-zone for availability. Enterprise plan customers get a 'separately managed AWS environment, isolated from the self-service cloud customers.' No Docker/Kubernetes/on-prem deployment of the platform itself is offered.",
        shortValue: 'Multi-tenant AWS cloud; isolated tier for Enterprise',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/security',
            label: 'Make Security page',
            asOf: '2026-07-02',
          },
        ],
      },
      templates: {
        value: 'Yes: large public template gallery, over 8,000 pre-built scenarios',
        detail:
          'make.com/en/templates hosts a filterable library (by app or category: Sales, Marketing, Operations, AI, etc.) of free, importable scenario templates available on all plans, including the Free tier.',
        shortValue: '8,000+ importable templates, free on every plan',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/templates',
            label: 'Make Templates gallery',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.make.com/scenario-templates',
            label: 'Scenario templates help doc',
            asOf: '2026-07-02',
          },
        ],
      },
      license: {
        value: 'Proprietary',
        detail:
          'Make (owned by Celonis) is closed-source commercial software; the Master Services Agreement states Celonis remains the exclusive owner of all right, title, and interest in the Services, and bars customers from copying, modifying, or reverse-engineering the platform, so there is no open-source license or public source repository.',
        shortValue: 'Closed-source, owned by Celonis',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/master-service-agreement.pdf',
            label: 'Master Services Agreement for Make, Section 6.1 (Celonis)',
            asOf: '2026-07-08',
          },
        ],
      },
      environmentPromotion: {
        value:
          'No formal dev/qa/prod environment-promotion pipeline; only manual clone/export-import of whole scenarios between teams or organizations',
        detail:
          "Make's organizational hierarchy is Organization > Teams, where teams scope access to templates, connections, webhooks, keys, data stores, and more. There is no dedicated 'environment' concept (e.g. dev/staging/prod) with a push/pull promotion workflow. The closest capability is manually cloning a scenario (Options > Clone) within the same organization, or exporting/importing a scenario's blueprint (JSON) between organizations, a process that loses existing connections and webhooks, which must be reconfigured afterward.",
        shortValue: 'No dev/staging/prod pipeline, manual clone/export only',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/organizations',
            label: 'Organizations | Make Help Center',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.make.com/teams',
            label: 'Teams | Make Help Center',
            asOf: '2026-07-02',
          },
          {
            url: 'https://community.make.com/t/moving-scenarios-from-one-organization-to-another/78092',
            label: 'Moving scenarios from one organization to another - Make Community',
            asOf: '2026-07-02',
          },
          {
            url: 'https://community.make.com/t/migrate-connections-and-scenarios-between-teams-in-make/70733',
            label: 'Migrate Connections and Scenarios Between Teams in Make - Make Community',
            asOf: '2026-07-02',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Version history with restore (up to plan-dependent retention, commonly cited as up to 60 days), plus a Cancel-to-revert unsaved-change safety net; no true undo/redo, no confirmed diff/compare view, no branching',
        detail:
          "Make lets users access and restore previously saved scenario versions (retention depends on pricing plan, commonly up to 60 days) to revert unwanted changes. There is no traditional undo/redo, but hitting 'Cancel' while editing discards unsaved changes and reverts to the last saved version. Execution/change history (separate from version history) logs run results and user edits (scheduling changes, edits, activation) and can be exported as CSV. Make's Help Center does not document a visual diff/compare view between two saved versions, and there is no branching model, only linear version history per scenario.",
        shortValue: 'Linear version history and restore, no branching',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/restore-a-previous-scenario-version',
            label: 'Restore a previous scenario version | Make Help Center',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.make.com/restore-and-recover-scenario',
            label: 'Restore and recover scenario | Make Help Center',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.make.com/scenario-history',
            label: 'Scenario history | Make Help Center',
            asOf: '2026-07-02',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          "No: Make does not support live, concurrent multi-user editing of the same scenario with synced cursors or selections. If two people edit the same scenario at the same time, the last person to save overwrites the other's changes; there is no real-time co-editing.",
        detail:
          'Make supports async scenario sharing (share a link/copy) and team-based access, but not simultaneous live editing with visible collaborators.',
        shortValue: 'No: last-save-wins, no live co-editing',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://community.make.com/t/what-happens-if-2-people-are-editing-a-scenario-at-the-same-time/69301',
            label:
              'What happens if 2 people are editing a scenario at the same time? - Make Community',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.make.com/scenario-sharing',
            label: 'Scenario sharing - Make Help Center',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeFileStorage: {
        value:
          "No: Make has no native file-storage system with folder hierarchy, link-based sharing (password/SSO options), and deleted-item recovery. Make's file handling is per-module/per-scenario (download, upload, transform, move files between apps and connected storage services like Google Drive, Box, Files.com), not a dedicated in-platform file store.",
        detail:
          'No dedicated Make file-storage/folder/trash feature is documented; only third-party storage app integrations and generic file-mapping help pages exist.',
        shortValue: 'No: only per-module file handling, no native store',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://help.make.com/working-with-files',
            label: 'Working with files - Make Help Center',
            asOf: '2026-07-02',
          },
        ],
      },
      dataTables: {
        value:
          'Yes: Make has a native Data Stores feature for storing structured records (fields/columns and items/rows), with a browsable table view in the UI for adding, viewing, updating, and deleting records. It behaves more like a key-value record store than a full spreadsheet: limits are size-based (1MB per store on Core, 10MB on Pro/Teams, custom on Enterprise, with per-record caps reported at 512KB-15MB depending on the source) rather than fixed row/column counts, and it lacks spreadsheet-style keyboard navigation (arrow-key cell movement, multi-cell copy-paste).',
        detail:
          'UI supports a table/grid browse view and manual record add/edit, but bulk spreadsheet-like editing (arrow-key navigation, drag-fill, multi-cell paste) is not documented.',
        shortValue: 'Yes: Data Stores (record/table store, size-capped)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/data-stores',
            label: 'Data stores - Make Help Center',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.make.com/api-documentation/api-reference/data-stores',
            label: 'Data Stores - Make API Developer Hub',
            asOf: '2026-07-02',
          },
        ],
      },
      richTextEditor: {
        value:
          "No: Make does not have a native inline rich-text/WYSIWYG editor for documents stored in the platform. Document creation happens through integrations such as Google Docs, where the 'Create a Document' module accepts plain text or HTML strings as input rather than offering an in-app editing surface. Make also ships a plain Markdown-related app/module for text conversion, not an editor.",
        detail:
          'Google Docs module supports HTML-formatted content field, and a separate Markdown app exists for parsing/conversion, but neither is an in-platform rich text editor UI.',
        shortValue: 'No: no native WYSIWYG editor, HTML/text via integrations only',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://apps.make.com/google-docs',
            label: 'Google Docs - Apps Documentation - Make',
            asOf: '2026-07-08',
          },
          {
            url: 'https://www.make.com/en/help/app/markdown',
            label: 'Markdown - Apps Documentation - Make',
            asOf: '2026-07-02',
          },
        ],
      },
      subWorkflows: {
        value:
          "Yes: Make's 'Call a Scenario' subscenario module lets a parent scenario invoke a saved sub-scenario as a step, passing structured inputs and, in synchronous mode, pausing until the sub-scenario finishes and returns outputs via a 'Return outputs' module.",
        detail:
          "Make's Subscenarios feature supports two modes: synchronous, where the parent calls the sub-scenario and pauses execution until it completes and returns output; and asynchronous, where the parent continues immediately without waiting. Each call creates its own separately logged run, and an error in the sub-scenario propagates back to the parent's error handling. This is a dedicated composition feature, distinct from triggering an unrelated scenario via a plain webhook.",
        shortValue: 'Yes: Call a Scenario module runs a sub-scenario as a step',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/subscenarios',
            label: 'Subscenarios - Make Help Center',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.make.com/scenario-inputs-and-scenario-outputs',
            label: 'Scenario inputs and scenario outputs - Make Help Center',
            asOf: '2026-07-02',
          },
        ],
      },
      customBlocks: {
        value:
          "No: Make has no feature to publish an existing scenario as an encapsulated, named block that appears in a shared module toolbar for other users across the organization to drop into their own separate scenarios. The closest capabilities are each narrower: 'Call a Scenario' (Subscenarios) can only invoke a scenario already created within the same team, is not exposed as a general block in a module picker, and Make's own docs don't describe it as hiding internal steps or always tracking a source's latest published version. 'Scenarios as AI Agent tools' lets a scenario's defined inputs/outputs be used as a callable tool, but only inside that specific AI Agent's own tool configuration, not as a general-purpose block any builder can add to any regular scenario. The Custom Apps SDK builds brand-new integration connectors that wrap third-party REST APIs; it has no mechanism to package an existing scenario itself as a block.",
        detail:
          "Per Make's Subscenarios help doc, you can 'only call a scenario created in your team,' scoping reuse to team boundaries rather than an org-wide block toolbar, with no documented internals-hiding or auto-latest-version guarantee. Per the Scenarios-for-AI-agents help doc, scenario-as-tool configuration happens inside AI Agents' own tab/module, not as a block available to all scenario builders. Per the Custom Apps Developer Hub, Custom Apps exist to integrate a third-party application that has no existing Make app, mapping REST endpoints and auth, not to publish an existing scenario as a reusable block.",
        shortValue: 'No: no publish-scenario-as-org-wide-block feature',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/subscenarios',
            label: 'Subscenarios - Make Help Center',
            asOf: '2026-07-08',
          },
          {
            url: 'https://help.make.com/scenarios-for-ai-agents',
            label: 'Scenarios for AI agents - Make Help Center',
            asOf: '2026-07-08',
          },
          {
            url: 'https://developers.make.com/custom-apps-documentation',
            label: 'Overview | Custom Apps Documentation | Make Developer Hub',
            asOf: '2026-07-08',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Yes: OpenAI, Anthropic Claude, Google Vertex AI (Gemini), Azure OpenAI, Mistral AI, Perplexity AI, Hugging Face, plus OpenAI-compatible custom models',
        detail:
          "Make's AI Agents page lists these integrated providers; AI Agent configuration docs also mention support for 'various LLMs including OpenAI-compatible models.'",
        shortValue: 'OpenAI, Anthropic, Gemini, Azure, Mistral, and more',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/ai-agents',
            label: 'Make AI Agents page',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.make.com/make-ai-agents-the-next-step-in-automation',
            label: 'Make AI Agents help doc',
            asOf: '2026-07-02',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          'Yes: dedicated AI Agent blocks with a visible reasoning/decision panel, distinct from plain data-routing modules',
        detail:
          "Make AI Agents (rolled out to all paid plans as of Jan 19, 2026) provide adaptive decision-making inside scenarios, with a 'Reasoning panel' on the canvas showing step-by-step decisions, plus manual-approval/stop-point guardrails so agents work alongside deterministic logic rather than replacing it.",
        shortValue: 'Visible reasoning panel with approval stop-points',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/ai-agents',
            label: 'Make AI Agents page',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.make.com/make-ai-agents-the-next-step-in-automation',
            label: 'Make AI Agents help doc',
            asOf: '2026-07-02',
          },
        ],
      },
      naturalLanguageBuilding: {
        value: 'Not a native, officially-branded feature',
        detail:
          "Natural-language scenario creation is available only through third-party/unofficial MCP servers (e.g., community 'make-mcp-server') feeding prompts to external AI assistants like Claude or Cursor, plus Make's own MCP Server letting external agents call Make scenarios as tools. Make has no first-party 'type a prompt, Make builds the scenario' copilot feature.",
        shortValue: 'No native prompt-to-scenario copilot',
        confidence: 'unknown',
        sources: [],
      },
      knowledgeBaseRag: {
        value: 'Yes: built-in Knowledge feature backed by a RAG vector database for AI Agents',
        detail:
          "Per Make's help docs, uploaded knowledge files are stored in a RAG vector database: files are chunked, converted to vectors, and the agent retrieves only relevant chunks at request time, reducing tokens used.",
        shortValue: 'Built-in RAG store for agent knowledge files',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/knowledge',
            label: 'Make Knowledge help doc',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.make.com/ai-agents-configuration',
            label: 'AI Agents configuration help doc',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpSupport: {
        value: 'Yes: official Make MCP Server (cloud-hosted)',
        detail:
          'Make offers a cloud-based Make MCP Server that turns scenarios into callable tools for AI agents/clients (e.g., Claude, Cursor) via a standardized token/URL, without local setup or infrastructure management, secured by a Make MCP Token.',
        shortValue: 'Cloud-hosted MCP server, no setup required',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/blog/model-context-protocol-mcp-server',
            label: 'Make blog: What is MCP Server?',
            asOf: '2026-07-02',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'Partial: manual approval steps and stop points for agents; no dedicated automated eval/testing suite',
        detail:
          "Make's AI Agents documentation describes user-configurable guardrails: 'set clear rules, add manual approvals, or stop the Agent at specific points,' with agents running alongside deterministic scenario logic. No dedicated automated evaluation/regression-testing framework (e.g., golden-dataset evals) is offered.",
        shortValue: 'Manual approvals only, no automated eval suite',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.make.com/en/ai-agents',
            label: 'Make AI Agents page',
            asOf: '2026-07-02',
          },
        ],
      },
      humanInTheLoop: {
        value:
          'Dedicated Human in the Loop (Enterprise) app. Closed beta, invite-only, Enterprise plan',
        detail:
          "Make offers a distinct 'Human in the Loop (Enterprise)' app (separate from a plain Sleep/Wait module) that creates a review request, returns a review URL, and sends the reviewed data to a webhook the customer defines. Notification/approval routing (email, Slack, custom form) is configured by the customer via that webhook rather than a fixed built-in channel. The scenario pauses at the module; a companion trigger 'Watch completed reviews' fires when a review is approved, adjusted, or canceled, letting the scenario branch and resume based on the reviewer's decision. As of 2026-07-02 this app is in closed beta, available only to invited Enterprise customers.",
        shortValue: 'Closed-beta review/approval app, Enterprise only',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/integrations/human-in-the-loop-enterprise',
            label: 'Human in the Loop (Enterprise) Integration | Make',
            asOf: '2026-07-02',
          },
          {
            url: 'https://apps.make.com/human-in-the-loop-enterprise',
            label: 'Human in the Loop - Apps Documentation',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.make.com/en/blog/human-in-the-loop',
            label: 'What is human in the loop (HITL) in AI? | Make',
            asOf: '2026-07-02',
          },
        ],
      },
      generativeMedia: {
        value:
          'No native built-in image/video/audio generation blocks; achieved only via third-party AI app integrations',
        detail:
          "Make does not ship its own first-party image, video, or TTS/STT generation modules. Generative-media workflows are built by wiring in separate apps/integrations for those providers (e.g. DALL·E for images, ElevenLabs for audio/TTS) as separate modules within a scenario rather than a native 'generate image/video/audio' block owned by Make.",
        shortValue: 'No native generation blocks, third-party apps only',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.make.com/en/blog/faceless-youtube-videos-make-ai',
            label: 'How to Make Faceless YouTube Videos with AI + Make | Make blog',
            asOf: '2026-07-02',
          },
          {
            url: 'https://community.make.com/t/video-generation-systems-that-work-with-make/55168',
            label: 'Video generation systems that work with Make? - Make Community',
            asOf: '2026-07-02',
          },
        ],
      },
      dynamicToolUse: {
        value: 'Not publicly documented',
        detail:
          'Make has not published documentation describing dynamic tool-selection behavior for AI Agents.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      modelFallback: {
        value: 'Not publicly documented',
        detail:
          'Make has not published documentation describing automatic model-fallback behavior for AI Agents.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      agentSkills: {
        value:
          'Unknown: No public Make documentation describes a feature for defining a reusable, named prompt or knowledge snippet once and invoking it by reference across multiple AI agents. Make AI Agents support per-agent context files (uploaded documents chunked into a RAG vector store) and a single system prompt/instructions field per agent, but nothing found indicates these are sharable, named, reusable units across agents.',
        detail:
          'Help Center pages on AI agent configuration and management describe per-agent context and instructions but do not mention a shared skill/snippet library across agents.',
        shortValue: 'Unknown: no reusable cross-agent skill unit found',
        confidence: 'unknown',
        sources: [],
      },
      nativeChatDeployment: {
        value:
          "No: Make AI Agents include a chat interface, but it is documented only as an internal testing/debugging tool for the builder to converse with an agent, not as a publicly deployable chat surface. Make has no native public chat widget or link for end users comparable to a hosted agent chat page. Agents are invoked from within scenarios via a 'Run an agent' module, or externally via channel integrations (Slack, WhatsApp, Telegram, Teams) built using Make's automation modules, or via the MCP server/API.",
        detail:
          "Make's own help pages ('Manage AI agents', 'Introduction to AI agents') describe internal agent management and a chat-based tester, with no mention of a public share link or embeddable widget for the agent itself.",
        shortValue: 'No: chat is internal testing only, not public deploy',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://help.make.com/ai-agents-configuration',
            label: 'AI Agents configuration - Make Help Center',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.make.com/manage-ai-agents',
            label: 'Manage AI agents - Make Help Center',
            asOf: '2026-07-02',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          "Unknown: Make's AI agent context files are split into chunks, embedded, and stored in Make's RAG vector database, but no public documentation describes a debugging/inspection view that exposes individual chunk index or chunk content from a knowledge base search result to the builder.",
        detail:
          'The chat-based agent tester shows tool selection and inputs/outputs, but not chunk-level retrieval detail.',
        shortValue: 'Unknown: chunking exists, chunk-level UI unconfirmed',
        confidence: 'unknown',
        sources: [],
      },
      parallelExecution: {
        value:
          "No: Make's own Router documentation states routes are processed sequentially, not in parallel, so the second route does not run until the first has finished.",
        detail:
          "The Router module splits a scenario into multiple routes/branches, but Make's help center explicitly documents that these routes execute one after another rather than concurrently, so there is no native fan-out/fan-in concurrent branch execution.",
        shortValue: 'No: Router branches run sequentially, not concurrently',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/router',
            label: 'Make Help Center: Router',
            asOf: '2026-07-02',
          },
        ],
      },
      a2aProtocol: {
        value:
          'No: no documentation found of shipped Agent2Agent (A2A) protocol support; Make discusses A2A only as an emerging industry pattern, not a feature it has implemented.',
        detail:
          "Make's own blog lists A2A (agent-to-agent) alongside MCP as one of four communication patterns expected to matter in 2026, but states Make currently handles agent connectivity via its MCP server and client modules plus its app library, without mentioning A2A support.",
        shortValue: 'No: A2A not documented as a supported feature',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.make.com/en/blog/agentic-operating-system',
            label: 'Make Blog: What Is an Agentic Operating System? 2026 Guide',
            asOf: '2026-07-02',
          },
        ],
      },
      loopIteration: {
        value:
          'Yes: Make has two dedicated Flow Control loop modules. The Iterator takes an existing array and outputs each element as a separate bundle, running every downstream module once per item, sequentially. The Repeater generates a fixed number of bundles from scratch (a numeric counter, no source array needed), also processed one at a time.',
        detail:
          "Per Make's Help Center, the Iterator splits an array into individual bundles that flow through the rest of the scenario one item at a time, while the Repeater runs a specified number of repetitions (its 'repeats' field) with each bundle carrying an incrementing counter item. Both are sequential, item-by-item execution; Make's separate Router feature (used for branching, not looping) is also documented as processing routes sequentially rather than in parallel.",
        shortValue: 'Yes: Iterator (array loop) and Repeater (counted loop)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/iterator',
            label: 'Iterator - Make Help Center',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.make.com/en/help/tools/flow-control',
            label: 'Flow control - Make Help Center',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value: '3,000+ apps (vendor-claimed)',
        detail:
          "Make's integrations page (make.com/en/integrations) states '3,000+ Integration Apps.' Some 2026 reviews cite a lower '1,400+ apps' figure, likely a different counting method (apps vs. individual modules); the primary vendor page says 3,000+.",
        shortValue: '3,000+ vendor-claimed integrations',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/integrations',
            label: 'Make Integrations page',
            asOf: '2026-07-02',
          },
        ],
      },
      triggerTypes: {
        value:
          'Instant/webhook triggers, scheduled (polling) triggers, and custom webhooks; app-event triggers via app-specific instant modules',
        detail:
          "Make supports app-specific 'instant' (webhook-based) triggers that fire in real time, scheduled/polling triggers (as low as 1-minute intervals on paid plans, 15-minute on Free), and generic custom webhooks that generate a unique HTTPS URL any external service can POST to, triggering the scenario.",
        shortValue: 'Instant webhooks, polling, and custom webhooks',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/webhooks',
            label: 'Make Webhooks help doc',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.make.com/en/pricing',
            label: 'Make Pricing page (execution interval limits)',
            asOf: '2026-07-02',
          },
        ],
      },
      customCodeSteps: {
        value:
          "Yes: native 'Make Code' module supporting JavaScript (Node.js) and Python, plus optional third-party packages on Enterprise",
        detail:
          'The Make Code app lets users write and run JS or Python inside a scenario execution with no external servers; common libraries (moment/lodash for JS, pendulum/toolz/requests for Python) are pre-installed, and Enterprise plans can import additional third-party packages as declared dependencies. Direct outbound API calls are technically possible, but Make recommends using the HTTP module instead to avoid exposing credentials.',
        shortValue: 'Native JS/Python step; HTTP calls possible, packages on Enterprise',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/blog/make-code-app',
            label: 'Make blog: Make Code App',
            asOf: '2026-07-02',
          },
          { url: 'https://apps.make.com/code', label: 'Make Code app docs', asOf: '2026-07-08' },
        ],
      },
      apiPublishing: {
        value:
          'Yes, via custom + response webhooks acting as API endpoints; plus a separate Make platform REST API',
        detail:
          "A scenario's Custom Webhook trigger generates a unique HTTPS endpoint; combined with a Webhook Response module, a scenario can receive a request, process it, and return a custom response, effectively publishing it as an API endpoint. Separately, Make exposes its own developer REST API (developers.make.com) for managing scenarios/hooks programmatically, distinct from publishing a scenario's own logic as a client-facing API/SDK.",
        shortValue: 'Scenarios as webhook APIs, plus platform REST API',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/webhooks',
            label: 'Make Webhooks help doc',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.make.com/api-documentation/api-reference/scenarios',
            label: 'Make Developer Hub: Scenarios API',
            asOf: '2026-07-02',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Apps SDK (VS Code extension + browser Apps Editor) for building custom apps/connectors, plus a Make Marketplace for publishing them; no dedicated first-party Node.js/Python client SDK found beyond the general REST API',
        detail:
          "Make provides the 'Make Apps Editor', a JSON/config-based custom-app development environment available both as a browser-based editor inside Make's dashboard and as a VS Code extension (the Apps SDK) that syncs local files to Make via API. A custom app is built from five components: base, connections, modules, RPCs, and webhooks. Built apps can be submitted to the Make Apps Marketplace (beta), subject to a review process (roughly 4-6 weeks) and limited to services not already covered by Make's built-in app library. No official multi-language client SDK (published Node.js or Python packages) exists beyond the documented REST API; client access is via plain REST calls only.",
        shortValue: 'Apps SDK for custom connectors, no client SDK',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.make.com/custom-apps-documentation',
            label: 'Overview | Custom Apps Documentation | Make Developer Hub',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.make.com/custom-apps-documentation/get-started/make-apps-editor/apps-sdk',
            label: 'Visual Studio Code | Custom Apps Documentation | Make Developer Hub',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.make.com/custom-apps-documentation/app-components',
            label:
              'App components (base, connections, modules, RPCs, webhooks) | Make Developer Hub',
            asOf: '2026-07-08',
          },
          {
            url: 'https://developers.make.com/api-documentation',
            label: 'Make API documentation | Make Developer Hub',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpPublishing: {
        value:
          "Yes: Make MCP Server lets a Make account expose its scenarios as callable MCP tools for external AI clients (Claude, ChatGPT, Cursor, etc.) to call with structured inputs/outputs; scenarios must be set to active and 'on demand,' and access is via an MCP token. Make also offers MCP Toolboxes, team-level dedicated MCP servers exposing a curated subset of scenarios as tools, in addition to separately supporting an MCP client for consuming external MCP servers.",
        detail:
          "Included in all Make plans at no extra cost per Make's own MCP page; this is the reverse direction from Make's separate MCP Client app which consumes other MCP servers.",
        shortValue: 'Yes: Make MCP Server publishes scenarios as tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/mcp',
            label: 'Make MCP Server | Make',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.make.com/get-started-with-make-mcp-server',
            label: 'Get started with Make MCP server - Make Help Center',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.make.com/mcp-toolboxes',
            label: 'MCP toolboxes - Make Help Center',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Credit-based subscription (monthly credit allotment; each module action/execution consumes 1 credit)',
        detail:
          "Make's pricing page states: 'each module action in your scenario, like adding a Google Sheet row or fetching Gmail account data, counts as one credit.' Plans are sold in credit tiers (starting at 10,000 credits/month for the cheapest listed prices), with annual billing discounted 15%+.",
        shortValue: 'Credits consumed per module execution',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/pricing',
            label: 'Make Pricing page',
            asOf: '2026-07-02',
          },
        ],
      },
      entryPaidPlan: {
        value: 'Core plan. $12/month for 10,000 credits/month (lowest listed price point)',
        detail:
          'Core adds over Free: unlimited active scenarios, scheduled scenarios down to 1-minute intervals, increased data transfer/file-size limits (5GB/100MB), and access to the Make API.',
        shortValue: 'Core plan, $12/mo for 10,000 credits',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/pricing',
            label: 'Make Pricing page',
            asOf: '2026-07-02',
          },
        ],
      },
      freeTier: {
        value: 'Yes: Free plan with 1,000 credits/month',
        detail:
          'Free tier limits: 2 active scenarios max, 15-minute minimum execution interval, 5-minute max execution time, 5MB max file size, 512MB data transfer, 3,000+ apps and basic routers/filters available, basic customer support with 90-day expert access.',
        shortValue: '1,000 credits/month, 2 active scenarios',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/pricing',
            label: 'Make Pricing page',
            asOf: '2026-07-02',
          },
        ],
      },
      byok: {
        value:
          "Yes: Make supports bringing your own LLM key for AI Agents, as an alternative to Make's own AI Provider, available on all plans",
        detail:
          "Make's pricing page states organizations can build and manage AI Agents using Make's own AI Provider (all plans) or their own LLM key, confirming BYOK for LLM API keys is directly supported and available on every plan, not just higher tiers.",
        shortValue: 'BYOK for LLM keys on every plan',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/pricing',
            label: 'Make Pricing page',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    security: {
      soc2: {
        value: 'Yes: SOC 2 Type II and SOC 3 completed; ISO 27001 certified; GDPR compliant',
        detail:
          "Make's Security page lists completed SOC 2 Type II audit, a publicly available SOC 3 report, ISO 27001 certification for the platform, and GDPR compliance. HIPAA is not mentioned on this page.",
        shortValue: 'SOC 2 Type II, SOC 3, ISO 27001, GDPR',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/security',
            label: 'Make Security page',
            asOf: '2026-07-02',
          },
        ],
      },
      dataResidency: {
        value:
          'Yes: choice of US or EU data center at organization creation; Enterprise gets an isolated AWS environment',
        detail:
          "Each Make organization selects a data-center region (US or EU, e.g. eu1.make.com) at creation time; this cannot be changed afterward. Enterprise customers additionally run in a 'separately managed AWS environment, isolated from self-service cloud customers.'",
        shortValue: 'US or EU region, fixed at creation',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/security',
            label: 'Make Security page',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.make.com/organizations',
            label: 'Make Organizations help doc',
            asOf: '2026-07-02',
          },
        ],
      },
      rbac: {
        value:
          "Yes: 'Teams and team roles' with unlimited team permissions, on Teams and Enterprise plans",
        detail:
          "Make's pricing page describes 'Teams and team roles' enabling 'unlimited team permissions for scenario apps, templates, and connections' on the Teams and Enterprise tiers; lower tiers get unlimited users but not the granular role/team management.",
        shortValue: 'Team roles on Teams and Enterprise plans',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/pricing',
            label: 'Make Pricing page',
            asOf: '2026-07-02',
          },
        ],
      },
      auditLogging: {
        value:
          'Yes: Audit logs available on Teams and Enterprise plans; retained 30 days by default',
        detail:
          "Make's pricing page lists 'Audit logs' as a Teams/Enterprise feature documenting user actions. The Security page states log data is stored 30 days by default on general plans, with an extended (unspecified) retention period available on Enterprise.",
        shortValue: '30-day retention, Teams/Enterprise only',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/pricing',
            label: 'Make Pricing page',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.make.com/en/security',
            label: 'Make Security page',
            asOf: '2026-07-02',
          },
        ],
      },
      additionalCompliance: {
        value:
          'SOC 2 Type II, SOC 3, and ISO 27001 certified, plus GDPR adherence; no HIPAA, PCI, or FedRAMP mentioned',
        detail:
          "Make's Security page states the company operates an ISO 27001-certified information security program and runs infrastructure compliant with SOC 3 and SOC 2 Type II audits, alongside GDPR adherence (Make also has a dedicated GDPR page). HIPAA compliance is not mentioned or offered.",
        shortValue: 'No HIPAA, PCI, or FedRAMP',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/security',
            label: 'Automation Security & Compliance | Make',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.make.com/en/privacy-and-gdpr',
            label: 'Make.com GDPR | General Data Protection Regulation | Make',
            asOf: '2026-07-02',
          },
          {
            url: 'https://community.make.com/t/information-security-compliance-soc2-iso27001-hipaa-etc/8052',
            label: 'Information Security Compliance (SOC2, ISO27001, HIPAA, etc.) - Make Community',
            asOf: '2026-07-02',
          },
        ],
      },
      modelAndToolGovernance: {
        value: 'Not publicly documented',
        detail:
          'Make has not published documentation describing model- or tool-level governance controls for AI Agents.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      credentialGovernance: {
        value:
          "No: Make's connection access control is team-scoped, not credential-specific. Connections created within a team are visible and usable by all members with at least the Restricted Team Member role. Instance/organization user roles can be customized, but there is no documented way to restrict a role or permission group to specific individual stored credentials beyond team membership.",
        detail:
          'White Label docs describe customizable instance-level user roles and team permissions (add/edit/delete connections), but no per-credential allowlisting within a role was found.',
        shortValue: 'No: team-level only, not per-credential',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://community.make.com/t/connections-and-keys-access-management-within-teams/51912',
            label: 'Connections and Keys access management within teams - Make Community',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.make.com/white-label-documentation/manage-organizations-and-teams/manage-instance-level-user-access-roles',
            label: 'Manage instance-level user access roles - Make Developer Hub',
            asOf: '2026-07-02',
          },
        ],
      },
      whiteLabeling: {
        value:
          'Yes: Make offers a White Label / OEM product that lets a customer rebrand a Make instance with their own product name (shown in browser tab and emails), custom login-page and UI colors, custom favicon, and custom logos for light and dark backgrounds.',
        detail:
          'This is a separate enterprise/OEM offering from standard Make plans, documented in the Make White Label Developer Hub.',
        shortValue: 'Yes: White Label OEM rebrand (name, colors, logo)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.make.com/white-label-documentation/customize-your-instance/rebrand-your-instance',
            label: 'Rebrand your instance - Make White Label Developer Hub',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.make.com/white-label-documentation',
            label: 'Make White Label - Make Developer Hub',
            asOf: '2026-07-02',
          },
        ],
      },
      dataRetention: {
        value:
          'Yes (partially): Execution/run history retention in Make is plan-dependent, with longer retention on higher-tier plans, rather than freely configurable by default. White Label instance admins can set organization log retention (default 60 days if unset), and audit logs can retain data for up to 365 days.',
        detail:
          'Standard Make plans get a fixed retention window tied to pricing tier; granular org-configurable retention (beyond plan tier) appears mainly in the White Label/OEM product, not confirmed for standard Team/Enterprise orgs.',
        shortValue: 'Plan-tiered retention; White Label admins can set org log retention',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://help.make.com/scenario-history',
            label: 'Scenario history - Make Help Center',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.make.com/white-label-documentation/manage-the-end-user-life-cycle/provision-new-users/define-the-organizations-license',
            label: "Define the organization's license - Make White Label Developer Hub",
            asOf: '2026-07-02',
          },
        ],
      },
      piiRedaction: {
        value:
          'Unknown: No public Make documentation was found describing a built-in feature to detect and redact/block PII (emails, SSNs, etc.) in workflow content or retained execution logs. This is distinct from generic output-validation guardrails, which also were not documented for Make.',
        detail:
          'Searches returned only generic third-party PII/data-masking explainer content, nothing Make-specific.',
        shortValue: 'Unknown: no documented PII redaction feature',
        confidence: 'unknown',
        sources: [],
      },
      sso: {
        value:
          'Yes: Make offers enterprise single sign-on supporting both SAML 2.0 and OpenID Connect (OAuth 2.0-based), configurable per organization, with documented identity provider support for Okta (SAML) and Microsoft Azure AD (SAML and OIDC), plus domain claiming to prevent self-service account creation outside SSO.',
        detail:
          "SSO is configured per organization and is part of Make's enterprise/White Label offering; Google SAML is also referenced as supported.",
        shortValue: 'Yes: SSO via SAML 2.0 and OIDC (Enterprise)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/single-sign-on',
            label: 'Single Sign-on - Make Help Center',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.make.com/white-label-documentation/manage-login/configure-single-sign-on',
            label: 'Configure Single Sign-on - Make White Label Developer Hub',
            asOf: '2026-07-02',
          },
        ],
      },
      thirdPartyVetting: {
        value:
          'Partial: any developer can build a custom Make app, but publishing it to the public Apps Marketplace requires passing a Make QA code review before it becomes available to all users',
        detail:
          "Make's Developer Hub documents an open custom-app development model (any third-party developer can build and privately use a custom app), combined with a gated marketplace: to share an app with all Make users, the developer must request an app review, and Make's QA team examines the app's code against app standards and best practices (including sanitization of sensitive data such as API keys/tokens) before publishing it publicly. This is a lighter-touch, code-reviewed model rather than either a fully closed first-party catalog or a fully open, unreviewed community marketplace. No security incident involving malicious or credential-leaking third-party Make apps has been publicly documented.",
        shortValue: 'Partial: open custom apps, but QA-reviewed before public marketplace listing',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.make.com/custom-apps-documentation/app-review/overview',
            label: 'App review overview - Make Developer Hub',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.make.com/custom-apps-documentation/app-review/prerequisites',
            label: 'App review prerequisites - Make Developer Hub',
            asOf: '2026-07-08',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Per-execution history with module-level bundle/output inspection and CSV export; no dedicated metrics dashboard (latency percentiles/error-rate charts)',
        detail:
          "Make's Scenario History / Execution History is customer-facing and gives per-run detail: run date/time, trigger type, status (success/warning/error), duration, operations consumed, transferred data size, plus per-module bundles processed and module inputs/outputs/logs. Effectively span-like tracing at the module level for a given run. History is exportable as CSV, and full-text search across module outputs is available on Pro+ plans. No aggregate metrics dashboard (e.g. p50/p95 latency, error-rate trends across scenarios) exists; visibility is per-execution/per-scenario, not a fleet-wide observability dashboard.",
        shortValue: 'Per-run module tracing, no metrics dashboard',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/scenario-history',
            label: 'Scenario history | Make Help Center',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.make.com/en/help/scenarios/scenario-execution-history',
            label: 'Scenario execution history | Make',
            asOf: '2026-07-02',
          },
        ],
      },
      durabilityModel: {
        value:
          "Automatic retry with exponential backoff for specific transient errors, checkpointed 'incomplete executions' that can be manually edited and replayed with original (editable) inputs",
        detail:
          "Make auto-retries incomplete executions caused by rate-limit errors, connection errors, and module-timeout errors, using exponential-backoff scheduling. Default 3 retry attempts with a 15-minute delay, configurable in the error-handler settings. When 'Incomplete Executions' is enabled (off by default) and a Break error handler fires, Make stores the erroring bundle plus the remaining flow as a checkpoint; the customer can then manually retry, edit the bundle data before retrying, or delete it. Replay-from-checkpoint is a supported, customer-facing capability, not fully automatic beyond the built-in retry policy.",
        shortValue: 'Auto-retry plus manual checkpoint replay',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/automatic-retry-of-incomplete-executions',
            label: 'Automatic retry of incomplete executions | Make Help Center',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.make.com/incomplete-executions',
            label: 'Incomplete executions | Make Help Center',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.make.com/manage-incomplete-executions',
            label: 'Manage incomplete executions | Make Help Center',
            asOf: '2026-07-02',
          },
        ],
      },
      failureAlerting: {
        value:
          'Proactive email notifications when a scenario stops/errors or is auto-deactivated due to errors; no built-in cost/latency-threshold alerting',
        detail:
          "Make sends email notifications by default when a scenario encounters a warning/error or is automatically deactivated due to repeated errors, so customers are proactively notified rather than needing to check manually. Notification preferences are managed per-organization on the user's Profile > Email preferences page. Proactive cost/usage-threshold alerting (e.g. 75/90/100% of plan limit) is not currently a built-in capability. Only failure/deactivation alerting is confirmed.",
        shortValue: 'Email alerts on failure, no usage-threshold alerts',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/manage-your-email-preferences',
            label: 'Manage your email preferences | Make Help Center',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.make.com/introduction-to-errors-and-warnings',
            label: 'Introduction to errors and warnings | Make Help Center',
            asOf: '2026-07-02',
          },
          {
            url: 'https://community.make.com/t/how-to-set-a-operation-threshold-warning-per-scenario/38251',
            label: 'How to set an operation threshold/warning per scenario - Make Community',
            asOf: '2026-07-02',
          },
        ],
      },
      dataDrains: {
        value:
          "Unknown: Make has no documented built-in, continuous export pipe of execution/audit/usage data to an external destination like S3, BigQuery, or Datadog. Make exposes webhooks and an API that could be scripted to push data out, and White Label audit logs can retain up to 365 days, but there is no dedicated 'data drain' style continuous-export feature.",
        detail:
          'Users would need to build a scenario/API polling workflow themselves; this is different from a first-class continuous data-drain product feature.',
        shortValue: 'Unknown: no dedicated export/drain feature found',
        confidence: 'unknown',
        sources: [],
      },
      asyncExecution: {
        value:
          "Yes: Make scenarios triggered by webhooks or an MCP/API call run in the background rather than blocking the caller. Make's own docs state that even after a scenario-run tool call times out, the called scenario keeps running in Make for up to 40 minutes, and the caller can retrieve the output once it finishes. Make also keeps a persistent Executions log, plus an 'incomplete executions' safety store, that a caller can check later for run status and output.",
        detail:
          "Instant (webhook) triggers process requests as they arrive and return an immediate HTTP ack (default 200/400/429) while the scenario itself keeps running; the caller can poll the scenario's execution history or retrieve output afterward. This is documented explicitly for the MCP server tool-call flow, and the same instant-trigger/queueing model applies to webhooks generally.",
        shortValue: 'Yes, background execution with later retrieval',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.make.com/mcp-server',
            label: 'Make MCP Server docs (40-minute background run, retrieve output after finish)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.make.com/webhooks',
            label:
              'Make Help Center: Webhooks (instant parallel processing, default response codes)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.make.com/incomplete-executions',
            label:
              'Make Help Center: Incomplete executions (stores unfinished runs for later resolution)',
            asOf: '2026-07-02',
          },
        ],
      },
      executionLimits: {
        value:
          "Make's MCP Server enforces a per-call timeout of 25 seconds (OAuth authentication) or 40 seconds (MCP token authentication) before returning a timeout response, after which the called scenario continues running for up to 40 minutes in the background. Make does not publish a general per-module/API-call timeout figure or documented concurrent-execution caps per plan tier; the commonly cited ~40-second module timeout is user-reported, not officially documented. Make lets admins cap how many instant-trigger scenario runs can start per minute, a configurable rate limit available on all plans, though no specific default number is published.",
        detail:
          "Per Make's MCP Server docs, the timeout before a timeout response is returned depends on the authentication method: 25 seconds for OAuth, 40 seconds for an MCP token; the called scenario itself keeps running in the background for up to 40 minutes. help.make.com/scenario-settings, sometimes cited for general module/API-call execution limits, does not document any timeout figure at all. Admins can cap instant-trigger scenario starts per minute via help.make.com/scenario-rate-limits-for-instant-triggers, but that page does not state a specific default numeric ceiling, and Make does not publicly document concurrent-execution-count limits per plan tier.",
        shortValue:
          '25s/40s MCP call timeout; 40-min background run; no published module-timeout figure',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.make.com/mcp-server',
            label: 'Make MCP Server docs: 25s/40s call timeout, 40-minute background run',
            asOf: '2026-07-08',
          },
          {
            url: 'https://help.make.com/scenario-rate-limits-for-instant-triggers',
            label: 'Make Help Center: Scenario rate limits for instant triggers',
            asOf: '2026-07-08',
          },
          {
            url: 'https://help.make.com/scenario-settings',
            label: 'Make Help Center: Scenario settings (no documented timeout figure)',
            asOf: '2026-07-08',
          },
        ],
      },
      partialFailureHandling: {
        value:
          "Yes: Make lets you attach an error handler route to any module. Directives such as Resume, Ignore, and Break let the scenario keep processing the rest of the run instead of the whole execution halting on one failed step. Resume substitutes a fallback value for the failed module's output and continues with the next module; Ignore logs the error and continues. Both skip only the failed item rather than stopping the entire scenario.",
        detail:
          "Make's error-handling model attaches a dedicated error route to a module; directives available include Resume (continue with substitute output), Ignore (continue, log only), Commit/Rollback (transaction-style), and Break (retry later via incomplete executions), giving fine-grained continue-vs-halt control per step rather than an all-or-nothing failure model.",
        shortValue: 'Yes, per-module error routes let run continue',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.make.com/error-handlers',
            label: 'Make Help Center: Error handlers (directive list)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.make.com/resume-error-handler',
            label: 'Make Help Center: Resume error handler',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.make.com/overview-of-error-handling',
            label: 'Make Help Center: Overview of error handling',
            asOf: '2026-07-02',
          },
        ],
      },
      unattendedExecution: {
        value:
          "Yes: Make is a fully managed multi-tenant SaaS running on Amazon AWS, so scheduled, webhook, and MCP-triggered scenarios execute entirely on Make's own servers with zero dependency on any client device staying open, awake, or connected.",
        detail:
          "Scenario execution happens on Make's AWS infrastructure regardless of trigger type (scheduled, instant/webhook, or MCP tool call); closing the browser tab or shutting down a laptop has no effect on a scheduled or triggered scenario. The only local component Make offers is an optional on-premise agent that bridges Make's cloud to a private network for connectivity, not a requirement for scenarios themselves to run.",
        shortValue: "Yes: runs server-side on Make's AWS infrastructure, no client dependency",
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/security',
            label: 'Make Security page',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.make.com/en/on-prem-agents',
            label: 'Make on-prem agents page',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          "Tiered: community/basic support on Free, 'technical support from expert team' on Core/Pro, dedicated consultants on Teams, 24/7 senior-specialist support on Enterprise",
        detail:
          "Per Make's pricing page: Free gets '90-day expert access to get started'; Core and Pro get 'technical support from our expert team'; Teams gets 'high-priority guidance from dedicated consultants'; Enterprise gets '24/7 top-priority assistance from senior specialists' plus a Value Engineering Team and information-security compliance review support. Exact channel (email vs. chat vs. phone) is not specified on the page.",
        shortValue: 'Tiered support, 24/7 on Enterprise',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/pricing',
            label: 'Make Pricing page',
            asOf: '2026-07-02',
          },
        ],
      },
      sla: {
        value:
          'Enterprise plan states a 99.5% Cloud Service Uptime SLA with defined Customer Support Service SLAs',
        detail:
          "Make's Security page states the Enterprise plan carries a '99.5% Cloud Service Uptime' commitment along with defined Customer Support Service SLAs; exact response-time SLA numbers require a sales consultation and are not published on the page.",
        shortValue: '99.5% uptime SLA, Enterprise only',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.make.com/en/security',
            label: 'Make Security page',
            asOf: '2026-07-02',
          },
        ],
      },
      community: {
        value:
          'Unknown exact size. Make Community forum and unofficial Facebook groups exist, but no publicly stated member count',
        detail:
          "Make operates an official community forum at community.make.com, and unofficial Facebook groups (e.g. 'Make.com (formerly Integromat) User Community') exist, but no official size figure (forum members, Discord, GitHub stars) is publicly published.",
        shortValue: 'Active forum, no published member count',
        confidence: 'unknown',
        sources: [],
      },
      companyMaturity: {
        value:
          'Founded 2012 (as Integromat, Prague, Czech Republic; bootstrapped, no VC rounds); acquired by Celonis for $100M+ in October 2020; rebranded to Make in 2022; operates as a business unit of Celonis, whose parent has raised ~$1.77B and is valued at ~$11-13B with 3,000+ employees (2024/2026 figures)',
        detail:
          "Integromat was conceived in 2012 by Patrik Šimek in Prague and launched publicly in 2016. It grew to roughly $10M revenue entirely bootstrapped, with no VC funding raised, before Celonis (Germany/US) acquired it in October 2020 for a reported $100M+. TechCrunch's acquisition-day coverage cites 'more than 11,000 customers,' while a separate Latka estimate for the same year puts total registered users at 250K, a gap likely reflecting paying customers versus all signups rather than a contradiction. Sixteen months later, in February 2022, it was rebranded as 'Make' and now operates as a business unit within Celonis. Make has not disclosed separate headcount or funding figures as a standalone entity. Parent company Celonis (founded 2011 by Alex Rinke, Bastian Nominacher, and Martin Klenk) has raised approximately $1.77B in total funding, is valued at an estimated $11-13B, and reported 3,000+ staff across 20+ offices as of 2024.",
        shortValue: 'Founded 2012, acquired by Celonis in 2020',
        confidence: 'verified',
        sources: [
          {
            url: 'https://techcrunch.com/2020/10/14/celonis-acquires-czech-startup-integromat-to-accelerate-move-to-process-automation/',
            label: 'Celonis acquires Czech startup Integromat | TechCrunch',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.businesswire.com/news/home/20220222005231/en/Integromat-Evolves-to-Make-Expanding-Its-Vision-to-Empower-Creators-to-Innovate-Without-Limits',
            label: 'Integromat Evolves to Make | Businesswire',
            asOf: '2026-07-02',
          },
          {
            url: 'https://en.wikipedia.org/wiki/Celonis',
            label: 'Celonis - Wikipedia',
            asOf: '2026-07-02',
          },
          {
            url: 'https://getlatka.com/companies/integromat',
            label: 'How Integromat hit $10M revenue and 250K customers in 2020 | Latka',
            asOf: '2026-07-02',
          },
        ],
      },
      academy: {
        value:
          'Yes: Make operates a free, self-paced online learning platform called Make Academy (academy.make.com), with structured courses from Foundation through Advanced levels, bundles like Make Basics and Foundation, assessments, and Credly-verified digital badges/certifications.',
        detail:
          'Course enrollment gives 6 months of access; certification path can take about 15 hours across levels. Separate Make Partner Training portal also exists for partners.',
        shortValue: 'Yes: Make Academy with certifications',
        confidence: 'verified',
        sources: [
          {
            url: 'https://academy.make.com/',
            label: 'Make Academy',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.make.com/en/blog/learn-automation-make-academy',
            label: 'Learning Automation: Introducing the New Make Academy',
            asOf: '2026-07-02',
          },
        ],
      },
    },
  },
}
