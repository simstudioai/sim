import { OpenClawIcon } from '@/components/icons'
import type { CompetitorProfile } from '@/lib/compare/data/types'

/** Reviewed against public primary sources on 2026-09-04; uncertainties are labeled. */
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
    'OpenClaw is an MIT-licensed, self-hosted AI agent gateway with chat interfaces, tools, skills, and automation. It supports personal use and shared team sessions within one trusted Gateway boundary.',
  standoutFeatures: [
    {
      title: 'One agent gateway across chat channels',
      description:
        'OpenClaw connects messaging channels such as Slack, Discord, Telegram, and WhatsApp to agents, alongside its Control UI and native clients.',
      shortDescription: 'Messaging channels, web dashboard, and native clients.',
      source: {
        url: 'https://docs.openclaw.ai/',
        label: 'docs.openclaw.ai: Docs.Openclaw.Ai',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Shared team sessions',
      description:
        'Teams can share and steer sessions with ownership, live viewing and typing presence, and named operator roles when identity-backed access is configured.',
      shortDescription: 'Shared sessions, live presence, and operator roles.',
      source: {
        url: 'https://docs.openclaw.ai/start/teams.md',
        label: 'docs.openclaw.ai: Teams',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'MCP client and server',
      description:
        'OpenClaw manages outbound MCP connections and can expose existing channel conversations to external clients through its stdio MCP server.',
      shortDescription: 'Consume MCP tools and expose channel conversations.',
      source: {
        url: 'https://docs.openclaw.ai/cli/mcp',
        label: 'docs.openclaw.ai: Mcp',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Parallel sub-agents',
      description:
        'Agents can delegate work to background sub-agent sessions and receive their results for review. Sandbox behavior depends on configuration.',
      shortDescription: 'Background delegation with configurable isolation.',
      source: {
        url: 'https://docs.openclaw.ai/tools/subagents',
        label: 'docs.openclaw.ai: Subagents',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Memory and knowledge tools',
      description:
        'Built-in memory combines Markdown notes with SQLite-backed retrieval. With an embedding provider, retrieval combines vector similarity and keyword matching.',
      shortDescription: 'Markdown memory with indexed hybrid retrieval.',
      source: {
        url: 'https://docs.openclaw.ai/concepts/memory',
        label: 'docs.openclaw.ai: Memory',
        asOf: '2026-09-04',
      },
    },
  ],
  limitations: [
    {
      title: 'One trust domain per Gateway',
      description:
        'Shared team operation is supported, but role controls are collaboration guardrails. The security model calls for separate Gateways for mutually untrusted tenants.',
      shortDescription: 'Mutually untrusted tenants need separate Gateways.',
      source: {
        url: 'https://docs.openclaw.ai/gateway/security',
        label: 'docs.openclaw.ai: Security',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Sandboxing is opt-in',
      description:
        'Tool sandboxing is off by default unless a creator role requires it. Operators must configure sandbox and tool policies for their deployment.',
      shortDescription: 'Default host execution requires deliberate policy configuration.',
      source: {
        url: 'https://docs.openclaw.ai/gateway/sandboxing',
        label: 'docs.openclaw.ai: Sandboxing',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Marketplace audits have limits',
      description:
        'ClawHub provides release audits, findings, and risk levels. Its documentation explicitly states that passing an audit does not guarantee a risk-free skill or plugin.',
      shortDescription: 'Review skill authority even when its audit passes.',
      source: {
        url: 'https://docs.openclaw.ai/clawhub/security-audits.md',
        label: 'docs.openclaw.ai: Security Audits',
        asOf: '2026-09-04',
      },
    },
    {
      title: 'Gateway availability remains operational work',
      description:
        'Team setup requires an always-on Gateway host. Remote cloud sessions move execution, while the Gateway remains responsible for conversation state and model access.',
      shortDescription: 'An available Gateway remains necessary.',
      source: {
        url: 'https://docs.openclaw.ai/start/teams.md',
        label: 'docs.openclaw.ai: Teams',
        asOf: '2026-09-04',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value:
          'Conversational agent gateway with configuration, skills, and code-driven automation',
        shortValue: 'Chat, configuration, and programmable automation',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/',
            label: 'docs.openclaw.ai: Docs.Openclaw.Ai',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.openclaw.ai/automation/taskflow',
            label: 'docs.openclaw.ai: Taskflow',
            asOf: '2026-09-04',
          },
        ],
      },
      learningCurve: {
        value: 'Guided onboarding, with technical setup for hosting and team policies',
        shortValue: 'Setup effort depends on hosting and policy',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/',
            label: 'docs.openclaw.ai: Docs.Openclaw.Ai',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.openclaw.ai/start/teams.md',
            label: 'docs.openclaw.ai: Teams',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'This is an assessment of the documented setup steps, not a measured learning-time comparison.',
      },
      selfHostOption: {
        value: 'Yes: run the Gateway on your own machine or server',
        shortValue: 'Self-hosted Gateway',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/',
            label: 'docs.openclaw.ai: Docs.Openclaw.Ai',
            asOf: '2026-09-04',
          },
        ],
      },
      deploymentOptions: {
        value: 'Gateway host, paired devices, and cloud workers for remote session execution',
        shortValue: 'Self-hosted Gateway with local or remote execution',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/',
            label: 'docs.openclaw.ai: Docs.Openclaw.Ai',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.openclaw.ai/gateway/cloud-sessions.md',
            label: 'docs.openclaw.ai: Cloud Sessions',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The Gateway retains session state and proxies model inference; remote execution does not remove the Gateway requirement.',
      },
      templates: {
        value: 'Reusable skills and plugin packages provide starting points',
        shortValue: 'Reusable skills and plugins',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/tools/skills',
            label: 'docs.openclaw.ai: Skills',
            asOf: '2026-09-04',
          },
        ],
        detail: 'A visual workflow-template catalog is a different mechanism.',
      },
      license: {
        value: 'MIT-licensed open-source software',
        shortValue: 'MIT open source',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/openclaw/openclaw/blob/main/LICENSE',
            label: 'github.com: License',
            asOf: '2026-09-04',
          },
        ],
      },
      environmentPromotion: {
        value: 'Not confirmed in the reviewed public documentation',
        shortValue: 'Not confirmed in public documentation',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.openclaw.ai/cli/backup.md',
            label: 'docs.openclaw.ai: Backup',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'A managed dev/staging/production promotion feature was not established. Backup/restore and separate Gateway deployments are documented.',
      },
      versionControlDepth: {
        value: 'Backup/restore, SQLite snapshots, and versioned Git backups',
        shortValue: 'Backups, restore, and Git snapshot history',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/cli/backup.md',
            label: 'docs.openclaw.ai: Backup',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'These are deployment-state recovery tools; they do not establish a visual workflow release-management system.',
      },
      realtimeCollaboration: {
        value: 'Yes: shared sessions with live viewing and typing presence',
        shortValue: 'Shared sessions and live presence',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/start/teams.md',
            label: 'docs.openclaw.ai: Teams',
            asOf: '2026-09-04',
          },
        ],
        detail: 'This is collaboration in agent sessions, not a visual workflow canvas.',
      },
      nativeFileStorage: {
        value: 'Gateway-managed workspaces, files, and attachments',
        shortValue: 'Managed workspaces and attachments',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/cloud-sessions.md',
            label: 'docs.openclaw.ai: Cloud Sessions',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Canonical data stays with the Gateway; remote execution stages necessary files and reconciles completed work.',
      },
      dataTables: {
        value: 'Not confirmed in the reviewed public documentation',
        shortValue: 'Not confirmed in public documentation',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.openclaw.ai/concepts/memory',
            label: 'docs.openclaw.ai: Memory',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'A first-party spreadsheet-style database grid was not established. Internal SQLite state and memory indexes are not evidence of a user-facing table product.',
      },
      richTextEditor: {
        value: 'Not confirmed in the reviewed public documentation',
        shortValue: 'Not confirmed in public documentation',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.openclaw.ai/concepts/memory',
            label: 'docs.openclaw.ai: Memory',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'An inline WYSIWYG document-editing surface was not established in the reviewed documentation.',
      },
      subWorkflows: {
        value: 'Sub-agent delegation and reusable Lobster workflow files',
        shortValue: 'Sub-agent sessions and reusable pipelines',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/tools/subagents',
            label: 'docs.openclaw.ai: Subagents',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.openclaw.ai/tools/lobster',
            label: 'docs.openclaw.ai: Lobster',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Delegating a session is different from invoking a nested workflow node with a declared interface.',
      },
      customBlocks: {
        value: 'Reusable functionality is packaged as skills and plugins',
        shortValue: 'Reusable skills and plugins',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/tools/skills',
            label: 'docs.openclaw.ai: Skills',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.openclaw.ai/plugins/sdk-overview.md',
            label: 'docs.openclaw.ai: Sdk Overview',
            asOf: '2026-09-04',
          },
        ],
        detail: 'A shared visual block palette for composing workflow graphs was not established.',
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value: 'Multiple providers and local models, with provider-specific authentication',
        shortValue: 'Cloud providers and local models',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/concepts/model-providers',
            label: 'docs.openclaw.ai: Model Providers',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Supported methods include API credentials, provider sign-in, and configured local endpoints.',
      },
      agentReasoningBlocks: {
        value: 'Agent runtime performs tool reasoning and can delegate to sub-agents',
        shortValue: 'Agent reasoning and delegation',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/',
            label: 'docs.openclaw.ai: Docs.Openclaw.Ai',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.openclaw.ai/tools/subagents',
            label: 'docs.openclaw.ai: Subagents',
            asOf: '2026-09-04',
          },
        ],
        detail: 'This is an agent runtime rather than a distinct visual reasoning-node type.',
      },
      naturalLanguageBuilding: {
        value: 'Conversational requests can create and manage automations',
        shortValue: 'Conversational automation setup',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/automation/cron-jobs',
            label: 'docs.openclaw.ai: Cron Jobs',
            asOf: '2026-09-04',
          },
        ],
        detail: 'This does not establish prompt-to-canvas workflow generation.',
      },
      knowledgeBaseRag: {
        value: 'Indexed memory with hybrid retrieval and an optional knowledge-wiki layer',
        shortValue: 'Indexed memory and knowledge-wiki plugin',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/concepts/memory',
            label: 'docs.openclaw.ai: Memory',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The default memory backend is SQLite; hybrid retrieval requires an embedding provider.',
      },
      mcpSupport: {
        value: 'Yes: outbound MCP registry and connections, plus a stdio MCP server',
        shortValue: 'MCP client and server',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/cli/mcp',
            label: 'docs.openclaw.ai: Mcp',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Outbound runtime support depends on the chosen agent runtime and server transport.',
      },
      evaluationGuardrails: {
        value: 'Tool policies, optional sandboxes, approval controls, and marketplace audits',
        shortValue: 'Policy, sandbox, approval, and skill-audit controls',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/sandbox-vs-tool-policy-vs-elevated',
            label: 'docs.openclaw.ai: Sandbox Vs Tool Policy Vs Elevated',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.openclaw.ai/clawhub/security-audits.md',
            label: 'docs.openclaw.ai: Security Audits',
            asOf: '2026-09-04',
          },
        ],
        detail: 'A dataset-based product evaluation framework was not established.',
      },
      humanInTheLoop: {
        value: 'Yes: configurable execution approvals and Lobster approval checkpoints',
        shortValue: 'Execution approvals and resumable checkpoints',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/sandbox-vs-tool-policy-vs-elevated',
            label: 'docs.openclaw.ai: Sandbox Vs Tool Policy Vs Elevated',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.openclaw.ai/tools/lobster',
            label: 'docs.openclaw.ai: Lobster',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Approvals depend on policy; trusted full-access host execution can run without prompts.',
      },
      generativeMedia: {
        value: 'Yes: image, video, music generation, speech, and media understanding',
        shortValue: 'Image, video, music, and speech tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/tools/media-overview',
            label: 'docs.openclaw.ai: Media Overview',
            asOf: '2026-09-04',
          },
        ],
        detail: 'Each capability needs an appropriate configured provider.',
      },
      dynamicToolUse: {
        value: 'Yes: agents choose among eligible tools and skills during execution',
        shortValue: 'Runtime tool and skill selection',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/tools/skills',
            label: 'docs.openclaw.ai: Skills',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'File-backed skills can refresh on the next turn after watched changes; managed-library selections remain pinned until explicitly refreshed.',
      },
      modelFallback: {
        value: 'Yes: authentication-profile rotation and configured fallback models',
        shortValue: 'Provider rotation and model fallbacks',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/concepts/model-failover.md',
            label: 'docs.openclaw.ai: Model Failover',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Fallback depends on the error and selection mode; explicit user-selected models can be strict.',
      },
      agentSkills: {
        value: 'Yes: SKILL.md packages with gating, sharing, and revision selection',
        shortValue: 'Reusable, versioned skills',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/tools/skills',
            label: 'docs.openclaw.ai: Skills',
            asOf: '2026-09-04',
          },
        ],
      },
      nativeChatDeployment: {
        value: 'Native clients and Control UI chat connect to the Gateway',
        shortValue: 'Native and browser Gateway chat',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/web/webchat',
            label: 'docs.openclaw.ai: Webchat',
            asOf: '2026-09-04',
          },
        ],
        detail: 'The documented chat interface uses Gateway authentication and availability.',
      },
      kbChunkVisibility: {
        value: 'Memory search and reads expose retrieved notes and source ranges',
        shortValue: 'Memory search and source-range reads',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/concepts/memory',
            label: 'docs.openclaw.ai: Memory',
            asOf: '2026-09-04',
          },
        ],
        detail: 'A dedicated chunk-debugging dashboard was not established.',
      },
      parallelExecution: {
        value: 'Yes: background sub-agents run concurrently with configurable limits',
        shortValue: 'Concurrent sub-agents',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/tools/subagents',
            label: 'docs.openclaw.ai: Subagents',
            asOf: '2026-09-04',
          },
        ],
      },
      a2aProtocol: {
        value: 'Yes: bundled A2A 1.0 JSON-RPC channel plugin',
        shortValue: 'Bundled A2A 1.0 plugin',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/channels/a2a.md',
            label: 'docs.openclaw.ai: A2A',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Supports Agent Cards, authenticated text tasks, polling, and configured outbound peers. Cancellation is explicitly unsupported.',
      },
      loopIteration: {
        value: 'Lobster runs sequential pipelines; HTTP hook mappings support array fan-out',
        shortValue: 'Sequential pipelines and hook array fan-out',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/tools/lobster',
            label: 'docs.openclaw.ai: Lobster',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.openclaw.ai/automation/cron-jobs',
            label: 'docs.openclaw.ai: Cron Jobs',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'General loop logic can also be implemented in code; a visual loop-container feature was not established.',
      },
    },
    integrations: {
      integrationCount: {
        value: 'Messaging channels, model/provider plugins, skills, and MCP connections',
        shortValue: 'Channels, plugins, skills, and MCP',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/',
            label: 'docs.openclaw.ai: Docs.Openclaw.Ai',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.openclaw.ai/tools/skills',
            label: 'docs.openclaw.ai: Skills',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.openclaw.ai/cli/mcp',
            label: 'docs.openclaw.ai: Mcp',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'These are different integration categories; no combined app/action count is asserted.',
      },
      triggerTypes: {
        value: 'Chat messages, schedules, condition/stream triggers, and inbound HTTP hooks',
        shortValue: 'Chat, schedules, events, and HTTP hooks',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/',
            label: 'docs.openclaw.ai: Docs.Openclaw.Ai',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.openclaw.ai/automation/cron-jobs',
            label: 'docs.openclaw.ai: Cron Jobs',
            asOf: '2026-09-04',
          },
        ],
      },
      customCodeSteps: {
        value: 'Yes: execution tools run commands and scripts under configured policy',
        shortValue: 'Commands and scripts under tool policy',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/sandbox-vs-tool-policy-vs-elevated',
            label: 'docs.openclaw.ai: Sandbox Vs Tool Policy Vs Elevated',
            asOf: '2026-09-04',
          },
        ],
      },
      codeSandboxRuntime: {
        value: 'Configurable sandbox backends, images, dependencies, and workspace access',
        shortValue: 'Configurable tool sandboxes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/sandboxing',
            label: 'docs.openclaw.ai: Sandboxing',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Sandboxing is off by default; supported backends include Docker, Podman, SSH, and OpenShell.',
      },
      apiPublishing: {
        value: 'HTTP hooks can submit agent work; webhooks plugin exposes TaskFlow operations',
        shortValue: 'Agent HTTP hooks and TaskFlow endpoints',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/automation/cron-jobs',
            label: 'docs.openclaw.ai: Cron Jobs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.openclaw.ai/plugins/webhooks',
            label: 'docs.openclaw.ai: Webhooks',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The TaskFlow webhooks plugin manages records; create_flow/run_task do not themselves start an agent.',
      },
      extensibilitySdk: {
        value: 'Typed plugin SDK for tools, channels, providers, and runtime extensions',
        shortValue: 'Typed plugin SDK',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/plugins/sdk-overview.md',
            label: 'docs.openclaw.ai: Sdk Overview',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The official documentation labels plugin APIs experimental and subject to changes between releases.',
      },
      mcpPublishing: {
        value: 'Yes: openclaw mcp serve exposes Gateway-backed channel conversations',
        shortValue: 'Native stdio MCP serving',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/cli/mcp',
            label: 'docs.openclaw.ai: Mcp',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'This exposes existing routed conversations and approval tools, not an arbitrary workflow-to-server publishing abstraction.',
      },
    },
    pricing: {
      pricingModel: {
        value: 'MIT software with separately incurred model and infrastructure costs',
        shortValue: 'Free software; model and infrastructure costs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/openclaw/openclaw/blob/main/LICENSE',
            label: 'github.com: License',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.openclaw.ai/concepts/model-providers',
            label: 'docs.openclaw.ai: Model Providers',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.openclaw.ai/gateway/cloud-sessions.md',
            label: 'docs.openclaw.ai: Cloud Sessions',
            asOf: '2026-09-04',
          },
        ],
      },
      entryPaidPlan: {
        value: 'No software license fee under MIT; external service prices vary',
        shortValue: 'No MIT software license fee',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/openclaw/openclaw/blob/main/LICENSE',
            label: 'github.com: License',
            asOf: '2026-09-04',
          },
        ],
        detail: 'Provider subscriptions, APIs, and hosted infrastructure can still cost money.',
      },
      freeTier: {
        value: 'Yes: the software is available under MIT without a license fee',
        shortValue: 'Free MIT software',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/openclaw/openclaw/blob/main/LICENSE',
            label: 'github.com: License',
            asOf: '2026-09-04',
          },
        ],
        detail: 'This does not make model inference, hosting, or third-party integrations free.',
      },
      byok: {
        value: 'Yes: configure provider credentials, provider sign-in, or local models',
        shortValue: 'Provider credentials, sign-in, or local inference',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/concepts/model-providers',
            label: 'docs.openclaw.ai: Model Providers',
            asOf: '2026-09-04',
          },
        ],
        detail: 'An API key is not mandatory for every provider or local-runtime path.',
      },
    },
    security: {
      dataResidency: {
        value:
          'Gateway location is operator-selected; external providers and workers also process data',
        shortValue: 'Operator-selected Gateway; external processing may apply',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/',
            label: 'docs.openclaw.ai: Docs.Openclaw.Ai',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.openclaw.ai/gateway/cloud-sessions.md',
            label: 'docs.openclaw.ai: Cloud Sessions',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Self-hosting alone does not keep all prompts and files local: model, channel, plugin, and remote-execution choices matter.',
      },
      rbac: {
        value: 'Yes: named operator roles limit sessions, agents, scopes, and sandbox policy',
        shortValue: 'Named operator roles within one trust domain',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/operator-scopes.md',
            label: 'docs.openclaw.ai: Operator Scopes',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Roles require authenticated identity for per-person enforcement; they are not hostile tenant isolation.',
      },
      auditLogging: {
        value: 'Yes: metadata-only audit ledger and optional execution-identity recording',
        shortValue: 'Metadata audit ledger and optional run identity',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/audit.md',
            label: 'docs.openclaw.ai: Audit',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Recording is bounded and best-effort; execution identity collection is off by default. It is separate from the security-audit diagnostic command.',
      },
      compliance: {
        value: 'Not confirmed in the reviewed public documentation',
        shortValue: 'No public attestation confirmed',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/security',
            label: 'docs.openclaw.ai: Security',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'A vendor-held SOC 2 report or comparable deployment attestation was not established. The security documentation defines deployment controls and trust boundaries.',
      },
      modelAndToolGovernance: {
        value: 'Tool profiles and allow/deny rules apply globally, per agent, and by provider',
        shortValue: 'Layered model and tool policies',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/sandbox-vs-tool-policy-vs-elevated',
            label: 'docs.openclaw.ai: Sandbox Vs Tool Policy Vs Elevated',
            asOf: '2026-09-04',
          },
        ],
        detail: 'Named operator roles also constrain available agents and can require sandboxing.',
      },
      credentialGovernance: {
        value: 'SecretRefs, protected secret storage, and allowed-host egress controls',
        shortValue: 'Secret references and scoped egress',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/secrets.md',
            label: 'docs.openclaw.ai: Secrets',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.openclaw.ai/tools/secrets.md',
            label: 'docs.openclaw.ai: Secrets',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Allowed hosts constrain egress substitution, not config SecretRefs. Plaintext credentials left in agent-readable files remain accessible.',
      },
      whiteLabeling: {
        value: 'Not confirmed in the reviewed public documentation',
        shortValue: 'Not confirmed in public documentation',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://github.com/openclaw/openclaw/blob/main/LICENSE',
            label: 'github.com: License',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'A first-class customer-branding configuration was not established. MIT modification rights alone do not establish a managed white-label product.',
      },
      dataRetention: {
        value: 'Configurable automation-session retention with bounded run-history retention',
        shortValue: 'Operator-managed retention and scheduled cleanup',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/automation/cron-jobs',
            label: 'docs.openclaw.ai: Cron Jobs',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Isolated automation sessions default to 24-hour retention; terminal run history is retained for 7 days, subject to documented row caps. Other data has separate policies.',
      },
      piiRedaction: {
        value: 'Always-on log/transcript redaction with custom sensitive-value patterns',
        shortValue: 'Sensitive-data redaction and custom patterns',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/security',
            label: 'docs.openclaw.ai: Security',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The reviewed source does not establish comprehensive PII classification/redaction for every model input and output.',
      },
      sso: {
        value: 'Yes: trusted-proxy authentication can use OAuth, OIDC, or SAML',
        shortValue: 'Identity-aware proxy SSO',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/trusted-proxy-auth.md',
            label: 'docs.openclaw.ai: Trusted Proxy Auth',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'The identity provider/proxy authenticates the user; OpenClaw validates trusted ingress and identity headers. This is deployment configuration, not a turnkey hosted SSO tier.',
      },
      sessionPolicy: {
        value: 'Not confirmed in the reviewed public documentation',
        shortValue: 'Not confirmed in public documentation',
        confidence: 'unknown',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/trusted-proxy-auth.md',
            label: 'docs.openclaw.ai: Trusted Proxy Auth',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'A universal Gateway login lifetime or idle-timeout policy was not established. Proxy sign-in and conversation reset settings are distinct controls.',
      },
      thirdPartyVetting: {
        value: 'ClawHub audits release artifacts with SkillSpector, VirusTotal, and risk analysis',
        shortValue: 'ClawHub release audits and risk findings',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/clawhub/security-audits.md',
            label: 'docs.openclaw.ai: Security Audits',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Audit results guide review and are explicitly not a guarantee that packages are risk-free.',
      },
    },
    observability: {
      tracingDepth: {
        value: 'Official OpenTelemetry plugin exports model, tool, and session diagnostics',
        shortValue: 'OpenTelemetry traces, metrics, and logs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/opentelemetry.md',
            label: 'docs.openclaw.ai: Opentelemetry',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Export requires diagnostics and plugin configuration. Raw content is excluded by default.',
      },
      durabilityModel: {
        value: 'Persistent Task Flow records, scheduled retries, and Lobster resume tokens',
        shortValue: 'Durable flow records, retries, and resume tokens',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/automation/taskflow',
            label: 'docs.openclaw.ai: Taskflow',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.openclaw.ai/automation/cron-jobs',
            label: 'docs.openclaw.ai: Cron Jobs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.openclaw.ai/tools/lobster',
            label: 'docs.openclaw.ai: Lobster',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Flow records survive Gateway restarts; this does not guarantee replay-safe recovery for arbitrary external side effects.',
      },
      failureAlerting: {
        value: 'Automation failure alerts support configured destinations and cooldowns',
        shortValue: 'Configurable automation failure alerts',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/automation/cron-jobs',
            label: 'docs.openclaw.ai: Cron Jobs',
            asOf: '2026-09-04',
          },
        ],
        detail: 'Execution failures and completion-delivery failures are tracked separately.',
      },
      dataDrains: {
        value: 'Yes: official plugin exports OTLP traces, metrics, and logs',
        shortValue: 'OTLP export and optional stdout logs',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/gateway/opentelemetry.md',
            label: 'docs.openclaw.ai: Opentelemetry',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Logs must be enabled explicitly; exporters can target compatible collectors/backends.',
      },
      asyncExecution: {
        value: 'Yes: background sub-agents, media tasks, and scheduled automations',
        shortValue: 'Background agents, media, and automations',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/tools/subagents',
            label: 'docs.openclaw.ai: Subagents',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.openclaw.ai/tools/media-overview',
            label: 'docs.openclaw.ai: Media Overview',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.openclaw.ai/automation/cron-jobs',
            label: 'docs.openclaw.ai: Cron Jobs',
            asOf: '2026-09-04',
          },
        ],
      },
      executionLimits: {
        value: 'Configurable run and concurrency limits; sub-agent concurrency defaults to 8',
        shortValue: 'Configurable limits; 8 concurrent sub-agents by default',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/tools/subagents',
            label: 'docs.openclaw.ai: Subagents',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Sub-agent nesting defaults to one level and supports a maximum depth of five. A zero sub-agent timeout does not remove every other runtime limit.',
      },
      partialFailureHandling: {
        value: 'Task Flow controllers track individual task outcomes and blocked/failed states',
        shortValue: 'Explicit task and flow outcomes',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/automation/taskflow',
            label: 'docs.openclaw.ai: Taskflow',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'Recovery depends on controller and task policy; this is not a universal visual error-branch guarantee.',
      },
      unattendedExecution: {
        value: 'Yes: automations run without an open client while the Gateway is available',
        shortValue: 'Unattended execution on an available Gateway',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.openclaw.ai/automation/cron-jobs',
            label: 'docs.openclaw.ai: Cron Jobs',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.openclaw.ai/start/teams.md',
            label: 'docs.openclaw.ai: Teams',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'An always-on server can host the Gateway; local deployments depend on that machine remaining available.',
      },
    },
    support: {
      supportChannels: {
        value: 'Official docs, GitHub issues, and Discord',
        shortValue: 'Docs, GitHub, and Discord',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/openclaw/openclaw',
            label: 'github.com: Openclaw',
            asOf: '2026-09-04',
          },
        ],
      },
      sla: {
        value: 'Not confirmed in the reviewed public documentation',
        shortValue: 'Not confirmed in public documentation',
        confidence: 'unknown',
        sources: [],
        detail:
          'A contractual project-wide hosted uptime or paid support SLA was not established; deployment and provider commitments must be assessed separately.',
      },
      community: {
        value: 'Public GitHub project, Discord, and ClawHub ecosystem',
        shortValue: 'GitHub, Discord, and ClawHub',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/openclaw/openclaw',
            label: 'github.com: Openclaw',
            asOf: '2026-09-04',
          },
        ],
        detail: 'No volatile star count or fastest-growing ranking is asserted.',
      },
      companyMaturity: {
        value: 'Open-source project developed by the nonprofit OpenClaw Foundation',
        shortValue: 'Nonprofit open-source project',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/openclaw/openclaw',
            label: 'github.com: Openclaw',
            asOf: '2026-09-04',
          },
        ],
        detail:
          'This describes the currently documented governance, not a contractual support guarantee.',
      },
      academy: {
        value: 'Official installation, personal-assistant, and team setup guides',
        shortValue: 'Official setup guides',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.openclaw.ai/',
            label: 'docs.openclaw.ai: Docs.Openclaw.Ai',
            asOf: '2026-09-04',
          },
          {
            url: 'https://docs.openclaw.ai/start/teams.md',
            label: 'docs.openclaw.ai: Teams',
            asOf: '2026-09-04',
          },
        ],
        detail: 'A formal course or certification curriculum was not established.',
      },
    },
  },
}
