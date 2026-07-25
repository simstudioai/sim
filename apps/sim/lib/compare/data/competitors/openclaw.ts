import { OpenClawIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Researched and cross-verified against live vendor sources on 2026-07-02. */
export const openClawProfile: CompetitorProfile = {
  id: 'openclaw',
  name: 'OpenClaw',
  website: 'https://openclaw.ai',
  isWorkflowBuilder: false,
  brand: {
    icon: OpenClawIcon,
    selfFramed: false,
    colors: ['#ff4d4d', '#991b1b', '#00e5cc'],
    source: 'OpenClaw brand icon color inspection',
    asOf: '2026-07-02',
  },
  oneLiner:
    "OpenClaw is a free, open-source, self-hosted personal AI agent that runs on a user's own machine or server and connects to messaging platforms (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Microsoft Teams, and others) as its primary interface, extensible via a Skills plugin system and the ClawHub marketplace. It is not a visual workflow/automation builder like Sim, n8n, or Power Automate.",
  standoutFeatures: [
    {
      title: '22+ messaging channels as the primary interface',
      description:
        'OpenClaw ships a multi-channel inbox connecting one assistant to WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, iMessage, and Microsoft Teams, plus bundled plugin channels (shipped by default, not separately installed) including IRC, Matrix, Feishu, LINE, Mattermost, Nextcloud Talk, Nostr, Twitch, Zalo, and more. Users talk to the same agent from whichever chat app they already use, not a dedicated web builder UI.',
      shortDescription:
        'One agent reachable from 22+ chat apps (core plus bundled plugins), not a dedicated builder UI.',
      source: {
        url: 'https://docs.openclaw.ai/start/openclaw',
        label: 'OpenClaw Docs: Personal assistant setup',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'ClawHub Skills marketplace with multi-scanner security pipeline',
      description:
        "Skills are Markdown-based instruction packages (SKILL.md files) installable from the public ClawHub registry, git repos, or local directories. Every published skill runs through a ClawScan pipeline combining static analysis, VirusTotal, and NVIDIA SkillSpector (added June 2026), and gets a Clean/Suspicious/Malicious verdict plus a Skill Card documenting provenance. This scanning was introduced only after researchers found roughly 900 ClawHub skills with a documented credential-leak or malware finding (see limitations), and OpenClaw's own docs still tell users to treat third-party skills as untrusted code.",
      shortDescription:
        'Markdown skills from ClawHub, each scanned by static analysis, VirusTotal, and SkillSpector.',
      source: {
        url: 'https://openclaw.ai/blog/openclaw-nvidia-skill-security',
        label: 'OpenClaw Blog: OpenClaw Collaborates with NVIDIA for Stronger Agent Skill Security',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Sub-agent orchestration for parallel background work',
      description:
        'A running agent can spawn sub-agents, background runs in their own isolated session and (by default) sandbox, that work in parallel on research, long-running tools, or verification tasks and report results back to the requesting chat when finished. Nesting depth defaults to 1 level, with an orchestrator pattern recommended at depth 2, and a configurable maximum of 5 levels.',
      shortDescription:
        'Spawns isolated sub-agents that run tasks in parallel and report back to chat.',
      source: {
        url: 'https://docs.openclaw.ai/tools/subagents',
        label: 'OpenClaw Docs: Sub-agents',
        asOf: '2026-07-08',
      },
    },
    {
      title: 'Dynamic runtime tool and skill dispatch, not pre-wired at build time',
      description:
        "OpenClaw's agent decides which tools, connectors, and installed Skills to use at runtime based on the incoming request, rather than following a pre-wired sequence of steps chosen when a workflow was built. Skills become eligible per session based on gating rules (OS, environment variables, config flags) and a documented precedence order, and the agent dispatches among them dynamically instead of a builder wiring each tool call in advance.",
      shortDescription:
        'Agent picks tools and skills dynamically at runtime, not pre-wired at build time.',
      source: {
        url: 'https://docs.openclaw.ai/tools/skills',
        label: 'OpenClaw Docs: Skills',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Markdown-file memory with no ingestion pipeline',
      description:
        'Long-term memory is stored as plain, human-readable Markdown files (daily notes plus a curated MEMORY.md), layered with semantic search (memorySearch), instead of running an ingestion/chunking pipeline into a database. The files are natively git-trackable and editable in any text editor, with no separate KB module standing between the user and their own memory.',
      shortDescription:
        'Long-term memory lives in plain, git-trackable Markdown files, not a database-backed KB module.',
      source: {
        url: 'https://docs.openclaw.ai/concepts/memory',
        label: 'OpenClaw Docs: Memory overview',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'MIT-licensed, moving to independent foundation governance',
      description:
        'After creator Peter Steinberger joined OpenAI in February 2026, he confirmed OpenClaw will become an open-source project run "under a foundation, supported by OpenAI but independent." Public reporting does not detail the foundation\'s formal name, board structure, or specific sponsorship terms.',
      shortDescription:
        'MIT-licensed; governance is moving to an independent foundation supported, not owned, by OpenAI.',
      source: {
        url: 'https://www.forbes.com/sites/ronschmelzer/2026/02/16/openai-hires-openclaw-creator-peter-steinberger-and-sets-up-foundation/',
        label: 'Forbes: OpenAI Hires OpenClaw Creator Peter Steinberger And Sets Up Foundation',
        asOf: '2026-07-08',
      },
    },
  ],
  limitations: [
    {
      title: 'Single-operator trust model. No multi-user RBAC or org-level admin controls',
      description:
        'OpenClaw\'s security documentation states its design assumes "one trusted operator boundary per gateway (single-user, personal-assistant model)," not hostile multi-tenant isolation. There is no role-based access control, org/team admin console, or per-user permission model comparable to a team collaboration platform.',
      shortDescription:
        'Designed for one trusted operator per install, not multi-user org admin controls.',
      source: {
        url: 'https://docs.openclaw.ai/gateway/security',
        label: 'OpenClaw Docs: Security',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'ClawHub marketplace has documented, ongoing supply-chain security incidents',
      description:
        'A Kaspersky/Securelist scan of the ClawHub skill hub in April 2026 identified 24 accounts distributing more than 600 malicious skills. In response, OpenClaw added preliminary VirusTotal and NVIDIA SkillSpector scanning to the skill-publishing pipeline, but its documentation still tells users to treat third-party skills as untrusted code.',
      shortDescription:
        'A single scan found 24 accounts distributing over 600 malicious ClawHub skills.',
      source: {
        url: 'https://securelist.com/openclaw-security/120484/',
        label: 'Securelist: Security risks for OpenClaw users and how to mitigate these risks',
        asOf: '2026-07-08',
      },
    },
    {
      title: 'No visual drag-and-drop workflow builder, though a bundled webhooks plugin exists',
      description:
        'OpenClaw is a chat-interface agent gateway, not a visual workflow/automation platform: it has no drag-and-drop canvas for composing multi-step logic. It does ship an official Webhooks plugin that exposes authenticated inbound HTTP routes on the Gateway, letting external systems (Zapier, n8n, CI jobs, internal services) POST JSON to create, drive, and manage OpenClaw TaskFlows, so it can be triggered and controlled via a callable endpoint, just not through any visual builder.',
      shortDescription:
        'No visual builder/canvas; a bundled Webhooks plugin does expose callable inbound HTTP routes.',
      source: {
        url: 'https://docs.openclaw.ai/plugins/webhooks',
        label: 'OpenClaw Docs: Webhooks plugin',
        asOf: '2026-07-04',
      },
    },
    {
      title: 'No SOC 2 report or other compliance attestation',
      description:
        "OpenClaw has no OpenClaw-operated hosted service, only self-hosted software, and no SOC 2 report, trust center, or other compliance attestation is published anywhere on its official sites. Sim is SOC 2 compliant; like OpenClaw, Sim does not currently hold ISO 27001 or HIPAA certification. OpenClaw's own security documentation places responsibility for data-at-rest and processing security squarely on the operator running their own instance.",
      shortDescription: 'No SOC 2 report; the self-hosting operator owns all compliance risk.',
      source: {
        url: 'https://docs.openclaw.ai/gateway/security',
        label: 'OpenClaw Docs: Security',
        asOf: '2026-07-08',
      },
    },
    {
      title: 'Rapid rebranding and name churn created real confusion',
      description:
        'The project launched on November 24, 2025 as "Warelay," then went through "CLAWDIS" and "Clawdbot" before being renamed to "Moltbot" on January 27, 2026 after an Anthropic trademark complaint over similarity to "Claude," then to "OpenClaw" three days later. Four name changes in about ten weeks made it hard for users to know which name, repo, or site was the legitimate project.',
      shortDescription:
        'Four name changes in about ten weeks, including an Anthropic trademark dispute.',
      source: {
        url: 'https://en.wikipedia.org/wiki/OpenClaw',
        label: 'Wikipedia: OpenClaw',
        asOf: '2026-07-08',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'Conversational, config-driven personal AI agent gateway, not a visual or drag-and-drop workflow/agent builder. Behavior is set via a JSON configuration file (openclaw.json) and Markdown Skill files, and the agent is operated by sending it chat messages, not by wiring blocks on a canvas.',
        detail:
          'The docs describe OpenClaw as "a self-hosted gateway that connects your favorite chat apps...to AI coding agents," configured through a CLI (openclaw onboard, openclaw channels login) and JSON/Markdown files, not a graphical builder.',
        shortValue: 'Conversational config-driven agent, not a visual builder',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/',
            label: 'OpenClaw Docs home',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.openclaw.ai/start/openclaw',
            label: 'OpenClaw Docs: Personal assistant setup',
            asOf: '2026-07-02',
          },
        ],
      },
      learningCurve: {
        value:
          'Moderate to steep for initial self-hosted setup, low for day-to-day chat use once running',
        detail:
          'Installing OpenClaw requires Node.js 22.19+/24, a package manager (pnpm/npm/bun), CLI onboarding commands, and editing JSON configuration for channels, providers, and security policy (e.g. DM pairing, sandbox mode). Once running, interacting with the agent is plain natural-language chat.',
        shortValue: 'Technical setup, but simple chat once configured',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/',
            label: 'OpenClaw Docs home',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/openclaw/openclaw',
            label: 'openclaw/openclaw (GitHub)',
            asOf: '2026-07-02',
          },
        ],
      },
      selfHostOption: {
        value:
          "Yes: self-hosting is the only deployment model. OpenClaw runs as a single Gateway process on the user's own machine or server. There is no OpenClaw-operated hosted/SaaS version.",
        detail:
          'Docs describe the Gateway as running locally and being "the single source of truth for sessions, routing, and channel connections," with a local workspace at ~/.openclaw/workspace.',
        shortValue: 'Yes, self-hosting only, no vendor-hosted SaaS option',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/',
            label: 'OpenClaw Docs home',
            asOf: '2026-07-02',
          },
        ],
      },
      deploymentOptions: {
        value:
          'Local install via npm/pnpm/bun on macOS, Windows, or Linux; from-source build via a pnpm workspace; Docker/docker-compose; plus companion macOS app and iOS/Android mobile "nodes" that connect to a locally run Gateway',
        detail:
          'The GitHub repo documents `npm install -g openclaw@latest` plus `openclaw onboard --install-daemon` as the recommended path, alongside from-source and Docker installs, and platform-specific companion apps (Windows Hub, macOS app, iOS/Android nodes).',
        shortValue: 'Local install, Docker, or from source; no hosted option',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/openclaw/openclaw',
            label: 'openclaw/openclaw (GitHub)',
            asOf: '2026-07-02',
          },
        ],
      },
      templates: {
        value:
          'No workflow templates in the visual-builder sense; OpenClaw has no workflow canvas. ClawHub instead offers a small, curated catalog of community-built Skills as installable starter packages for specific tasks: the live registry currently lists roughly 30 featured skills and 12 plugins.',
        detail:
          'ClawHub is the closest analog to a template gallery, installable Markdown Skill packages for specific tasks, but its catalog is a curated set rather than a large template gallery, and catalog size has shifted significantly over time (including a security-driven cleanup, see integrations for detail). Each skill is a Markdown instruction package installed into the agent, not a prebuilt multi-step workflow.',
        shortValue: '~30 ClawHub skills and 12 plugins currently listed, not workflow templates',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://clawhub.ai/',
            label: 'ClawHub registry',
            asOf: '2026-07-08',
          },
        ],
      },
      license: {
        value:
          'MIT License (permissive open source), stewarded by the independent, non-profit OpenClaw Foundation, not a single vendor company',
        detail:
          "The GitHub repository's LICENSE file confirms MIT licensing. Governance passed from creator Peter Steinberger to a community-elected Foundation board after he joined OpenAI in February 2026. OpenAI is a Foundation sponsor (inference support and Codex Security scanning) but does not own the project.",
        shortValue: 'MIT license, non-profit Foundation governance',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/openclaw/openclaw/blob/main/LICENSE',
            label: 'openclaw/openclaw LICENSE file',
            asOf: '2026-07-02',
          },
          {
            url: 'https://openclaw.ai/ecosystem/',
            label: 'OpenClaw Ecosystem page',
            asOf: '2026-07-02',
          },
        ],
      },
      environmentPromotion: {
        value:
          'N/A: no dev/staging/production environment-promotion concept exists. OpenClaw is a single running agent instance configured by one JSON file, not a deployable multi-stage application.',
        detail:
          'There is no feature for forking or promoting a full agent configuration/project between separate environments; configuration changes apply directly to the running Gateway.',
        shortValue: 'No dev/staging/prod concept',
        confidence: 'estimated',
        sources: [],
      },
      versionControlDepth: {
        value:
          'No native version history, diff/compare, or rollback feature for agent configuration or Skills; users can optionally track their own config/skill files in an external Git repository',
        detail:
          'Skills and memory are plain files on disk (SKILL.md, MEMORY.md, openclaw.json), which a user can manually place under their own Git repository for versioning. OpenClaw itself ships no built-in change-history or restore UI for these files.',
        shortValue: 'No built-in version history; files can be user-Git-tracked',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/concepts/memory',
            label: 'OpenClaw Docs: Memory overview',
            asOf: '2026-07-02',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          "No: OpenClaw's security model assumes a single trusted operator per Gateway instance, not multiple simultaneous users collaboratively editing the same agent configuration or session with live cursors/synced state.",
        detail:
          'The security documentation states the design is a "single-user, personal-assistant model," which excludes any live multi-user co-editing concept.',
        shortValue: 'No: single-operator design, no live multi-user co-editing',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/security',
            label: 'OpenClaw Docs: Security',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeFileStorage: {
        value:
          "No: OpenClaw has no cloud file-storage product of its own. It reads and writes files directly on the operator's own local filesystem, inside a sandboxed workspace directory, rather than through a dedicated hosted file-storage/sharing surface.",
        detail:
          'Tool access defaults to sandbox-isolated directories under ~/.openclaw/sandboxes (agents.defaults.sandbox.workspaceAccess). There is no first-party hosted file-storage/sharing surface distinct from the local filesystem.',
        shortValue: 'No: operates on the local filesystem, no hosted file store',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/security',
            label: 'OpenClaw Docs: Security',
            asOf: '2026-07-08',
          },
        ],
      },
      dataTables: {
        value:
          'No: OpenClaw has no native spreadsheet-like data table feature. Its structured, persistent data primitives are plain Markdown memory files (daily notes and MEMORY.md) plus whatever external tools (databases, spreadsheets) it reaches via MCP servers or Skills, not a first-party grid UI.',
        detail:
          'Memory documentation describes Markdown files as the source of truth for continuity and state, chosen over a hidden database for transparency and human readability, the opposite design goal of a spreadsheet-grid product.',
        shortValue: 'No: Markdown memory files, no native data-table object',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/concepts/memory',
            label: 'OpenClaw Docs: Memory overview',
            asOf: '2026-07-02',
          },
        ],
      },
      richTextEditor: {
        value:
          "No: OpenClaw has no inline WYSIWYG rich-text editor. Documents it produces or edits (including its own memory files) are plain Markdown text files edited by the agent or the user's own text editor, not a rendered rich-text surface inside a product UI.",
        detail:
          'Memory and Skills are both plain Markdown (.md) files on disk. There is no in-app rendered rich-text editing surface.',
        shortValue: 'No: plain Markdown files, no in-app WYSIWYG editor',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/concepts/memory',
            label: 'OpenClaw Docs: Memory overview',
            asOf: '2026-07-02',
          },
        ],
      },
      subWorkflows: {
        value:
          "No: OpenClaw's optional Lobster workflow shell has no step type for invoking another saved workflow file as a nested sub-step. Sub-agents (sessions_spawn) delegate a task to a whole separate agent session, not a call-and-wait step inside a defined multi-step pipeline.",
        detail:
          "Lobster's step types are run/command (shell/CLI), pipeline (native stages like llm.invoke), and approval (gates); none reference invoking a second .lobster/YAML/JSON workflow file as a step. Sub-agents are the closest related feature but compose whole agent sessions, not saved workflow definitions, and even that requires an explicit sessions_yield to block for a result rather than a built-in composition primitive.",
        shortValue: 'No: no documented call-another-workflow step in Lobster',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/tools/lobster',
            label: 'OpenClaw Docs: Lobster',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.openclaw.ai/tools/subagents',
            label: 'OpenClaw Docs: Sub-agents',
            asOf: '2026-07-02',
          },
        ],
      },
      customBlocks: {
        value:
          "No: OpenClaw has no feature to publish a Lobster workflow or Task Flow as a named, iconed, encapsulated block that appears in a shared toolbar for other org members to drop into their own separate flows. The documented path for org-wide reuse is packaging a `.lobster` file plus setup notes as a Skill or plugin and publishing it through ClawHub, an installable instruction/code package the agent references, not a live block whose inputs/outputs are auto-derived from a source workflow and that tracks that workflow's latest deployed version automatically.",
        detail:
          "Lobster's own docs list run/command, pipeline, and approval as its only step types, with no invoke-another-workflow-as-a-block primitive. Task Flow is scoped to tracking state within a single multi-step run, not publishing that run as a reusable component. ClawHub Skills are markdown instruction files compiled into the system prompt for agent reasoning, not encapsulated, auto-input-derived workflow blocks with hand-picked outputs and hidden internals; a published Skill's `.lobster` file and setup notes are visible to whoever installs it, the opposite of Sim's full encapsulation.",
        shortValue:
          'No: reuse is via ClawHub Skills (visible instructions), not a live workflow block',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/tools/lobster',
            label: 'OpenClaw Docs: Lobster',
            asOf: '2026-07-08',
          },
          {
            url: 'https://docs.openclaw.ai/automation/taskflow',
            label: 'OpenClaw Docs: Task flow',
            asOf: '2026-07-08',
          },
          {
            url: 'https://docs.openclaw.ai/tools/skills',
            label: 'OpenClaw Docs: Skills',
            asOf: '2026-07-08',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Yes: bundled support for Anthropic Claude, OpenAI (via Codex OAuth), and Google Gemini, plus any OpenAI-compatible endpoint including local runtimes like Ollama',
        detail:
          'OpenClaw ships with the pi-ai model catalog for Anthropic, OpenAI, and Google Gemini (auth via CLI login/token flows), and supports local models (Ollama, auto-detected at http://127.0.0.1:11434/v1) and other OpenAI-compatible providers (Moonshot/Kimi, Cerebras, MiniMax, DeepSeek, Groq, xAI, and others).',
        shortValue: 'Anthropic, OpenAI, Gemini, Ollama, and OpenAI-compatible endpoints',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/concepts/model-providers',
            label: 'OpenClaw Docs: Model providers',
            asOf: '2026-07-02',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          'N/A in the block-based sense: OpenClaw has no visual builder with distinct "reasoning" vs. "routing" node types. The entire agent is a single conversational reasoning loop, with optional sub-agent delegation, not composed from discrete blocks.',
        detail:
          'Reasoning happens inside the model\'s own agent loop per turn. The closest structural analog is spawning a sub-agent for a distinct sub-task, not a dedicated "agent block" placed on a canvas.',
        shortValue: 'No block-based builder; reasoning is the whole agent loop',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/tools/subagents',
            label: 'OpenClaw Docs: Sub-agents',
            asOf: '2026-07-02',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          'Yes, in that natural language is the entire interaction model, but this is not "building a workflow" from a prompt: there is no workflow artifact for a prompt to generate. Configuration (channels, providers, security policy) is done via JSON files and CLI commands, not natural-language authoring.',
        detail:
          'OpenClaw\'s design splits operational config (JSON/CLI, technical) from agent interaction (chat, natural language); the two are not the same axis as a workflow-builder\'s "describe it and get an editable workflow" feature.',
        shortValue: 'Chat is natural language; config is JSON/CLI, not NL-generated',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/start/openclaw',
            label: 'OpenClaw Docs: Personal assistant setup',
            asOf: '2026-07-02',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          "Partial: a built-in semantic-search memory system (memorySearch) indexes the operator's own Markdown notes for natural-language retrieval, but there is no dedicated knowledge-base module for ingesting arbitrary documents (PDF, DOCX, websites) into a managed vector database the way a workflow platform's KB module does.",
        detail:
          "memorySearch uses vector embeddings over the user's own Markdown files (daily notes, MEMORY.md) for semantic recall. Broader document ingestion/RAG over arbitrary file types relies on external MCP servers or Skills, not a first-party KB feature.",
        shortValue: 'Semantic search over own Markdown notes, not a general KB/RAG module',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/concepts/memory',
            label: 'OpenClaw Docs: Memory overview',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpSupport: {
        value:
          'Yes: native MCP client support over both stdio and HTTP/SSE transports, connecting to any published MCP server by adding an mcpServers block to the OpenClaw config. Compatible with the entire published ecosystem of MCP servers (e.g. GitHub, Notion, Postgres, Slack). OpenClaw can also itself be run as an MCP server via `openclaw mcp serve`, exposing its channel conversations to external MCP clients like Claude Code.',
        detail:
          'The docs.openclaw.ai/cli/mcp page documents both directions: consuming external MCP servers via an mcpServers config block, and running `openclaw mcp serve` to start OpenClaw as a stdio MCP server exposing its channel conversations to external MCP clients.',
        shortValue: 'Yes, MCP client over stdio/HTTP+SSE, and can run as an MCP server too',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/cli/mcp',
            label: 'OpenClaw Docs: MCP',
            asOf: '2026-07-08',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'No dedicated eval/regression-testing framework for agent behavior; safety controls instead take the form of exec approval gates, sandboxing, and skill security scanning (ClawScan/SkillSpector/VirusTotal), not a test-dataset evaluation feature.',
        detail:
          'The security documentation covers exec approvals, sandbox tiers, and DM/group access policy, not an evaluation harness for scoring agent output quality against expected results.',
        shortValue: 'No eval framework; safety is via approvals/sandboxing/scanning',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/security',
            label: 'OpenClaw Docs: Security',
            asOf: '2026-07-02',
          },
        ],
      },
      humanInTheLoop: {
        value:
          "Yes: a per-command exec-approval system prompts the operator with Allow Once / Always Allow / Don't Allow for new command patterns before the agent can run them, distinct from a plain delay step",
        detail:
          'One of three permission gates (agent-level tool allow/deny, sandbox-level tool filter, and exec approvals), configurable per-agent via a security/ask mode. This is host command execution approval specifically, not a general-purpose "pause and wait for any human input" workflow node.',
        shortValue: 'Yes, per-command exec approval prompts (Allow Once/Always/Deny)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/sandbox-vs-tool-policy-vs-elevated',
            label: 'OpenClaw Docs: Sandbox vs tool policy vs elevated',
            asOf: '2026-07-02',
          },
        ],
      },
      generativeMedia: {
        value:
          'Yes: documented tools for image generation, video generation (text-to-video, image-to-video, video-to-video), music/audio generation, and text-to-speech, each running asynchronously except TTS which runs synchronously',
        detail:
          'The image_generate, video_generate, and music_generate tools post results into the chat session when ready. TTS defaults to ElevenLabs but also supports Azure Speech and Google Cloud TTS, with SSML/voice customization.',
        shortValue: 'Yes, image/video/music generation and TTS tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/tools/media-overview',
            label: 'OpenClaw Docs: Media overview',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.openclaw.ai/tools/tts',
            label: 'OpenClaw Docs: Text-to-speech',
            asOf: '2026-07-02',
          },
        ],
      },
      dynamicToolUse: {
        value:
          'Partial: which Skills are even eligible for a session is snapshotted once when that session starts and reused for every subsequent turn, not re-selected per request; within that fixed snapshot, the agent still chooses which tool/skill to invoke on a given turn based on the request, rather than following a pre-wired sequence of steps chosen at build time.',
        detail:
          'OpenClaw\'s own docs state it "snapshots eligible skills when a session starts and reuses that list for all subsequent turns in the session," with changes to skills or config taking effect only on the next new session (or when a skills-file watcher detects an edit).',
        shortValue: 'Partial: skills are snapshotted per session, not re-selected per request',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/tools/skills',
            label: 'OpenClaw Docs: Skills',
            asOf: '2026-07-08',
          },
        ],
      },
      modelFallback: {
        value: 'Unknown',
        detail:
          'OpenClaw documentation does not describe an automatic fallback to a different model or provider when the configured model errors or is rate-limited.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      agentSkills: {
        value:
          'Yes: Skills are named, reusable Markdown instruction packages (SKILL.md plus optional reference files/scripts) that a builder writes once, and the agent invokes by name or automatically when context matches, installable individually from ClawHub, git, or a local path',
        detail:
          'Skills follow the AgentSkills specification, support YAML frontmatter for gating (OS, environment variables, config flags) and slash-command exposure, and are resolved via a documented precedence order across workspace, project, personal, and managed/bundled skill directories.',
        shortValue: 'Yes: named, reusable Skills (SKILL.md), installable from ClawHub',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/tools/skills',
            label: 'OpenClaw Docs: Skills',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeChatDeployment: {
        value:
          'N/A: OpenClaw\'s entire product is a chat surface (messaging-platform channels), so there is no separate "deploy as a public chat widget" feature the way a workflow builder has. Chat is the interface itself, not an optional deployment target.',
        detail:
          'The agent is reached through the messaging channels the operator has connected it to (WhatsApp, Telegram, Slack, etc.) or the built-in WebChat surface, which the docs describe as requiring authentication (a gateway auth path, shared-secret by default) rather than a standalone, unauthenticated public-facing chat widget for arbitrary website visitors.',
        shortValue: 'N/A: chat is the native interface, not a separate deploy target',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/web/webchat',
            label: 'OpenClaw Docs: WebChat',
            asOf: '2026-07-04',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          'Unknown: no documentation describes a chunk-level debugging or inspection UI for memorySearch results. Because memory is stored as plain, human-readable Markdown files rather than an opaque vector store, a user can inspect the underlying source files directly, but that is not the same as a purpose-built chunk-index/metadata debugging view.',
        detail:
          "OpenClaw's design goal of transparency via plain Markdown files reduces the need for a chunk-inspection UI, but no such feature exists.",
        shortValue: 'Unknown: no chunk-debug UI documented, source files are readable',
        confidence: 'unknown',
        sources: [],
      },
      parallelExecution: {
        value:
          'Yes: sub-agents can run in parallel, working simultaneously on separate tasks (e.g. research, content generation, verification) and report back to the requesting session. Nesting defaults to depth 1, with a documented maxSpawnDepth configurable up to 5 levels via the maxSpawnDepth parameter (range 1-5).',
        detail:
          'Each sub-agent gets its own session identifier, context window, and execution environment (with optional sandboxing), isolated from the main session and from sibling sub-agents.',
        shortValue: 'Yes, parallel sub-agents with configurable nesting depth (up to 5)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/tools/subagents',
            label: 'OpenClaw Docs: Sub-agents',
            asOf: '2026-07-08',
          },
        ],
      },
      a2aProtocol: {
        value:
          'No native support: OpenClaw does not ship first-party Agent2Agent (A2A) protocol support. Community-built plugins (e.g. an A2A v0.3.0 gateway plugin) let OpenClaw agents discover and communicate with other A2A-compliant agents, but this is a third-party addition, not a built-in core feature.',
        detail:
          'A GitHub feature request for native A2A support exists on the openclaw/openclaw repo. A2A capability is provided only through separately maintained community plugins.',
        shortValue: 'No, only via third-party community plugins',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/openclaw/openclaw/issues/12401',
            label:
              'openclaw/openclaw GitHub issue: Native Agent-to-Agent Communication (A2A Protocol Support)',
            asOf: '2026-07-02',
          },
        ],
      },
      loopIteration: {
        value:
          "No: neither the core agent loop nor the optional Lobster workflow shell has a dedicated for-each/while loop container. Lobster's own maintainers describe its steps as executing strictly top to bottom with no way to jump back to a previous step, and a GitHub feature-request proposal for adding loop/flow-control (a next field enabling backward jumps and max_iterations) is not yet implemented.",
        detail:
          'Lobster documents only run/command, pipeline, and approval step types plus a boolean condition gate. A maintainer-filed proposal (openclaw/lobster issue #38) states plainly that "steps execute top to bottom. There\'s no way to jump back to a previous step" and lists step flow control/loops as a future addition, not a shipped feature.',
        shortValue: 'No: Lobster steps run top to bottom, no loop construct shipped',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/tools/lobster',
            label: 'OpenClaw Docs: Lobster',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/openclaw/lobster/issues/38',
            label:
              'openclaw/lobster GitHub issue #38: Human-in-the-loop workflows: structured input requests, conditionals, and step flow control',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value:
          "29 native messaging channels plus ClawHub's live registry of roughly 30 featured skills and 12 plugins, and MCP access to the broader MCP server ecosystem",
        detail:
          "Native channel integrations (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Microsoft Teams, and more) are documented directly, and the openclaw.ai homepage advertises 29 channels. ClawHub's live registry currently lists roughly 30 featured skills and 12 plugins; MCP support adds access to hundreds of third-party MCP servers on top of that.",
        shortValue: '29 channels, ~30 ClawHub skills/12 plugins, plus MCP servers',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://openclaw.ai/',
            label: 'OpenClaw homepage',
            asOf: '2026-07-08',
          },
          {
            url: 'https://clawhub.ai/',
            label: 'ClawHub registry',
            asOf: '2026-07-08',
          },
        ],
      },
      triggerTypes: {
        value:
          'Inbound chat messages on connected channels, cron-based scheduled jobs (main-session or isolated-session runs), and inbound webhooks via the bundled Webhooks plugin',
        detail:
          'Cron jobs run agent prompts on a schedule using Croner syntax, with either "main session" delivery (enqueues a system event, optionally wakes the heartbeat) or an isolated dedicated session per run, pruned after a 24-hour retention window by default. The Webhooks plugin adds authenticated inbound HTTP routes so an external system can POST to create, run, resume, cancel, or fail a TaskFlow, functioning as an external event trigger scoped to TaskFlow lifecycle actions rather than an arbitrary generic webhook.',
        shortValue: 'Chat messages, cron schedules, and inbound webhooks (TaskFlow-scoped)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/automation/cron-jobs',
            label: 'OpenClaw Docs: Scheduled tasks (cron jobs)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.openclaw.ai/plugins/webhooks',
            label: 'OpenClaw Docs: Webhooks plugin',
            asOf: '2026-07-04',
          },
        ],
      },
      customCodeSteps: {
        value:
          'Yes: the agent can read/write files and run shell commands/scripts directly (subject to exec approval and sandbox policy), rather than through a discrete "code step" primitive in a visual workflow',
        detail:
          'This is native agent capability (shell exec, file read/write) governed by a three-tier permission system (agent tool allow/deny, sandbox tool filter, exec approvals), not a workflow-builder code block dropped into a defined step sequence.',
        shortValue: 'Yes, via sandboxed shell/file execution, not a workflow code block',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/sandbox-vs-tool-policy-vs-elevated',
            label: 'OpenClaw Docs: Sandbox vs tool policy vs elevated',
            asOf: '2026-07-02',
          },
        ],
      },
      apiPublishing: {
        value:
          'Yes, via the official Webhooks plugin: it adds authenticated inbound HTTP routes on the Gateway so external systems (Zapier, n8n, a CI job, or an internal service) can POST JSON to a configured path to create, drive, and manage OpenClaw TaskFlows, the closest OpenClaw feature to publishing a callable REST/webhook endpoint.',
        detail:
          'The plugin runs inside the Gateway process and is enabled via configuration (hooks.enabled, token/secret, path, defaultSessionKey, mappings). Requests authenticate with a shared secret (an Authorization: Bearer header or an x-openclaw-webhook-secret header) and accept documented action values including create_flow, get_flow, list_flows, find_latest_flow, resolve_flow, get_task_summary, set_waiting, resume_flow, finish_flow, fail_flow, request_cancel, cancel_flow, and run_task. This is narrower than a general-purpose custom-API-endpoint feature (only TaskFlow lifecycle operations are exposed, not arbitrary business logic), but it is a genuine callable inbound endpoint, not merely OpenClaw calling out to external webhooks.',
        shortValue: 'Yes: bundled Webhooks plugin exposes authenticated inbound HTTP routes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/plugins/webhooks',
            label: 'OpenClaw Docs: Webhooks plugin',
            asOf: '2026-07-04',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Skill-authoring specification (AgentSkills/SKILL.md) plus a plugin system for channels/providers, and an open-source GitHub organization (~70 repos spanning SDKs, hosted agents, crawlers, and skill registries), not one single unified SDK product',
        detail:
          'The docs describe skill authoring (frontmatter, gating, tool dispatch), a plugin mechanism used for bundled-by-default channels like Matrix/Nostr/Twitch/Zalo (shipped in normal releases, not separately installed by the user), and a broader open-source "federation" of related projects under the openclaw GitHub org.',
        shortValue: 'Skill spec, plugin system, and a ~70-repo OSS ecosystem',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/tools/skills',
            label: 'OpenClaw Docs: Skills',
            asOf: '2026-07-02',
          },
          {
            url: 'https://openclaw.ai/ecosystem/',
            label: 'OpenClaw Ecosystem page',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpPublishing: {
        value:
          'Unknown, not a first-party feature: OpenClaw is documented as an MCP client (consuming external MCP servers), and one third-party community project (openclaw-mcp) provides a bridge exposing an OpenClaw instance itself as an MCP server, but no official OpenClaw feature to publish agent capability as an MCP server exists.',
        detail:
          'The reverse direction, letting external MCP clients call into OpenClaw, exists only via community-built bridge projects (e.g. a Claude.ai-to-OpenClaw OAuth2 bridge), not as a first-party capability.',
        shortValue: 'No first-party feature; only third-party bridge projects',
        confidence: 'unknown',
        sources: [],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Free and open source (MIT license); no OpenClaw subscription fee. Users separately pay their chosen LLM provider (Anthropic, OpenAI, Google, etc.) for model usage, or run a local model at no marginal API cost.',
        detail:
          'There is no OpenClaw-branded paid plan: the software itself carries no license fee and there is no hosted SaaS tier. The only recurring cost is whichever model provider/API the operator configures.',
        shortValue: 'Free software, pay only your own model provider',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/openclaw/openclaw/blob/main/LICENSE',
            label: 'openclaw/openclaw LICENSE file',
            asOf: '2026-07-02',
          },
        ],
      },
      entryPaidPlan: {
        value:
          'N/A: there is no paid OpenClaw plan or tier. The software is free under the MIT license.',
        detail:
          'No pricing page or paid-tier documentation exists for OpenClaw itself. Costs incurred are entirely third-party (LLM provider API usage, optional TTS/media-generation provider fees, hosting for a VPS if not run on a personal machine).',
        shortValue: 'N/A, no paid plan exists',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/openclaw/openclaw/blob/main/LICENSE',
            label: 'openclaw/openclaw LICENSE file',
            asOf: '2026-07-02',
          },
        ],
      },
      freeTier: {
        value:
          'Yes: the entire product is free and open source under the MIT license; there is no metered or gated free tier because there is no paid tier at all.',
        detail:
          'Unlike a typical vendor "free tier" that caps usage, OpenClaw imposes no OpenClaw-side usage limits. Only the configured LLM provider\'s own rate limits/costs apply.',
        shortValue: 'Yes, entirely free (MIT license), no usage cap by OpenClaw itself',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/openclaw/openclaw/blob/main/LICENSE',
            label: 'openclaw/openclaw LICENSE file',
            asOf: '2026-07-02',
          },
        ],
      },
      byok: {
        value:
          'Yes, and mandatory: OpenClaw requires the operator to supply their own API credentials/OAuth login for whichever model provider(s) they configure (Anthropic, OpenAI, Google, or any OpenAI-compatible endpoint); there is no OpenClaw-hosted model access.',
        detail:
          'Onboarding documentation walks through provider-specific auth flows (e.g. `openclaw models auth paste-token --provider anthropic`, `openclaw models auth login --provider openai-codex`). BYOK is the only supported model-access model.',
        shortValue: 'Yes, mandatory; no OpenClaw-hosted model access',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/concepts/model-providers',
            label: 'OpenClaw Docs: Model providers',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    security: {
      soc2: {
        value:
          'No: OpenClaw is a self-hosted open-source project run by a non-profit Foundation, not a vendor selling a hosted service, and publishes no SOC 2 report.',
        detail:
          'No SOC 2 attestation, trust center, or audit report exists for OpenClaw. Responsibility for infrastructure security rests entirely with whoever self-hosts the Gateway.',
        shortValue: 'No SOC 2 report published',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/security',
            label: 'OpenClaw Docs: Security',
            asOf: '2026-07-02',
          },
        ],
      },
      dataResidency: {
        value:
          "Yes, by construction: because OpenClaw runs only as a self-hosted Gateway process, with no OpenClaw-operated hosted/SaaS version, all agent data (sessions, memory files, credentials) resides wherever the operator chooses to run it, e.g. a personal laptop or a self-hosted VPS/homelab using the project's own Ansible/NixOS deployment tooling, giving the operator full control over data location with no vendor-side residency question.",
        detail:
          'The OpenClaw Ecosystem page lists self-host infrastructure tooling (an Ansible playbook, NixOS packaging) for operators running the Gateway on their own server. Combined with there being no OpenClaw-operated cloud service, data residency is entirely a function of where the operator deploys the Gateway.',
        shortValue: 'Yes, fully controlled by self-hosting location',
        confidence: 'verified',
        sources: [
          {
            url: 'https://openclaw.ai/ecosystem/',
            label: 'OpenClaw Ecosystem page',
            asOf: '2026-07-08',
          },
          {
            url: 'https://docs.openclaw.ai/',
            label: 'OpenClaw Docs home',
            asOf: '2026-07-08',
          },
        ],
      },
      rbac: {
        value:
          'No: OpenClaw has no role-based access control system. Its security model is a "single-user, personal-assistant model" with one trusted operator per Gateway, not multiple roles/permission tiers for different users of the same instance.',
        detail:
          'Access control that does exist is channel/message-level (DM pairing policy, group allowlists, per-agent tool allow/deny), not a user-role permission matrix.',
        shortValue: 'No: single-operator model, no role/permission tiers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/security',
            label: 'OpenClaw Docs: Security',
            asOf: '2026-07-02',
          },
        ],
      },
      auditLogging: {
        value:
          'Partial: a local `openclaw security audit` CLI command checks inbound access policy, tool blast radius, filesystem permissions, and network exposure, and session transcripts are stored as local JSONL files with sensitive content redacted by default. This is a local diagnostic/log-file feature, not a centralized, exportable audit-log product.',
        detail:
          'Findings are grouped by severity with checkId keys (e.g. gateway.bind_no_auth). Transcripts live at ~/.openclaw/agents/<agentId>/sessions/*.jsonl, accessible to any process with filesystem access to that path, so there is no access-controlled central audit store.',
        shortValue: 'Local audit CLI + redacted JSONL transcripts, not a central log product',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/security',
            label: 'OpenClaw Docs: Security',
            asOf: '2026-07-02',
          },
        ],
      },
      additionalCompliance: {
        value:
          'No compliance certifications (no HIPAA, ISO 27001, GDPR-specific attestation, PCI, or FedRAMP). As open-source, self-hosted software from a non-profit Foundation, OpenClaw is not the kind of vendor entity that typically pursues these certifications; compliance posture depends entirely on how and where the operator self-hosts it.',
        detail:
          "China restricted state enterprises and government agencies from deploying OpenClaw in March 2026 over security concerns, per Wikipedia's history summary, a data point on the compliance/trust landscape rather than a certification.",
        shortValue: 'None documented; compliance posture depends on self-hosting operator',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://en.wikipedia.org/wiki/OpenClaw',
            label: 'Wikipedia: OpenClaw',
            asOf: '2026-07-02',
          },
        ],
      },
      modelAndToolGovernance: {
        value:
          "Yes, at the single-operator level: OpenClaw supports per-agent tool allow/deny lists and sandbox-level workspace/tool restrictions (agents.defaults.sandbox, tools.allow/tools.deny), configured by one trusted operator, not enforced org-wide. The docs frame this as a layered 'identity → scope → model' design principle rather than a formally named three-gate system.",
        detail:
          "Documented via agent-level tools.allow/tools.deny lists and sandbox-level workspace/tool restrictions, plus explicit provider/model selection per agent in configuration, framed by the docs around an 'identity → scope → model' design principle.",
        shortValue:
          'Yes, operator-configured per-agent tool/model restrictions (identity → scope → model)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/security',
            label: 'OpenClaw Docs: Security',
            asOf: '2026-07-08',
          },
        ],
      },
      credentialGovernance: {
        value:
          'No: OpenClaw has no per-role credential-scoping system, since there are no multiple roles to scope. Its security docs flag that home-directory credential paths (~/.aws, ~/.ssh, ~/.npm, etc.) must be explicitly blocked from sandbox mounts as a hardening step, rather than being governed by a built-in fine-grained credential-access policy layer.',
        detail:
          'The docs list credential-root directories the sandbox blocks by default (docker.sock, /etc, /proc, /sys, /dev, plus ~/.aws, ~/.cargo, ~/.config, ~/.docker, ~/.gnupg, ~/.netrc, ~/.npm, ~/.ssh), a deny-list hardening measure, not a positive credential-governance feature.',
        shortValue: 'No: sandbox deny-lists credential paths, no role-scoped governance',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/security',
            label: 'OpenClaw Docs: Security',
            asOf: '2026-07-02',
          },
        ],
      },
      whiteLabeling: {
        value:
          'No: OpenClaw has no white-labeling feature. As a personal, self-hosted agent, not a product a business deploys to its own end customers under its own brand, rebranding the product UI/name is not a use case the docs address.',
        detail:
          'No documentation describes replacing OpenClaw branding for a deployed customer-facing product; the concept does not map cleanly onto a personal-assistant tool the way it does for a workflow platform with deployed apps.',
        shortValue: 'No white-labeling feature documented',
        confidence: 'estimated',
        sources: [],
      },
      dataRetention: {
        value:
          'Yes, operator-configurable: isolated sub-agent/cron sessions are pruned after a retention window (24 hours by default), and because all data lives in local files (session JSONL transcripts, memory Markdown files), the self-hosting operator has full control over retention (including deleting files immediately).',
        detail:
          "The default 24-hour retention applies specifically to isolated cron-job sessions; the main session's own history and memory files persist until the operator manually prunes them, giving complete operator-side control rather than a vendor-set policy.",
        shortValue: 'Yes, operator-controlled; isolated sessions default to 24h',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/automation/cron-jobs',
            label: 'OpenClaw Docs: Scheduled tasks (cron jobs)',
            asOf: '2026-07-02',
          },
        ],
      },
      piiRedaction: {
        value:
          'Partial: session logging redacts sensitive tool summaries and URLs by default (logging.redactSensitive: "tools"), but this is generic sensitive-data log redaction, not a dedicated, named PII-detection feature (e.g. SSNs, credit card numbers) applied to conversation content itself.',
        detail:
          'Redaction applies to logging output only, not to what the agent itself sees or processes mid-conversation.',
        shortValue: 'Partial: log redaction only, not conversation-content PII detection',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/security',
            label: 'OpenClaw Docs: Security',
            asOf: '2026-07-02',
          },
        ],
      },
      sso: {
        value:
          'No: OpenClaw has no SAML/OIDC single sign-on feature. Its access model authenticates individual senders on connected messaging channels (DM pairing, allowlists), a single-operator personal tool, not an organization with a directory of employees signing in via an identity provider.',
        detail:
          'SSO and organization provisioning are out of scope for the "single-user, personal-assistant model" OpenClaw\'s security documentation describes.',
        shortValue: 'No: single-operator model has no SSO/IdP concept',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/security',
            label: 'OpenClaw Docs: Security',
            asOf: '2026-07-02',
          },
        ],
      },
      thirdPartyVetting: {
        value:
          "No: researchers documented 283 ClawHub skills (about 7.1% of the registry) leaking API keys and other credentials, plus a separate scan finding 24 accounts distributing over 600 malicious skills before scanning existed, roughly 900 skills total with a documented credential-leak or malware finding. That is a direct consequence of ClawHub's structure: it is an open marketplace where any third-party developer can publish, and any user can install, an executable Markdown/code Skill package, not a first-party catalog authored and code-reviewed by OpenClaw itself. This is the opposite trust boundary from Sim, where all 302 blocks are first-party authored and code-reviewed through the standard pull-request process, with no public marketplace for installing arbitrary third-party executable code.",
        detail:
          'OpenClaw has since added a ClawScan pipeline (static analysis, VirusTotal, and NVIDIA SkillSpector as of June 2026) that assigns each published skill a Clean/Suspicious/Malicious verdict and a Skill Card, but its docs still tell users to treat third-party skills as untrusted code, and the marketplace remains open to any publisher rather than vendor-authored. Sim avoids this class of incident structurally: custom code steps run inside its own isolated-vm sandbox rather than as an installable third-party skill package.',
        shortValue: 'No: ~900 ClawHub skills with a documented credential-leak or malware finding',
        confidence: 'verified',
        sources: [
          {
            url: 'https://snyk.io/blog/openclaw-skills-credential-leaks-research/',
            label: 'Snyk: 280+ Leaky Skills: How OpenClaw & ClawHub Are Exposing API Keys and PII',
            asOf: '2026-07-02',
          },
          {
            url: 'https://securelist.com/openclaw-security/120484/',
            label: 'Securelist: Security risks for OpenClaw users and how to mitigate these risks',
            asOf: '2026-07-08',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Local JSONL session transcripts (per agent, per session) capture the conversation and tool-call history, and a `/subagents` command shows spawned sub-agent status, but there is no customer-facing dashboard or span-level distributed-tracing product. This is raw log-file level detail, not a rendered trace UI.',
        detail:
          'Transcripts are stored at ~/.openclaw/agents/<agentId>/sessions/*.jsonl with sensitive content redacted by default. Inspecting them means reading the raw file (or building tooling on top), not a built-in visual trace viewer.',
        shortValue: 'Raw JSONL session logs, no dashboard/trace UI',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/security',
            label: 'OpenClaw Docs: Security',
            asOf: '2026-07-02',
          },
        ],
      },
      durabilityModel: {
        value:
          'Partial: cron-scheduled jobs run as isolated sessions with retention/pruning, and OpenClaw now provides automatic retry-with-backoff for both one-shot jobs (up to retry.maxAttempts, default 3 attempts, at 30s/60s/5m) and recurring jobs (an extended 30s/60s/5m/15m/60m backoff on consecutive errors), though there is still no checkpoint/replay-of-a-past-run feature for either scheduled jobs or interactive chat sessions.',
        detail:
          'The cron docs describe both delivery diagnostics (intended target, resolved target, fallback delivery used, final delivered state) for message delivery, and the retry/backoff schedule (cron.sessionRetention, runLog.keepLines, retry.maxAttempts) as configurable per job.',
        shortValue: 'Clean isolated cron runs with retry-with-backoff; no checkpoint/replay',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/automation/cron-jobs',
            label: 'OpenClaw Docs: Scheduled tasks (cron jobs)',
            asOf: '2026-07-08',
          },
        ],
      },
      failureAlerting: {
        value:
          'Partial: cron jobs support a dedicated failure-alerting path (a configurable cron.failureDestination global/per-job override, a webhook delivery mode, and --failure-alert-after/--failure-alert-cooldown tuning flags) in addition to normal chat delivery diagnostics, so failure alerting is a distinct feature rather than merely folded into chat delivery. There is still no email or cost/latency-threshold alerting.',
        detail:
          'Failure alerting is a dedicated, tunable path (webhook delivery mode plus alert-frequency flags), separate from the normal chat-delivery flow where the operator otherwise sees delivery outcomes in the channel where the job reports.',
        shortValue:
          'Dedicated failure-alerting path (webhook + tuning flags); no email/threshold alerts',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/automation/cron-jobs',
            label: 'OpenClaw Docs: Scheduled tasks (cron jobs)',
            asOf: '2026-07-08',
          },
        ],
      },
      dataDrains: {
        value:
          "No: there is no feature to continuously export execution/session data to an external destination (S3, BigQuery, Datadog, webhook, etc). Because all data already lives in local files under the operator's control, any such export would be a user-built script against those local files, not a first-party OpenClaw data-drain feature.",
        detail:
          "OpenClaw's documentation has no SIEM/export integration comparable to a hosted platform's log-streaming feature.",
        shortValue: 'No native export feature; only local files',
        confidence: 'estimated',
        sources: [],
      },
      asyncExecution: {
        value:
          "Yes: generative media tools (image/video/music generation) run asynchronously in the background and post results into the chat session when ready, and cron jobs run independently of any single interactive chat session. Unlike a cloud-hosted platform, the Gateway process itself must remain running on the operator's machine/server for any of this to execute.",
        detail:
          'This differs from a fully server-hosted workflow platform in one respect: if the machine running the Gateway is off, no async or scheduled execution happens, since there is no separate cloud execution layer independent of the self-hosted process.',
        shortValue: 'Yes, but only while the self-hosted Gateway process is running',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/tools/media-overview',
            label: 'OpenClaw Docs: Media overview',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.openclaw.ai/automation/cron-jobs',
            label: 'OpenClaw Docs: Scheduled tasks (cron jobs)',
            asOf: '2026-07-02',
          },
        ],
      },
      executionLimits: {
        value:
          'No fixed platform-wide execution-time ceiling is published by default (runTimeoutSeconds defaults to 0/unlimited). Sub-agents cannot spawn their own children by default (maxSpawnDepth defaults to 1); setting maxSpawnDepth to 2 opts into one level of nesting (the documented "orchestrator pattern"), up to a configurable maximum of 5. agents.defaults.subagents.maxConcurrent caps concurrent sub-agent runs at 8 by default, with maxChildrenPerAgent capping children per orchestrator at 5 by default.',
        detail:
          "Because OpenClaw runs on infrastructure the operator controls, execution-time/concurrency limits beyond these published defaults (runTimeoutSeconds, maxSpawnDepth, maxConcurrent, maxChildrenPerAgent) are a function of that operator's own hardware and their model provider's API limits, not an OpenClaw-side ceiling.",
        shortValue:
          'No nesting by default (maxSpawnDepth 1, opt-in to 2+); maxConcurrent 8; no fixed time limit',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/tools/subagents',
            label: 'OpenClaw Docs: Sub-agents',
            asOf: '2026-07-08',
          },
        ],
      },
      partialFailureHandling: {
        value:
          'Partial: because sub-agents run in isolated sessions, one sub-agent failing does not halt sibling sub-agents or the main session, an implicit form of failure isolation, but there is no explicit "route this failed step to an error-handling path while the rest of the run continues" mechanism the way a branching workflow builder offers.',
        detail:
          'Isolation here comes from sub-agent session/sandbox separation by design, not from a dedicated try/catch or conditional-branch construct users configure per step.',
        shortValue: 'Implicit isolation via sub-agent sessions, no explicit branching error path',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/tools/subagents',
            label: 'OpenClaw Docs: Sub-agents',
            asOf: '2026-07-02',
          },
        ],
      },
      unattendedExecution: {
        value:
          "Partial: cron-scheduled jobs run independently of any open chat window, but they still depend on the self-hosted Gateway process itself staying up on whatever machine the operator chose to run it on. If that machine is a personal laptop, the schedule requires the laptop to stay on, awake, and connected; only running the Gateway on an always-on server/VPS gets behavior comparable to a cloud-hosted platform's zero-client-dependency execution. There is no OpenClaw-managed cloud execution layer independent of the self-hosted process.",
        detail:
          'This mirrors the asyncExecution and durabilityModel facts above: OpenClaw has no separate hosted execution tier, so unattended reliability is entirely a function of the uptime of whichever machine the operator picked to run the Gateway on, not a property OpenClaw itself guarantees.',
        shortValue: 'Partial: depends on the self-hosted Gateway machine staying up',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/automation/cron-jobs',
            label: 'OpenClaw Docs: Scheduled tasks (cron jobs)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.openclaw.ai/',
            label: 'OpenClaw Docs home',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Community-driven support via official documentation, the GitHub repository/issue tracker, and the broader OpenClaw ecosystem/community channels; no dedicated paid vendor support desk, since no vendor sells a support contract.',
        detail:
          'The project is community-maintained under Foundation governance; support is the standard open-source model of docs, GitHub issues, and community discussion rather than a ticketed enterprise support line.',
        shortValue: 'Docs, GitHub issues, community; no paid vendor support desk',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/openclaw/openclaw',
            label: 'openclaw/openclaw (GitHub)',
            asOf: '2026-07-02',
          },
        ],
      },
      sla: {
        value: 'Not publicly documented',
        detail:
          'No SLA is published, typical for free, self-hosted, community-governed open-source software with no vendor-operated service to guarantee uptime for.',
        shortValue: 'No SLA (self-hosted community project)',
        confidence: 'unknown',
        sources: [],
      },
      community: {
        value:
          "Large and very fast-growing: the GitHub repository has roughly 382,000 stars, reported by multiple sources as the fastest-growing and, by some accounts, most-starred non-aggregator open-source project in GitHub's history, alongside an active ClawHub skill-sharing community.",
        detail:
          'Growth milestones include 9,000 stars in the first 24 hours after launch (as Clawdbot, November 2025) and 247,000+ stars by March 2, 2026. Star counts fluctuate and are best checked live on the GitHub repository.',
        shortValue: '~382,000 GitHub stars, extremely rapid growth since Nov 2025',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/openclaw/openclaw',
            label: 'openclaw/openclaw (GitHub)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://en.wikipedia.org/wiki/OpenClaw',
            label: 'Wikipedia: OpenClaw',
            asOf: '2026-07-02',
          },
        ],
      },
      companyMaturity: {
        value:
          'Not a company: OpenClaw is a community open-source project created by developer Peter Steinberger, first published November 2025 (as "Warelay," later "Clawdbot"). It was renamed "Moltbot" on January 27, 2026 after an Anthropic trademark dispute, then "OpenClaw" three days later. Steinberger joined OpenAI in February 2026 and handed governance to the newly formed, independent, non-profit OpenClaw Foundation, which OpenAI sponsors with multi-year funding and security support.',
        detail:
          'This is a markedly different maturity profile than an incorporated vendor: under nine months old under its current name, extremely fast user/star growth, one primary original author, and governance now vested in a young non-profit foundation rather than an operating company with a multi-year track record.',
        shortValue: 'Community/non-profit project, <9 months old under current name',
        confidence: 'verified',
        sources: [
          {
            url: 'https://en.wikipedia.org/wiki/OpenClaw',
            label: 'Wikipedia: OpenClaw',
            asOf: '2026-07-02',
          },
          {
            url: 'https://openclaw.ai/ecosystem/',
            label: 'OpenClaw Ecosystem page',
            asOf: '2026-07-02',
          },
        ],
      },
      academy: {
        value:
          'No: OpenClaw has no structured courses, certification program, or formal academy. Learning resources are the official documentation site (docs.openclaw.ai), the GitHub repository, and third-party community blog posts/guides, not a vendor-run curriculum.',
        detail:
          'No certification or structured learning-path product exists on official OpenClaw sources, consistent with it being a community open-source project rather than a vendor with a dedicated training business line.',
        shortValue: 'No: docs and community guides only, no formal courses/certification',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/',
            label: 'OpenClaw Docs home',
            asOf: '2026-07-02',
          },
        ],
      },
    },
  },
}
