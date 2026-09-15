import { PipedreamIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Reviewed against live primary sources on 2026-09-13; unverified capabilities are labeled. */
export const pipedreamProfile: CompetitorProfile = {
  id: 'pipedream',
  name: 'Pipedream',
  website: 'https://pipedream.com',
  brand: {
    selfFramed: true,
    colors: ['#35d38c', '#94eccc', '#6b6f72'],
    description:
      "Pipedream is an advanced integration platform designed specifically for developers. Our platform allows developers to connect APIs incredibly quickly, ensuring enhanced productivity. Since its inception, Pipedream has attracted over 300,000 developers, with a growth rate of more than 500 new developers daily. We aim to make developers 10x more productive, believing that this will create significant global impact. Pipedream offers the fastest way to build robust applications that integrate various services within your tech stack, providing code-level control when needed and a no-code option for simplicity. Join our journey if you share our vision for making developers' lives easier and more productive.",
    industries: ['Developer Tools & APIs'],
    socials: [
      {
        type: 'linkedin',
        url: 'https://linkedin.com/company/pipedreamhq',
      },
    ],
    source: 'Context.dev brand-intelligence API',
    asOf: '2026-07-02',
    icon: PipedreamIcon,
  },
  oneLiner:
    'Pipedream is a hosted integration platform for building workflows with prebuilt actions and code, and embedding authentication and API tools into applications and AI agents through Connect and MCP.',
  standoutFeatures: [
    {
      title: 'Hosted MCP and managed authentication',
      description:
        'Pipedream Connect exposes thousands of app integrations as MCP tools and manages end-user account authorization. Developers can use the tools with frameworks including OpenAI, Anthropic, Google Gemini, and the Vercel AI SDK.',
      shortDescription: 'Hosted MCP tools with managed account authentication.',
      source: {
        url: 'https://pipedream.com/docs/connect/mcp/developers',
        label: 'Develop with Pipedream MCP — Pipedream Docs',
        asOf: '2026-09-13',
      },
    },
    {
      title: 'Code alongside prebuilt actions',
      description:
        'Workflows combine prebuilt actions with Node.js, Python, Go, or Bash. Step results, logs, and errors are available in the builder, and deployed workflows run on Pipedream servers.',
      shortDescription: 'Four code runtimes alongside prebuilt actions.',
      source: {
        url: 'https://pipedream.com/docs/workflows',
        label: 'What Are Workflows? — Pipedream Docs',
        asOf: '2026-09-13',
      },
    },
    {
      title: 'Custom tools for Connect and MCP',
      description:
        'Business customers can publish their own Node.js actions to development or production Connect environments. Those actions become callable through Connect APIs and the relevant app MCP server.',
      shortDescription: 'Business custom actions are available through APIs and MCP.',
      source: {
        url: 'https://pipedream.com/docs/connect/components/custom-tools',
        label: 'Using Custom Tools — Pipedream Docs',
        asOf: '2026-09-13',
      },
    },
  ],
  limitations: [
    {
      title: 'Customer-infrastructure deployment requires a sales discussion',
      description:
        'Pipedream documents isolated networks for its hosted workflows and invites customers to contact sales about running workflows on their own infrastructure. Public availability and deployment terms were not verified.',
      shortDescription: 'Customer-infrastructure deployment terms require a sales discussion.',
      source: {
        url: 'https://pipedream.com/docs/workflows/vpc',
        label: 'Virtual Private Clouds — Pipedream Docs',
        asOf: '2026-09-13',
      },
    },
    {
      title: 'AI workflow editing has feature restrictions',
      description:
        'The documented String.com editing path excludes workflows using control-flow steps, GitHub Sync, Python, Connect features, or multiple triggers. Node.js workflows without those features can use the AI editing flow.',
      shortDescription: 'String AI editing excludes several workflow features.',
      source: {
        url: 'https://pipedream.com/docs/workflows/building-workflows/build-with-ai',
        label: 'Build with AI — Pipedream Docs',
        asOf: '2026-09-13',
      },
    },
    {
      title: 'Retry and logging controls have scope limits',
      description:
        'Automatic step retries require Advanced and do not cover timeout or out-of-memory failures. Disabling workflow data retention does not disable logging of inbound events by its source.',
      shortDescription: 'Advanced retries; source logs have separate retention.',
      source: {
        url: 'https://pipedream.com/docs/workflows/building-workflows/settings',
        label: 'Settings — Pipedream Docs',
        asOf: '2026-09-13',
      },
    },
    {
      title: 'Source-available repository license',
      description:
        'The component repository uses Pipedream Source Available License v1.0 with an excluded-purpose restriction on commercial use, including competing online services. It is not a permissive open-source license.',
      shortDescription: 'Repository reuse is restricted by its source-available license.',
      source: {
        url: 'https://github.com/PipedreamHQ/pipedream/blob/master/LICENSE',
        label: 'pipedream/LICENSE at master · PipedreamHQ/pipedream · GitHub',
        asOf: '2026-09-13',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'Hosted visual workflows with prebuilt actions and Node.js, Python, Go, or Bash steps.',
        shortValue: 'Visual workflow builder with four code runtimes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows',
            label: 'What Are Workflows? — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      learningCurve: {
        value: 'Not verified',
        shortValue: 'Not verified',
        detail:
          'Learning time was not measured. The visual builder supports prebuilt actions and custom HTTP requests without code; authoring custom components requires Node.js or JavaScript proficiency.',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://pipedream.com/docs/apps/connected-accounts',
            label: 'Connected Accounts - Pipedream',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/components',
            label: 'Overview - Pipedream',
            asOf: '2026-09-13',
          },
        ],
      },
      selfHostOption: {
        value:
          'Contact sales: documentation invites inquiries about running workflows on customer infrastructure; availability and terms were not verified.',
        shortValue: 'Customer-infrastructure deployment: contact sales',
        detail:
          'The public documentation does not provide deployment instructions or establish generally available self-hosting.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/vpc',
            label: 'Virtual Private Clouds — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      deploymentOptions: {
        value:
          'Hosted on AWS us-east-1, with optional isolated Pipedream VPC networks for workflow egress.',
        shortValue: 'AWS us-east-1; optional isolated workflow networks',
        detail:
          'Business VPCs provide network isolation and static outbound IPs within the hosted service. The documentation directs customer-infrastructure deployment inquiries to sales.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/privacy-and-security',
            label: 'Privacy and Security at Pipedream — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/workflows/vpc',
            label: 'Virtual Private Clouds — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      templates: {
        value:
          'Yes: workflow share links create reusable templates with separate credentials and version history.',
        shortValue: 'Share links create independent workflow templates',
        detail:
          'A share link is frozen at creation time; later changes do not update copied workflows. Pipedream warns that using a share link within the same workspace can couple trigger changes between the original and copy; duplicate the workflow directly in that case.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/sharing',
            label: 'Sharing Workflows — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      license: {
        value: 'The public component repository uses Pipedream Source Available License v1.0.',
        shortValue: 'Source-available license with commercial-use restrictions',
        detail:
          'Its excluded-purpose clause restricts commercial use, including competing online services. Hosted-service access is separate from rights to reuse repository code.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/PipedreamHQ/pipedream/blob/master/LICENSE',
            label: 'pipedream/LICENSE at master · PipedreamHQ/pipedream · GitHub',
            asOf: '2026-09-13',
          },
        ],
      },
      environmentPromotion: {
        value:
          'Advanced and above: GitHub Sync deploys modified project resources by merging a development branch into production.',
        shortValue: 'Advanced+: project promotion through GitHub merges',
        detail:
          'Connect separately isolates development/production accounts. GitHub Sync does not currently bootstrap a new project from an existing workflow repository.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/git',
            label: 'GitHub Sync — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/connect/managed-auth/environments',
            label: 'Environments — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/pricing',
            label: 'Pricing - Pipedream',
            asOf: '2026-09-13',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Advanced and above: bidirectional GitHub Sync, development branches, pull requests, a merge diff, and Git history.',
        shortValue: 'Advanced+: GitHub branches, PRs, and diffs',
        detail:
          'Merging to production deploys every modified resource in the project. Changes can also be edited locally and synchronized through GitHub.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/git',
            label: 'GitHub Sync — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/pricing',
            label: 'Pricing - Pipedream',
            asOf: '2026-09-13',
          },
        ],
      },
      realtimeCollaboration: {
        value: 'Not verified',
        shortValue: 'Not verified',
        detail:
          'Shared workspaces and project access are documented. Simultaneous workflow-canvas editing with live cursors and synchronized operations was not verified.',
        confidence: 'unknown',
        sources: [],
      },
      nativeFileStorage: {
        value:
          'Partial: project File Stores include directories, persistent files, and shareable file URLs; deletion is permanent.',
        shortValue: 'Advanced+ preview: files/URLs; deletion permanent',
        detail:
          'Documented as Preview on Advanced and above. Node.js helpers manage the store; password- or SSO-protected file links were not verified.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/data-management/file-stores',
            label: 'File Stores — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      dataTables: {
        value:
          'Partial: built-in key-value Data Stores support JSON values, manual editing, TTLs, and workflow actions.',
        shortValue: 'Key-value Data Stores with TTL and manual editing',
        detail:
          'These are not relational spreadsheet tables. Operations are not atomic or transactional, and capacity depends on the workspace plan.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/data-management/data-stores',
            label: 'Data Stores — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      richTextEditor: {
        value: 'Not verified',
        shortValue: 'Not verified',
        detail:
          'Workflow step notes support Markdown, but a native document workspace with rich-text editing and stored documents was not verified.',
        confidence: 'unknown',
        sources: [],
      },
      subWorkflows: {
        value:
          'Yes: the Trigger Workflow action or $.flow.trigger() invokes another saved workflow; documented as alpha.',
        shortValue: 'Trigger Workflow action and code invocation (alpha)',
        detail:
          'A workflow in the same workspace can be invoked directly, without an HTTP request or additional trigger configuration.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/code/nodejs',
            label: 'Running Node.js in Workflows — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      customBlocks: {
        value: 'Not verified',
        shortValue: 'Not verified',
        detail:
          'Reusable custom action components are documented, but publishing a complete saved workflow as its own encapsulated organization toolbar block was not verified.',
        confidence: 'unknown',
        sources: [],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          'OpenAI actions plus model-independent MCP tools usable with OpenAI, Anthropic, Gemini, and other compatible agent frameworks.',
        shortValue: 'Provider actions and model-independent MCP tools',
        detail:
          'The connected model provider performs inference; Pipedream supplies integrations and execution infrastructure.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://raw.githubusercontent.com/PipedreamHQ/pipedream/master/components/openai/actions/chat-with-responses-api/chat-with-responses-api.mjs',
            label: 'Pipedream official source — chat with responses api',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/connect/mcp/developers',
            label: 'Develop with Pipedream MCP — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          'Partial: AI-assisted agent building through String and provider actions supporting model tools and multi-turn responses.',
        shortValue: 'String agent building and provider tool-calling actions',
        detail:
          'A universal built-in agent-loop block was not verified; tool orchestration depends on the chosen provider action or custom code.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/build-with-ai',
            label: 'Build with AI — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://raw.githubusercontent.com/PipedreamHQ/pipedream/master/components/openai/actions/chat-with-responses-api/chat-with-responses-api.mjs',
            label: 'Pipedream official source — chat with responses api',
            asOf: '2026-09-13',
          },
        ],
      },
      naturalLanguageBuilding: {
        value: 'Yes: Edit with AI opens String.com to create, edit, test, and deploy workflows.',
        shortValue: 'String.com workflow generation and editing',
        detail:
          'The documented editing path excludes control flow, GitHub Sync, Python, Connect features, and multiple triggers.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/build-with-ai',
            label: 'Build with AI — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          'Partial: provider integrations can supply retrieval tools, including OpenAI file search in the Responses action.',
        shortValue: 'Provider retrieval tools; native KB unverified',
        detail:
          'A Pipedream-managed document ingestion, vector index, and knowledge-base administration product was not verified.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://raw.githubusercontent.com/PipedreamHQ/pipedream/master/components/openai/actions/chat-with-responses-api/chat-with-responses-api.mjs',
            label: 'Pipedream official source — chat with responses api',
            asOf: '2026-09-13',
          },
        ],
      },
      mcpSupport: {
        value:
          'Yes: hosted app MCP servers with managed authentication; the OpenAI Responses action also accepts remote MCP tools.',
        shortValue: 'Hosted MCP servers and provider-mediated MCP consumption',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/connect/mcp',
            label: 'MCP Servers — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/connect/mcp/developers',
            label: 'Develop with Pipedream MCP — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://raw.githubusercontent.com/PipedreamHQ/pipedream/master/components/openai/actions/chat-with-responses-api/chat-with-responses-api.mjs',
            label: 'Pipedream official source — chat with responses api',
            asOf: '2026-09-13',
          },
        ],
      },
      evaluationGuardrails: {
        value: 'Partial: prebuilt OpenAI moderation and schema-constrained Responses actions.',
        shortValue: 'Provider moderation and structured-output actions',
        detail:
          'A platform-wide evaluation suite or policy engine was not verified; builders must connect these actions to their workflow logic.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://raw.githubusercontent.com/PipedreamHQ/pipedream/master/components/openai/actions/create-moderation/create-moderation.mjs',
            label: 'Pipedream official source — create moderation',
            asOf: '2026-09-13',
          },
          {
            url: 'https://raw.githubusercontent.com/PipedreamHQ/pipedream/master/components/openai/actions/chat-with-responses-api/chat-with-responses-api.mjs',
            label: 'Pipedream official source — chat with responses api',
            asOf: '2026-09-13',
          },
        ],
      },
      humanInTheLoop: {
        value:
          'Yes: $.flow.suspend() pauses a run and returns execution-specific resume and cancel URLs for approval.',
        shortValue: 'Code-based suspend, approval, and resume',
        detail:
          'Builders distribute the approval links. Suspended runs auto-cancel after 24 hours by default, with a configurable timeout.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/code/nodejs/rerun',
            label: 'Pause, Resume, and Rerun a Workflow — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      generativeMedia: {
        value:
          'Prebuilt provider actions for image creation, text-to-speech, transcription, and Vertex AI Veo video generation.',
        shortValue: 'Image, speech, transcription, and video provider actions',
        detail:
          'Provider accounts and provider-specific availability, usage fees, and limits apply.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://raw.githubusercontent.com/PipedreamHQ/pipedream/master/components/openai/actions/create-image/create-image.mjs',
            label: 'Pipedream official source — create image',
            asOf: '2026-09-13',
          },
          {
            url: 'https://raw.githubusercontent.com/PipedreamHQ/pipedream/master/components/openai/actions/convert-text-to-speech/convert-text-to-speech.mjs',
            label: 'Pipedream official source — convert text to speech',
            asOf: '2026-09-13',
          },
          {
            url: 'https://raw.githubusercontent.com/PipedreamHQ/pipedream/master/components/openai/actions/create-transcription/create-transcription.mjs',
            label: 'Pipedream official source — create transcription',
            asOf: '2026-09-13',
          },
          {
            url: 'https://raw.githubusercontent.com/PipedreamHQ/pipedream/master/components/google_vertex_ai/actions/generate-video-from-text/generate-video-from-text.mjs',
            label: 'Pipedream official source — generate video from text',
            asOf: '2026-09-13',
          },
        ],
      },
      dynamicToolUse: {
        value:
          'Partial: models can select configured functions or MCP tools at runtime through provider actions and external agent frameworks.',
        shortValue: 'Runtime choice among configured provider/MCP tools',
        detail:
          'The reviewed sources do not establish unrestricted runtime discovery across the entire catalog.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://raw.githubusercontent.com/PipedreamHQ/pipedream/master/components/openai/actions/chat-using-functions/chat-using-functions.mjs',
            label: 'Pipedream official source — chat using functions',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/connect/mcp/developers',
            label: 'Develop with Pipedream MCP — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      modelFallback: {
        value: 'Not verified',
        shortValue: 'Not verified',
        detail:
          'Automatic cross-model or cross-provider failover was not verified. Step retries and custom error handling are separate mechanisms.',
        confidence: 'unknown',
        sources: [],
      },
      agentSkills: {
        value: 'Not verified',
        shortValue: 'Not verified',
        detail:
          'A first-class shared library of named prompt or knowledge snippets referenced across agents was not verified. Reusable components primarily share code.',
        confidence: 'unknown',
        sources: [],
      },
      nativeChatDeployment: {
        value: 'Not verified',
        shortValue: 'Not verified',
        detail:
          'Pipedream links to an MCP demonstration chat and supports developer-built agents. A native public chat deployment target for an arbitrary saved workflow was not verified.',
        confidence: 'unknown',
        sources: [],
      },
      kbChunkVisibility: {
        value: 'Not verified',
        shortValue: 'Not verified',
        detail:
          'A native Pipedream knowledge-base search debugger exposing chunk indices and retrieved content was not verified. Provider search tools have their own outputs.',
        confidence: 'unknown',
        sources: [],
      },
      parallelExecution: {
        value:
          'Advanced and above: Parallel branches execute concurrently and return branch results to the parent flow.',
        shortValue: 'Advanced+: parallel branches with joined results',
        detail:
          'The docs label queue concurrency/execution-rate behavior with this operator as a beta limitation.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/control-flow/parallel',
            label: 'Parallel — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/pricing',
            label: 'Pricing - Pipedream',
            asOf: '2026-09-13',
          },
        ],
      },
      a2aProtocol: {
        value: 'Not verified',
        shortValue: 'Not verified',
        detail:
          'Native Agent2Agent protocol support and Agent Card publication were not verified. MCP support is documented separately.',
        confidence: 'unknown',
        sources: [],
      },
      loopIteration: {
        value: 'Not verified',
        shortValue: 'Not verified',
        detail:
          'A visual Loop/For Each container was not verified. The control-flow overview still describes looping as forthcoming, while dedicated pages already document other newer operators; iteration in code is available.',
        confidence: 'unknown',
        sources: [],
      },
    },
    integrations: {
      integrationCount: {
        value: 'Pipedream advertises 3,000+ app APIs and 10,000+ tools.',
        shortValue: '3,000+ APIs; 10,000+ tools',
        detail: 'Vendor-reported catalog scale; APIs/apps and callable tools are different units.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/connect/mcp/developers',
            label: 'Develop with Pipedream MCP — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      triggerTypes: {
        value:
          'HTTP/webhooks, schedules, email, and app-event sources; workflows can have multiple triggers.',
        shortValue: 'HTTP, schedules, email, and app-event triggers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/triggers',
            label: 'Triggers — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/workflows',
            label: 'What Are Workflows? — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      customCodeSteps: {
        value: 'Yes: Node.js, Python, Go, and Bash workflow steps.',
        shortValue: 'Node.js, Python, Go, and Bash',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/code',
            label: 'Overview — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      codeSandboxRuntime: {
        value:
          'Inline npm/PyPI dependencies with version controls; Bash includes common binaries and supports installing software under /tmp.',
        shortValue: 'User packages; vendor-managed runtime',
        detail:
          'Python packages needing unavailable system libraries are unsupported. A self-service custom-image or OS-package configuration interface was not verified.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/code/nodejs',
            label: 'Running Node.js in Workflows — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/code/python',
            label: 'Python — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/code/bash',
            label: 'Bash — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      apiPublishing: {
        value:
          'Yes: HTTP-triggered workflows expose endpoints and can return custom HTTP responses.',
        shortValue: 'Hosted HTTP endpoints with custom responses',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/triggers',
            label: 'Triggers — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Official TypeScript, Python, and Java Connect SDKs, plus component development and CLI publishing.',
        shortValue: 'TypeScript, Python, Java SDKs and component tooling',
        detail:
          'Custom components can be privately published or submitted for the public registry.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/connect/api-reference/sdks',
            label: 'SDKs — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/components',
            label: 'Overview — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/components/contributing',
            label: 'Pipedream Registry — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      mcpPublishing: {
        value:
          'Partial: Business custom actions automatically become tools in the relevant app MCP server.',
        shortValue: 'Business custom actions publish as MCP tools',
        detail:
          'Publishing an entire saved workflow directly as its own MCP server was not verified. Custom components can implement the desired API operation.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/connect/components/custom-tools',
            label: 'Using Custom Tools — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Compute credits per workflow segment; Connect additionally charges for end users and API usage.',
        shortValue: 'Compute credits plus Connect end-user usage',
        detail:
          'One workflow credit covers 30 seconds at 256MB per segment. Higher memory, additional segments, and dedicated workers affect consumption.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/pricing',
            label: 'Plans and Pricing — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      entryPaidPlan: {
        value: 'Basic: US$29/month billed annually (US$348/year), or US$45/month billed monthly.',
        shortValue: 'Basic: US$29/mo annual or US$45 monthly',
        detail:
          'The public pricing page lists 2,000 included workflow credits per month at the default Basic allowance.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/pricing',
            label: 'Pricing - Pipedream',
            asOf: '2026-09-13',
          },
        ],
      },
      freeTier: {
        value: 'Yes: limited free workflows and Connect development access.',
        shortValue: 'Limited free workflows and Connect development',
        detail:
          'The pricing page lists 100 credits/month, 3 active workflows, and 3 connected accounts. It advertises unlimited testing, while the docs describe daily credit and test-runtime limits; these differences remain unresolved. Connect production requires a paid plan.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/docs/pricing',
            label: 'Plans and Pricing — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/pricing',
            label: 'Pricing - Pipedream',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/workflows/limits',
            label: 'Limits - Pipedream',
            asOf: '2026-09-13',
          },
        ],
      },
      byok: {
        value:
          'Yes: provider actions use connected accounts and API keys, including the user-supplied OpenAI key.',
        shortValue: 'Bring provider credentials through connected accounts',
        detail:
          'Pipedream compute and Connect charges remain separate from model-provider billing.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/apps/connected-accounts',
            label: 'Connected Accounts — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://raw.githubusercontent.com/PipedreamHQ/pipedream/master/components/openai/openai.app.mjs',
            label: 'Pipedream official source — openai.app',
            asOf: '2026-09-13',
          },
        ],
      },
    },
    security: {
      dataResidency: {
        value: 'Pipedream documents AWS us-east-1 hosting.',
        shortValue: 'AWS us-east-1',
        detail: 'The reviewed documentation did not establish another customer-selectable region.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/privacy-and-security',
            label: 'Privacy and Security at Pipedream — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      rbac: {
        value: 'Yes: workspace Owner, Admin, and Member roles, with project access controls.',
        shortValue: 'Workspace roles and project access',
        detail:
          'Business workspaces can restrict individual projects to specified members; owners/admins retain broader access.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workspaces',
            label: 'Managing workspaces — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/projects/access-controls',
            label: 'Access Controls — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      auditLogging: {
        value:
          'Workflows: not verified. Separate Conduit early access advertises administrative and tool-call audit logs.',
        shortValue: 'Conduit early-access audit logs; Workflows unverified',
        detail:
          'Conduit advertises records of sign-ins, policy changes, and tool calls, filterable by actor, event, or date. Workflows administrative audit logs and Conduit plan terms were not verified.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/conduit',
            label: 'Conduit is the AI connector gateway from Pipedream',
            asOf: '2026-09-13',
          },
        ],
      },
      compliance: {
        value:
          'SOC 2 Type 2 report available; Business customers can sign a HIPAA BAA for eligible services; DPA includes GDPR SCCs.',
        shortValue: 'SOC 2 Type 2; Business HIPAA BAA',
        detail:
          'HIPAA-eligible services include Workflows, sources, Data Stores, Destinations, and Connect; File Stores and v1 workflows are explicitly excluded. Private reports were not inspected. AWS certifications are not represented as Pipedream-held certifications.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/privacy-and-security',
            label: 'Privacy and Security at Pipedream — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/privacy-and-security/hipaa',
            label: 'HIPAA Compliance — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      modelAndToolGovernance: {
        value:
          'Partial: separate Conduit early access advertises connector and individual-tool grants for workspaces, groups, and users.',
        shortValue: 'Conduit early-access tool policies; models unverified',
        detail:
          'Pipedream Workflows model/tool allowlists and Conduit LLM-model restrictions were not verified. Conduit is a separate gateway offering; its tool grants are not established as Workflows permissions.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/conduit',
            label: 'Conduit is the AI connector gateway from Pipedream',
            asOf: '2026-09-13',
          },
        ],
      },
      credentialGovernance: {
        value:
          'Yes: connected accounts are private by default, can be shared, and have access enforced at each workflow step.',
        shortValue: 'Private/shared accounts with step-level enforcement',
        detail:
          'A collaborator without account access cannot edit that step code or inputs. Account sharing is distinct from a custom permission-group policy system.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/apps/connected-accounts',
            label: 'Connected Accounts — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      whiteLabeling: {
        value:
          'Partial: custom endpoint domains and customer-owned OAuth clients provide limited branding control.',
        shortValue: 'Custom domains and customer-owned OAuth clients',
        detail:
          'Complete removal of Pipedream branding from all dashboard and hosted consent surfaces was not verified.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/domains',
            label: 'Custom Domains — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/connect/managed-auth/oauth-clients',
            label: 'OAuth Clients — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      dataRetention: {
        value:
          'Partial: workflow settings can disable execution-log retention; source event logs and builder test events are separate.',
        shortValue: 'Workflow log opt-out; separate source retention',
        detail:
          'Retention windows follow account rules. Connect API/MCP request and response bodies are not retained according to Pipedream security docs; a general admin-set number-of-days control was not verified.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/settings',
            label: 'Settings — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/privacy-and-security',
            label: 'Privacy and Security at Pipedream — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      piiRedaction: {
        value: 'Not verified',
        shortValue: 'Not verified',
        detail:
          'Automatic PII detection and redaction in workflow payloads or logs was not verified. Disabling execution logging is a separate control.',
        confidence: 'unknown',
        sources: [],
      },
      sso: {
        value: 'Yes: Business supports SAML 2.0 or Google OAuth SSO and SCIM user provisioning.',
        shortValue: 'Business SAML/Google SSO and SCIM',
        detail:
          'Workspace owners retain alternate login access to prevent lockout. First-login automatic provisioning behavior was not separately verified.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workspaces/sso',
            label: 'Single Sign On Overview — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/workspaces',
            label: 'Managing workspaces — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      sessionPolicy: {
        value: 'Not verified',
        shortValue: 'Not verified',
        detail:
          'Customer-configurable absolute session duration or inactivity limits were not verified. API-token expiration is not treated as a dashboard session policy.',
        confidence: 'unknown',
        sources: [],
      },
      thirdPartyVetting: {
        value:
          'Community registry contributions require a pull request and approval by the Pipedream team before publication.',
        shortValue: 'Team-reviewed community registry contributions',
        detail:
          'Private custom components are also supported. The documented review process does not establish a formal security-audit guarantee for every component.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/components/contributing',
            label: 'Pipedream Registry — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Per-event history shows workflow steps, configuration, results, errors, stack traces, and run performance.',
        shortValue: 'Event history and step-level execution details',
        detail: 'Aggregate latency-percentile or distributed-span dashboards were not verified.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/event-history',
            label: 'Event History — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/workflows',
            label: 'What Are Workflows? — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      durabilityModel: {
        value:
          'Advanced retries resume at the failed step, up to eight retries over ten hours; event history supports bulk replay.',
        shortValue: 'Advanced retries; bulk replay and explicit pause/resume',
        detail:
          'Automatic retries exclude timeout and out-of-memory errors. Explicit suspend/resume handles approval or callback waits.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/settings',
            label: 'Settings — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/workflows/event-history',
            label: 'Event History — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/code/nodejs/rerun',
            label: 'Pause, Resume, and Rerun a Workflow — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      failureAlerting: {
        value:
          'Yes: unhandled live errors send email; custom workflows can consume the global error stream for other channels.',
        shortValue: 'Error email and custom error-stream notifications',
        detail:
          'Duplicate emails are limited to one per error/workflow per 24 hours. Paid plans also notify at 80% and 100% of included compute credits.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/errors',
            label: 'Handling Errors — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/workflows/limits',
            label: 'Limits — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      dataDrains: {
        value:
          'Partial: destinations asynchronously deliver builder-selected event data to external services; error streams and APIs expose failures.',
        shortValue: 'Event destinations and error streams',
        detail:
          'Automatic continuous export of all execution logs, audit events, and usage records was not verified.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/data-management/destinations',
            label: 'Destinations — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/errors',
            label: 'Handling Errors — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      asyncExecution: {
        value:
          'Yes: HTTP triggers can respond immediately while the workflow runs, or send custom responses through $.respond().',
        shortValue: 'Immediate HTTP response with background execution',
        detail:
          'Execution results remain available through event inspection according to retention settings.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/triggers',
            label: 'Triggers — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      executionLimits: {
        value:
          'Defaults: 30 seconds for HTTP/email and 60 seconds for cron; configurable maxima are 300 seconds Free and 750 seconds paid.',
        shortValue: 'Per-segment caps: 300s Free / 750s paid',
        detail:
          'Control-flow boundaries create new segments and reset the execution timeout, so total workflow duration can be longer. HTTP triggers average 10 requests/second unless increased for a paid customer.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/limits',
            label: 'Limits — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/control-flow',
            label: 'Overview — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      partialFailureHandling: {
        value:
          'Partial: code can catch failures; unhandled action errors use retries or a separate error-handling workflow.',
        shortValue: 'Code error handling and separate error listeners',
        detail: 'A general built-in continue-on-error branch for action steps was not verified.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/errors',
            label: 'Handling Errors — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/settings',
            label: 'Settings — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      unattendedExecution: {
        value:
          'Yes: deployed workflows execute on Pipedream servers without an open browser session.',
        shortValue: 'Server-side execution without an open browser',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows',
            label: 'What Are Workflows? — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Community forum and Slack are documented for free workspaces; support requests are available through the vendor support channel.',
        shortValue: 'Community forum, Slack, and vendor support',
        detail:
          'Business advertises dedicated Slack support. Current support response-time commitments were not verified.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/pricing',
            label: 'Plans and Pricing — Pipedream Docs',
            asOf: '2026-09-13',
          },
          {
            url: 'https://github.com/PipedreamHQ/pipedream',
            label: 'PipedreamHQ/pipedream — GitHub repository',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/pricing',
            label: 'Pricing - Pipedream',
            asOf: '2026-09-13',
          },
        ],
      },
      sla: {
        value:
          'Business advertises uptime and availability SLAs; the contractual percentage was not verified.',
        shortValue: 'Business SLA offered; percentage unverified',
        detail:
          'The public pricing page includes uptime and availability SLAs for Business. Exact uptime percentages, exclusions, remedies, and support response times require the applicable contract.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/pricing',
            label: 'Pricing - Pipedream',
            asOf: '2026-09-13',
          },
        ],
      },
      community: {
        value:
          'Public component repository with approximately 11.7k GitHub stars, plus community forum and Slack.',
        shortValue: 'Public repository, forum, and Slack',
        detail: 'Repository stars are a rounded snapshot, not a count of customers.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://github.com/PipedreamHQ/pipedream',
            label: 'PipedreamHQ/pipedream — GitHub repository',
            asOf: '2026-09-13',
          },
          {
            url: 'https://pipedream.com/docs/pricing',
            label: 'Plans and Pricing — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
      companyMaturity: {
        value: 'Workday has confirmed that its acquisition of Pipedream closed.',
        shortValue: 'Acquired by Workday',
        detail:
          'Workday confirmed the completed acquisition in its February 24, 2026 financial-results announcement. Stale funding and employee estimates are omitted.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://newsroom.workday.com/2026-02-24-Workday-Announces-Fiscal-2026-Fourth-Quarter-and-Full-Year-Financial-Results',
            label: 'Workday fiscal 2026 results — Pipedream acquisition closed',
            asOf: '2026-09-13',
          },
        ],
      },
      academy: {
        value:
          'Guided workflow development documentation teaches triggers, code, testing, and deployment.',
        shortValue: 'Guided workflow development tutorials',
        detail:
          'A currently accessible University course catalog or certification program was not verified.',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/quickstart',
            label: 'Workflow Development — Pipedream Docs',
            asOf: '2026-09-13',
          },
        ],
      },
    },
  },
  oneLinerSources: [
    {
      url: 'https://pipedream.com/docs/workflows',
      label: 'What Are Workflows? — Pipedream Docs',
      asOf: '2026-09-13',
    },
    {
      url: 'https://pipedream.com/docs/connect/mcp/developers',
      label: 'Develop with Pipedream MCP',
      asOf: '2026-09-13',
    },
  ],
}
