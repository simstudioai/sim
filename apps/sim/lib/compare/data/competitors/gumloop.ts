import { GumloopIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Researched and cross-verified against live vendor sources on 2026-07-02. */
export const gumloopProfile: CompetitorProfile = {
  id: 'gumloop',
  name: 'Gumloop',
  website: 'https://www.gumloop.com',
  brand: {
    icon: GumloopIcon,
    selfFramed: true,
    colors: ['#fb3e97', '#fc87c0', '#7c7c7c'],
    description:
      'Gumloop is an AI automation platform that enables non-technical teams to build their own AI agents without code or engineering support. Marketing, sales, operations, and support teams can create and deploy workflows instantly by simply typing. The platform lets users design, test, and run AI-driven automations that streamline repetitive tasks, integrate with existing tools, and scale processes. Trusted by companies such as Shopify, DoorDash, Instacart, and Webflow, Gumloop helps organizations automate the workflows that matter most, accelerating productivity and reducing reliance on engineering tickets.',
    industries: ['Artificial Intelligence & Machine Learning', 'Software (B2B)'],
    socials: [
      { type: 'x', url: 'https://x.com/gumloop' },
      { type: 'linkedin', url: 'https://linkedin.com/company/gumloop' },
      { type: 'youtube', url: 'https://youtube.com/@Gumloop_AI' },
    ],
    source: 'Context.dev brand-intelligence API',
    asOf: '2026-07-02',
  },
  oneLiner:
    "Gumloop is a hosted platform, now positioned by the vendor as chat-based 'AI agent builder' first (Connectors, Skills, Knowledge Sources, Triggers) rather than a visual workflow tool — its own materials say 'Gumloop is not a visual workflow builder. It is an agent builder' — while still retaining its original drag-and-drop workflow canvas as a now vendor-labeled 'Legacy' feature alongside native MCP (Model Context Protocol) integration support.",
  standoutFeatures: [
    {
      title: '250+ fully hosted MCP servers',
      description:
        'Gumloop offers 250+ pre-built, zero-setup hosted MCP servers spanning popular services, letting agents connect to external tools without manual configuration.',
      shortDescription: '250+ zero-setup hosted MCP servers across popular services.',
      source: {
        url: 'https://www.gumloop.com/mcp',
        label: 'Gumloop: Fully Hosted MCP Servers',
        asOf: '2026-09-15',
      },
    },
    {
      title: 'Gummie copilot builds, edits, and debugs flows from natural language',
      description:
        "Beyond building new flows from a prompt, Gumloop's AI copilot, Gummie, can edit, debug, and run existing workflows: users describe what they want changed or fixed in plain English and Gummie figures out the implementation.",
      shortDescription:
        'Gummie copilot can build, edit, debug, and run workflows from natural-language prompts.',
      source: {
        url: 'https://www.gumloop.com/changelog',
        label: 'Gumloop Changelog',
        asOf: '2026-09-15',
      },
    },
    {
      title: 'Plain-English, org-wide guardrail policy engine',
      description:
        "Organizations can define app/tool usage policies in plain English ('App Rules') at the organization level or the individual-agent level (Gumloop's current App Rules documentation does not describe a separate team-level scope); violating actions can be blocked or tagged, with every evaluated call logged for audit. Organization-wide rule scope is an Enterprise-tier capability per Gumloop's pricing page (Pro is limited to agent-scoped rules).",
      shortDescription: 'Plain-English App Rules; org-wide scope is Enterprise-only.',
      source: {
        url: 'https://docs.gumloop.com/enterprise-features/app-policies/app-rules',
        label: 'App Rules - Gumloop docs',
        asOf: '2026-09-15',
      },
    },
    {
      title: 'Enterprise VPC deployment with zero data retention',
      description:
        'Enterprise customers can have Gumloop deployed and operated inside their own cloud (VPC) for data residency, combined with zero-data-retention agreements with major LLM providers and BYOK support.',
      shortDescription:
        'Enterprise VPC deployment plus zero-data-retention agreements with LLM providers.',
      source: {
        url: 'https://www.gumloop.com/solutions/security',
        label: 'Gumloop Security & Trust',
        asOf: '2026-09-15',
      },
    },
    {
      title: 'Built-in agent evaluation and regression testing',
      description:
        'Teams can define test cases and grade agent responses to catch regressions before shipping changes, alert on low-scoring agent chat evaluations, and test individual nodes with fake inputs from the canvas.',
      shortDescription: 'Test cases and grading catch agent regressions before changes ship.',
      source: {
        url: 'https://www.gumloop.com/changelog',
        label: 'Gumloop Changelog',
        asOf: '2026-09-15',
      },
    },
  ],
  limitations: [
    {
      title: 'No public self-hosting of the core platform',
      description:
        "Gumloop is only available as managed SaaS or an enterprise-managed VPC deployment operated by Gumloop inside a customer's cloud project. There is no downloadable, self-managed install of the Gumloop application itself; Gumloop's own guMCP_template repo is a self-hosted MCP-server starter, not an install of the platform.",
      shortDescription: 'No downloadable self-hosted install. Only managed SaaS or enterprise VPC.',
      source: {
        url: 'https://www.gumloop.com/solutions/security',
        label: 'Gumloop Security & Trust',
        asOf: '2026-09-15',
      },
    },
    {
      title: 'Proprietary license, closed source',
      description:
        'The core Gumloop application has no open-source license; Gumloop\'s own Terms of Service state the Service, its features, and its functionality "are and will remain the exclusive property of AgentHub Inc. (doing business as Gumloop) and its licensors," unlike some workflow-automation competitors that ship an open-source core.',
      shortDescription: 'Closed commercial product with no open-source core.',
      source: {
        url: 'https://www.gumloop.com/tos',
        label: 'Gumloop Terms of Service',
        asOf: '2026-09-15',
      },
    },
    {
      title: 'Inconsistent/unclear integration count across vendor pages',
      description:
        "Gumloop's own pages now give three differing figures for integrations, and the numbers have shifted since this file was first researched: its docs introduction page, which previously cited '100+ pre-built nodes and integrations,' has been fully rewritten around an agent-first structure and no longer states any integration count; its dedicated MCP page advertises '250+ MCP servers, zero setup'; its Custom MCP Servers docs page separately states 'Gumloop already has 50+ pre-built MCP servers'; and its current Agents documentation describes Connectors as '150+' integrations (e.g. Gmail, Salesforce, Slack, Notion, and 150+ more). None of these pages cross-reference each other, and the dedicated /integrations directory page still returns a 404, making an exact, citable integration count hard to pin down from primary sources.",
      shortDescription:
        'Vendor pages cite three different integration counts (50+, 150+, 250+) with no single authoritative figure.',
      source: {
        url: 'https://docs.gumloop.com/getting-started/introduction',
        label: 'Getting Started - Gumloop docs',
        asOf: '2026-09-15',
      },
    },
    {
      title:
        'No documented chunk-level visibility into the new Knowledge Sources / Company Brain feature',
      description:
        'Gumloop now documents a built-in knowledge-base feature (Knowledge Sources / Company Brain, see aiCapabilities.knowledgeBaseRag) that lets agents search Google Drive, Notion, Slack, GitHub, Confluence, and uploaded files with citations. However, no official documentation describes a chunk-level debugging view (chunk index/content) for this retrieval — see kbChunkVisibility for a dedicated fact on that gap.',
      shortDescription:
        'Company Brain now exists; chunk-level retrieval detail still undocumented.',
      source: {
        url: 'https://docs.gumloop.com/core-concepts/agents',
        label: 'Agents - Gumloop docs (Knowledge Sources / Company Brain)',
        asOf: '2026-09-15',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          "Chat-first agent builder (Connectors, Skills, Knowledge Sources, Triggers, Subagents) that is vendor-positioned as primary, plus a separate drag-and-drop visual canvas ('Flows') now labeled 'Legacy' on Gumloop's own pricing page; an AI copilot ('Gummie') can still generate/modify Flows from natural-language prompts",
        detail:
          "Gumloop's own site (gumloop.com/blog/agentic-ai-tools, June 2026) states 'Gumloop has two main features, Flows and Agents' — Flows are the original visual/no-code drag-and-drop canvas for chaining nodes into workflows, now labeled 'Workflows (Legacy)' on Gumloop's pricing page, while Agents (built from Connectors, Skills, Knowledge Sources, and Triggers, configured via chat) are the vendor's current primary framing, per Gumloop's own Y Combinator profile disclaimer: 'Gumloop is not a visual workflow builder. It is an agent builder.' A chat-based AI copilot named Gummie can still build and edit Flows from plain-English instructions.",
        shortValue: 'Chat-first agent builder; visual canvas now Legacy',
        confidence: 'verified',
        sources: [
          { url: 'https://www.gumloop.com', label: 'Gumloop homepage', asOf: '2026-09-15' },
          {
            url: 'https://www.gumloop.com/blog/agentic-ai-tools',
            label: 'Gumloop blog: agentic AI tools',
            asOf: '2026-09-15',
          },
          {
            url: 'https://www.gumloop.com/pricing',
            label: 'Gumloop Pricing (Workflows (Legacy) section)',
            asOf: '2026-09-15',
          },
        ],
      },
      learningCurve: {
        value:
          'Low for basic no-code flows aimed at non-technical business users; steeper for advanced use of custom Python code nodes and multi-agent orchestration',
        shortValue: 'Easy for basics, steeper for code and multi-agent',
        confidence: 'estimated',
        sources: [
          { url: 'https://www.gumloop.com', label: 'Gumloop homepage', asOf: '2026-09-15' },
        ],
      },
      selfHostOption: {
        value:
          'No public self-host option for the core Gumloop app; enterprise customers can get a managed Virtual Private Cloud (VPC) deployment into their own cloud (e.g. GCP) instead of full self-hosting',
        detail:
          "Gumloop deploys and operates the platform inside the customer's cloud project rather than offering a downloadable, self-managed open-source install. Gumloop's own guMCP_template repo is an open-source starter for self-hosted MCP servers, but it is not an install of the Gumloop app itself.",
        shortValue: 'No self-host; VPC deployment only',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.gumloop.com/solutions/security',
            label: 'Gumloop Security & Trust',
            asOf: '2026-09-15',
          },
          {
            url: 'https://github.com/gumloop/guMCP_template',
            label: "guMCP_template (Gumloop's self-hosted MCP starter repo)",
            asOf: '2026-09-15',
          },
        ],
      },
      deploymentOptions: {
        value:
          "Managed SaaS (cloud) and enterprise VPC deployment into customer's own cloud region",
        shortValue: 'Managed SaaS or enterprise VPC',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.gumloop.com/solutions/security',
            label: 'Gumloop Security & Trust',
            asOf: '2026-09-15',
          },
        ],
      },
      templates: {
        value:
          "Yes: a public template gallery ('flows') plus an organization-templates feature for Team/Enterprise plans to share internal templates",
        detail:
          'Gumloop lists a community/creator template marketplace at gumloop.com/templates covering sales, marketing, HR, finance, data extraction, etc.',
        shortValue: 'Public gallery plus internal org template sharing',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.gumloop.com/templates',
            label: 'Gumloop Community Templates',
            asOf: '2026-09-15',
          },
        ],
      },
      license: {
        value: 'Proprietary',
        detail:
          "The core Gumloop application has no open-source license; it is a closed, hosted commercial SaaS product. Gumloop's own guMCP_template repo is an open-source MCP-server starter, but it is not the Gumloop platform.",
        shortValue: 'Proprietary',
        confidence: 'estimated',
        sources: [
          { url: 'https://www.gumloop.com/pricing', label: 'Gumloop Pricing', asOf: '2026-09-15' },
        ],
      },
      environmentPromotion: {
        value:
          "No dedicated dev/staging/production promotion pipeline. Work is organized as Organization > Personal Space (private) plus Teams (shared, Pro plan and up), with a 'Move to Team' action to share a flow, not cross-workspace cloning.",
        detail:
          "Gumloop organizes work as Organization > Personal Space (private) or Team (a shared collaborative space, Pro plan and above), with no structured pipeline for promoting changes between dev, staging, and production. Moving a flow out of a personal space happens via a manual 'Move to Team' action. Version history is handled separately through single-workflow checkpoints (see versionControlDepth).",
        shortValue: 'No dev/staging/prod promotion pipeline',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/projects',
            label: 'Gumloop Docs: Organizations and Workspaces',
            asOf: '2026-09-15',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/checkpoint_history',
            label: 'Gumloop Docs: Workflow Checkpoints',
            asOf: '2026-07-02',
          },
        ],
      },
      versionControlDepth: {
        value:
          "Not verifiable in Gumloop's current documentation: the dedicated Workflow Checkpoints page (docs.gumloop.com/core-concepts/checkpoint_history), which previously described a linear checkpoint-snapshot system with 'Make This Checkpoint Live' and 'Rollback to This Checkpoint' actions and no diff/branching, now redirects to a generic Agents overview page with no version-history content of any kind; no equivalent checkpoint/versioning page was located elsewhere in the current docs IA within this review. (Separately, docs.gumloop.com's current Agents page does note that an agent's self-edited system prompt has 'no version history, so revert by editing the prompt manually,' which is a different, narrower mechanism.)",
        detail:
          "This fact previously described a 'checkpoints' model (manual snapshots with 'Make This Checkpoint Live' and 'Rollback to This Checkpoint' actions, comparable to Google Docs version history rather than git-style branching), sourced solely from docs.gumloop.com/core-concepts/checkpoint_history. That URL now redirects to a generic Agents overview page containing no checkpoint, rollback, undo/redo, or diff content, and no replacement checkpoint/versioning documentation page was found elsewhere on docs.gumloop.com during this review. The only adjacent mechanism now documented is narrower: an agent's self-edited system prompt has 'no version history, so revert by editing the prompt manually' (docs.gumloop.com/core-concepts/agents), which covers prompt edits only, not general workflow/agent version history.",
        shortValue: 'Not verifiable: checkpoint docs page now dead',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/checkpoint_history',
            label: 'Gumloop Docs: Workflow Checkpoints',
            asOf: '2026-07-02',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          'No: Gumloop calls itself a "multiplayer AI agent builder" and lets Teams share ownership so multiple editors can work on the same flow or agent, but no public documentation confirms live, concurrent multi-user editing with synced cursors, selections, or operations on the same open canvas at the same moment.',
        detail:
          '"Multiplayer" refers to shared workspace/team access, not a documented live-cursor/synced-operation editing experience.',
        shortValue: 'No: shared team access, not confirmed live co-editing',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/teams',
            label: 'Organization and Teams - Gumloop docs',
            asOf: '2026-09-15',
          },
          {
            url: 'https://www.gumloop.com/',
            label: 'Gumloop homepage',
            asOf: '2026-09-15',
          },
        ],
      },
      nativeFileStorage: {
        value:
          'Yes: Gumloop has a native files area (personal/team Files) where generated artifacts get a dedicated URL. Share access can be set to restricted, organization-wide, or public-link, and enterprise admins can block external sharing. Folder creation is also supported for connected Drive storage.',
        detail:
          'Public documentation does not confirm password/SSO-gated share links or a deleted-item recovery (trash/undelete) feature for this native file store.',
        shortValue: 'Yes: native file storage with link-sharing controls',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.gumloop.com/blog/artifacts',
            label: 'Make shareable files with agents - Gumloop blog',
            asOf: '2026-09-15',
          },
          {
            url: 'https://www.gumloop.com/personal/files',
            label: 'Files - Gumloop',
            asOf: '2026-07-02',
          },
        ],
      },
      dataTables: {
        value:
          'No: Gumloop has no native, first-class spreadsheet-like data-grid primitive with its own typed columns, row/column limits, and keyboard navigation (arrow keys, Tab, copy-paste, undo) wired directly into agent runs. Tabular work instead runs through external connector nodes (Google Sheets, Airtable, Postgres, Supabase) and a "List of Lists" data type for passing table-shaped data between nodes, not an in-app database/table object a workflow can read from and write to as storage.',
        detail:
          'Gumloop added "table support ... for better data visualization," per its changelog, which is a display/rendering feature for showing tabular data in the UI, not a persistent, spreadsheet-navigable data table entity a workflow can use as its own storage layer. This is a real capability gap versus a native, spreadsheet-like data-grid feature built into the product.',
        shortValue: 'No: no native data-grid; only external Sheets/Airtable connectors',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/types',
            label: 'Types - Gumloop docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.gumloop.com/changelog',
            label: 'Gumloop changelog',
            asOf: '2026-09-15',
          },
        ],
      },
      richTextEditor: {
        value:
          'Unknown: no public documentation describes an inline rich-text/WYSIWYG markdown editor for documents stored in Gumloop; searches surfaced only generic markdown-editor products unrelated to Gumloop.',
        detail:
          "Gumloop's platform is workflow/agent-centric with file and artifact nodes; docs, changelog, and blog surface no dedicated document WYSIWYG editor.",
        shortValue: 'Unknown: no evidence found either way',
        confidence: 'unknown',
        sources: [],
      },
      subWorkflows: {
        value:
          "Yes: a dedicated 'Subflow' feature lets any saved workflow be dropped in as a reusable node inside another workflow, with Input/Output nodes to pass parameters in and return values out",
        detail:
          "Gumloop docs describe Subflows as workflows that 'show up in your node library just like native nodes' once built, so they can be dragged onto the canvas of any other flow, wired to Input nodes for parameters and Output nodes for return values. When a list is connected to a Subflow node it runs once per list item (Loop Mode) rather than a single time. Public docs do not explicitly state whether the parent execution blocks until the subflow completes, but since a Subflow is embedded as a node in the parent's directed graph, not invoked over a separate async webhook call, later nodes depending on its outputs wait for it to resolve.",
        shortValue: 'Yes: Subflow node calls a saved workflow as a step',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/subflows',
            label: 'Subflows - Gumloop docs',
            asOf: '2026-07-08',
          },
        ],
      },
      customBlocks: {
        value:
          'No: Gumloop has no feature that publishes an existing deployed workflow as an encapsulated, named block for the whole org to reuse. Subflows let a saved workflow be dropped into other flows as a node, but public docs describe this only as personal/same-project reuse, with no mention of hiding the subflow\'s internal steps or credentials, or of org-wide toolbar placement for other users. The one org-wide, block-like publishing surface Gumloop does have, the Custom Node Builder plus its "Node and Flow Library" Hub, is scoped to single AI-generated code nodes (wrapping an API or script), not a way to turn a multi-step visual workflow into a reusable block.',
        detail:
          "Gumloop's docs on Subflows describe only how to nest a saved workflow as a node with Input/Output nodes for parameters, with no documented mechanism for sharing that subflow node to other users, hiding its internal graph from them, or auto-propagating updates when the source workflow changes. Separately, docs.gumloop.com/core-concepts/node_and_flow_library confirms users can share a Custom Node organization-wide ('Share with Organization: Makes the node discoverable by all organization members'), appearing immediately in teammates' node libraries, but the page's substantive sections (Custom Nodes Tab, Sharing Custom Nodes, Publishing Custom Nodes) only ever cover single code-based nodes generated by the Custom Node Builder from a natural-language description, not multi-step canvas workflows. No Gumloop page describes converting an existing built flow into a shareable, encapsulated block the way a Custom Node is shared.",
        shortValue: "No: Subflows aren't org-shared; org-shared Custom Nodes are code, not flows",
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/subflows',
            label: 'Subflows - Gumloop docs',
            asOf: '2026-07-08',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/node_and_flow_library',
            label: 'Node and Workflow Library - Gumloop docs',
            asOf: '2026-07-08',
          },
          {
            url: 'https://www.gumloop.com/blog/gumloop-custom-nodes',
            label: 'Gumloop Blog: Gumloop Custom Nodes',
            asOf: '2026-09-15',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Multiple LLM providers without lock-in: Anthropic (Claude), OpenAI, Google (Gemini), and DeepSeek are named',
        shortValue: 'Claude, OpenAI, Gemini, DeepSeek',
        confidence: 'estimated',
        sources: [
          { url: 'https://www.gumloop.com', label: 'Gumloop homepage', asOf: '2026-09-15' },
        ],
      },
      agentReasoningBlocks: {
        value:
          "Yes: dedicated Agents (chat-based AI assistants with tools, distinct from plain workflow data-routing nodes) plus 'Subagents' for multi-agent orchestration — an agent can self-clone or invoke other agents via the invoke_agent tool to delegate parallel subtasks. The earlier 'Ask AI' node / canvas Agent Node terminology is no longer used on Gumloop's current Agents documentation page.",
        detail:
          "Docs.gumloop.com's current Agents page describes agents as chat-based AI assistants configured via Connectors, Skills, Knowledge Sources, and Triggers, distinct from the visual canvas's plain data-routing Flow nodes (see platform.builderType). Multi-agent orchestration now runs through 'Subagents': 'Subagents let your agent delegate to other agents... it can spin up focused helpers that work in parallel, then collect the results,' either by self-cloning (depth limit of 1) or by invoking a different, named agent via the invoke_agent tool ('The agent calls a different, specialized agent by name. Add agents to the Subagents list to allow this.'). No canvas-based 'Ask AI node' or 'Agent Node' terminology appears on the current page.",
        shortValue: 'Yes: Agents plus Subagents, no more Ask AI node',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/agents',
            label: 'Gumloop docs: Agents (Subagents, invoke_agent tool)',
            asOf: '2026-09-15',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          "Yes: an AI copilot named 'Gummie' builds/edits flows from natural-language descriptions",
        shortValue: 'Gummie copilot builds and edits flows from prompts',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.gumloop.com/blog/agentic-ai-tools',
            label: 'Gumloop blog: agentic AI tools',
            asOf: '2026-09-15',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          "Yes: Gumloop now documents a built-in knowledge-base feature called 'Knowledge Sources' / 'Company Brain.' Agents can be given searchable access to Google Drive, Notion, Slack, GitHub, Confluence, and uploaded files; the agent searches automatically (shown as 'Searching Company Brain' in chat), answers with citations from the real source documents, and can open a full document for more context. Chunk-level debugging detail is not confirmed (see kbChunkVisibility).",
        detail:
          "Docs.gumloop.com's current Agents page has a dedicated, official Knowledge Sources section: 'Give your agent a searchable memory of what your company knows. In the Knowledge Sources section, attach Brain sources (Google Drive, Notion, Slack, GitHub, Confluence, or uploaded files) so the agent answers from your real documents and messages, with citations, instead of guessing.' This supersedes the earlier finding that only a community forum thread (forum.gumloop.com) referenced building a custom knowledge base out of nodes — Company Brain is now Gumloop's own documented, built-in feature, not a workaround.",
        shortValue: 'Yes: built-in Company Brain / Knowledge Sources',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/agents',
            label: 'Agents - Gumloop docs (Knowledge Sources / Company Brain)',
            asOf: '2026-09-15',
          },
        ],
      },
      mcpSupport: {
        value:
          "Yes: native MCP client/server support. Vendor figures differ by page: 250+ pre-built hosted MCP servers per gumloop.com/mcp, but 50+ pre-built MCP servers per docs.gumloop.com's Custom MCP Servers page — plus custom MCP server connections, supporting both 'native MCP' (model connects directly, e.g. OpenAI/Anthropic) and a 'backend connector' mode (Gumloop executes tool calls, e.g. Gemini/Groq).",
        detail:
          "Gumloop can connect to any MCP server (custom URL over HTTPS). Its marketing MCP page (gumloop.com/mcp) advertises 'Connect any AI agent to 250+ MCP servers, zero setup,' while its docs' Custom MCP Servers page states 'Gumloop already has 50+ pre-built MCP servers for popular services' and directs users to 'Browse available integrations before setting up a custom server' — a smaller, differently-sourced figure than the marketing page's. Native MCP support means the model connects directly to a server (e.g. OpenAI/Anthropic), while backend-connector mode has Gumloop execute the tool call on the model's behalf (e.g. Gemini/Groq).",
        shortValue: 'Native MCP; vendor figures vary (50+ to 250+)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.gumloop.com/mcp',
            label: 'Gumloop: Fully Hosted MCP Servers',
            asOf: '2026-09-15',
          },
          {
            url: 'https://docs.gumloop.com/nodes/mcp/custom_mcp_servers',
            label: 'Gumloop docs: Custom MCP Servers',
            asOf: '2026-09-15',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'Yes: agent chat evaluation alerts, test-case/grading tools to catch regressions, per-node test runs, and plain-English guardrail policies with human-in-the-loop approval',
        detail:
          'Product surfaces let teams define test cases and grade agent responses to catch regressions, test individual nodes with fake inputs from the canvas, set org/team/agent-level guardrail policies in plain English that can block/tag actions and log violations, and require human approval mid-task for sensitive actions.',
        shortValue: 'Test cases, grading, guardrail policies, HITL approval',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.gumloop.com/changelog',
            label: 'Gumloop Changelog',
            asOf: '2026-09-15',
          },
        ],
      },
      humanInTheLoop: {
        value: 'Yes: dedicated approval-card pause/resume, distinct from a delay step',
        detail:
          'Gumloop Agents support a Tool Management setting ("Ask for writes/deletes" or "Ask each time") that pauses the agent mid-task before it calls a sensitive tool. The approver is notified via an in-context "approval card" shown in the agent chat (available in agent chats and Slack). Once the human approves or rejects, the agent resumes exactly where it left off. Agents can also pause to ask a clarifying question with selectable options, not just approve or deny.',
        shortValue: 'Approval-card pause and resume on sensitive actions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/agents',
            label: 'Gumloop Docs: Agents',
            asOf: '2026-09-15',
          },
          {
            url: 'https://www.gumloop.com/changelog',
            label: 'Gumloop Changelog',
            asOf: '2026-09-15',
          },
        ],
      },
      generativeMedia: {
        value:
          'Image Generation is a built-in agent ability (not a canvas node) currently supporting 6 models: GPT-Image-2.5 Flare, GPT-Image-2.5 Sunburst, GPT-Image-2, Gemini 3.1 Flash, Gemini 3 Pro, and Gemini 2.5 Flash Image. DALL-E 2 and DALL-E 3 have been retired and are automatically remapped to GPT-Image-2.5 Flare. No dedicated video or audio (TTS/STT) generation ability is documented.',
        detail:
          "Gumloop's current Agents documentation (the former dedicated 'Generate Image node' page now redirects here) describes Image Generation as an ability agents use directly in chat, not a separate canvas node: 'The Image Generation ability creates images from text prompts.' Retired model IDs are explicitly remapped: dall-e-2, dall-e-3, gpt-image-1, and gpt-image-1.5 all now resolve to gpt-image-2.5-flare, and gemini-2.5-flash-image-preview resolves to gemini-2.5-flash-image, so older integrations referencing retired IDs keep working. Separately, an Enterprise-level AI Model Governance control (see security.modelAndToolGovernance) lets org admins allow or deny specific AI models platform-wide and set automatic fallback models, including a dedicated image-generation fallback; this is a general model-governance setting, not specific to image generation.",
        shortValue: 'Image ability, 6 models; DALL-E retired',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/agents',
            label: 'Agents - Gumloop docs (Image Generation ability)',
            asOf: '2026-09-15',
          },
          {
            url: 'https://www.gumloop.com/changelog',
            label: 'Gumloop Changelog',
            asOf: '2026-09-15',
          },
          {
            url: 'https://docs.gumloop.com/enterprise-features/ai_model_control',
            label: 'Gumloop Docs: AI Model Governance & Configuration',
            asOf: '2026-09-15',
          },
        ],
      },
      dynamicToolUse: {
        value: 'Unknown',
        detail: "Not documented in Gumloop's public materials.",
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      modelFallback: {
        value: 'Unknown',
        detail:
          'Not documented outside the model allow/deny and fallback controls described for image generation (see generativeMedia).',
        shortValue: 'Not documented outside image generation',
        confidence: 'unknown',
        sources: [],
      },
      agentSkills: {
        value:
          'Yes: Gumloop has a dedicated "Skills" system where a skill is a reusable folder of instructions, templates, and scripts that teaches an agent how to do a specific task. The general agent discovers skills dynamically via semantic search, and custom agents can have specific skills explicitly attached.',
        detail:
          'Described in Gumloop\'s own docs as "a living knowledge base" distinct from a one-off system prompt; agents can even edit/create skills themselves if that toggle is enabled.',
        shortValue: 'Yes: reusable named "Skills" library for agents',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/skills',
            label: 'Agent Skills - Gumloop docs',
            asOf: '2026-09-15',
          },
          {
            url: 'https://www.gumloop.com/blog/announcing-skills-for-agents',
            label: 'Announcing Skills for Agents',
            asOf: '2026-09-15',
          },
        ],
      },
      nativeChatDeployment: {
        value:
          'Yes: Gumloop agents can be deployed via a public or private hosted chat page, in addition to Slack, Microsoft Teams, and an inbox channel. A conversational chat surface is a native, publicly deployable target, not just a form, API, or webhook.',
        shortValue: 'Yes: hosted public/private chat page for agents',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/agents',
            label: 'Agents - Gumloop docs',
            asOf: '2026-09-15',
          },
          {
            url: 'https://www.gumloop.com/blog/announcing-gumloop-agents',
            label: 'Announcing Gumloop Agents',
            asOf: '2026-09-15',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          'No: Gumloop does not have public documentation of a knowledge-base search feature that exposes chunk-level detail (chunk index/content) in a debugging view. Its closest analog, "Skills," is a semantic-search instruction library the agent pulls into context, not a document-chunk retrieval or debug interface.',
        detail:
          'No dedicated "Knowledge Base" / vector-search product page was found on docs.gumloop.com distinct from Skills or file/Drive nodes.',
        shortValue: 'No: no documented chunk-level KB debugging view',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/skills',
            label: 'Agent Skills - Gumloop docs',
            asOf: '2026-09-15',
          },
        ],
      },
      parallelExecution: {
        value:
          "Yes: beyond concurrent list-item processing, Gumloop now documents 'Subagents' — an agent can self-clone (same tools/instructions, depth limit of 1) to spawn several parallel workers on different subtasks, each running as its own conversation with its own sandbox, with the parent agent collecting and continuing from every subagent's results once finished. This is a genuine fan-out/fan-in construct, distinct from the older Loop Mode concurrent list processing.",
        detail:
          "Docs.gumloop.com's current Agents page documents Subagents: 'Subagents let your agent delegate to other agents. Instead of doing everything in one conversation, it can spin up focused helpers that work in parallel, then collect the results.' Two delegation modes exist: self-cloning (the agent replicates itself for parallel subtasks, marked '(Me)', capped at a depth limit of 1) and invoking a different, named specialized agent. Each subagent runs as its own conversation with its own context and sandbox; the parent reads each subagent's results when it finishes. This supersedes the earlier finding (sourced from the now-dead Loop Mode page) that Gumloop had no dedicated branch-level fan-out/fan-in construct — Loop Mode's concurrent list-item processing (up to 15 items at once on Pro) remains a separate, narrower mechanism for data-parallelism over a list.",
        shortValue: 'Yes: Subagents give true fan-out/fan-in',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/agents',
            label: 'Agents - Gumloop docs (Subagents)',
            asOf: '2026-09-15',
          },
        ],
      },
      a2aProtocol: {
        value:
          'No: no public documentation of Agent2Agent (A2A) protocol support was found on Gumloop docs, blog, or changelog',
        detail:
          'Gumloop documents MCP client/server support (hosted MCP servers, MCP nodes) but has no mention of the A2A open standard, Agent Cards, or peer-to-peer agent discovery/invocation.',
        shortValue: 'No: not documented',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.gumloop.com/changelog',
            label: 'Gumloop Changelog',
            asOf: '2026-09-15',
          },
          {
            url: 'https://www.gumloop.com/blog/introducing-mcp-workflows',
            label: 'Introducing MCP Nodes & Workflows in Gumloop',
            asOf: '2026-09-15',
          },
        ],
      },
      loopIteration: {
        value:
          "Partial: Gumloop's only documented iteration primitive is 'Loop Mode', the same mechanism covered under parallelExecution, which a user manually enables on a node so it runs once per item in a connected list. Per Gumloop's docs this is concurrent (2 items at once on Free, 15 on Pro), not a strictly one-at-a-time sequential container, and no separate while-loop or fixed-iteration-count node is documented, only manually-enabled iteration over an existing list.",
        detail:
          "Gumloop docs describe Loop Mode as a mode a user enables on a node ('When you enable Loop Mode on a node...'), which then processes multiple list items simultaneously with concurrency capped by plan tier, distinct from a classic for-each node that guarantees one iteration finishes before the next starts. No dedicated while-loop (condition-based) or fixed-count repeat node is documented; all iteration requires manually enabling Loop Mode with a list as input.",
        shortValue: 'Partial: manually-enabled Loop Mode is concurrent, not a sequential loop node',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/loop_mode',
            label: 'Loop Mode - Gumloop docs',
            asOf: '2026-07-08',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value:
          "Vendor-claimed figures still vary and the specific numbers have changed: gumloop.com/mcp advertises '250+ MCP servers, zero setup,' docs.gumloop.com's Custom MCP Servers page separately states 'Gumloop already has 50+ pre-built MCP servers,' and the current Agents documentation describes Connectors (the integrations an agent can access) as '150+' (e.g. Gmail, Salesforce, Slack, Notion, and 150+ more). The docs introduction page that previously cited '100+ pre-built nodes and integrations' has been fully rewritten and no longer states any figure.",
        detail:
          "No single authoritative exact count is published on a primary Gumloop page, and the figures have shifted since this file was first researched: docs.gumloop.com/getting-started/introduction no longer contains the '100+ pre-built nodes and integrations' language at all — it has been fully rewritten around an agent-first structure with no integration count stated. Meanwhile gumloop.com/mcp still advertises '250+ MCP servers, zero setup,' docs.gumloop.com's Custom MCP Servers page states 'Gumloop already has 50+ pre-built MCP servers for popular services,' and the current Agents page's Connectors section states 'Connectors are the integrations your agent connects to, such as Gmail, Salesforce, Slack, Notion, and 150+ more' — a third, distinct figure. None of these pages cross-reference each other, and the dedicated /integrations directory page still returns a 404.",
        shortValue: 'Vendor figures vary: 50+, 150+, 250+ across pages',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/getting-started/introduction',
            label: 'Getting Started - Gumloop docs',
            asOf: '2026-09-15',
          },
          {
            url: 'https://www.gumloop.com/mcp',
            label: 'Gumloop: Fully Hosted MCP Servers',
            asOf: '2026-09-15',
          },
          {
            url: 'https://docs.gumloop.com/nodes/mcp/custom_mcp_servers',
            label: 'Gumloop docs: Custom MCP Servers',
            asOf: '2026-09-15',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/agents',
            label: 'Agents - Gumloop docs (Connectors)',
            asOf: '2026-09-15',
          },
        ],
      },
      triggerTypes: {
        value:
          'Schedule (daily/weekly/custom), webhook, and API-triggered runs are documented; chat-based triggering (e.g. via Slack) is also supported',
        shortValue: 'Schedule, webhook, API, and chat triggers',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/workflow_triggers',
            label: 'Gumloop docs: Workflow Triggers',
            asOf: '2026-09-15',
          },
        ],
      },
      customCodeSteps: {
        value:
          "Yes: a 'run code' / custom code node lets advanced users drop in Python when visual nodes aren't sufficient",
        shortValue: 'Python code node for custom logic',
        confidence: 'estimated',
        sources: [{ url: 'https://docs.gumloop.com/', label: 'Gumloop docs', asOf: '2026-07-02' }],
      },
      codeSandboxRuntime: {
        value:
          'Yes, with limits: every agent now has an always-on Code Sandbox (an isolated cloud VM) that ships with 80+ preinstalled Python packages, and the agent can install additional packages at runtime via pip install or npm install and run arbitrary shell commands; installed packages persist and are shared across every conversation on that agent. Execution limits are documented: 30-minute command timeout, up to 300MB file ingestion, full internet access, and headless-only (no GUI) execution — it is not intended for training large ML models or running persistent servers.',
        detail:
          "Gumloop's 'Code Sandbox & Secrets' documentation (docs.gumloop.com/core-concepts/agent_sandbox_and_secrets) describes the sandbox as 'natively enabled on all agents with no configuration required,' with each conversation running in its own isolated cloud VM. It ships with 80+ preinstalled Python packages, and agents can run `pip install package-name` or `npm install` plus arbitrary shell commands ('Execute Shell Commands: File operations, package installation, running scripts, and system commands'); installed packages form a 'shared package environment' that persists across every conversation on that agent, so a package installed once is available to everyone with access. Documented limits: a 30-minute command timeout, up to 300MB per ingested file, full internet access (API calls, pip installs, web requests), and headless-only execution ('Visualizations must be saved to files'). The docs explicitly scope it away from heavy workloads: 'not intended for training large ML models or running persistent servers.' This supersedes the earlier fixed-runtime, vendor-curated-import-list characterization documented at the now-dead Run Code / Custom Node Builder pages.",
        shortValue: 'Yes: sandbox VM, pip/npm installs, shell access',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/agent_sandbox_and_secrets',
            label: 'Code Sandbox & Secrets - Gumloop docs',
            asOf: '2026-09-15',
          },
        ],
      },
      apiPublishing: {
        value:
          'Yes: flows can be triggered via REST API and a JavaScript SDK; agents embedded in a flow can be called via the same API',
        detail:
          'Execution is asynchronous: start a flow run via API/SDK, then poll a run-by-ID endpoint for status and structured outputs.',
        shortValue: 'REST API and JS SDK, async run-and-poll',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/api-reference/sdk/javascript',
            label: 'Gumloop docs: JavaScript SDK',
            asOf: '2026-09-15',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Official JS/TypeScript and Python SDKs, plus an in-product AI-assisted Custom Node Builder; no public third-party marketplace yet',
        detail:
          'Gumloop publishes official client SDKs for JavaScript/TypeScript (`npm install gumloop`, GumloopClient, github.com/gumloop/gumloop-js) and Python (github.com/gumloop/gumloop-py) for starting automations and retrieving outputs programmatically. Separately, the in-app "Custom Node Builder" lets users describe desired functionality in natural language and have AI generate a deployable custom node that integrates with any API, shareable with teammates (editor access) within a workspace. A public node-selling marketplace and "official Gumloop integrations built as custom nodes" are a stated future direction, not a shipped marketplace today.',
        shortValue: 'JS/Python SDKs plus AI custom node builder',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/api-reference/sdk/javascript',
            label: 'Gumloop Docs: JavaScript SDK',
            asOf: '2026-09-15',
          },
          {
            url: 'https://github.com/gumloop/gumloop-js',
            label: 'GitHub: Gumloop/gumloop-js',
            asOf: '2026-09-15',
          },
          {
            url: 'https://docs.gumloop.com/nodes/custom_node_details',
            label: 'Gumloop Docs: Custom Node Builder',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.gumloop.com/blog/gumloop-custom-nodes',
            label: 'Gumloop Blog: Gumloop Custom Nodes',
            asOf: '2026-09-15',
          },
        ],
      },
      mcpPublishing: {
        value:
          "No: Gumloop's own official, first-party MCP server (https://mcp.gumloop.com/gumloop/mcp) now exposes parts of the Gumloop management API (e.g., audit logs) for AI clients like Claude or Cursor to query — this supersedes the earlier characterization of MCP-wrapping-the-management-API as solely a third-party, unofficial project. However, this still does not amount to publishing an individual user's deployed workflow or agent as its own callable MCP server for external tools to consume; no such per-workflow MCP-publishing mechanism is documented.",
        detail:
          "Gumloop's own audit-logging documentation confirms a first-party 'Gumloop MCP' server at mcp.gumloop.com/gumloop/mcp that exposes management-API data (e.g. audit logs via a get_audit_logs tool) to MCP clients like Claude or Cursor, replacing the earlier finding that only an unofficial third-party GitHub project ('gumloop-mcp') wrapped the management API this way. This remains distinct from publishing a specific deployed workflow or agent as its own callable MCP tool: Gumloop's MCP server exposes Gumloop's own platform data/actions, not a customer's individual workflow logic, and no documentation describes the latter.",
        shortValue: 'No: official MCP server exists, still not per-workflow',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.gumloop.com/mcp',
            label: 'Fully Hosted MCP Servers for Your AI Agents - Gumloop',
            asOf: '2026-09-15',
          },
          {
            url: 'https://docs.gumloop.com/nodes/mcp/custom_mcp_servers',
            label: 'Custom MCP Servers - Gumloop docs',
            asOf: '2026-09-15',
          },
          {
            url: 'https://www.gumloop.com/blog/introducing-mcp-workflows',
            label: 'Introducing MCP Nodes & Workflows in Gumloop',
            asOf: '2026-09-15',
          },
          {
            url: 'https://docs.gumloop.com/enterprise-features/audit_logging',
            label: 'Gumloop docs: Audit Logging (Gumloop MCP server)',
            asOf: '2026-09-15',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Usage-based monthly credit system (credits consumed per task/run), with tiered monthly credit allotments (20k+ on Pro, custom on Enterprise), plus seat-based distinctions between the current Pro and Enterprise tiers (the previously-offered standalone Free plan is no longer shown on the pricing page as of September 2026)',
        shortValue: 'Credit-based usage; Pro/Enterprise tiers only',
        confidence: 'verified',
        sources: [
          { url: 'https://www.gumloop.com/pricing', label: 'Gumloop Pricing', asOf: '2026-09-15' },
        ],
      },
      entryPaidPlan: {
        value:
          'Pro plan at $37/month for 20k+ credits. Includes unlimited seats/teams, 5 concurrent runs, 25 concurrent agent interactions, agent reflections, unified billing, and 1 hosted MCP server instance',
        detail:
          "Gumloop's pricing page lists 'MCP Server Hosting (1)' under the Pro plan without clarifying its scope: it is not stated whether this cap limits access to the 100+ pre-built, zero-setup MCP servers described on gumloop.com/mcp, or only applies to a separate custom MCP server that Gumloop hosts on a customer's behalf. That distinction is not resolved anywhere on Gumloop's own pricing or MCP pages.",
        shortValue: '$37/month Pro plan, 20k+ credits',
        confidence: 'verified',
        sources: [
          { url: 'https://www.gumloop.com/pricing', label: 'Gumloop Pricing', asOf: '2026-09-15' },
        ],
      },
      freeTier: {
        value:
          "No permanent free plan: Gumloop's current pricing page (gumloop.com/pricing) offers only a 14-day free trial of the Pro plan ($37/month, 20k+ credits) and a custom Enterprise plan; the previously-documented standalone Free tier (5,000 credits/month, 1 seat, forum-only support) is no longer listed. (A blog post dated June 8, 2026 still described a Free plan, so this change appears recent.)",
        shortValue: 'No free tier: 14-day Pro trial only',
        confidence: 'verified',
        sources: [
          { url: 'https://www.gumloop.com/pricing', label: 'Gumloop Pricing', asOf: '2026-09-15' },
          {
            url: 'https://www.gumloop.com/blog/agentic-ai-tools',
            label: 'Gumloop blog: agentic AI tools (June 8, 2026, describes a Free plan)',
            asOf: '2026-09-15',
          },
        ],
      },
      byok: {
        value: 'Yes: Bring Your Own API Keys is supported across all plans',
        shortValue: 'Supported on all plans',
        confidence: 'verified',
        sources: [
          { url: 'https://www.gumloop.com/pricing', label: 'Gumloop Pricing', asOf: '2026-09-15' },
          {
            url: 'https://www.gumloop.com/solutions/security',
            label: 'Gumloop Security & Trust',
            asOf: '2026-09-15',
          },
        ],
      },
    },
    security: {
      compliance: {
        value:
          'SOC 2 Type II attested; HIPAA-compliant with Business Associate Agreements (BAAs) available on eligible plans; GDPR-aligned privacy program plus EU-U.S. Data Privacy Framework certification including the UK Extension; no ISO 27001, PCI DSS, or FedRAMP',
        detail:
          'Gumloop is SOC 2 Type II attested, is HIPAA compliant with Business Associate Agreements (BAAs) available on eligible plans, maintains a GDPR-aligned privacy program, and is certified under the EU-U.S. Data Privacy Framework including the UK Extension. It also has zero-data-retention (ZDR) agreements with major LLM providers, BYOK support, encryption in transit and at rest, and DPAs for Enterprise customers, but no ISO 27001, PCI DSS, or FedRAMP.',
        shortValue: 'SOC 2 Type II, HIPAA, GDPR; no ISO/PCI/FedRAMP',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.gumloop.com/solutions/security',
            label: 'Gumloop Security & Trust',
            asOf: '2026-09-15',
          },
          { url: 'https://trust.gumloop.com/', label: 'Gumloop Trust Center', asOf: '2026-09-15' },
        ],
      },
      dataResidency: {
        value:
          'Enterprise VPC deployment into a customer-controlled cloud region provides data residency/control; zero data retention (ZDR) agreements are in place with major LLM providers',
        shortValue: 'VPC deployment plus zero data retention',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.gumloop.com/solutions/security',
            label: 'Gumloop Security & Trust',
            asOf: '2026-09-15',
          },
        ],
      },
      rbac: {
        value:
          'Yes: role- and attribute-based access control (RBAC/ABAC) for agents/tools with per-tool authorization policies, plus SSO/SCIM on enterprise plans',
        shortValue: 'RBAC/ABAC plus SSO/SCIM on Enterprise',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.gumloop.com/solutions/security',
            label: 'Gumloop Security & Trust',
            asOf: '2026-09-15',
          },
          {
            url: 'https://www.gumloop.com/pricing',
            label: 'Gumloop Pricing (Enterprise features list)',
            asOf: '2026-09-15',
          },
        ],
      },
      auditLogging: {
        value: 'Yes: audit logs available, documented as an enterprise feature',
        shortValue: 'Enterprise-tier audit logs',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/enterprise-features/audit_logging',
            label: 'Gumloop docs: Audit Logging',
            asOf: '2026-09-15',
          },
          {
            url: 'https://www.gumloop.com/pricing',
            label: 'Gumloop Pricing (Enterprise features list)',
            asOf: '2026-09-15',
          },
        ],
      },
      modelAndToolGovernance: {
        value:
          "Yes for models: an org-wide AI Model Governance setting lets admins restrict members to an allow-list ('Allow Only Selected') or block-list ('Block Selected') of models, set automatic fallback models (including a separate fallback for image generation), and set the model behind each of the two agent presets — Recommended and Smartest — so all agents use consistent model choices (there is no third 'Fastest' preset). Tool governance is handled separately via the per-tool authorization policies covered under RBAC/ABAC, not a distinct model-and-tool control surface.",
        detail:
          "Gumloop's docs (now titled 'AI Model Governance & Configuration') describe this as an Enterprise admin feature applying platform-wide to every member ('Allow Only Selected' or 'Block Selected' modes), not scoped per-team or per-agent. Its Restrictions tab controls model availability and its Fallbacks tab sets a general Fallback Model and a separate Image Generation Fallback Model; the two agent presets it can pin a model to are Recommended ('best balance of speed, quality, and cost') and Smartest ('maximum intelligence for complex tasks') — there is no 'Fastest' preset. It makes no mention of restricting access to non-model tools, which is instead covered by the RBAC/ABAC per-tool authorization policies documented separately.",
        shortValue: 'Org-wide model allow/deny; two presets, no Fastest',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/enterprise-features/ai_model_control',
            label: 'Gumloop Docs: AI Model Governance & Configuration',
            asOf: '2026-09-15',
          },
          {
            url: 'https://www.gumloop.com/solutions/security',
            label: 'Gumloop Security & Trust',
            asOf: '2026-09-15',
          },
        ],
      },
      credentialGovernance: {
        value:
          'No: Gumloop\'s Custom User Roles restrict access at the level of apps, tools, OAuth scopes, workflow nodes, and features (e.g. team creation, public sharing), plus usage caps, but not which specific stored credential or connection a role may use. The one related feature, "Agent-Owned Credentials," pins a single connection for everyone using an agent, which operates at the agent level, not the role or permission-group level.',
        detail:
          'Multi-role composition uses a union (least-restrictive) model for app access, the opposite of fine-grained per-credential allow/deny.',
        shortValue: 'No: roles restrict apps/tools, not specific credentials',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/enterprise-features/user_groups',
            label: 'Custom User Roles - Gumloop docs',
            asOf: '2026-09-15',
          },
          {
            url: 'https://www.gumloop.com/blog/gumloop-for-enterprise',
            label: 'Gumloop for Enterprise',
            asOf: '2026-09-15',
          },
        ],
      },
      whiteLabeling: {
        value:
          "No: Gumloop offers only partial branding controls. A custom Slack app lets an agent appear under the customer's own bot name/avatar, and a dedicated org-specific login page is available at gumloop.com/{your-org}, but the platform's logo, product name, and theme colors are not fully replaceable across the workspace/builder and deployed-app UI.",
        detail: 'The core canvas/builder UI itself has no comprehensive white-labeling.',
        shortValue: 'No: partial branding only (Slack bot, login page)',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/custom_slack_app',
            label: 'Custom Slack App Integration - Gumloop docs',
            asOf: '2026-09-15',
          },
          {
            url: 'https://docs.gumloop.com/enterprise-features/sso_saml_scim',
            label: 'SSO, SAML & SCIM - Gumloop docs (mentions dedicated login page)',
            asOf: '2026-09-15',
          },
        ],
      },
      dataRetention: {
        value:
          'Yes: Gumloop\'s Enterprise plan includes custom data retention rules and an "Incognito Mode" for ephemeral runs with no history retention for legal/compliance-sensitive flows, alongside audit logs retained per custom policy.',
        detail:
          'Exact configurable windows (e.g. specific day counts) are not published publicly; the capability itself is confirmed as an Enterprise-tier feature.',
        shortValue: 'Yes: custom retention rules plus incognito ephemeral runs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.gumloop.com/solutions/security',
            label: 'Security and trust at Gumloop',
            asOf: '2026-09-15',
          },
          {
            url: 'https://www.gumloop.com/blog/gumloop-for-enterprise',
            label: 'Gumloop for Enterprise',
            asOf: '2026-09-15',
          },
        ],
      },
      piiRedaction: {
        value:
          'No: no Gumloop documentation, blog post, or security page describes a feature that detects and redacts or blocks PII (emails, SSNs, etc.) in workflow content or retained logs.',
        detail:
          "Gumloop's security page covers encryption, RBAC/ABAC, and audit traceability, but not PII detection or redaction.",
        shortValue: 'No: no documented PII redaction feature',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.gumloop.com/solutions/security',
            label: 'Security and trust at Gumloop',
            asOf: '2026-09-15',
          },
        ],
      },
      sso: {
        value:
          'Yes: Gumloop supports enterprise SSO via SAML 2.0 (Okta, Entra ID, Google Workspace, JumpCloud, Ping Identity, Active Directory) plus Google/Microsoft OAuth.',
        detail:
          'Requires Admin role and an Enterprise subscription; enforces SP-initiated login only.',
        shortValue: 'Yes: SAML 2.0 SSO plus Google/Microsoft OAuth',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/enterprise-features/sso_saml_scim',
            label: 'SSO, SAML & SCIM - Gumloop docs',
            asOf: '2026-09-15',
          },
        ],
      },
      scim: {
        value:
          'Yes: SCIM 2.0 provisioning is available as an add-on, supported for Okta and Microsoft Entra ID only, and enabled on request by contacting Gumloop support. Users assigned the application in the IdP are automatically provisioned, kept updated, and automatically deprovisioned when removed, which frees up seats. IdP groups can be mapped to Gumloop Custom Roles and, separately, to teams (projects), using either curated mapping tables or name-based auto-resolution, with a user receiving the union of all matched mappings. Sync runs automatically every 15 minutes and admins can also trigger an on-demand sync. Documented limit: SCIM can only add users to teams inside the synced organization.',
        detail:
          'SCIM is an add-on rather than a standard plan feature: Gumloop directs customers to contact support@gumloop.com to request enablement, and reaching the SSO/SCIM settings requires the Admin organization role and an Enterprise subscription.',
        shortValue: 'Yes: add-on SCIM for Okta and Entra ID',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/enterprise-features/sso_saml_scim',
            label: 'SSO, SAML & SCIM - Gumloop docs',
            asOf: '2026-09-15',
          },
        ],
      },
      sessionPolicy: {
        value:
          'Not publicly documented: no admin-configurable session lifetime or idle timeout appears in Gumloop\'s public documentation. The only primary-source statement is a single bullet on the Enterprise SSO page listing "Session Management: Configurable session timeouts and secure token handling." No admin setting name, configuration steps, default session lifetime, idle-timeout value, or absolute-cap value is published anywhere in Gumloop\'s docs, security page, or trust center.',
        detail:
          "The bullet sits in a Security & Compliance list introduced as \"Gumloop's SSO implementation follows industry security standards\", alongside SOC 2 Type II certification, SAML 2.0 and TLS 1.3 entries that are compliance assurances rather than admin-configurable settings, so it does not establish a customer-facing control. The same page documents its actual admin controls in detail, including per-direction SCIM mapping-table toggles, name-based mapping mode, and named audit events, but describes no session setting; it gates SAML and SCIM settings to the Admin organization role and an Enterprise subscription, so any such control would be Enterprise-tier. Gumloop's public security page and trust center make no mention of session lifetime, idle timeout, or forced re-authentication. Because SAML SSO is available, organizations can also inherit re-authentication frequency from their upstream IdP, but that is the IdP's policy rather than a Gumloop-enforced one.",
        shortValue: 'Single SSO-page bullet cites configurable timeouts; no setting documented',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/enterprise-features/sso_saml_scim',
            label: 'SSO, SAML & SCIM - Gumloop docs',
            asOf: '2026-09-15',
          },
          {
            url: 'https://www.gumloop.com/solutions/security',
            label: 'Security and trust at Gumloop',
            asOf: '2026-09-15',
          },
        ],
      },
      thirdPartyVetting: {
        value:
          "Yes: Gumloop's 100+ built-in integrations are first-party nodes authored and maintained by Gumloop. Custom Nodes (user-written code steps) are built privately per account or team and shared only with named teammates or an org/link, not published to a public, searchable registry of third-party installable nodes. The separate Community Templates gallery is workflow templates built from Gumloop's own nodes, and submissions go through a Gumloop content-quality review before listing.",
        detail:
          "No public marketplace exists where an unaffiliated third-party developer publishes a Custom Node for arbitrary other users to discover and install, unlike an open community-node ecosystem. No documented security incidents involving Gumloop's Custom Nodes or Community Templates appear in public sources.",
        shortValue: 'Yes: first-party nodes, private custom nodes, reviewed templates',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/nodes/custom_node_details',
            label: 'Custom Node Builder - Gumloop docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.gumloop.com/blog/announcing-community-templates',
            label: 'Announcing Community Templates - Gumloop blog',
            asOf: '2026-09-15',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          "Not verifiable at the originally cited URL: Gumloop's dedicated 'Run Log' documentation page no longer exists (redirects to a generic Agents overview with no execution-trace content). The current Agents page instead documents per-agent 'Usage stats' (tasks, active days, actions, unique users over 31 days) and points to a separate org-wide 'Insights' page for credit spend and leaderboards; no equivalent per-node/per-step execution-trace debugging view was located within this review.",
        detail:
          "This fact previously described a customer-facing 'Run Log' execution trace (per-node status, inputs/outputs, timing, and credit cost per run), sourced solely from docs.gumloop.com/core-concepts/run_log. That URL now redirects to a generic Agents overview page with no execution-trace content. The current Agents page instead surfaces aggregate 'Usage stats' per agent (tasks, active days, tool calls, unique users over the last 31 days) and references a separate org-wide 'Insights' page for credit spend and leaderboards, but no per-node/per-step execution-trace debugging view comparable to the old Run Log was located during this review.",
        shortValue: 'Not verifiable: Run Log docs page now dead',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/run_log',
            label: 'Gumloop Docs: Run Log',
            asOf: '2026-07-02',
          },
        ],
      },
      durabilityModel: {
        value:
          "Not verifiable at the originally cited URLs: Gumloop's 'Run Log' documentation (which previously supported the 'no automatic retries/checkpointing/replay' finding) and its 'Error Shield' node documentation (which previously supported the 'manual error-handling only' finding) have both been removed; both URLs now redirect to a generic Agents overview page with no execution-durability, retry, checkpointing, replay, or Error Shield content. No equivalent durability/error-handling documentation was located elsewhere in the current docs IA within this review.",
        detail:
          'This fact previously relied on docs.gumloop.com/core-concepts/run_log (no mention of automatic retries, mid-run checkpointing, or replay) and docs.gumloop.com/nodes/flow_basics/error_shield (a manual node that wraps other nodes to catch errors, routing to a fallback Error Path). Both pages now redirect to the generic Agents overview with no equivalent content — no error-handling, retry, or run-durability documentation was found there or elsewhere in the current docs IA during this review.',
        shortValue: 'Not verifiable: Run Log and Error Shield docs dead',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/run_log',
            label: 'Gumloop Docs: Run Log',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.gumloop.com/nodes/flow_basics/error_shield',
            label: 'Gumloop Docs: Error Shield node',
            asOf: '2026-07-02',
          },
        ],
      },
      failureAlerting: {
        value:
          "Not verifiable at the originally cited URL: Gumloop's dedicated Alerts documentation page no longer exists (redirects to a generic Agents overview with no failure-notification content); no replacement alerting page was located elsewhere in the current docs IA within this review.",
        detail:
          'This fact previously described proactive email notifications configurable per-workflow for run failures (Pro plan and above), sourced solely from docs.gumloop.com/core-concepts/alerts. That URL now redirects to a generic Agents overview page with no failure-notification content, and no equivalent alerting/notification documentation page was located elsewhere in the current docs IA during this review.',
        shortValue: 'Not verifiable: Alerts docs page now dead',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/alerts',
            label: 'Gumloop Docs: Alerts',
            asOf: '2026-07-02',
          },
        ],
      },
      dataDrains: {
        value:
          'Yes: Gumloop\'s Enterprise "Data Drains" feature continuously pushes organization data (workflow runs, agents, agent interactions, credit logs, audit logs, and MCP tool calls) to an external destination: an HTTP/OTLP custom endpoint, Amazon S3, or Datadog. It polls every 15 seconds to 10 minutes and tracks sync state to avoid duplicates, in addition to one-time CSV exports.',
        detail: 'This is a distinct Enterprise capability separate from one-time snapshot exports.',
        shortValue: 'Yes: continuous Data Drains to S3/Datadog/webhook',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/enterprise-features/organization_data_export',
            label: 'Usage Data Export / Data Drains - Gumloop docs',
            asOf: '2026-09-15',
          },
        ],
      },
      asyncExecution: {
        value:
          "Yes: Gumloop's API executes asynchronously, but the documented primary pattern has changed to an agent-first one: a POST to start_agent (with user_id, agent_id, message) or a webhook call returns immediately (webhooks reply 200 with {'success': true} before the agent finishes), and the agent runs in the background, reporting results via a connected tool or the run's own history rather than a synchronous poll target. The previously-documented start_pipeline/get_pl_run workflow-run pattern is no longer shown on Gumloop's current API Getting Started page; it is not confirmed whether it still functions for legacy 'Workflows.'",
        detail:
          "Current documented pattern: POST https://api.gumloop.com/api/v1/start_agent?api_key=... with user_id, agent_id, and message starts an agent run in the background; the API's own framing is 'The Gumloop API is agent-first: you can create and update agents, start sessions to chat with them, and use chat completions from any OpenAI-compatible client.' Webhook-triggered runs (POST to /trigger_incoming_webhook/<trigger_id>/<secret>) similarly return immediately. Neither start_pipeline nor get_pl_run appears anywhere on the current API Getting Started page; whether that endpoint pair still functions for the legacy 'Workflows (Legacy)' pricing-page feature is not stated.",
        shortValue: 'Yes: async, now agent-first (start_agent/webhook)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/api-reference/getting-started',
            label: 'Gumloop API Reference: Getting Started',
            asOf: '2026-09-15',
          },
        ],
      },
      executionLimits: {
        value:
          'Gumloop publishes concurrency limits by plan on its pricing page: Free allows 2 concurrent runs and 5 concurrent agent interactions, Pro allows 5 concurrent runs and 25 concurrent agent interactions, and Enterprise has custom, unpublished limits. Gumloop does not publicly document a maximum execution duration or per-request timeout for a single workflow run.',
        detail:
          "Numbers taken directly from the pricing page comparison table. No max single-execution runtime or timeout figure is published in Gumloop's docs, forum, or pricing page.",
        shortValue: '2-5 concurrent runs by plan; no published timeout',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.gumloop.com/pricing',
            label: 'Gumloop Pricing (concurrent runs / agent interactions by plan)',
            asOf: '2026-09-15',
          },
        ],
      },
      partialFailureHandling: {
        value:
          'Yes: Gumloop offers an Error Shield node that wraps another node, catching its failure and routing execution down a separate Error Path while a Success Path carries forward normal results. This means a single failing step does not have to halt the whole run. In Loop Mode this happens automatically per iteration. For single-item flows outside Loop Mode, a Join Paths node is required to reconnect the error branch so the workflow keeps going instead of dead-ending.',
        detail:
          "Without Error Shield (or without Join Paths in non-loop cases), a node failure stops the whole workflow, per Gumloop's docs.",
        shortValue: 'Yes: Error Shield node routes failures to an error path',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/nodes/flow_basics/error_shield',
            label: 'Gumloop Docs: Error Shield node',
            asOf: '2026-07-02',
          },
        ],
      },
      unattendedExecution: {
        value:
          "Yes: scheduled, webhook, and API-triggered runs execute on Gumloop's own cloud infrastructure with no dependency on a client device staying open, awake, or connected",
        detail:
          "Gumloop's own asyncExecution pattern confirms this: a POST to the start_pipeline API returns a run_id immediately and the run continues on Gumloop's servers, polled later via get_pl_run. Schedule, webhook, and API triggers documented under integrations.triggerTypes are server-side entry points into the same hosted platform, not a desktop app or local agent; there is no published requirement for a browser tab, desktop client, or local session to stay active for a triggered run to fire or finish.",
        shortValue: 'Yes: runs execute on Gumloop servers, no client dependency',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/api-reference/getting-started',
            label: 'Gumloop API Reference: Getting Started',
            asOf: '2026-09-15',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/workflow_triggers',
            label: 'Gumloop docs: Workflow Triggers',
            asOf: '2026-09-15',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Forum support on Free plan, escalating to dedicated Slack support on higher/Enterprise plans',
        shortValue: 'Forum on Free, Slack on higher tiers',
        confidence: 'estimated',
        sources: [
          { url: 'https://www.gumloop.com/pricing', label: 'Gumloop Pricing', asOf: '2026-09-15' },
        ],
      },
      sla: {
        value: 'Unknown',
        detail: "Gumloop's pricing and trust pages publish no SLA or response-time commitment.",
        shortValue: 'Not published',
        confidence: 'unknown',
        sources: [],
      },
      community: {
        value: 'Unknown',
        detail:
          "No public Discord/Slack member count or GitHub star count exists for the core Gumloop product; Gumloop's public GitHub org hosts only SDK/client repos (gumloop-py, gumloop-js, guMCP_template), not the core product.",
        shortValue: 'Not publicly disclosed',
        confidence: 'unknown',
        sources: [],
      },
      companyMaturity: {
        value:
          "Founded in Vancouver in April 2023 (originally as 'AgentHub') by Max Brodeur-Urbas and Rahul Behal. Raised a $3.1M seed (July 2024) and a $17M Series A in January 2025 (led by Nexus Venture Partners), both independently corroborated; a $50M Series B in March 2026 (led by Benchmark) would bring the total to about $70M across 3 rounds; unlike the earlier characterization, TechCrunch has since independently covered the round ('Gumloop lands $50M from Benchmark to turn every employee into an AI agent builder,' March 12, 2026, per Gumloop's Y Combinator company page), so it is no longer solely self-reported. Y Combinator alum with a team size of 44 as of the current review (up from ~37 in mid-2026).",
        detail:
          "Gumloop started as a side project in a Vancouver bedroom in April 2023, founded by Max Brodeur-Urbas and Rahul Behal under the name AgentHub before rebranding to Gumloop. It raised a $3.1M seed round in July 2024 and a $17M Series A in January 2025 led by Nexus Venture Partners (with First Round Capital, Y Combinator, and angel investors), both independently corroborated by TechCrunch. The $50M Series B in March 2026 was led by Benchmark (with Nexus Venture Partners, First Round Capital, Y Combinator, Box Group, The Cannon Project, and Shopify Ventures); TechCrunch independently covered it directly ('Gumloop lands $50M from Benchmark to turn every employee into an AI agent builder,' techcrunch.com, March 12, 2026), corroborated by syndication on Yahoo Finance and coverage from Tech Funding News, so the earlier 'self-reported only' characterization no longer holds. Total raised is about $70M across 3 rounds. Gumloop's Y Combinator company page now lists a team size of 44, up from 37 as of mid-2026.",
        shortValue: 'Founded 2023, ~$70M raised; Series B now TechCrunch-covered',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.gumloop.com/blog/gumloops-17m-series-a',
            label: 'Gumloop Blog: Series A announcement',
            asOf: '2026-09-15',
          },
          {
            url: 'https://www.gumloop.com/blog/agenthub-to-gumloop',
            label: 'Gumloop Blog: Why we rebranded to Gumloop',
            asOf: '2026-09-15',
          },
          {
            url: 'https://techcrunch.com/2025/01/10/gumloop-founded-in-a-bedroom-in-vancouver-lets-users-automate-tasks-with-drag-and-drop-modules/',
            label: 'TechCrunch: Gumloop founding story & Series A',
            asOf: '2026-09-15',
          },
          {
            url: 'https://www.ycombinator.com/companies/gumloop',
            label: 'Y Combinator: Gumloop company page',
            asOf: '2026-09-15',
          },
          {
            url: 'https://www.gumloop.com/blog/series-b',
            label: 'Gumloop Blog: Series B announcement',
            asOf: '2026-09-15',
          },
          {
            url: 'https://techcrunch.com/2026/03/12/gumloop-lands-50m-from-benchmark-to-turn-every-employee-into-an-ai-agent-builder/',
            label: 'TechCrunch: Gumloop lands $50M Series B from Benchmark',
            asOf: '2026-09-15',
          },
        ],
      },
      academy: {
        value:
          'Yes: Gumloop runs "Gumloop University," a structured learning resource with self-paced courses (e.g. "Getting Started with Gumloop"), live webinars, and week-long "Learning Cohorts" that award a certificate of completion for finishing practical challenges.',
        detail:
          'Certification is tied to completing cohort challenges rather than a formal exam-based program, but it is a structured curriculum beyond ad hoc docs/blog posts.',
        shortValue: 'Yes: Gumloop University with courses and certificates',
        confidence: 'verified',
        sources: [
          {
            url: 'https://university.gumloop.com/',
            label: 'Gumloop University',
            asOf: '2026-09-15',
          },
          {
            url: 'https://www.gumloop.com/cohorts',
            label: 'Gumloop Learning Cohorts',
            asOf: '2026-09-15',
          },
        ],
      },
    },
  },
}
