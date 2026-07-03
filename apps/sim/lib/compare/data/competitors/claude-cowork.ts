import { AnthropicIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Researched against primary Anthropic/Claude sources on 2026-07-02. */
export const claudeCoworkProfile: CompetitorProfile = {
  id: 'claude-cowork',
  name: 'Claude Cowork',
  website: 'https://claude.com/product/cowork',
  isWorkflowBuilder: false,
  brand: {
    icon: AnthropicIcon,
    colors: ['#CC785C', '#F0EFEA', '#141413'],
    source:
      'Public Anthropic brand assets (loftlyy.com, brandcolorcode.com aggregation of official palette)',
    asOf: '2026-07-02',
  },
  oneLiner:
    "Claude Cowork is Anthropic's autonomous desktop agent, built into the Claude Desktop app. Give it a goal in plain language and it works across your own local files, folders, and apps (via connectors, a browser, and direct screen control) to finish a multi-step task end-to-end. It is not a visual workflow builder or automation/integration platform like Sim, n8n, or Zapier. It's an interactive (or scheduled) session-based agent that only runs while the desktop app is open and the computer is awake.",
  standoutFeatures: [
    {
      title: 'Dynamic, runtime tool selection (no pre-wiring)',
      description:
        'Claude picks the fastest path itself at execution time: a connector for Slack, Chrome for web research, or direct screen/computer-use to open an app when no direct integration exists, rather than a builder pre-wiring which tool/connector an agent step uses.',
      shortDescription:
        'Claude picks connectors, browser, or screen control at runtime instead of pre-wired steps.',
      source: {
        url: 'https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork',
        label: 'Anthropic/Claude documentation',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Sub-agent coordination for parallel workstreams',
      description:
        'Cowork analyzes a request, creates a plan, breaks complex work into subtasks, and coordinates parallel sub-agent workstreams to complete them within a single task session.',
      shortDescription:
        'Breaks complex requests into subtasks run by coordinated parallel sub-agents.',
      source: {
        url: 'https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork',
        label: 'Anthropic/Claude documentation',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Granular per-tool/per-connector action controls',
      description:
        "Enterprise admins can restrict specific actions within an MCP connector organization-wide (e.g., allow Gmail read but block send), with each action settable to Always allow / Needs approval / Blocked, layered on top of (not overriding) the underlying service's own permissions.",
      shortDescription: 'Admins can allow, gate, or block individual connector actions org-wide.',
      source: {
        url: 'https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities',
        label: 'Anthropic/Claude documentation',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'OpenTelemetry-based tool/action observability',
      description:
        'Cowork logs every tool/connector call, file read or edit, skill run, and whether each AI action was approved manually or automatically, using OpenTelemetry (an open logging standard). Team/Enterprise plans can export this log to SIEM tools like Splunk or Cribl.',
      shortDescription:
        'Streams every tool call and approval decision to SIEM tools like Splunk or Cribl.',
      source: {
        url: 'https://claude.com/blog/cowork-for-enterprise',
        label: 'Anthropic/Claude documentation',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'File-based plugin system bundling skills, connectors, and sub-agents',
      description:
        'Plugins bundle skills (SKILL.md instruction files), connectors, slash commands, and sub-agents into a single installable package; a built-in Skill Creator tool interviews the user and generates a structured skill file.',
      shortDescription:
        'Installable plugins package skills, connectors, commands, and sub-agents together.',
      source: {
        url: 'https://claude.com/blog/cowork-plugins',
        label: 'Anthropic/Claude documentation',
        asOf: '2026-07-02',
      },
    },
  ],
  limitations: [
    {
      title: 'No unattended/webhook-triggered automation. Desktop app must stay open',
      description:
        'Task initiation is either manual (prompt via desktop or mobile) or on a user-defined schedule (hourly/daily/weekly/weekdays). Scheduled tasks only run while the computer is awake and the Claude Desktop app is open; if the device sleeps or the app is closed, the run is skipped and auto-executed on next wake, with a notification. There is no documented external event/webhook trigger capability.',
      shortDescription:
        'Tasks only run manually or on a schedule while the desktop app is open and awake.',
      source: {
        url: 'https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork',
        label: 'Anthropic/Claude documentation',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'No API publishing / callable endpoint deployment',
      description:
        'Cowork has no documented mechanism to publish or deploy a task as an API endpoint that external systems can call. Unlike a Sim workflow, it is strictly an interactive/scheduled agent session inside the Claude Desktop (and companion mobile) app.',
      shortDescription: 'Tasks cannot be published as callable API endpoints for external systems.',
      source: {
        url: 'https://claude.com/product/cowork',
        label: 'Anthropic/Claude documentation',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Cowork activity is not captured in audit logs / Compliance API',
      description:
        'As of GA, Cowork activity does not appear in the Compliance API or standard data exports. OpenTelemetry (Team/Enterprise only) is the only current visibility mechanism. It can be cross-referenced with Compliance API records via a shared user identifier, but it is not itself a full audit trail.',
      shortDescription:
        'Cowork actions are absent from the Compliance API and standard data exports.',
      source: {
        url: 'https://support.claude.com/en/articles/13364135-use-claude-cowork-safely',
        label: 'Anthropic/Claude documentation',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Computer-use has no sandboxing between Claude and the screen',
      description:
        "Unlike file operations or code execution (which run in an isolated VM), direct computer-use/screen interaction is not sandboxed; Anthropic documents prompt-injection risk and recommends active supervision, avoiding sensitive data, and caution with the 'Act Without Asking' mode.",
      shortDescription:
        'Screen/computer-use actions run unsandboxed, carrying prompt-injection risk.',
      source: {
        url: 'https://support.claude.com/en/articles/13364135-use-claude-cowork-safely',
        label: 'Anthropic/Claude documentation',
        asOf: '2026-07-02',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value: 'Conversational/prompt-driven autonomous agent (not a visual workflow builder)',
        detail:
          'User describes a goal in natural language in the Cowork tab of Claude Desktop; Claude analyzes the request, creates a plan, and executes across files/apps/connectors without step-by-step drag-and-drop configuration.',
        shortValue: 'Conversational agent, not a visual builder',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.anthropic.com/product/claude-cowork',
            label: 'Claude Cowork product page (Anthropic)',
            asOf: '2026-07-02',
          },
        ],
      },
      learningCurve: {
        value: 'Low. Designed for non-technical knowledge workers',
        detail:
          'Marketed explicitly for knowledge workers who need to handle repetitive, multi-step tasks involving files, documents, and data without technical or coding expertise; interaction is purely natural-language prompts.',
        shortValue: 'Low. Built for non-technical users',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.anthropic.com/product/claude-cowork',
            label: 'Claude Cowork product page (Anthropic)',
            asOf: '2026-07-02',
          },
        ],
      },
      selfHostOption: {
        value: 'No',
        detail:
          "Cowork is a proprietary desktop application (macOS/Windows, Linux in beta) that requires a paid Claude plan and connects to Anthropic's cloud; no self-hosted/on-prem deployment is documented.",
        shortValue: 'No self-hosting option',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork',
            label: 'Get started with Claude Cowork',
            asOf: '2026-07-02',
          },
        ],
      },
      deploymentOptions: {
        value:
          'Claude Desktop app (macOS, Windows, Linux beta); companion mobile messaging while desktop app stays active',
        detail:
          "Tasks execute in an isolated virtual machine on the user's computer; Pro/Max users can message/monitor from a phone while the desktop app remains open.",
        shortValue: 'Desktop app (Mac/Windows/Linux beta) + mobile',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13947068-assign-tasks-from-anywhere-in-claude-cowork',
            label: 'Assign tasks from anywhere in Claude Cowork',
            asOf: '2026-07-02',
          },
        ],
      },
      templates: {
        value: 'Plugin marketplace + open-source plugin templates',
        detail:
          'Plugins bundle skills/connectors/sub-agents/slash commands into installable packages; Anthropic provides starter templates and an open-source knowledge-work-plugins repo.',
        shortValue: 'Plugin marketplace + OSS templates',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://claude.com/blog/cowork-plugins',
            label: 'Customize Cowork with plugins',
            asOf: '2026-07-02',
          },
        ],
      },
      license: {
        value: 'Proprietary (closed-source SaaS/desktop product)',
        detail:
          'Claude Cowork is a commercial Anthropic product bundled into paid Claude plans; not open source, unlike Sim.',
        shortValue: 'Closed-source proprietary product',
        confidence: 'verified',
        sources: [
          { url: 'https://claude.com/pricing', label: 'Plans & Pricing', asOf: '2026-07-02' },
        ],
      },
      environmentPromotion: {
        value: 'N/A: no dev/qa/prod concept exists',
        detail:
          'Cowork is a single-session desktop agent, not a deployable multi-stage application; no environment fork/promote concept is documented.',
        shortValue: 'No dev/staging/prod concept',
        confidence: 'verified',
        sources: [],
      },
      versionControlDepth: {
        value: 'Not documented / no native version control',
        detail:
          'Plugins/skills are file-based (SKILL.md and package files) which could in principle be tracked in an external VCS by the user, but no built-in versioning, diffing, or rollback feature for tasks/plugins is documented.',
        shortValue: 'No native version control',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://claude.com/blog/cowork-plugins',
            label: 'Customize Cowork with plugins',
            asOf: '2026-07-02',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          "No: Claude Cowork sessions run for a single user and cannot be shared with others in real time. There is no live multi-cursor, multi-selection editing of the same Cowork task. The closest feature, 'Shared Workspaces,' lets humans and the agent work on shared cloud files together, but it coordinates through file locking (the agent locks a file while editing, then releases it) rather than live synced editing.",
        shortValue: 'No: single-user sessions, file-locking not live co-editing',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13455879-use-claude-cowork-on-team-and-enterprise-plans',
            label: 'Use Claude Cowork on Team and Enterprise plans',
            asOf: '2026-07-02',
          },
          {
            url: 'https://fast.io/resources/claude-cowork-shared-workspace/',
            label: 'How to Set Up a Claude Cowork Shared Workspace',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeFileStorage: {
        value:
          "No: Claude Cowork works directly on the user's local files and folders inside an isolated sandboxed VM on their own machine. It is not a native cloud file-storage product with its own folder hierarchy, link-based sharing (password/SSO options), and deleted-item recovery. Recovering files after a destructive Cowork action relies on OS-level backup tools (Time Machine, File History, iCloud) or third-party recovery scripts, not a built-in trash or recovery feature.",
        detail:
          'There have been documented incidents of Cowork deleting user files with no built-in recovery path, underscoring this is local file access, not a managed storage product.',
        shortValue: 'No: operates on local files, no native cloud storage/trash',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork',
            label: 'Get started with Claude Cowork',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/anthropics/claude-code/issues/32637',
            label: '[BUG] Cowork destroys user files when reorganizing (GitHub issue)',
            asOf: '2026-07-02',
          },
        ],
      },
      dataTables: {
        value:
          "No: Claude Cowork has no native in-platform spreadsheet/data-table object. It manipulates rows/columns and formulas inside external files (Excel .xlsx, Google Sheets via connector) on the user's local filesystem or a connected app, not a first-party database-like table stored in the Claude workspace itself.",
        detail:
          'Cowork is a desktop file/task agent, not a workflow platform with a persisted data-table primitive, so this fact does not map cleanly onto its shape.',
        shortValue: 'No: works on external files, no native table object',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/12111783-create-and-edit-files-with-claude',
            label: 'Create and edit files with Claude',
            asOf: '2026-07-02',
          },
          {
            url: 'https://composio.dev/toolkits/excel/framework/claude-cowork',
            label: 'How to connect Excel to Claude Cowork',
            asOf: '2026-07-02',
          },
        ],
      },
      richTextEditor: {
        value:
          "No: Claude's document surface (Artifacts) is generated and edited by Claude itself. Per third-party comparisons, Artifacts remain view-only for the user (only Claude can edit the content), unlike a true inline WYSIWYG editor. Claude for Word is a separate Microsoft Word add-in, not an in-platform rich text editor for documents stored in Claude.",
        detail:
          'Anthropic has shipped faster inline-edit updates to Artifacts (Oct 2025) but this is Claude regenerating content, not a user-drivable rich text editor.',
        shortValue: 'No: Artifacts are Claude-edited, not user WYSIWYG',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://unmarkdown.com/blog/claude-artifacts-vs-chatgpt-canvas',
            label: 'Claude Artifacts vs ChatGPT Canvas vs Gemini Gems',
            asOf: '2026-07-02',
          },
          {
            url: 'https://support.claude.com/en/articles/14465370-use-claude-for-word',
            label: 'Use Claude for Word',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value: 'No: Claude models only',
        detail:
          "Cowork runs exclusively on Anthropic's Claude models; users can optionally specify which Claude model a scheduled task uses, but there is no support for non-Anthropic LLMs.",
        shortValue: 'Claude models only',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork',
            label: 'Schedule recurring tasks in Claude Cowork',
            asOf: '2026-07-02',
          },
        ],
      },
      agentReasoningBlocks: {
        value: 'Yes',
        detail:
          'Cowork analyzes a request and creates a plan, breaking complex work into subtasks and coordinating parallel sub-agent workstreams; built on the same agentic architecture as Claude Code, with extended thinking available.',
        shortValue: 'Plan-then-execute with sub-agents',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork',
            label: 'Get started with Claude Cowork',
            asOf: '2026-07-02',
          },
        ],
      },
      naturalLanguageBuilding: {
        value: 'Yes: this is the entire interaction model',
        detail:
          'There is no visual builder; every task is defined by describing the desired outcome in natural language.',
        shortValue: 'Natural language is the only interface',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.anthropic.com/product/claude-cowork',
            label: 'Claude Cowork product page (Anthropic)',
            asOf: '2026-07-02',
          },
        ],
      },
      knowledgeBaseRag: {
        value: 'Partial: project-scoped memory/files, not a dedicated vector DB/RAG feature',
        detail:
          "Memory is supported within projects but is not retained across standalone Cowork sessions. No documented dedicated knowledge-base/embedding/RAG system comparable to Sim's Knowledge Base module.",
        shortValue: 'Project memory only, no RAG',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork',
            label: 'Get started with Claude Cowork',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpSupport: {
        value: 'Yes: broad, first-class MCP support',
        detail:
          'Cowork connects to external services via connectors built on the Model Context Protocol (remote MCP), managed through a Connectors Directory; a Zoom MCP connector was announced with GA (April 9, 2026) for meeting summaries, transcripts, recordings, and scheduling.',
        shortValue: 'Broad MCP connector support',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities',
            label: "Use connectors to extend Claude's capabilities",
            asOf: '2026-07-02',
          },
          {
            url: 'https://claude.com/blog/cowork-for-enterprise',
            label: 'Making Claude Cowork ready for enterprise',
            asOf: '2026-07-02',
          },
        ],
      },
      evaluationGuardrails: {
        value: 'Safety guardrails, not a formal eval/testing framework',
        detail:
          'Documented protections: RL training against malicious instructions, content classifiers scanning untrusted content for prompt injection, and per-application permission gates. No documented eval-suite/regression-testing feature for tasks.',
        shortValue: 'Safety guardrails, no eval framework',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13364135-use-claude-cowork-safely',
            label: 'Use Claude Cowork safely',
            asOf: '2026-07-02',
          },
        ],
      },
      humanInTheLoop: {
        value: 'Yes: plan review and per-action approval by default',
        detail:
          "Claude shows a plan and waits for approval before acting; explicit permission is required before permanently deleting files and before accessing each application; an opt-in 'Act Without Asking' mode removes step-by-step pauses but Anthropic warns it increases prompt-injection risk.",
        shortValue: 'Plan review + per-action approval',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13364135-use-claude-cowork-safely',
            label: 'Use Claude Cowork safely',
            asOf: '2026-07-02',
          },
        ],
      },
      generativeMedia: {
        value: 'No native image/video generation in Cowork itself',
        detail:
          "Cowork creates documents/spreadsheets/slide decks via direct file operations. Image/video generation requires third-party MCP connectors; Anthropic's separate 'Claude Design' product handles native visual/image generation, not Cowork.",
        shortValue: 'No native image/video generation',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.anthropic.com/news/claude-design-anthropic-labs',
            label: 'Introducing Claude Design by Anthropic Labs',
            asOf: '2026-07-02',
          },
        ],
      },
      dynamicToolUse: {
        value: 'Yes: Claude selects tools/connectors dynamically at runtime',
        detail:
          "Documented directly: Claude picks the fastest path. A connector for Slack, Chrome for web research, or the screen to open apps when there's no direct integration. This contrasts with Sim's agent blocks, where tool availability is pre-wired by the workflow builder.",
        shortValue: 'Picks tools dynamically at runtime',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork',
            label: 'Get started with Claude Cowork',
            asOf: '2026-07-02',
          },
        ],
      },
      modelFallback: {
        value: 'Unknown',
        detail:
          'No documentation found describing automatic fallback between Claude models on error/overload for Cowork tasks.',
        shortValue: 'Not documented',
        confidence: 'unknown',
        sources: [],
      },
      agentSkills: {
        value:
          "Yes: Claude Skills let a builder write a reusable instruction set once (a folder with a SKILL.md file plus optional reference docs, templates, and scripts). Claude automatically pulls in the right skill whenever the context matches, across Claude Code, Claude Desktop, Cowork, and claude.ai. Anthropic also ships a pre-installed 'Skill Creator' tool for building new skills.",
        detail:
          'Skills with executable code files (Python/bash) only run in Claude Code and Cowork, not plain claude.ai chat.',
        shortValue: 'Yes: named, reusable Skills (SKILL.md)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork',
            label: 'Get started with Claude Cowork',
            asOf: '2026-07-02',
          },
          {
            url: 'https://genaiunplugged.substack.com/p/claude-skills-reusable-workflows-code-cowork',
            label: 'Claude Skills 2.0: Reusable AI Workflows That Save Hours',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeChatDeployment: {
        value:
          "No: Claude does not offer a native feature to deploy a configured agent as a standalone public-facing chat surface. Claude Projects can only be shared internally (org-wide 'Public' visibility inside the same organization, not the open internet), and Claude Artifacts can be published/embedded as static interactive content, but neither is a deployable conversational agent endpoint.",
        detail:
          'Third parties (e.g. Composio, Social Intents) offer unofficial embeddable widgets wrapping the Claude API, but that is not a native Anthropic product feature.',
        shortValue: 'No: no public agent-chat deployment surface',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.cometapi.com/how-do-i-take-a-claude-project-public-and-publish/',
            label: 'How do I take a Claude project public and publish',
            asOf: '2026-07-02',
          },
          {
            url: 'https://support.claude.com/en/articles/9547008-publish-and-share-artifacts',
            label: 'Publish and share artifacts',
            asOf: '2026-07-02',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          "Unknown: Anthropic's developer platform documents sentence-level document chunking for the Citations API (a document is chunked so Claude can cite a specific sentence or span), but there is no public evidence of a chunk-level debugging UI for knowledge-base search results inside Claude Cowork or claude.ai for end users.",
        detail:
          "Cowork does not have a distinct 'knowledge base' product module the way Sim does; it draws on local files and connectors instead, so a chunk-inspection view genuinely may not exist in this shape.",
        shortValue: 'Unknown: chunking exists at API level, no product UI found',
        confidence: 'unknown',
        sources: [],
      },
      parallelExecution: {
        value:
          "Yes: Anthropic's own help documentation for Claude Cowork states that Claude 'breaks complex work into smaller tasks and coordinates parallel workstreams to complete them' and 'may coordinate multiple sub-agents working simultaneously' for complex tasks, with results synthesized back into one outcome.",
        detail:
          "This is model-driven sub-agent fan-out rather than a user-authored 'parallel branches' node in a visual builder (Cowork has no visual workflow canvas). The underlying mechanism matches Claude Code's dynamic workflows, which explicitly fan work across concurrent subagents (up to 1,000 total, capped at 16 concurrent) and merge results, but Cowork's own documentation describes this at a higher, less configurable level.",
        shortValue: 'Yes: automatic sub-agent parallel workstreams, not user-configurable',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork',
            label: 'Get started with Claude Cowork',
            asOf: '2026-07-02',
          },
          {
            url: 'https://code.claude.com/docs/en/workflows',
            label: 'Orchestrate subagents at scale with dynamic workflows',
            asOf: '2026-07-02',
          },
        ],
      },
      a2aProtocol: {
        value:
          'No: no public Anthropic documentation states that Claude Cowork (or Claude products generally) implements the Agent2Agent (A2A) protocol as an agent-to-agent peer standard.',
        detail:
          "Anthropic has run a joint webinar on deploying multi-agent systems using MCP and A2A together with Claude on Google Cloud Vertex AI, but that describes third-party orchestration infrastructure around Claude, not native A2A support built into Cowork or the Claude API. Anthropic's own multi-agent story is MCP for tool/data connections and Managed Agents/sub-agent coordination for delegation, not A2A.",
        shortValue: 'No: not documented as a native capability',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.anthropic.com/webinars/deploying-multi-agent-systems-using-mcp-and-a2a-with-claude-on-vertex-ai',
            label: 'Deploying multi-agent systems using MCP and A2A with Claude on Vertex AI',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value: '200+ connectors (third-party estimate; Anthropic does not publish an exact figure)',
        detail:
          "Anthropic's own Connectors Directory lists connectors like Linear, Slack, Google Drive, Google Workspace, and Microsoft 365, but no primary Anthropic page states a total count.",
        shortValue: '200+ connectors (estimated)',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities',
            label: "Use connectors to extend Claude's capabilities",
            asOf: '2026-07-02',
          },
        ],
      },
      triggerTypes: {
        value: 'Manual (on-demand) or schedule-based only. No external event/webhook triggers',
        detail:
          'Tasks start either by user prompt (desktop or mobile) or on a defined schedule (hourly/daily/weekly/weekdays); scheduled runs require the computer awake and desktop app open. No documented capability to trigger a task from an inbound webhook or other external event.',
        shortValue: 'Manual or scheduled only, no webhooks',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork',
            label: 'Schedule recurring tasks in Claude Cowork',
            asOf: '2026-07-02',
          },
        ],
      },
      customCodeSteps: {
        value: 'No user-authorable code-step primitive; agent can execute code internally',
        detail:
          'Cowork tasks run in an isolated VM and can execute code as part of completing a task, but there is no documented workflow-builder-style code block a user writes/inserts into a task definition.',
        shortValue: 'No user-authorable code step',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.anthropic.com/product/claude-cowork',
            label: 'Claude Cowork product page (Anthropic)',
            asOf: '2026-07-02',
          },
        ],
      },
      apiPublishing: {
        value: 'No',
        detail:
          'No documented mechanism exists to publish or deploy a Cowork task as a callable API endpoint; the product is strictly an interactive desktop/mobile agent session, unlike a deployed Sim workflow.',
        shortValue: 'No API endpoint deployment',
        confidence: 'verified',
        sources: [
          {
            url: 'https://claude.com/product/cowork',
            label: 'Claude Cowork product page (Claude)',
            asOf: '2026-07-02',
          },
        ],
      },
      extensibilitySdk: {
        value: 'Partial: file-based plugin/skill authoring, not a dedicated public SDK',
        detail:
          'Skills are plain SKILL.md instruction files. Plugins bundle skills, connectors, slash commands, and sub-agents together, and a built-in Skill Creator tool generates skill files interactively. New connectors are typically built as standard MCP servers rather than through a Cowork-specific SDK.',
        shortValue: 'Plugin/skill files, no dedicated SDK',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://claude.com/blog/cowork-plugins',
            label: 'Customize Cowork with plugins',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpPublishing: {
        value:
          "Unknown/Not applicable: Claude Cowork is documented as an MCP client (it consumes remote and custom-connector MCP servers), but there is no public evidence Cowork lets a user publish a Cowork session/task or a 'workflow' as a callable MCP server for external tools to consume.",
        detail:
          "Cowork is a desktop agent, not a workflow builder with deployable artifacts, so the reverse-direction 'publish as MCP server' concept does not map onto it the way it does for Sim.",
        shortValue: 'N/A: consumes MCP, no evidence of publishing as server',
        confidence: 'unknown',
        sources: [],
      },
    },
    pricing: {
      pricingModel: {
        value: 'Bundled into Claude subscription plans (no separate Cowork charge)',
        detail:
          "Cowork is included at no additional charge on Pro, Max, Team, and Enterprise plans, subject to each plan's overall usage limits.",
        shortValue: 'Included in Claude subscription plans',
        confidence: 'verified',
        sources: [
          { url: 'https://claude.com/pricing', label: 'Plans & Pricing', asOf: '2026-07-02' },
        ],
      },
      entryPaidPlan: {
        value: 'Pro plan. $17/month billed annually ($20/month billed monthly)',
        detail:
          'Pro is the lowest-priced individual plan whose feature list explicitly includes Claude Cowork.',
        shortValue: '$17/mo annual ($20/mo monthly)',
        confidence: 'verified',
        sources: [
          { url: 'https://claude.com/pricing', label: 'Plans & Pricing', asOf: '2026-07-02' },
        ],
      },
      freeTier: {
        value: 'Free plan exists but does not include Claude Cowork',
        detail:
          "The Free plan's feature list does not mention Cowork; Cowork requires a paid plan (Pro, Max, Team, or Enterprise).",
        shortValue: 'Free plan excludes Cowork',
        confidence: 'verified',
        sources: [
          { url: 'https://claude.com/pricing', label: 'Plans & Pricing', asOf: '2026-07-02' },
        ],
      },
      byok: {
        value: 'Not documented / not applicable',
        detail:
          "No bring-your-own-API-key or bring-your-own-model option is documented for Cowork; it runs exclusively on Claude models under the user's subscription.",
        shortValue: 'Not documented',
        confidence: 'unknown',
        sources: [],
      },
    },
    security: {
      soc2: {
        value: 'Yes (company-wide, not Cowork-specific)',
        detail:
          'Anthropic holds SOC 2 Type I and Type II; the detailed report is available under NDA via the Anthropic Trust Portal. No Cowork-specific SOC 2 scoping statement was found.',
        shortValue: 'Company-wide, not Cowork-specific',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://trust.anthropic.com/',
            label: 'Anthropic Trust Center',
            asOf: '2026-07-02',
          },
        ],
      },
      dataResidency: {
        value:
          'No Cowork-specific residency controls; company-wide default is multi-region processing, US-based storage',
        detail:
          "Anthropic's general policy processes data in the US, Europe, Asia, and Australia by default with data at rest stored in the US; guaranteed regional inference is only available via AWS Bedrock, GCP Vertex AI, or Microsoft Foundry deployments of the Claude API; this is not documented as a Cowork feature.",
        shortValue: 'US storage by default, no regional control',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/10015870-what-certifications-has-anthropic-obtained',
            label: 'What Certifications has Anthropic obtained?',
            asOf: '2026-07-02',
          },
        ],
      },
      rbac: {
        value: 'Yes: GA enterprise feature (April 9, 2026)',
        detail:
          'Enterprise/Team admins organize users into groups manually or via SCIM integration with existing identity providers, and assign roles defining which Claude capabilities (including Cowork) members can access.',
        shortValue: 'GA enterprise RBAC (Apr 2026)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://claude.com/blog/cowork-for-enterprise',
            label: 'Making Claude Cowork ready for enterprise',
            asOf: '2026-07-02',
          },
        ],
      },
      auditLogging: {
        value:
          'Limited: not in Compliance API/exports; OpenTelemetry is the primary visibility path',
        detail:
          'Anthropic documents that Cowork activity is not captured in the Compliance API at this time. Team/Enterprise customers can stream tool/file/skill/approval events via OpenTelemetry to SIEM tools, with a shared user identifier allowing correlation with (but not replacing) Compliance API records.',
        shortValue: 'OTel only, not in Compliance API',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13364135-use-claude-cowork-safely',
            label: 'Use Claude Cowork safely',
            asOf: '2026-07-02',
          },
        ],
      },
      additionalCompliance: {
        value:
          'ISO 27001:2022, ISO/IEC 42001:2023, HIPAA-ready (BAA via sales-assisted Enterprise), GDPR',
        detail: 'Company-wide Anthropic certifications, not Cowork-scoped statements specifically.',
        shortValue: 'ISO 27001, ISO 42001, HIPAA-ready, GDPR',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/10015870-what-certifications-has-anthropic-obtained',
            label: 'What Certifications has Anthropic obtained?',
            asOf: '2026-07-02',
          },
        ],
      },
      modelAndToolGovernance: {
        value: 'Yes: Group Spend Limits and Per-Tool Connector Controls (GA, April 9, 2026)',
        detail:
          "Group Spend Limits: per-team/per-group budgets set from the admin console (all paid plans), with the most-restrictive limit across a user's groups applying. Per-Tool Connector Controls: admins can restrict specific actions within an MCP connector organization-wide (e.g., Gmail read-only, no send).",
        shortValue: 'Spend limits + per-tool controls',
        confidence: 'verified',
        sources: [
          {
            url: 'https://claude.com/blog/cowork-for-enterprise',
            label: 'Making Claude Cowork ready for enterprise',
            asOf: '2026-07-02',
          },
        ],
      },
      credentialGovernance: {
        value:
          'Yes: On Enterprise plans, custom roles have a dedicated Connectors tab (separate from Capabilities/Permissions). Admins set access per connector, and per tool within a connector, as Always allow / Needs approval / Blocked, so a role can be limited to specific connected credentials rather than every organization connector.',
        detail:
          "Applies only to members on the 'Custom' role; User/Admin/Owner roles see every connector enabled org-wide.",
        shortValue: 'Yes: per-role connector/credential restrictions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13930452-manage-custom-roles-on-enterprise-plans',
            label: 'Manage custom roles on Enterprise plans',
            asOf: '2026-07-02',
          },
          {
            url: 'https://support.claude.com/en/articles/13930458-set-up-role-based-permissions-on-enterprise-plans',
            label: 'Set up role-based permissions on Enterprise plans',
            asOf: '2026-07-02',
          },
          {
            url: 'https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities',
            label: "Use connectors to extend Claude's capabilities",
            asOf: '2026-07-02',
          },
        ],
      },
      whiteLabeling: {
        value:
          "No/Unknown: No public evidence Anthropic lets an Enterprise customer replace Claude's own product branding (logo, product name, theme colors) inside the Claude Desktop, Cowork, or claude.ai interface itself. Claude Design (launched April 2026) lets Claude produce branded deliverables (documents, decks, landing pages) carrying the customer's brand, but that brands the output, not the vendor's own workspace UI.",
        shortValue: 'No: brands outputs, not the Claude UI itself',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://www.anthropic.com/news/claude-design-anthropic-labs',
            label: 'Introducing Claude Design by Anthropic Labs',
            asOf: '2026-07-02',
          },
        ],
      },
      dataRetention: {
        value:
          'Yes: Enterprise plan Owners/Primary Owners can set a custom data retention period (minimum 30 days) for conversation data and audit logs in Organization settings > Data and Privacy. Without customization, data is kept indefinitely.',
        detail:
          "This is an org-wide Claude Enterprise setting, not shown to apply per-resource-type the way Sim's granular retention does; Cowork's local session history sits outside this policy entirely (stored only on-device). No Zero-Data-Retention addendum for conversation data was found in Anthropic's current documentation, so that claim has been removed pending a verifiable source.",
        shortValue: 'Yes: org-configurable retention, min 30 days, indefinite by default',
        confidence: 'verified',
        sources: [
          {
            url: 'https://privacy.claude.com/en/articles/10440198-configure-custom-data-retention-controls-for-enterprise-plans',
            label: 'Configure custom data retention controls for Enterprise plans',
            asOf: '2026-07-02',
          },
          {
            url: 'https://support.claude.com/en/articles/13455879-use-claude-cowork-on-team-and-enterprise-plans',
            label: 'Use Claude Cowork on Team and Enterprise plans',
            asOf: '2026-07-02',
          },
        ],
      },
      piiRedaction: {
        value:
          "No/Unknown: No official Anthropic documentation describes a native, automatic PII detection/redaction feature applied to Cowork workflow content or retained logs. Third-party tools (gateway layers, Presidio-based scanners, 'noirdoc' plugin) exist to add PII scrubbing around Claude, but this is not a built-in platform capability.",
        shortValue: 'No: no native PII redaction found',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://mcpmanager.ai/blog/pii-redaction-for-mcp-servers/',
            label: 'PII Redaction for MCP Servers: 3 Methods to Block Sensitive Data',
            asOf: '2026-07-02',
          },
        ],
      },
      sso: {
        value:
          'Yes: Claude Enterprise supports SAML 2.0 single sign-on with identity providers like Okta, Entra ID, Google, OneLogin, JumpCloud, and Duo, plus domain capture (claims your email domain so all logins route through SSO) and automated JIT/SCIM user provisioning and de-provisioning tied to the IdP.',
        detail:
          "This is an Enterprise-plan feature covering claude.ai/Claude Desktop/Cowork logins collectively, not something configured separately for Cowork. Anthropic's SSO documentation describes SAML integrations specifically; no OIDC support is documented, so that claim has been removed.",
        shortValue: 'Yes: SAML SSO + SCIM auto-provisioning',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13132885-set-up-single-sign-on-sso',
            label: 'Set up single sign-on (SSO)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://support.claude.com/en/articles/10276682-important-considerations-before-enabling-single-sign-on-sso-and-jit-scim-provisioning',
            label: 'Important considerations before enabling SSO and JIT/SCIM provisioning',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value: 'OpenTelemetry event stream (Team/Enterprise), not block-by-block execution tracing',
        detail:
          "Cowork emits OTel events for tool/connector calls, file reads/modifications, skills used, and whether each action was approved manually or automatically; compatible with Splunk/Cribl SIEM pipelines. An Analytics API adds per-user activity and skill/connector invocation counts plus DAU/WAU/MAU. This is coarser than a per-block execution trace like Sim's Logs module.",
        shortValue: 'OTel events, not block-level tracing',
        confidence: 'verified',
        sources: [
          {
            url: 'https://claude.com/blog/cowork-for-enterprise',
            label: 'Making Claude Cowork ready for enterprise',
            asOf: '2026-07-02',
          },
        ],
      },
      durabilityModel: {
        value: 'Weak. Client-dependent, not durable server-side execution',
        detail:
          "Scheduled tasks only run while the computer is awake and Claude Desktop is open; a missed run due to sleep/closed app is skipped and auto-run on next wake (with a notification), rather than executed reliably at the scheduled time on infrastructure independent of the user's machine.",
        shortValue: 'Client-dependent, not server-durable',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork',
            label: 'Schedule recurring tasks in Claude Cowork',
            asOf: '2026-07-02',
          },
        ],
      },
      failureAlerting: {
        value: 'Minimal. Notification only for skipped scheduled runs',
        detail:
          'Users receive a notification when a scheduled task run is skipped because the computer was asleep or the app was closed; no broader documented failure-alerting/retry policy for task errors.',
        shortValue: 'Notifies only on skipped runs',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork',
            label: 'Schedule recurring tasks in Claude Cowork',
            asOf: '2026-07-02',
          },
        ],
      },
      dataDrains: {
        value:
          "Yes: Claude Enterprise's Compliance API (GET /v1/compliance/activities) gives programmatic, ongoing access to the organization's activity feed and configuration state, and Anthropic documents/supports pull-based pipelines that continuously land this data in S3/Azure Blob and feed SIEM tools like Datadog Cloud SIEM. There is also a narrower manual CSV audit-log export in claude.ai org settings.",
        detail:
          "This is a general Claude Enterprise platform feature (Compliance API), not something surfaced as a Cowork-specific setting; Cowork's own local session history is explicitly NOT centrally exportable by admins.",
        shortValue: 'Yes: Compliance API to S3/SIEM (Datadog)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://platform.claude.com/docs/en/manage-claude/compliance-api',
            label: 'Compliance API - Claude Platform Docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.datadoghq.com/blog/cloud-siem-claude-compliance-api-integration/',
            label: 'Monitor Claude Enterprise activity with Datadog Cloud SIEM',
            asOf: '2026-07-02',
          },
          {
            url: 'https://support.claude.com/en/articles/15167101-get-started-with-claude-compliance-api-integrations',
            label: 'Get started with Claude Compliance API integrations',
            asOf: '2026-07-02',
          },
          {
            url: 'https://support.claude.com/en/articles/13455879-use-claude-cowork-on-team-and-enterprise-plans',
            label: 'Use Claude Cowork on Team and Enterprise plans',
            asOf: '2026-07-02',
          },
        ],
      },
      asyncExecution: {
        value:
          "No: Claude Cowork does not offer true server-side background execution you can walk away from indefinitely. Anthropic's own help center states the Claude Desktop app must remain open while Claude works, and that closing the app ends the session. Scheduled/recurring tasks (set up via the /schedule skill) run at a set cadence, but only while the computer is awake and the desktop app is open, and they are skipped (then caught up later) if the app is closed when the run was due.",
        detail:
          "Anthropic's marketing language ('assign a task and step away') means you don't have to babysit each step in real time within an open session, and scheduled tasks let you check back later for results. But this is not equivalent to a cloud job you can trigger and poll while fully offline: the desktop app and an awake machine are hard prerequisites.",
        shortValue: 'Requires app open, not fully async',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork',
            label: 'Get started with Claude Cowork (Claude Help Center)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork',
            label: 'Schedule recurring tasks in Claude Cowork (Claude Help Center)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.anthropic.com/product/claude-cowork',
            label: 'Claude Cowork product page (Anthropic)',
            asOf: '2026-07-02',
          },
        ],
      },
      executionLimits: {
        value:
          "Anthropic publishes only relative and structural limit information for Cowork/Claude Code, not fixed absolute numbers: usage is metered on a rolling 5-hour window, which varies by plan (Pro, Max, Team, Enterprise) and was doubled, with the peak-hours limit reduction removed, in Anthropic's May 2026 update. Per-request behavior is documented concretely: the default API request timeout is 10 minutes (600000ms, configurable via API_TIMEOUT_MS), and transient errors are auto-retried up to 10 times (capped at 15) with exponential backoff before surfacing a failure.",
        detail:
          "Anthropic does not publish an exact numeric ceiling for '5-hour window' usage (e.g. a fixed message or token count) or a documented concurrent-task limit for Cowork specifically, only that limits are plan-dependent and were doubled/loosened in May 2026. The 10-minute request timeout and retry counts come from Claude Code's official error reference, which explicitly states it applies across the CLI, Desktop app, and web.",
        shortValue: '10-min request timeout, rolling 5-hour window',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://code.claude.com/docs/en/errors',
            label: 'Error reference: automatic retries and request timeout (Claude Code Docs)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.anthropic.com/news/higher-limits-spacex',
            label: 'Higher usage limits for Claude and a compute deal with SpaceX (Anthropic)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work',
            label: 'How do usage and length limits work? (Claude Help Center)',
            asOf: '2026-07-02',
          },
        ],
      },
      partialFailureHandling: {
        value:
          "No: Cowork/Claude Code runs as a single sequential agentic conversation rather than a branching workflow. There is no documented mechanism to route a failed step to a separate error-handling path while the rest of the run continues independently. Anthropic's official error reference describes only two outcomes for a failure: transient errors (server 5xx, overload, timeouts, dropped connections) are automatically retried up to 10 times with exponential backoff, and the run continues if a retry succeeds; once retries are exhausted, the error surfaces and the in-flight turn halts, requiring the user to retry the request or use /rewind to step back to an earlier checkpoint and resume manually.",
        detail:
          'This is a materially different model from a DAG-style workflow with per-branch try/catch: Cowork has no concept of parallel branches where one can fail into an error handler while sibling branches keep executing. Community bug reports (e.g. GitHub issues on Cowork task failures) corroborate that a hard failure stops the task rather than isolating it to one step.',
        shortValue: 'No branching error path, retries then halts',
        confidence: 'verified',
        sources: [
          {
            url: 'https://code.claude.com/docs/en/errors',
            label:
              'Error reference: automatic retries, server errors, and checkpoint recovery (Claude Code Docs)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/anthropics/claude-code/issues/60577',
            label:
              'Transient 529 Overloaded API errors abort long-running tasks with no auto-recovery (GitHub issue)',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'AI support bot for all tiers; human support (in-app messenger + email escalation) for Pro/Max and Enterprise Owners; no phone or live chat',
        detail:
          'An AI bot is available to all users via the in-app support messenger. Pro/Max users and Enterprise Owners get full human Product Support access; Anthropic explicitly states it does not offer phone or live chat support.',
        shortValue: 'AI bot for all, human on paid plans',
        confidence: 'verified',
        sources: [
          {
            url: 'https://support.claude.com/en/articles/9015913-how-to-get-support',
            label: 'How to get support',
            asOf: '2026-07-02',
          },
        ],
      },
      sla: {
        value: 'Not publicly documented',
        detail:
          'No published SLA terms were found; sales-assisted Enterprise plans offer dedicated customer success management but no stated uptime/response-time SLA.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      community: {
        value: 'City-based community program + open-source plugin repo (no dedicated forum found)',
        detail:
          "Anthropic runs a city-based 'Claude Community' program; an open-source knowledge-work-plugins repo exists for sharing Cowork/Claude Code plugins. No dedicated public discussion forum comparable to n8n's or Sim's community forum was found on a primary Anthropic page.",
        shortValue: 'City meetups + open-source plugin repo',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://claude.com/community',
            label: 'Community | Claude by Anthropic',
            asOf: '2026-07-02',
          },
        ],
      },
      companyMaturity: {
        value:
          'Anthropic. Major frontier AI lab; Cowork research preview Jan 12, 2026 → GA April 9, 2026',
        detail:
          'Claude Cowork launched January 12, 2026 as a research preview limited to Max plan subscribers; it reached General Availability on April 9, 2026 across all paid plans (Pro, Max, Team, Enterprise) on macOS and Windows, alongside new enterprise controls. Linux support is in beta.',
        shortValue: 'Anthropic; reached GA April 2026',
        confidence: 'verified',
        sources: [
          {
            url: 'https://claude.com/blog/cowork-for-enterprise',
            label: 'Making Claude Cowork ready for enterprise',
            asOf: '2026-07-02',
          },
        ],
      },
      academy: {
        value:
          "Yes: Anthropic Academy (anthropic.skilljar.com) offers a structured set of free, self-paced courses across three tracks (AI Fluency, Product Training, Developer Deep-Dives), each awarding a completion certificate, plus a paid proctored 'Claude Certified Architect' professional certification launched under the Claude Partner Network.",
        detail:
          "This is a general Claude/Anthropic learning resource, not Cowork-specific, but it does cover Cowork usage (e.g. the 'Introduction to Claude Cowork' course).",
        shortValue: 'Yes: Anthropic Academy + certification',
        confidence: 'verified',
        sources: [
          {
            url: 'https://anthropic.skilljar.com/',
            label: 'Anthropic Courses (Academy)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://anthropic.skilljar.com/introduction-to-claude-cowork',
            label: 'Introduction to Claude Cowork course',
            asOf: '2026-07-02',
          },
          {
            url: 'https://www.pearsonvue.com/us/en/anthropic.html',
            label: 'Claude Certification Program by Anthropic - Pearson VUE',
            asOf: '2026-07-02',
          },
        ],
      },
    },
  },
}
