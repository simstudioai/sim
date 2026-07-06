import { PipedreamIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Researched and cross-verified against live vendor sources on 2026-07-02. */
export const pipedreamProfile: CompetitorProfile = {
  id: 'pipedream',
  name: 'Pipedream',
  website: 'https://pipedream.com',
  brand: {
    icon: PipedreamIcon,
    selfFramed: true,
    colors: ['#35d38c', '#94eccc', '#6b6f72'],
    description:
      "Pipedream is an advanced integration platform designed specifically for developers. Our platform allows developers to connect APIs incredibly quickly, ensuring enhanced productivity. Since its inception, Pipedream has attracted over 300,000 developers, with a growth rate of more than 500 new developers daily. We aim to make developers 10x more productive, believing that this will create significant global impact. Pipedream offers the fastest way to build robust applications that integrate various services within your tech stack, providing code-level control when needed and a no-code option for simplicity. Join our journey if you share our vision for making developers' lives easier and more productive.",
    industries: ['Developer Tools & APIs'],
    socials: [{ type: 'linkedin', url: 'https://linkedin.com/company/pipedreamhq' }],
    source: 'Context.dev brand-intelligence API',
    asOf: '2026-07-02',
  },
  oneLiner:
    'Pipedream is a cloud integration platform, now owned by Workday (acquired Nov 2025), that connects 3,000+ APIs through low-code workflows or custom Node.js/Python/Go code, and exposes those integrations to AI agents as tools through a hosted MCP server.',
  standoutFeatures: [
    {
      title: 'Hosted MCP server covering thousands of apps',
      description:
        'Pipedream runs a fully-managed MCP server (mcp.pipedream.com) that exposes 3,000+ integrated apps and 10,000+ pre-built tools to any MCP-compatible AI agent, and handles OAuth and credential storage so credentials are never exposed to the model.',
      shortDescription: 'Managed MCP server exposes 3,000+ apps as tools with hosted OAuth.',
      source: {
        url: 'https://pipedream.com/docs/connect/mcp',
        label: 'Pipedream Docs: MCP Servers',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Code-first escape hatch alongside no-code builder',
      description:
        "Any step in a Pipedream workflow can be replaced with custom Node.js, Python, Bash, or Go code, and pre-built actions can be used as no-code building blocks or 'scaffolded' into code you customize.",
      shortDescription: 'Every workflow step can drop into custom code in four languages.',
      source: { url: 'https://pipedream.com/docs', label: 'Pipedream Docs', asOf: '2026-07-02' },
    },
    {
      title: 'Source-available component registry on GitHub',
      description:
        "Pipedream's ~11.5k-star GitHub repo publishes the source for its integration components (triggers/actions for 1,000+ apps) under a source-available (not OSI open-source) license, letting developers inspect and contribute component code, though the hosted platform itself is not self-hostable.",
      shortDescription: 'Component source is public and contributable, though not self-hostable.',
      source: {
        url: 'https://github.com/PipedreamHQ/pipedream',
        label: 'GitHub: PipedreamHQ/pipedream',
        asOf: '2026-07-02',
      },
    },
  ],
  limitations: [
    {
      title: 'Not self-hostable',
      description:
        'Pipedream is a hosted cloud platform only. The public GitHub repo is a source-available component registry, not a deployable self-hosted application, and community requests to self-host on a private server or EC2 instance have not resulted in an official self-hosting path.',
      shortDescription: 'No official path exists to self-host Pipedream.',
      source: {
        url: 'https://github.com/PipedreamHQ/pipedream/issues/954',
        label: 'GitHub Issue #954: Self-host request',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Proprietary source-available license, not open source',
      description:
        "The GitHub repository is licensed under the 'Pipedream Source Available License Version 1.0,' which explicitly prohibits using the code to run a competing SaaS/PaaS/IaaS offering. This is not an OSI-approved open-source license.",
      shortDescription: "The component repo's license bars running a competing service.",
      source: {
        url: 'https://github.com/PipedreamHQ/pipedream/blob/master/LICENSE',
        label: 'GitHub: LICENSE file',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'No dedicated built-in evaluation/guardrail tooling found',
      description:
        'Pipedream has no documented built-in AI evaluation suite, prompt-testing harness, or agent guardrail/safety-policy tooling.',
      shortDescription: 'No documented built-in eval, prompt-testing, or guardrail tooling.',
      source: {
        url: 'https://pipedream.com/docs',
        label: 'Pipedream Docs (general)',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'No native fail-and-continue branch on step errors',
      description:
        'By default an unhandled step error halts the entire workflow execution. Auto-retry (Advanced plan and above) and the global $error event stream let teams react to a failure after the fact, but neither lets the original run continue past the failing step in the same execution without hand-coded try/catch or conditional logic.',
      shortDescription: 'An unhandled step error halts the whole run by default.',
      source: {
        url: 'https://pipedream.com/docs/workflows/building-workflows/errors',
        label: 'Pipedream Docs: Handling Errors',
        asOf: '2026-07-02',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value: 'Hybrid low-code/code',
        detail:
          'Visual workflow builder with drag-and-drop steps that can each be swapped for custom code (Node.js, Python, Bash, Go); pre-built components work as no-code blocks or can be scaffolded into custom code.',
        shortValue: 'Visual builder plus custom code steps',
        confidence: 'verified',
        sources: [
          { url: 'https://pipedream.com/docs', label: 'Pipedream Docs', asOf: '2026-07-02' },
        ],
      },
      learningCurve: {
        value: 'Unknown',
        detail:
          'No primary source (docs, pricing, or trust page) publishes a learning-curve assessment.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      selfHostOption: {
        value: 'Not officially supported',
        detail:
          'Pipedream is offered only as a hosted cloud service; the public GitHub repo is a source-available component registry, not a deployable platform. A long-standing GitHub feature request to self-host remains open.',
        shortValue: 'Hosted only; no self-host path',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/PipedreamHQ/pipedream/issues/954',
            label: 'GitHub Issue #954',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/PipedreamHQ/pipedream',
            label: 'GitHub: PipedreamHQ/pipedream repo description',
            asOf: '2026-07-02',
          },
        ],
      },
      deploymentOptions: {
        value: 'Cloud-hosted only (multi-tenant SaaS, AWS us-east-1)',
        detail:
          "Pipedream infrastructure runs on AWS in the us-east-1 region; no on-prem, Docker, or Kubernetes deployment is offered for the core platform. A 'Virtual Private Clouds' feature covers network-level workflow access to private resources, not hosting the platform itself.",
        shortValue: 'Cloud-hosted SaaS on AWS us-east-1',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/privacy-and-security',
            label: 'Pipedream Docs: Privacy & Security',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pipedream.com/docs/workflows/vpc',
            label: 'Pipedream Docs: Virtual Private Clouds',
            asOf: '2026-07-02',
          },
        ],
      },
      templates: {
        value: 'Yes',
        detail:
          'Pipedream publishes a public template library at pipedream.com/templates, and any workflow can be shared/cloned via a Workflow Share Link.',
        shortValue: 'Public template library, shareable workflows',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/templates',
            label: 'Pipedream Templates',
            asOf: '2026-07-02',
          },
        ],
      },
      license: {
        value:
          'Proprietary (Pipedream Source Available License v1.0) for the GitHub component registry; hosted platform is closed-source SaaS',
        detail:
          'Not an OSI-approved open-source license. It bars using the code to run a competing SaaS/PaaS/IaaS.',
        shortValue: 'Proprietary source-available registry license',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/PipedreamHQ/pipedream/blob/master/LICENSE',
            label: 'GitHub: LICENSE file',
            asOf: '2026-07-02',
          },
        ],
      },
      environmentPromotion: {
        value:
          'Partial: GitHub Sync gives file-level promotion; no native fork/clone-project push between dev and prod',
        detail:
          "Pipedream projects have only two built-in environments (Development and Production) per project, used mainly for scoping env vars and Connect API tokens, not a promote/push pipeline. The closest equivalent is GitHub Sync (Advanced/Business plans): each project links to one GitHub repo, workflows are serialized to YAML and edited/committed via GitHub or a local clone, and pushing to the production branch triggers a deploy. This gives git-based promotion of an entire project's workflows, but it's opt-in, one repo per project, and not a dedicated staging-to-prod UI flow.",
        shortValue: 'GitHub Sync gives file-level promotion',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/projects/',
            label: 'Pipedream Docs – Projects',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pipedream.com/docs/workflows/git',
            label: 'Pipedream Docs – GitHub Sync',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pipedream.com/blog/github-sync/',
            label: 'Pipedream Blog – GitHub Sync',
            asOf: '2026-07-02',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Deploy/draft model with undo via GitHub Sync; no native diff view or per-step version history confirmed',
        detail:
          "Each workflow has a deployed (live) version and an editable draft; discarding a draft reverts to the last deployed version. Pipedream states there is no native per-step version-history or diff UI, and points users to GitHub Sync for full git-based history, review, and revert. Some third-party sources describe a newer in-editor version-history panel with preview and rollback, not confirmed in Pipedream's own documentation.",
        shortValue: 'Deploy/draft revert; full history only via GitHub Sync',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/community/t/how-to-inspect-the-version-history-for-a-given-step/8561',
            label: 'Pipedream Community – staff reply on version history',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pipedream.com/community/t/how-can-i-discard-a-draft-edit-to-a-workflow-without-having-to-revert-to-the-deployed-version/10640',
            label: 'Pipedream Community – discard draft edit',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pipedream.com/docs/workflows/git',
            label: 'Pipedream Docs – GitHub Sync',
            asOf: '2026-07-02',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          "No: Pipedream's collaboration model is workspace/project sharing, with team members able to view and edit the same workflows and connected accounts, but not live concurrent multi-user editing with visible cursors, selections, or synced real-time operations on the same workflow canvas.",
        detail:
          'Collaboration features (workflow sharing, team workspaces) are gated to paid plans and described as asynchronous project/account sharing, not simultaneous live editing.',
        shortValue: 'No, sharing only, not live co-editing',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/docs/projects/access-controls',
            label: 'Project Access Controls docs',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeFileStorage: {
        value:
          "No: Pipedream's native file feature (File Stores) is a project-scoped cloud filesystem with list/upload/download/delete operations and no documented size limit, but no folders, link-based sharing with auth options (password/SSO), or deleted-item recovery. Link-based sharing requires a separate connected app like Google Drive or Dropbox.",
        detail:
          'File Stores are per-project cloud storage for workflow use, not a full file-management product with folders, shareable links, or a trash/recovery flow.',
        shortValue: 'No, only a flat project file store',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/data-management/file-stores',
            label: 'File Stores docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pipedream.com/blog/filestores/',
            label: 'File Stores blog announcement',
            asOf: '2026-07-02',
          },
        ],
      },
      dataTables: {
        value:
          "No: Pipedream's native data feature is Data Stores, a key-value store (with a dashboard grid view for records) for lightweight state and caching, not a spreadsheet-like table with defined rows/columns and spreadsheet keyboard navigation (arrow keys, multi-cell copy-paste). Spreadsheet-like functionality requires integrating an external app like Google Sheets or Excel.",
        detail:
          'Data Stores can be viewed/edited in a dashboard, but Pipedream documentation frames them as key-value storage, not a spreadsheet grid product.',
        shortValue: 'No, only a key-value Data Store',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/docs/data-stores',
            label: 'Data Stores docs',
            asOf: '2026-07-02',
          },
        ],
      },
      richTextEditor: {
        value:
          'No: Pipedream provides text-format conversion actions (HTML-to-Markdown and Markdown-to-HTML) as workflow steps, but has no native inline WYSIWYG rich-text editor for authoring or storing documents within the platform itself.',
        detail:
          'The only markdown-related features are conversion utilities for use inside workflow steps, not a document-editing surface.',
        shortValue: 'No, only text-conversion actions found',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/apps/helper-functions/actions/html-to-markdown',
            label: 'HTML to Markdown action',
            asOf: '2026-07-02',
          },
        ],
      },
      subWorkflows: {
        value:
          'No: Pipedream\'s mechanism for connecting workflows is $.send.emit(), which is asynchronous ("Destination delivery is asynchronous: emits are sent after your workflow finishes"). This triggers a separate listener workflow after the emitting workflow completes; it is not a step that calls a saved workflow synchronously, waits for it, and receives its return value.',
        detail:
          'Pipedream has no "call workflow" or "execute sub-workflow" step. Community help threads confirm the emit-and-listen pattern is the standard workaround for chaining workflows, not true parent-waits-for-child composition.',
        shortValue: 'No, only async emit-to-listener chaining',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/docs/destinations/emit',
            label: 'Pipedream Docs: Destinations (emit)',
            asOf: '2026-07-03',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'Yes, via app-specific LLM actions (OpenAI confirmed; other providers available as separate app integrations)',
        detail:
          "Pipedream's OpenAI app provides pre-built LLM actions for workflows, and workflows can run parallel/non-dependent LLM queries. Other model providers are addable as their own apps in the 3,000+ integration catalog, though no single page enumerates every LLM provider supported as a first-class block.",
        shortValue: 'OpenAI confirmed; other LLMs via app integrations',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/apps',
            label: 'Pipedream Apps directory (OpenAI app + others)',
            asOf: '2026-07-02',
          },
        ],
      },
      agentReasoningBlocks: {
        value: 'Yes: dedicated AI Agent Builder',
        detail:
          "Pipedream markets an 'AI Agent Builder' to prompt, run, edit, and deploy AI agents, distinct from plain data-routing workflow steps.",
        shortValue: 'Dedicated AI Agent Builder feature',
        confidence: 'estimated',
        sources: [
          { url: 'https://pipedream.com/', label: 'Pipedream homepage', asOf: '2026-07-02' },
        ],
      },
      naturalLanguageBuilding: {
        value: "Yes: 'Edit with AI'",
        detail:
          "An 'Edit with AI' button in the workflow header or any code step lets users modify workflows using natural-language instructions.",
        shortValue: "'Edit with AI' modifies workflows via prompt",
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/blog/build-workflows-faster-with-ai/',
            label: 'Pipedream Blog: Build workflows faster with AI',
            asOf: '2026-07-04',
          },
        ],
      },
      knowledgeBaseRag: {
        value: 'No dedicated customer-facing KB/RAG product feature',
        detail:
          'Pipedream built an internal Postgres+pgvector RAG system to power its own documentation search/chat assistant, but it is not offered as a customer-usable knowledge-base/vector-store feature inside workflows.',
        shortValue: 'No customer-facing KB/RAG feature',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/blog/build-your-own-chat-bot-with-openai-and-pipedream/',
            label: 'Pipedream Blog: Build your own chat bot with OpenAI and Pipedream',
            asOf: '2026-07-04',
          },
        ],
      },
      mcpSupport: {
        value: 'Yes: first-class, hosted MCP server',
        detail:
          'Pipedream runs a hosted MCP server (mcp.pipedream.com) exposing 3,000+ apps / 10,000+ tools to any MCP client, with managed OAuth and credential isolation; also ships an official MCP server package in its GitHub repo.',
        shortValue: 'Hosted MCP server, 3,000+ apps as tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/connect/mcp',
            label: 'Pipedream Docs: MCP Servers',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/PipedreamHQ/pipedream/blob/master/modelcontextprotocol/README.md',
            label: 'GitHub: Modelcontextprotocol README',
            asOf: '2026-07-02',
          },
        ],
      },
      evaluationGuardrails: {
        value: 'Unknown',
        detail: 'No built-in evals, guardrails, or agent-safety policy tooling documented.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      humanInTheLoop: {
        value: 'Yes: native `$.flow.suspend()` pause/resume/cancel primitive',
        detail:
          'Pipedream has a dedicated code primitive, `$.flow.suspend()`, distinct from a plain delay (`$.flow.delay`). Calling it pauses the workflow and generates a resume link and a cancel link for that execution, which the workflow author sends to a human approver through any channel (email, Slack, etc.) as a workflow step. Opening the resume link continues the run; opening the cancel link stops it. A suspended run auto-cancels after 24 hours by default if nobody acts, and that timeout is configurable.',
        shortValue: 'Native suspend/resume/cancel with approval URLs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/code/nodejs/rerun',
            label: 'Pipedream Docs – Pause, Resume, and Rerun a Workflow',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pipedream.com/community/t/how-to-program-a-manual-approval-step-into-a-workflow/10513',
            label: 'Pipedream Community – manual approval step',
            asOf: '2026-07-02',
          },
        ],
      },
      generativeMedia: {
        value:
          'Image and video generation via third-party provider actions (e.g. Google Vertex AI Veo); no confirmed native standalone audio/TTS-STT block',
        detail:
          "Pipedream's marketplace includes pre-built actions for AI media generation, notably 'Generate Video from Image' and 'Generate Video from Text' via Google Vertex AI (Veo models), with audio generation bundled into that same action rather than offered as its own text-to-speech/speech-to-text block. These are pre-built component actions, not a dedicated first-party media-generation product. Image, video, and audio generation are otherwise reached through broader app integrations (OpenAI, Google, ElevenLabs, etc.), with no standalone speech action separate from those third-party connectors.",
        shortValue: 'Image/video via provider actions; no native TTS/STT',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/integrations/generate-video-from-image-with-google-vertex-ai-api-on-updated-credential-from-accredible-api-int_QmsA2m5p',
            label: 'Pipedream – Generate Video from Image (Vertex AI)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pipedream.com/apps/survser/integrations/google-vertex-ai/generate-video-from-text-with-google-vertex-ai-api-on-new-survey-response-from-survser-api-int_g2s54oeP',
            label: 'Pipedream – Generate Video from Text (Vertex AI)',
            asOf: '2026-07-02',
          },
        ],
      },
      dynamicToolUse: {
        value: 'Unknown',
        detail: 'Not publicly documented for Pipedream.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      modelFallback: {
        value: 'Unknown',
        detail: 'Not publicly documented for Pipedream.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      agentSkills: {
        value:
          'Unknown: Pipedream has no documented feature for defining named, reusable prompt or knowledge snippets that can be invoked by reference across multiple agents. Its reuse model is centered on code component reuse (shared prop definitions and methods across workflow steps), not named prompt/skill libraries for AI agents.',
        detail:
          'Pipedream documents reusable code components and props across workflow steps, but nothing for reusable prompt/knowledge snippets specific to agents.',
        shortValue: 'Unknown, no named prompt-skill library found',
        confidence: 'unknown',
        sources: [],
      },
      nativeChatDeployment: {
        value:
          'Unknown: Pipedream has an AI Agent Builder that lets users prompt, run, edit, and deploy agents, and offers an open-source reference chat app (MCP Chat) built on its MCP server, but does not document a native, one-click publicly deployable chat surface hosted by Pipedream itself for a built agent, distinct from API/webhook/form deployment.',
        detail:
          'MCP Chat is a separate open-source reference app developers self-host, not a built-in hosted chat deployment target inside the Pipedream product.',
        shortValue: 'Unknown, unclear if chat is natively hosted',
        confidence: 'unknown',
        sources: [],
      },
      kbChunkVisibility: {
        value:
          "Unknown: Pipedream has no customer-facing knowledge-base product with chunk-level search debugging views. The only documented RAG/embeddings work is Pipedream's own internal support-bot implementation (built on Postgres hybrid search), not a shipped end-user knowledge base feature with a chunk-inspection UI.",
        detail:
          'Pipedream does not offer a customer-facing knowledge-base/RAG product with a chunk-level inspection UI; not applicable in the same shape as a KB-centric AI workspace.',
        shortValue: 'Unknown, no customer-facing KB feature found',
        confidence: 'unknown',
        sources: [],
      },
      parallelExecution: {
        value: "Yes: native 'Parallel' control-flow step",
        detail:
          "Pipedream's Parallel operator lets a workflow branch into multiple paths that execute concurrently rather than sequentially, with optional per-branch conditions, then merges back into the parent flow using each branch's last-step exports. Documentation notes workflow queue concurrency/rate settings may not behave as expected when this operator is used.",
        shortValue: "Native 'Parallel' step runs branches concurrently, then merges",
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/control-flow/parallel',
            label: 'Pipedream Docs: Parallel control flow',
            asOf: '2026-07-02',
          },
        ],
      },
      a2aProtocol: {
        value: 'No documented support found',
        detail:
          'Pipedream does not support the Agent2Agent (A2A) protocol or an Agent Card in any documentation, changelog, or blog post. It documents MCP (agent-to-tool) support via its Connect MCP server, a distinct protocol from A2A (agent-to-agent).',
        shortValue: 'No A2A support documented; only MCP tool-calling found',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/docs/connect/mcp',
            label: 'Pipedream Docs: MCP Servers',
            asOf: '2026-07-02',
          },
        ],
      },
      loopIteration: {
        value:
          'No: Pipedream\'s control flow docs list If/Else, Delay, Filter, and End Workflow as available operators, and the control flow overview page states "more operators (including parallel and looping) are coming soon" even after the Parallel operator itself shipped. A dedicated sequential Loop/Repeat/For Each container is not released.',
        detail:
          'No page exists for a Loop or Repeat control-flow operator, and long-running community threads confirm the standard workaround is iterating over an array inside a Node.js or Python code step rather than using a native loop block.',
        shortValue: 'No native loop block; only code-step iteration workaround',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/control-flow',
            label: 'Pipedream Docs: Control Flow overview',
            asOf: '2026-07-03',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value: '3,000+ integrated apps; 10,000+ pre-built tools',
        detail:
          "Homepage states: '3,000+ integrated apps. Use managed authentication across 3,000+ apps and build agents to solve any use case' and 'Access 10k tools. Embed pre-built tools (triggers and actions) directly in your application or AI agent.'",
        shortValue: '3,000+ apps, 10,000+ pre-built tools',
        confidence: 'verified',
        sources: [
          { url: 'https://pipedream.com/', label: 'Pipedream homepage', asOf: '2026-07-02' },
        ],
      },
      triggerTypes: {
        value:
          'Webhook/HTTP, schedule (cron), app-event sources, and REST-API-driven workflow instantiation',
        detail:
          "Workflow editor supports building hosted HTTP REST endpoints or scheduled cron tasks; 'source' triggers fire on app events (e.g., new Slack message); workflows can also be created/run programmatically via the REST API. There is no standalone 'chat trigger' block, though Connect-based agent tool invocation effectively serves that role.",
        shortValue: 'Webhook, cron, app events, REST API',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/rest-api/',
            label: 'Pipedream Docs: REST API',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pipedream.com/docs/sources',
            label: 'Pipedream Docs: Triggers (event sources)',
            asOf: '2026-07-04',
          },
        ],
      },
      customCodeSteps: {
        value: 'Yes: Node.js, Python, Bash, Go',
        detail: 'Any workflow step can be a custom code step in Node.js, Python, Bash, or Go.',
        shortValue: 'Node.js, Python, Bash, or Go steps',
        confidence: 'verified',
        sources: [
          { url: 'https://pipedream.com/docs', label: 'Pipedream Docs', asOf: '2026-07-02' },
        ],
      },
      apiPublishing: {
        value: 'Yes: workflows can be hosted as HTTP/REST endpoints',
        detail:
          "The workflow builder can create a free HTTP endpoint you can send requests to, running any Node.js code or pre-built actions per request; workflows can also be created and deployed programmatically via Pipedream's own REST API ('Instantiate via API').",
        shortValue: 'Workflows hosted as REST endpoints',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/blog/creating-workflows-programmatically/',
            label: 'Pipedream Blog: Creating Workflows with the REST API',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pipedream.com/docs/rest-api/examples/workflows',
            label: 'Pipedream Docs: REST API Example - Create a Workflow',
            asOf: '2026-07-04',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Yes: official TypeScript SDK (@pipedream/sdk) and Python SDK (pipedream on PyPI), plus @pipedream/connect-react for embeddable connect UI',
        detail:
          "Pipedream ships an official TypeScript SDK, @pipedream/sdk (v3.1.1), and an official Python SDK, published as `pipedream` on PyPI (v2.1.8), both for programmatic access to the Pipedream/Connect APIs, alongside a companion @pipedream/connect-react package for embeddable React auth/connect UI. Beyond the SDKs, Pipedream provides a full component development kit: triggers and actions ('components') are plain Node.js modules that run on Pipedream's serverless infrastructure and can use most npm packages with no install step. Components are open-sourced in the public PipedreamHQ/pipedream GitHub monorepo, and community members can build and publish their own actions/sources that appear in Pipedream's UI/marketplace alongside first-party ones, functioning as a de facto community integration marketplace.",
        shortValue: 'TypeScript + Python SDKs, plus components SDK',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.npmjs.com/package/@pipedream/sdk',
            label: 'npm – @pipedream/sdk',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pipedream.com/docs/components/guidelines',
            label: 'Pipedream Docs – Components Guidelines & Patterns',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pipedream.com/docs/workflows/contributing/components/',
            label: 'Pipedream Docs – Contributing Components',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/PipedreamHQ/pipedream',
            label: 'GitHub – PipedreamHQ/pipedream monorepo',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pypi.org/project/pipedream/',
            label: 'PyPI package page',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpPublishing: {
        value:
          "No: Pipedream's MCP support runs primarily in the consumption direction. Pipedream hosts MCP servers that expose its catalog of 3,000+ app integrations and prebuilt actions as callable tools for AI clients (Claude, ChatGPT, etc.) to consume, and lets developers self-host that same server. There is no documented mechanism for taking an arbitrary deployed Pipedream workflow and publishing it as its own callable MCP server endpoint for external AI tools.",
        detail:
          "Pipedream is an MCP server provider for its own app/action catalog and an MCP client consumer; no docs describe publishing a user's custom workflow as a standalone MCP server.",
        shortValue: 'No, MCP is consumption-direction only',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/docs/connect/mcp',
            label: 'MCP Servers docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://mcp.pipedream.com/',
            label: 'Pipedream MCP server',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Credit-based compute pricing (per-execution-time credits) plus separate Connect usage/end-user pricing',
        detail:
          '1 credit = 30 seconds of workflow compute at 256MB memory; credit burn rate scales with memory allocation. Connect (embedding Pipedream in your own app) bills separately on API usage (actions/tool calls/trigger emits) and number of connected end users.',
        shortValue: 'Credit-based compute; separate Connect usage pricing',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/pricing',
            label: 'Pipedream Docs: Plans and Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      entryPaidPlan: {
        value:
          'Not publicly listed; third-party estimates range roughly $29–$45/mo for the entry paid tier',
        detail:
          "Pipedream's own pricing page is JavaScript-rendered and not directly verifiable via static fetch. Third-party sources report conflicting numbers for the entry paid tier, roughly $29/mo to $45/mo for around 2,000 credits/month, but the exact current price is unconfirmed from a primary source.",
        shortValue: '~$29–$45/mo (unconfirmed)',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/pricing',
            label:
              'Pipedream Pricing page (official, JS-rendered, not independently verifiable via fetch)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://automationatlas.io/answers/pipedream-pricing-explained-2026/',
            label: 'Automation Atlas: Pipedream Pricing Explained 2026 (third-party)',
            asOf: '2026-07-02',
          },
        ],
      },
      freeTier: {
        value: 'Yes: free workspace with a daily credit limit',
        detail:
          'Free workspaces get a daily limit of free credits (cannot be exceeded/rolled over), a capped number of active workflows and connected accounts, community-only support, and Connect development-environment access only. Developing/testing a workflow with test events in the builder is always free, and public-registry event source triggers are free.',
        shortValue: 'Free tier with daily credit cap',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/pricing',
            label: 'Pipedream Docs: Plans and Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      byok: {
        value: 'Unknown',
        detail:
          "Pipedream has no documented formal 'bring your own LLM API key' program; users add their own OpenAI/other provider connected accounts, which functions similarly to BYOK for the LLM app integrations.",
        shortValue: 'Not formally documented as BYOK',
        confidence: 'unknown',
        sources: [],
      },
    },
    security: {
      soc2: {
        value: 'Yes: SOC 2 Type II',
        detail:
          'Pipedream provides a SOC 2 Type 2 report on request, undergoes annual third-party audits, and uses continuous-compliance monitoring tooling. It also supports HIPAA, acting as a Business Associate and offering BAAs.',
        shortValue: 'SOC 2 Type II, HIPAA BAA available',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/privacy-and-security',
            label: 'Pipedream Docs: Privacy and Security',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pipedream.com/docs/privacy-and-security/hipaa',
            label: 'Pipedream Docs: HIPAA Compliance',
            asOf: '2026-07-02',
          },
        ],
      },
      dataResidency: {
        value: 'Single-region (AWS us-east-1); no customer-selectable data residency documented',
        detail:
          "Pipedream's infrastructure and customer data are hosted on AWS in the us-east-1 region within AWS-controlled data centers, with no alternate regions or customer-chosen data residency.",
        shortValue: 'Single AWS us-east-1 region only',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/privacy-and-security',
            label: 'Pipedream Docs: Privacy and Security',
            asOf: '2026-07-02',
          },
        ],
      },
      rbac: {
        value: 'Workspace-level access controls exist; granular per-plan RBAC not fully documented',
        detail:
          'OAuth clients and workspace administration are scoped to workspace admins, and internal staff access follows least-privilege principles, but no page enumerates a customer-facing RBAC feature (custom roles/permissions) or which plans include it.',
        shortValue: 'Workspace-level controls; granular RBAC unclear',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/docs/privacy-and-security',
            label: 'Pipedream Docs: Privacy and Security',
            asOf: '2026-07-02',
          },
        ],
      },
      auditLogging: {
        value:
          'Internal infra monitoring confirmed; customer-facing audit log feature/plan-gating not documented',
        detail:
          'Pipedream documents using CloudTrail, CloudWatch, Datadog and custom alerts for its own infrastructure monitoring, but no page confirms a customer-accessible workspace audit log feature or specifies which plans include it.',
        shortValue: 'Internal monitoring only; no customer audit log',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/docs/privacy-and-security',
            label: 'Pipedream Docs: Privacy and Security',
            asOf: '2026-07-02',
          },
        ],
      },
      additionalCompliance: {
        value:
          'SOC 2 Type 2, HIPAA (via BAA, Enterprise), GDPR (SCCs), and AWS KMS infra with ISO 27001/27017/27018. No independent Pipedream-held ISO 27001/PCI/FedRAMP certification on the trust page',
        detail:
          "Pipedream's Privacy and Security page states it provides a SOC 2 Type 2 report on request, signs Business Associate Addendums (BAAs) for HIPAA/PHI use cases (Enterprise), and uses Standard Contractual Clauses (SCCs) for GDPR-related data transfers. Sensitive data (OAuth grants, key-based credentials, env vars) is encrypted at rest with AES-256-GCM via AWS KMS, which itself holds SOC 1/2/3 and ISO 27001/27017/27018 certifications. That ISO/PCI/FedRAMP coverage is inherited from the AWS infrastructure layer, not a certification Pipedream independently holds on its own trust page. Some third-party review sites describe Pipedream itself as directly PCI, FedRAMP, and CSA STAR compliant, but Pipedream's own security documentation does not corroborate this.",
        shortValue: 'SOC 2, HIPAA BAA, GDPR SCCs; ISO via AWS only',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/docs/privacy-and-security',
            label: 'Pipedream Docs – Privacy and Security',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pipedream.com/blog/hippa/',
            label: 'Pipedream Blog – Pipedream supports HIPAA compliance',
            asOf: '2026-07-02',
          },
        ],
      },
      modelAndToolGovernance: {
        value: 'Unknown',
        detail: 'Not publicly documented for Pipedream.',
        shortValue: 'Not publicly documented',
        confidence: 'unknown',
        sources: [],
      },
      credentialGovernance: {
        value:
          "No: Pipedream's governance model restricts access to a connected account as a whole (private by default, ownership-based, with Business-plan project-level access restriction), rather than letting an admin restrict which specific credentials a given role or permission group may use within shared projects.",
        detail:
          'Connected accounts are private to the connecting user by default and can be granted or restricted per project on Business plans, coarser than per-role governance of specific stored credentials.',
        shortValue: 'No, only account-level ownership restriction',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/docs/apps/connected-accounts',
            label: 'Connected Accounts docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pipedream.com/docs/projects/access-controls',
            label: 'Project Access Controls docs',
            asOf: '2026-07-02',
          },
        ],
      },
      whiteLabeling: {
        value:
          'No: Pipedream supports custom domains for HTTP endpoint URLs, but its documentation and community support state the authentication/consent experience is not white-label. Users always see Pipedream branding and are asked to consent to Pipedream processing their data during connect flows, so vendor branding cannot be fully replaced across the workspace or deployed-app UI.',
        detail:
          'Custom domains only rebrand webhook endpoint URLs (e.g. api.example.com instead of *.m.pipedream.net); the OAuth/consent UI and general product UI keep Pipedream branding.',
        shortValue: 'No, endpoint domains only, auth stays branded',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/domains',
            label: 'Custom Domains docs',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pipedream.com/community/t/what-3rd-party-tool-can-i-use-to-white-label-my-endpoints-from-http-pipedream-com-pipedream-com-to-my-domain/7842',
            label: 'Community: white-labeling endpoints limitation',
            asOf: '2026-07-02',
          },
        ],
      },
      dataRetention: {
        value:
          'Yes: Pipedream documents account-level retention rules for event/execution data, and states Enterprise customers can turn off all data retention, while internal application logs are deleted within about 30 days by default.',
        detail:
          'Documentation is thin on exact self-serve controls for standard workspaces; the clearest statement of org-configurable retention is tied to the Enterprise plan.',
        shortValue: 'Yes, retention configurable on Enterprise',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/docs/privacy-and-security',
            label: 'Privacy and Security at Pipedream',
            asOf: '2026-07-02',
          },
        ],
      },
      piiRedaction: {
        value:
          'Unknown: Pipedream has no documented built-in feature that detects and redacts or blocks PII (emails, SSNs, etc.) in workflow content or retained execution logs. Its security materials focus on encryption, SOC 2 compliance, and log-deletion timelines, not content-level PII scanning.',
        shortValue: 'Unknown, no PII redaction feature found',
        confidence: 'unknown',
        sources: [],
      },
      sso: {
        value:
          'Yes: Pipedream supports Single Sign-On via SAML 2.0 with any compatible identity provider (including Okta and Google Workspace) on the Business plan.',
        detail:
          'Documentation confirms SAML 2.0 SSO and requires a Business-plan workspace, but does not mention OIDC as a supported protocol or call out any separate Enterprise-tier requirement.',
        shortValue: 'Yes, SAML SSO on Business plan',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workspaces/sso',
            label: 'Single Sign On Overview',
            asOf: '2026-07-02',
          },
        ],
      },
      thirdPartyVetting: {
        value:
          "No: Pipedream's 3,000+ app integrations are backed by a public component registry (pipedreamhq/pipedream on GitHub) where any developer can fork the repo, write a trigger or action, and submit it as a pull request for anyone else's workflows to run; users can also write and execute their own arbitrary custom code steps.",
        detail:
          "Pipedream's own contributing docs describe the merge path as: submit a PR, the code runs through automated checks (linting, dependency install, and other CI a contributor can also run locally via pnpm), the Pipedream team reviews it against published Component Guidelines & Patterns, and once approved the PR is merged to master and the component becomes runnable by every Pipedream user. That review step is functional/style-focused (code structure, error handling, README quality), not a documented formal security audit, static-analysis security scan, or sandboxed vulnerability assessment distinct from ordinary code review. This is the inverse of Sim's model: Sim has no public marketplace where an arbitrary third party can publish and have other users install executable tool code, whereas Pipedream's whole integration catalog is built on exactly that open, PR-based contribution model. No security incident specific to a malicious or compromised Pipedream component is publicly documented.",
        shortValue: 'No, open PR-based community component registry',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/docs/components/guidelines',
            label: 'Pipedream Docs: Components Guidelines & Patterns',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pipedream.com/docs/apps/contributing',
            label: 'Pipedream Docs: Contributing to the Pipedream Registry',
            asOf: '2026-07-04',
          },
          {
            url: 'https://pipedream.com/community',
            label: 'Pipedream Community',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Customer-facing per-execution step logs and event history; no dedicated metrics dashboard (latency percentiles/error-rate charts) confirmed',
        detail:
          "Pipedream's Event History dashboard is customer-facing and shows, per event, the steps executed, each step's configuration/inputs/outputs, stack traces on error, and overall workflow performance for that run; events are filterable by workflow, execution status (success/error/paused), and time range. Each execution carries a `trace_id`, stable across auto-retries of the same original event, enabling correlation across retries. This is real per-execution tracing depth, but no aggregate metrics dashboard (e.g., p50/p95 latency, error-rate over time, throughput charts) exists. Observability is oriented around inspecting individual runs rather than fleet-level metrics visualization.",
        shortValue: 'Per-run step logs; no metrics dashboard',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/event-history',
            label: 'Pipedream Docs – Event History',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pipedream.com/docs/workflows/events/inspect/',
            label: 'Pipedream Docs – Inspect Events',
            asOf: '2026-07-02',
          },
        ],
      },
      durabilityModel: {
        value: 'Yes, but auto-retry on errors is gated to the Advanced plan and above',
        detail:
          'Pipedream supports an auto-retry-on-errors setting per workflow, available on the Advanced plan and above: on failure, the failed step is retried up to 8 times over a 10-hour span with exponential backoff (does not retry on out-of-memory or timeout errors). Independently, Event History lets you replay one or many past events, including bulk replay of failed events, which re-executes the workflow from the original incoming event data rather than resuming mid-run from the exact failed step. True checkpoint/resume exists only for explicit pause points via `$.flow.suspend()`/resume.',
        shortValue: 'Auto-retry (Advanced plan+); replay from event history',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/event-history',
            label: 'Pipedream Docs – Event History',
            asOf: '2026-07-02',
          },
          {
            url: 'https://changelog.pipedream.com/en/bulk-replay-and-delete-in-event-history',
            label: 'Pipedream Changelog – Bulk replay and delete failed events',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/settings',
            label: 'Pipedream Docs',
            asOf: '2026-07-02',
          },
        ],
      },
      failureAlerting: {
        value:
          'Yes: proactive default email (and optional Slack/custom) notification on unhandled workflow errors',
        detail:
          "By default, Pipedream workflows email the owner the first time a given workflow raises an unhandled error within a rolling 24-hour window (subsequent identical errors in that window are suppressed; if the error persists past 24 hours, another notification is sent). This 'Notify me on errors' behavior can be toggled off per workflow, and workflows with auto-retry enabled have an optional 'Send notification on first error' setting, off by default. Beyond the built-in email, users can wire additional proactive channels (Slack messages, custom HTTP calls to PagerDuty/etc.) as ordinary workflow steps/destinations. This is opt-in custom logic, not a first-party alerting/threshold product for cost or latency SLAs.",
        shortValue: 'Default error email; optional Slack/webhook',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/settings',
            label: 'Pipedream Docs – Workflow Settings',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pipedream.com/community/t/how-to-configure-settings-to-receive-workflow-error-notifications-only-via-slack/11054',
            label: 'Pipedream Community – error notification settings',
            asOf: '2026-07-02',
          },
        ],
      },
      dataDrains: {
        value:
          'Unknown: Pipedream has no documented native, continuous export of its own execution logs, audit logs, or usage data to an external destination such as S3, BigQuery, or Datadog. Users could build a Pipedream workflow themselves to forward event data somewhere, but that is not the same as a built-in platform data-drain feature.',
        detail:
          "Pipedream is itself an integration/automation platform, so 'building a workflow to export your own execution data' is a workaround, not a documented native drain feature.",
        shortValue: 'Unknown, no native log-export feature found',
        confidence: 'unknown',
        sources: [],
      },
      asyncExecution: {
        value:
          "Yes: Pipedream's default HTTP-trigger behavior is asynchronous. A workflow returns an immediate 200 OK response to the caller while the rest of the workflow keeps running in the background, and developers can inspect the resulting event/execution afterward in the workflow's event history. A fully synchronous mode is also available via the `$.respond()` function, which can be called at the end of the workflow (blocking until completion) or mid-workflow with `immediate: true` to send a response early and continue processing after.",
        detail:
          "Pipedream docs describe the default as an immediate 200 OK while processing continues in background; $.respond() gives synchronous or hybrid (immediate + continue) response patterns. No explicit API-based 'trigger now, poll status later' endpoint is documented, though the event inspector/history UI shows past execution results.",
        shortValue: 'Yes, default is async with optional sync $.respond()',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/triggers',
            label: 'Pipedream Docs: HTTP-triggered workflows (default async response, $.respond)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pipedream.com/docs/workflows/events/inspect/',
            label: 'Pipedream Docs: Inspect Events (viewing past execution results)',
            asOf: '2026-07-02',
          },
        ],
      },
      executionLimits: {
        value:
          'Yes: Pipedream publishes hard execution limits. A single workflow execution times out at 300 seconds (5 minutes) by default on the free tier and can be raised to a maximum of 750 seconds (12.5 minutes) on paid plans; memory defaults to 256MB and can be raised up to 10GB. HTTP-triggered workflows are rate-limited to an average of 10 requests per second, with 429 Too Many Requests returned beyond that, and free workspaces additionally cap total test/dev runtime at 30 minutes per day.',
        detail:
          'Additional published caps: HTTP request body 512KB, email payload including attachments 30MB, combined function logs/exports 6MB, /tmp scratch disk 2GB (fixed), event retention 7 days (free) with execution details expiring after 365 days.',
        shortValue: '5-12.5 min timeout, 10 req/s HTTP cap',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/limits',
            label: 'Pipedream Docs: Limits',
            asOf: '2026-07-02',
          },
        ],
      },
      partialFailureHandling: {
        value:
          "No: Pipedream does not have a built-in error-handling branch that automatically routes a failed step so the rest of the same run continues; by default an unhandled step error halts that workflow execution. Workarounds exist (enabling auto-retry, which re-runs from the failed step up to 8 times over 10 hours with exponential backoff on paid plans; wrapping code in try/catch; using If/Else conditional logic; or subscribing a separate workflow to Pipedream's global $error event stream), but these are manual patterns, not a native 'continue past this failed step in the same run' feature. Community feature requests ask for a 'continue on failure' / skip-step option, which is not shipped.",
        detail:
          'Auto-retry and the global error-event stream let you react to failures, but the original run itself still halts at the failing step unless you hand-code try/catch or conditional logic around it.',
        shortValue: 'No native fail-and-continue branch',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/errors',
            label: 'Pipedream Docs: Handling Errors',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pipedream.com/community/t/option-to-configure-error-handling/2833',
            label: 'Pipedream Community: feature request for configurable error handling',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pipedream.com/community/t/how-to-continue-steps-in-workflow-if-one-step-fails/7604',
            label: 'Pipedream Community: how to continue steps if one step fails',
            asOf: '2026-07-02',
          },
        ],
      },
      unattendedExecution: {
        value:
          "Yes: scheduled (cron), webhook, and app-event triggered workflows run as deployed jobs on Pipedream's own serverless infrastructure, not in a session tied to a client device",
        detail:
          'Pipedream\'s own docs state it plainly: "Once you save a workflow, we deploy it to our servers. Each event triggers the workflow code, whether you have the workflow open in your browser, or not." No desktop app, browser tab, or active session needs to stay open for a scheduled or triggered run to fire or complete.',
        shortValue: 'Runs server-side; no dependency on a client device staying open',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows',
            label: 'Pipedream Docs: What Are Workflows?',
            asOf: '2026-07-04',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Community forum/Slack (free/lower tiers), email support and dedicated Slack channel (higher tiers), dedicated support on Business/Enterprise',
        detail:
          'Free tier gets community support (forum + public Slack) only; paid tiers add email support and a dedicated Slack channel; Business/Enterprise adds dedicated support resources.',
        shortValue: 'Community free tier; email/Slack on paid',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/support',
            label: 'Pipedream Support page',
            asOf: '2026-07-02',
          },
          {
            url: 'https://pipedream.com/docs/pricing',
            label: 'Pipedream Docs: Plans and Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      sla: {
        value:
          'Enterprise plan reportedly includes a dedicated Success Engineer and uptime guarantee; no published response-time SLA',
        detail:
          'No Pipedream page publishes a specific support response-time SLA for any tier; enterprise-level uptime/support arrangements appear to be negotiated directly with sales rather than published.',
        shortValue: 'No published response-time SLA',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/pricing',
            label: 'Pipedream Pricing page',
            asOf: '2026-07-02',
          },
        ],
      },
      community: {
        value: '~11.5k GitHub stars on the main component-registry repo',
        detail:
          'The PipedreamHQ/pipedream GitHub repository has approximately 11.5k stars. Pipedream also references a large developer user base and a public community Slack/forum, but no official page states exact Slack/Discord member counts.',
        shortValue: '~11.5k GitHub stars on component registry',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/PipedreamHQ/pipedream',
            label: 'GitHub: PipedreamHQ/pipedream',
            asOf: '2026-07-02',
          },
        ],
      },
      companyMaturity: {
        value:
          'Founded 2019, San Francisco; ~11-50 employees pre-acquisition; raised ~$22M across 2 rounds; being acquired by Workday (definitive agreement signed Nov 19, 2025)',
        detail:
          "Per Crunchbase, Pipedream was founded in 2019 and headquartered in San Francisco, CA, with founders including Tod Sacerdoti (CEO), Dylan Sather, TJ Koblentz, and Pravin Savkar; it raised a total of ~$22M across 2 funding rounds (investors include Felicis and CRV) and had a headcount signal of 11-50 employees. Workday signed a definitive agreement to acquire Pipedream on November 19, 2025, with the transaction originally expected to close in Workday's Q4 FY2026 (by end of January 2026), subject to closing conditions; Pipedream is being positioned as Workday's integration layer for AI agent workflows across Workday and third-party apps. Neither company's own site had published a closing announcement as of this fact's last check, so whether the deal has formally closed needs reverification against Workday's or Pipedream's newsroom before publishing further updates.",
        shortValue: 'Founded 2019; being acquired by Workday (deal signed Nov 2025)',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://newsroom.workday.com/2025-11-19-Workday-Signs-Definitive-Agreement-to-Acquire-Pipedream',
            label: 'Workday Newsroom – Workday Signs Definitive Agreement to Acquire Pipedream',
            asOf: '2026-07-06',
          },
          {
            url: 'https://pipedream.com/blog/pipedream-to-be-acquired-by-workday/',
            label: 'Pipedream Blog – Pipedream to be acquired by Workday',
            asOf: '2026-07-06',
          },
          {
            url: 'https://www.crunchbase.com/organization/pipedream',
            label: 'Crunchbase – Pipedream company profile',
            asOf: '2026-07-02',
          },
        ],
      },
      academy: {
        value:
          'Yes: Pipedream operates Pipedream University, a structured library of courses and video lessons that teaches workflow building, custom code steps, and platform concepts beyond ad hoc docs and blog posts.',
        detail:
          'No formal certification/exam program; it reads as structured video courses rather than a certification track.',
        shortValue: 'Yes, via Pipedream University courses',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/university',
            label: 'Pipedream University',
            asOf: '2026-07-02',
          },
        ],
      },
    },
  },
}
