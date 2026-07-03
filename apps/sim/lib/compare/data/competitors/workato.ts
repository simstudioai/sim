import { WorkatoIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Researched and cross-verified against live vendor sources on 2026-07-02. */
export const workatoProfile: CompetitorProfile = {
  id: 'workato',
  name: 'Workato',
  website: 'https://www.workato.com',
  brand: {
    icon: WorkatoIcon,
    selfFramed: true,
    colors: ['#62dfd2', '#418484', '#151716'],
    description:
      'Workato is a Palo Alto‑based integration and automation platform that enables enterprises to orchestrate applications, data, and processes using AI‑driven agents. Leveraging its proprietary Enterprise Model Context Protocol (MCP), Workato delivers secure, scalable, and accurate AI agents that move from the edge of business operations to the core, allowing real‑time, enterprise‑wide automation. Trusted by over half of the Fortune 500, the platform connects every application and data source, providing end‑to‑end workflow automation and intelligent orchestration for the agentic era.',
    industries: [
      'Software (B2B)',
      'Developer Tools & APIs',
      'Artificial Intelligence & Machine Learning',
      'Data Infrastructure & Analytics',
    ],
    socials: [
      { type: 'x', url: 'https://x.com/workato' },
      { type: 'linkedin', url: 'https://linkedin.com/company/workato' },
      { type: 'instagram', url: 'https://instagram.com/workatohq' },
      { type: 'facebook', url: 'https://facebook.com/workato' },
      { type: 'youtube', url: 'https://youtube.com/@Workato' },
    ],
    source: 'Context.dev brand-intelligence API',
    asOf: '2026-07-02',
  },
  oneLiner:
    'Workato is a cloud-based enterprise integration platform that has extended its workflow automation engine with an AI-agent layer (Agent Studio, "Genies") and native Model Context Protocol (MCP) server support, for building, orchestrating, and governing AI agents across connected business systems.',
  standoutFeatures: [
    {
      title: 'Enterprise MCP server hosting',
      description:
        'Workato exposes existing recipes and workflows as MCP tools through pre-built and remote/cloud-hosted MCP servers, letting any MCP-compatible client (Claude, ChatGPT, Agent Studio) dynamically discover and call enterprise workflows as agent tools without custom integration code.',
      shortDescription: 'Recipes and workflows exposed as MCP tools for any compatible client.',
      source: {
        url: 'https://docs.workato.com/mcp.html',
        label: 'MCP | Workato docs',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'On-prem agent for hybrid connectivity',
      description:
        "A downloadable on-prem agent runs inside the customer's data center, tunneling via TLS websocket to Workato's cloud so the platform can reach on-prem apps, databases (SAP, Oracle EBS, SQL Server), and file servers without opening inbound firewall ports; agents can be grouped for high availability.",
      shortDescription:
        'TLS-tunneled agent connects on-prem apps and databases without opening firewall ports.',
      source: {
        url: 'https://docs.workato.com/on-prem/agents.html',
        label: 'On-prem agent | Workato docs',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Broad compliance certification set',
      description:
        'Workato holds SOC 1/2/3, PCI-DSS v4.0.1 Level 1, ISO 27001/27701/42001, HIPAA (with BAAs), IRAP, and NIST 800-171A r2 certifications, a wide compliance footprint for an integration/agent platform.',
      shortDescription:
        'Wide compliance footprint spanning SOC, ISO, HIPAA, PCI-DSS, IRAP, and NIST.',
      source: {
        url: 'https://docs.workato.com/security/security-compliance.html',
        label: 'Security compliance | Workato docs',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Bring-Your-Own-LLM for Agent Studio',
      description:
        "Customers can power Genies with their own OpenAI or Anthropic API credentials instead of Workato's managed model contracts, giving direct control over LLM cost and vendor choice for agent workloads.",
      shortDescription: 'Genies can run on customer-supplied OpenAI or Anthropic API keys.',
      source: {
        url: 'https://www.workato.com/product-hub/changelog/bring-your-own-llm-byollm-support-for-agent-studio/',
        label: 'Bring Your Own LLM (BYOLLM) Support for Agent Studio | Workato Product Hub',
        asOf: '2026-07-02',
      },
    },
  ],
  limitations: [
    {
      title: 'No published self-serve pricing',
      description:
        "Workato's own pricing page contains no plan names, prices, or free-tier terms. It routes every visitor to a sales demo or trial request, making cost comparison and self-serve adoption difficult versus vendors with transparent pricing.",
      shortDescription: 'Pricing page has no figures. Every visitor is routed to sales.',
      source: {
        url: 'https://www.workato.com/pricing',
        label: 'Workato Pricing Model | Workato',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Not open source / not self-hostable',
      description:
        "Workato is a proprietary, cloud-hosted SaaS platform. The only on-prem component is a lightweight connectivity agent bridging the customer's private network to Workato's cloud. The platform's builder, execution engine, and agent runtime cannot be run entirely on customer infrastructure.",
      shortDescription: 'Proprietary SaaS only. The builder and runtime cannot run on-prem.',
      source: {
        url: 'https://docs.workato.com/on-prem.html',
        label: 'On-prem connectivity | Workato Docs',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Native LLM choice limited to two providers',
      description:
        "AI Hub's native model picker for Genies covers Anthropic Claude and OpenAI GPT (plus BYOLLM for those same two providers); reaching other providers like Google Gemini or Amazon Bedrock requires going through separate integration connectors rather than a first-class in-agent model switch.",
      shortDescription: 'Native model picker covers only Claude and GPT; others need connectors.',
      source: {
        url: 'https://docs.workato.com/connectors/ai-by-workato.html',
        label: 'AI by Workato | Workato docs',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Knowledge base ingestion limited to text/PDF out of the box',
      description:
        "Workato's documented Knowledge Base Accelerator pattern natively supports only text and PDF document formats for RAG ingestion; support for other formats requires extending the accelerator yourself.",
      shortDescription: 'RAG ingestion natively supports only text and PDF documents.',
      source: {
        url: 'https://docs.workato.com/en/agentic/agent-studio/knowledge-bases/knowledge-bases.html',
        label: 'Knowledge bases | Workato Docs',
        asOf: '2026-07-02',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'Hybrid: a low-code/visual "recipe" builder (trigger and action steps), a code-based Custom SDK for connectors, and a separate AI-agent builder (Agent Studio) for defining agent "skills", knowledge bases, and reasoning. Recipe Copilot can draft a recipe skeleton from a plain-language description.',
        shortValue: 'Visual recipe builder, Agent Studio, and a code SDK',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/recipes/building-recipes.html',
            label: 'Recipe Design | Workato docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/recipes/using-recipe-copilot.html',
            label: 'Copilot in Recipe building | Workato docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/agentic/agentic.html',
            label: 'Agentic | Workato docs',
            asOf: '2026-07-02',
          },
        ],
      },
      learningCurve: {
        value: 'Unknown',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      selfHostOption: {
        value:
          'Core platform is not self-hostable (SaaS-only, proprietary). Workato provides an on-premises "on-prem agent" that runs behind a customer firewall and tunnels via TLS websocket to the Workato cloud, giving hybrid connectivity to on-prem apps and databases without opening firewall ports. This is a connectivity bridge, not a self-hosted deployment of the platform itself.',
        shortValue: 'SaaS-only; on-prem agent only bridges connectivity',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/on-prem.html',
            label: 'On-prem connectivity | Workato Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/on-prem/agents.html',
            label: 'On-prem agent | Workato docs',
            asOf: '2026-07-02',
          },
        ],
      },
      deploymentOptions: {
        value:
          'Cloud-hosted SaaS platform (multi-region data centers) with an optional on-prem agent for hybrid/on-prem app and database connectivity; the on-prem agent itself can run on AWS/Azure/GCP VMs or a private physical/virtual machine',
        shortValue: 'Cloud SaaS with optional on-prem connectivity agent',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/on-prem/agents.html',
            label: 'On-prem agent | Workato docs',
            asOf: '2026-07-02',
          },
        ],
      },
      templates: {
        value:
          'Yes: a Community Library provides pre-built, cloneable "recipes" (workflow templates), connectors, and "skill recipes" across use cases like AI/ML, Finance, and Operations that users can customize',
        shortValue: 'Community Library of prebuilt recipes and connectors',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/community-library.html',
            label: 'Community library | Workato Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      license: {
        value: 'Proprietary',
        shortValue: 'Proprietary',
        confidence: 'verified',
        sources: [
          { url: 'https://www.workato.com/', label: 'Workato homepage', asOf: '2026-07-02' },
        ],
      },
      environmentPromotion: {
        value:
          'Yes: dedicated Development/Test/Production environments with project-level promotion',
        detail:
          "Workato's Environments feature gives every workspace built-in Dev, Test, and Production environments, each with its own assets, members, and projects. Deployment pushes an entire project's recipes and assets from Development to Test or Production. This is one-directional promotion, not free-form branching, and collaborators need deployment privileges on both the source and target environments. Separately, the Workato Platform CLI supports `workato push`/`workato pull` for git-based, code-first management of project assets across dev/staging/prod configurations. This is a genuine full-project promotion model, not just single-workflow versioning.",
        shortValue: 'Dev/Test/Prod environments with project-level promotion',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/features/environments.html',
            label: 'Environments | Workato docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/features/environments/deployment.html',
            label: 'Environments - Understanding project deployment with environments',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/features/environments/deploying-projects-to-an-environment.html',
            label: 'Environments - Deploying A Project To An Environment',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/platform-cli/use-cases.html',
            label: 'Workato Platform CLI example use cases',
            asOf: '2026-07-02',
          },
        ],
      },
      versionControlDepth: {
        value: 'Automatic version history + visual diff + restore; no true branching',
        detail:
          "Every recipe save automatically creates a new numbered version with timestamp and author. The Versions tab lets users pick any two versions and view a visual, side-by-side Recipe Diff (added steps green, removed steps red, changed configs blue, down to field-level changes). Users can restore/revert to a prior healthy version from version history (rollback), functioning as a persisted, server-side undo mechanism. No git-style branching of a single recipe exists. Branching-like behavior instead comes from the Development/Test/Production environment model and the Platform CLI's git integration.",
        shortValue: 'Version history, visual diff, and restore, no branching',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/recipes/version-management.html',
            label: 'Recipe Version Management | Workato docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/recipe-development-lifecycle/compare-versions-with-recipe-diff.html',
            label: 'Using a recipe diff to compare recipe changes',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.workato.com/product-hub/compare-any-two-versions-of-a-recipe-with-visual-recipe-diffs/',
            label: 'Visual Recipe Diff: Compare any two versions of a recipe',
            asOf: '2026-07-02',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          'No: Workato does not support live, concurrent multi-user editing of the same recipe with shared cursors. Instead, it shows which teammate is currently editing a recipe and warns or blocks a second editor from opening it at the same time (a presence/lock-style safeguard), plus versioning and change-tracking for asynchronous collaboration.',
        detail:
          "Workato's 'collaboration safeguards' show who is editing and prompt a choice to wait or override, which is closer to file-level locking than true real-time co-editing.",
        shortValue: 'No: presence warning, not live co-editing',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/recipes/collaboration-safeguards.html',
            label: 'Workato Docs: Recipes - Collaboration safeguards',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/user-accounts-and-teams/team-collaboration.html',
            label: 'Workato Docs: Workspace collaboration',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeFileStorage: {
        value:
          'Partial: Workato FileStorage supports creating/storing files and organizing them into directories (folder hierarchy) within a recipe, but no live public documentation describes password-protected or link-based external sharing, or a deleted-item recovery view.',
        detail:
          'Access to FileStorage itself requires Customer Success enablement on certain plans; a previously-cited "generate shareable file link" doc page could not be verified live and was removed.',
        shortValue: 'Partial: folders exist, no confirmed link sharing',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.workato.com/features/workato-filestorage.html',
            label: 'Workato Docs: Workato FileStorage',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/features/filestorage/create-directory-action.html',
            label: 'Workato Docs: FileStorage - Create directory action',
            asOf: '2026-07-02',
          },
        ],
      },
      dataTables: {
        value:
          'Yes: Workato has a native Data Tables feature, a spreadsheet-like store with columns/rows supporting up to 1,000,000 records per table, plus filter/sort/hide-column controls in the UI, distinct from external database connectors.',
        detail:
          'Public docs describe filter, sort, and column visibility controls; no explicit confirmation found of full spreadsheet-style keyboard navigation (arrow-key cell traversal, multi-cell copy-paste) in the interface.',
        shortValue: 'Yes: native Data Tables, up to 1M rows',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/data-tables.html',
            label: 'Workato Docs: Data tables',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/data-tables/data-table-limits.html',
            label: 'Workato Docs: Data tables - Limits',
            asOf: '2026-07-02',
          },
        ],
      },
      richTextEditor: {
        value:
          'Unknown: no public documentation was found describing an inline rich-text/WYSIWYG markdown document editor as a platform feature within Workato.',
        detail:
          "Searches surfaced only third-party markdown editor tools, not a Workato-native document editor; Workato's product surface (recipes, data tables, knowledge bases) does not appear to include a general-purpose rich-text document editor akin to a Notion-style editor.",
        shortValue: 'Unknown: no evidence found',
        confidence: 'unknown',
        sources: [],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          "AI Hub natively lets users pick Anthropic Claude or OpenAI GPT models to power Genies/agents (Workato states AI by Workato processes most regions with Anthropic Sonnet 4, and Israel data center traffic with OpenAI GPT-4o mini); Agent Studio also supports Bring-Your-Own-LLM (BYOLLM) with the customer's own OpenAI or Anthropic credentials; broader integration to Google Gemini, Amazon Bedrock, Azure OpenAI etc. is available via pre-built connectors rather than a native model switcher",
        shortValue: 'Claude or GPT natively, BYOLLM, others via connectors',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/connectors/ai-by-workato.html',
            label: 'AI by Workato | Workato docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.workato.com/product-hub/changelog/bring-your-own-llm-byollm-support-for-agent-studio/',
            label: 'Bring Your Own LLM (BYOLLM) Support for Agent Studio | Workato Product Hub',
            asOf: '2026-07-02',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          'Yes: Agent Studio provides dedicated AI-agent constructs ("Genies") with skills, knowledge bases, and autonomous decision logic distinct from plain trigger/action data-routing recipes; pre-built departmental Genies (IT, Sales, HR, Support, CX, Marketing) are offered alongside custom agent building',
        shortValue: 'Genies agents with skills and knowledge bases',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/agentic/agentic.html',
            label: 'Agentic | Workato docs',
            asOf: '2026-07-02',
          },
          { url: 'https://www.workato.com/', label: 'Workato homepage', asOf: '2026-07-02' },
        ],
      },
      naturalLanguageBuilding: {
        value:
          'Yes: Recipe Copilot lets a user describe an automation in plain language; it drafts a recipe outline, sets up connections after confirmation, and auto-converts the sketch into a working recipe with AI-suggested data-pill/field mappings for review',
        shortValue: 'Recipe Copilot drafts recipes from plain language',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/recipes/using-recipe-copilot.html',
            label: 'Copilot in Recipe building | Workato Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          'Yes: Agent Studio supports "knowledge bases" as a Genie\'s memory (ingesting documents/data with a vector-embedding pattern for RAG); a Knowledge Base Accelerator uses a prompt-engineering + vector-embedding-database pattern, natively supporting text and PDF formats, extensible via connectors to other LLM/vector-DB providers',
        shortValue: 'Knowledge bases for RAG via vector embeddings',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/en/agentic/agent-studio/knowledge-bases/knowledge-bases.html',
            label: 'Knowledge bases | Workato Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.workato.com/the-connector/knowledge-base-ai/',
            label: "How Generative AI Unlocks Your Organization's Knowledge Base | Workato",
            asOf: '2026-07-02',
          },
        ],
      },
      mcpSupport: {
        value:
          'Yes: Workato ships an "Enterprise MCP" offering: it can act as an MCP server exposing existing recipes/workflows as tools/skills to any MCP-compatible client (Claude, ChatGPT, Agent Studio), including pre-built MCP servers and remote/cloud-hosted MCP servers configurable from AI Hub > MCP servers, plus Local MCP support with fine-grained, API-token-linked access control',
        shortValue: 'Acts as an MCP server exposing recipes as tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/mcp.html',
            label: 'MCP | Workato docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/en/mcp/remote-mcp-servers.html',
            label: 'Remote MCP servers | Workato Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.workato.com/the-connector/workato-mcp/',
            label: 'Workato Enterprise MCP: The Future of Agentic Automation',
            asOf: '2026-07-02',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'Partial: Agent Studio "skills" maintain version history, allow comparing versions, rolling back, and running test cases against a specific version; governance is enforced via RBAC, audit logging, and encryption rather than a dedicated eval/benchmark suite or red-teaming guardrail tooling',
        shortValue: 'Version rollback and test runs, no dedicated eval suite',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.workato.com/agentic/agentic.html',
            label: 'Agentic | Workato docs',
            asOf: '2026-07-02',
          },
        ],
      },
      humanInTheLoop: {
        value: 'Yes, via Wait/Wait-for-resume actions and Workbot approval messages',
        detail:
          "Workato provides dedicated wait mechanisms distinct from a plain timed delay. 'Wait for Async Calls' pauses a recipe until an external event or call completes; connector SDK 'wait-for-resume' actions let a custom connector pause a recipe and resume later via an external trigger or webhook. For approvals specifically, Workbot for Slack has a 'Wait for user action in messages' action: the recipe posts an interactive Slack message and pauses, and the run resumes when the designated approver clicks an action button in Slack, or auto-proceeds/expires with an Expired flag if a timeout elapses. This is a purpose-built pause-for-human-approval mechanism, not a generic sleep/delay step.",
        shortValue: 'Wait actions and Slack approval workflows',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/workbot/wait-for-user-action.html',
            label: 'Workbot actions for Slack - Wait for user action in messages',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/features/callable-recipes/wait-for-async-action.html',
            label: 'Callable Recipes - Wait for async calls action',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/developing-connectors/sdk/guides/building-actions/wait-for-resume-actions.html',
            label: 'Wait for resume actions | Workato docs',
            asOf: '2026-07-02',
          },
        ],
      },
      generativeMedia: {
        value:
          "Text-only natively. Workato's own 'AI by Workato' utility connector has no generation actions. But a pre-built OpenAI connector adds a native 'Generate Images' (DALL-E) action for image generation. No native video or audio generation block exists.",
        detail:
          "Workato's own 'AI by Workato' utility connector (built on Anthropic/OpenAI models) exposes only text/analysis actions: analyze image (vision/analysis, not generation), categorize text, draft email, parse text, summarize text, translate text. Generative-media capability beyond image generation would have to be assembled via generic HTTP/connector calls to third-party providers (e.g., ElevenLabs) rather than a first-party block.",
        shortValue: 'Image generation via OpenAI connector, no native video/audio',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/connectors/ai-by-workato.html',
            label: 'AI by Workato | Workato docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.workato.com/platform/ai-by-workato',
            label: 'AI by Workato | Streamline Processes and Workflows',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/connectors/openai/generate-images.html',
            label: 'Workato Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      dynamicToolUse: {
        value: 'Unknown',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      modelFallback: {
        value: 'Unknown',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      agentSkills: {
        value:
          "Yes: Workato Agent Studio has a 'Skills' concept where reusable recipes/skill definitions (with a structured skill prompt describing purpose, when to use/not use, inputs and outputs) can be assigned to and shared across multiple Genies and MCP servers within a project, avoiding duplication.",
        detail:
          'Skills are backed by recipes (750K+ reusable recipes/skills referenced) and include a templated skill-prompt format, matching the named reusable prompt/knowledge-snippet pattern.',
        shortValue: 'Yes: reusable Skills shared across Genies',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/agentic/skills',
            label: 'Workato Docs: Skills',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.workato.com/agentstudio',
            label: 'Workato: Agent Studio',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeChatDeployment: {
        value:
          'Yes: Workato Genies (agents built in Agent Studio) can be deployed with a native chat interface, publishable to Slack, Microsoft Teams, Workato GO, or embedded in custom internal chatbots, with real-time back-and-forth conversation.',
        shortValue: 'Yes: Genie chat interface (Slack, Teams, Workato GO)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/agentic/agent-studio/chat-interface/chat-interface.html',
            label: 'Workato Docs: Chat interface',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/en/agentic/agent-studio/conversations.html',
            label: 'Workato Docs: Conversations page',
            asOf: '2026-07-02',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          "No: Workato's knowledge base documentation describes chunking as the underlying retrieval mechanism (content is split into fragments/entries and retrieval returns the most semantically similar fragments), but no chunk-index or fragment-level debug view was found; debugging retrieval issues relies on tracing back to the source document/URL rather than inspecting individual chunk content in a dedicated UI.",
        detail:
          'Docs mention source URLs help identify which document a bad fragment came from, which implies fragment-level awareness exists internally, but a chunk index/content inspector as a user-facing feature is not documented.',
        shortValue: 'No: no chunk-level debug view documented',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.workato.com/en/agentic/agent-studio/knowledge-bases/knowledge-bases.html',
            label: 'Workato Docs: Knowledge bases',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/en/agentic/agent-studio/knowledge-bases/data-ingestion.html',
            label: 'Workato Docs: Knowledge base data ingestion',
            asOf: '2026-07-02',
          },
        ],
      },
      parallelExecution: {
        value:
          'No: Workato recipe steps documentation describes IF/ELSE branching and repeat loops as sequential control-flow constructs; no dedicated fan-out/fan-in step that runs multiple branches concurrently and joins them back was found. Workato does support running independent async calls alongside a wait step, and recipe-level concurrency settings control how many separate job instances run at once, but these are distinct from a single-run parallel-branches feature.',
        detail:
          'Multi-threaded custom connector actions (SDK feature) can issue concurrent API requests within one action, but that is a connector-development capability, not a native workflow step available to recipe builders.',
        shortValue: 'No: no native parallel-branches step documented',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.workato.com/recipes/steps.html',
            label: 'Workato Docs: Steps',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/features/callable-recipes/wait-for-async-action.html',
            label: 'Workato Docs: Callable Recipes - Wait for async calls action',
            asOf: '2026-07-02',
          },
        ],
      },
      a2aProtocol: {
        value:
          'Yes: Workato\'s Agentic platform documents an A2A Protocol connector that lets Workato "genies" (its AI agents) call any A2A-compliant external agent as a peer, discovering it via its Agent Card and delegating tasks over HTTP/JSON-RPC, with both synchronous and asynchronous call patterns supported.',
        detail:
          'This is distinct from MCP-style tool-calling: the A2A connector treats the remote system as an autonomous agent (discovered via its Agent Card) that can be delegated a task, not just a tool invoked for a single function result.',
        shortValue: 'Yes: dedicated A2A Protocol connector for genies',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/agentic/agentic.html',
            label: 'Workato Docs: Agentic',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/en/connectors/a2a.html',
            label: 'Workato Docs: A2A Protocol connector',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value:
          'Workato\'s own integrations page cites "thousands of SaaS apps, databases, and ERPs" without a precise total; its on-prem connectivity docs cite 300+ cloud and on-premise applications specifically for out-of-the-box on-prem connectivity. Third-party sources put the broader library above 1,200 connectors, though the vendor does not publish that figure directly.',
        shortValue: 'Thousands of connectors; 300+ documented for on-prem',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.workato.com/integrations',
            label: 'Workato Integration Library | Pre-Built Connectors for Apps | Workato',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.workato.com/the-connector/workato-on-premise-integration/',
            label: 'On-Premise Integration: How to Connect Cloud & On-Prem Apps | Workato',
            asOf: '2026-07-02',
          },
        ],
      },
      triggerTypes: {
        value:
          'Recipe types include workflow recipes (event/webhook/scheduled triggers), API recipes (published as REST endpoints), data pipeline recipes, app event recipes, and knowledge base recipes',
        shortValue: 'Workflow, API, data pipeline, app event, and KB recipes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.prowesssoft.com/workato-recipes/',
            label: 'Workato Recipes Explained for Enterprise Automation',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/recipes.html',
            label: 'Recipes | Workato docs',
            asOf: '2026-07-02',
          },
        ],
      },
      customCodeSteps: {
        value:
          'Not documented whether recipes support inline custom-code steps (e.g. Ruby/JS snippets); Workato does offer a Ruby-based Custom SDK for building custom connectors, a related but separate capability',
        shortValue: 'Unclear; Ruby SDK exists for custom connectors',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.workato.com/developing-connectors.html',
            label: 'Universal connectors | Workato Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      apiPublishing: {
        value:
          'Yes: Workato supports "API recipes" that expose a recipe as a REST API endpoint, callable by external clients',
        shortValue: 'API recipes expose workflows as REST endpoints',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.prowesssoft.com/workato-recipes/',
            label: 'Workato Recipes Explained for Enterprise Automation',
            asOf: '2026-07-02',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Ruby-based Connector SDK + open community connector library, no first-party multi-language client SDK found',
        detail:
          "Workato's Connector SDK lets developers build custom connectors in Ruby, with a local SDK Emulator (the open-source `workato-connector-sdk` gem on GitHub) for offline development, testing, and git-based versioning outside the cloud editor. Custom connectors can be published to Workato's Community Library (install-and-customize, open-source style) or submitted as Partner Connectors for native review and listing across all workspaces, functioning as a connector marketplace. Workato also exposes a full platform API (recipes, connectors, jobs) for programmatic control, plus a separate Platform CLI for asset sync. There is no official multi-language client SDK (e.g., Python/JS/Go) for calling the Workato API beyond the Ruby connector-development kit and the generic REST API.",
        shortValue: 'Ruby Connector SDK plus community connector library',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/developing-connectors/sdk.html',
            label: 'Developer program | Workato docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/workato/workato-connector-sdk',
            label: 'GitHub - workato/workato-connector-sdk',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/developing-connectors/community/community',
            label: 'Community connectors | Workato Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/developing-connectors/community/community-listing.html',
            label: 'Contributing your connector | Workato Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/workato-api/api-connectors.html',
            label: 'Workato API - Connectors | Workato Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpPublishing: {
        value:
          "Yes: Workato lets builders publish recipes/Genies as Enterprise Skills exposed through a managed MCP server hosted in Workato's AI Hub, so external AI tools (Claude, Cursor, other MCP clients) can call Workato automations as MCP servers, in addition to Genies acting as MCP clients that consume external MCP servers.",
        detail:
          'This confirms the prior signal about Genies: Workato ships genuine bidirectional MCP support, both publishing (recipes/Genies as MCP servers) and consuming (Genies as MCP clients).',
        shortValue: 'Yes: Genies/recipes publishable as MCP servers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.workato.com/the-connector/workato-mcp/',
            label: 'Workato: Enterprise MCP - The Future of Agentic Automation',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.workato.com/agentic/mcp',
            label: 'Workato: Enterprise MCP product page',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/en/mcp/genies-as-mcp-clients.html',
            label: 'Workato Docs: Genies as MCP clients',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.workato.com/product-hub/changelog/genies-now-support-external-mcp-servers/',
            label: 'Workato Product Hub: Genies now support external MCP servers',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Custom, sales-quoted, consumption-based pricing combining a platform/edition subscription fee with usage charges metered mainly in "tasks"/"Workload Units" (individual automated actions); no self-serve list prices are published',
        shortValue: 'Custom quoted pricing metered in tasks/Workload Units',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.workato.com/pricing',
            label: 'Workato Pricing Model | Workato',
            asOf: '2026-07-02',
          },
        ],
      },
      entryPaidPlan: {
        value:
          "No published starting price. Workato's pricing page is sales-led (demo/trial request only). Third-party pricing-intelligence sites report a Standard/Starter tier in the range of roughly $2,000–$10,000/month, unconfirmed by the vendor.",
        shortValue: 'No published price; sales-quoted only',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://www.workato.com/pricing',
            label: 'Workato Pricing Model | Workato',
            asOf: '2026-07-02',
          },
        ],
      },
      freeTier: {
        value:
          "No self-serve free tier is documented; Workato's pricing page is sales-gated (demo/trial request only) and does not confirm a permanent free plan",
        shortValue: 'No documented free tier',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://www.workato.com/pricing',
            label: 'Workato Pricing Model | Workato',
            asOf: '2026-07-02',
          },
        ],
      },
      byok: {
        value:
          "Yes, for LLM costs specifically. Agent Studio's Bring-Your-Own-LLM (BYOLLM) feature lets customers power Genies with their own OpenAI or Anthropic API credentials instead of Workato's managed model contracts",
        shortValue: 'Bring your own OpenAI or Anthropic API key for Genies',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.workato.com/product-hub/changelog/bring-your-own-llm-byollm-support-for-agent-studio/',
            label: 'Bring Your Own LLM (BYOLLM) Support for Agent Studio | Workato Product Hub',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    security: {
      soc2: {
        value:
          'Workato maintains SOC 1 Type II, SOC 2 Type II, and SOC 3 reports (SOC 2 aligned to AICPA Trust Services Criteria, reports available to customers under NDA), plus PCI-DSS v4.0.1 Level 1, ISO 27001/27701/42001, HIPAA (with BAAs), IRAP, and NIST 800-171A r2 certifications',
        shortValue: 'SOC 1/2/3, PCI-DSS, ISO, HIPAA, IRAP, NIST',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/security/security-compliance.html',
            label: 'Security compliance | Workato docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.workato.com/legal/security',
            label: "Workato's security and compliance nature",
            asOf: '2026-07-02',
          },
        ],
      },
      dataResidency: {
        value:
          'Workato operates multiple regional data centers (for example, an Israel data center that uses OpenAI GPT-4o mini instead of Anthropic Sonnet 4 used elsewhere) and documents data-protection and residency options for customers. The on-prem agent additionally lets customers keep on-prem application data behind their own firewall, tunneling only authorized traffic to the Workato cloud.',
        shortValue: 'Multiple regional data centers; on-prem agent option',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.workato.com/the-connector/data-protection-measures/',
            label: 'A Guide to Workato Data Residency, Security, and Compliance',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/connectors/ai-by-workato.html',
            label: 'AI by Workato | Workato docs',
            asOf: '2026-07-02',
          },
        ],
      },
      rbac: {
        value:
          "Yes: RBAC 2.0 separates environment-level and project-level roles and permissions, and supports custom collaborator roles for granular access to projects, folders, and tools, following least-privilege principles. Availability of some custom-role features depends on the customer's pricing plan.",
        shortValue: 'RBAC 2.0 with custom collaborator roles',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/user-accounts-and-teams/role-based-access/access-control-v2.html',
            label: 'Manage workspace collaborators with role-based access control | Workato docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.workato.com/product-hub/changelog/rbac-2-0-enhanced-role-based-access-control/',
            label: 'RBAC 2.0: Enhanced Role-Based Access Control | Workato Product Hub',
            asOf: '2026-07-02',
          },
        ],
      },
      auditLogging: {
        value:
          "Yes: an Activity audit log records users' significant actions across the workspace and can be streamed to an external destination for retention and analysis",
        shortValue: 'Activity audit log, streamable externally',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/user-accounts-and-teams/role-based-access/access-control-v2.html',
            label: 'Manage workspace collaborators with role-based access control | Workato docs',
            asOf: '2026-07-02',
          },
        ],
      },
      additionalCompliance: {
        value:
          'SOC1 Type II, SOC2 Type II, SOC3, ISO 27001, ISO 27701, ISO 42001, HIPAA (BAA), PCI-DSS v4.0.1 Level 1, IRAP (PROTECTED, Australia), NIST 800-171A r2',
        detail:
          "Workato's security/compliance page lists well beyond bare SOC2: SOC 1 Type II (financial reporting controls), SOC 2 Type II, and public SOC 3; ISO 27001 (infosec management), ISO 27701 (privacy/PIMS extending 27001, aligns with GDPR handling of PII), and ISO 42001 (AI governance/responsible-AI management); HIPAA compliance as a Business Associate with signable BAAs and annual third-party HIPAA attestation; PCI-DSS v4.0.1 Level 1 for cardholder data; IRAP assessment at the Australian government PROTECTED level; and NIST 800-171A r2 support for federal contractors handling Controlled Unclassified Information. There is no explicit FedRAMP authorization or a standalone 'GDPR certification'. GDPR compliance is represented via the ISO 27701 PIMS alignment.",
        shortValue: 'SOC, ISO 27001/27701/42001, HIPAA, PCI-DSS, IRAP, NIST',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/security/security-compliance.html',
            label: 'Security compliance | Workato docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.workato.com/platform/security',
            label: 'Automation Governance and Data Security | Workato',
            asOf: '2026-07-02',
          },
        ],
      },
      modelAndToolGovernance: {
        value: 'Unknown',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      credentialGovernance: {
        value:
          "Yes: Workato's project-level access control includes dedicated connection privileges (view, update, create, remove connections) that can be assigned to specific roles or collaborator groups per project, letting admins restrict who can use or manage specific stored connections and credentials, separate from general feature-level permissions.",
        detail:
          'Granularity is at the project/connection-privilege level (and per-service scoping such as AWS IAM external IDs), not necessarily an arbitrary per-credential allow-list across all roles. It still meets the bar of restricting specific credentials beyond feature-level access control.',
        shortValue: 'Yes: per-project connection privileges via RBAC',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/user-accounts-and-teams/role-based-access/',
            label: 'Workato Docs: Role-based access control',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/user-accounts-and-teams/role-based-access/new-model/privileges-reference.html',
            label: 'Workato Docs: Privileges reference',
            asOf: '2026-07-02',
          },
        ],
      },
      whiteLabeling: {
        value:
          'Yes: Workato Embedded offers a Theme editor (Admin Console > Settings > Branding) for customizing colors, fonts, spacing, and adding a custom company logo/name, plus the ability to white-label error messages, notifications, and logs, for partners embedding Workato in their own product.',
        detail:
          'This capability is scoped to the Workato Embedded/OEM offering rather than the standard workspace UI.',
        shortValue: 'Yes: Embedded theme editor with logo/branding',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/oem/branding.html',
            label: 'Workato Docs: Branding - Theme editor',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.workato.com/product-hub/customization-possibilities-with-the-embedded-theme-editor/',
            label:
              'Workato Product Hub: Customization possibilities with the Embedded Theme editor',
            asOf: '2026-07-02',
          },
        ],
      },
      dataRetention: {
        value:
          'Yes: Workato supports org-configurable data retention for recipe job logs, with a default of 30 to 90 days depending on the workspace plan. Enterprise Workspaces, or workspaces with the Data Monitoring/Advanced Security & Compliance capability, can customize retention per recipe down to 1 hour, up to 90 days, or to zero retention.',
        shortValue: 'Yes: configurable retention (1hr-90 days, or zero)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/security/data-protection/data-retention/',
            label: 'Workato Docs: Data retention policies',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/security/data-protection/data-retention/configure-retention-for-recipes.html',
            label: 'Workato Docs: Recipe-level data retention',
            asOf: '2026-07-02',
          },
        ],
      },
      piiRedaction: {
        value:
          "No: Workato's relevant feature is manual data masking, where a builder explicitly flags individual recipe steps so their runtime input and output are not stored or shown in job logs. This is step-level opt-in suppression, not automatic detection or redaction of PII patterns (emails, SSNs, etc.) within the content itself.",
        detail:
          'Zero data retention is a related but separate blanket no-storage option; neither is documented as content-aware PII pattern detection/redaction.',
        shortValue: 'No: manual step-masking, not automatic PII detection',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/features/data-masking.html',
            label: 'Workato Docs: Data masking',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.workato.com/product-hub/workato-tip-protecting-sensitive-data-with-data-masking/',
            label: 'Workato Product Hub: Protecting sensitive data with data masking',
            asOf: '2026-07-02',
          },
        ],
      },
      sso: {
        value:
          'Yes: Workato supports SAML-based single sign-on with just-in-time (JIT) provisioning, so a user signing in via SSO for the first time is automatically added/provisioned into the workspace, plus SAML role sync to assign workspace roles and collaborator groups from the identity provider.',
        detail:
          'Documentation found emphasizes SAML; no explicit public confirmation of native OIDC support was found alongside SAML.',
        shortValue: 'Yes: SAML SSO with JIT auto-provisioning',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/user-accounts-and-teams/single-sign-on.html',
            label: 'Workato Docs: Enable Single Sign-On for a Workato Workspace',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/user-accounts-and-teams/saml-role-sync.html',
            label: 'Workato Docs: SAML role sync',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value: 'Customer-facing job/step-level tracing plus an operational metrics dashboard',
        detail:
          'Job debug tracing shows per-step request/response detail (headers, request body, response) for every action in a run, making it possible to trace the root cause of a single execution. The Workato Dashboard gives a workspace-wide operational view: a jobs graph, recipe details table, plan usage, and app-connection overview, for spotting trends and outliers across recipes. A separate Logging Service streams step-by-step logs in real time (no need to wait for job completion) and can forward them to external systems like Datadog. These are all customer-facing, in-app views; detailed latency-percentile APM metrics go beyond what the jobs/errors dashboard offers.',
        shortValue: 'Job/step-level tracing plus operational dashboard',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/recipes/job-debug-tracing.html',
            label: 'Job debug tracing | Workato docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/features/logging-service.html',
            label: 'Workato Logging Service | Workato docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.workato.com/product-hub/log-streaming-datadog-dashboards/',
            label: 'Turn Workato Log Streams into Datadog Insights',
            asOf: '2026-07-02',
          },
        ],
      },
      durabilityModel: {
        value:
          'Manual/configurable step retries + full job rerun with original trigger payload; no automatic checkpoint-resume mid-recipe',
        detail:
          "Workato's 'Handle errors' block lets you wrap a group of actions and configure up to 3 automatic retries on failure before falling through to an error-handling block. This is opt-in per recipe, not a platform-wide automatic retry for every step. For durability and replay, Workato retains the original trigger event for every job, so any completed or failed job can be rerun from Job History with its original inputs reproduced end-to-end. This is effectively a full-run replay, not a mid-run checkpoint resume. At scale, this can be automated via a 'RecipeOps by Workato' recipe that finds failed jobs and reruns them.",
        shortValue: 'Manual retries plus full job rerun, no checkpoint resume',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/recipes/best-practices-error-handling.html',
            label: 'Error handling best practices | Workato docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/recipes/rerun-job.html',
            label: 'Rerunning jobs | Workato docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/recipes/recipe-job-errors.html',
            label: 'Job errors (recipe execution errors)',
            asOf: '2026-07-02',
          },
        ],
      },
      failureAlerting: {
        value:
          'Yes: proactive email (and Slack/voice via Admin app) alerts on job failure, configurable and throttled',
        detail:
          'Workato sends error-notification emails automatically to the workspace owner by default, and admins can configure additional recipients under Workspace admin > Settings > Debug and logs > Error alerts. Notifications are throttled (default one minute per error type per recipe, with an optional one-hour throttle) to reduce noise. Beyond email, the Admin connector/Workbot integration can push failure notifications to Slack, or trigger a custom email or phone call/IVR (via Twilio) when a key recipe goes down, and Workbot lets teams watch for failures across all or specific recipes directly in Slack.',
        shortValue: 'Throttled email, Slack, and voice failure alerts',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/recipes/error-notifications.html',
            label: 'Errors notifications emails | Workato Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.workato.com/the-connector/new-feature-manage-exceptions-with-workatos-admin-app/',
            label: "New Feature: Manage Exceptions with Workato's Admin App",
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/user-accounts-and-teams/admin-email.html',
            label: 'Managing teams - Email notifications | Workato Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      dataDrains: {
        value:
          'Yes: Workato supports continuous audit/activity log streaming to external destinations including Amazon S3, Azure Monitor/Blob, Google Cloud Storage, Sumo Logic, Datadog, and Splunk, sending each job/event as a JSON payload via HTTP POST, with customizable log message formatting.',
        detail:
          'No public documentation found confirming direct BigQuery streaming specifically, though Google Cloud Storage is supported.',
        shortValue: 'Yes: log streaming to S3, Datadog, Splunk, etc.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/features/activity-audit-log-streaming-destinations.html',
            label: 'Workato Docs: Audit log streaming destinations',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/features/activity-audit-log-streaming.html',
            label: 'Workato Docs: Activity audit log streaming',
            asOf: '2026-07-02',
          },
        ],
      },
      asyncExecution: {
        value:
          "Yes: Workato recipes can run as background jobs you check on later, rather than only blocking synchronously. A recipe run creates a job with an ID, and the Workato Jobs API lets you list jobs and fetch an individual job's status and details afterward. Workato also has explicit async patterns inside recipes: Callable Recipes support a 'fire-and-forget' async function call alongside a synchronous variant, a 'Wait for async calls' action to rejoin parallel async jobs, and a resume-token mechanism for jobs paused while awaiting external input.",
        detail:
          'The public Jobs API is documented as metadata/status only (job state, timestamps, step summaries) via job_id, not a rich step-by-step output payload; full run-time data is viewed on the job details page in the UI rather than returned by the API.',
        shortValue: 'Yes: async job_id + pollable Jobs API',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/workato-api/jobs.html',
            label: 'Workato API - Jobs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/connectors/recipe-functions/actions/call-recipe-function-asynchronously.html',
            label: 'Recipe Functions - Call Recipe Function Asynchronously',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/features/callable-recipes/wait-for-async-action.html',
            label: 'Callable Recipes - Wait for async calls action',
            asOf: '2026-07-02',
          },
        ],
      },
      executionLimits: {
        value:
          'Workato documents a default job execution timeout of 90 minutes of active execution time (configurable by workspace admins to a custom limit), and a per-recipe concurrency setting with a default of 1 simultaneous job and a maximum of 30 simultaneous jobs.',
        detail:
          "Concurrency is configured per recipe (not account-wide); Workato recommends its separate 'Long actions' mechanism for bulk/long-running steps that would otherwise hit the timeout. The docs also note that long actions can let subsequent jobs start even when concurrency is set to 1.",
        shortValue: '90 min timeout default; concurrency 1-30',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/recipes/jobs.html',
            label: 'Recipes - Jobs (job timeout)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/recipes/settings.html',
            label: 'Recipe settings (concurrency default/max)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/recipes/long-actions.html',
            label: 'Long actions',
            asOf: '2026-07-02',
          },
        ],
      },
      partialFailureHandling: {
        value:
          "Yes: Workato's Handle Errors step lets a failing action be routed to a dedicated On Error block (with configurable retries) while the rest of the recipe continues, rather than halting entirely. Per the docs, the recipe always runs the monitored block within the Handle Errors step and then continues to the next step, whether or not an error occurred.",
        detail:
          'By default Workato does not retry a failed action and immediately runs the On Error steps; retries (up to a configurable count and delay) can be enabled. Error datapills (type, message, retry count, source app) are available inside the On Error block for logging or branching logic.',
        shortValue: 'Yes: Handle Errors step with On Error block',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.workato.com/recipes/best-practices-error-handling.html',
            label: 'Error handling best practices',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/recipes/recipe-job-errors.html',
            label: 'Job errors (recipe execution errors)',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Email support (support@workato.com), an official documentation/help center, and a public community forum ("Systematic Community") for peer discussion; no dedicated live-chat channel is documented',
        shortValue: 'Email, docs, and community forum',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://systematic.workato.com/',
            label: 'Workato Systematic Community',
            asOf: '2026-07-02',
          },
        ],
      },
      sla: {
        value: 'Not publicly documented',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      community: {
        value:
          'No published community size metrics. Workato operates a public forum ("Systematic Community") with active discussion, but no member count, Slack/Discord size, or GitHub star count is published. The core product is closed source, so no public GitHub stars apply',
        shortValue: 'No published size metrics; closed-source',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://systematic.workato.com/',
            label: 'Workato Systematic Community',
            asOf: '2026-07-02',
          },
        ],
      },
      companyMaturity: {
        value:
          'Founded 2013; ~$421M total funding; last priced at $5.7B (2021), secondary markets ~$1.7B (mid-2025); ~1,400 employees',
        detail:
          'Workato was founded in 2013 by Gautham Viswanathan and Vijay Tella (Palo Alto, CA). It has raised approximately $421M in total funding across rounds including a $200M Series E in late 2021 at a $5.7B valuation; secondary-market pricing as of mid-2025 reportedly implied a lower valuation near $1.7B. Employee count is approximately 1,414 as of May 2026, indicating a mature, well-funded, late-stage private company with no IPO.',
        shortValue: 'Founded 2013; ~$421M raised; ~1,400 employees',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.crunchbase.com/organization/workato',
            label: 'Workato - Crunchbase Company Profile & Funding',
            asOf: '2026-07-02',
          },
          {
            url: 'https://techcrunch.com/2021/11/10/workato-storms-to-a-5-7b-valuation-after-raising-200m-for-its-enterprise-automation-platform/',
            label: 'Workato storms to a $5.7B valuation after raising $200M | TechCrunch',
            asOf: '2026-07-02',
          },
          {
            url: 'https://tracxn.com/d/companies/workato/__OtQBgvGNY2vOc7gmJydkZ3zQ6CHQGUY1_fzhOK4C3xU',
            label: 'Workato - 2026 Company Profile, Team, Funding & Competitors | Tracxn',
            asOf: '2026-07-02',
          },
        ],
      },
      academy: {
        value:
          'Yes: Workato Academy (Automation Institute) offers structured self-paced courses, badges, and a tiered Automation Pro I/II/III certification program covering beginner to advanced recipe-building skills, plus live training options, available to anyone with a Workato workspace.',
        shortValue: 'Yes: Workato Academy with tiered certifications',
        confidence: 'verified',
        sources: [
          {
            url: 'https://academy.workato.com/learn',
            label: 'Workato Academy',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.workato.com/training/automation-institute.html',
            label: 'Workato Docs: Workato Academy',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.workato.com/certification',
            label: 'Workato: Certification',
            asOf: '2026-07-02',
          },
        ],
      },
    },
  },
}
