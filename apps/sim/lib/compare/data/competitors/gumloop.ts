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
    'Gumloop is a hosted, no-code visual platform for building and deploying AI agents and automations: a drag-and-drop canvas, an AI copilot ("Gen") for natural-language flow creation, and native MCP (Model Context Protocol) integration support.',
  standoutFeatures: [
    {
      title: '250+ fully hosted MCP servers',
      description:
        'Gumloop offers 250+ pre-built, zero-setup hosted MCP servers spanning popular services, letting agents connect to external tools without manual configuration.',
      shortDescription: '250+ zero-setup hosted MCP servers across popular services.',
      source: {
        url: 'https://www.gumloop.com/mcp',
        label: 'Gumloop: Fully Hosted MCP Servers',
        asOf: '2026-07-08',
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
        asOf: '2026-07-08',
      },
    },
    {
      title: 'Plain-English, org-wide guardrail policy engine',
      description:
        'Organizations can define app/tool usage policies in plain English at org, team, or agent level; violating actions can be blocked or tagged and logged.',
      shortDescription: 'Plain-English usage policies enforced at org, team, or agent level.',
      source: {
        url: 'https://www.gumloop.com/solutions/security',
        label: 'Gumloop Security & Trust',
        asOf: '2026-07-02',
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
        asOf: '2026-07-02',
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
        asOf: '2026-07-02',
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
        asOf: '2026-07-02',
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
        asOf: '2026-07-08',
      },
    },
    {
      title: 'Inconsistent/unclear integration count across vendor pages',
      description:
        "Gumloop's own pages give differing figures for integrations: its docs introduction cites '100+ pre-built nodes and integrations,' while its dedicated MCP page separately advertises '250+ MCP servers.' These may be different countable categories (native nodes vs MCP-protocol connectors), but neither page cross-references the other, and the dedicated /integrations directory page still returns a 404, making an exact, citable integration count hard to pin down from primary sources.",
      shortDescription:
        'Vendor pages cite different integration counts with no single authoritative figure.',
      source: {
        url: 'https://docs.gumloop.com/getting-started/introduction',
        label: 'Getting Started - Gumloop docs',
        asOf: '2026-07-08',
      },
    },
    {
      title: 'No documented built-in vector-search/RAG knowledge base feature in primary docs',
      description:
        "No official Gumloop documentation describes a dedicated, built-in vector-database/RAG knowledge-base capability. Only a user forum thread and a third-party tutorial reference building a 'knowledge base' with Gumloop nodes.",
      shortDescription:
        'No official docs describe a built-in RAG or vector-database knowledge base.',
      source: {
        url: 'https://forum.gumloop.com/t/building-a-knowledge-base-for-rag/841',
        label: 'Gumloop forum: Building a knowledge base for RAG',
        asOf: '2026-07-02',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          "Visual, no-code canvas builder with an AI copilot ('Gummie') that can generate/modify flows from natural-language prompts",
        detail:
          "Gumloop is a visual/no-code drag-and-drop canvas for chaining nodes (AI, integration, logic) into agent 'flows'; a chat-based AI agent named Gummie can build and edit these flows from plain-English instructions.",
        shortValue: 'Visual canvas plus Gummie AI copilot for building flows',
        confidence: 'estimated',
        sources: [
          { url: 'https://www.gumloop.com', label: 'Gumloop homepage', asOf: '2026-07-08' },
          {
            url: 'https://www.gumloop.com/blog/agentic-ai-tools',
            label: 'Gumloop blog: agentic AI tools',
            asOf: '2026-07-08',
          },
        ],
      },
      learningCurve: {
        value:
          'Low for basic no-code flows aimed at non-technical business users; steeper for advanced use of custom Python code nodes and multi-agent orchestration',
        shortValue: 'Easy for basics, steeper for code and multi-agent',
        confidence: 'estimated',
        sources: [
          { url: 'https://www.gumloop.com', label: 'Gumloop homepage', asOf: '2026-07-02' },
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
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/gumloop/guMCP_template',
            label: "guMCP_template (Gumloop's self-hosted MCP starter repo)",
            asOf: '2026-07-02',
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
            asOf: '2026-07-02',
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
            asOf: '2026-07-02',
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
          { url: 'https://www.gumloop.com/pricing', label: 'Gumloop Pricing', asOf: '2026-07-02' },
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
            asOf: '2026-07-02',
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
          'Linear checkpoint snapshots with rollback; no diff view, no true undo/redo, no branching',
        detail:
          'Gumloop replaced a per-version system with a "checkpoints" model. Users manually create checkpoints (snapshots) before major changes, then can either "Make This Checkpoint Live" (switch triggers/interfaces to that checkpoint) or "Rollback to This Checkpoint" (duplicate a past snapshot into the current draft). Docs describe checkpoint metadata (number, date, author) but no diff/compare view between checkpoints, no session-level undo/redo, and a linear history with no branching. Gumloop compares it to Google Docs version history, not git-style branching.',
        shortValue: 'Checkpoint snapshots; no diff or branching',
        confidence: 'verified',
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
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.gumloop.com/',
            label: 'Gumloop homepage',
            asOf: '2026-07-02',
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
            asOf: '2026-07-02',
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
            asOf: '2026-07-02',
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
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Multiple LLM providers without lock-in: Anthropic (Claude), OpenAI, Google (Gemini), and DeepSeek are named',
        shortValue: 'Claude, OpenAI, Gemini, DeepSeek',
        confidence: 'estimated',
        sources: [
          { url: 'https://www.gumloop.com', label: 'Gumloop homepage', asOf: '2026-07-02' },
        ],
      },
      agentReasoningBlocks: {
        value:
          "Yes: dedicated 'Ask AI'/Agent nodes and multi-agent orchestration on the canvas, distinct from plain data-routing nodes",
        detail:
          "Docs and third-party write-ups describe an 'Ask AI' node for LLM reasoning plus an Agent Node for autonomous/agentic behavior with reflections and tool-use, beyond simple integration/data nodes.",
        shortValue: 'Dedicated Ask AI and Agent nodes, multi-agent orchestration',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/agents',
            label: 'Gumloop docs: Agents',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.gumloop.com/pricing',
            label: 'Gumloop Pricing (agent reflections feature)',
            asOf: '2026-07-02',
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
            asOf: '2026-07-08',
          },
        ],
      },
      knowledgeBaseRag: {
        value: 'Unknown',
        detail:
          "No built-in vector-search or RAG knowledge-base feature is documented in Gumloop's official docs; only a community forum thread references building a custom knowledge base out of Gumloop nodes.",
        shortValue: 'Not documented as a built-in feature',
        confidence: 'unknown',
        sources: [],
      },
      mcpSupport: {
        value:
          'Yes: native MCP client/server support with 250+ pre-built hosted MCP servers plus custom MCP server connections',
        detail:
          "Gumloop can connect to any MCP server (custom URL over HTTPS), offers 250+ fully-hosted MCP servers with zero setup, and supports both 'native MCP' (model connects directly) and a 'backend connector' mode (Gumloop executes tool calls).",
        shortValue: '250+ hosted MCP servers plus custom MCP',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.gumloop.com/mcp',
            label: 'Gumloop: Fully Hosted MCP Servers',
            asOf: '2026-07-08',
          },
          {
            url: 'https://docs.gumloop.com/nodes/mcp/custom_mcp_servers',
            label: 'Gumloop docs: Custom MCP Servers',
            asOf: '2026-07-08',
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
            asOf: '2026-07-08',
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
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.gumloop.com/changelog',
            label: 'Gumloop Changelog',
            asOf: '2026-07-02',
          },
        ],
      },
      generativeMedia: {
        value:
          'Generate Image node supporting 6 models (GPT-Image, DALL-E 3, DALL-E 2, Gemini 3.1 Flash, Gemini 3 Pro, Gemini 2.5 Flash), with 1-10 variations per prompt. No dedicated video or audio (TTS/STT) generation node is documented.',
        detail:
          'Separately, an Enterprise-level admin control lets org admins allow or deny specific AI models platform-wide and set automatic fallback models. This is a general model-governance setting, not specific to image generation.',
        shortValue: 'Image generation node; no video or audio node',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/nodes/using_ai/generate_image',
            label: 'Gumloop Docs: Generate Image node',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.gumloop.com/changelog',
            label: 'Gumloop Changelog',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.gumloop.com/enterprise-features/ai_model_control',
            label: 'Gumloop Docs',
            asOf: '2026-07-02',
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
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.gumloop.com/blog/announcing-skills-for-agents',
            label: 'Announcing Skills for Agents',
            asOf: '2026-07-02',
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
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.gumloop.com/blog/announcing-gumloop-agents',
            label: 'Announcing Gumloop Agents',
            asOf: '2026-07-02',
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
            asOf: '2026-07-02',
          },
        ],
      },
      parallelExecution: {
        value:
          'Partial: Loop Mode runs multiple list items concurrently (up to 15 at once on the Pro plan), but there is no documented dedicated node for splitting a single run into distinct parallel branches that later join, comparable to a fan-out/fan-in construct',
        detail:
          'Gumloop docs describe Loop Mode as processing list items simultaneously rather than one at a time, with concurrency limits tied to plan tier (2 concurrent items on Free, 15 on Pro). This is data-parallelism over a list, not branch-level fan-out/fan-in across different paths of logic.',
        shortValue:
          'Partial: concurrent list-item processing (Loop Mode), no branch fan-out/fan-in node',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/core-concepts/loop_mode',
            label: 'Loop Mode - Gumloop docs',
            asOf: '2026-07-02',
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
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.gumloop.com/blog/introducing-mcp-workflows',
            label: 'Introducing MCP Nodes & Workflows in Gumloop',
            asOf: '2026-07-02',
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
          'Vendor-claimed figures vary by page: 100+ pre-built nodes and integrations (per docs.gumloop.com), 250+ hosted MCP servers (per gumloop.com/mcp)',
        detail:
          "No single authoritative exact count is published on a primary Gumloop page. docs.gumloop.com's introduction cites '100+ pre-built nodes and integrations' while gumloop.com/mcp separately cites '250+ MCP servers, zero setup'; the two pages do not cross-reference each other, and the dedicated /integrations directory page returns a 404.",
        shortValue: '100+ nodes/integrations, 250+ MCP servers (vendor figures vary)',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.gumloop.com/getting-started/introduction',
            label: 'Getting Started - Gumloop docs',
            asOf: '2026-07-08',
          },
          {
            url: 'https://www.gumloop.com/mcp',
            label: 'Gumloop: Fully Hosted MCP Servers',
            asOf: '2026-07-08',
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
            asOf: '2026-07-02',
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
            asOf: '2026-07-02',
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
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/gumloop/gumloop-js',
            label: 'GitHub: Gumloop/gumloop-js',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.gumloop.com/nodes/custom_node_details',
            label: 'Gumloop Docs: Custom Node Builder',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.gumloop.com/blog/gumloop-custom-nodes',
            label: 'Gumloop Blog: Gumloop Custom Nodes',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpPublishing: {
        value:
          "No: Gumloop's MCP capability mainly runs in the consuming direction. It connects agents/workflows to 250+ fully hosted MCP servers and lets users add custom MCP servers as tool sources. No official Gumloop documentation describes publishing a user's deployed workflow itself as a callable MCP server for external AI tools to consume.",
        detail:
          'A third-party, unofficial open-source project ("gumloop-mcp" on GitHub) wraps the Gumloop management API as an MCP server, but that is not the same as natively publishing a specific deployed workflow as an MCP tool, and it is not an official Gumloop product.',
        shortValue: "No: consumes MCP servers, doesn't publish flows as one",
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.gumloop.com/mcp',
            label: 'Fully Hosted MCP Servers for Your AI Agents - Gumloop',
            asOf: '2026-07-08',
          },
          {
            url: 'https://docs.gumloop.com/nodes/mcp/custom_mcp_servers',
            label: 'Custom MCP Servers - Gumloop docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.gumloop.com/blog/introducing-mcp-workflows',
            label: 'Introducing MCP Nodes & Workflows in Gumloop',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Usage-based monthly credit system (credits consumed per task/run), with tiered monthly credit allotments from 5k (free) up to 1.5M+ on paid tiers, plus seat-based distinctions between Free/Pro/Enterprise',
        shortValue: 'Credit-based usage across tiered plans',
        confidence: 'verified',
        sources: [
          { url: 'https://www.gumloop.com/pricing', label: 'Gumloop Pricing', asOf: '2026-07-02' },
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
          { url: 'https://www.gumloop.com/pricing', label: 'Gumloop Pricing', asOf: '2026-07-02' },
        ],
      },
      freeTier: {
        value:
          'Yes: Free plan with 5,000 credits/month, 1 seat, 1 active trigger, 2 concurrent runs, 5 concurrent agent interactions, unlimited agents/flows, forum-only support',
        shortValue: '5,000 credits/month, 1 seat',
        confidence: 'verified',
        sources: [
          { url: 'https://www.gumloop.com/pricing', label: 'Gumloop Pricing', asOf: '2026-07-02' },
        ],
      },
      byok: {
        value: 'Yes: Bring Your Own API Keys is supported across all plans',
        shortValue: 'Supported on all plans',
        confidence: 'verified',
        sources: [
          { url: 'https://www.gumloop.com/pricing', label: 'Gumloop Pricing', asOf: '2026-07-02' },
          {
            url: 'https://www.gumloop.com/solutions/security',
            label: 'Gumloop Security & Trust',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    security: {
      soc2: {
        value:
          'SOC 2 Type II attested; also HIPAA-compliant with BAAs available on eligible plans, and GDPR-aligned with EU-U.S. Data Privacy Framework (incl. UK Extension) certification',
        shortValue: 'SOC 2 Type II, HIPAA, GDPR-aligned',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.gumloop.com/solutions/security',
            label: 'Gumloop Security & Trust',
            asOf: '2026-07-02',
          },
          { url: 'https://trust.gumloop.com/', label: 'Gumloop Trust Center', asOf: '2026-07-02' },
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
            asOf: '2026-07-02',
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
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.gumloop.com/pricing',
            label: 'Gumloop Pricing (Enterprise features list)',
            asOf: '2026-07-02',
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
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.gumloop.com/pricing',
            label: 'Gumloop Pricing (Enterprise features list)',
            asOf: '2026-07-02',
          },
        ],
      },
      additionalCompliance: {
        value:
          'SOC 2 Type II, HIPAA (with BAAs), GDPR-aligned program plus EU-U.S. Data Privacy Framework (incl. UK Extension); no ISO 27001, PCI, or FedRAMP',
        detail:
          'Gumloop is SOC 2 Type II attested, is HIPAA compliant with Business Associate Agreements (BAAs) available on eligible plans, maintains a GDPR-aligned privacy program, and is certified under the EU-U.S. Data Privacy Framework including the UK Extension. It also has zero-data-retention (ZDR) agreements with major LLM providers, BYOK support, encryption in transit and at rest, and DPAs for Enterprise customers, but no ISO 27001, PCI DSS, or FedRAMP.',
        shortValue: 'SOC 2, HIPAA, GDPR; no ISO/PCI/FedRAMP',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.gumloop.com/solutions/security',
            label: 'Gumloop: Security and trust',
            asOf: '2026-07-02',
          },
        ],
      },
      modelAndToolGovernance: {
        value:
          'Yes for models: an org-wide AI Model Control setting lets admins restrict members to an allow-list or block-list of models, set automatic fallback models (including a separate fallback for image generation), and override the default Recommended/Smartest/Fastest presets so all agents use consistent model choices. Tool governance is handled separately via the per-tool authorization policies covered under RBAC/ABAC, not a distinct model-and-tool control surface.',
        detail:
          "Gumloop's docs describe AI Model Control as an Enterprise admin feature applying platform-wide to every member ('Allow Only Selected' or 'Block Selected' modes), not scoped per-team or per-agent. It covers only which LLMs are usable and their fallback/preset routing; it makes no mention of restricting access to non-model tools, which is instead covered by the RBAC/ABAC per-tool authorization policies documented separately.",
        shortValue: 'Yes: org-wide model allow/deny with fallback; tool governance via RBAC',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/enterprise-features/ai_model_control',
            label: 'Gumloop Docs: AI Model Control',
            asOf: '2026-07-04',
          },
          {
            url: 'https://www.gumloop.com/solutions/security',
            label: 'Gumloop Security & Trust',
            asOf: '2026-07-02',
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
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.gumloop.com/blog/gumloop-for-enterprise',
            label: 'Gumloop for Enterprise',
            asOf: '2026-07-02',
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
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.gumloop.com/enterprise-features/sso_saml_scim',
            label: 'SSO, SAML & SCIM - Gumloop docs (mentions dedicated login page)',
            asOf: '2026-07-02',
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
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.gumloop.com/blog/gumloop-for-enterprise',
            label: 'Gumloop for Enterprise',
            asOf: '2026-07-02',
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
            asOf: '2026-07-02',
          },
        ],
      },
      sso: {
        value:
          'Yes: Gumloop supports enterprise SSO via SAML 2.0 (Okta, Entra ID, Google Workspace, JumpCloud, Ping Identity, Active Directory) plus Google/Microsoft OAuth. An SCIM add-on for Okta and Microsoft Entra ID auto-provisions and deprovisions users, syncs custom roles and teams from IdP groups, and runs on a 15-minute sync cycle.',
        detail:
          'Requires Admin role and an Enterprise subscription; enforces SP-initiated login only.',
        shortValue: 'Yes: SAML SSO plus SCIM auto-provisioning',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/enterprise-features/sso_saml_scim',
            label: 'SSO, SAML & SCIM - Gumloop docs',
            asOf: '2026-07-02',
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
            asOf: '2026-07-02',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Customer-facing per-node execution trace with duration/cost, but no aggregate metrics dashboard (percentiles/error-rate) found',
        detail:
          'Gumloop\'s "Run Log" is a customer-facing execution trace view. For every run it shows per-node execution status, inputs/outputs, per-node execution time and credit cost, a subflow detail drill-down, and per-iteration visibility for Loop Mode nodes, plus a workflow summary of total time and total credits, accessible via a `run_id`-scoped URL. No cross-run metrics dashboard (e.g. latency percentiles or aggregate error rates across many runs) is documented. The Run Log is built for debugging one execution at a time, not fleet-wide observability.',
        shortValue: 'Per-node run trace; no aggregate metrics dashboard',
        confidence: 'verified',
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
          'No automatic retries, no execution checkpointing, no run replay with original inputs. Only a manual "Error Shield" node and workflow-level (not run-level) checkpoints',
        detail:
          'Gumloop\'s Run Log documentation makes no mention of automatic node retries, mid-run checkpointing of execution state, or the ability to replay a past execution with its original inputs. Failure handling is opt-in and manual via an "Error Shield" node that wraps other nodes to catch errors and prevent a full workflow crash, something designed into the workflow rather than automatic infrastructure-level retry/replay. Gumloop\'s "checkpoints" feature (see platform.versionControlDepth) snapshots workflow definitions, not individual run state, so it is unrelated to run durability.',
        shortValue: 'No auto-retry or replay; manual Error Shield node',
        confidence: 'verified',
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
          'Yes: proactive email push notification on workflow failure (Pro plan+); credit-usage thresholds are separate/lookup-based',
        detail:
          'Gumloop supports configuring email notifications for workflow failures directly from a workbook\'s side panel. This requires a Pro plan or higher and can be scoped to "Alert only on trigger-based failures" so manual test runs don\'t spam alerts. The failure email includes the workflow name, a run link, and error details, a proactive push rather than something you look up after the fact. Credit/cost-threshold notifications are configured separately on the Subscription page and read more like a lookup setting than a proactive per-threshold push alert.',
        shortValue: 'Proactive email alerts on failure (Pro plan+)',
        confidence: 'verified',
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
            asOf: '2026-07-02',
          },
        ],
      },
      asyncExecution: {
        value:
          "Yes: Gumloop's API triggers workflows asynchronously. A POST to the start_pipeline endpoint returns immediately with a run_id, and the caller polls a separate get_pl_run endpoint (passing that run_id) to check status, logs, and retrieve outputs once the run completes.",
        detail:
          'Documented pattern: POST https://api.gumloop.com/api/v1/start_pipeline to start, GET https://api.gumloop.com/api/v1/get_pl_run?run_id=... to poll for completion and outputs.',
        shortValue: 'Yes: async trigger + poll by run_id',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.gumloop.com/api-reference/getting-started',
            label: 'Gumloop API Reference: Getting Started',
            asOf: '2026-07-02',
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
            asOf: '2026-07-02',
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
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.gumloop.com/core-concepts/workflow_triggers',
            label: 'Gumloop docs: Workflow Triggers',
            asOf: '2026-07-02',
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
          { url: 'https://www.gumloop.com/pricing', label: 'Gumloop Pricing', asOf: '2026-07-02' },
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
          "Founded in Vancouver in April 2023 (originally as 'AgentHub') by Max Brodeur-Urbas and Rahul Behal. Raised a $3.1M seed (July 2024) and a $17M Series A in January 2025 (led by Nexus Venture Partners), both independently corroborated; a self-reported $50M Series B in March 2026 (led by Benchmark) would bring the total to about $70M across 3 rounds. Y Combinator alum with roughly 37 employees as of mid-2026.",
        detail:
          "Gumloop started as a side project in a Vancouver bedroom in April 2023, founded by Max Brodeur-Urbas and Rahul Behal under the name AgentHub before rebranding to Gumloop. It raised a $3.1M seed round in July 2024 and a $17M Series A in January 2025 led by Nexus Venture Partners (with First Round Capital, Y Combinator, and angel investors), both independently corroborated by TechCrunch. The $50M Series B in March 2026 led by Benchmark (with Nexus Venture Partners, First Round Capital, Y Combinator, Box Group, The Cannon Project, and Shopify Ventures) is self-reported on Gumloop's own blog only, with no independent press or funding-tracker corroboration found. Total raised is about $70M across 3 rounds. Y Combinator lists a team size of 37.",
        shortValue: 'Founded 2023, ~$70M raised, Series B in 2026 (self-reported)',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.gumloop.com/blog/gumloops-17m-series-a',
            label: 'Gumloop Blog: Series A announcement',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.gumloop.com/blog/agenthub-to-gumloop',
            label: 'Gumloop Blog: Why we rebranded to Gumloop',
            asOf: '2026-07-02',
          },
          {
            url: 'https://techcrunch.com/2025/01/10/gumloop-founded-in-a-bedroom-in-vancouver-lets-users-automate-tasks-with-drag-and-drop-modules/',
            label: 'TechCrunch: Gumloop founding story & Series A',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.ycombinator.com/companies/gumloop',
            label: 'Y Combinator: Gumloop company page',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.gumloop.com/blog/series-b',
            label: 'Gumloop Blog: Series B announcement',
            asOf: '2026-07-02',
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
            asOf: '2026-07-08',
          },
          {
            url: 'https://www.gumloop.com/cohorts',
            label: 'Gumloop Learning Cohorts',
            asOf: '2026-07-08',
          },
        ],
      },
    },
  },
}
