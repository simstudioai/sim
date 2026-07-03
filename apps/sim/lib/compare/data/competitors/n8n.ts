import { N8nIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Researched and cross-verified against live vendor sources on 2026-07-02. */
export const n8nProfile: CompetitorProfile = {
  id: 'n8n',
  name: 'n8n',
  website: 'https://n8n.io',
  brand: {
    icon: N8nIcon,
    selfFramed: true,
    colors: ['#040404', '#eb4c74', '#e6a3bc'],
    description:
      'n8n is a workflow automation platform that enables technical teams to build AI solutions and automate business processes. It combines the flexibility of code with the speed of no-code, allowing users to integrate with any app or API. With its open and self-hostable model, n8n provides a extendable tool for connecting various systems and applications, giving users the freedom to automate workflows at their own pace.',
    industries: [
      'Software (B2B)',
      'Developer Tools & APIs',
      'Artificial Intelligence & Machine Learning',
    ],
    socials: [
      { type: 'linkedin', url: 'https://linkedin.com/company/n8n' },
      { type: 'discord', url: 'https://discord.gg/xpkekxeb7d' },
      { type: 'youtube', url: 'https://youtube.com/c/n8n-io' },
      { type: 'x', url: 'https://x.com/n8n_io' },
      { type: 'facebook', url: 'https://facebook.com/n8nio' },
      { type: 'instagram', url: 'https://instagram.com/n8n.io' },
    ],
    source: 'Context.dev brand-intelligence API',
    asOf: '2026-07-02',
  },
  oneLiner:
    'n8n is a fair-code workflow automation platform combining a visual, node-based builder with custom code and built-in AI/agent nodes, available as a self-hosted or cloud-hosted product.',
  standoutFeatures: [
    {
      title: 'Execution-based pricing, not per-step or per-seat',
      description:
        'n8n bills by monthly workflow executions, not by operation, step, or user seat. A full run start-to-finish counts once, no matter how many nodes it contains, and unlimited users are included even on the Starter plan.',
      shortDescription: 'Bills by monthly executions, not steps or seats, with unlimited users.',
      source: { url: 'https://n8n.io/pricing/', label: 'n8n Pricing', asOf: '2026-07-02' },
    },
    {
      title: 'Native MCP Client Tool and MCP Server Trigger nodes',
      description:
        "n8n ships first-party nodes so any workflow's AI agent can call tools from an external MCP server (MCP Client Tool), and any n8n workflow can itself be exposed as MCP tools to external AI agents (MCP Server Trigger), using SSE/JSON-RPC with Bearer, header, or OAuth2 auth.",
      shortDescription: 'First-party nodes to both call and expose MCP tools.',
      source: {
        url: 'https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp/',
        label: 'MCP Client Tool docs',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Built-in Evaluations for AI workflows',
      description:
        "A dedicated Evaluations feature runs a workflow against a test dataset with expected outputs. 'Light evaluations' are for dev-time spot checks, while 'Metric-based evaluations' score at production scale using built-in metrics (AI-judged helpfulness, string similarity, categorization, tools used) plus custom metrics.",
      shortDescription: 'Native test-dataset evaluations for dev checks and production monitoring.',
      source: {
        url: 'https://docs.n8n.io/advanced-ai/evaluations/overview/',
        label: 'n8n Evaluations docs',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Fair-code self-hostable core with source-available license',
      description:
        'The core product is released under the Sustainable Use License v1.0. Source-available, free for internal/non-commercial use, modification requires attribution. With enterprise-only files gated behind a separate n8n Enterprise License, and can be fully self-hosted via Docker, Docker Compose, or the official Kubernetes Helm chart.',
      shortDescription: 'Source-available core, fully self-hostable via Docker or Kubernetes.',
      source: {
        url: 'https://raw.githubusercontent.com/n8n-io/n8n/master/LICENSE.md',
        label: 'n8n LICENSE.md',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Natural-language AI Workflow Builder',
      description:
        "A beta 'AI Workflow Builder' converts a plain-text description into a draft, editable node workflow, with multi-turn refinement via chat. Currently available on Cloud (Trial/Starter/Pro), with Enterprise and self-hosted availability planned for later.",
      shortDescription: 'Generates an editable draft workflow from a plain-text prompt.',
      source: {
        url: 'https://docs.n8n.io/advanced-ai/ai-workflow-builder/',
        label: 'n8n AI Workflow Builder docs',
        asOf: '2026-07-02',
      },
    },
  ],
  limitations: [
    {
      title: 'AI Workflow Builder not yet available self-hosted or on Enterprise',
      description:
        'The natural-language-to-workflow AI Workflow Builder is in beta and limited to Cloud Trial/Starter/Pro plans. Enterprise and self-hosted support is listed as planned for a future release, so self-hosters cannot use it today.',
      shortDescription: "Beta AI builder is Cloud-only today; self-hosters can't use it.",
      source: {
        url: 'https://community.n8n.io/t/introducing-ai-workflow-builder-beta/204919',
        label: 'n8n Community: Introducing AI Workflow Builder (Beta)',
        asOf: '2026-07-02',
      },
    },
    {
      title: "No public SOC 2 report; only 'aligned to' SOC 2",
      description:
        "n8n states its security program is 'aligned to' the SOC 2 framework with annual independent audits, and the SOC 2 report itself is only made available to enterprise customers via the Trust Center rather than published publicly.",
      shortDescription: 'SOC 2 report is available only on request to enterprise customers.',
      source: { url: 'https://trust.n8n.io/', label: 'n8n Trust Center', asOf: '2026-07-02' },
    },
    {
      title:
        'SSO/SAML/LDAP, audit logging, and dedicated SLA support gated to paid/Enterprise tiers',
      description:
        'Core governance features, SSO/SAML/LDAP, custom project roles, audit log export/SIEM streaming, and dedicated SLA-backed support, are not available on the Community (free, self-hosted) edition. They require the Business or Enterprise plans.',
      shortDescription: 'Governance features require Business or Enterprise, not the free tier.',
      source: { url: 'https://n8n.io/pricing/', label: 'n8n Pricing', asOf: '2026-07-02' },
    },
    {
      title: 'MCP tool access control is coarse, not a distinct governance layer',
      description:
        "MCP nodes are first-party, but tool access control is limited to simple 'all tools / selected tools / excluded tools' modes on the MCP Client Tool node. There's no finer-grained, per-tool policy or guardrail tooling like the product's evaluation features offer elsewhere.",
      shortDescription: 'MCP tool access control is coarse, without fine-grained per-tool policy.',
      source: {
        url: 'https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp/',
        label: 'MCP Client Tool docs',
        asOf: '2026-07-02',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value: 'Hybrid visual/code node-based builder',
        detail:
          "n8n's core interface is a visual, drag-and-drop node canvas where each node is a step. It supports a Custom Code node (JavaScript/Python) and an HTTP Request Tool for arbitrary API calls, plus a beta natural-language AI Workflow Builder that generates an editable draft workflow from a text prompt.",
        shortValue: 'Visual canvas plus code node and AI builder',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/advanced-ai/ai-workflow-builder/',
            label: 'n8n AI Workflow Builder docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/tools-agent',
            label: 'n8n Tools Agent docs',
            asOf: '2026-07-02',
          },
        ],
      },
      learningCurve: {
        value: 'Unknown / not vendor-quantified',
        detail:
          'n8n does not publish a formal learning-curve metric. Node-based visual building is broadly described in docs and tutorials as approachable for non-developers on simple flows, while advanced AI-agent and expression/code usage assumes technical familiarity.',
        shortValue: 'No official rating; easy visually, code needs skill',
        confidence: 'unknown',
        sources: [],
      },
      selfHostOption: {
        value: 'Yes: full self-hosting supported (Community edition free, Enterprise edition paid)',
        detail:
          'Community Edition is a free, self-hosted version runnable on your own infrastructure. An Enterprise Edition (self-hosted or cloud) adds SSO, environments, projects, and other governance features.',
        shortValue: 'Free Community edition, paid Enterprise self-host',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/choose-how-to-use-n8n.md',
            label: 'n8n docs: Choose how to use n8n',
            asOf: '2026-07-02',
          },
        ],
      },
      deploymentOptions: {
        value:
          'Cloud (n8n-managed) and self-hosted via npm, Docker/Docker Compose, or Kubernetes (official Helm chart)',
        detail:
          "Self-hosting can be run via npm, Docker, or a server per n8n's own docs. A separate n8n-io/n8n-hosting GitHub repo and Helm chart (oci://ghcr.io/n8n-io/n8n-helm-chart/n8n) provide reference deployments for Docker Compose and Kubernetes, and cloud deployment guides cover AWS, Azure, and GCP.",
        shortValue: 'Cloud, npm, Docker Compose, or Kubernetes Helm',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.n8n.io/choose-how-to-use-n8n.md',
            label: 'n8n docs: Choose how to use n8n',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/n8n-io/n8n-hosting',
            label: 'n8n-io/n8n-hosting (GitHub)',
            asOf: '2026-07-02',
          },
        ],
      },
      templates: {
        value: 'Yes: large public template library (thousands of workflows)',
        detail:
          'n8n.io/workflows is a public directory of community-submitted workflow templates, reported at roughly 10,000+ templates as of mid-2026, with a dedicated AI-workflow category.',
        shortValue: '10,000+ community workflow templates',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://n8n.io/workflows/',
            label: 'n8n.io Workflow Templates directory',
            asOf: '2026-07-02',
          },
        ],
      },
      license: {
        value:
          'Sustainable Use License v1.0 (source-available/"fair-code") + n8n Enterprise License for .ee. Files',
        detail:
          'Core n8n code is under the Sustainable Use License v1.0: free for internal business, non-commercial, or personal use, with required attribution on modifications. Files with \'.ee.\' in the path require a separate proprietary n8n Enterprise License. N8n markets this combination as "fair-code," not OSI-approved open source.',
        shortValue: 'Sustainable Use License plus Enterprise License',
        confidence: 'verified',
        sources: [
          {
            url: 'https://raw.githubusercontent.com/n8n-io/n8n/master/LICENSE.md',
            label: 'n8n LICENSE.md',
            asOf: '2026-07-02',
          },
        ],
      },
      environmentPromotion: {
        value: 'Yes: Git-backed Environments feature promotes whole projects between instances',
        detail:
          "n8n's 'Source control and environments' feature links an n8n instance/project to a Git repository and branch, and supports pushing a full project's workflows, credential references, and variables from one environment (e.g. development) to Git, then pulling into another (e.g. staging/production). Whole-project promotion, not just single-workflow versioning. Supported topologies include multiple instances on one branch (simple push then pull) or multiple instances on multiple branches (requiring a Git-provider pull request/merge). Instance owners/admins can push and pull; project admins can push but not pull. Credential values and variable values are not synced via Git and must be configured manually per environment. This is an Enterprise-tier feature.",
        shortValue: 'Git-backed whole-project promotion (Enterprise)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/source-control-environments/understand/environments/',
            label: 'Environments in n8n | n8n Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.n8n.io/administer/use-source-control-and-environments/push-and-pull-changes',
            label: 'Push and pull changes | Administer | n8n Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.n8n.io/source-control-environments/using/push-pull/',
            label: 'Push and pull | n8n Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Server-persisted workflow version history with restore and side-by-side compare; no true branching; undo/redo not a distinct persisted feature',
        detail:
          'n8n maintains a server-side Workflow History of prior saved versions, each capturing node/parameter changes. Users can restore a workflow to a selected version (n8n auto-saves the current state as a new version before restoring, so restores are themselves reversible), open a version in a new tab to compare it against the current workflow, create a new workflow from a historical version, download a version as JSON, and pin or name a version to exempt it from automatic pruning. Retention is tiered: full history on Enterprise Cloud/Self-hosted, 5 days on Cloud Pro, 24 hours for all other users/plans. Git-based branching exists only at the environment/project level, not as per-workflow Git branches. In-editor undo/redo exists but is not documented as a separately persisted, server-tracked mechanism distinct from workflow history.',
        shortValue: 'Version history with restore and compare, no branching',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/build/manage-workflows/view-change-history',
            label: 'View change history | Build | n8n Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://community.n8n.io/t/workflow-versioning-and-rollback/113710',
            label: 'Workflow Versioning and Rollback - n8n Community',
            asOf: '2026-07-02',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          'No: n8n does not support live concurrent multi-user canvas editing with cursors/selections/synced operations. Collaboration is handled through async workflow sharing, project-based access, and Git-based source control (Enterprise), not real-time co-editing; community edition additionally lacks any workflow sharing at all.',
        detail:
          'Enterprise adds Git source control and project sharing, but no evidence of live cursors or simultaneous canvas editing was found.',
        shortValue: 'No live co-editing, only async sharing + Git version control',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/source-control-environments/',
            label: 'Source control and environments | n8n Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.n8n.io/hosting/community-edition-features/',
            label: 'Community edition features | n8n Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeFileStorage: {
        value:
          'No: n8n does not have a Drive-like native file storage system with folder hierarchy, link-based sharing (password/SSO), and deleted-item recovery. Its "file storage" is binary data handling scoped to workflow executions (local filesystem/S3-compatible backend config) or per-node file operations, not a user-facing file manager.',
        detail:
          'n8n docs describe binary data storage mode (filesystem/S3) for execution artifacts and per-node file/folder operations (e.g. Google Drive node), not an internal shared-drive product surface.',
        shortValue: 'No, only per-execution binary data, not a file manager',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://blogs.yashrajs.com/blog/how-to-setup-n8n-internal-file-storage',
            label: "How to Set Up n8n's Internal File Storage",
            asOf: '2026-07-02',
          },
          {
            url: 'https://community.n8n.io/t/file-storage-in-n8n-workflows-what-are-your-options-and-when-does-each-one-make-sense/281470',
            label: 'File storage in n8n workflows: options (n8n Community)',
            asOf: '2026-07-02',
          },
        ],
      },
      dataTables: {
        value:
          'Yes: n8n has a native Data Table feature (Data Table node, DataTable API, and a Data tables UI tab) for creating and managing structured tables of rows and columns directly inside an n8n instance, without an external database.',
        detail:
          "Storage is capped at 50MB per instance by default (self-hosted instances can raise this via the N8N_DATA_TABLES_MAX_SIZE_BYTES environment variable); direct programmatic access from a Code node isn't supported. Spreadsheet-style keyboard navigation isn't explicitly documented.",
        shortValue: 'Yes, native Data Table feature',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/build/work-with-data/data-tables.md',
            label: 'Data tables | n8n Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.datatable',
            label: 'Data Table | Nodes | n8n Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      richTextEditor: {
        value:
          'No: n8n does not have a document-oriented WYSIWYG rich-text editor. Its closest analog is Sticky Notes on the workflow canvas, which support Markdown formatting (headers, bold, lists, code blocks, embedded images/YouTube) but are edited as raw Markdown text, not a WYSIWYG editor, and are canvas annotations rather than stored documents.',
        detail:
          'Sticky notes render Markdown via markdown-it/CommonMark but are edited in plain-text/raw-source mode, not an inline WYSIWYG surface.',
        shortValue: 'No WYSIWYG editor; Markdown sticky notes on canvas only',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/workflows/components/sticky-notes/',
            label: 'Sticky Notes | n8n Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.createwith.com/tool/n8n/updates/n8n-adds-markdown-support-to-workflow-sticky-notes-for-embedded-images-and-video',
            label: 'n8n Adds Markdown Support to Workflow Sticky Notes',
            asOf: '2026-07-02',
          },
        ],
      },
      subWorkflows: {
        value:
          "Yes: the Execute Sub-workflow node calls a saved workflow as a step in another workflow, with a 'Wait for Sub-Workflow Completion' option so the parent pauses until the child finishes, passing data in via the child's trigger and receiving data back from the child's last node.",
        detail:
          "The child workflow starts with a 'When Executed by Another Workflow' trigger that defines the expected input fields. When 'Wait for Sub-Workflow Completion' is enabled, the parent blocks until the sub-workflow finishes and receives whatever data the sub-workflow's final node outputs; disabling it lets the parent continue without waiting.",
        shortValue: 'Yes, Execute Sub-workflow node with wait-for-completion option',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow/',
            label: 'Execute Sub-workflow | Nodes | n8n Docs',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value: 'Yes: many providers via dedicated Chat Model nodes',
        detail:
          'Documented first-party Chat Model nodes include OpenAI, Anthropic (Claude), Google Gemini, Google Vertex, Azure OpenAI, AWS Bedrock, Mistral Cloud, Cohere, DeepSeek, Groq, xAI Grok, OpenRouter, Ollama (local models), Alibaba Cloud, MiniMax, Moonshot Kimi, NVIDIA Nemotron, Vercel AI Gateway, and Lemonade.',
        shortValue: 'OpenAI, Anthropic, Gemini, Bedrock, and more',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.lmchatopenai',
            label: 'OpenAI Chat Model node docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.lmchatanthropic',
            label: 'Anthropic Chat Model node docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.lmchatgooglegemini',
            label: 'Google Gemini Chat Model node docs',
            asOf: '2026-07-02',
          },
        ],
      },
      agentReasoningBlocks: {
        value: 'Yes: dedicated AI Agent / Tools Agent node distinct from plain data-routing nodes',
        detail:
          'The AI Agent node (implemented as a "Tools Agent" since v1.82.0) is an autonomous decision-making node: based on the LLM\'s reasoning, it selects and calls tools such as other n8n workflows, the Custom Code tool, the HTTP Request tool, MCP tools, or a vector store used as a tool. This is distinct from n8n\'s standard, deterministic data-transform/routing nodes.',
        shortValue: 'Dedicated AI Agent / Tools Agent node',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/tools-agent',
            label: 'n8n Tools Agent docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.n8n.io/advanced-ai/examples/understand-agents/',
            label: "n8n docs: What's an agent in AI?",
            asOf: '2026-07-02',
          },
        ],
      },
      naturalLanguageBuilding: {
        value: 'Yes: beta AI Workflow Builder, Cloud only currently',
        detail:
          'Users describe a workflow in plain text and the beta AI Workflow Builder generates a draft, editable node-based workflow with iterative multi-turn refinement. Available in beta on Cloud (Trial, Starter, Pro plans), with Enterprise and self-hosted support planned for later.',
        shortValue: 'Beta builder, Cloud plans only',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/advanced-ai/ai-workflow-builder/',
            label: 'n8n AI Workflow Builder docs',
            asOf: '2026-07-02',
          },
        ],
      },
      knowledgeBaseRag: {
        value: 'Yes: native RAG pipeline with multiple vector-store integrations',
        detail:
          'n8n documents a full RAG pipeline (document loaders, Text Splitter, Embeddings node, Vector Store node) with supported vector stores including Pinecone, Qdrant, Supabase Vector Store, PGVector (Postgres), and an in-memory vector store for testing; vector stores can be retrieved as a tool for an AI Agent.',
        shortValue: 'Pinecone, Qdrant, Supabase, PGVector support',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/advanced-ai/rag-in-n8n/',
            label: 'n8n docs: RAG in n8n',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.vectorstoreinmemory/',
            label: 'n8n Simple Vector Store node docs',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpSupport: {
        value: 'Yes: native MCP Client Tool and MCP Server Trigger nodes',
        detail:
          'First-party nodes let an n8n AI Agent call tools exposed by an external MCP server (MCP Client Tool, SSE + JSON-RPC, Bearer/header/OAuth2 auth) and let n8n expose its own workflows as MCP tools to external AI agents (MCP Server Trigger).',
        shortValue: 'MCP Client Tool and MCP Server Trigger nodes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp/',
            label: 'MCP Client Tool docs',
            asOf: '2026-07-02',
          },
        ],
      },
      evaluationGuardrails: {
        value: 'Yes: dedicated Evaluations feature (Light + Metric-based)',
        detail:
          "n8n provides an Evaluation node/trigger and an Evaluations tab supporting 'Light evaluations' (manual test cases during development) and 'Metric-based evaluations' (scoring at scale for production), with built-in metrics (AI-judged Helpfulness, string similarity, categorization, tools-used) plus custom metrics. n8n's own 2026 AI Agent Development Tools report scores n8n 0 out of 2 on both \"JSON validity\" and \"Format check\" evaluation types, versus Sim's 2 out of 2 on both, via Sim's Guardrails block.",
        shortValue: 'Light and metric-based evaluation testing',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/advanced-ai/evaluations/overview/',
            label: 'n8n Evaluations docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://blog.n8n.io/introducing-evaluations-for-ai-workflows/',
            label: 'n8n Blog: Introducing Evaluations for AI workflows',
            asOf: '2026-07-02',
          },
          {
            url: 'https://n8n.io/reports/2026-ai-agent-development-tools/#vendors',
            label:
              'n8n: 2026 AI Agent Development Tools report (JSON validity, Format check scores)',
            asOf: '2026-07-02',
          },
        ],
      },
      humanInTheLoop: {
        value: 'Yes: dedicated Human-in-the-Loop node built on Wait',
        detail:
          "n8n has a dedicated Human-in-the-Loop node (a higher-level abstraction built on the underlying Wait node) that pauses an active workflow mid-run and waits on human approval or input, distinct from a plain delay. The approver is notified via a configurable channel. Gmail, Slack, Telegram, Discord, Microsoft Teams, WhatsApp, or n8n's built-in Chat. With 'Approve Only' or 'Approve and Disapprove' options. The run resumes when the reviewer responds via a button or webhook callback, and an optional timeout triggers a fallback path if no response arrives within the configured window (minutes up to a day).",
        shortValue: 'Dedicated approval node with timeout fallback',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/advanced-ai/human-in-the-loop-tools/',
            label: 'Human-in-the-loop for AI tool calls | n8n Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.n8n.io/build/integrate-ai/ai-examples/human-in-the-loop-for-tools',
            label: 'Human-in-the-loop for tools | Build | n8n Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      generativeMedia: {
        value: 'Partial: via AI/LLM provider nodes, not dedicated media-gen nodes',
        detail:
          "No standalone image-generation or video-generation core node family exists. Image, video, TTS, and STT are reached by calling LLM provider nodes inside the LangChain-based AI nodes: the OpenAI node's Image and Audio operations (image generation via DALL-E/gpt-image, TTS, and transcription/translation via Whisper), and the MiniMax node (image generation, video generation from text or a first-frame image, and text-to-speech). Broader coverage such as text-to-3D, faceswap, or upscaling exists only via unofficial community nodes like PiAPI, not built by n8n itself.",
        shortValue: 'Via OpenAI/MiniMax nodes, no dedicated nodes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-langchain.openai/audio-operations/',
            label: 'OpenAI Audio operations | n8n Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-langchain.minimax',
            label: 'MiniMax | Nodes | n8n Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://community.n8n.io/t/n8n-community-node-piapi-from-text-to-image-video-generation-and-3d-modeling-to-faceswap-audio-tts-and-upscaling/94381',
            label: 'PiAPI community node forum post',
            asOf: '2026-07-02',
          },
        ],
      },
      dynamicToolUse: {
        value: 'Unknown',
        detail: 'Not publicly documented by n8n.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      modelFallback: {
        value: 'Unknown',
        detail: 'Not publicly documented by n8n.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      agentSkills: {
        value:
          'No: n8n has no first-class, named reusable prompt/knowledge-snippet object that agents reference. Reuse is achieved informally by exporting/importing workflow JSON or calling a sub-workflow (e.g. a "Tool (Workflow)" node) as a reusable scratchpad, not by a dedicated skills library.',
        shortValue: 'No dedicated reusable skill/snippet object',
        detail:
          'System prompts are configured per AI Agent node; the closest analog is reusable sub-workflows or exported JSON, not a named, invokable skill library. n8n\'s own 2026 AI Agent Development Tools report independently scores n8n 0 out of 2 on "Agent skills directory," versus Sim\'s 2 out of 2.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/advanced-ai/intro-tutorial/',
            label: 'Tutorial: Build an AI workflow in n8n',
            asOf: '2026-07-02',
          },
          {
            url: 'https://n8n.io/workflows/7066-create-multi-step-reasoning-ai-agents-with-gpt-4-and-reusable-thinking-tools/',
            label: 'Reusable thinking tools workflow template',
            asOf: '2026-07-02',
          },
          {
            url: 'https://n8n.io/reports/2026-ai-agent-development-tools/#vendors',
            label: 'n8n: 2026 AI Agent Development Tools report (Agent skills directory score)',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeChatDeployment: {
        value:
          'Yes: n8n\'s Chat Trigger node provides a fully styled, publicly deployable chat window that connects to an AI Agent node, with a configurable public URL, CORS allowed-origins, and streaming responses; Chat Hub additionally offers a centralized multi-model chat interface with a restricted "Chat user" role.',
        detail:
          'Distinct from form/webhook/API deployment; supports streaming and a dedicated non-builder chat-user role via Chat Hub.',
        shortValue: 'Yes, Chat Trigger deploys a public chat surface',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.chattrigger',
            label: 'Chat Trigger | n8n Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.n8n.io/advanced-ai/chat-hub/',
            label: 'Chat Hub | n8n Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          "Yes: n8n's vector store nodes (Simple/In-Memory, Pinecone, Qdrant, Supabase, PGVector, etc.) return individual chunk-level detail in their JSON output, including pageContent (the chunk text) and per-chunk metadata (source, chunk index, location), visible in the node's execution output pane.",
        detail:
          "This comes from the underlying document format n8n's AI nodes use internally (based on LangChain), not a purpose-built knowledge-base debugging UI; a documented Qdrant metadata bug shows the field is normally present.",
        shortValue: 'Yes, chunk-level pageContent/metadata exposed',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.vectorstoreinmemory/',
            label: 'Simple Vector Store node documentation',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/n8n-io/n8n/issues/14960',
            label:
              'Qdrant vector store does not respect the Include Metadata option (GitHub issue)',
            asOf: '2026-07-02',
          },
        ],
      },
      parallelExecution: {
        value:
          "No: n8n's own documentation states that in the current (v1) execution order, the engine executes each branch in turn, completing one branch before starting another, rather than running them concurrently.",
        detail:
          'n8n does offer a Merge node to recombine split branches, and community workaround patterns exist (e.g. triggering sub-workflows asynchronously and waiting for all to finish), but there is no documented native fan-out/fan-in node that runs branches concurrently.',
        shortValue: 'No, branches execute sequentially by default',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.n8n.io/flow-logic/execution-order/',
            label: 'Execution order in multi-branch workflows | n8n Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.n8n.io/build/flow-logic/merge-data',
            label: 'Merge data | Build | n8n Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      a2aProtocol: {
        value:
          "No: n8n's own blog describes A2A protocol support as coming from a community-published node, not a built-in feature of the core product.",
        detail:
          "n8n's official blog post on the Agent2Agent protocol states teams experimenting with A2A today rely on a community-published node for protocol-level communication; no first-party A2A node ships in n8n core.",
        shortValue: 'No, community node only, not native',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://blog.n8n.io/agent-to-agent-protocol/',
            label: 'Agent-to-Agent (A2A) Protocol: Implementation and Trade-offs (n8n Blog)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/pjawz/n8n-nodes-agent2agent',
            label: 'n8n-nodes-agent2agent (community package, GitHub)',
            asOf: '2026-07-02',
          },
        ],
      },
      loopIteration: {
        value:
          "Yes: the Loop Over Items (Split in Batches) node iterates a list in fixed-size batches, running each batch sequentially through a 'loop' output and combining results through a 'done' output once all batches complete.",
        detail:
          "Loop Over Items processes a configurable batch size per iteration and re-enters the loop until every input item has passed through, rather than fanning items out concurrently. n8n's docs note this is the primary built-in mechanism for iterative processing, distinct from the Parallel-style concurrent fan-out other flow-logic nodes provide.",
        shortValue: 'Yes, Loop Over Items node, sequential batch iteration',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.splitinbatches/',
            label: 'Loop Over Items (Split in Batches) | Nodes | n8n Docs',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value: '1,921 integrations (per live n8n.io/integrations page)',
        detail:
          "The n8n.io integrations directory page displays a live count of 1,921 integrations as of the check date. N8n's GitHub repo description separately advertises '400+ integrations' as a rounder marketing figure, so the two vendor sources disagree slightly.",
        shortValue: '1,921 listed integrations',
        confidence: 'verified',
        sources: [
          {
            url: 'https://n8n.io/integrations/',
            label: 'n8n.io Integrations directory',
            asOf: '2026-07-02',
          },
        ],
      },
      triggerTypes: {
        value:
          'Webhook, schedule/cron, chat, manual, MCP server, evaluation, and app-specific event triggers',
        detail:
          'n8n has dedicated trigger node types including a generic Webhook trigger, Schedule/Cron trigger, Chat trigger, Manual trigger, Evaluation trigger, MCP Server trigger (exposing workflows as MCP tools), and hundreds of app-specific triggers (e.g. Gmail, Slack, Google Sheets) that fire on native platform events.',
        shortValue: 'Webhook, cron, chat, MCP, app-specific events',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.evaluationtrigger/',
            label: 'n8n Evaluation Trigger node docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp/',
            label: 'MCP Client/Server Trigger docs',
            asOf: '2026-07-02',
          },
        ],
      },
      customCodeSteps: {
        value: 'Yes: JavaScript and Python via Code node, plus a Custom Code Tool for AI agents',
        detail:
          "n8n's Code node supports both JavaScript and Python for custom logic inside a workflow. A separate Custom Code Tool node lets an AI Agent call arbitrary code as one of its tools. n8n's own 2026 AI Agent Development Tools report scores n8n 1 out of 2 on \"Sandboxing,\" versus Sim's 2 out of 2, backed by Sim's isolated-vm (V8 isolate) sandbox running in a separate child process.",
        shortValue: 'JavaScript and Python via Code node',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/tools-agent',
            label: 'n8n Tools Agent docs (mentions Custom Code Tool)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://n8n.io/reports/2026-ai-agent-development-tools/#vendors',
            label: 'n8n: 2026 AI Agent Development Tools report (Sandboxing score)',
            asOf: '2026-07-02',
          },
        ],
      },
      apiPublishing: {
        value:
          'Yes: workflows can be triggered/exposed via Webhook trigger as a REST-style endpoint, and via MCP Server Trigger as MCP tools',
        detail:
          "A workflow's Webhook trigger node gives it a callable HTTP endpoint that functions as a REST API surface for that workflow. Separately, the MCP Server Trigger node lets a workflow (or its component tools) be published for external AI agents to call over MCP. No distinct SDK-generation feature was found in vendor docs.",
        shortValue: 'Webhook endpoints and MCP Server Trigger',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp/',
            label: 'MCP Server/Client Tool docs',
            asOf: '2026-07-02',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'No broad multi-language official SDK; extensibility is via the public REST API, the official n8n CLI, and a node-development toolkit',
        detail:
          "There is no first-party Python/Go/Java client. Instead, extensibility centers on four things: an official TypeScript package (@n8n/rest-api-client) that wraps n8n's public REST API; an n8n CLI for scripting, CI/CD, or agent use; a node-development kit (the n8n-node CLI plus scaffolding and code-standards docs) for building custom or community nodes in TypeScript, with an official verification program for submission; and a large community-nodes ecosystem, installable per self-hosted instance, alongside 400+ built-in integrations. n8n's own 2026 AI Agent Development Tools report scores n8n 0 out of 2 on \"A2A protocol\" (Agent2Agent interop), versus Sim's 2 out of 2, backed by Sim's dedicated A2A block.",
        shortValue: 'REST API, CLI, and node-development kit',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/api/',
            label: 'n8n public REST API Documentation | n8n Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.npmjs.com/package/@n8n/rest-api-client',
            label: '@n8n/rest-api-client - npm',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.n8n.io/integrations/creating-nodes/build/reference/code-standards/',
            label: 'Code standards | n8n Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://n8n.io/reports/2026-ai-agent-development-tools/#vendors',
            label: 'n8n: 2026 AI Agent Development Tools report (A2A protocol score)',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpPublishing: {
        value:
          "Yes: n8n has an MCP Server Trigger node that turns a workflow into a callable MCP server, exposing a stable production URL that external MCP clients can call to list and invoke the workflow's connected tool nodes (SSE and streamable HTTP supported).",
        detail:
          'n8n also offers an instance-level MCP server that lets an AI client create/validate/publish whole workflows, in addition to the per-workflow MCP Server Trigger.',
        shortValue: 'Yes, MCP Server Trigger node publishes workflows as MCP servers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcptrigger',
            label: 'MCP Server Trigger | n8n Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.n8n.io/advanced-ai/mcp/accessing-n8n-mcp-server/',
            label: 'Set up and use n8n MCP server | n8n Docs',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value: 'Per-workflow-execution pricing tiers (not per step, not per seat)',
        detail:
          "n8n's pricing page states workflows are billed by monthly execution count. A workflow that runs start-to-finish counts as one execution regardless of the number of steps or nodes, explicitly contrasted against competitors that charge per step or per user. Unlimited users are included at every paid tier.",
        shortValue: 'Billed by monthly workflow executions',
        confidence: 'verified',
        sources: [{ url: 'https://n8n.io/pricing/', label: 'n8n Pricing', asOf: '2026-07-02' }],
      },
      entryPaidPlan: {
        value: 'Starter plan: €20/month (billed annually), 2,500 executions/month, cloud-hosted',
        detail:
          'Starter includes 2,500 workflow executions per month, 5 concurrent executions, 1 shared project, unlimited users, 50 AI credits, and forum support.',
        shortValue: '€20/month, 2,500 executions',
        confidence: 'verified',
        sources: [{ url: 'https://n8n.io/pricing/', label: 'n8n Pricing', asOf: '2026-07-02' }],
      },
      freeTier: {
        value: 'Yes: free self-hosted Community Edition, plus a free cloud trial (no credit card)',
        detail:
          "The Community Edition is a free, self-hosted version of n8n runnable on a user's own infrastructure. Separately, n8n Cloud offers a free trial of the Starter/Pro plans without requiring a credit card.",
        shortValue: 'Free self-hosted edition and cloud trial',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/choose-how-to-use-n8n.md',
            label: 'n8n docs: Choose how to use n8n',
            asOf: '2026-07-02',
          },
          { url: 'https://n8n.io/pricing/', label: 'n8n Pricing', asOf: '2026-07-02' },
        ],
      },
      byok: {
        value:
          'De facto yes: all Chat Model nodes require users\' own provider API credentials, though not framed as a named "BYOK" feature',
        detail:
          "n8n's pricing page describes plan-included 'AI credits' (50/150/1,000 depending on tier) for its own hosted AI features, but does not explicitly state a bring-your-own-API-key policy. Because all Chat Model nodes require users to supply their own provider API credentials to call OpenAI, Anthropic, and others directly, BYOK is the de facto default for workflow-level LLM calls, though no vendor page names it as a distinct BYOK feature.",
        shortValue: 'De facto via provider API keys, not named',
        confidence: 'estimated',
        sources: [{ url: 'https://n8n.io/pricing/', label: 'n8n Pricing', asOf: '2026-07-02' }],
      },
    },
    security: {
      soc2: {
        value:
          "SOC 2: program 'aligned to' SOC 2 with annual third-party audits; report available to enterprise customers via Trust Center",
        detail:
          "n8n operates a Trust Center (trust.n8n.io, powered by SafeBase) covering security, compliance, privacy, and reliability. Per n8n's own materials, its security program is aligned to the SOC 2 framework with continuous evaluation and annual independent audits, and the SOC 2 report itself is provided to enterprise customers on request rather than published openly.",
        shortValue: 'Aligned to SOC 2, report on request',
        confidence: 'verified',
        sources: [
          { url: 'https://trust.n8n.io/', label: 'n8n Trust Center', asOf: '2026-07-02' },
          {
            url: 'https://support.n8n.io/article/request-for-soc-2-report',
            label: 'n8n Help Center: Request for SOC-2 report',
            asOf: '2026-07-02',
          },
          {
            url: 'https://n8n.io/legal/security/',
            label: 'Security | n8n',
            asOf: '2026-07-02',
          },
        ],
      },
      dataResidency: {
        value:
          'Yes: achievable via self-hosting; specific cloud data-residency regions not confirmed',
        detail:
          'Full self-hosting (Docker, Kubernetes, or npm, on any infrastructure including on-prem) gives complete control over where data lives. No source confirms specific selectable data-residency regions for n8n Cloud itself.',
        shortValue: 'Via self-hosting; cloud regions unconfirmed',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.n8n.io/choose-how-to-use-n8n.md',
            label: 'n8n docs: Choose how to use n8n',
            asOf: '2026-07-02',
          },
        ],
      },
      rbac: {
        value: 'Yes: role-based access control available on all plans except Community edition',
        detail:
          'RBAC manages access to workflows and credentials via projects and project roles, available on all plans except the free Community edition. Custom Project Roles (granular, admin-definable permissions) is an Enterprise-only feature.',
        shortValue: 'On all paid plans, not Community edition',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://blog.n8n.io/introducing-custom-project-roles-and-user-provisioning-via-sso-built-for-enterprise-governance/',
            label: 'n8n Blog: Custom Project Roles and SSO provisioning',
            asOf: '2026-07-02',
          },
        ],
      },
      auditLogging: {
        value: 'Yes: audit logging available, primarily an Enterprise-tier feature',
        detail:
          "n8n collects and centrally stores server/audit logs queryable by authorized users, retaining at least 12 months of history, with SIEM export/log streaming. Per the pricing page, unlimited execution log retention and enforced audit logging are listed under the Enterprise tier's feature set.",
        shortValue: 'Mainly an Enterprise-tier feature',
        confidence: 'estimated',
        sources: [{ url: 'https://n8n.io/pricing/', label: 'n8n Pricing', asOf: '2026-07-02' }],
      },
      additionalCompliance: {
        value:
          'GDPR (as data processor) and SOC 2 Type II / SOC 3; no HIPAA, ISO 27001, PCI, or FedRAMP certification found',
        detail:
          "n8n's Trust Center (SafeBase-hosted) and legal/security page list GDPR compliance (as a data processor with a standard DPA) and SOC 2 Type II plus a public SOC 3 report, with CAIQ self-assessment questionnaires available for both cloud and self-hosted deployments. No formal ISO 27001 certification, HIPAA certification/BAA, PCI-DSS, or FedRAMP was found on n8n's own trust materials. Third-party blog posts describe self-hosted n8n as helping organizations map to HIPAA/ISO 27001 requirements, but that is not the same as n8n holding those certifications itself.",
        shortValue: 'GDPR, SOC 2 Type II, SOC 3',
        confidence: 'verified',
        sources: [
          {
            url: 'https://trust.n8n.io/',
            label: 'n8n Trust Center | Powered by SafeBase',
            asOf: '2026-07-02',
          },
          { url: 'https://n8n.io/legal/security/', label: 'Security | n8n', asOf: '2026-07-02' },
          {
            url: 'https://support.n8n.io/article/request-for-soc-2-report',
            label: 'Request for SOC-2 report | n8n Help Center',
            asOf: '2026-07-02',
          },
        ],
      },
      modelAndToolGovernance: {
        value: 'Unknown',
        detail: 'Not publicly documented by n8n.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      credentialGovernance: {
        value:
          "Yes: n8n's RBAC model is scope-based, with custom project roles (Enterprise feature) letting admins grant or restrict access to specific credentials, workflows, and folders at a granular, per-resource level, beyond the built-in Admin/Editor/Viewer roles.",
        detail:
          'Custom Project Roles (Enterprise) let admins build least-privilege roles scoped to particular credentials/resources, not just feature-level RBAC.',
        shortValue: 'Yes, custom roles gate specific credentials',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/user-management/rbac/custom-roles/',
            label: 'Custom project roles | n8n Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://blog.n8n.io/introducing-custom-project-roles-and-user-provisioning-via-sso-built-for-enterprise-governance/',
            label: 'Introducing Custom Project Roles and User Provisioning via SSO',
            asOf: '2026-07-02',
          },
        ],
      },
      whiteLabeling: {
        value:
          "No: n8n's own OEM/embed documentation explicitly states n8n branding stays visible in the editor when embedded, and full white-labeling is not supported through their OEM offering; only self-hosted customers doing manual source-code modification (editing design-system CSS/Vue components and i18n text) can rebrand it themselves.",
        detail:
          'n8n\'s own docs say: "If full white-labeling is a hard requirement for your product, OEM isn\'t the right fit." Full rebrand only possible via unsupported self-hosted source modification.',
        shortValue: 'No, n8n branding stays visible even via OEM/embed',
        confidence: 'verified',
        sources: [
          {
            url: 'https://n8n.io/oem/',
            label: 'OEM | Embedded IPaaS | n8n',
            asOf: '2026-07-02',
          },
          {
            url: 'https://community.n8n.io/t/white-label-incorporate-n8n-in-your-product/18146',
            label: 'White label / Incorporate n8n in your product (n8n Community)',
            asOf: '2026-07-02',
          },
        ],
      },
      dataRetention: {
        value:
          'Yes: n8n lets self-hosted instances configure execution-data retention via environment variables (EXECUTIONS_DATA_MAX_AGE, EXECUTIONS_DATA_PRUNE_MAX_COUNT), and n8n Cloud Enterprise plans support up to 50,000 executions with unlimited retention versus fixed limits on lower tiers.',
        detail:
          'Default self-hosted retention is 336 hours (14 days) or 10,000 executions, both adjustable; Cloud tiers vary retention window by plan.',
        shortValue: 'Yes, configurable execution retention/pruning',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/hosting/scaling/execution-data/',
            label: 'Execution data | n8n Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.n8n.io/manage-cloud/cloud-data-management/',
            label: 'Cloud data management | n8n Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      piiRedaction: {
        value:
          'No: n8n has no built-in, native PII detection/redaction feature. PII masking is achieved only via community-built nodes or user-assembled workflows (regex/AI-based detection, tokenization) placed before an LLM call; a community feature request to scrub PII from execution logs remains open/unimplemented.',
        detail:
          'Execution log saving is documented as all-or-nothing today; a community request to add PII/secret scrubbing to logs is still open.',
        shortValue: 'No native PII redaction; only community workflows/nodes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://community.n8n.io/t/scrub-personally-identifiable-information-pii-from-execution-log/98552',
            label: 'Scrub PII from execution log (feature request, n8n Community)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://community.n8n.io/t/i-built-a-local-pii-redaction-node-for-n8n-because-my-clients-were-scared-to-use-openai-looking-for-feedback-testers/233573',
            label: 'Community-built local PII redaction node',
            asOf: '2026-07-02',
          },
        ],
      },
      sso: {
        value:
          "Yes: n8n supports SAML and OIDC single sign-on on Business/Enterprise plans, including automated user provisioning that assigns a user's instance role and project access from their identity-provider attributes on first login.",
        detail:
          'Works with Okta, Azure AD, or any SAML-compliant IdP. The role/project mapping is driven by IdP attributes named n8n_instance_role and n8n_projects, and is documented as part of Enterprise governance features.',
        shortValue: 'Yes, SAML/OIDC SSO with role auto-provisioning',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/user-management/saml/setup/',
            label: 'Set up SAML | n8n Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.n8n.io/user-management/oidc/setup/',
            label: 'Set up OIDC | n8n Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://blog.n8n.io/introducing-custom-project-roles-and-user-provisioning-via-sso-built-for-enterprise-governance/',
            label: 'User Provisioning via SSO, built for Enterprise governance',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Customer-facing Insights dashboard with per-workflow/per-node metrics, not span-level distributed tracing',
        detail:
          "n8n ships a native, customer-facing 'Insights' dashboard (Pro, Business, and Enterprise plans) showing per-workflow tables of total production executions, failed executions, failure rate, time saved, and time-series trends including P95 execution duration, workflow error rate, and node error rate. This is dashboard/metrics-level observability, not fine-grained span/trace-level tracing of internal node execution. That requires exporting to external tools like OpenTelemetry, SigNoz, or Grafana, which n8n supports feeding but doesn't natively render as spans.",
        shortValue: 'Dashboard metrics, not span-level tracing',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/insights/',
            label: 'Insights | n8n Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://signoz.io/docs/n8n-monitoring/',
            label: 'n8n Monitoring & Observability with OpenTelemetry | SigNoz Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      durabilityModel: {
        value:
          'Per-node retry-on-fail, workflow-level error workflow fallback, and manual/debug replay of past executions with original data; no automatic mid-run checkpoint/resume',
        detail:
          "Each node can be configured with 'Retry on Fail' (a configurable retry count and wait time between retries). Workflows can also define an Error Workflow, triggered by an Error Trigger node, that runs automatically on failure. For replay, n8n stores past execution data and offers 'Retry with original workflow' (re-runs using the original input data and workflow version from that run) or 'Retry with currently saved workflow' (re-runs that data against the current, edited workflow). Executions can also be opened via 'Debug in editor' to pin prior input data into the canvas. All of this is retry and replay from stored execution data, not automatic mid-workflow checkpointing that resumes from an arbitrary internal breakpoint after a crash.",
        shortValue: 'Per-node retry and manual replay, no checkpointing',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/flow-logic/error-handling/',
            label: 'Error handling | n8n Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.n8n.io/workflows/executions/debug/',
            label: 'Debug and re-run past executions | n8n Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      failureAlerting: {
        value:
          'Yes: proactive push notifications via an Error Workflow, not just execution-log lookup',
        detail:
          "Every workflow can be configured (in Workflow Settings) with a designated Error Workflow, which must start with an Error Trigger node. This fires automatically whenever the parent workflow's execution fails, and the Error Workflow can then push notifications through any channel node (Slack, email/Gmail, Teams, etc.) carrying the execution ID, workflow name, error message, and stack trace. This is proactive push alerting, distinct from passively browsing the executions list. N8n does not natively define cost- or latency-threshold alerting as a first-class feature; the Insights dashboard's P95 duration is queryable, not push-alerted, though teams can build threshold alerting on top via the Error Workflow/API plus external monitoring.",
        shortValue: 'Proactive alerts via Error Workflow',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/flow-logic/error-handling/',
            label: 'Error handling | n8n Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://n8n.io/workflows/1326-get-a-slack-alert-when-a-workflow-went-wrong/',
            label: 'Get a Slack alert when a workflow went wrong | n8n workflow template',
            asOf: '2026-07-02',
          },
        ],
      },
      dataDrains: {
        value:
          'Yes: n8n Enterprise plans include Log Streaming, which continuously sends workflow and audit events (n8n.workflow, n8n.audit, etc.) to external destinations configured as webhook, syslog, or Sentry.',
        detail:
          'No native built-in S3/BigQuery/Datadog connector type is documented; webhook/syslog/Sentry are the three destination types, with webhook usable to relay onward.',
        shortValue: 'Yes, Enterprise log streaming to external systems',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/log-streaming/',
            label: 'Log streaming | n8n Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.n8n.io/administer/observe-and-log/stream-logs-to-external-systems',
            label: 'Stream logs to external systems | n8n Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      asyncExecution: {
        value:
          'Yes: n8n supports async execution. The Webhook node\'s "Respond" setting can be set to "Immediately," which sends back an HTTP response (with the message "Workflow got started") right away while the workflow keeps running in the background; n8n\'s Wait node can also pause a running execution (persisting its state to the database) and resume later on a time interval or an incoming webhook call.',
        detail:
          'This is a workflow-level pattern (respond-then-continue, or pause-and-resume), not a single unified async job-polling API documented as a first-class feature; callers needing a result must build their own callback or a second polling endpoint.',
        shortValue: 'Yes, via immediate-respond webhook + Wait node',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/',
            label: 'n8n Docs: Webhook node (Respond options, incl. "Immediately")',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait',
            label: 'n8n Docs: Wait node',
            asOf: '2026-07-02',
          },
        ],
      },
      executionLimits: {
        value:
          "n8n publishes concrete configurable limits: EXECUTIONS_TIMEOUT (default -1, disabled) sets a default per-workflow timeout in seconds and EXECUTIONS_TIMEOUT_MAX (default 3600 seconds, i.e. 1 hour) caps how long any individual workflow's timeout override can be set to; concurrency is capped by N8N_CONCURRENCY_PRODUCTION_LIMIT for production (webhook/trigger-started) executions, with excess runs queued and processed FIFO once capacity frees up. In queue mode, each worker's parallel job count is configurable via a --concurrency flag.",
        detail:
          "These are self-hosted environment-variable defaults from n8n's own docs; n8n Cloud plans may impose their own separate execution/concurrency caps that were not found on a currently-live docs page during this research. The specific default value of the worker --concurrency flag was not confirmed on a currently-live docs page.",
        shortValue: 'Configurable timeout (max 3600s) and concurrency limits',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/use-environment-variables/executions',
            label:
              'n8n Docs: Executions environment variables (EXECUTIONS_TIMEOUT, EXECUTIONS_TIMEOUT_MAX)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/control-concurrency',
            label:
              'n8n Docs: Control concurrency (N8N_CONCURRENCY_PRODUCTION_LIMIT, FIFO queueing, worker --concurrency)',
            asOf: '2026-07-02',
          },
        ],
      },
      partialFailureHandling: {
        value:
          'Yes: n8n lets you set a per-node "On Error" behavior of "Continue (using error output)," which routes that node\'s error down a separate error output branch while the rest of the workflow keeps running, in addition to "Continue" (proceed using last valid data) and "Stop Workflow" (halt entirely); separately, an entire workflow can have a designated Error Workflow (built from an Error Trigger node) that fires when the main workflow fails, for alerting/cleanup.',
        detail:
          'Community bug reports (e.g. on the Sort and HTTP Request nodes) show the error-output routing does not always behave consistently for every node type, so this capability is real but not universally bulletproof across all nodes.',
        shortValue: 'Yes, via node-level error output branch',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.n8n.io/build/understand-workflows/workflow-components/work-with-nodes',
            label:
              'n8n Docs: Work with nodes (On Error: Stop Workflow / Continue / Continue Using Error Output)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.errortrigger',
            label: 'n8n Docs: Error Trigger node',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value: 'Community forum (all tiers), plus direct/dedicated support on paid tiers',
        detail:
          "n8n's pricing page lists 'forum support' for Starter, escalating access on Pro/Business, and 'dedicated SLA support' at Enterprise; a separate n8n Help Center / Support Center and Discord/GitHub serve as community channels.",
        shortValue: 'Forum on all tiers, dedicated on paid',
        confidence: 'estimated',
        sources: [
          { url: 'https://n8n.io/pricing/', label: 'n8n Pricing', asOf: '2026-07-02' },
          {
            url: 'https://support.n8n.io/article/scope-of-support',
            label: 'n8n Help Center: Scope of Support',
            asOf: '2026-07-02',
          },
        ],
      },
      sla: {
        value: 'Yes: SLA-backed support only on the Enterprise plan',
        detail:
          "n8n's community support materials state there are no SLAs or severity-based prioritization for non-Enterprise customers. A documented SLA with response-time guarantees (contractually defined; community sources describe P1 targets in the 1-4 hour range) is only available to Enterprise customers.",
        shortValue: 'SLA support on Enterprise plan only',
        confidence: 'estimated',
        sources: [{ url: 'https://n8n.io/pricing/', label: 'n8n Pricing', asOf: '2026-07-02' }],
      },
      community: {
        value: 'Large community: ~195k GitHub stars, ~82k Discord members, 30k+ forum members',
        detail:
          'The n8n-io/n8n GitHub repository shows about 194,939 stargazers (via GitHub API). The n8n Discord server is cited by third-party community trackers at roughly 82,422 members. The official n8n Community Forum is described as having 30k+ members.',
        shortValue: '~195k GitHub stars, ~82k Discord members',
        confidence: 'verified',
        sources: [
          {
            url: 'https://api.github.com/repos/n8n-io/n8n',
            label: 'GitHub API: n8n-io/n8n repo',
            asOf: '2026-07-02',
          },
          { url: 'https://community.n8n.io/', label: 'n8n Community Forum', asOf: '2026-07-02' },
        ],
      },
      companyMaturity: {
        value:
          'Founded 2019 in Berlin. Raised a $180M Series C in October 2025 (Accel-led) at a $2.5B valuation, $240M total raised. Valuation rose to $5.2B in May 2026 following a strategic investment from SAP. Roughly 900-1,000 employees as of mid-2026 per multiple employee-tracking sources (Tracxn, RocketReach, LeadIQ, Revelio).',
        detail:
          'n8n GmbH was founded in 2019 and is headquartered in Berlin, Germany. It raised a $180M Series C announced October 9, 2025, led by Accel with participation from Meritech, Redpoint, Evantic, and Visionaries Club, plus corporate investors NVIDIA and T.Capital, valuing the company at $2.5B and bringing total funding to $240M. In May 2026, SAP made a strategic investment that valued n8n at $5.2B. Employee-count trackers report roughly 900-1,000 employees as of mid-2026.',
        shortValue: 'Berlin, 2019; $5.2B valuation, ~1,000 staff',
        confidence: 'verified',
        sources: [
          {
            url: 'https://blog.n8n.io/series-c/',
            label: 'n8n raises $180m to get AI closer to value with orchestration – n8n Blog',
            asOf: '2026-07-02',
          },
          {
            url: 'https://ventureburn.com/n8n-series-c-funding/',
            label: 'n8n Secures $180 Million Series C Funding, Hits $2.5 Billion Valuation',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pitchbook.com/profiles/company/398691-46',
            label: 'n8n 2026 Company Profile: Valuation, Funding & Investors | PitchBook',
            asOf: '2026-07-02',
          },
          {
            url: 'https://blog.n8n.io/n8n-sap/',
            label: "Announcing SAP's strategic investment in n8n – n8n Blog",
            asOf: '2026-07-02',
          },
        ],
      },
      academy: {
        value:
          'Yes: n8n runs an official n8n Academy (learn.n8n.io) with structured, hands-on courses (e.g. N8N101 Essentials, N8N102 Integrations) offering badges and certificates of completion, plus a free beginner certification course.',
        detail:
          'Includes N8N101/N8N102 learning paths, quizzes, badges, and certificates; separate from ad hoc docs/blog content.',
        shortValue: 'Yes, official Academy with certification courses',
        confidence: 'verified',
        sources: [
          {
            url: 'https://learn.n8n.io/',
            label: 'n8n Academy',
            asOf: '2026-07-02',
          },
          {
            url: 'https://blog.n8n.io/announcing-the-n8n-certification-course-for-beginners-level-1/',
            label: 'Announcing the n8n Certification Course for Beginners',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.n8n.io/learning-paths',
            label: 'Learning paths | n8n Docs',
            asOf: '2026-07-02',
          },
        ],
      },
    },
  },
}
