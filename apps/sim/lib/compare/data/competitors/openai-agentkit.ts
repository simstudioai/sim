import { OpenAIIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Researched and cross-verified against live vendor sources on 2026-07-02. */
export const openaiAgentkitProfile: CompetitorProfile = {
  id: 'openai-agentkit',
  name: 'OpenAI AgentKit',
  website: 'https://openai.com/index/introducing-agentkit/',
  brand: {
    icon: OpenAIIcon,
    colors: ['#848484', '#141414', '#dddddd'],
    description:
      'OpenAI is an artificial intelligence research and deployment company dedicated to building safe, beneficial artificial general intelligence (AGI). Founded in 2015, it creates advanced AI models such as GPT‑5.5, Codex, and specialized tools for chat, coding, and enterprise use. OpenAI offers products like ChatGPT, ChatGPT Business, and ChatGPT Enterprise, as well as APIs for developers to integrate AI into apps, workflows, and research. The organization publishes AI research, works on AI safety, security, and transparency, and partners with businesses to automate tasks, improve decision‑making, and unlock new capabilities across industries. Its mission is to ensure that AGI benefits all of humanity.',
    industries: [
      'Artificial Intelligence & Machine Learning',
      'Developer Tools & APIs',
      'Software (B2B)',
      'Software (B2C)',
    ],
    socials: [
      { type: 'x', url: 'https://x.com/openai' },
      { type: 'instagram', url: 'https://instagram.com/openai' },
      { type: 'linkedin', url: 'https://linkedin.com/company/openai' },
      { type: 'youtube', url: 'https://youtube.com/openai' },
      { type: 'tiktok', url: 'https://tiktok.com/@openai' },
      { type: 'github', url: 'https://github.com/openai' },
      { type: 'discord', url: 'https://discord.gg/openai' },
    ],
    source: 'Context.dev brand-intelligence API',
    asOf: '2026-07-02',
  },
  oneLiner:
    "OpenAI AgentKit bundled a visual Agent Builder, ChatKit embeddable chat UI, Connector Registry, Guardrails, and Evals for building agentic workflows on OpenAI's models. But OpenAI is winding down Agent Builder and Evals, with full shutdown November 30, 2026, in favor of the code-first Agents SDK or ChatGPT Workspace Agents.",
  standoutFeatures: [
    {
      title: 'An official, open-source Agents SDK wired natively to its own models',
      description:
        "The Agents SDK, openai-agents-python, is open source under the MIT license with over 27,500 GitHub stars and natively wired into OpenAI's own model lineup. It's the path OpenAI is steering AgentKit users toward as Agent Builder and Evals wind down (full shutdown November 30, 2026), and a team fully committed to an all-OpenAI, code-first stack gets that directly.",
      shortDescription: 'Open-source code-first framework, natively wired to OpenAI models.',
      source: {
        url: 'https://github.com/openai/openai-agents-python',
        label: 'GitHub: openai/openai-agents-python',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Connector Registry admin console',
      description:
        'A central admin console (beta) for managing pre-built connectors (Dropbox, Google Drive, SharePoint, Microsoft Teams) and third-party MCP servers across ChatGPT and the API.',
      shortDescription: 'Central admin console for pre-built and third-party MCP connectors.',
      source: {
        url: 'https://openai.com/index/introducing-agentkit/',
        label: 'Introducing AgentKit (via search excerpt)',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'ChatKit embeddable chat UI',
      description:
        'ChatKit ships prebuilt widget nodes (cards, lists, forms, buttons), theming, file attachments, and chain-of-thought visualization for embedding chat-based agents into a product. Unlike Agent Builder and Evals, ChatKit itself is not being deprecated, but its managed-backend integration is being eliminated in the Agent Builder winddown, leaving only the self-hosted-backend path supported.',
      shortDescription: 'Embeddable chat UI with prebuilt widgets, theming, and file attachments.',
      source: {
        url: 'https://community.openai.com/t/deprecation-notice-agent-builder/1382650',
        label: 'OpenAI Community: Deprecation notice - Agent Builder',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Guardrails ships as a standalone, installable open-source package',
      description:
        "Agent Builder's Guardrails node is backed by a separately installable, open-source package that can be used outside AgentKit entirely, adding jailbreak detection alongside PII masking and other safety checks. Sim's Guardrails block covers PII masking and hallucination/RAG scoring too, but it's a built-in workflow block, not a standalone library you can drop into an unrelated codebase.",
      shortDescription: 'Standalone open-source package adds jailbreak detection to PII masking.',
      source: {
        url: 'https://guardrails.openai.com/',
        label: 'OpenAI Guardrails',
        asOf: '2026-07-02',
      },
    },
  ],
  limitations: [
    {
      title: 'Agent Builder and Evals are being shut down',
      description:
        'OpenAI announced in June 2026 that it is winding down Agent Builder (the visual no-code canvas) and the Evals platform. Evals goes read-only October 31, 2026, and both are fully unavailable November 30, 2026. The visual/no-code building experience central to AgentKit as originally announced is being discontinued in favor of the code-first Agents SDK or ChatGPT Workspace Agents.',
      shortDescription: 'Visual builder and evals platform shut down November 30, 2026.',
      source: {
        url: 'https://community.openai.com/t/deprecation-notice-agent-builder/1382650',
        label: 'OpenAI Community: Deprecation notice - Agent Builder',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'No self-hosted managed backend after winddown',
      description:
        "Once Agent Builder's managed hosting is discontinued, the only supported ChatKit integration path requires developers to run ChatKit on their own infrastructure via the Python SDK connected to a custom agentic backend. There is no OpenAI-hosted no-code deployment option remaining.",
      shortDescription:
        'Self-hosting requires running ChatKit on your own infrastructure entirely.',
      source: {
        url: 'https://community.openai.com/t/deprecation-notice-agent-builder/1382650',
        label: 'OpenAI Community: Deprecation notice - Agent Builder',
        asOf: '2026-07-02',
      },
    },
    {
      title:
        'Usage-based, per-token/per-call pricing with no published flat plan for AgentKit itself',
      description:
        "There is no dedicated AgentKit subscription tier. Costs are the sum of model tokens, Code Interpreter sessions ($0.03-$1.92 per session by memory tier), and File Search ($0.10/GB-day storage plus $2.50 per 1,000 tool calls), which makes cost forecasting harder than Sim's published pricing, where a Pro seat is a flat $25/user/month with a monthly credit allowance included, rather than open-ended per-token and per-call metering.",
      shortDescription: 'No flat plan; costs scale with token and tool usage.',
      source: {
        url: 'https://developers.openai.com/api/docs/pricing',
        label: 'OpenAI API Pricing',
        asOf: '2026-07-02',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'Visual canvas (Agent Builder) for drag-and-drop multi-agent workflow construction, paired with a code-first alternative (Agents SDK, Python/TypeScript)',
        detail:
          'Agent Builder was a visual, node-based canvas for creating and versioning multi-agent workflows with typed inputs/outputs and live-data preview. It is being deprecated (shutdown November 30, 2026) in favor of the code-first Agents SDK, making the long-term builder paradigm code-based rather than visual.',
        shortValue: 'Visual canvas, deprecated in favor of code-first SDK',
        confidence: 'verified',
        sources: [
          {
            url: 'https://community.openai.com/t/deprecation-notice-agent-builder/1382650',
            label: 'OpenAI Community: Deprecation notice - Agent Builder',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/agents',
            label: 'OpenAI API: Agents SDK guide',
            asOf: '2026-07-02',
          },
        ],
      },
      learningCurve: {
        value: 'Unknown',
        detail:
          'Agent Builder targeted low-code use and the Agents SDK targets Python/TypeScript developers, but no source quantifies the learning curve for either.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      selfHostOption: {
        value:
          'Not self-hostable as a platform; only the ChatKit frontend/SDK can run on your own infrastructure against a custom backend',
        detail:
          "Agent Builder, Evals, and Connector Registry are OpenAI-hosted SaaS features with no self-host option. ChatKit's advanced integration path lets you run the ChatKit Python SDK on your own infrastructure, but the agent workflow logic is code you write and host yourself, not a self-hosted version of Agent Builder.",
        shortValue: 'Not self-hostable; only ChatKit frontend can be',
        confidence: 'verified',
        sources: [
          {
            url: 'https://community.openai.com/t/deprecation-notice-agent-builder/1382650',
            label: 'OpenAI Community: Deprecation notice - Agent Builder',
            asOf: '2026-07-02',
          },
        ],
      },
      deploymentOptions: {
        value:
          'OpenAI-hosted cloud only for Agent Builder/Evals (being shut down); Agents SDK code can be deployed anywhere that runs Python/TypeScript (e.g., AWS Lambda, Cloudflare Workers, FastAPI servers)',
        detail:
          'There is no official Docker/Kubernetes distribution of AgentKit itself; deployment flexibility comes from the open-source Agents SDK being ordinary application code, as demonstrated by third-party deployment guides running it on Cloudflare Workers/Durable Objects and on AWS Lambda behind a FastAPI wrapper.',
        shortValue: 'OpenAI-hosted only; Agents SDK deploys anywhere',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://blog.cloudflare.com/building-agents-with-openai-and-cloudflares-agents-sdk/',
            label: 'Cloudflare Blog: Building agents with OpenAI and Cloudflare Agents SDK',
            asOf: '2026-07-04',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/agents',
            label: 'OpenAI API: Agents SDK guide',
            asOf: '2026-07-02',
          },
        ],
      },
      templates: {
        value:
          'Yes: Agent Builder provided templates for common workflow patterns, and a ChatKit starter template',
        detail:
          'Agent Builder let users start from templates and drag and drop nodes for each step in a workflow. This feature is tied to Agent Builder, which is being deprecated.',
        shortValue: 'Yes, via Agent Builder (being deprecated)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/cookbook/examples/agentkit/agentkit_walkthrough',
            label: 'OpenAI Cookbook: AgentKit walkthrough',
            asOf: '2026-07-02',
          },
        ],
      },
      license: {
        value:
          'Proprietary (Agent Builder/ChatKit/Evals platform); the Agents SDK (openai-agents-python) is open source under MIT license',
        detail:
          'AgentKit as a hosted product suite is proprietary SaaS. The companion Agents SDK repository is MIT-licensed and open source on GitHub.',
        shortValue: 'Proprietary platform; Agents SDK is MIT',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/openai/openai-agents-python',
            label: 'GitHub: openai/openai-agents-python (license field)',
            asOf: '2026-07-02',
          },
        ],
      },
      environmentPromotion: {
        value:
          'No dev/qa/prod-style environment promotion for full projects. Only single-workflow versioning and code export',
        detail:
          "Agent Builder workflows export as code (Agents SDK, Python or TypeScript) or JSON templates, and templates can sync with a Git repo for reuse, but there's no built-in feature to clone a whole project and promote it between dev/qa/prod environments. Promoting environments means exporting to code and managing them yourself, which lines up with third-party reviews noting Agent Builder lacks production-grade deployment pipelines. Agent Builder is being deprecated, with full shutdown November 30, 2026, in favor of the code-first Agents SDK or ChatGPT Workspace Agents.",
        shortValue: 'No built-in dev/qa/prod promotion',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agent-builder',
            label: 'Agent Builder guide (deprecation notice)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/agent-builder/migrate-from-agent-builder',
            label: 'Migrate from Agent Builder',
            asOf: '2026-07-02',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Publish creates a major version snapshot; API can target older versions; autosave + manual checkpoints, but no documented rollback UI, diff/compare view, or branching',
        detail:
          'Publishing a workflow in Agent Builder creates a new major version acting as a snapshot, and API calls can target an older version. The workspace autosaves continuously and supports manual version checkpoints, but there is no rollback button, visual diff/compare-versions view, or branching. Third-party reviews note Agent Builder still lacks production-grade features like rollback, observability, and deployment pipelines.',
        shortValue: 'Version snapshots, no rollback or diff view',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agent-builder',
            label: 'Agent Builder guide',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.openai.com/cookbook/examples/agentkit/agentkit_walkthrough',
            label: 'AgentKit walkthrough: OpenAI Cookbook',
            asOf: '2026-07-02',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          'No: OpenAI does not document live, multi-user editing of the same Agent Builder canvas with shared cursors or selections. Teams instead collaborate asynchronously, by importing/exporting workflow JSON, syncing with a Git repo, and publishing versioned snapshots.',
        detail:
          "Some third-party blog posts describe Agent Builder as supporting 'collaborative editing,' but this isn't confirmed in official OpenAI docs and likely refers to the async JSON/Git sharing model.",
        shortValue: 'No verified live multiplayer canvas editing',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agent-builder',
            label: 'Agent Builder | OpenAI API',
            asOf: '2026-07-02',
          },
          {
            url: 'https://openai.com/index/introducing-agentkit/',
            label: 'Introducing AgentKit | OpenAI',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeFileStorage: {
        value:
          'No: Agent Builder/AgentKit has no file storage system of its own (no folders, link sharing, or deleted-item recovery). Files are instead handled through the Connector Registry, which points to external storage providers (Dropbox, Google Drive, SharePoint, Microsoft Teams), or through per-call uploads to file search/code interpreter.',
        shortValue: 'No, relies on external connectors not native storage',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://platform.openai.com/docs/guides/tools-connectors-mcp',
            label: 'Tools: Connectors and MCP servers | OpenAI Platform',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/tools-file-search',
            label: 'File search | OpenAI API',
            asOf: '2026-07-02',
          },
        ],
      },
      dataTables: {
        value:
          "No: AgentKit has no equivalent to a native Tables feature. Agent Builder's 'State' and 'Data' nodes are in-workflow variables and data-reshaping steps scoped to a single run, not a persistent, spreadsheet-like data store with typed columns, rows, or keyboard navigation (arrow keys, copy-paste across cells) that other workflows or runs can read and write.",
        detail:
          'Set State defines counters, flags, or contextual values referenced by later nodes in the same run; Data nodes reshape outputs (e.g., object to array) or define global variables for that run. Neither persists rows across separate workflow executions or exposes a spreadsheet UI. Structured, persistent storage that outlives a single run has to come from an external system reached through a connector or MCP server (e.g., a Google Sheets or database connector), not a database or table feature built into AgentKit itself.',
        shortValue: 'No, state/data nodes are per-run variables, not a persistent table store',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://platform.openai.com/docs/guides/node-reference',
            label: 'Node reference | OpenAI API',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/agent-builder',
            label: 'Agent Builder | OpenAI API',
            asOf: '2026-07-02',
          },
          {
            url: 'https://community.openai.com/t/agent-builder-while-loop-transform-and-set-state-an-example/1362386',
            label: 'OpenAI Community: Agent Builder - While Loop, Transform and Set State example',
            asOf: '2026-07-04',
          },
        ],
      },
      richTextEditor: {
        value:
          'No: Agent Builder/AgentKit has no native, inline rich-text (WYSIWYG) document editor. Text is written in plain node fields and prompts, and ChatKit widgets render structured cards, lists, and components rather than acting as a document editor.',
        shortValue: 'No native WYSIWYG document editor found',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/chatkit-widgets',
            label: 'ChatKit widgets | OpenAI API',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/agent-builder',
            label: 'Agent Builder | OpenAI API',
            asOf: '2026-07-02',
          },
        ],
      },
      subWorkflows: {
        value:
          "No: Agent Builder's node reference (Start, Agent, Note, File search, Guardrails, MCP, If/else, While, Human approval, Transform, Set state) has no node that calls a separate saved workflow as a nested step and waits for it to finish. Composition across agents happens via handoffs between Agent nodes within the same workflow canvas, not by invoking another independently saved workflow as a reusable child step.",
        detail:
          'A workflow can call other agents through handoffs (execution transfers to another Agent node, carrying conversation state), but that is agent-to-agent handoff inside one workflow graph, not a call-another-workflow-and-return block. The only way to reuse a workflow elsewhere is to export it as Agents SDK code and call that code from other code, a code-level reuse pattern rather than a visual sub-workflow step.',
        shortValue: 'No dedicated call-sub-workflow node found',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/node-reference',
            label: 'Node reference | OpenAI API',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/agent-builder',
            label: 'Agent Builder | OpenAI API',
            asOf: '2026-07-02',
          },
        ],
      },
      customBlocks: {
        value:
          "No: Agent Builder has no feature to publish a workflow as a named, encapsulated block that other org members can drop into their own separate workflows. Its full node palette (Start, Agent, Note, File search, Guardrails, MCP, If/else, While, Human approval, Transform, Set state) has no 'workflow as a block' node, and publishing only creates a versioned snapshot consumable via the API or embedded through ChatKit, not a reusable canvas block for teammates.",
        detail:
          "Publishing a workflow in Agent Builder produces a versioned object callable via API or embeddable through ChatKit, but that is deploying one workflow as an endpoint, not turning it into a block that appears in other users' canvases with inputs auto-derived from its Start node and internals hidden. Team-level reuse in the documented deployment paths (templates, ChatKit, SDK code export) means copying a template, embedding a chat surface, or exporting code, none of which give other builders a live, encapsulated block that stays in sync with the source workflow's latest published version. Agent Builder itself is also being wound down, with full shutdown November 30, 2026.",
        shortValue: 'No dedicated publish-as-reusable-block feature found',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/node-reference',
            label: 'Node reference | OpenAI API',
            asOf: '2026-07-08',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/agent-builder',
            label: 'Agent Builder | OpenAI API',
            asOf: '2026-07-08',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          "Agent Builder's Agent node model selector is OpenAI models only (GPT-5 family, e.g. gpt-5.5, gpt-5.4, gpt-5.4-mini); the separate, code-first Agents SDK is provider-agnostic, with built-in extension points plus best-effort beta LiteLLM/Any-LLM adapters covering 100+ providers (Anthropic, Google, Mistral, and others)",
        detail:
          "Agent Builder's visual canvas only lets you pick from OpenAI's own model lineup. The Agents SDK is a different product: it ships official, built-in provider-integration points (set_default_openai_client, a custom ModelProvider, or per-agent Agent.model) for calling any OpenAI-compatible endpoint, plus best-effort beta adapters for LiteLLM and Any-LLM that route to 100+ non-OpenAI providers. OpenAI's own docs note that adapters add a compatibility layer, so feature support and request semantics can vary by provider and should be validated independently.",
        shortValue: 'Agent Builder: OpenAI only. Agents SDK: provider-agnostic via adapters',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/pricing',
            label: 'OpenAI API Pricing (model list)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://openai.github.io/openai-agents-python/models/',
            label: 'OpenAI Agents SDK: Models (provider integration points)',
            asOf: '2026-07-04',
          },
          {
            url: 'https://openai.github.io/openai-agents-python/models/litellm/',
            label: 'OpenAI Agents SDK: LiteLLM extension (beta, 100+ providers)',
            asOf: '2026-07-04',
          },
        ],
      },
      agentReasoningBlocks: {
        value: 'Yes: dedicated agent/reasoning nodes distinct from plain data routing',
        detail:
          "Agent Builder's canvas included distinct node types for agents, tools, and logic, versus simple data-passing nodes, supporting multi-agent workflows with typed inputs/outputs.",
        shortValue: 'Dedicated agent and reasoning nodes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/cookbook/examples/agentkit/agentkit_walkthrough',
            label: 'OpenAI Cookbook: AgentKit walkthrough',
            asOf: '2026-07-02',
          },
        ],
      },
      naturalLanguageBuilding: {
        value: 'Unknown',
        detail:
          "No primary OpenAI source describes a chat-to-build / natural-language-to-workflow generation feature within Agent Builder itself, distinct from agents' own natural-language capabilities at runtime.",
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      knowledgeBaseRag: {
        value: 'Yes: File Search tool provides built-in vector-store-backed retrieval',
        detail:
          'File Search is billed at $0.10/GB-day storage (1 GB free) plus $2.50 per 1,000 tool calls, giving Agent Builder and Agents SDK workflows a built-in RAG/file-retrieval capability.',
        shortValue: 'Built-in vector-store File Search tool',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/pricing',
            label: 'OpenAI API Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpSupport: {
        value: 'Yes: Agent Builder supports hosted MCP servers as tools',
        detail:
          'Agent Builder supports MCP servers, letting an agent use any hosted MCP server to take real-world actions, and the Connector Registry also lists third-party MCPs.',
        shortValue: 'Hosted MCP servers as tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://openai.com/index/introducing-agentkit/',
            label: 'Introducing AgentKit (via search excerpt)',
            asOf: '2026-07-02',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'Yes: Evals (datasets, trace grading, automated prompt optimization) and a separate open-source Guardrails layer, but Evals is being deprecated alongside Agent Builder',
        detail:
          'AgentKit shipped Datasets, Trace grading, and Automated prompt optimization under Evals, plus an open-source modular Guardrails safety layer (PII masking, jailbreak detection). Evals goes read-only October 31, 2026 and is fully shut down November 30, 2026, alongside Agent Builder.',
        shortValue: 'Evals plus Guardrails (Evals sunsetting)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://openai.com/index/introducing-agentkit/',
            label: 'Introducing AgentKit (via search excerpt)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://community.openai.com/t/deprecation-notice-agent-builder/1382650',
            label: 'OpenAI Community: Deprecation notice - Agent Builder',
            asOf: '2026-07-02',
          },
        ],
      },
      humanInTheLoop: {
        value:
          "Yes: dedicated 'Human approval' node in Agent Builder; SDK-level tool-approval interrupts in Agents SDK",
        detail:
          "Agent Builder has a first-class Human approval logic node that lets a workflow pause for a person to approve or reject a step before continuing (e.g., approve/reject an agent-drafted email before an MCP node sends it). At the SDK level, tool calls flagged as needing approval pause the run and surface as a pending interruption, then resume from saved state once the developer approves or rejects it. There's no built-in approver-notification channel (no native email/Slack alert); the surrounding app has to present the pending approval itself, though the resume mechanism is native.",
        shortValue: 'Dedicated approval node plus SDK interrupts',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/node-reference',
            label: 'Agent Builder: Node reference (Human approval node)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://openai.github.io/openai-agents-js/guides/human-in-the-loop/',
            label: 'OpenAI Agents SDK: Human-in-the-loop guide',
            asOf: '2026-07-02',
          },
        ],
      },
      generativeMedia: {
        value:
          'Image generation only, via tool call; no built-in video or audio (TTS/STT) generation node',
        detail:
          "Agent Builder's node palette (Start, Agent, Note, File search, Guardrails, MCP, If/else, While, Human approval, Transform, Set state) has no dedicated image/video/audio node. Agents can invoke OpenAI's separate image generation tool (GPT Image models) as a tool call. Audio (Whisper transcription/TTS) and video (Sora) are separate OpenAI API products, not surfaced as canvas nodes. No third-party media-gen providers are wired in as nodes.",
        shortValue: 'Image generation only, via tool call',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/node-reference',
            label: 'Agent Builder: Node reference',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/agent-builder',
            label: 'Agent Builder guide',
            asOf: '2026-07-02',
          },
        ],
      },
      dynamicToolUse: {
        value: 'Unknown',
        detail: 'Not publicly documented in available vendor sources.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      modelFallback: {
        value: 'Unknown',
        detail: 'Not publicly documented in available vendor sources.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      agentSkills: {
        value:
          "No: Agent Builder/AgentKit has no dedicated feature for defining a reusable, named prompt or knowledge snippet that multiple agents can share by reference. OpenAI's separate reusable-prompts feature is itself being phased out and is scheduled to shut down November 30, 2026, alongside Agent Builder. A distinct 'Agent Skills' concept exists only in the unrelated Codex product line, not in AgentKit.",
        detail:
          'OpenAI recommends migrating reusable prompts to code-managed, versioned helper files instead, which is the opposite direction of a built-in skills feature.',
        shortValue: 'No dedicated cross-agent skill/snippet feature',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/prompt-engineering',
            label: 'Prompt engineering | OpenAI API',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.openai.com/codex/skills',
            label: 'Agent Skills - Codex | OpenAI Developers',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeChatDeployment: {
        value:
          'Yes: ChatKit is a native toolkit for embedding a publicly deployable, customizable chat-based agent surface (web widget) backed by a published Agent Builder workflow ID or the Agents SDK, distinct from just a form/API/webhook target.',
        detail:
          'ChatKit remains available even as Agent Builder itself is being wound down (shutdown November 30, 2026).',
        shortValue: 'Yes, via ChatKit embeddable chat surface',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/chatkit',
            label: 'ChatKit | OpenAI API',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/chatkit-themes',
            label: 'Theming and customization in ChatKit | OpenAI API',
            asOf: '2026-07-02',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          "Yes: OpenAI's file search tool (used for knowledge retrieval in Agent Builder) returns chunk-level results, not just whole-document matches. Each result includes the matching text chunk, a similarity score, and the source file it came from. Chunks default to 800 tokens with 400-token overlap, and these settings can be inspected and adjusted.",
        shortValue: 'Yes, file search exposes chunk-level results',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/tools-file-search',
            label: 'File search | OpenAI API',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/retrieval',
            label: 'Retrieval | OpenAI API',
            asOf: '2026-07-02',
          },
        ],
      },
      parallelExecution: {
        value:
          "No dedicated node in the visual Agent Builder canvas. Its node palette (Start, Agent, Note, File search, Guardrails, MCP, If/else, While, Human approval, Transform, Set state) has no fan-out/fan-in or 'parallel branches' node; If/else and While are the only branching/looping constructs, and both execute sequentially. Concurrent multi-agent execution requires writing code against the separate Agents SDK (e.g. Python asyncio to run agents in parallel and merge results), not the no-code builder.",
        detail:
          'OpenAI developer community threads on Agent Builder confirm the canvas lacks a fan-out block and point developers to the Agents SDK for true concurrent branch execution.',
        shortValue: 'No visual parallel-branch node; only via Agents SDK code',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/node-reference',
            label: 'Agent Builder: Node reference',
            asOf: '2026-07-02',
          },
          {
            url: 'https://community.openai.com/t/agent-builder-fan-out-block/1364947',
            label: 'OpenAI Community: Agent Builder Fan Out block',
            asOf: '2026-07-02',
          },
        ],
      },
      a2aProtocol: {
        value: 'No: not documented as supported by AgentKit or the Agents SDK',
        detail:
          "No OpenAI documentation, changelog, or product page for AgentKit, Agent Builder, or the Agents SDK describes support for the Agent2Agent (A2A) protocol or Agent Cards. A2A is an open standard originated by Google and now under the Linux Foundation; OpenAI's own interoperability story is built around MCP (tool-calling) rather than A2A peer-to-peer agent discovery.",
        shortValue: 'Not supported / not documented',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://openai.com/index/introducing-agentkit/',
            label: 'Introducing AgentKit (via search excerpt)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/agents',
            label: 'Agents SDK | OpenAI API',
            asOf: '2026-07-02',
          },
        ],
      },
      loopIteration: {
        value:
          "Yes: Agent Builder has a dedicated 'While' logic node that loops on a custom Common Expression Language (CEL) condition, re-running the connected steps sequentially each pass until the condition is false.",
        detail:
          "The While node is condition-based rather than an explicit for-each-over-a-list container: iterating over a list means writing a CEL expression that checks an index or remaining-items condition against a Set-state variable, and incrementing that variable each pass, rather than dropping in a purpose-built for-each block. Iterations run one after another (sequential), matching the node palette's lack of any fan-out/parallel node.",
        shortValue: 'Yes, via the While logic node (condition-based, sequential)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/node-reference',
            label: 'Node reference | OpenAI API',
            asOf: '2026-07-02',
          },
          {
            url: 'https://community.openai.com/t/agent-builder-while-loop-transform-and-set-state-an-example/1362386',
            label: 'OpenAI Community: Agent Builder - While Loop, Transform and Set State example',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value: 'Unknown exact count',
        detail:
          "OpenAI names specific pre-built connectors (Dropbox, Google Drive, SharePoint, Microsoft Teams) plus support for arbitrary third-party MCP servers, but publishes no total integration/connector count comparable to a competitor's marketed number.",
        shortValue: 'No published total connector count',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://openai.com/index/introducing-agentkit/',
            label: 'Introducing AgentKit (via search excerpt)',
            asOf: '2026-07-02',
          },
        ],
      },
      triggerTypes: {
        value: 'Unknown / not comprehensively documented',
        detail:
          'Primary sources describe workflow execution via API calls and ChatKit chat interfaces; no vendor page enumerates trigger types (webhook, schedule, app-event) the way a workflow-automation product typically does.',
        shortValue: 'Not comprehensively documented',
        confidence: 'unknown',
        sources: [],
      },
      customCodeSteps: {
        value:
          'Yes, effectively. The Agents SDK is itself Python/TypeScript code, and Agent Builder workflows can call custom tools/functions',
        detail:
          "Because the long-term supported path is the code-first Agents SDK (Python and TypeScript), custom code isn't a step type bolted onto a no-code canvas. It's the native building block itself.",
        shortValue: 'Yes, code is the native building block',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agents',
            label: 'OpenAI API: Agents SDK guide',
            asOf: '2026-07-02',
          },
        ],
      },
      apiPublishing: {
        value:
          'Yes: agents/workflows are consumed via the OpenAI API and can be embedded via ChatKit; Agent Builder itself is not a customer-facing REST API generator',
        detail:
          'Agents built with the Agents SDK run as regular application code that developers expose via their own APIs; ChatKit provides an embeddable chat surface rather than an auto-generated REST endpoint for a visual workflow.',
        shortValue: 'Via OpenAI API and ChatKit embed',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agents',
            label: 'OpenAI API: Agents SDK guide',
            asOf: '2026-07-02',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Official Agents SDK (Python + TypeScript/JS); Apps SDK (MCP-based) for building integrations; ChatGPT Apps directory as a community marketplace',
        detail:
          "Agents SDK ships as open-source client libraries for Python (openai-agents-python) and TypeScript/JavaScript (openai-agents-js). It defaults to OpenAI's own Responses/Chat Completions APIs but is provider-agnostic in practice: built-in provider-integration points plus best-effort beta LiteLLM/Any-LLM adapters let it call 100+ non-OpenAI providers (this is a code-level capability, distinct from Agent Builder's OpenAI-only model selector). Custom integrations are built as MCP servers using the Apps SDK, an open standard on the Model Context Protocol; Agent Builder's MCP node connects to any third-party MCP server. A Connector Registry centralizes admin-managed connectors (Dropbox, Google Drive, SharePoint, Teams) plus third-party MCPs. Community apps go through a dashboard-based submission and review flow and, once approved, are listed in the ChatGPT Apps directory.",
        shortValue: 'Agents SDK, Apps SDK, and app directory',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agents',
            label: 'Agents SDK guide',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/openai/openai-agents-python',
            label: 'openai-agents-python GitHub repo',
            asOf: '2026-07-02',
          },
          {
            url: 'https://openai.github.io/openai-agents-python/models/litellm/',
            label: 'OpenAI Agents SDK: LiteLLM extension (beta, 100+ providers)',
            asOf: '2026-07-04',
          },
          {
            url: 'https://developers.openai.com/apps-sdk',
            label: 'Apps SDK overview',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.openai.com/apps-sdk/deploy/submission',
            label: 'Apps SDK: Submit and maintain your app',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpPublishing: {
        value:
          "No: publicly available evidence only shows AgentKit/Agent Builder consuming external MCP servers as tools (adding an MCP button and pointing it at OpenAI's or third-party MCP servers). There is no documented feature to publish a deployed Agent Builder workflow itself as a callable MCP server for external AI tools to consume.",
        detail:
          'A separate OpenAI product, the Apps SDK, discusses exposing an MCP app as a server, but that is not the same as publishing an Agent Builder workflow as an MCP server.',
        shortValue: 'No, MCP support is client-only (consumes servers)',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://composio.dev/content/mcp-servers-for-agent-builder',
            label: '8 best MCP servers to build production-ready agents in OpenAI Agent Builder',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/agent-builder',
            label: 'Agent Builder | OpenAI API',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Usage-based (per-token model pricing plus per-call/per-session tool pricing). No flat AgentKit subscription',
        detail:
          'Agent Builder was free to design in. Costs are incurred only when workflows run, through standard OpenAI API token pricing (e.g., gpt-5.5: $5.00/M input, $30.00/M output tokens) plus tool-specific charges: Code Interpreter runs $0.03-$1.92 per session by memory tier (billed per minute, five-minute minimum), and File Search costs $0.10/GB-day for storage (1 GB free) plus $2.50 per 1,000 tool calls. Agent Builder itself is being deprecated, with full shutdown November 30, 2026, so this pricing model applies only until then.',
        shortValue: 'Usage-based tokens plus tool fees',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/pricing',
            label: 'OpenAI API Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      entryPaidPlan: {
        value:
          'No dedicated AgentKit plan; costs are pay-as-you-go API usage starting from $0 committed spend',
        detail:
          'There is no AgentKit-specific entry paid tier. Billing is metered API usage (tokens plus tool calls) as described under pricing model.',
        shortValue: 'None; pay-as-you-go API usage',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/pricing',
            label: 'OpenAI API Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      freeTier: {
        value:
          'Yes, partially: Agent Builder was free to design in, and ChatKit/File Search each include an initial 1 GB of free storage before per-GB-day charges apply',
        detail:
          'Agent Builder let you design and iterate at zero cost until you ran a workflow. ChatKit includes 1 GB of free file/image storage per account per month before $0.10/GB-day applies, and File Search includes a one-time free GB of storage before the same rate applies, a standing allowance rather than a recurring daily reset.',
        shortValue: 'Design-time free, plus limited storage credits',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/pricing',
            label: 'OpenAI API Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      byok: {
        value:
          "Not applicable / no. AgentKit runs exclusively on OpenAI's own billed models; there is no BYOK mechanism to swap in a different LLM provider's API key",
        detail:
          "Since all model calls route through OpenAI's own metered API, there's no bring-your-own-key concept for third-party LLM providers within Agent Builder or the Agents SDK the way a multi-LLM platform would offer it.",
        shortValue: 'No; OpenAI models only',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/pricing',
            label: 'OpenAI API Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    security: {
      soc2: {
        value: 'Yes: SOC 2 Type 2, plus ISO 27001, 27017, 27018, and 27701 certifications',
        detail:
          "OpenAI's most recent SOC 2 report covers January 1, 2025 through June 30, 2025 for Security, Availability, Confidentiality, and Privacy Trust Services Criteria across the API Platform, ChatGPT Enterprise, ChatGPT Edu, and ChatGPT Team.",
        shortValue: 'SOC 2 Type 2 plus ISO 27001/27017/27018/27701',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://trust.openai.com/',
            label: 'OpenAI Trust Portal (SafeBase)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://openai.com/security-and-privacy/',
            label: 'Security and privacy at OpenAI',
            asOf: '2026-07-02',
          },
        ],
      },
      dataResidency: {
        value:
          'Yes: data residency at rest available in US, Europe, UK, Japan, Canada, South Korea, Singapore, Australia, India, and UAE for eligible enterprise customers',
        detail:
          'Eligible ChatGPT Enterprise, ChatGPT Edu, ChatGPT for Healthcare, and API platform customers can store content at rest in these regions; eligible customers can also opt into in-region GPU inference in the U.S. or Europe.',
        shortValue: '10 regions for eligible enterprise customers',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://openai.com/index/expanding-data-residency-access-to-business-customers-worldwide/',
            label: 'Expanding data residency access to business customers worldwide',
            asOf: '2026-07-02',
          },
        ],
      },
      rbac: {
        value:
          'Yes, at the workspace level. Workspace Owners create custom roles and use per-role "Connected data" controls to allow or restrict which apps/connectors (and their actions) each role can use, with all apps disabled by default. A separate Global Admin Console (beta) adds a distinct Global admin role for centralizing access management across workspaces. Granular access scoped to individual Agent Builder workflows is not documented.',
        detail:
          'ChatGPT Enterprise/Edu/Business workspaces let Workspace Owners create custom roles and, under each role\'s Connected data section, turn on "Allow members to use apps" and select which specific apps that role can access; when an admin enables an app, they can also set action controls (allow all actions, read-only, or a custom action set). All apps are disabled by default until an admin turns them on. The Global Admin Console is a newer, separate beta surface with its own Global admin role and an Access tab for centralizing SSO, domain, and external-application access across workspaces. This is workspace/role-level RBAC over apps and connectors, not permissions scoped to individual Agent Builder workflows.',
        shortValue: 'Workspace-level RBAC via custom roles, per-app controls',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://help.openai.com/en/articles/11750701-rbac',
            label: 'RBAC | OpenAI Help Center',
            asOf: '2026-07-08',
          },
          {
            url: 'https://help.openai.com/en/articles/11509118-admin-controls-security-and-compliance-in-apps-enterprise-edu-and-business',
            label: 'Admin Controls, Security, and Compliance in apps | OpenAI Help Center',
            asOf: '2026-07-08',
          },
          {
            url: 'https://help.openai.com/en/articles/12289294-global-admin-console',
            label: 'Global Admin Console | OpenAI Help Center',
            asOf: '2026-07-08',
          },
        ],
      },
      auditLogging: {
        value:
          'Yes, at the platform level. An Admin/Audit Logs API covers the API Platform (API key creation, role changes, login attempts, project changes), and a separate Compliance Logs Platform covers ChatGPT Enterprise/Edu workspaces (conversations, file uploads, admin actions, auth events, agent activity). No source ties audit logging specifically to individual Agent Builder workflow runs.',
        detail:
          'OpenAI provides an Admin/Audit Logs API for the API Platform and a Compliance Logs Platform for ChatGPT Enterprise/Edu workspaces, covering admin actions, authentication events, and agent activity broadly, but no documentation confirms audit logging scoped specifically to Agent Builder workflow executions.',
        shortValue: 'Admin/Audit Logs API plus Compliance Logs',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://help.openai.com/en/articles/9687866-admin-and-audit-logs-api-for-the-api-platform',
            label: 'Admin and Audit Logs API for the API Platform | OpenAI Help Center',
            asOf: '2026-07-02',
          },
        ],
      },
      additionalCompliance: {
        value:
          'FedRAMP Moderate Authorization (ChatGPT Enterprise and API Platform), PCI DSS v4.0.1, SOC 2 Type 2, ISO/IEC 27001:2022, ISO/IEC 27701:2019; supports customer HIPAA compliance via BAA and GDPR/CCPA via DPA; FERPA covered via a separate Student Data Privacy Agreement for ChatGPT Edu',
        detail:
          "OpenAI's ChatGPT Enterprise and API Platform hold FedRAMP Moderate (Class C) authorization per the FedRAMP Marketplace listing. OpenAI's trust portal lists PCI DSS v4.0.1 for payment-processing components, a SOC 2 Type 2 examination (Security, Availability, Confidentiality, Privacy criteria) covering the API Platform, ChatGPT Enterprise, ChatGPT Edu, and ChatGPT Team, plus ISO/IEC 27001:2022, 27017:2015, 27018:2019, and 27701:2019 certifications, and lists GDPR and CCPA. OpenAI offers a Data Processing Addendum for GDPR/CCPA and a Business Associate Agreement for HIPAA-regulated customers on ChatGPT Enterprise/Edu and the API (not standard ChatGPT Business); this is enablement rather than OpenAI itself being HIPAA-certified, since HIPAA has no formal certification body. FERPA compliance for ChatGPT Edu/for Teachers runs through a separate Student Data Privacy Agreement rather than the general DPA.",
        shortValue: 'FedRAMP Moderate, PCI DSS, SOC 2, ISO 27001/27701, HIPAA BAA',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.fedramp.gov/marketplace/products/FR2533155773/',
            label: 'ChatGPT Enterprise and API Platform | FedRAMP Marketplace',
            asOf: '2026-07-08',
          },
          { url: 'https://trust.openai.com/', label: 'OpenAI Trust Portal', asOf: '2026-07-08' },
          {
            url: 'https://help.openai.com/en/articles/8660679-how-can-i-get-a-business-associate-agreement-baa-with-openai',
            label:
              'How can I get a Business Associate Agreement (BAA) with OpenAI? | OpenAI Help Center',
            asOf: '2026-07-08',
          },
        ],
      },
      modelAndToolGovernance: {
        value: 'Unknown',
        detail: 'Not publicly documented in available vendor sources.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      credentialGovernance: {
        value:
          'Yes: ChatGPT Enterprise/Business workspaces support role-based access control (RBAC) that restricts which connectors/apps (and by extension their underlying stored credentials) a given custom role or permission group may use, per-app and per-role, with all apps disabled by default until an admin enables them for specific roles.',
        detail:
          'Granularity is at the connector/app level (e.g. this role may use Google Drive, that role may not) rather than restricting individual named credential instances within a connector type.',
        shortValue: 'Yes, RBAC restricts connector access by role',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.openai.com/en/articles/11750701-rbac',
            label: 'RBAC | OpenAI Help Center',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.openai.com/en/articles/11509118-admin-controls-security-and-compliance-in-apps-enterprise-edu-and-business',
            label: 'Admin Controls, Security, and Compliance in apps | OpenAI Help Center',
            asOf: '2026-07-02',
          },
        ],
      },
      whiteLabeling: {
        value:
          'No: ChatKit (the deployment surface for Agent Builder workflows) only supports surface-level theming, colors, typography, density, and rounded corners, not full white-labeling. Deeper brand replacement, such as changing the chat bubble shape, header layout, or removing OpenAI product identity, requires forking the ChatKit library.',
        detail:
          "A third-party technical review explicitly notes deep white-label branding is 'impossible without forking the entire ChatKit library.'",
        shortValue: 'No, only color/theme customization, not full white-label',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/chatkit-themes',
            label: 'Theming and customization in ChatKit | OpenAI API',
            asOf: '2026-07-02',
          },
          {
            url: 'https://quickchat.ai/post/openai-chatkit-review',
            label: 'OpenAI ChatKit Review: Technical Deep Dive',
            asOf: '2026-07-02',
          },
        ],
      },
      dataRetention: {
        value:
          "No: OpenAI's Compliance Logs Platform retains data for a fixed 30 days (not org-configurable), and API Platform audit logs have no fixed retention/TTL at all rather than an admin-adjustable window; there is no documented org-configurable retention setting for Agent Builder workflow execution logs specifically.",
        detail:
          'Customers wanting longer retention must build their own continuous log-download pipeline rather than set a retention window in the product.',
        shortValue: 'No, fixed 30-day retention, not org-configurable',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.openai.com/en/articles/9261474-openai-compliance-platform-for-enterprise-and-edu-customers',
            label: 'OpenAI Compliance Platform for Enterprise and Edu Customers',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.openai.com/en/articles/9687866-admin-and-audit-logs-api-for-the-api-platform',
            label: 'Admin and Audit Logs API for the API Platform',
            asOf: '2026-07-02',
          },
        ],
      },
      piiRedaction: {
        value:
          "Yes: Agent Builder's Guardrails node includes a built-in PII detection and redaction capability that automatically catches and masks sensitive data (names, phone numbers, account IDs) flowing through a workflow, alongside jailbreak-detection and content-moderation checks, distinct from generic output-validation guardrails.",
        shortValue: 'Yes, Guardrails node redacts PII automatically',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agent-builder-safety/',
            label: 'Safety in building agents | OpenAI API',
            asOf: '2026-07-02',
          },
          {
            url: 'https://guardrails.openai.com/',
            label: 'OpenAI Guardrails',
            asOf: '2026-07-02',
          },
        ],
      },
      sso: {
        value:
          'Yes: OpenAI supports SAML-based SSO for ChatGPT Enterprise/Edu/Business and the API Platform, with organization auto-provisioning available either via Automatic Account Creation (email-domain matched invitations) or SCIM-based Directory Sync that invites users based on Identity Provider group membership.',
        detail: 'Requires prior verification of at least one domain to enable SSO.',
        shortValue: 'Yes, SAML SSO with SCIM auto-provisioning',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.openai.com/en/articles/9534785-configuring-sso',
            label: 'Configuring SSO | OpenAI Help Center',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.openai.com/en/articles/9672121-getting-started-with-identity-and-provisioning-in-chatgpt-enterprise-edu-and-chatgpt-for-teachers',
            label: 'Getting started with identity and provisioning | OpenAI Help Center',
            asOf: '2026-07-02',
          },
        ],
      },
      thirdPartyVetting: {
        value:
          "Partial: pre-built Connector Registry entries (Dropbox, Google Drive, SharePoint, Teams) and the ChatGPT Apps directory go through OpenAI identity verification and app review, but Agent Builder's MCP node and the Agents SDK can connect to any third-party MCP server with no vendor vetting pipeline documented",
        detail:
          "OpenAI's own Connector Registry connectors and ChatGPT Apps directory submissions require developer identity verification and pass through an OpenAI app-review process before listing, per the App submission guidelines. But Agent Builder's MCP node and the Agents SDK let a builder point at any hosted MCP server, first-party or community-run, with no OpenAI review of that server's code. This client-only MCP model mirrors the wider MCP ecosystem, where unreviewed community servers have shipped malicious behavior elsewhere (for example, an unofficial third-party Postmark MCP server was found in September 2025 silently BCC'ing all outgoing email to an attacker). No security incident specific to OpenAI's own Connector Registry, Apps directory, or Agent Builder MCP integration has been publicly reported.",
        shortValue: 'Partial: reviewed first-party catalog, but open MCP server connections',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/apps-sdk/app-submission-guidelines',
            label: 'App submission guidelines | Apps SDK | OpenAI Developers',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.openai.com/apps-sdk/guides/security-privacy',
            label: 'Security & Privacy | Apps SDK | OpenAI Developers',
            asOf: '2026-07-02',
          },
          {
            url: 'https://openai.com/index/developers-can-now-submit-apps-to-chatgpt/',
            label: 'Developers can now submit apps to ChatGPT | OpenAI',
            asOf: '2026-07-02',
          },
          {
            url: 'https://authzed.com/blog/timeline-mcp-breaches',
            label: 'A Timeline of Model Context Protocol (MCP) Security Breaches',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Yes: per-run tracing with spans (model calls, tool calls, handoffs, guardrails, custom spans) in a customer-facing Traces dashboard; no dedicated metrics dashboard (latency percentiles/error rates) documented',
        detail:
          "Tracing is on by default in the Agents SDK. Every run produces a structured trace with an ID, an optional group ID, and metadata tags, viewable in the Traces dashboard (Logs > Traces) for debugging and, via trace grading/agent evals, benchmarking. There's no aggregate metrics dashboard surfacing latency percentiles or error-rate trends across runs: official docs cover single-run trace inspection plus eval-based benchmarking, not a fleet-wide metrics view.",
        shortValue: 'Per-run trace dashboard, no metrics view',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agents/integrations-observability',
            label: 'Agents SDK: Integrations and observability',
            asOf: '2026-07-02',
          },
          {
            url: 'https://openai.github.io/openai-agents-python/tracing/',
            label: 'OpenAI Agents SDK: Tracing',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/trace-grading',
            label: 'Trace grading',
            asOf: '2026-07-02',
          },
        ],
      },
      durabilityModel: {
        value:
          'Opt-in retries, SDK-level checkpointing/resume of run state, but no one-click replay of a past production execution with original inputs from the Agent Builder UI',
        detail:
          "The Agents SDK supports configurable automatic retries on transient failures (network errors, rate limits, server errors), off by default and requiring an explicit retry policy. The SDK also records each run's execution state so it can resume after an interruption (e.g., pending tool approval) or a process restart, giving checkpoint/resume for fault tolerance. This is a developer-invoked mechanism in code, not a dashboard 'replay this failed execution' button, and there's no UI-driven replay-with-original-inputs feature for past runs.",
        shortValue: 'Opt-in retries and checkpoint/resume',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://openai.github.io/openai-agents-js/guides/running-agents/',
            label: 'OpenAI Agents SDK: Running agents',
            asOf: '2026-07-02',
          },
          {
            url: 'https://openai.github.io/openai-agents-js/guides/human-in-the-loop/',
            label: 'OpenAI Agents SDK: Human-in-the-loop (RunState resume)',
            asOf: '2026-07-02',
          },
        ],
      },
      failureAlerting: {
        value:
          'No proactive alerting for failed runs or cost/latency thresholds. Traces are pull-based, inspected manually',
        detail:
          "The Traces dashboard records model calls, tool calls, handoffs, guardrails, and custom spans per run for after-the-fact debugging, but it's a manual inspection tool you open to debug a specific run. There's no built-in push notification (email/Slack/webhook) when a run fails or crosses a cost/latency threshold. Generic OpenAI platform webhooks exist for events like batch or fine-tuning job completion, but these aren't documented as covering Agent Builder/Agents SDK run failures or thresholds.",
        shortValue: 'No proactive alerts; manual trace review',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/agents/integrations-observability',
            label: 'Agents SDK: Integrations and observability',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/webhooks',
            label: 'OpenAI API: Webhooks',
            asOf: '2026-07-02',
          },
        ],
      },
      dataDrains: {
        value:
          "Yes: OpenAI's Compliance Logs Platform and Admin/Audit Logs API continuously export execution, audit, and usage data as immutable, time-windowed JSONL log files, with 13 pre-built turnkey integrations to eDiscovery, DLP, and SIEM vendors (e.g. CrowdStrike, GlobalRelay), beyond just viewing logs in-product.",
        detail:
          'This is an org-wide ChatGPT Enterprise/API Platform compliance feature, not something scoped specifically to Agent Builder workflow runs.',
        shortValue: 'Yes, continuous log export to SIEM/DLP/eDiscovery',
        confidence: 'verified',
        sources: [
          {
            url: 'https://help.openai.com/en/articles/9261474-openai-compliance-platform-for-enterprise-and-edu-customers',
            label: 'OpenAI Compliance Platform for Enterprise and Edu Customers',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.openai.com/en/articles/9687866-admin-and-audit-logs-api-for-the-api-platform',
            label: 'Admin and Audit Logs API for the API Platform',
            asOf: '2026-07-02',
          },
        ],
      },
      asyncExecution: {
        value:
          'Yes: OpenAI\'s platform supports a background mode that flags a Responses API call to run asynchronously instead of blocking. The client immediately gets back a response ID marked "queued" and polls a status endpoint until the run reaches a terminal state like completed or failed.',
        detail:
          'Background mode is a platform-level Responses API feature (used by Agents SDK/AgentKit flows), not unique to the Agent Builder canvas UI itself; an in-flight response can also be cancelled directly. Response data is retained only about 10 minutes for polling, and it is incompatible with Zero Data Retention projects.',
        shortValue: 'Background mode: async trigger + poll status',
        confidence: 'verified',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/background',
            label: 'OpenAI: Background mode guide',
            asOf: '2026-07-02',
          },
        ],
      },
      executionLimits: {
        value:
          'Unknown: OpenAI does not publish a fixed maximum duration for a single Agent Builder workflow run or Agents SDK execution, nor a concurrency cap specific to AgentKit. The only concrete numbers found are general API usage-tier limits (requests and tokens per minute/day, scaling from a $100/month allowance at Tier 1 up to $200,000/month at Tier 5) and a 300-requests-per-minute cap per vector store for file ingestion endpoints.',
        detail:
          'Background mode responses are only retained about 10 minutes for polling, a practical window for checking back on a run, but not a documented hard execution timeout. The one concrete node-level timeout is the Agent Builder Approval node, which times out after 5 minutes and alerts a supervisor if unactioned. Actual RPM/TPM caps are account/model-specific and only visible in the OpenAI dashboard.',
        shortValue: 'No published AgentKit-specific run/concurrency caps',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/rate-limits',
            label: 'OpenAI: Rate limits guide (usage tiers, RPM/TPM/RPD/TPD, vector store 300 rpm)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://developers.openai.com/api/docs/guides/background',
            label: 'OpenAI: Background mode guide (10-minute retention window)',
            asOf: '2026-07-02',
          },
        ],
      },
      partialFailureHandling: {
        value:
          "No: Agent Builder has no dedicated try/catch or fallback-path construct for a failing step. Error handling has to be built manually with a Guardrails node (a pass/fail checkpoint on a prior node's output) combined with If/Else logic nodes to branch on conditions. OpenAI's own guidance for a guardrail failure is to end the workflow or loop back to the previous step, not to continue the rest of the run on a separate error path.",
        detail:
          'Guardrails nodes and If/Else logic nodes can be composed to approximate conditional routing around a failure, and a Human Approval node can pause for intervention, but none of these work as an automatic "catch this failing step and keep the rest of the run going" mechanism the way a dedicated error-handling path would.',
        shortValue: 'No built-in error branch, manual guardrail workaround only',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/node-reference',
            label:
              'OpenAI: Agent Builder node reference (Guardrails, If/Else, Human Approval nodes)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://platform.openai.com/docs/guides/agent-builder-safety',
            label: 'OpenAI: Safety in building agents (guardrail failure handling guidance)',
            asOf: '2026-07-02',
          },
        ],
      },
      unattendedExecution: {
        value:
          "No native scheduler ships with AgentKit; a scheduled or triggered run only executes with zero dependency on a client device if the developer deploys their own Agents SDK code on always-on server or serverless infrastructure themselves. Agent Builder's own trigger surface covers API calls and ChatKit chat sessions, not a built-in cron/schedule trigger",
        detail:
          "Neither Agent Builder's node reference nor its documented trigger types include a schedule/cron trigger; time-based, run-without-a-human execution is described for a separate product, ChatGPT Workspace Agents, not AgentKit. Because Agents SDK code is ordinary Python/TypeScript, whether a run survives a closed laptop or a disconnected client depends entirely on where the developer hosts that code (e.g. AWS Lambda, a container, or a cron-triggered server process) and whether they add a third-party durability layer, such as Temporal, Dapr, Restate, or DBOS, for crash recovery and long-running execution. There is no first-party, always-on worker fleet or scheduler bundled with AgentKit itself.",
        shortValue: 'No native scheduler; depends on the developer hosting it themselves',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://developers.openai.com/api/docs/guides/node-reference',
            label: 'Node reference | OpenAI API',
            asOf: '2026-07-02',
          },
          {
            url: 'https://openai.github.io/openai-agents-js/guides/running-agents/',
            label: 'OpenAI Agents SDK: Running agents',
            asOf: '2026-07-02',
          },
          {
            url: 'https://temporal.io/blog/announcing-openai-agents-sdk-integration',
            label: 'Temporal: Production-ready agents with the OpenAI Agents SDK',
            asOf: '2026-07-04',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Community forum (community.openai.com), help center articles, and enterprise sales-led support; ChatGPT Enterprise includes 24/7 support',
        detail:
          "OpenAI's Help Center documents standard support channels, and ChatGPT Enterprise plans include 24/7 support with SLAs.",
        shortValue: 'Community forum plus 24/7 enterprise support',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://help.openai.com/en/articles/6614161-how-can-i-contact-support',
            label: 'OpenAI Help Center: How can I contact support?',
            asOf: '2026-07-02',
          },
        ],
      },
      sla: {
        value:
          'Yes, for enterprise/Scale Tier customers. E.g., 99.9% uptime SLA on Scale Tier, and priority-processing SLAs with service credits',
        detail:
          'Scale Tier traffic offers a 99.9% uptime SLA with prioritized compute (available to Enterprise customers); Priority Processing customers on enterprise agreements can receive service credits if SLAs are missed. Exact SLA terms require contacting OpenAI sales.',
        shortValue: 'Yes, for enterprise and Scale Tier',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://openai.com/api-scale-tier/',
            label: 'Scale Tier for API Customers',
            asOf: '2026-07-02',
          },
          {
            url: 'https://openai.com/api-priority-processing/',
            label: 'Priority Processing for API Customers',
            asOf: '2026-07-02',
          },
        ],
      },
      community: {
        value:
          'Over 27,500 GitHub stars on the companion open-source Agents SDK (openai/openai-agents-python) as of 2026-07-02',
        detail:
          "A direct GitHub API check confirms roughly 27,600 stargazers for openai/openai-agents-python. This measures the Agents SDK's community, not Agent Builder/AgentKit specifically, since AgentKit's GUI components are closed-source SaaS.",
        shortValue: '27,500+ GitHub stars on Agents SDK',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/openai/openai-agents-python',
            label: 'GitHub API: openai/openai-agents-python',
            asOf: '2026-07-02',
          },
        ],
      },
      companyMaturity: {
        value:
          'Founded December 2015; ~4,500 employees (targeting ~8,000 by end of 2026); $852B valuation after $122B round closed April 2026',
        detail:
          'OpenAI was founded in December 2015 (originally as a nonprofit) by Sam Altman, Greg Brockman, Elon Musk, Ilya Sutskever, and others. OpenAI closed a $122B funding round in April 2026 at an $852B post-money valuation, with Amazon ($50B), Nvidia ($30B), and SoftBank ($30B) as the largest backers. Employee headcount was roughly 4,500 as of 2026 per Wikipedia, with Financial Times reporting (via Engadget) that OpenAI aims to nearly double its headcount to about 8,000 employees by the end of 2026. This is a mature, well-capitalized company, though AgentKit/Agent Builder is a relatively new (October 2025) product line now being wound down, with shutdown scheduled for November 30, 2026.',
        shortValue: 'Founded 2015, $852B valuation, ~4,500 employees',
        confidence: 'verified',
        sources: [
          {
            url: 'https://en.wikipedia.org/wiki/OpenAI',
            label: 'OpenAI: Wikipedia',
            asOf: '2026-07-08',
          },
          {
            url: 'https://www.engadget.com/ai/openai-reportedly-plans-to-double-its-workforce-to-8000-employees-161028377.html',
            label: 'OpenAI reportedly plans to double its workforce to 8,000 employees: Engadget',
            asOf: '2026-07-08',
          },
        ],
      },
      academy: {
        value:
          'Yes: OpenAI Academy offers structured, free self-paced courses (AI Foundations, Applied AI Foundations, Agents and Workflows) plus official OpenAI Certifications (e.g. the AI Foundations certification backed by ETS and Credly), going beyond ad hoc docs or blog content.',
        detail:
          'Academy and Certifications are separate programs; course-completion certificates are not the same as formal OpenAI Certifications. This is a company-wide OpenAI offering, not specific to Agent Builder/AgentKit.',
        shortValue: 'Yes, OpenAI Academy + certifications',
        confidence: 'verified',
        sources: [
          {
            url: 'https://academy.openai.com/',
            label: 'OpenAI Academy',
            asOf: '2026-07-02',
          },
          {
            url: 'https://openai.com/index/openai-certificate-courses/',
            label: 'Launching our first OpenAI Certifications courses',
            asOf: '2026-07-02',
          },
          {
            url: 'https://help.openai.com/en/articles/20001270-openai-academy-courses',
            label: 'OpenAI Academy courses | Help Center',
            asOf: '2026-07-02',
          },
        ],
      },
    },
  },
}
