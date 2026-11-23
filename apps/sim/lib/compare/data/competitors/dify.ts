import { DifyIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Researched and cross-verified against live vendor sources on 2026-11-19. */
export const difyProfile: CompetitorProfile = {
  id: 'dify',
  name: 'Dify',
  website: 'https://dify.ai',
  brand: {
    icon: DifyIcon,
    selfFramed: false,
    colors: ['#0033FF', '#000000'],
    source: 'Dify logo and favicon SVGs (langgenius/dify web/public/logo, dify.ai/favicon.svg)',
    asOf: '2026-11-19',
  },
  oneLiner:
    'Dify is an LLM application platform from LangGenius for building workflows, chatflows, agents, and retrieval-augmented generation (RAG) knowledge bases in a visual editor, offered as Dify Cloud, a self-hosted Community Edition under a modified Apache 2.0 license, and a commercial Enterprise edition.',
  leadAnswer: [
    'Dify is an LLM application platform for building chat apps, workflows, agents, and retrieval-augmented generation (RAG) knowledge bases, available as Dify Cloud, a self-hosted Community Edition, and a commercial Enterprise edition. Its source is published under the ',
    {
      text: 'Dify Open Source License',
      href: 'https://github.com/langgenius/dify/blob/main/LICENSE',
    },
    ', a modified Apache 2.0 license that requires a commercial license to run a multi-tenant service or to remove the Dify logo from its frontend. Sim is the open-source AI workspace, with a standard Apache 2.0 core, for building, deploying, and managing AI agents visually, conversationally, or with code. Choose Dify when your product centers on a managed knowledge base and a large plugin marketplace. Choose Sim when you need an unmodified Apache 2.0 core, deployed agents connected to the business apps your team already uses, and published production controls such as failure alerts and execution limits on its cloud plans.',
  ],
  betterThanAnswer: [
    "Sim is the stronger fit when AI agents have to act across business systems and you want a standard Apache 2.0 core you can self-host without the multi-tenant condition that Dify's license adds. Dify is the stronger fit when the deliverable is a chat assistant or knowledge app built on a deep retrieval stack, with a large community plugin marketplace behind it. Both have visual builders, human approval steps, loops, parallel branches, and Model Context Protocol (MCP) support for connecting external tools, so the license terms and the shape of the work usually decide it.",
  ],
  sectionIntros: {
    platform: [
      'Sim and Dify both offer a visual builder, self-hosting, version history, and live co-editing. They differ on license terms, file storage and data tables, and how far environment promotion goes.',
    ],
    pricing: [
      'Sim charges per user with usage credits and lets you bring your own model keys. Dify Cloud charges per workspace with monthly message credits, and its paid plans also accept your own model keys.',
    ],
    security: [
      'Dify publishes SOC 2 and ISO 27001 badges and reserves SSO, SCIM, audit logs, and credential governance for its Enterprise edition. Sim documents SOC 2, and its Enterprise plan adds SSO, SCIM, an audit log API, and model, tool, and credential controls.',
    ],
    aiCapabilities: [
      'Both products ship agents, a knowledge base, Model Context Protocol (MCP) client and server support, human input steps, loops, and parallel branches. Dify adds sandboxed agents and a skills library, while Sim adds an evaluator block, PII masking, and agent-to-agent (A2A) support.',
    ],
    integrations: [
      "Dify extends through more than 1,000 Marketplace plugins built with its plugin SDK, plus OpenAPI imports and MCP servers. Sim's integrations are first-party blocks, extended through custom code, the REST API, and MCP.",
    ],
    observability: [
      'Both trace runs step by step, retry failed steps, route failures to an error branch, and export traces to external tools. Sim also documents failure alerts and cloud execution limits that Dify does not publish for Dify Cloud.',
    ],
    support: [
      "Both offer community channels and documentation. Dify's paid support runs from priority email on Cloud to a named customer success manager on Enterprise, while Sim offers community support plus Enterprise dedicated support.",
    ],
  },
  faqs: [
    {
      question: 'Is Dify really open source, compared to Sim?',
      answer:
        "Dify's source code is public, but its Dify Open Source License is a modified Apache 2.0 license. It requires a commercial license to use the code to operate a multi-tenant environment, where one tenant is one workspace, and forbids removing or modifying the Dify logo or copyright information in the Dify console or applications. Dify's own homepage describes the Community Edition as source-available under an Apache-2.0-derivative license. Sim's core uses the standard Apache 2.0 license, and only its enterprise features sit under a separate Sim Enterprise License.",
    },
    {
      question: 'Which is better for RAG and knowledge bases, Sim or Dify?',
      answer:
        "Dify is the more specialized choice when the knowledge base is the product. It offers classic knowledge bases with vector, full-text, and hybrid search plus reranking, customizable Knowledge Pipelines, connections to external knowledge bases, and a beta Agent Knowledge Base that organizes documents with a reasoning model. Sim's knowledge base combines vector and full-text search over 15 file types with synced connectors, and fits teams that use retrieval as one step inside a larger agent workflow that also updates other systems.",
    },
    {
      question: 'How do Sim and Dify compare on pricing?',
      answer:
        "Dify Cloud prices per workspace: Sandbox is free with 200 message credits, Professional is $59 per workspace per month ($590 per year) with 3 members and 5,000 message credits a month, and Team is $159 per workspace per month ($1,590 per year) with 50 members and 10,000 message credits a month. Sim's Pro plan is $25 per user per month with usage credits, and its Free plan includes 1,000 one-time credits. Both let you use your own model provider keys, and Dify Enterprise pricing is custom.",
    },
    {
      question: 'Can I self-host Dify or Sim for many internal teams?',
      answer:
        "Sim's core uses the standard Apache 2.0 license, which has no multi-tenant condition, and self-hosts with Docker Compose or Kubernetes; SSO and audit logs require an Enterprise license. Dify's Community Edition self-hosts with Docker Compose and is limited to a single workspace; running multiple workspaces requires Dify Enterprise, because the Dify Open Source License requires written authorization to operate a multi-tenant environment, and Enterprise adds Kubernetes deployment with high availability.",
    },
  ],
  standoutFeatures: [
    {
      title: 'A deep retrieval stack for knowledge-centered apps',
      description:
        'Classic knowledge bases offer vector, full-text, and hybrid search with optional reranking, metadata filtering, and a Retrieval Testing page that shows which chunks come back. Knowledge Pipelines let you design your own extraction and chunking steps, external knowledge bases can be searched through an API without copying content in, and a beta Agent Knowledge Base uses a reasoning model to organize documents and supports golden-question tests.',
      shortDescription:
        'Hybrid search, reranking, custom knowledge pipelines, and an agent-organized knowledge base.',
      source: {
        url: 'https://docs.dify.ai/en/cloud/use-dify/knowledge/create-knowledge/setting-indexing-methods',
        label: 'Dify Docs: Specify the Index Method and Retrieval Settings',
        asOf: '2026-11-19',
      },
    },
    {
      title: 'A large plugin Marketplace with a public plugin SDK',
      description:
        "Dify Marketplace lists more than 1,000 plugins across tools, model providers, agent strategies, extensions, data sources, and triggers, from Dify, partners, and community developers. Dify says each Marketplace plugin is reviewed and tested before publication, and anyone can build private or public plugins with Dify's plugin SDK and CLI.",
      shortDescription: 'More than 1,000 reviewed plugins, and an SDK to build your own.',
      source: {
        url: 'https://docs.dify.ai/en/cloud/use-dify/workspace/plugins',
        label: 'Dify Docs: Integrations',
        asOf: '2026-11-19',
      },
    },
    {
      title: 'Sandboxed agents built by chatting, with a shared skills library',
      description:
        "Dify's new Agent (beta) runs in its own sandbox with 20 GB of storage, where it runs commands, installs programs, and reads and writes files. You can build it by describing what it should do, give it skills in the open SKILL.md format from a workspace library of up to 500 skills, and use it as a chat app or as a step inside a workflow.",
      shortDescription:
        'Beta agents with their own sandbox, built by chatting, using shared skills.',
      source: {
        url: 'https://docs.dify.ai/en/cloud/use-dify/build/new-agent/build',
        label: 'Dify Docs: Build an Agent',
        asOf: '2026-11-19',
      },
    },
    {
      title: 'Human approvals delivered to email and team chat apps',
      description:
        'The Human Input node pauses a workflow and sends a form with custom decision buttons through the web app or email, with a configurable timeout branch. Since version 1.20.0, requests can also go to Slack, Feishu/Lark, Microsoft Teams, DingTalk, or WeCom, using a shared contact list and notification templates.',
      shortDescription: 'Approval forms by web app, email, Slack, Teams, and other chat apps.',
      source: {
        url: 'https://github.com/langgenius/dify/releases/tag/1.20.0',
        label: 'Dify v1.20.0 release notes (GitHub)',
        asOf: '2026-11-19',
      },
    },
  ],
  limitations: [
    {
      title: 'Modified Apache 2.0 license with multi-tenant and branding conditions',
      description:
        'The Dify Open Source License requires a commercial license to use the source code to operate a multi-tenant environment (one tenant equals one workspace) without written authorization, and forbids removing or modifying the Dify logo or copyright information in the Dify console or applications. Contributors must also agree that the producer can make the license more strict or more relaxed.',
      shortDescription:
        'Multi-workspace hosting and logo removal need a commercial license from Dify.',
      source: {
        url: 'https://github.com/langgenius/dify/blob/main/LICENSE',
        label: 'langgenius/dify LICENSE (GitHub)',
        asOf: '2026-11-19',
      },
    },
    {
      title: 'Self-hosted Community Edition is limited to a single workspace',
      description:
        "Dify's pricing lists the free Community Edition as a single workspace without SSO, role management, or high availability. Multiple workspaces, SSO, SCIM, audit logs, credential governance, and Kubernetes high availability require the commercial Enterprise edition, which has no published price.",
      shortDescription:
        'Community self-hosting is one workspace; SSO and multi-workspace need Enterprise.',
      source: {
        url: 'https://dify.ai/pricing/dify-enterprise',
        label: 'Dify Pricing: Self-Hosted and Enterprise plan comparison',
        asOf: '2026-11-19',
      },
    },
    {
      title: 'Code steps run on a fixed package set with tight output limits',
      description:
        "Code nodes run Python or JavaScript in Dify's sandbox with a standard set of preinstalled packages, and imports outside that set fail at run time. Outputs are capped (for example, 500 items per array and 400,000 characters per string), and the self-hosted sandbox defaults to 15 seconds per code run.",
      shortDescription:
        'Code nodes allow only preinstalled packages and cap output size and run time.',
      source: {
        url: 'https://docs.dify.ai/en/cloud/use-dify/nodes/code',
        label: 'Dify Docs: Code node',
        asOf: '2026-11-19',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'Dify builds Workflow and Chatflow apps on a shared visual node editor where most work is drag, connect, and configure, plus simpler Chatbot, Text Generator, and Agent apps configured through forms. Agents can also be built by chatting, and the difyctl CLI and OpenAPI let coding agents build and run apps from a terminal.',
        detail:
          'A Workflow runs once from input to output; a Chatflow adds a conversation layer where each message runs the flow.',
        shortValue: 'Visual node editor plus form and chat-built agents',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/build/workflow-chatflow',
            label: 'Dify Docs: Workflow & Chatflow',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/cli/overview',
            label: 'Dify Docs: difyctl overview',
            asOf: '2026-11-19',
          },
        ],
      },
      learningCurve: {
        value:
          "Low for chat apps and templates, moderate for workflows: Dify's enterprise customers describe it as accessible to beginners, and it publishes a 10-lesson Workflow 101 tutorial. Tuning retrieval settings, variables, and self-hosted deployments still requires technical knowledge.",
        shortValue: 'Low for chat apps, moderate for workflows',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dify.ai/en/learn/tutorials/workflow-101/lesson-01',
            label: 'Dify Docs: Workflow 101, Lesson 1',
            asOf: '2026-11-19',
          },
          {
            url: 'https://dify.ai/dify-enterprise',
            label: 'Dify Enterprise page (customer quotes)',
            asOf: '2026-11-19',
          },
        ],
      },
      selfHostOption: {
        value:
          'Yes: the Community Edition self-hosts with Docker Compose (2 CPU cores and 4 GiB RAM minimum) or from source, subject to the Dify Open Source License, and is limited to a single workspace. Dify Enterprise adds Kubernetes deployment with a Helm chart, high availability, and multiple workspaces.',
        shortValue: 'Yes, Docker Compose; Kubernetes via Enterprise',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/langgenius/dify',
            label: 'GitHub: langgenius/dify README (Quick start)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/self-host/deploy/overview',
            label: 'Dify Docs: Deploy Dify',
            asOf: '2026-11-19',
          },
          {
            url: 'https://dify.ai/pricing/dify-enterprise',
            label: 'Dify Pricing: Self-Hosted and Enterprise plan comparison',
            asOf: '2026-11-19',
          },
        ],
      },
      deploymentOptions: {
        value:
          'Dify Cloud (managed SaaS), the self-hosted Community Edition (Docker Compose or source), Dify Premium on AWS, and Dify Enterprise, which Dify says deploys in your own VPC, on premises, or in an air-gapped network using a Helm chart for Kubernetes and Terraform modules for AWS, GCP, and Azure.',
        shortValue: 'Cloud, Docker self-host, AWS, Enterprise VPC/air-gapped',
        confidence: 'verified',
        sources: [
          {
            url: 'https://dify.ai/dify-enterprise',
            label: 'Dify Enterprise page',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/self-host/deploy/platform-guides/dify-premium',
            label: 'Dify Docs: Dify Premium on AWS',
            asOf: '2026-11-19',
          },
          {
            url: 'https://enterprise-docs.dify.ai/en/3.13.x/deploy/advanced-configuration/dify-helm-chart',
            label: 'Dify Enterprise Docs: Dify Helm Chart',
            asOf: '2026-11-19',
          },
        ],
      },
      templates: {
        value:
          'Yes: an Explore page of scenario-based app templates is included on every plan, agents can be created from templates you can try first, and Dify Marketplace also lists community workflow templates.',
        shortValue: 'Yes, Explore templates plus Marketplace templates',
        confidence: 'verified',
        sources: [
          {
            url: 'https://dify.ai/pricing/dify-cloud',
            label: 'Dify Cloud plan comparison (Explore Page Templates)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://marketplace.dify.ai',
            label: 'Dify Marketplace',
            asOf: '2026-11-19',
          },
        ],
      },
      license: {
        value:
          'Dify Open Source License: a modified Apache 2.0 license. It permits commercial use, but a commercial license is required to use the source code to operate a multi-tenant environment (one tenant equals one workspace) without written authorization, or to remove or modify the logo or copyright information in the Dify console or applications. Dify describes the Community Edition as source-available.',
        detail:
          'The LICENSE file also says contributors agree the producer can make the license more strict or more relaxed, and that contributed code may be used commercially, including for Dify Cloud. The logo condition does not apply to uses that do not involve the web frontend.',
        shortValue: 'Modified Apache 2.0 with multi-tenant and logo conditions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/langgenius/dify/blob/main/LICENSE',
            label: 'langgenius/dify LICENSE (GitHub)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://dify.ai',
            label: 'Dify homepage (Community Edition: source-available)',
            asOf: '2026-11-19',
          },
        ],
      },
      environmentPromotion: {
        value:
          'Partial: Dify Enterprise has an Environments feature, for Kubernetes deployments only, that deploys published app versions into separate runtime environments and flags when an environment is behind the latest version. Moving apps between workspaces otherwise means exporting and importing app packages, which carry inline agents, skills, and workflow tools.',
        detail:
          'No documented workspace-level fork-and-promote flow with credential remapping across dev, QA, and prod.',
        shortValue: 'Enterprise runtime environments; package export/import',
        confidence: 'verified',
        sources: [
          {
            url: 'https://enterprise-docs.dify.ai/en/3.13.x/administer/environments',
            label: 'Dify Enterprise Docs: Environments',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/workspace/export-import-apps',
            label: 'Dify Docs: Export and Import Apps',
            asOf: '2026-11-19',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Yes: Workflow and Chatflow apps keep a working draft, the live version, and earlier published versions you can name, annotate with release notes, delete, and restore into the draft. Restoring a version, exporting a specific version, and running a specific version through the API require a paid plan.',
        detail:
          'No diff or compare view or branching is documented. The Dify Cloud plan comparison still lists App Version Control as Coming Soon for Professional and Team, alongside the documented publish history.',
        shortValue: 'Published version history with restore on paid plans',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/build/version-control',
            label: 'Dify Docs: Version Control',
            asOf: '2026-11-19',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          'Yes: workspace members with editor permissions can edit the same workflow at the same time with visible collaborator cursors, and leave in-editor comments with @mentions. When two members change the same element at once, the last edit wins.',
        detail:
          'Documented in the self-hosted docs, where it runs over a separate WebSocket service enabled by ENABLE_COLLABORATION_MODE in the bundled Docker Compose stack.',
        shortValue: 'Yes, live co-editing and comments; last edit wins',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/self-host/use-dify/build/workflow-collaboration',
            label: 'Dify Docs: Collaborate with Teammates',
            asOf: '2026-11-19',
          },
        ],
      },
      nativeFileStorage: {
        value:
          'No: Dify handles files per app, knowledge base, and agent (uploads, agent files, and a 20 GB agent sandbox), but documents no workspace file system with folders, link-based sharing, or deleted-item recovery.',
        shortValue: 'No workspace file storage with folders or sharing',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/build/new-agent/build',
            label: 'Dify Docs: Build an Agent (files and sandbox)',
            asOf: '2026-11-19',
          },
        ],
      },
      dataTables: {
        value:
          "No: Dify's documentation describes no native spreadsheet-like data table. Structured data moves between nodes as variables, and knowledge bases store documents and chunks rather than editable rows.",
        shortValue: 'No native spreadsheet-style data table',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/knowledge/readme',
            label: 'Dify Docs: Classic Knowledge Base',
            asOf: '2026-11-19',
          },
        ],
      },
      richTextEditor: {
        value:
          'Unknown: no public documentation describes an inline rich-text or WYSIWYG editor for documents stored in Dify. Skills edit text files in place, and Human Input forms render Markdown.',
        shortValue: 'Unknown, no WYSIWYG document editor documented',
        confidence: 'unknown',
        sources: [],
      },
      subWorkflows: {
        value:
          'Yes: any Workflow that starts with a User Input node can be published as a workflow tool and called from a Tool node in another app, nested up to 5 levels deep by default on self-hosted deployments, with nested steps visible in run history and traces. Snippets also save groups of nodes for reuse, inserted as independent copies.',
        shortValue: 'Yes, workflows published as tools, plus snippets',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/workspace/tools',
            label: 'Dify Docs: Dify Tools (Workflow as Tool)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/build/snippet',
            label: 'Dify Docs: Snippets',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/self-host/deploy/configuration/environments',
            label: 'Dify Docs: Environment Variables (WORKFLOW_CALL_MAX_DEPTH)',
            asOf: '2026-11-19',
          },
        ],
      },
      customBlocks: {
        value:
          'Partial: Workflow as Tool publishes a workflow as a named tool with its own inputs that every app in the workspace can add, and invited agents pick up updates when their source agent is republished. Snippets are shared workspace-wide but insert as copies that do not follow later edits.',
        detail:
          'Reuse is scoped to one workspace; no org-wide block catalog across workspaces with hidden internals and credentials is documented.',
        shortValue: 'Partial, workflows as workspace tools; snippets copy',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/workspace/tools',
            label: 'Dify Docs: Dify Tools (Workflow as Tool)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/nodes/agent',
            label: 'Dify Docs: Agent node (Invite an Agent)',
            asOf: '2026-11-19',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Dify supports hundreds of proprietary and open-source models from dozens of inference providers and self-hosted options, including any OpenAI API-compatible model, installed as model provider plugins (192 listed in the Marketplace). Dify Cloud also includes message credits for models from OpenAI, Anthropic, Gemini, xAI, and Tongyi.',
        shortValue: 'Hundreds of models via provider plugins, incl. local',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/langgenius/dify',
            label: 'GitHub: langgenius/dify README (Comprehensive model support)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/workspace/model-providers',
            label: 'Dify Docs: Model Providers',
            asOf: '2026-11-19',
          },
          {
            url: 'https://marketplace.dify.ai',
            label: 'Dify Marketplace (model plugins)',
            asOf: '2026-11-19',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          'Yes: the classic Agent node lets a model choose and call configured tools with Function Calling or ReAct strategies (more strategies install from the Marketplace), and the beta new Agent node runs a sandboxed agent as a workflow step that can pick its own output route. LLM, Question Classifier, and Parameter Extractor nodes cover single model calls.',
        shortValue: 'Classic and sandboxed Agent nodes, plus LLM nodes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/nodes/agent',
            label: 'Dify Docs: Agent node',
            asOf: '2026-11-19',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          'Partial: the new Agent (beta) can be built by chatting, where it writes its own prompt, skills, files, and environment variables, and a Skill Builder drafts skills from a description. Workflow and Chatflow graphs are built in the visual editor, or by a coding agent through the difyctl CLI.',
        shortValue: 'Agents and skills built by chatting; workflows visual',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/build/new-agent/build',
            label: 'Dify Docs: Build an Agent (Build by Chatting)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/self-host/use-dify/build/skills',
            label: 'Dify Docs: Skills (Skill Builder)',
            asOf: '2026-11-19',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          'Yes: classic knowledge bases import files, Notion, and websites, with configurable chunking, High Quality (vector, full-text, or hybrid search with optional reranking) or Economical indexing, metadata filtering, custom Knowledge Pipelines, and connections to external knowledge bases. A beta Agent Knowledge Base uses a reasoning model to organize documents and can search more deeply on request.',
        detail:
          'Dify Cloud caps knowledge documents and storage per plan, from 50 documents and 50 MB on Sandbox to 1,000 documents and 20 GB on Team.',
        shortValue: 'Yes, hybrid search, reranking, custom pipelines',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/knowledge/create-knowledge/setting-indexing-methods',
            label: 'Dify Docs: Specify the Index Method and Retrieval Settings',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/knowledge-base/overview',
            label: 'Dify Docs: Agent Knowledge Base',
            asOf: '2026-11-19',
          },
          {
            url: 'https://dify.ai/pricing',
            label: 'Dify Pricing',
            asOf: '2026-11-19',
          },
        ],
      },
      mcpSupport: {
        value:
          'Yes: Dify connects to external Model Context Protocol (MCP) servers over HTTP transport and imports their tools for workflows and agents, with OAuth dynamic client registration and custom headers. Any Dify app can also be exposed as an MCP server.',
        detail: 'Only MCP servers with HTTP transport are supported as clients.',
        shortValue: 'Both MCP client (HTTP only) and MCP server',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/workspace/tools',
            label: 'Dify Docs: Dify Tools (MCP)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/publish/publish-mcp',
            label: 'Dify Docs: MCP Server',
            asOf: '2026-11-19',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'Partial: chat apps can filter inputs and outputs with OpenAI Moderation, a keyword list, or a custom moderation endpoint, and Agent Knowledge Bases save golden questions that must keep passing after changes. No general-purpose evaluator or scoring node for workflow outputs is documented.',
        shortValue: 'Content moderation and retrieval tests; no evaluator node',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/build/additional-features',
            label: 'Dify Docs: App Toolkit (Content Moderation)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/knowledge-base/overview',
            label: 'Dify Docs: Agent Knowledge Base',
            asOf: '2026-11-19',
          },
        ],
      },
      humanInTheLoop: {
        value:
          'Yes: the Human Input node pauses a workflow and delivers a Markdown form with input fields and decision buttons through the web app or email, routes each button to its own branch, and follows a timeout branch after a configurable wait (3 days by default). Since 1.20.0, requests can also go to Slack, Feishu/Lark, Microsoft Teams, DingTalk, or WeCom, and since 1.17.0 the node works inside loops and iterations.',
        shortValue: 'Human Input node via web app, email, Slack, Teams',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/nodes/human-input',
            label: 'Dify Docs: Human Input node',
            asOf: '2026-11-19',
          },
          {
            url: 'https://github.com/langgenius/dify/releases/tag/1.20.0',
            label: 'Dify v1.20.0 release notes (GitHub)',
            asOf: '2026-11-19',
          },
        ],
      },
      generativeMedia: {
        value:
          "Partial: text-to-speech and speech-to-text run on the workspace default speech models, and LLM nodes accept images for vision models. Image generation comes from Marketplace tool plugins rather than a built-in node, as in Dify's own image generation tutorial.",
        shortValue: 'Speech built in; image generation via plugins',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/build/additional-features',
            label: 'Dify Docs: App Toolkit (Text to Speech, Speech to Text)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/learn/tutorials/build-ai-image-generation-app',
            label: 'Dify Docs: AI Image Generation App tutorial',
            asOf: '2026-11-19',
          },
        ],
      },
      dynamicToolUse: {
        value:
          'Partial: classic Agent nodes choose only among tools configured at build time. The beta new Agent can also install and run command-line tools inside its sandbox when a task needs one, though anything installed during a published run is temporary.',
        shortValue: 'Pre-wired tools; sandboxed agents can install CLIs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/build/new-agent/build',
            label: 'Dify Docs: Build an Agent (Tools)',
            asOf: '2026-11-19',
          },
        ],
      },
      modelFallback: {
        value:
          'Partial: LLM nodes retry failed calls with configurable attempts, intervals, and backoff, and a fail branch can route to a node using another model. Load balancing (Professional and Team) rotates API keys for the same model and rests a rate-limited key for a minute; no automatic switch to a different provider is documented.',
        shortValue: 'Retries and key rotation; manual fallback via fail branch',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/nodes/llm',
            label: 'Dify Docs: LLM node (Error Handling)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/workspace/model-providers',
            label: 'Dify Docs: Model Providers (Load Balancing)',
            asOf: '2026-11-19',
          },
        ],
      },
      agentSkills: {
        value:
          'Yes: a workspace Skills library holds up to 500 skills in the open SKILL.md format, each with instructions plus supporting scripts and files, with draft, publish, and version history. Publishing an update propagates to every agent that uses the skill.',
        shortValue: 'Workspace library of SKILL.md skills, up to 500',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/self-host/use-dify/build/skills',
            label: 'Dify Docs: Skills',
            asOf: '2026-11-19',
          },
        ],
      },
      nativeChatDeployment: {
        value:
          'Yes: every published app gets a public web app link, and chat apps can be embedded on any website as a chat widget or iframe. Paid plans can restrict access with IP access control.',
        shortValue: 'Yes, public web app plus embeddable chat widget',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/publish/README',
            label: 'Dify Docs: Publish overview',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/publish/webapp/embedding-in-websites',
            label: 'Dify Docs: Embed Your Web App',
            asOf: '2026-11-19',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          "Yes: the Retrieval Testing page shows which chunks a query returns and logs retrievals from linked apps, and chunks can be added, edited, or disabled. In an agent's build chat, each knowledge lookup shows the passages it returned.",
        shortValue: 'Yes, retrieval testing shows returned chunks',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/knowledge/test-retrieval',
            label: 'Dify Docs: Test Knowledge Retrieval',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/build/new-agent/build',
            label: 'Dify Docs: Build an Agent (Check What the Agent Found)',
            asOf: '2026-11-19',
          },
        ],
      },
      parallelExecution: {
        value:
          'Yes: nodes can run in parallel branches whose results converge on a downstream node, and Iteration nodes can process up to 10 items at once in parallel mode. Self-hosted deployments default to 10 parallel branches per workflow.',
        shortValue: 'Yes, parallel branches and parallel iteration',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/build/orchestrate-node',
            label: 'Dify Docs: Orchestration Logic',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/nodes/iteration',
            label: 'Dify Docs: Iteration node',
            asOf: '2026-11-19',
          },
        ],
      },
      a2aProtocol: {
        value:
          'No: Dify core does not ship Agent2Agent (A2A) protocol support, and the GitHub feature request was closed as not planned in March 2026. Community Marketplace plugins offer an A2A server and client.',
        shortValue: 'No native A2A; community plugins only',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/langgenius/dify/issues/19352',
            label: 'GitHub langgenius/dify Issue #19352: Support for the A2A protocol',
            asOf: '2026-11-19',
          },
        ],
      },
      loopIteration: {
        value:
          'Yes: an Iteration node runs a sub-flow over each item in an array, sequentially or in parallel, with per-item error handling, and a Loop node repeats steps with persistent loop variables until a condition, a maximum count (100 by default on self-hosted deployments), or an Exit Loop node.',
        shortValue: 'Yes, Iteration (for-each) and Loop (while) nodes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/nodes/iteration',
            label: 'Dify Docs: Iteration node',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/nodes/loop',
            label: 'Dify Docs: Loop node',
            asOf: '2026-11-19',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value:
          'More than 1,000 plugins in Dify Marketplace, including roughly 945 tool plugins, 192 model provider plugins, and smaller sets of extensions and agent strategies, from Dify, partners, and community developers. Any OpenAPI service or HTTP MCP server can also be added as a tool.',
        detail: 'Counts read from the Marketplace search on 2026-11-19 and change frequently.',
        shortValue: '1,000+ Marketplace plugins, plus OpenAPI and MCP',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://marketplace.dify.ai',
            label: 'Dify Marketplace',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/workspace/tools',
            label: 'Dify Docs: Dify Tools',
            asOf: '2026-11-19',
          },
        ],
      },
      triggerTypes: {
        value:
          'Workflow apps can start from a schedule trigger, a webhook trigger, or an integration trigger that subscribes to events from a plugin such as GitHub or Slack, as well as from the web app or API. Sandbox allows 2 triggers per workflow and 3,000 trigger events, Professional 20,000 events a month, and Team unlimited.',
        shortValue: 'Schedule, webhook, integration events, API, web app',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/nodes/trigger/overview',
            label: 'Dify Docs: Trigger',
            asOf: '2026-11-19',
          },
          {
            url: 'https://dify.ai/pricing',
            label: 'Dify Pricing (trigger events)',
            asOf: '2026-11-19',
          },
        ],
      },
      customCodeSteps: {
        value:
          'Yes: Code nodes run Python or JavaScript in a sandbox that blocks file system access and system commands, with up to 10 automatic retries and a fail branch, and HTTP Request and Template nodes cover API calls and Jinja2 formatting.',
        shortValue: 'Yes, Python and JavaScript Code nodes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/nodes/code',
            label: 'Dify Docs: Code node',
            asOf: '2026-11-19',
          },
        ],
      },
      codeSandboxRuntime: {
        value:
          'Partial: Code nodes can import only a standard set of preinstalled packages, and imports outside it fail at run time. Self-hosted operators run the dify-sandbox service themselves and control its image and limits, and the beta new Agent can install programs inside its own sandbox.',
        detail:
          'The self-hosted sandbox defaults to a 15-second limit per code run and routes outbound HTTP through an SSRF proxy.',
        shortValue: 'Fixed package set; self-hosters control the sandbox',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/nodes/code',
            label: 'Dify Docs: Code node (Dependencies Support)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/self-host/deploy/configuration/environments',
            label: 'Dify Docs: Environment Variables (Sandbox Service)',
            asOf: '2026-11-19',
          },
        ],
      },
      apiPublishing: {
        value:
          "Yes: every published app has a Service API endpoint, in blocking or streaming mode, plus endpoints to run a specific version, stop a run, resume a run's event stream, and list run logs. Dify publishes an OpenAPI spec for the Service API.",
        shortValue: 'Yes, Service API with OpenAPI spec',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/api-reference/guides/workflow',
            label: 'Dify Docs: Workflow App API',
            asOf: '2026-11-19',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Yes: a plugin SDK and CLI build tool, model, agent strategy, data source, trigger, and endpoint plugins, which can stay private or be published to Dify Marketplace. The repository also includes Node.js and PHP client SDKs, and the difyctl CLI manages apps from a terminal.',
        shortValue: 'Plugin SDK, Marketplace, Node.js/PHP SDKs, CLI',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/develop-plugin/getting-started/getting-started-dify-plugin',
            label: 'Dify Docs: Dify Plugin',
            asOf: '2026-11-19',
          },
          {
            url: 'https://github.com/langgenius/dify/tree/main/sdks',
            label: 'GitHub: langgenius/dify sdks directory',
            asOf: '2026-11-19',
          },
        ],
      },
      mcpPublishing: {
        value:
          "Yes: each app's Access Point tab has an MCP Server toggle that generates a unique server URL, so clients such as Claude Desktop and Cursor can call the app as a tool. The URL contains credentials and can be regenerated.",
        shortValue: 'Yes, any app can be exposed as an MCP server',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/publish/publish-mcp',
            label: 'Dify Docs: MCP Server',
            asOf: '2026-11-19',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Per-workspace subscription on Dify Cloud with monthly message credits for built-in models, plus app, member, knowledge, and trigger quotas per plan. The self-hosted Community Edition is free under the Dify Open Source License, and Enterprise is custom-priced.',
        shortValue: 'Per-workspace plans with message credits',
        confidence: 'verified',
        sources: [
          {
            url: 'https://dify.ai/pricing',
            label: 'Dify Pricing',
            asOf: '2026-11-19',
          },
        ],
      },
      entryPaidPlan: {
        value:
          'Professional: $59 per workspace per month, or $590 per year, with 3 team members, 50 apps, 5,000 message credits a month, 500 knowledge documents, and 5 GB of knowledge storage. Team is $159 per workspace per month ($1,590 per year) with 50 members.',
        shortValue: 'Professional at $59/workspace/month',
        confidence: 'verified',
        sources: [
          {
            url: 'https://dify.ai/pricing',
            label: 'Dify Pricing',
            asOf: '2026-11-19',
          },
          {
            url: 'https://dify.ai/pricing/dify-cloud',
            label: 'Dify Cloud plan comparison',
            asOf: '2026-11-19',
          },
        ],
      },
      freeTier: {
        value:
          'Yes: the Sandbox plan is free with 200 message credits, 1 member, 5 apps, 50 knowledge documents, 50 MB of knowledge storage, 3,000 trigger events, and 30 days of log history. The self-hosted Community Edition is also free.',
        shortValue: 'Sandbox plan: 200 credits, 5 apps, 1 member',
        confidence: 'verified',
        sources: [
          {
            url: 'https://dify.ai/pricing',
            label: 'Dify Pricing',
            asOf: '2026-11-19',
          },
        ],
      },
      byok: {
        value:
          'Yes: owners and admins add their own provider API keys, billed by the provider, alongside or instead of message credits, and can set credits to be spent first. Some models can only be used with your own key, and load balancing across several keys requires Professional or Team.',
        shortValue: 'Yes, provider keys alongside message credits',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/workspace/model-providers',
            label: 'Dify Docs: Model Providers',
            asOf: '2026-11-19',
          },
        ],
      },
    },
    security: {
      soc2: {
        value:
          "Yes: Dify's site footer shows a SOC 2 badge and its homepage lists SOC 2 Type II for Dify Enterprise. The Dify Cloud plan comparison offers a SOC 2 Type II report on the Team plan, though the Vanta-hosted Trust Center's description still refers to a SOC 2 Type 1 report available to paid customers by email.",
        shortValue: 'SOC 2 Type II report (Team and Enterprise)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://dify.ai',
            label: 'Dify homepage (Dify Enterprise: SOC 2 Type II + ISO 27001)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://dify.ai/pricing/dify-cloud',
            label: 'Dify Cloud plan comparison (SOC Type II Report)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://security.dify.ai',
            label: 'Dify Trust Center',
            asOf: '2026-11-19',
          },
        ],
      },
      dataResidency: {
        value:
          'Via self-hosting or Enterprise: Dify Enterprise deploys inside your own VPC, region, on premises, or air-gapped. Dify Cloud stores data in its managed cloud region, and its privacy policy says website servers are in the United States; no customer-selectable Cloud region is documented.',
        shortValue: 'Self-host or Enterprise VPC; no Cloud region choice',
        confidence: 'verified',
        sources: [
          {
            url: 'https://dify.ai/dify-enterprise',
            label: 'Dify Enterprise page (Data residency)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://dify.ai/pricing/dify-cloud',
            label: 'Dify Cloud FAQ (Where is my data stored?)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://dify.ai/legal/privacy-policy',
            label: 'Dify Privacy Policy (Data Transfers)',
            asOf: '2026-11-19',
          },
        ],
      },
      rbac: {
        value:
          'Yes: workspaces have four built-in roles (Owner, Admin, Editor, Normal), and each knowledge base has its own access settings. Dify Enterprise adds custom workspace roles and permission templates, and Dify describes its Enterprise RBAC as fine-grained down to the workflow level.',
        detail:
          'Dify Cloud has role management on Professional and Team; the plan comparison does not list it for the free Community Edition.',
        shortValue: 'Four workspace roles; custom roles on Enterprise',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/workspace/team-members-management',
            label: 'Dify Docs: Manage Members',
            asOf: '2026-11-19',
          },
          {
            url: 'https://enterprise-docs.dify.ai/en/3.13.x/administer/admin-console-rbac-help',
            label: 'Dify Enterprise Docs: Configure Permission Templates',
            asOf: '2026-11-19',
          },
        ],
      },
      auditLogging: {
        value:
          'Enterprise only: the Admin Dashboard audit log records operator, IP address, operation, and resource for actions such as logins, app publishing, DSL import and export, and permission changes, with 90 days of online search and CSV download for older logs. Dify describes the log as tamper-evident and streamable to a SIEM.',
        detail:
          'Professional and Team admins can view operation logs of individual workspace members.',
        shortValue: 'Enterprise audit log with CSV export',
        confidence: 'verified',
        sources: [
          {
            url: 'https://enterprise-docs.dify.ai/en/3.13.x/administer/audit-log',
            label: 'Dify Enterprise Docs: Audit Log',
            asOf: '2026-11-19',
          },
          {
            url: 'https://dify.ai/dify-enterprise',
            label: 'Dify Enterprise page (Audit & observability)',
            asOf: '2026-11-19',
          },
        ],
      },
      additionalCompliance: {
        value:
          'Dify lists ISO 27001 certification and GDPR alongside SOC 2 in its site footer and homepage, publishes a Data Protection Agreement, and offers penetration test reports to paid customers through its Trust Center. No HIPAA, PCI, or FedRAMP attestation is published.',
        shortValue: 'ISO 27001, GDPR, and SOC 2; no HIPAA published',
        confidence: 'verified',
        sources: [
          {
            url: 'https://dify.ai',
            label: 'Dify homepage (compliance badges)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://security.dify.ai',
            label: 'Dify Trust Center',
            asOf: '2026-11-19',
          },
        ],
      },
      modelAndToolGovernance: {
        value:
          'Partial: owners and admins decide who may install and debug plugins, and Dify Enterprise can limit installs to official or official-plus-partner plugins, Marketplace sources only, or signed packages, and push a plugin version to every workspace. No per-role allow or deny list for specific models or tools is documented.',
        shortValue: 'Plugin install policies; no per-role model allow-lists',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://enterprise-docs.dify.ai/en/3.13.x/administer/plugins-management',
            label: 'Dify Enterprise Docs: Plugin installation strategy',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/workspace/plugins',
            label: 'Dify Docs: Integrations (Permissions and Updates)',
            asOf: '2026-11-19',
          },
        ],
      },
      credentialGovernance: {
        value:
          'Yes, on Enterprise: administrators create global model and tool plugin credentials, assign them to specific workspaces, and set credential policies that allow or forbid workspaces from creating their own credentials for a plugin. In Community and Cloud workspaces, only owners and admins manage model provider keys.',
        shortValue: 'Enterprise global credentials and credential policies',
        confidence: 'verified',
        sources: [
          {
            url: 'https://enterprise-docs.dify.ai/en/3.13.x/administer/credential-management',
            label: 'Dify Enterprise Docs: Credential Management',
            asOf: '2026-11-19',
          },
        ],
      },
      dataRetention: {
        value:
          'Partial: Dify Cloud keeps logs for 30 days on Sandbox; on Professional and Team, conversation logs last for the subscription and workflow run logs older than about three months move to downloadable monthly CSV archives. Self-hosted deployments can turn on automatic workflow log cleanup with a configurable retention period (30 days by default).',
        shortValue: 'Fixed Cloud retention; configurable when self-hosted',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/monitor/logs',
            label: 'Dify Docs: Logs (Log Retention)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/self-host/deploy/configuration/environments',
            label: 'Dify Docs: Environment Variables (Workflow Log Cleanup)',
            asOf: '2026-11-19',
          },
        ],
      },
      piiRedaction: {
        value:
          'Partial: Dify Enterprise advertises PII-redacted prompt history, and Enterprise telemetry export replaces input and output content with reference IDs by default. Cloud and Community apps rely on content moderation (OpenAI Moderation, keywords, or a custom endpoint) rather than a documented PII detection feature.',
        shortValue: 'Enterprise PII-redacted history; moderation elsewhere',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://dify.ai/dify-enterprise',
            label: 'Dify Enterprise page (Audit & observability)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://enterprise-docs.dify.ai/en/3.13.x/administer/data-push',
            label: 'Dify Enterprise Docs: Push Telemetry (Control Input/Output Content)',
            asOf: '2026-11-19',
          },
        ],
      },
      sso: {
        value:
          'Enterprise only: SSO through SAML, OIDC, or OAuth2 for workspace members, internal web app users, and external web app users, with SCIM 2.0 member sync from providers such as Okta and Microsoft Entra ID. SAML and OIDC SSO are not offered on Dify Cloud or the Community Edition.',
        shortValue: 'SAML/OIDC/OAuth2 SSO and SCIM on Enterprise',
        confidence: 'verified',
        sources: [
          {
            url: 'https://enterprise-docs.dify.ai/en/3.13.x/administer/sso/introduction',
            label: 'Dify Enterprise Docs: SSO Authentication Introduction',
            asOf: '2026-11-19',
          },
          {
            url: 'https://enterprise-docs.dify.ai/en/3.13.x/administer/members/synchronization/sync-team-members',
            label: 'Dify Enterprise Docs: Sync Members (SCIM)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://dify.ai/pricing/dify-enterprise',
            label: 'Dify Pricing: Self-Hosted and Enterprise plan comparison',
            asOf: '2026-11-19',
          },
        ],
      },
      sessionPolicy: {
        value:
          'Partial: self-hosted operators set access-token lifetime (60 minutes by default) and how long a user stays signed in without visiting (30 days by default) through environment variables. Dify lists session policies among Enterprise identity features, but no admin console setting for them is documented publicly.',
        shortValue: 'Self-hosted token env variables; Enterprise claims policies',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dify.ai/en/self-host/deploy/configuration/environments',
            label: 'Dify Docs: Environment Variables (Token & Request Limits)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://dify.ai/dify-enterprise',
            label: 'Dify Enterprise page (Identity & access)',
            asOf: '2026-11-19',
          },
        ],
      },
      thirdPartyVetting: {
        value:
          'Partial: Dify says Marketplace plugins from Dify, partners, and community developers are reviewed, tested, and signed before publication, then maintained by their publishers. By default, workspaces can also install plugins from any public GitHub repository or a local package; only Dify Enterprise can restrict installs to official, partner, Marketplace, or signed plugins.',
        detail:
          "Sim's integrations are all first-party blocks reviewed through Sim's own pull-request process, with no third-party marketplace of installable code.",
        shortValue: 'Reviewed Marketplace, but GitHub and local installs allowed',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/workspace/plugins',
            label: 'Dify Docs: Integrations (Install Integrations)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://enterprise-docs.dify.ai/en/3.13.x/administer/plugins-management',
            label: 'Dify Enterprise Docs: Plugin installation strategy',
            asOf: '2026-11-19',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Yes: each workflow run shows inputs, outputs, status, token totals, and a node-by-node trace, including drill-down into nested workflow tools, and each chat answer shows its token spend, latency, and raw prompt. Traces export to LangSmith, Langfuse, Opik, W&B Weave, Arize, Phoenix, Alibaba Cloud Monitor, or, since 1.20.0, any OpenTelemetry collector.',
        shortValue: 'Node-level run traces, exportable to LLM tracing tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/monitor/logs',
            label: 'Dify Docs: Logs',
            asOf: '2026-11-19',
          },
          {
            url: 'https://github.com/langgenius/dify/releases/tag/1.20.0',
            label: 'Dify v1.20.0 release notes (GitHub)',
            asOf: '2026-11-19',
          },
        ],
      },
      durabilityModel: {
        value:
          'Partial: LLM, HTTP Request, and Code nodes retry failed attempts automatically (HTTP and Code up to 10 times), Human Input pauses persist until a response or timeout, and a past run can be re-run in the editor with its original inputs through Test With Params. No checkpoint-and-resume of a failed run from the failing step is documented.',
        shortValue: 'Node retries, persisted pauses, re-run with inputs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/nodes/code',
            label: 'Dify Docs: Code node (Error Handling and Retries)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/monitor/logs',
            label: 'Dify Docs: Logs (Inspect a Run)',
            asOf: '2026-11-19',
          },
        ],
      },
      failureAlerting: {
        value:
          "Unknown: Dify's documentation describes no built-in notification when a run fails or crosses a cost or latency threshold. Builders can wire a fail branch to send a notification, and Enterprise customers can set alerts on the telemetry they export to their own collector.",
        shortValue: 'No built-in failure alerts documented',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/build/predefined-error-handling-logic',
            label: 'Dify Docs: Handle Errors',
            asOf: '2026-11-19',
          },
        ],
      },
      dataDrains: {
        value:
          'Yes: apps continuously export traces to LLM observability tools or any OpenTelemetry collector, and Dify Enterprise Data Push streams metrics and traces over OTLP to your own collector. Workflow run logs older than about three months are also available as monthly CSV archives on paid Cloud plans.',
        shortValue: 'Trace export to OTel and LLM tools; Enterprise OTLP push',
        confidence: 'verified',
        sources: [
          {
            url: 'https://enterprise-docs.dify.ai/en/3.13.x/administer/data-push',
            label: 'Dify Enterprise Docs: Push Telemetry to Your Observability Stack',
            asOf: '2026-11-19',
          },
          {
            url: 'https://github.com/langgenius/dify/releases/tag/1.20.0',
            label: 'Dify v1.20.0 release notes (GitHub)',
            asOf: '2026-11-19',
          },
        ],
      },
      asyncExecution: {
        value:
          'Partial: webhook triggers return 200 OK once the workflow is triggered, and an API run returns a workflow run ID whose status and outputs can be fetched later or whose event stream can be resumed. The Run Workflow API itself offers streaming or blocking modes rather than a fire-and-forget mode.',
        shortValue: 'Webhook triggers plus run-status lookup and stream resume',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/api-reference/guides/workflow',
            label: 'Dify Docs: Workflow App API',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/nodes/trigger/webhook-trigger',
            label: 'Dify Docs: Webhook Trigger',
            asOf: '2026-11-19',
          },
        ],
      },
      executionLimits: {
        value:
          'Self-hosted defaults: 1 hour per workflow run, 500 node executions per run, 10 parallel branches, 100 loop iterations, and 15 seconds per code run, all configurable; a single execution path holds up to 50 nodes. New Agent runs stop after 1 hour or 500 model requests. Dify Cloud does not publish per-run time or concurrency limits beyond plan quotas and queue priority.',
        shortValue: '1 hour and 500 steps per run by default (self-hosted)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/self-host/deploy/configuration/environments',
            label: 'Dify Docs: Environment Variables (Workflow Runtime)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/build/new-agent/build',
            label: 'Dify Docs: Build an Agent (Run Limits)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/build/orchestrate-node',
            label: 'Dify Docs: Orchestration Logic',
            asOf: '2026-11-19',
          },
        ],
      },
      partialFailureHandling: {
        value:
          'Yes: LLM, HTTP, Code, and Tool nodes can substitute a default value or follow a fail branch with error type and message variables, and Iteration nodes can skip or drop failed items. Loop nodes always stop when a child node fails.',
        shortValue: 'Yes, fail branches and default values per node',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/build/predefined-error-handling-logic',
            label: 'Dify Docs: Handle Errors',
            asOf: '2026-11-19',
          },
        ],
      },
      unattendedExecution: {
        value:
          'Yes: schedule, webhook, and integration triggers run workflows on the Dify server, on Dify Cloud or a self-hosted deployment, with no dependency on a client device staying open. A published trigger can be paused from the Access Point tab.',
        shortValue: 'Yes, runs server-side on Cloud or self-hosted',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/nodes/trigger/overview',
            label: 'Dify Docs: Trigger',
            asOf: '2026-11-19',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Sandbox and Community users get documentation, GitHub Discussions and Issues, and Discord; Professional and Team add priority email support. Dify Enterprise includes standard technical support with paid one-on-one support, and Dify lists a named customer success manager, a Slack Connect channel, and 24/7 support for Enterprise.',
        shortValue: 'Community, priority email, Enterprise CSM and 24/7',
        confidence: 'verified',
        sources: [
          {
            url: 'https://dify.ai/pricing/dify-cloud',
            label: 'Dify Cloud plan comparison (Support)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://dify.ai/dify-enterprise',
            label: 'Dify Enterprise page (Enterprise Support Agreements)',
            asOf: '2026-11-19',
          },
        ],
      },
      sla: {
        value:
          "Enterprise only: Dify's Enterprise page lists a 1-hour response on Sev-1 issues, and the Enterprise plan comparison lists negotiated SLAs delivered by Dify partners. No SLA is published for Dify Cloud plans.",
        shortValue: 'Enterprise: 1-hour Sev-1 response, negotiated SLAs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://dify.ai/dify-enterprise',
            label: 'Dify Enterprise page (Enterprise Support Agreements)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://dify.ai/pricing/dify-enterprise',
            label: 'Dify Pricing: Self-Hosted and Enterprise plan comparison',
            asOf: '2026-11-19',
          },
        ],
      },
      community: {
        value:
          "Dify's GitHub repository has about 161,500 stars and 25,500 forks, with active GitHub Discussions, a Discord server, and a subreddit. Dify says it runs on more than 1.4 million machines.",
        shortValue: 'About 161,500 GitHub stars, 25,500 forks',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/langgenius/dify',
            label: 'GitHub: langgenius/dify',
            asOf: '2026-11-19',
          },
          {
            url: 'https://dify.ai/about-us',
            label: 'Dify About Us',
            asOf: '2026-11-19',
          },
        ],
      },
      companyMaturity: {
        value:
          'Dify is built by LangGenius, Inc.; its public repository dates to April 2023. LangGenius reports a $30M Series Pre-A round in 2026 at a $180M valuation led by HSG, more than 280 enterprise customers, and a Niche Player placement in the 2026 Gartner Magic Quadrant for AI Agent Management Platforms.',
        shortValue: 'Since 2023; $30M Pre-A in 2026, 280+ enterprise customers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://dify.ai/about-us',
            label: 'Dify About Us',
            asOf: '2026-11-19',
          },
          {
            url: 'https://dify.ai/pricing',
            label: 'Dify Pricing (Gartner Magic Quadrant banner)',
            asOf: '2026-11-19',
          },
          {
            url: 'https://github.com/langgenius/dify',
            label: 'GitHub: langgenius/dify',
            asOf: '2026-11-19',
          },
        ],
      },
      academy: {
        value:
          'Partial: the docs include a 10-lesson Workflow 101 course and step-by-step tutorials such as a knowledge base support bot and an image generation app. No certification program is documented, and Dify for Education gives verified students and teachers a free year of the Professional plan.',
        shortValue: 'Workflow 101 course and tutorials; no certification',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.dify.ai/en/learn/tutorials/workflow-101/lesson-01',
            label: 'Dify Docs: Workflow 101, Lesson 1',
            asOf: '2026-11-19',
          },
          {
            url: 'https://docs.dify.ai/en/cloud/use-dify/workspace/subscription-management',
            label: 'Dify Docs: Billing (Dify for Education)',
            asOf: '2026-11-19',
          },
        ],
      },
    },
  },
}
