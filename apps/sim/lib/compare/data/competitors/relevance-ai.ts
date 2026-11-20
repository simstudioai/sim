import { RelevanceAIIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Researched and cross-verified against live vendor sources on 2026-11-19. */
export const relevanceAiProfile: CompetitorProfile = {
  id: 'relevance-ai',
  name: 'Relevance AI',
  website: 'https://relevanceai.com',
  brand: {
    icon: RelevanceAIIcon,
    selfFramed: false,
    colors: ['#4F46E5', '#818CF8', '#C7D2FE', '#0D162F'],
    source: 'Relevance AI official logo SVG (relevanceai.com/images/redesign/relevance-logo.svg)',
    asOf: '2026-11-19',
  },
  oneLiner:
    'Relevance AI is a hosted, proprietary platform for building and running teams of AI agents (an "AI Workforce"), with a no-code agent and tool builder, a visual multi-agent Workforce builder, a built-in building agent called Invent, and packaged agents aimed at sales, marketing, and customer success teams.',
  leadAnswer: [
    'Relevance AI is a hosted AI agent platform built around the "AI Workforce": specialist agents that hand work to each other in a visual multi-agent builder, with approvals, evals, and packaged agents for go-to-market teams. Sim is the open-source AI workspace where teams build, deploy, and manage AI agents visually, conversationally, or with code. Choose Relevance AI when a sales, marketing, or customer success team wants ready-made GTM agents, phone and meeting agents, and a managed service it never has to run. Choose Sim when you need to self-host, read the source, edit the same workflow live with teammates, or promote agents across dev, QA, and production workspaces.',
  ],
  betterThanAnswer: [
    'Sim is the stronger fit when the team building agents needs control over where they run and how they are promoted: its core is Apache 2.0 and self-hostable, and its Enterprise plan adds workspace forking with diff and promote. Relevance AI is the stronger fit for go-to-market teams that want a managed multi-agent service with packaged sales agents, phone and meeting agents, and pre-publish evals, and that accept hosted-only deployment and Enterprise-gated governance. Choose on that axis: an open, self-hostable workspace, or a managed agent service focused on GTM work.',
  ],
  sectionIntros: {
    platform: [
      'Sim offers a visual workflow builder, Chat, and code, with supported self-hosting, live multiplayer editing, and workspace promotion. Relevance AI provides a hosted no-code agent and tool builder plus a visual Workforce builder for multi-agent teams, with draft-and-publish version history.',
    ],
    aiCapabilities: [
      'Both products support many model providers, knowledge bases, MCP, and human approvals. Relevance AI centers its model on teams of agents with per-connection approval modes and Enterprise-tier evals; Sim exposes evaluation, approvals, loops, and parallel branches as blocks in the workflow itself.',
    ],
    integrations: [
      'Relevance AI cites 2,000+ integrations, most of them added through a Pipedream connection, plus custom API steps, an MCP server, and a JavaScript SDK. Sim connects its own integration catalog, publishes deployed workflows as MCP tools, and offers a REST API, OpenAPI spec, and CLI.',
    ],
    pricing: [
      'Sim charges for usage through credits, with bring-your-own-key calls skipping model charges. Relevance AI meters two things on every paid plan: Actions (one per Tool run) and Vendor Credits for model and tool costs, with bring-your-own keys bypassing Vendor Credits but not Actions.',
    ],
    security: [
      'Both products state SOC 2 compliance. Relevance AI offers a choice of US, EU, or Australian data region at signup, while SSO, RBAC, audit logs, model controls, and custom retention are Enterprise-only; Sim adds self-hosting as its main data-control option.',
    ],
    observability: [
      'Relevance AI documents task-status alerts, rerun from the failing step, OpenTelemetry export to S3 on Enterprise, and published run-time ceilings. Sim documents block-level traces, retries, failure alerts, data export, asynchronous runs, and execution limits.',
    ],
    support: [
      'Relevance AI offers a community forum, in-app and email support, a free Academy, and a dedicated Slack channel for Enterprise. Sim offers an open-source community and an Enterprise dedicated-support option.',
    ],
  },
  faqs: [
    {
      question: 'Can I self-host Relevance AI, or do I need a platform like Sim?',
      answer:
        "Relevance AI cannot be self-hosted: it runs as a multi-tenant hosted service, its security page says single-tenant options are still in the works, and its code is not published. Sim's core is Apache 2.0 licensed and can be self-hosted with Docker Compose or Kubernetes (Helm), so your team runs the whole platform. Relevance AI's answer to data location is a region choice at signup (US, EU, or Australia); changing it afterwards means contacting support.",
    },
    {
      question: 'How does Relevance AI pricing compare to Sim?',
      answer:
        "Relevance AI's Pro plan is $19 per month billed annually or $29 billed monthly, with 2,500 Actions and 10,000 Vendor Credits a month, and Team is $234 per month billed annually or $349 monthly; the Free plan has been retired. Every Tool run counts as an Action, even if it fails, and extra Actions cost $80 per 1,000. Sim's Pro plan is $25 per user per month with credit-based usage, and bring-your-own-key calls skip Sim's model usage charge.",
    },
    {
      question: 'Sim vs Relevance AI for multi-agent systems: which is better?',
      answer:
        "It depends on how much you want the platform to decide. Relevance AI's Workforce builder connects agents, tools, and conditions, and each connection can auto-run, require approval, or let the agent decide whether to hand off, with Invent available to build the team from a process description. Sim builds multi-agent systems as workflows with Agent blocks, loops, parallel branches, and approval blocks, built visually, conversationally, or with code, and deployable as a REST API, chat interface, or MCP server.",
    },
  ],
  standoutFeatures: [
    {
      title: 'A visual multi-agent Workforce builder with per-connection approval modes',
      description:
        'A Workforce connects specialist agents, tools, triggers, and conditions in a visual builder. Each connection is either an AI handoff the agent chooses or a mandatory next step, and each agent-to-tool or agent-to-agent edge can be set to Auto run (optionally capped by "Max auto runs"), Approval required, or Let agent decide, with pending approvals reviewed in the Workforce task view.',
      shortDescription:
        'Visual multi-agent teams where each connection auto-runs, needs approval, or lets the agent decide.',
      source: {
        url: 'https://relevanceai.com/docs/build/workforces/workforce-features/approvals-and-escalations',
        label: 'Approvals and Escalations | Relevance AI Docs',
        asOf: '2026-11-19',
      },
    },
    {
      title: 'Invent, a built-in agent that builds and maintains the agent team',
      description:
        'Invent takes a business process described in plain language and creates the Agents, Tools, Triggers, Knowledge tables, Workforces, and Evals to run it, then reviews live performance, diagnoses quality problems, and proposes tested fixes. It can also run scheduled routines and auto-diagnose failed triggers, with per-tool approval settings (Auto, Ask, Always ask) that default destructive actions such as delete and publish to Always ask.',
      shortDescription:
        'Invent builds agents, tools, triggers, and evals from a process description, then monitors them.',
      source: {
        url: 'https://relevanceai.com/docs/build/invent/invent',
        label: 'Build with Invent | Relevance AI Docs',
        asOf: '2026-11-19',
      },
    },
    {
      title: 'Evals that simulate conversations and can block publishing',
      description:
        'Evals runs Test sets that simulate users against an Agent or Workforce, scores each conversation with reusable Checks, and can require a minimum pass rate before a new version publishes. Monitor dashboards then score a sampled share of live conversations against the same Checks. Agent Evaluations are listed as an Enterprise-plan feature.',
      shortDescription:
        'Simulated-conversation evals with a pass-rate gate on publishing and live sampling (Enterprise).',
      source: {
        url: 'https://relevanceai.com/docs/build/agents/evals/running-evaluations',
        label: 'Running Evals | Relevance AI Docs',
        asOf: '2026-11-19',
      },
    },
    {
      title: 'Phone and meeting agents',
      description:
        'Phone Agents make outbound calls, speak with the person on the line, and run tools during the call, with a Relevance-provided or your own phone number. Meeting agents join calls to take notes and respond to trigger words typed in the meeting chat. Calling and Meeting agent modes are included on the Team and Enterprise plans.',
      shortDescription:
        'Voice agents that call out and act mid-call, plus meeting agents, on Team and Enterprise.',
      source: {
        url: 'https://relevanceai.com/docs/build/agents/build-your-agent/agent-modes/phone-calls',
        label: 'Phone Agents | Relevance AI Docs',
        asOf: '2026-11-19',
      },
    },
    {
      title: 'Build agents from Claude Code, Codex, or any MCP client',
      description:
        "Relevance AI's MCP server at mcp.relevanceai.com gives Claude Desktop, ChatGPT, Cursor, VS Code, and other MCP clients access to a project's agents, tools, and knowledge, and a Claude Code plugin and agent-skills repository let a coding agent create and edit Agents, Tools, Triggers, and Workforces in natural language. An official JavaScript/TypeScript SDK (@relevanceai/sdk) covers embedding agents in your own apps.",
      shortDescription:
        'MCP server, Claude Code plugin, and a JS/TS SDK for building and running agents from code tools.',
      source: {
        url: 'https://relevanceai.com/docs/get-started/core-concepts/mcp-plugins',
        label: 'MCP & Plugins | Relevance AI Docs',
        asOf: '2026-11-19',
      },
    },
    {
      title: 'Choice of US, EU, or Australian data region',
      description:
        'Data is stored in US (N. Virginia), EU (London), or AU (Sydney), chosen when the organization is created. The region cannot be changed afterwards without contacting support.',
      shortDescription: 'Pick a US, EU, or Australian data region at signup.',
      source: {
        url: 'https://relevanceai.com/docs/admin/security',
        label: 'Security overview | Relevance AI Docs',
        asOf: '2026-11-19',
      },
    },
  ],
  limitations: [
    {
      title: 'Hosted-only and proprietary, with no self-hosting option',
      description:
        "Relevance AI runs on a multi-tenant architecture with logical data separation, and its security page says single-tenant options are 'currently in the works'. No self-hosted or on-premises deployment is documented, and the platform's source code is not published.",
      shortDescription:
        'Multi-tenant SaaS only; no self-hosting, and single-tenant is not yet offered.',
      source: {
        url: 'https://relevanceai.com/docs/admin/security',
        label: 'Security overview | Relevance AI Docs',
        asOf: '2026-11-19',
      },
    },
    {
      title: 'Governance and evals are Enterprise-only, and some are still rolling out',
      description:
        "SSO, RBAC, audit logs, Agent Evaluations, model controls, integration controls, and custom data retention are all listed as Enterprise-only. The RBAC, RBAC Groups, user-level authentication, and asset-level credential controls pages say these features are 'gradually being rolled out' to Enterprise customers.",
      shortDescription:
        'SSO, RBAC, audit logs, and evals need Enterprise; RBAC is still rolling out.',
      source: {
        url: 'https://relevanceai.com/docs/enterprise/rbac',
        label: 'Role-based access controls (RBAC) | Relevance AI Docs',
        asOf: '2026-11-19',
      },
    },
    {
      title: 'Two usage meters, and every Tool run costs an Action even when it fails',
      description:
        'Paid plans meter Actions (one per Tool run) and Vendor Credits (model and tool costs) separately. A failed Tool run still counts as one Action, plan Actions reset at each renewal, and extra Actions cost $80 per 1,000. Bringing your own model keys bypasses Vendor Credits but not Actions.',
      shortDescription:
        'Actions and Vendor Credits are billed separately; failed Tool runs still use an Action.',
      source: {
        url: 'https://relevanceai.com/docs/admin/subscriptions/plans',
        label: 'Plans and credits | Relevance AI Docs',
        asOf: '2026-11-19',
      },
    },
    {
      title: 'No free plan, and the public pricing page lists only Enterprise',
      description:
        'The Free plan is retired for new signups and existing accounts, so every organization needs a paid plan. On 2026-11-19 the relevanceai.com/pricing page showed only a sales-led Enterprise tier; Pro and Team prices appear on the pricing page in the documentation.',
      shortDescription: 'Free plan retired; self-serve prices are only listed in the docs.',
      source: {
        url: 'https://relevanceai.com/docs/get-started/pricing',
        label: 'Pricing | Relevance AI Docs',
        asOf: '2026-11-19',
      },
    },
    {
      title: 'The API is supported only for triggering Agents and Tools',
      description:
        "Relevance AI's docs say the API is 'officially supported only for triggering Agents and Tools. All other usage is currently unsupported.' The agent API trigger does not return the agent's result in the response; the result has to be sent to a destination you configure, such as a webhook or Google Sheets.",
      shortDescription:
        'API is supported only for triggering runs; results go to a configured destination.',
      source: {
        url: 'https://relevanceai.com/docs/build/agents/build-your-agent/agent-triggers/api-trigger',
        label: 'API Triggers | Relevance AI Docs',
        asOf: '2026-11-19',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'No-code agent and tool builder (prompt, tools, triggers, knowledge), a visual Workforce builder that connects agents, tools, triggers, and conditions, plus Invent for natural-language building and an MCP server for coding agents',
        detail:
          'Agents are configured through prompt, tools, triggers, and settings tabs; Tools are built from ordered steps with loops and branches; Workforces lay out multi-agent teams as connected nodes (triggers, agents, tools, conditions). Invent and the MCP server let a builder create the same assets in plain language.',
        shortValue: 'No-code agent builder plus visual multi-agent Workforce builder',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/workforces/build-an-ai-workforce/introduction-to-nodes',
            label: 'Introduction to Nodes | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/features',
            label: 'Relevance AI Features',
            asOf: '2026-11-19',
          },
        ],
      },
      learningCurve: {
        value:
          'Low for a single agent or a cloned Marketplace agent; steeper for multi-agent Workforces with edge settings, Python tool steps, and Enterprise RBAC setup',
        detail:
          "Relevance AI positions the product for domain experts rather than engineers and offers a 5-minute quick start and a free Academy. Its own org-structure guide notes that environment-separated projects are 'more complex for non-technical users'.",
        shortValue: 'Easy for single agents, steeper for Workforces and code steps',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://relevanceai.com/docs/get-started/quick-start-guide',
            label: 'Quick Start | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/enterprise/org-structure-best-practices',
            label: 'Organization Structure Best Practices | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      selfHostOption: {
        value:
          'No: Relevance AI is offered only as a hosted, multi-tenant service; its security page says single-tenant options are still in the works',
        detail:
          'Customer data is logically separated in a multi-tenant architecture, with a separate service and database for Enterprise customers that enable fine-grained access controls. No self-hosted or on-premises installation is documented.',
        shortValue: 'No, hosted multi-tenant SaaS only',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/admin/security',
            label: 'Security overview | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      deploymentOptions: {
        value:
          'Hosted cloud in a US, EU, or Australian region chosen at signup; agents run through the web app, Relevance Chat (web, desktop, iOS, Android), Slack and Teams triggers, an embeddable chat widget, API, and SDK',
        detail:
          'The data region (US N. Virginia, EU London, or AU Sydney) is fixed when the organization is created. Agents can also be shared as a public Chat UI link, an embeddable chat widget, or a Task UI iframe.',
        shortValue: 'Hosted only, US/EU/AU region; chat, widget, API, SDK',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/admin/security',
            label: 'Security overview | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/build/agents/share-your-agent',
            label: 'Share Your Agent | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      templates: {
        value:
          'Yes: a Marketplace of agents and tools built by Relevance AI staff and vetted community builders, some free and some paid, plus cloneable agent and Workforce templates',
        detail:
          'Marketplace listings can be free or paid (creators set prices up to $1,000), and every submission is reviewed by the Relevance AI team. Agents and Workforces can also be shared as cloneable templates that run on the recipient’s own credits.',
        shortValue: 'Marketplace of free and paid agents, plus cloneable templates',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/get-started/marketplace/introduction',
            label: 'Marketplace | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/build/workforces/share-your-workforce',
            label: 'Share your Workforce | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      license: {
        value: 'Proprietary, closed-source SaaS',
        detail:
          "Relevance AI is operated by OnSearch Pty Ltd T/A Relevance AI. Its public GitHub organization hosts documentation, not the platform's source, and no open-source license for the product is published.",
        shortValue: 'Proprietary',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/about-us',
            label: 'About us | Relevance AI',
            asOf: '2026-11-19',
          },
          {
            url: 'https://github.com/RelevanceAI/relevance-docs',
            label: 'RelevanceAI/relevance-docs (GitHub)',
            asOf: '2026-11-19',
          },
        ],
      },
      environmentPromotion: {
        value:
          'No formal promotion: the docs suggest separate Development, Staging, and Production projects, with assets copied between them using "Copy to Project", and note you "may need to duplicate assets across environments"',
        detail:
          'Within one project, edits go to a draft and only reach the live version on publish, which separates work-in-progress from production for a single asset. There is no documented diff-and-promote flow between whole projects.',
        shortValue: 'Separate projects per environment, assets copied manually',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://relevanceai.com/docs/enterprise/org-structure-best-practices',
            label: 'Organization Structure Best Practices | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/build/agents/share-your-agent',
            label: 'Share Your Agent | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Every draft save and publish creates a version for Agents, Tools, and Workforces; any version can be restored into a draft and renamed, and the live version keeps running until you publish',
        detail:
          'The version panel shows who saved each version and marks versions made by Invent or over MCP. Versions are kept indefinitely unless an Enterprise retention policy applies, and the active and draft versions are always protected. No side-by-side diff view is documented.',
        shortValue: 'Auto-versioned drafts and publishes with restore',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/agents/build-your-agent/version-history',
            label: 'Version history | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          'Not documented: projects are shared by members with roles, but no live co-editing of the same agent or Workforce with shared cursors is described',
        detail:
          "Relevance AI's collaboration page and docs cover shared projects, roles, sharing, and escalations rather than live concurrent editing.",
        shortValue: 'Shared projects; live co-editing not documented',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://relevanceai.com/collaboration',
            label: 'Collaboration | Relevance AI',
            asOf: '2026-11-19',
          },
        ],
      },
      nativeFileStorage: {
        value:
          'Not documented: files are uploaded into Knowledge tables or Chat conversations; no standalone file manager with folders and link sharing is described',
        detail:
          'Uploads are capped at 100 MB, and Knowledge accepts CSV, PDF, Excel, JSON, and audio files.',
        shortValue: 'No native file manager documented',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://relevanceai.com/docs/admin/system-limits',
            label: 'System quotas | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/build/knowledge/create-knowledge',
            label: 'Create and Organize Knowledge | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      dataTables: {
        value:
          'Partial: Knowledge tables are native tables with columns you define and rows agents can insert, update, delete, and enrich with AI-generated columns; spreadsheet keyboard navigation is not documented',
        detail:
          'A Knowledge table can start empty with custom columns, and Tool steps insert, update, delete, and search rows. CSV uploads are capped at 50,000 rows.',
        shortValue: 'Knowledge tables agents read and write',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/knowledge/create-knowledge',
            label: 'Create and Organize Knowledge | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/admin/system-limits',
            label: 'System quotas | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      richTextEditor: {
        value: 'Not publicly documented',
        detail:
          'No in-product rich-text document editor is described; Chat includes Slide Builder and Website Builder agents that generate content instead.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      subWorkflows: {
        value:
          'Yes: a saved Tool can be attached to many agents and chained to other Tools, and Workforces hand tasks between saved agents; the same agent can join several Workforces',
        detail:
          'Tools exist independently of agents in a Workforce and can be connected to multiple agents or to other tools in sequence. The older Sub-agents setting is marked legacy and may be deprecated.',
        shortValue: 'Reusable Tools and agents across Workforces',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/get-started/core-concepts/workforces',
            label: 'Workforces | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/build/workforces/build-an-ai-workforce/introduction-to-nodes',
            label: 'Introduction to Nodes | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      customBlocks: {
        value:
          'Partial: Tools are named, reusable units with defined inputs and outputs that any agent in the project can use, and can be listed in the Marketplace; cloning copies the full Tool rather than exposing it as an encapsulated block',
        detail:
          'Marketplace and template sharing let others clone an agent, Tool, or Workforce into their own project, including its configuration, which is the opposite of hiding the internals behind an interface.',
        shortValue: 'Reusable Tools; shared by cloning, not encapsulated',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://relevanceai.com/docs/get-started/core-concepts/tools',
            label: 'Tools | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/get-started/marketplace/introduction',
            label: 'Marketplace | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Yes: models from OpenAI, Anthropic, Google, Azure, and OpenRouter, selectable per agent, tool step, or Workforce condition, with reasoning-effort and temperature settings',
        detail:
          'The changelog shows models added within weeks of release, such as Claude Sonnet 5.5 and Haiku 5.5 and Gemini 3.5 Flash in 2026, plus decision models (TypeSafe Jev 1.13, GPT-6 Luna Decisions) for Workforce conditions.',
        shortValue: 'OpenAI, Anthropic, Google, Azure, OpenRouter models',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/agents/build-your-agent/agent-settings/language-model',
            label: 'Language Model | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/changelog',
            label: 'Changelog | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          'Yes: each agent reasons over its prompt and decides which of its tools to call, and in a Workforce can decide whether to hand work to another agent over an AI connection',
        detail:
          'Workforce connections are either AI connections, where the agent chooses when to pass control, or Next step connections that always fire when the previous agent finishes.',
        shortValue: 'Agents choose tools and handoffs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/get-started/core-concepts/workforces',
            label: 'Workforces | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          'Yes: Invent builds Agents, Tools, Triggers, Knowledge tables, Workforces, and Evals from a plain-language description, and coding agents such as Claude Code can build them over MCP',
        detail:
          'Invent asks before restoring versions and defaults delete and publish actions to Always ask. It is on by default in new projects, and organization admins can turn it off per project.',
        shortValue: 'Invent builds agents and Workforces from plain language',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/invent/invent',
            label: 'Build with Invent | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          'Yes: Knowledge tables built from uploads (CSV, PDF, Excel, JSON, audio), websites, or synced Google Drive, SharePoint, Notion, and Confluence sources, searched by semantic or hybrid retrieval',
        detail:
          "An agent can either receive the whole knowledge set in its prompt or search it with RAG. Relevance AI's features page lists hybrid retrieval (vector, keyword/BM25, and ensemble) and configurable character or semantic chunking.",
        shortValue: 'Knowledge tables with semantic/hybrid search and synced sources',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/get-started/core-concepts/knowledge',
            label: 'Knowledge | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/features',
            label: 'Relevance AI Features',
            asOf: '2026-11-19',
          },
        ],
      },
      mcpSupport: {
        value:
          'Yes: agents can connect preset (Notion, Canva, Atlassian) or custom remote MCP servers over Streamable HTTP; local MCP servers are not supported',
        detail:
          'The same MCP server URL can be connected several times with different credentials, and each tool is labeled with its connection name.',
        shortValue: 'Remote MCP servers; no local servers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/integrations/mcp/mcp-client',
            label: 'MCP client | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'Yes on Enterprise: Evals runs simulated-conversation Test sets scored by reusable Checks, can block publishing below a minimum pass rate, and samples live conversations on Monitor dashboards',
        detail:
          'Agent Evaluations are marked Enterprise-only on the pricing comparison. For guardrails, customers using their own AWS Bedrock account can apply Bedrock Guardrails to Anthropic models, and Enterprise customers can enable prompt-injection detection recorded on OpenTelemetry traces.',
        shortValue: 'Pre-publish evals and live monitoring (Enterprise)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/agents/evals/introduction',
            label: 'Introduction to Evals | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/get-started/pricing',
            label: 'Pricing | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/admin/security',
            label: 'Security overview | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      humanInTheLoop: {
        value:
          'Yes: each Workforce connection can run automatically, require approval, or let the agent decide; pending tasks wait for approval in the task view, and approvals can be handled in Slack',
        detail:
          'Agents can also escalate to a person through escalation tools. The Tasks page groups Approvals, Escalated, and Errors views, and alarms can notify email, Slack, or Teams when too many tasks wait on approval.',
        shortValue: 'Per-connection approval modes with Slack approvals',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/workforces/workforce-features/approvals-and-escalations',
            label: 'Approvals and Escalations | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/changelog',
            label: 'Changelog | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      generativeMedia: {
        value:
          'Partial: image generation (a "Text to image generation" step and an Image Generator agent in Chat, 24+ image models per the features page) and voice through Phone Agents; no video generation is documented',
        detail:
          "Audio and video can be transcribed to text with dedicated Tool steps. OpenAI's GPT Image 1.5 was added to the image step in February 2026.",
        shortValue: 'Image generation and phone voice; no video',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://relevanceai.com/features',
            label: 'Relevance AI Features',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/get-started/chat/chat-agents/image-generator',
            label: 'Image Generator | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/changelog',
            label: 'Changelog | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      dynamicToolUse: {
        value:
          'Yes: an agent picks from the tools, MCP tools, and agents connected to it at run time, and can call several in parallel when Parallel Tool Calls (beta) is on',
        detail:
          'Tools are pre-attached to an agent or Workforce node; the agent chooses among them per step rather than browsing an open catalog.',
        shortValue: 'Agent chooses among its attached tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/agents/build-your-agent/agent-settings/language-model',
            label: 'Language Model | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      modelFallback: {
        value:
          'Yes: a fallback model can be set per agent and retries a failed task once if the primary model errors or does not respond',
        detail:
          'If the fallback model also fails, the task fails and follows the configured error handling.',
        shortValue: 'One-time retry on a fallback model',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/agents/build-your-agent/agent-settings/language-model',
            label: 'Language Model | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      agentSkills: {
        value:
          'Partial: Snippets store shared text reused across a workspace, and Chat has saved prompts; there is no documented named skill package attached to many agents',
        detail:
          "Relevance AI's 'agent skills' repository is for coding assistants such as Claude Code, not a feature agents inside Relevance AI use.",
        shortValue: 'Shared Snippets and saved prompts',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/knowledge/use-snippets-for-quick-access',
            label: 'Use Snippets for Quick Access | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      nativeChatDeployment: {
        value:
          'Yes: Relevance Chat (web, desktop, iOS, Android), a public Chat UI link or iframe, and an embeddable chat widget',
        detail:
          'Enabling a Chat UI, widget, or Task UI makes the agent publicly accessible, and usage is billed to the owner. User Level Authentication is not supported in embedded widgets.',
        shortValue: 'Hosted Chat app, share link, and embeddable widget',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/agents/share-your-agent',
            label: 'Share Your Agent | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/get-started/chat/introduction',
            label: 'Chat | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          'Partial: chunking is configurable when importing documents and Knowledge is stored as tables you can open, but no retrieval debugger showing which chunks a search returned is documented',
        detail:
          'The docs recommend balancing chunk size and overlap, which implies chunk-level storage, but how chunks appear in the table is not described.',
        shortValue: 'Configurable chunking; no retrieval inspector documented',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/knowledge/create-knowledge',
            label: 'Create and Organize Knowledge | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      parallelExecution: {
        value:
          'Yes: Parallel Tool Calls (beta) lets an agent run several tools or agent handoffs at once, and Tool loops can process list items in parallel',
        detail:
          'In a Workforce, outbound connections must use the "Create new task" behavior to run in parallel.',
        shortValue: 'Parallel tool calls (beta) and parallel loops',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/agents/build-your-agent/agent-settings/language-model',
            label: 'Language Model | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/build/tools/customize-tool/looping',
            label: 'Looping | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      a2aProtocol: {
        value: 'Not publicly documented',
        detail:
          'Agent-to-agent handoffs inside a Workforce are a Relevance AI feature, but no support for the open Agent2Agent (A2A) protocol is documented.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      loopIteration: {
        value:
          'Yes: a Loop step inside a Tool iterates over a list, one item at a time or all in parallel, with {{foreach.item}} and {{foreach.index}} variables',
        detail:
          'By default an item that errors is skipped and shown in the Loop’s Errors tab; the Loop can be set to throw instead.',
        shortValue: 'Loop step over lists, sequential or parallel',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/tools/customize-tool/looping',
            label: 'Looping | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value:
          '2,000+ integrations per Relevance AI (its catalog listed 2,728 on 2026-11-19), most added through a Pipedream connection; the docs separately cite 1,000+ app triggers',
        detail:
          "The integrations docs split the catalog into native integrations built by Relevance AI and Pipedream integrations that 'extend the catalog to 2,000+ services'. The enterprise page and llms.txt instead say 1,000+ native connectors, so Relevance AI's own pages give two different figures.",
        shortValue: '2,000+ (most via Pipedream)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/integrations',
            label: 'Relevance AI Integrations',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/integrations/introduction',
            label: 'Integrations | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/enterprise',
            label: 'Relevance AI Enterprise',
            asOf: '2026-11-19',
          },
        ],
      },
      triggerTypes: {
        value:
          'Integration triggers (Gmail, Slack, Teams, Google Drive, and more), schedules and cron, webhooks, API, SDK, Tools as triggers, manual chat, and bulk runs over a CSV',
        detail:
          'Premium triggers (WhatsApp, LinkedIn, Telegram) are on all paid plans; Enterprise triggers (Salesforce, Snowflake, Zendesk) require Enterprise. Triggers can be paused and resumed, and a Trigger status page alerts on failures.',
        shortValue: 'App events, schedules, webhooks, API, SDK, bulk',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/agents/build-your-agent/triggers',
            label: 'Triggers | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/get-started/pricing',
            label: 'Pricing | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      customCodeSteps: {
        value:
          'Yes: Python and JavaScript code steps inside Tools, plus an API step for custom HTTP calls',
        detail:
          'The features page lists sandboxed code execution in Python and JavaScript; the Python step docs cover PyPI packages and helper functions.',
        shortValue: 'Python and JavaScript steps, API step',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/tools/tool-steps/python-code/code-python',
            label: 'Python Tool step | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/features',
            label: 'Relevance AI Features',
            asOf: '2026-11-19',
          },
        ],
      },
      codeSandboxRuntime: {
        value:
          'Partial: a Python step can declare any PyPI package in its "PyPI Packages" list, but OS-level packages and extra CLI binaries are not documented',
        detail: 'No package option for the JavaScript step is documented.',
        shortValue: 'PyPI packages per Python step; no OS packages',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/tools/tool-steps/python-code/code-python',
            label: 'Python Tool step | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      apiPublishing: {
        value:
          'Yes: an API trigger starts an agent with an HTTP POST, and Tools can be run over the API; results are sent to a configured destination rather than returned in the response',
        detail:
          "The docs say the API is 'officially supported only for triggering Agents and Tools'. The JavaScript SDK wraps the same endpoint with task events and streaming.",
        shortValue: 'HTTP trigger for agents and tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/agents/build-your-agent/agent-triggers/api-trigger',
            label: 'API Triggers | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'An official JavaScript/TypeScript SDK (@relevanceai/sdk), an MCP server, a Claude Code plugin and agent-skills repository, custom API keys for unlisted services, and a Marketplace where vetted builders sell agents and tools',
        detail:
          'The SDK runs in Node.js, Deno, Bun, Cloudflare Workers, and the browser. No Python SDK or developer kit for building new native integrations is documented.',
        shortValue: 'JS/TS SDK, MCP server, Claude Code plugin, Marketplace',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/sdk/introduction',
            label: 'JavaScript SDK | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/get-started/core-concepts/mcp-plugins',
            label: 'MCP & Plugins | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      mcpPublishing: {
        value:
          'Yes, at project level: the Relevance AI MCP server (mcp.relevanceai.com) exposes a project’s agents, tools, and knowledge to Claude, ChatGPT, Cursor, VS Code, and other MCP clients',
        detail:
          'Users with Viewer or Chat roles connect in a restricted mode that runs existing agents without building or editing them. The server exposes the project as a whole rather than publishing a single workflow as its own MCP server.',
        shortValue: 'Project-wide MCP server for external clients',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/integrations/mcp/mcp-server',
            label: 'MCP server | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Organization-level subscription with two meters: Actions (one per Tool run, even if it fails) and Vendor Credits (model and tool costs passed through without markup); Enterprise is sales-led',
        detail:
          'Plan Actions reset at each renewal while Vendor Credits roll over while subscribed. Top-ups cost $80 per 1,000 Actions and $20 per 10,000 Vendor Credits. On 2026-11-19 the relevanceai.com/pricing page showed only the Enterprise tier; self-serve prices are on the docs pricing page.',
        shortValue: 'Subscription plus Actions and Vendor Credits',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/admin/subscriptions/plans',
            label: 'Plans and credits | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/pricing',
            label: 'Relevance AI Pricing',
            asOf: '2026-11-19',
          },
        ],
      },
      entryPaidPlan: {
        value:
          'Pro: $19/month billed annually or $29/month billed monthly, with 2,500 Actions and 10,000 Vendor Credits ($20) a month, 2 build users, and 1 project',
        detail:
          'Team is $234/month billed annually or $349/month billed monthly, with 7,000 Actions and 35,000 Vendor Credits a month, 5 build users, 45 end users, and 5 shared projects. Prices are from the docs pricing page; the marketing pricing page listed only Enterprise when checked.',
        shortValue: '$19/mo annual or $29/mo monthly (Pro)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/get-started/pricing',
            label: 'Pricing | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      freeTier: {
        value: 'No: the Free plan is retired for new signups and existing accounts',
        detail: 'Organizations that were on Free must upgrade to Pro or Team to keep using them.',
        shortValue: 'No free plan',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/get-started/pricing',
            label: 'Pricing | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      byok: {
        value:
          'Yes, on every plan: your own model keys bypass Vendor Credits (with credits kept as a fallback), but each Tool run still counts as an Action',
        detail:
          'Supported connections include an OpenAI key, AWS Bedrock or Google Cloud for Anthropic models, Google AI Studio or Google Cloud for Gemini, Azure, and OpenRouter. Bedrock role assumption requires Enterprise.',
        shortValue: 'BYOK on all plans; Actions still apply',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/admin/subscriptions/plans',
            label: 'Plans and credits | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/integrations/llm-integrations/anthropic',
            label: 'Anthropic LLM models | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
    },
    security: {
      soc2: {
        value: 'Yes: SOC 2 Type II compliant',
        detail:
          'Compliance documentation and third-party assessment reports are shared with Enterprise customers on request under NDA.',
        shortValue: 'SOC 2 Type II',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/admin/security',
            label: 'Security overview | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      dataResidency: {
        value: 'Yes: US (N. Virginia), EU (London), or AU (Sydney), chosen at signup',
        detail:
          'The region cannot be changed after the organization is created without contacting support. Relevance AI also says it hosts some OpenAI and open-source models in its own multi-region AWS and Azure environments.',
        shortValue: 'US, EU, or AU region at signup',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/admin/security',
            label: 'Security overview | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      rbac: {
        value:
          'Enterprise only, still rolling out: organization roles (Owner, Admin, Member, Viewer), project roles (Admin, Editor, Member, Chat, Viewer), and asset roles (Admin, Member, Viewer)',
        detail:
          'IdP groups from Entra ID or Okta can be synced through WorkOS about every 60 minutes and assigned to projects and assets.',
        shortValue: 'Org, project, and asset roles (Enterprise)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/enterprise/rbac',
            label: 'Role-based access controls (RBAC) | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/enterprise/rbac-groups',
            label: 'Directory Sync and Groups | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      auditLogging: {
        value:
          'Enterprise only: audit logs and execution traces stream in OpenTelemetry format to your own S3 bucket; organization Owners, Admins, and Viewers can view audit logs',
        detail:
          'S3 is the only supported destination, and the OpenTelemetry stream requires RBAC to be enabled. The features page lists user, IP, device, and timestamp on audit events.',
        shortValue: 'Enterprise audit logs streamed to S3',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/enterprise/streaming-events',
            label: 'Event Streaming for Observability (OpenTelemetry) | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/get-started/pricing',
            label: 'Pricing | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/enterprise/rbac',
            label: 'Role-based access controls (RBAC) | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/changelog',
            label: 'Changelog | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      additionalCompliance: {
        value:
          'SOC 2 Type II and GDPR; no ISO 27001, HIPAA, PCI, or FedRAMP attestation is documented',
        detail:
          'The data-retention docs say retention policies help support frameworks such as HIPAA, but no HIPAA attestation or BAA is described. The Vanta-hosted Trust Center at trust.relevanceai.com renders client-side and could not be read directly.',
        shortValue: 'SOC 2 Type II, GDPR',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://relevanceai.com/docs/admin/security',
            label: 'Security overview | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      modelAndToolGovernance: {
        value:
          'Yes on Enterprise: model controls block providers or single models and keep new models off until approved, and integration controls hide integrations that are not enabled',
        detail:
          'Before a model is turned off, admins see which platform features, Agents, and LLM tool steps it affects.',
        shortValue: 'Model and integration allowlists (Enterprise)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/enterprise/model-controls',
            label: 'Model controls | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/enterprise/integration-controls',
            label: 'Organization-level integration controls | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      credentialGovernance: {
        value:
          'Partial, Enterprise and rolling out: users choose whether their OAuth accounts are shared on an asset, and User Level Authentication makes shared agents use each person’s own accounts',
        detail:
          'Custom API keys stored in a project can be used by any builder in that project, which the docs flag as a shared-access risk.',
        shortValue: 'Per-asset OAuth sharing and per-user auth (Enterprise)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/enterprise/asset-controls',
            label: 'Asset-level authentication controls | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/enterprise/user-level-authentication',
            label: 'User Level Authentication | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      dataRetention: {
        value:
          'Yes on Enterprise: admins set retention windows for tool runs, agent conversations, Workforce tasks, and old versions; Pro and Team list 90-day task history',
        detail:
          'Data Retention must be enabled by the Relevance AI team. The security page says run logs on paid tiers are otherwise stored until you delete them.',
        shortValue: 'Configurable retention (Enterprise); 90-day history on Pro/Team',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/enterprise/data-retention',
            label: 'Data Retention | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/get-started/pricing',
            label: 'Pricing | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/admin/security',
            label: 'Security overview | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      piiRedaction: {
        value:
          'Partial, Enterprise: Visual Data Masking (limited beta) hides emails, phone numbers, card numbers, and names in the UI only, and PII redaction can be enabled on streamed logs',
        detail:
          'Masking is display-only: agents still process the unmasked data, and the docs warn the detection model can miss sensitive information. The features page also lists PII masking before data reaches the model; Bedrock Guardrails can mask PII for BYO Anthropic models.',
        shortValue: 'UI-only masking (beta) and log redaction',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/agents/build-your-agent/agent-settings/visual-data-masking',
            label: 'Visual Data Masking | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/enterprise/streaming-events',
            label: 'Event Streaming for Observability (OpenTelemetry) | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      sso: {
        value:
          'Yes on Enterprise: SAML 2.0 and OIDC SSO through WorkOS (Okta, Entra ID, Google Workspace, Auth0, and more), plus directory sync of IdP groups',
        detail:
          'SSO is set up with a Relevance AI representative. Email is the account identifier, so an email change in the IdP creates a new account rather than updating the existing one.',
        shortValue: 'SAML/OIDC SSO with directory sync (Enterprise)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/enterprise/sso-setup',
            label: 'Single Sign-On (SSO) Setup | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      sessionPolicy: {
        value: 'Not publicly documented',
        detail:
          'No admin-configurable session lifetime or idle timeout is described in the SSO, RBAC, or security docs.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      thirdPartyVetting: {
        value:
          'Mixed: native integrations are built by Relevance AI, most of the catalog comes through Pipedream, Marketplace listings are reviewed by the Relevance AI team, and agents can connect any remote MCP server URL',
        detail:
          'Only verified Relevance Builders can submit to the Marketplace, and each submission and update is reviewed before it goes live. No review process is described for custom MCP server URLs.',
        shortValue: 'Reviewed Marketplace; open custom MCP URLs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/get-started/marketplace/relevance-builders/submit-agents',
            label: 'Submit Agents to the Marketplace | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/integrations/introduction',
            label: 'Integrations | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Each task shows its steps, tool runs, and credit cost per tool and LLM call; Analytics dashboards (Team and up) show usage, errors, and concurrency; Enterprise can stream execution traces via OpenTelemetry',
        detail:
          'The Tasks page lists Approvals, Escalated, and Errors views with day-by-day timelines, and the Home page shows a 14-day task health bar.',
        shortValue: 'Per-task step and cost view; dashboards; OTEL on Enterprise',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/agents/give-your-agent-tasks/tasks-page',
            label: 'Task Operations | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/enterprise/analytics',
            label: 'Analytics | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/changelog',
            label: 'Changelog | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      durabilityModel: {
        value:
          'Errored tasks can be rerun from the failing step, a fallback model retries a failed task once, and the features page lists durable execution, checkpointing, exponential-backoff retries, and a dead-letter queue',
        detail:
          'Task statuses include Exhausted retries and Queued for rerun. The detailed retry policy is described on the features page rather than in the docs.',
        shortValue: 'Rerun from failing step; retries and checkpointing',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/agents/give-your-agent-tasks/tasks-page',
            label: 'Task Operations | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/features',
            label: 'Relevance AI Features',
            asOf: '2026-11-19',
          },
        ],
      },
      failureAlerting: {
        value:
          'Yes, on paid plans: alert rules on task status (timed out, unrecoverable error, exhausted retries, and more), tool errors, and publishes, sent to email, Slack, or Teams',
        detail:
          'Rate-based alarms fire when the share of failed, approval-waiting, or escalated tasks crosses a threshold, and a Trigger status page alarms on trigger failures. Usage alerts email admins on credit and Action consumption.',
        shortValue: 'Email, Slack, or Teams alerts on failures',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/agents/build-your-agent/alerts',
            label: 'Alerts | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/changelog',
            label: 'Changelog | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      dataDrains: {
        value:
          'Yes on Enterprise: audit logs and execution traces stream in OpenTelemetry format to a customer S3 bucket; the features page also lists Delta Sharing export',
        detail:
          'Direct OpenTelemetry collector endpoints are on the roadmap. Data can also be exported manually as CSV, Excel, or JSON.',
        shortValue: 'OTEL export to S3 (Enterprise)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/enterprise/streaming-events',
            label: 'Event Streaming for Observability (OpenTelemetry) | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/admin/security',
            label: 'Security overview | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      asyncExecution: {
        value:
          'Yes: API and webhook triggers start a task and return without the result, which is delivered to a configured destination; the SDK can subscribe to task status events',
        detail:
          'When the concurrency limit is reached, additional tasks are queued until capacity frees up.',
        shortValue: 'Fire-and-forget triggers; SDK task events',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/agents/build-your-agent/agent-triggers/api-trigger',
            label: 'API Triggers | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/sdk/introduction',
            label: 'JavaScript SDK | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      executionLimits: {
        value:
          'Tools run up to 15 minutes (or 24 hours for long-running Tools), agents up to 15 minutes after each user action, and bulk runs up to 24 hours; concurrency is set by plan, with no published numbers',
        detail:
          'Uploads are capped at 100 MB and CSV uploads at 50,000 rows. The pricing table lists concurrent agent tasks as Standard on Pro, More on Team, and Custom on Enterprise.',
        shortValue: '15-minute agent steps, 24-hour bulk runs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/admin/system-limits',
            label: 'System quotas | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      partialFailureHandling: {
        value:
          'Partial: a Loop skips items that error by default, and a fallback model can retry a failed task, but an error in a branch or standard Tool step stops the Tool',
        detail: 'Legacy Sub-agent connections allowed custom error-handling instructions.',
        shortValue: 'Loops skip failed items; other step errors stop the Tool',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/tools/customize-tool/looping',
            label: 'Looping | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/build/tools/customize-tool/branching',
            label: 'Branching | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      unattendedExecution: {
        value:
          "Yes: scheduled, integration, webhook, and API triggers run agents on Relevance AI's hosted infrastructure with no client device involved",
        detail: 'The mobile and desktop apps are clients for Chat and monitoring, not runtimes.',
        shortValue: 'Runs server-side on hosted infrastructure',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/build/agents/build-your-agent/triggers',
            label: 'Triggers | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Community forum, in-app chat tickets, and email on all plans; priority support on Team; a dedicated Slack channel, account manager, and staffed calls on Enterprise',
        detail:
          'Free-to-Team customers can request calls with Harley, an AI support agent in beta, during Sydney business hours.',
        shortValue: 'Forum, chat, email; Slack and AM on Enterprise',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/get-started/support',
            label: 'How to reach out to our support team | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
      sla: {
        value:
          'Relevance AI lists a 99.9% uptime SLA on its enterprise page; the plans it covers are not stated',
        detail: 'No SLA terms or credits are published.',
        shortValue: '99.9% uptime SLA (plan not stated)',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://relevanceai.com/enterprise',
            label: 'Relevance AI Enterprise',
            asOf: '2026-11-19',
          },
        ],
      },
      community: {
        value:
          'A peer-to-peer community forum (community.relevanceai.com) with Relevance AI staff and partners, plus a partner directory',
        detail: 'Relevance AI notes the forum is primarily monitored by community members.',
        shortValue: 'Community forum and partner network',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/docs/get-started/support',
            label: 'How to reach out to our support team | Relevance AI Docs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/',
            label: 'Relevance AI homepage',
            asOf: '2026-11-19',
          },
        ],
      },
      companyMaturity: {
        value:
          'OnSearch Pty Ltd, trading as Relevance AI, with offices in Sydney and San Francisco. Raised a $24M Series B in May 2025 led by Bessemer Venture Partners, with King River Capital, Insight Partners, and Peak XV; the team was over 80 people at the time',
        detail:
          'Customers named on its site include Canva, Autodesk, Databricks, Qualified, and SafetyCulture. As a venture-backed private company, it carries more switching risk than a large public vendor.',
        shortValue: '$24M Series B (2025), Sydney and San Francisco',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/blog/the-ai-workforce-revolution-24m-series-b-to-accelerate-our-mission',
            label: 'The AI Workforce Revolution: $24M Series B | Relevance AI Blog',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/about-us',
            label: 'About us | Relevance AI',
            asOf: '2026-11-19',
          },
        ],
      },
      academy: {
        value:
          'Yes: Relevance AI Academy offers free self-paced courses, and an AI Ops Bootcamp offers certification',
        detail: 'The docs point new builders to the Academy for structured, step-by-step courses.',
        shortValue: 'Free Academy courses and AI Ops certification',
        confidence: 'verified',
        sources: [
          {
            url: 'https://relevanceai.com/',
            label: 'Relevance AI homepage (Resources menu)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://relevanceai.com/docs/build/agents/build-your-agent/triggers',
            label: 'Triggers | Relevance AI Docs',
            asOf: '2026-11-19',
          },
        ],
      },
    },
  },
}
