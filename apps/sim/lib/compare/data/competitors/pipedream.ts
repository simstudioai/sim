import { PipedreamIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Reviewed against live primary sources on 2026-09-04; unverified capabilities are labeled. */
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
        asOf: '2026-09-04',
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
        asOf: '2026-09-04',
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
        asOf: '2026-09-04',
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
        asOf: '2026-09-04',
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
        asOf: '2026-09-04',
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
        asOf: '2026-09-04',
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
        asOf: '2026-09-04',
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
            asOf: '2026-09-04',
          },
        ],
      },
      learningCurve: {
        value: 'Not verified',
        shortValue: 'Not verified',
        detail:
          'This review did not measure learning time. The visual builder supports prebuilt actions, while custom integrations require API and programming knowledge.',
        confidence: 'unknown',
        sources: [],
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
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
          },
          {
            url: 'https://pipedream.com/docs/workflows/vpc',
            label: 'Virtual Private Clouds — Pipedream Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      templates: {
        value:
          'Yes: workflow share links create reusable templates with separate credentials and version history.',
        shortValue: 'Share links create independent workflow templates',
        detail:
          'A share link is frozen at creation time; later changes do not update copied workflows.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/sharing',
            label: 'Sharing Workflows — Pipedream Docs',
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
          },
        ],
      },
      environmentPromotion: {
        value:
          'GitHub Sync deploys modified project resources by merging a development branch into production.',
        shortValue: 'Project promotion through GitHub branch merges',
        detail:
          'Connect separately isolates development/production accounts. GitHub Sync does not currently bootstrap a new project from an existing workflow repository.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/git',
            label: 'GitHub Sync — Pipedream Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://pipedream.com/docs/connect/managed-auth/environments',
            label: 'Environments — Pipedream Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Bidirectional GitHub Sync, development branches, pull requests, a merge diff, and Git history.',
        shortValue: 'GitHub branches, pull requests, and merge diffs',
        detail:
          'Merging to production deploys every modified resource in the project. Changes can also be edited locally and synchronized through GitHub.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/git',
            label: 'GitHub Sync — Pipedream Docs',
            asOf: '2026-09-04',
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
        shortValue: 'Project files, directories, URLs; no deletion recovery',
        detail:
          'Documented as Preview on Advanced and above. Node.js helpers manage the store; password- or SSO-protected file links were not verified.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/data-management/file-stores',
            label: 'File Stores — Pipedream Docs',
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
          },
          {
            url: 'https://pipedream.com/docs/connect/mcp/developers',
            label: 'Develop with Pipedream MCP — Pipedream Docs',
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
          },
          {
            url: 'https://raw.githubusercontent.com/PipedreamHQ/pipedream/master/components/openai/actions/chat-with-responses-api/chat-with-responses-api.mjs',
            label: 'Pipedream official source — chat with responses api',
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
          },
          {
            url: 'https://pipedream.com/docs/connect/mcp/developers',
            label: 'Develop with Pipedream MCP — Pipedream Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://raw.githubusercontent.com/PipedreamHQ/pipedream/master/components/openai/actions/chat-with-responses-api/chat-with-responses-api.mjs',
            label: 'Pipedream official source — chat with responses api',
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
          },
          {
            url: 'https://raw.githubusercontent.com/PipedreamHQ/pipedream/master/components/openai/actions/chat-with-responses-api/chat-with-responses-api.mjs',
            label: 'Pipedream official source — chat with responses api',
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
          },
          {
            url: 'https://raw.githubusercontent.com/PipedreamHQ/pipedream/master/components/openai/actions/convert-text-to-speech/convert-text-to-speech.mjs',
            label: 'Pipedream official source — convert text to speech',
            asOf: '2026-09-04',
          },
          {
            url: 'https://raw.githubusercontent.com/PipedreamHQ/pipedream/master/components/openai/actions/create-transcription/create-transcription.mjs',
            label: 'Pipedream official source — create transcription',
            asOf: '2026-09-04',
          },
          {
            url: 'https://raw.githubusercontent.com/PipedreamHQ/pipedream/master/components/google_vertex_ai/actions/generate-video-from-text/generate-video-from-text.mjs',
            label: 'Pipedream official source — generate video from text',
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
          },
          {
            url: 'https://pipedream.com/docs/connect/mcp/developers',
            label: 'Develop with Pipedream MCP — Pipedream Docs',
            asOf: '2026-09-04',
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
          'Yes: Parallel branches execute concurrently and return branch results to the parent flow.',
        shortValue: 'Parallel branches with joined results',
        detail:
          'The docs label queue concurrency/execution-rate behavior with this operator as a beta limitation.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/control-flow/parallel',
            label: 'Parallel — Pipedream Docs',
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
          },
          {
            url: 'https://pipedream.com/docs/workflows',
            label: 'What Are Workflows? — Pipedream Docs',
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
          },
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/code/python',
            label: 'Python — Pipedream Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/code/bash',
            label: 'Bash — Pipedream Docs',
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
          },
          {
            url: 'https://pipedream.com/docs/components',
            label: 'Overview — Pipedream Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://pipedream.com/docs/components/contributing',
            label: 'Pipedream Registry — Pipedream Docs',
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
          },
        ],
      },
      entryPaidPlan: {
        value: 'Not verified',
        shortValue: 'Not verified',
        detail:
          'The public pricing page did not expose readable current amounts during this review, and the pricing docs defer to that page. Confirm the current Basic price and billing cadence directly; conflicting third-party estimates have been removed.',
        confidence: 'unknown',
        sources: [],
      },
      freeTier: {
        value:
          'Yes: free workflow usage has daily credit and resource limits; Connect is available for development use.',
        shortValue: 'Limited free workflows and Connect development',
        detail:
          'Workflow testing does not consume credits, but free testing has a runtime limit. Connect production requires a paid plan.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/pricing',
            label: 'Plans and Pricing — Pipedream Docs',
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
          },
          {
            url: 'https://raw.githubusercontent.com/PipedreamHQ/pipedream/master/components/openai/openai.app.mjs',
            label: 'Pipedream official source — openai.app',
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
          },
          {
            url: 'https://pipedream.com/docs/projects/access-controls',
            label: 'Access Controls — Pipedream Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      auditLogging: {
        value: 'Not verified',
        shortValue: 'Not verified',
        detail:
          'Execution history and provider-internal security monitoring are documented, but customer-facing administrative audit logs and their plan scope were not verified.',
        confidence: 'unknown',
        sources: [],
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
            asOf: '2026-09-04',
          },
          {
            url: 'https://pipedream.com/docs/privacy-and-security/hipaa',
            label: 'HIPAA Compliance — Pipedream Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      modelAndToolGovernance: {
        value: 'Not verified',
        shortValue: 'Not verified',
        detail:
          'A customer-administered per-role allowlist of LLM models or callable integration tools was not verified. Workspace, project, and connected-account permissions are documented separately.',
        confidence: 'unknown',
        sources: [],
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
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
          },
          {
            url: 'https://pipedream.com/docs/connect/managed-auth/oauth-clients',
            label: 'OAuth Clients — Pipedream Docs',
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
          },
          {
            url: 'https://pipedream.com/docs/privacy-and-security',
            label: 'Privacy and Security at Pipedream — Pipedream Docs',
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
          },
          {
            url: 'https://pipedream.com/docs/workspaces',
            label: 'Managing workspaces — Pipedream Docs',
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
          },
          {
            url: 'https://pipedream.com/docs/workflows',
            label: 'What Are Workflows? — Pipedream Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      durabilityModel: {
        value:
          'Advanced retries resume at the failed step, up to eight retries over ten hours; event history supports bulk replay.',
        shortValue: 'Failed-step retries, bulk replay, and explicit pause/resume',
        detail:
          'Automatic retries exclude timeout and out-of-memory errors. Explicit suspend/resume handles approval or callback waits.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/settings',
            label: 'Settings — Pipedream Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://pipedream.com/docs/workflows/event-history',
            label: 'Event History — Pipedream Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/code/nodejs/rerun',
            label: 'Pause, Resume, and Rerun a Workflow — Pipedream Docs',
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
          },
          {
            url: 'https://pipedream.com/docs/workflows/limits',
            label: 'Limits — Pipedream Docs',
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
          },
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/errors',
            label: 'Handling Errors — Pipedream Docs',
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
          },
        ],
      },
      executionLimits: {
        value:
          'Defaults: 30 seconds for HTTP/email and 60 seconds for cron; configurable maxima are 300 seconds Free and 750 seconds paid.',
        shortValue: '300-second Free / 750-second paid execution caps',
        detail:
          'Control-flow boundaries create new segments and reset the execution timeout, so total workflow duration can be longer. HTTP triggers average 10 requests/second unless increased for a paid customer.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/workflows/limits',
            label: 'Limits — Pipedream Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/control-flow',
            label: 'Overview — Pipedream Docs',
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
          },
          {
            url: 'https://pipedream.com/docs/workflows/building-workflows/settings',
            label: 'Settings — Pipedream Docs',
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
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
          'Current paid support response times and dedicated-channel entitlements were not verified.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://pipedream.com/docs/pricing',
            label: 'Plans and Pricing — Pipedream Docs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://github.com/PipedreamHQ/pipedream',
            label:
              'GitHub — Pipedream DocsHQ/pipedream: Connect APIs, remarkably fast.  Free for developers. · GitHub',
            asOf: '2026-09-04',
          },
        ],
      },
      sla: {
        value: 'Not verified',
        shortValue: 'Not verified',
        detail:
          'No current contractual uptime percentage or support response-time SLA was verified from the readable primary sources. Confirm applicable contract terms with Pipedream.',
        confidence: 'unknown',
        sources: [],
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
            label:
              'GitHub — Pipedream DocsHQ/pipedream: Connect APIs, remarkably fast.  Free for developers. · GitHub',
            asOf: '2026-09-04',
          },
          {
            url: 'https://pipedream.com/docs/pricing',
            label: 'Plans and Pricing — Pipedream Docs',
            asOf: '2026-09-04',
          },
        ],
      },
      companyMaturity: {
        value: 'Workday has confirmed that its acquisition of Pipedream closed.',
        shortValue: 'Acquired by Workday',
        detail:
          'Workday published a completion announcement. Stale funding and employee estimates are omitted.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.linkedin.com/posts/workday_were-excited-to-share-that-the-acquisition-activity-7402384155063517184-ltfO',
            label: 'Workday — Pipedream acquisition completion announcement',
            asOf: '2026-09-04',
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
            asOf: '2026-09-04',
          },
        ],
      },
    },
  },
}
