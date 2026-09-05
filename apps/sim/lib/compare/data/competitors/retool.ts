import { RetoolIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Reviewed against live primary sources on 2026-09-04; unverified capabilities are labeled. */
export const retoolProfile: CompetitorProfile = {
  id: 'retool',
  name: 'Retool',
  website: 'https://retool.com',
  brand: {
    colors: ['#242424', '#818479', '#e8e9dc'],
    description:
      'Retool is a low‑code platform that lets enterprises build, deploy, and manage internal tools and AI‑powered applications. Users describe desired functionality or import existing React, Replit, or GitHub code, and Retool generates production‑ready apps with built‑in enterprise security, access controls, and audit logging. The platform connects directly to any database, API, or LLM, leveraging existing permissions for data access. Features include a prompt‑driven app builder, MCP server for AI coding agents, and import tools for legacy codebases. Retool’s governance framework lets business teams move fast while IT retains visibility, and the product is used by finance, manufacturing, logistics, and other data‑intensive organizations.',
    industries: ['Software (B2B)', 'Developer Tools & APIs'],
    socials: [
      {
        type: 'x',
        url: 'https://x.com/retool',
      },
      {
        type: 'reddit',
        url: 'https://reddit.com/r/retool',
      },
      {
        type: 'linkedin',
        url: 'https://linkedin.com/company/tryretool',
      },
      {
        type: 'youtube',
        url: 'https://youtube.com/retool',
      },
    ],
    source: 'Context.dev brand-intelligence API',
    asOf: '2026-07-02',
    icon: RetoolIcon,
  },
  oneLiner:
    'Retool builds internal apps, workflows, and AI agents, combining a React/TypeScript app builder with data connections, deployment controls, and enterprise governance.',
  standoutFeatures: [
    {
      title: 'React apps with an AI builder',
      description:
        'Generate apps from prompts, inspect and edit their React frontend and TypeScript backend, or import existing React projects. Retool applies configured resource permissions and deployment controls. Classic apps remain a separate supported experience.',
      shortDescription: 'Generate or import React apps with governed data access.',
      source: {
        url: 'https://retool.com/blog/retool-launches-react-ai-app-builder',
        label: 'Retool launches a full-stack React AI app builder | Retool Blog',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Managed vector retrieval',
      description:
        'Retool Vectors chunks document and website text for retrieval. Builders choose an OpenAI embedding model when creating a vector; that model cannot be changed for an existing vector.',
      shortDescription: 'Managed retrieval with selectable OpenAI embedding models.',
      source: {
        url: 'https://docs.retool.com/data-sources/guides/vectors/embeddings',
        label: 'Manage embeddings in Retool-managed Vectors — Retool Docs',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Agent evaluations',
      description:
        'Retool Agents includes datasets, test cases, programmatic reviewers, LLM judges, and side-by-side evaluation comparisons for tool choices and final answers.',
      shortDescription: 'Test agent tool choices and answers against datasets.',
      source: {
        url: 'https://docs.retool.com/agents/concepts/evals',
        label: 'Evals in Retool Agents — Retool Docs',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'MCP for tools and app administration',
      description:
        'Retool connects agents to remote MCP tools and exposes an organization MCP server for app building and administration.',
      shortDescription: 'Remote MCP tools and organization MCP administration.',
      source: {
        url: 'https://docs.retool.com/org-users/guides/mcp',
        label: "Use Retool's MCP server — Retool Docs",
        asOf: '2026-09-04',
      },
    },
  ],
  limitations: [
    {
      title: 'Production self-hosting requires Kubernetes',
      description:
        'The Docker Compose tutorial is explicitly for non-production testing. Retool directs production deployments to its Kubernetes tutorials and Terraform blueprints.',
      shortDescription: 'Docker Compose is for testing; production uses Kubernetes.',
      source: {
        url: 'https://docs.retool.com/self-hosted/self-managed/tutorials/docker',
        label: 'Deploy self-hosted Retool with Docker — Retool Docs',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Several governance features require Enterprise',
      description:
        'The current plan matrix places source control, SAML/OIDC SSO, AI BYOK, and full white-labeling on Enterprise. Business includes audit logging and custom branding.',
      shortDescription: 'Source control, SSO, and AI BYOK require Enterprise.',
      source: {
        url: 'https://retool.com/pricing',
        label: 'Pricing | Retool',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Agent runtime has separate billing',
      description:
        'Agent usage is billed by runtime and model, separately from the AI credit pool for app building and AI actions. Runtime includes API and model processing; waiting for human input is excluded.',
      shortDescription: 'Agent runtime is billed separately from AI credits.',
      source: {
        url: 'https://retool.com/pricing',
        label: 'Pricing | Retool',
        asOf: '2026-09-04',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'AI-assisted React/TypeScript app builder, classic visual apps, visual Workflows, and a dedicated Agents configuration surface.',
        shortValue: 'Apps, visual workflows, and AI agents',
        confidence: 'verified',
        sources: [
          {
            url: 'https://retool.com/blog/retool-launches-react-ai-app-builder',
            label: 'Retool launches a full-stack React AI app builder | Retool Blog',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/workflows/quickstart',
            label: 'Retool Workflows quickstart — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/agents/concepts/overview',
            label: 'Retool Agents overview — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      learningCurve: {
        value: 'Not verified',
        shortValue: 'Not verified',
        detail:
          'Learning effort depends on whether the team uses generated apps, visual configuration, SQL, or custom code; this review did not measure onboarding time.',
        confidence: 'unknown',
        sources: [],
      },
      selfHostOption: {
        value:
          'Yes: licensed self-hosted deployments on customer infrastructure, including Enterprise deployment options.',
        shortValue: 'Yes, licensed self-hosted deployment',
        detail:
          'Production uses Kubernetes; the Docker Compose guide is for non-production testing. Confirm the required product features and license with Retool.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/self-hosted/self-managed/tutorials/docker',
            label: 'Deploy self-hosted Retool with Docker — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://retool.com/pricing',
            label: 'Pricing | Retool',
            asOf: '2026-09-04',
          },
        ],
      },
      deploymentOptions: {
        value:
          'Retool Cloud or self-hosted infrastructure; Docker Compose for testing and Kubernetes for production.',
        shortValue: 'Cloud or self-hosted Kubernetes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/self-hosted/self-managed/tutorials/docker',
            label: 'Deploy self-hosted Retool with Docker — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://retool.com/pricing',
            label: 'Pricing | Retool',
            asOf: '2026-09-04',
          },
        ],
      },
      templates: {
        value: 'Yes: reusable app templates and a Create from Template option for workflows.',
        shortValue: 'App and workflow templates',
        confidence: 'verified',
        sources: [
          {
            url: 'https://retool.com/templates',
            label: 'Templates',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/workflows/quickstart',
            label: 'Retool Workflows quickstart — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      license: {
        value:
          'Commercial product requiring a Retool license; bundled open-source software has separate licenses.',
        shortValue: 'Commercial Retool license',
        detail:
          'The public deployment configuration is not an open-source license for the Retool product.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/self-hosted/self-managed/tutorials/docker',
            label: 'Deploy self-hosted Retool with Docker — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/legal/open-source-license-disclosure',
            label: 'Open Source License Disclosure — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      environmentPromotion: {
        value:
          'Yes: Source Control synchronizes changes across instances, with release manifests selecting deployed app and workflow versions.',
        shortValue: 'Source Control and multi-instance release manifests',
        detail:
          'Source Control is listed on Enterprise. Resource environments separately configure credentials and data sources; they are not full deployment environments.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/source-control/quickstart',
            label: 'Source Control quickstart — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/source-control/guides/multi-instance-releases/classic-apps-workflows',
            label: 'Multi-instance releases for classic apps and workflows — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://retool.com/pricing',
            label: 'Pricing | Retool',
            asOf: '2026-09-04',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Git branches, pull-request review, commit rollback, versioned releases, and per-instance release selection.',
        shortValue: 'Branches, PRs, rollback, and versioned releases',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/source-control/quickstart',
            label: 'Source Control quickstart — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/source-control/guides/multi-instance-releases/classic-apps-workflows',
            label: 'Multi-instance releases for classic apps and workflows — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          'Partial: multiplayer editing is documented for apps; live workflow-canvas co-editing was not verified.',
        shortValue: 'App multiplayer; workflow co-editing unverified',
        detail:
          'The multiplayer announcement documents concurrent app editing with cursors and highlights, and describes workflow support as future work.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://retool.com/blog/multiplayer-editing',
            label: 'Retool launches multiplayer editing for faster app development | Retool Blog',
            asOf: '2026-09-04',
          },
        ],
      },
      nativeFileStorage: {
        value: 'Yes: Retool Storage manages files and folders, with public or app-user file URLs.',
        shortValue: 'Managed files, folders, and public/private URLs',
        detail:
          'Cloud has a Retool-hosted file store; self-hosted instances can use their own storage provider through the interface. Password links and deleted-file recovery were not verified.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/data-sources/quickstarts/retool-storage',
            label: 'Retool Storage quickstart — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      dataTables: {
        value: 'Yes: Retool Database has editable tables and foreign-key links between rows.',
        shortValue: 'Database tables with foreign-key relationships',
        detail:
          'Queries can read and write data using SQL. This is database-backed storage; table-component rendering benchmarks are not database row limits.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/data-sources/guides/retool-database/link-tables',
            label: 'Link Retool Database tables — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/queries/guides/sql/writes',
            label: 'Write data to SQL databases — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      richTextEditor: {
        value: 'Partial: classic apps include a Rich Text Editor input component.',
        shortValue: 'Rich-text app component',
        detail:
          'A standalone document workspace with WYSIWYG Markdown persistence was not verified; the app author configures storage.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.retool.com/apps/reference/components/rich-text-editor',
            label: 'The Rich Text Editor component for classic apps — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      subWorkflows: {
        value:
          'Yes: a Workflow block calls a saved workflow and passes data between parent and child.',
        shortValue: 'Saved workflows callable from other workflows',
        detail:
          'Finished mode waits for the child result; Queued mode continues after queueing the child.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/guides/blocks/run-workflow',
            label: 'Run another workflow with the Workflow block — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/workflows/reference/objects/block/run-workflow',
            label: 'The Workflow block — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      customBlocks: {
        value: 'Not verified',
        shortValue: 'Not verified',
        detail:
          'Reusable Workflow blocks and custom app components are documented, but publishing a saved workflow as its own named organization-wide toolbar block was not verified.',
        confidence: 'unknown',
        sources: [],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'OpenAI, Anthropic, Google Gemini/Vertex AI, Amazon Bedrock, Azure OpenAI, and custom AI provider connections.',
        shortValue: 'Multiple providers and custom AI connections',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/data-sources/reference/ai-models',
            label: 'Retool AI providers and models — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          'Yes: Retool Agents uses an LLM-driven tool-calling loop, and Workflows can invoke agents.',
        shortValue: 'Agentic loops and workflow agent invocation',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/agents/concepts/overview',
            label: 'Retool Agents overview — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          'Yes: generate and modify apps with prompts; Agents also has configuration and function-generation assistance.',
        shortValue: 'Prompt-based apps and agent configuration',
        confidence: 'verified',
        sources: [
          {
            url: 'https://retool.com/blog/retool-launches-react-ai-app-builder',
            label: 'Retool launches a full-stack React AI app builder | Retool Blog',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/agents/concepts/overview',
            label: 'Retool Agents overview — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          'Yes: Retool-managed Vectors retrieves chunked document or website content; Amazon Knowledge Bases is also supported.',
        shortValue: 'Managed vectors and Amazon Knowledge Bases',
        detail:
          'Managed Vectors uses OpenAI embeddings. Select the embedding model when creating the vector; changing it afterward requires a new vector.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/data-sources/quickstarts/retool-vectors',
            label: 'Retool-managed Vectors — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/data-sources/guides/vectors/embeddings',
            label: 'Manage embeddings in Retool-managed Vectors — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpSupport: {
        value:
          'Yes: remote MCP resources for agent tools and an OAuth-authenticated organization MCP server for external clients.',
        shortValue: 'Remote MCP tools and organization MCP server',
        detail:
          'Agent connections support Streamable HTTP and SSE. Local stdio servers require an HTTP gateway.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/agents/guides/tools/connect-to-mcp-server',
            label: 'Connect an MCP server to an agent — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/org-users/guides/mcp',
            label: "Use Retool's MCP server — Retool Docs",
            asOf: '2026-09-04',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'Yes: dataset-based agent evaluations with programmatic reviewers, LLM judges, and side-by-side comparisons.',
        shortValue: 'Dataset evals, LLM judges, and tool approvals',
        detail:
          'Agents also supports consent for tool execution. Evals measure behavior; they do not by themselves guarantee safe output.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/agents/concepts/evals',
            label: 'Evals in Retool Agents — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/agents/guides/evals/compare-eval-runs',
            label: 'Run evals and compare them side-by-side — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/agents/concepts/overview',
            label: 'Retool Agents overview — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      humanInTheLoop: {
        value:
          'Yes: User Task blocks pause workflows until assigned users or groups complete a task in a Retool app.',
        shortValue: 'User Task pause, assignment, and resume',
        detail:
          'Agents also supports tool-execution consent; A2A calls cannot use approval-required tools.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/guides/user-tasks',
            label: 'Configure user tasks — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/agents/concepts/overview',
            label: 'Retool Agents overview — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/agents/concepts/a2a',
            label: 'Agent-to-agent communication — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      generativeMedia: {
        value: 'Image generation through supported OpenAI and Google models.',
        shortValue: 'OpenAI and Google image-generation actions',
        detail: 'This review did not verify dedicated native video or speech-generation actions.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/queries/guides/ai',
            label: 'AI resource queries — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      dynamicToolUse: {
        value:
          'Yes: agents select tools during execution, including tools fetched dynamically from configured MCP servers.',
        shortValue: 'Runtime selection from configured MCP tools',
        detail:
          'Discovery is scoped to connected servers and configured tools, not unrestricted access to every integration.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/agents/guides/tools/connect-to-mcp-server',
            label: 'Connect an MCP server to an agent — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/agents/concepts/tools',
            label: 'Tools for Retool Agents — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      modelFallback: {
        value: 'Not verified',
        shortValue: 'Not verified',
        detail:
          'Automatic failover from a failed model call to a different model or provider was not verified. Workflow error handlers can implement custom recovery.',
        confidence: 'unknown',
        sources: [],
      },
      agentSkills: {
        value: 'Not verified',
        shortValue: 'Not verified',
        detail:
          'A shared library of named prompt or knowledge snippets referenced across agents was not verified. Importing agent tools creates copies rather than a shared prompt reference.',
        confidence: 'unknown',
        sources: [],
      },
      nativeChatDeployment: {
        value:
          'Partial: Agent Chat and LLM Chat components provide conversation interfaces inside deployed Retool apps.',
        shortValue: 'Chat components inside Retool apps',
        detail:
          'The Agents editor also has test chats and public replay links. A replay link is not an interactive public agent deployment; app access must be configured separately.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.retool.com/apps/guides/forms-inputs/chats/',
            label: 'Getting started with chat components — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/agents/guides/chat-with-agent',
            label: 'Retool Agents chat — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          'Partial: Vectors splits text into chunks and exposes associated text or URLs for management.',
        shortValue: 'Chunked retrieval; full search debugger unverified',
        detail:
          'The automatic retrieval/context-injection steps run in the backend. A dedicated per-query chunk inspector was not verified.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.retool.com/data-sources/quickstarts/retool-vectors',
            label: 'Retool-managed Vectors — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      parallelExecution: {
        value:
          'Yes: workflow paths can execute in parallel and join after both inputs finish; loops have a parallel mode.',
        shortValue: 'Parallel paths, joins, and loop execution',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/quickstart',
            label: 'Retool Workflows quickstart — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/workflows/guides/blocks/logic/loop',
            label: 'Loop block — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      a2aProtocol: {
        value:
          'Yes: A2A ingress supports agent cards, messages, task polling/cancellation, and streamed updates.',
        shortValue: 'A2A ingress with API-key authentication',
        detail:
          'Supports HTTP+REST and JSON-RPC with API-key authentication. Approval-required and delegated-authentication tools fail because input-required/auth-required states are unsupported.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/agents/concepts/a2a',
            label: 'Agent-to-agent communication — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      loopIteration: {
        value: 'Yes: Loop blocks process array items sequentially, in parallel, or in batches.',
        shortValue: 'Sequential, parallel, and batched Loop blocks',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/guides/blocks/logic/loop',
            label: 'Loop block — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value:
          '74 distinct integration pages linked from the public catalog, including database connectors, generic APIs, and Retool services.',
        shortValue: '74 catalog entries; mixed connector categories',
        detail:
          'Counted the distinct integration links on the reviewed catalog. This is not an action count or a count of external SaaS apps only.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://retool.com/integrations',
            label: 'Explore Retool Integrations | Retool',
            asOf: '2026-09-04',
          },
        ],
      },
      triggerTypes: {
        value:
          'Schedules/cron, webhooks, classic apps, other workflows, and Retool Events; manual runs in the editor.',
        shortValue: 'Schedules, webhooks, apps, workflows, and Retool Events',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/concepts/limits',
            label: 'Workflow limits — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/workflows/quickstart',
            label: 'Retool Workflows quickstart — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      customCodeSteps: {
        value: 'Yes: JavaScript and Python workflow Code blocks.',
        shortValue: 'JavaScript and Python Code blocks',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/guides/blocks/javascript',
            label: 'Execute JavaScript with the Code block — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/workflows/guides/blocks/python',
            label: 'Execute Python with the Code block — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      codeSandboxRuntime: {
        value:
          'Workflow-specific npm and PyPI dependencies; private registries are supported on configured self-hosted deployments.',
        shortValue: 'Configurable npm/PyPI packages; self-hosted private registries',
        detail:
          'New JavaScript workflows do not preload libraries. Python version choices include 3.10 and 3.14; the latter uses custom requirements. A general cloud custom-image or OS-package interface was not verified.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/guides/blocks/javascript',
            label: 'Execute JavaScript with the Code block — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/workflows/guides/blocks/python',
            label: 'Execute Python with the Code block — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      apiPublishing: {
        value:
          'Yes: each workflow can expose a webhook URL with API-key authentication and a Response block.',
        shortValue: 'Workflow webhook endpoints and response blocks',
        detail:
          'Custom URL aliases and required string path parameters are documented. Platform administration APIs have separate permissions and plan requirements.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/guides/webhooks',
            label: 'Trigger workflows with webhooks — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'React custom component libraries with a TypeScript API and CLI, plus a public example gallery.',
        shortValue: 'React component SDK, CLI, and example gallery',
        detail:
          'These extend classic app UI components and are distinct from reusable workflow execution blocks.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/apps/guides/custom/custom-component-libraries/',
            label: 'Build custom React components — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      mcpPublishing: {
        value:
          'Partial: an organization MCP endpoint exposes Retool app-building and management tools.',
        shortValue: 'Organization MCP endpoint; workflow publishing unverified',
        detail:
          'Publishing an arbitrary saved workflow as its own standalone MCP tool was not verified.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.retool.com/org-users/guides/mcp',
            label: "Use Retool's MCP server — Retool Docs",
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/org-users/reference/mcp-tools',
            label: 'MCP tools — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Builder/internal-user seats, pooled AI credits, workflow allowances, and separately billed Agent runtime.',
        shortValue: 'Seats, AI credits, workflow runs, and Agent hours',
        confidence: 'verified',
        sources: [
          {
            url: 'https://retool.com/pricing',
            label: 'Pricing | Retool',
            asOf: '2026-09-04',
          },
        ],
      },
      entryPaidPlan: {
        value:
          'Team starts at $10 per builder/month and $5 per internal user/month with annual billing.',
        shortValue: 'Team: $10/builder/month, billed annually',
        detail:
          'Includes 5,000 workflow runs monthly. Internal-user seats are charged separately; usage above included allowances can add costs.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://retool.com/pricing',
            label: 'Pricing | Retool',
            asOf: '2026-09-04',
          },
        ],
      },
      freeTier: {
        value:
          'Yes: up to 5 users, 500 workflow runs/month, 5GB database capacity, 5GB file storage, and 250 AI credits/month.',
        shortValue: 'Free: 5 users and 500 workflow runs/month',
        detail:
          'The pricing page also lists up to 20 Agent hours monthly. Agent time and AI credits are separate allowances.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://retool.com/pricing',
            label: 'Pricing | Retool',
            asOf: '2026-09-04',
          },
        ],
      },
      byok: {
        value:
          'Yes: Enterprise organizations can connect their own AI provider keys and pay those providers directly.',
        shortValue: 'Enterprise AI BYOK',
        detail:
          'Retool documents no charge for BYOK model usage. Retool subscription and other product charges still need to be considered separately.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/data-sources/concepts/models',
            label: 'Retool AI providers and models — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    security: {
      dataResidency: {
        value:
          'Cloud uses AWS infrastructure; self-hosted deployments place the application infrastructure under customer control.',
        shortValue: 'AWS cloud or customer-managed infrastructure',
        detail:
          'Data flows depend on configured databases, AI providers, and services. Self-hosted deployments still have documented licensing/usage-reporting connections, and optional managed Temporal sends orchestration metadata externally.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/legal/security',
            label: 'Security Practices — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/self-hosted/self-managed/tutorials/docker',
            label: 'Deploy self-hosted Retool with Docker — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      rbac: {
        value:
          'Yes: organization roles and groups plus resource permissions; richer custom-role controls are on Enterprise.',
        shortValue: 'Organization roles, groups, and resource permissions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/permissions/guides/business/create-org-roles',
            label: 'Create an organization role — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/permissions/guides/resource-permissions',
            label: 'Manage permissions for resources — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://retool.com/pricing',
            label: 'Pricing | Retool',
            asOf: '2026-09-04',
          },
        ],
      },
      auditLogging: {
        value:
          'Yes: Business and Enterprise audit logs record user actions and query metadata; Enterprise supports streaming.',
        shortValue: 'Business audit logs; Enterprise streaming',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/org-users/guides/monitoring/audit-logs',
            label: 'View user audit logs — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://retool.com/pricing',
            label: 'Pricing | Retool',
            asOf: '2026-09-04',
          },
        ],
      },
      compliance: {
        value:
          'Retool lists SOC 2 Type 2 and ISO/IEC 27001:2022, plus GDPR and CCPA compliance programs.',
        shortValue: 'SOC 2 Type 2 and ISO 27001 listed',
        detail:
          'The Trust Center lists report/certificate documents; private audit scope was not inspected. HIPAA eligibility, PCI DSS, and FedRAMP status were not verified here.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://trust.retool.com/',
            label: 'Retool Trust Center | Powered by SafeBase',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/legal/security',
            label: 'Security Practices — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      modelAndToolGovernance: {
        value:
          'Partial: resource permissions and MCP scopes restrict which resources and administrative tools users can access.',
        shortValue: 'Resource permissions and scoped MCP access',
        detail: 'A separate per-role LLM-model allowlist was not verified.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.retool.com/permissions/guides/resource-permissions',
            label: 'Manage permissions for resources — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/org-users/reference/mcp-tools',
            label: 'MCP tools — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      credentialGovernance: {
        value:
          'Yes: groups receive Use, Edit, or Own access independently for each resource environment on Business or Enterprise.',
        shortValue: 'Per-resource and per-environment permissions',
        detail:
          'This governs resource access; row-, column-, and table-level restrictions use separate access policies.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/permissions/guides/resource-permissions',
            label: 'Manage permissions for resources — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      whiteLabeling: {
        value: 'Business includes custom branding; Enterprise includes full white-labeling.',
        shortValue: 'Business branding; Enterprise full white-labeling',
        confidence: 'verified',
        sources: [
          {
            url: 'https://retool.com/pricing',
            label: 'Pricing | Retool',
            asOf: '2026-09-04',
          },
        ],
      },
      dataRetention: {
        value:
          'Yes: admins configure workflow Run History retention, with a 30-day default and 90-day maximum.',
        shortValue: 'Configurable workflow retention; separate audit retention',
        detail:
          'Cloud audit logs are retained for one year, with three months browsable in the UI and a year downloadable. Self-hosted audit retention is operator-managed.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/guides/error-handlers',
            label: 'Configure workflow error handlers — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/org-users/guides/monitoring/audit-logs',
            label: 'View user audit logs — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      piiRedaction: {
        value:
          'Partial: omit query content from audit logs or hide selected parameters; automatic PII detection was not verified.',
        shortValue: 'Query-content and parameter exclusion',
        detail: 'These are logging controls, not proof of automatic content-level PII scanning.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.retool.com/org-users/guides/monitoring/audit-logs',
            label: 'View user audit logs — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      sso: {
        value:
          'Yes: Enterprise SAML/OIDC SSO, optional first-login provisioning, and SCIM lifecycle provisioning.',
        shortValue: 'Enterprise SAML/OIDC, JIT, and SCIM',
        detail:
          'JIT creates an account on first SSO login for users granted access by the identity provider; SCIM is a separate provisioning mechanism.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://retool.com/pricing',
            label: 'Pricing | Retool',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/sso/guides/jit-provisioning',
            label: 'Enable JIT user provisioning for SSO — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/sso/guides/scim-user-provisioning',
            label: 'Provision users with SCIM — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      sessionPolicy: {
        value:
          'Yes: the SSO short-session setting reduces the documented session duration from one week to 12 hours.',
        shortValue: 'SSO sessions: one week or 12 hours',
        detail: 'A configurable inactivity timeout was not verified.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/sso/guides/authentication/short-session',
            label: 'Configure SSO session duration — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      thirdPartyVetting: {
        value:
          'Vendor integrations coexist with custom component libraries and a gallery containing Retool and community examples.',
        shortValue: 'Vendor integrations plus community component examples',
        detail:
          'The cited docs do not establish a uniform security-audit guarantee for all third-party code; custom libraries may import public or private npm packages.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://retool.com/integrations',
            label: 'Explore Retool Integrations | Retool',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/apps/guides/custom/custom-component-libraries/',
            label: 'Build custom React components — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Workflow Run History exposes per-run and per-block logs; Agents reports runs, token use, cost, and behavior.',
        shortValue: 'Workflow block logs and Agent run monitoring',
        detail:
          'Specific distributed-tracing span support and latency-percentile dashboards were not verified.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/guides/error-handlers',
            label: 'Configure workflow error handlers — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/agents/concepts/overview',
            label: 'Retool Agents overview — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      durabilityModel: {
        value:
          'Configurable block retries and exponential backoff, with local and global error handlers.',
        shortValue: 'Block retries, backoff, and error handlers',
        detail: 'A general one-click replay with original inputs was not verified.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/guides/error-handlers',
            label: 'Configure workflow error handlers — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      failureAlerting: {
        value:
          'Workflow error handlers can send proactive notifications through Slack, email, or other resource actions.',
        shortValue: 'Error-handler notifications',
        detail: 'A built-in cost/latency threshold subscription was not verified.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/quickstart',
            label: 'Retool Workflows quickstart — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/workflows/guides/user-tasks',
            label: 'Configure user tasks — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      dataDrains: {
        value:
          'Yes: Enterprise streams audit logs to Datadog or Splunk; self-hosted deployments can emit audit events to stdout.',
        shortValue: 'Datadog, Splunk, and self-hosted stdout',
        detail:
          'These are audit-log exports; a comprehensive export of every Agent and workflow trace was not verified.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/org-users/guides/monitoring/audit-logs',
            label: 'View user audit logs — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      asyncExecution: {
        value:
          'Yes: workflows support asynchronous execution; a Workflow block can queue a child without waiting for completion.',
        shortValue: 'Asynchronous runs and queued child workflows',
        detail:
          'Classic-app-triggered workflows without a Response block are enqueued and respond immediately; Response blocks support synchronous results before remaining asynchronous work.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/concepts/limits',
            label: 'Workflow limits — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/workflows/reference/objects/block/run-workflow',
            label: 'The Workflow block — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      executionLimits: {
        value:
          'Cloud workflows: 15 minutes to the first synchronous Response block, or 30 hours asynchronously; 100 concurrent runs per workflow.',
        shortValue: '15-minute synchronous / 30-hour asynchronous runs',
        detail:
          'Asynchronous workflows with User Task/Wait blocks have no overall timeout; individual waits cap at 60 days. Cloud memory is 2.5GB/run and outbound concurrency is 50 requests/workflow. Block-specific timeouts also apply.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/concepts/limits',
            label: 'Workflow limits — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      partialFailureHandling: {
        value:
          'Yes: block-level On Error connections and global handlers route failures while workflow execution can continue.',
        shortValue: 'Local and global error-handling paths',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/guides/error-handlers',
            label: 'Configure workflow error handlers — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      unattendedExecution: {
        value:
          'Yes: deployed scheduled or webhook-triggered workflows run on the hosted or self-hosted server infrastructure.',
        shortValue: 'Server-side scheduled and event-driven execution',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/workflows/quickstart',
            label: 'Retool Workflows quickstart — Retool Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/self-hosted/self-managed/tutorials/docker',
            label: 'Deploy self-hosted Retool with Docker — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Developer forum, office hours, breakage reporting, billing/account email support, and Enterprise technical support.',
        shortValue: 'Forum, office hours, email, and Enterprise support',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/support/',
            label: 'Contact Retool support — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      sla: {
        value:
          'Enterprise technical support follows the Enterprise Support Policy; billing/account support targets two business days.',
        shortValue: 'Enterprise policy; ordinary support targets vary',
        detail:
          'This review did not verify a contractual uptime percentage or the full private Enterprise support terms.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/support/',
            label: 'Contact Retool support — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      community: {
        value: 'Public developer forum, recurring office hours, and a Retool subreddit.',
        shortValue: 'Developer forum, office hours, and subreddit',
        detail:
          'No membership or activity total is used because these figures change continuously.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.retool.com/support/',
            label: 'Contact Retool support — Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      companyMaturity: {
        value: 'Y Combinator Winter 2017 company based in San Francisco.',
        shortValue: 'YC Winter 2017; San Francisco',
        detail:
          'Funding totals, valuation, and employee counts are omitted rather than relying on stale company-data aggregators.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.ycombinator.com/companies/retool',
            label: 'Retool: Build internal tools fast. | Y Combinator',
            asOf: '2026-09-04',
          },
        ],
      },
      academy: {
        value:
          'Retool University provides role-based courses, labs, videos, and completion badges.',
        shortValue: 'University courses, labs, videos, and badges',
        confidence: 'verified',
        sources: [
          {
            url: 'https://retool.com/blog/introducing-retool-university',
            label: 'Introducing Retool University | Retool Blog',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.retool.com/education/',
            label: 'Retool Docs',
            asOf: '2026-09-04',
          },
        ],
      },
    },
  },
}
