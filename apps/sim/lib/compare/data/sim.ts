import type { CompetitorProfile } from '@/lib/compare/data/types'

/**
 * Sim's own profile, for use as the constant left-hand column on every
 * "Sim vs {Competitor}" page. Facts are sourced from the codebase itself
 * (file paths as of the compare-pages-data worktree, 2026-07-02) where
 * possible; a small number of facts (e.g. community size) are self-reported
 * figures rather than independently auditable, and are marked
 * `confidence: 'estimated'` accordingly.
 */
export const simProfile: CompetitorProfile = {
  id: 'sim',
  name: 'Sim',
  website: 'https://sim.ai',
  oneLiner:
    'Sim is the open-source AI workspace where teams build, deploy, and manage AI agents, connecting 1,000+ integrations and every major LLM to automate real work visually, conversationally, or with code.',
  standoutFeatures: [
    {
      title: 'AI Copilot / Chat agent-building surface',
      description:
        'A workspace-wide natural-language surface (Chat) that can build workflows, manage data, and take actions across integrations, plus an in-editor Copilot scoped to building and editing a single workflow directly.',
      shortDescription:
        'Chat builds and manages work across the workspace; in-editor Copilot edits a single workflow.',
      source: {
        url: 'https://docs.sim.ai/copilot',
        label: 'Sim Docs: Copilot',
        asOf: '2026-07-08',
      },
    },
    {
      title: 'Hybrid semantic + keyword knowledge base',
      description:
        'Built-in RAG with pgvector embeddings and a generated tsvector column for combined vector + full-text search, plus a token-based chunker with configurable chunk size/overlap and 11 supported file formats (csv, doc, docx, html, json, md, pdf, pptx, txt, xlsx, yaml).',
      shortDescription:
        'Combines vector and full-text search with configurable chunking across 11 file formats.',
      source: {
        url: 'https://github.com/simstudioai/sim/blob/main/packages/db/schema.ts',
        label: 'Sim codebase: KB schema + file-parsers',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Native MCP client and server',
      description:
        'A dedicated MCP block lets any workflow call external MCP servers as a tool, and a serve/workflow-servers API surface lets Sim expose its own workflows as MCP servers.',
      shortDescription:
        'Call external MCP servers as tools, or expose Sim workflows as an MCP server.',
      source: {
        url: 'https://docs.sim.ai/workflows/deployment/mcp',
        label: 'Sim Docs: MCP Deployment',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Fork a workspace into dev, qa, and prod environments',
      description:
        'Fork a whole workspace into a dev/qa/prod-style child environment, preview a diff, and promote changes bidirectionally. Credential and env-var remapping is required on every promote, so secrets never cross environments silently.',
      shortDescription: 'Fork, diff, and promote environments with mandatory credential remapping.',
      source: {
        url: 'https://docs.sim.ai/platform/enterprise/forks',
        label: 'Sim Docs: Workspace Forks',
        asOf: '2026-07-08',
      },
    },
    {
      title: 'Human-in-the-loop approvals with durable resume',
      description:
        'A dedicated block pauses a run and waits for a human-submitted approval form, backed by persisted execution snapshots so the run can resume later via a link, even after a server restart.',
      shortDescription:
        'Pause a run for human approval and resume later via a durable snapshot link.',
      source: {
        url: 'https://docs.sim.ai/blocks/human-in-the-loop',
        label: 'Sim Docs: Human in the Loop Block',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Self-hostable under Apache 2.0',
      description:
        'Fully open source (Apache 2.0), with Docker Compose files and a Helm chart for Kubernetes deployment, alongside a managed cloud-hosted option.',
      shortDescription: 'Fully open source with Docker Compose and Helm deployment options.',
      source: {
        url: 'https://docs.sim.ai/introduction',
        label: 'Sim Docs: Introduction (FAQ - Open Source License)',
        asOf: '2026-07-02',
      },
    },
    {
      title: 'Live multiplayer canvas editing',
      description:
        'Real-time cursors, selection broadcasting, and synced concurrent edits over a dedicated realtime backend, so a team can build the same workflow together at the same time.',
      shortDescription: 'Real-time cursors, selections, and synced edits on the same canvas.',
      source: {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/realtime/src/handlers/presence.ts',
        label: 'Sim codebase: realtime presence handler',
        asOf: '2026-07-04',
      },
    },
  ],
  limitations: [
    {
      title: 'Smaller integration catalog than the largest generalist automation platforms',
      description:
        "Sim ships 266 first-party blocks and roughly 3,900 underlying tool actions. Platforms like Zapier (9,000+ apps) or Pipedream (3,000+ apps) list larger raw app counts. Sim's MCP support lets teams add custom integrations beyond the built-in catalog.",
      shortDescription:
        "266 blocks and ~3,900 tool actions, versus Zapier and Pipedream's larger raw app counts.",
      source: {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/blocks/registry-maps.ts',
        label: 'Sim codebase: BLOCK_REGISTRY count',
        asOf: '2026-07-08',
      },
    },
    {
      title: 'One-year-old company',
      description:
        'Independent analysis (n8n\'s 2026 AI agent tools report) notes Sim.ai "has only been around for one year," newer to market than incumbents like Zapier, n8n, or Workato.',
      shortDescription: 'Newer to market than incumbents like Zapier, n8n, or Workato.',
      source: {
        url: 'https://n8n.io/reports/2026-ai-agent-development-tools/#vendors',
        label: 'n8n: 2026 AI Agent Development Tools report',
        asOf: '2026-07-02',
      },
    },
  ],
  facts: {
    platform: {
      builderType: {
        value: 'Visual drag-and-drop canvas, natural-language (Chat), or code (API/SDK)',
        shortValue: 'Visual canvas, chat, or code',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/introduction',
            label: 'Sim Docs: Introduction (visual, natural-language, and API/SDK building)',
            asOf: '2026-07-08',
          },
        ],
      },
      learningCurve: {
        value:
          'Low for visual building; natural-language Chat surface (with a workflow-scoped Copilot) for non-technical builders',
        detail:
          'Chat lets users describe a workflow in plain language and have Sim scaffold or edit it; the visual canvas requires no code to connect blocks.',
        shortValue: 'Low, plus natural-language Chat for non-technical users',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://docs.sim.ai/introduction',
            label: 'Sim Docs: Introduction (visual, natural-language, and API/SDK building)',
            asOf: '2026-07-08',
          },
        ],
      },
      selfHostOption: {
        value: 'Yes: Docker Compose or Kubernetes (Helm)',
        shortValue: 'Docker Compose or Kubernetes',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/self-hosting/docker',
            label: 'Sim Docs: Self-Hosting with Docker',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.sim.ai/self-hosting/kubernetes',
            label: 'Sim Docs: Kubernetes (Helm) self-hosting',
            asOf: '2026-07-02',
          },
        ],
      },
      deploymentOptions: {
        value:
          'Cloud-hosted (managed, multi-tenant SaaS) or self-hosted (Docker/Kubernetes). No documented managed single-tenant/VPC hosting tier in between',
        detail:
          'The Enterprise plan\'s only hosting-related row in the pricing comparison table is a boolean "Self Hosting" flag; there is no dedicated-instance/VPC offering.',
        shortValue: 'Cloud-hosted or self-hosted, no mid-tier VPC option',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/self-hosting',
            label: 'Sim Docs: Self-Hosting',
            asOf: '2026-07-08',
          },
          {
            url: 'https://www.sim.ai/pricing',
            label: 'Sim Pricing Page',
            asOf: '2026-07-02',
          },
        ],
      },
      templates: {
        value:
          'No: the pre-built workflow template gallery (landing and in-workspace) was removed platform-wide. Sim now surfaces per-integration starter prompts instead of a template library.',
        shortValue: 'No template gallery; per-integration starter prompts only',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim/commit/df5ad7d45f4fd38ab724e7726b083c2b928a1542',
            label: 'Sim codebase: templates gallery and APIs removed',
            asOf: '2026-07-08',
          },
        ],
      },
      license: {
        value: 'Apache License 2.0',
        shortValue: 'Apache 2.0',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/introduction',
            label: 'Sim Docs: Introduction (FAQ - Open Source License)',
            asOf: '2026-07-02',
          },
        ],
      },
      environmentPromotion: {
        value:
          'Yes: fork a whole workspace into a dev/qa/prod-style child, diff it, and promote or roll back changes in either direction. Credential and env-var remapping is required before every promote, so secrets are never silently copied across environments',
        detail:
          'Gated to Enterprise plan on hosted Sim, or a FORKING_ENABLED flag on self-hosted deployments.',
        shortValue: 'Fork, diff, and promote environments with forced credential remap',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/enterprise/forks',
            label: 'Sim Docs: Workspace Forks',
            asOf: '2026-07-08',
          },
        ],
      },
      versionControlDepth: {
        value:
          'Deployed-version history with rollback for every workflow; server-persisted checkpoint/revert and visual diff (accept/reject) specifically for Copilot AI edits',
        detail:
          'Manual drag-and-drop undo/redo is client-side/localStorage only (capped at 100 ops, 5 stacks), not server-synced across devices. Deployment history does not include an arbitrary version-to-version diff tool, and knowledge base documents have no version history.',
        shortValue: 'Deployment rollback plus Copilot edit diff/revert',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/lib/workflows/diff/diff-engine.ts',
            label: 'Sim codebase: WorkflowDiffEngine',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/packages/db/schema.ts',
            label: 'Sim codebase: workflowCheckpoints / workflow_deployment_version tables',
            asOf: '2026-07-02',
          },
        ],
      },
      realtimeCollaboration: {
        value:
          'Yes: live multiplayer editing of the same workflow canvas, with real-time cursors, selection broadcasting, and synced concurrent edits over a dedicated realtime backend',
        shortValue: 'Live multiplayer canvas: cursors, selections, synced edits',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/realtime/src/handlers/presence.ts',
            label: 'Sim codebase: realtime presence handler (cursor/selection broadcast)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/realtime/src/handlers/operations.ts',
            label: 'Sim codebase: realtime operations handler',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeFileStorage: {
        value:
          'Yes: a native Files area with folder hierarchy, link-based sharing (public, password, email OTP, or SSO auth), and a workspace-level Recently Deleted view covering workflows, tables, knowledge bases, files, and folders',
        detail:
          'Admins can restrict which share-auth modes (public/password/email/SSO) a permission group is allowed to use.',
        shortValue: 'Folders, password-protected sharing, deleted-item recovery',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/app/workspace/%5BworkspaceId%5D/files/components/share-modal/share-modal.tsx',
            label: 'Sim codebase: file share modal (password/email/SSO modes)',
            asOf: '2026-07-08',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/app/workspace/%5BworkspaceId%5D/settings/components/recently-deleted/recently-deleted.tsx',
            label: 'Sim codebase: Recently Deleted (files, folders, and other resources)',
            asOf: '2026-07-08',
          },
        ],
      },
      dataTables: {
        value:
          'Yes: a native spreadsheet-like Tables feature (typed columns, not an external DB connector) with full keyboard support (arrow keys, Tab, copy-paste bulk load, Cmd/Ctrl+Z undo) and atomic per-row writes from multiple workflows at once',
        detail:
          'No public fixed row-limit figure is documented (guidance says paginate reads past ~100k rows); a workflow can also be wired to run per row via a "workflow column."',
        shortValue: 'Spreadsheet-like tables with keyboard nav and undo',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/tables',
            label: 'Sim Docs: Tables',
            asOf: '2026-07-02',
          },
        ],
      },
      richTextEditor: {
        value:
          'Yes: markdown files opened in the Files viewer render in an inline WYSIWYG-style rich markdown editor, with inline @-mention links to other Sim resources',
        shortValue: 'Inline WYSIWYG markdown editor with @-mentions',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-editor.tsx',
            label: 'Sim codebase: rich markdown editor',
            asOf: '2026-07-02',
          },
        ],
      },
      subWorkflows: {
        value:
          "Yes: a Workflow block calls another saved workflow as a step, waits for it to finish, runs its latest deployed version, and maps parent variables into the child's input form",
        detail: 'Self-references are blocked to prevent infinite recursion.',
        shortValue: 'Workflow block calls a saved workflow as a reusable step',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/blocks/workflow',
            label: 'Sim Docs: Workflow block',
            asOf: '2026-07-02',
          },
        ],
      },
      customBlocks: {
        value:
          "Yes: a user with admin access on a workflow's workspace can publish its deployed version as a named, iconed custom block that appears in the block toolbar for the whole organization. Inputs are read live from the source workflow's Start block; the publisher picks which outputs to expose. The block always runs the source workflow's latest deployed version, and its internal steps and intermediate values are never exposed to consumers",
        detail:
          'Enterprise-gated on Sim Cloud; self-hosted deployments can opt in via a feature flag. Distinct from the Workflow (sub-workflow) block, which composes a workflow the same author controls, and from custom code/tool blocks, which run inline code rather than a full deployed workflow.',
        shortValue: 'Publish a deployed workflow as an org-wide reusable block',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/app/api/custom-blocks/route.ts',
            label: 'Sim codebase: custom-blocks publish API (admin gate)',
            asOf: '2026-07-08',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/blocks/custom/build-config.ts',
            label: 'Sim codebase: custom-block config builder',
            asOf: '2026-07-08',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/app/workspace/%5BworkspaceId%5D/settings/navigation.ts',
            label: 'Sim codebase: Custom blocks nav entry (Enterprise/self-hosted gating)',
            asOf: '2026-07-08',
          },
        ],
      },
    },
    aiCapabilities: {
      multiLlmSupport: {
        value:
          '21 provider integrations (OpenAI, Anthropic, Google/Gemini, Azure OpenAI, Azure Anthropic, Groq, Cerebras, Mistral, xAI, Bedrock, Vertex, Ollama, OpenRouter, and more), with OpenRouter, LiteLLM, vLLM, and Ollama resolving models dynamically at runtime rather than from a fixed list, so effective model reach extends well beyond the 21 named providers',
        detail: 'apps/sim/providers/models.ts defines 21 provider entries.',
        shortValue: '21 providers plus dynamic-resolution aggregators (OpenRouter, LiteLLM, etc.)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/providers/models.ts',
            label: 'Sim codebase: PROVIDER_DEFINITIONS',
            asOf: '2026-07-02',
          },
        ],
      },
      agentReasoningBlocks: {
        value:
          'Yes: dedicated agent, function-calling, RAG, code-execution, and evaluation blocks, not just data routing',
        shortValue: 'Dedicated agent, function-calling, RAG, code, eval blocks',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/blocks/registry-maps.ts',
            label: 'Sim codebase: block registry',
            asOf: '2026-07-02',
          },
        ],
      },
      naturalLanguageBuilding: {
        value:
          'Yes: Chat + in-editor AI Copilot can build and modify workflows from natural-language requests',
        shortValue: 'Chat and Copilot build/edit workflows from prompts',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/copilot',
            label: 'Sim Docs: Copilot',
            asOf: '2026-07-02',
          },
        ],
      },
      knowledgeBaseRag: {
        value:
          'Yes: hybrid vector (pgvector) plus full-text (tsvector) search knowledge base, 11 supported file formats (csv, doc, docx, html, json, md, pdf, pptx, txt, xlsx, yaml), configurable chunking, plus 51 connectors that continuously sync external sources (Google Drive, Confluence, Slack, Gmail, GitHub, HubSpot, Linear, Jira, and more) into the knowledge base rather than a one-shot upload',
        shortValue: 'Hybrid vector + full-text search, 11 file formats, 51 connectors',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim/blob/main/packages/db/schema.ts',
            label: 'Sim codebase: KB schema (pgvector + tsvector)',
            asOf: '2026-07-08',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/lib/file-parsers/index.ts',
            label: 'Sim codebase: file-parser registry (11 format families)',
            asOf: '2026-07-08',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/connectors/registry.ts',
            label: 'Sim codebase: connector registry (51 connectors)',
            asOf: '2026-07-08',
          },
        ],
      },
      mcpSupport: {
        value:
          'Yes: both MCP client (call external MCP servers) and MCP server (expose Sim workflows as MCP tools)',
        shortValue: 'Both MCP client and MCP server',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/mcp',
            label: 'Sim Docs: Using MCP Tools',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.sim.ai/workflows/deployment/mcp',
            label: 'Sim Docs: MCP Deployment',
            asOf: '2026-07-02',
          },
        ],
      },
      evaluationGuardrails: {
        value:
          'Evaluator block (LLM-judge scoring against user-defined named metrics) and Guardrails block (JSON validity, regex, RAG/hallucination scoring, PII detection/masking)',
        detail:
          'These are per-call scoring/validation primitives, not a batch golden-dataset eval-suite runner or A/B prompt-testing harness.',
        shortValue: 'LLM-judge Evaluator plus Guardrails validation block',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/blocks/evaluator',
            label: 'Sim Docs: Evaluator Block',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.sim.ai/blocks/guardrails',
            label: 'Sim Docs: Guardrails Block',
            asOf: '2026-07-02',
          },
        ],
      },
      humanInTheLoop: {
        value:
          'Yes: dedicated approval block that pauses a run and waits for a human-submitted "Resume Form," with durable pause/resume via persisted execution snapshots and notification hooks (e.g. Slack, email) carrying the resume link',
        shortValue: 'Approval block with durable pause/resume and notifications',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/blocks/human-in-the-loop',
            label: 'Sim Docs: Human in the Loop Block',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/executor/execution/snapshot.ts',
            label: 'Sim codebase: execution snapshot serializer',
            asOf: '2026-07-02',
          },
        ],
      },
      generativeMedia: {
        value:
          'Yes: dedicated image (3 provider families incl. OpenAI, Gemini, Fal.ai proxy), video (5 provider families incl. Runway, Veo, Luma, Hailuo, Fal.ai proxy), text-to-speech (7 providers), and speech-to-text (5 providers) blocks',
        shortValue: 'Image, video, text-to-speech, and speech-to-text blocks',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/blocks/blocks/image_generator.ts',
            label: 'Sim codebase: Image Generator V2',
            asOf: '2026-07-08',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/blocks/blocks/video_generator.ts',
            label: 'Sim codebase: Video Generator V3',
            asOf: '2026-07-08',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/blocks/blocks/tts.ts',
            label: 'Sim codebase: TTS block (7 providers)',
            asOf: '2026-07-08',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/blocks/blocks/stt.ts',
            label: 'Sim codebase: STT block (5 providers)',
            asOf: '2026-07-08',
          },
        ],
      },
      dynamicToolUse: {
        value:
          'No: an Agent block calls tools the workflow author explicitly added to it at build time, rather than browsing and picking from a broader pool (e.g. an entire MCP server catalog) at inference time',
        detail:
          'Runtime MCP "discovery" exists to resolve/refresh the schema of an already-configured tool. The model does not browse or choose from the server\'s full tool list.',
        shortValue: 'Tools pre-wired at build time; runtime discovery refreshes schemas',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/executor/handlers/agent/agent-handler.ts',
            label: 'Sim codebase: agent tool resolution (pre-wired only)',
            asOf: '2026-07-02',
          },
        ],
      },
      modelFallback: {
        value:
          "No: a failed or rate-limited LLM call is retried using Sim's own hosted API keys for the same model, rather than automatically switching to a different model or provider",
        detail:
          'A "fallback" comment in the provider layer refers to rotating among Sim\'s own hosted API keys for the same model, not switching models.',
        shortValue: 'Retries rotate hosted keys for the same model, not across providers',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/providers/index.ts',
            label: 'Sim codebase: executeProviderRequest (no retry/fallback)',
            asOf: '2026-07-02',
          },
        ],
      },
      agentSkills: {
        value:
          'Yes: named, reusable "Agent Skills" (built on the open Agent Skills / SKILL.md format) that agents load on demand via progressive disclosure, editable in-app or imported from a SKILL.md file or GitHub URL',
        detail:
          "Only the skill name and description sit in the agent's system prompt (~50-100 tokens each); the full instructions load into context only when the agent calls load_skill.",
        shortValue: 'Named, on-demand skills using the open SKILL.md format',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/skills',
            label: 'Sim Docs: Agent skills',
            asOf: '2026-07-02',
          },
        ],
      },
      nativeChatDeployment: {
        value:
          'Yes: a workflow can be deployed as a public, shareable Chat interface with selectable auth (public, password, email OTP, or SSO), in addition to API and MCP deployment targets',
        shortValue: 'Public Chat deployment with public/password/OTP/SSO auth',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/deployment/chat',
            label: 'Sim Docs: Chat Deployment',
            asOf: '2026-07-02',
          },
        ],
      },
      kbChunkVisibility: {
        value:
          'Yes: knowledge base search results and the document detail view expose individual chunk-level detail (chunk index and content), with a dedicated chunk editor, not only whole-document results',
        shortValue: 'Chunk-level search results and a dedicated chunk editor',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/knowledgebase/debugging-retrieval',
            label: 'Sim Docs: Debugging retrieval',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/app/workspace/[workspaceId]/knowledge/[id]/[documentId]/components/chunk-editor/chunk-editor.tsx',
            label: 'Sim codebase: chunk editor',
            asOf: '2026-07-02',
          },
        ],
      },
      parallelExecution: {
        value:
          'Yes: a native Parallel block fans a run out into concurrent branches (fixed count or one per list item) and joins their results back into the workflow automatically',
        detail:
          "Contained blocks run concurrently instead of sequentially, either a fixed number of times or once per item in a list/collection, and each branch's output aggregates for downstream blocks.",
        shortValue: 'Native Parallel block for concurrent branches',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/blocks/parallel',
            label: 'Sim Docs: Parallel block',
            asOf: '2026-07-02',
          },
        ],
      },
      a2aProtocol: {
        value:
          'Yes: a dedicated A2A block sends messages to, tracks and cancels tasks on, and discovers the capabilities of any Agent2Agent (A2A)-compliant external agent via its Agent Card',
        shortValue: 'Dedicated A2A block for agent-to-agent interop',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/integrations/a2a',
            label: 'Sim Docs: A2A integration',
            asOf: '2026-07-02',
          },
        ],
      },
      loopIteration: {
        value:
          'Yes: a Loop container block runs the blocks inside it repeatedly (For a fixed count, ForEach over a collection, While a condition holds, or Do-While), running iterations one after another; concurrent fan-out is a separate Parallel block',
        shortValue: 'Native Loop block: For, ForEach, While, Do-While',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/blocks/loop',
            label: 'Sim Docs: Loop block',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    integrations: {
      integrationCount: {
        value:
          '1,000+ integrations counting individual API actions, built from 266 first-party blocks and roughly 3,900 underlying tool actions',
        detail:
          'Sim\'s landing page cites the "1,000+ integrations" figure; the block/tool-action counts are the same integration surface measured at a different level of granularity.',
        shortValue: '1,000+ integrations (266 blocks, ~3,900 tool actions)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/blocks/registry-maps.ts',
            label: 'Sim codebase: BLOCK_REGISTRY',
            asOf: '2026-07-08',
          },
          {
            url: 'https://docs.sim.ai/tools',
            label: 'Sim Docs: Integrations / Tools Overview',
            asOf: '2026-07-02',
          },
          {
            url: 'https://sim.ai',
            label: 'Sim Landing Page',
            asOf: '2026-07-02',
          },
        ],
      },
      triggerTypes: {
        value:
          'Webhook, schedule/cron, chat, REST API, and event-based triggers for 61 apps (Slack, Gmail, GitHub, Stripe, etc.), plus a native row-level trigger on Sim Tables that fires on insert/update with an optional column watch-list and emits a before/after diff',
        shortValue:
          'Webhook, cron, chat, REST API, 61 app triggers, plus a diff-aware Tables trigger',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/triggers',
            label: 'Sim Docs: Triggers overview',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/triggers/table/poller.ts',
            label: 'Sim codebase: Table row trigger',
            asOf: '2026-07-04',
          },
        ],
      },
      customCodeSteps: {
        value: 'Yes: code-execution block for custom logic',
        shortValue: 'Code-execution block for custom logic',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/blocks/function',
            label: 'Sim Docs: Function block',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/blocks/registry-maps.ts',
            label: 'Sim codebase: block registry',
            asOf: '2026-07-02',
          },
        ],
      },
      apiPublishing: {
        value:
          'Yes: a public REST API (mostly under /api/, with /api/v1 reserved for logs and audit-log endpoints) supporting API-triggered workflow execution and deployment rollback',
        detail:
          'The API reference does not document SSE streaming, a resumable event buffer, a dedicated API-trigger block, or a chat-deployment surface as part of the REST API itself.',
        shortValue: 'REST API (partially versioned) with rollback support',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/api-reference/getting-started',
            label: 'Sim Docs: API Reference - Getting Started',
            asOf: '2026-07-08',
          },
          {
            url: 'https://docs.sim.ai/execution/api',
            label: 'Sim Docs: External API',
            asOf: '2026-07-08',
          },
        ],
      },
      extensibilitySdk: {
        value:
          'Official client SDKs exist for Python (simstudio-sdk, pip install simstudio-sdk) and TypeScript/JavaScript (simstudio-ts-sdk, npm install simstudio-ts-sdk), both wrapping the REST API (x-api-key header) with methods like execute_workflow / executeWorkflow, retry-with-backoff, and usage-limit lookups. Extensibility is further extended by MCP (client + server), a sandboxed code-execution block (JS/Python), custom tools, and an Agent-to-Agent (A2A) protocol block for external agent interop',
        shortValue: 'Official Python and TypeScript SDKs, plus MCP, code block, and A2A protocol',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/api-reference/python',
            label: 'Sim Docs: Python SDK',
            asOf: '2026-07-04',
          },
          {
            url: 'https://docs.sim.ai/api-reference/typescript',
            label: 'Sim Docs: TypeScript SDK',
            asOf: '2026-07-04',
          },
          {
            url: 'https://docs.sim.ai/mcp',
            label: 'Sim Docs: Using MCP Tools',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/blocks/blocks/a2a.ts',
            label: 'Sim codebase: A2A block',
            asOf: '2026-07-02',
          },
        ],
      },
      mcpPublishing: {
        value:
          'Yes: any deployed workflow can be published as a tool on an MCP server (private, API-key protected, or public/no-auth), with ready-to-paste client config generated for Cursor, Claude Code, Claude Desktop, and VS Code',
        shortValue: 'Deployed workflows publish as MCP server tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/deployment/mcp',
            label: 'Sim Docs: MCP Deployment',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    pricing: {
      pricingModel: {
        value:
          'Credit-based usage billing (Stripe), with bring-your-own-key exemption from metered caps',
        shortValue: 'Credit-based billing, BYOK exempt from caps',
        confidence: 'verified',
        sources: [
          {
            url: 'https://sim.ai/pricing',
            label: 'Sim Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      entryPaidPlan: {
        value: 'Pro: $25 per user/month',
        shortValue: 'Pro plan at $25/user/month',
        confidence: 'verified',
        sources: [
          {
            url: 'https://sim.ai/pricing',
            label: 'Sim Pricing',
            asOf: '2026-07-02',
          },
        ],
      },
      freeTier: {
        value:
          'Yes: Free plan with 1,000 monthly credits (worth $5, env-configurable), granted monthly with no daily refresh (daily refresh is a paid-plan feature)',
        shortValue: 'Free plan, 1,000 credits/month',
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.sim.ai/pricing',
            label: 'Sim Pricing',
            asOf: '2026-07-08',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/lib/billing/constants.ts',
            label: 'Sim codebase: DEFAULT_FREE_CREDITS',
            asOf: '2026-07-08',
          },
        ],
      },
      byok: {
        value:
          'Yes: bring-your-own-key support exempts usage from metered credit caps, and multiple keys stored for the same provider are automatically round-robin rotated, with automatic fallback past any key that fails to decrypt',
        shortValue: 'BYOK exempts credit caps; multi-key round-robin rotation',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/costs#bring-your-own-key-byok',
            label: 'Sim Docs: Bring Your Own Key (BYOK)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/lib/billing/calculations/usage-monitor.ts',
            label: 'Sim codebase: BYOK usage-monitor logic',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/lib/api-key/byok.ts',
            label: 'Sim codebase: BYOK key rotation',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    security: {
      soc2: {
        value: 'Yes: SOC2 compliant',
        shortValue: 'SOC2 compliant',
        confidence: 'verified',
        sources: [
          {
            url: 'https://sim.ai',
            label: 'Sim Landing Page',
            asOf: '2026-07-02',
          },
          {
            url: 'https://sim.ai/enterprise',
            label: 'Sim Enterprise Page',
            asOf: '2026-07-02',
          },
        ],
      },
      dataResidency: {
        value:
          'Full data control via self-hosting (Docker/Kubernetes); data never leaves customer infrastructure when self-hosted. On Sim Cloud, async job execution has an internal US/EU region toggle, but it is deployment-wide, not a customer-selectable per-workspace residency option',
        shortValue:
          'Full control via self-hosting; Cloud region toggle is global, not per-customer',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/self-hosting/docker',
            label: 'Sim Docs: Self-Hosting with Docker',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/lib/core/async-jobs/region.ts',
            label: 'Sim codebase: async job region resolution',
            asOf: '2026-07-02',
          },
        ],
      },
      rbac: {
        value:
          'Yes: admin/write/read workspace permissions, org-level admin/member roles, plus Enterprise-tier permission groups that allow/deny-list specific models, tools, and integrations per group on top of those base roles',
        detail:
          'See modelAndToolGovernance and credentialGovernance for the finer-grained permission-groups layer.',
        shortValue: 'Workspace/org roles, plus per-group model and tool allow/deny lists',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/permissions',
            label: 'Sim Docs: Roles and Permissions',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/packages/db/schema.ts',
            label: 'Sim codebase: permissionTypeEnum, role columns',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/lib/permission-groups/types.ts',
            label: 'Sim codebase: permission groups',
            asOf: '2026-07-04',
          },
        ],
      },
      auditLogging: {
        value:
          'Yes: dedicated audit_log table plus workflow execution logs, exposed via a public /v1/audit-logs API (Enterprise plan), plus continuous SIEM/warehouse export to Datadog, S3, GCS, Azure Blob, BigQuery, or Snowflake via a data-drains dispatcher',
        shortValue: 'Audit log API plus SIEM/warehouse export',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim/blob/main/packages/db/schema.ts',
            label: 'Sim codebase: auditLog table',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.sim.ai/platform/enterprise/data-drains',
            label: 'Sim Docs: Data Drains',
            asOf: '2026-07-02',
          },
        ],
      },
      additionalCompliance: {
        value: 'SOC2',
        detail:
          'Self-hosting is the primary lever Sim offers for data-residency-sensitive compliance needs beyond SOC2, rather than additional certifications.',
        shortValue: 'SOC2',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://sim.ai/enterprise',
            label: 'Sim Enterprise Page',
            asOf: '2026-07-02',
          },
        ],
      },
      modelAndToolGovernance: {
        value:
          'Yes: enterprise "permission groups" let an admin allow-list/deny-list specific LLM providers and models, and separately deny specific tools/integrations (or disable all MCP or custom tools) per group, layered on top of workspace admin/write/read roles',
        detail:
          'This does not control whether an LLM provider retains prompts. Sim offers no "zero data retention" mode or governed AI gateway. A separate, Enterprise-gated feature lets orgs set a log-retention window and redact PII, but that only controls how long Sim itself keeps execution logs.',
        shortValue: 'Admin allow/deny lists for models and tools',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/lib/permission-groups/types.ts',
            label:
              'Sim codebase: PermissionGroupConfig (allowedModelProviders, deniedModels, deniedTools)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.sim.ai/permissions/roles-and-permissions',
            label: 'Sim Docs: Roles and Permissions',
            asOf: '2026-07-02',
          },
        ],
      },
      credentialGovernance: {
        value:
          'Yes: shared credentials (connected accounts, service accounts, workspace secrets) are their own nested permission level (Member/Admin) below organization and workspace roles, and enterprise permission groups can further allow-list specific integrations and restrict which file-share auth modes (public/password/email/SSO) a group may use',
        detail:
          "A user's personal environment variables/secrets are never shared or inherited by anyone, including org owners/admins.",
        shortValue: 'Credentials are their own permission level, plus EE allow-lists',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/permissions/roles-and-permissions',
            label: 'Sim Docs: Roles and Permissions',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/lib/permission-groups/types.ts',
            label: 'Sim codebase: PermissionGroupConfig (allowedIntegrations)',
            asOf: '2026-07-02',
          },
        ],
      },
      whiteLabeling: {
        value:
          'Yes: Enterprise orgs can replace the logo, wordmark, brand name, and primary/accent theme colors across the workspace UI with their own',
        shortValue: 'Custom logo, name, and theme colors (Enterprise)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/enterprise/whitelabeling',
            label: 'Sim Docs: Whitelabeling',
            asOf: '2026-07-02',
          },
        ],
      },
      dataRetention: {
        value:
          'Yes: Enterprise orgs can independently configure log retention, soft-deletion cleanup, and Chat/Copilot task cleanup (chats, runs, checkpoints, Inbox tasks) at 1 day to 5 years or Forever, applied org-wide with no per-workspace override',
        shortValue: 'Configurable retention: 1 day to 5 years, or forever',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/enterprise/data-retention',
            label: 'Sim Docs: Data Retention',
            asOf: '2026-07-02',
          },
        ],
      },
      piiRedaction: {
        value:
          'Yes: a Guardrails workflow block detects and blocks or masks PII (30+ entity types across the US, UK, and several other countries) via Microsoft Presidio, in addition to the org-level data-retention PII policy applied to stored data',
        shortValue: 'PII detection/masking via Presidio (30+ entity types)',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/blocks/guardrails',
            label: 'Sim Docs: Guardrails Block',
            asOf: '2026-07-02',
          },
        ],
      },
      sso: {
        value:
          'Yes: SAML 2.0 and OIDC single sign-on, with users routed to SSO by their email domain and automatically provisioned into the organization on first sign-in',
        shortValue: 'SAML 2.0 and OIDC SSO with auto-provisioning',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/enterprise/sso',
            label: 'Sim Docs: Single Sign-On (SSO)',
            asOf: '2026-07-02',
          },
        ],
      },
      thirdPartyVetting: {
        value:
          "Yes: every one of Sim's 266 blocks is first-party authored and code-reviewed through the standard pull-request process in the main Sim repository; there is no public marketplace where an arbitrary third party can publish and have other users install executable tool code without going through Sim's own review",
        detail:
          "Custom code steps run inside Sim's own isolated-vm sandbox rather than as an installable third-party skill package, so the supply-chain trust boundary is Sim's codebase review, not an open registry.",
        shortValue: 'All 266 blocks are first-party authored and code-reviewed',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim/tree/main/apps/sim/blocks/blocks',
            label: 'Sim codebase: first-party block directory',
            asOf: '2026-07-08',
          },
        ],
      },
    },
    observability: {
      tracingDepth: {
        value:
          'Yes: execution logs include a per-block/per-span trace view (duration, cost, token counts, and latency stats like TTFT/TPS) with expandable nested iteration groups, plus a "View Snapshot" frozen copy of the workflow structure and block states at run time for debugging',
        detail:
          'This trace view is built directly into Sim rather than a raw export browsable in an external tool like Jaeger, and does not expose aggregate latency-percentile charts (p50/p95/p99). The run snapshot serves as a log-detail/debugging artifact rather than a resumable mid-run checkpoint.',
        shortValue: 'Per-block trace view: duration, cost, tokens, latency',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/lib/logs/execution/trace-spans/trace-spans.ts',
            label: 'Sim codebase: TraceSpan tree builder',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.sim.ai/execution/logging',
            label: 'Sim Docs: Logging',
            asOf: '2026-07-02',
          },
        ],
      },
      durabilityModel: {
        value:
          'Individual tool/API calls have configurable exponential-backoff retry (up to 10 attempts). The background job-orchestration layer itself retries only once by design. Durability instead comes from consecutive-failure tracking on schedules and the human-in-the-loop snapshot pause/resume mechanism',
        detail:
          'Sim does not offer guaranteed-once-only block execution, a failed-run holding queue for manual recovery, or a "replay a past execution with its original inputs" feature. The per-execution debugging snapshot serves as a log-detail artifact rather than a resumable mid-run checkpoint.',
        shortValue: 'Tool-call retries (up to 10x); single-attempt job orchestration',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/tools/index.ts',
            label: 'Sim codebase: ToolRetryConfig (exponential backoff)',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/trigger.config.ts',
            label: 'Sim codebase: retries.default.maxAttempts = 1',
            asOf: '2026-07-02',
          },
        ],
      },
      failureAlerting: {
        value:
          'Yes: a sim_workspace_event trigger fires on run success/failure, deployments, and cost/latency spikes, wired to any notification block (Slack, email, webhook) for real-time alerting',
        shortValue: 'Event-trigger alerting to Slack, email, or webhook',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/workflows/triggers/sim',
            label: 'Sim Docs: Sim Workspace Events trigger',
            asOf: '2026-07-02',
          },
        ],
      },
      dataDrains: {
        value:
          'Yes: Enterprise orgs can continuously export workflow logs, job logs, or audit logs on a schedule to a customer-owned S3 bucket, GCS bucket, Azure Blob container, BigQuery table, Snowflake table, Datadog logs intake, or an HTTPS webhook',
        detail:
          'Each drain exports exactly one data source; multiple drains are created to export multiple sources. Viewing drain config/run history is restricted to org owners/admins.',
        shortValue: 'Continuous log export to S3, BigQuery, Datadog, webhook, etc.',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/enterprise/data-drains',
            label: 'Sim Docs: Data Drains',
            asOf: '2026-07-02',
          },
        ],
      },
      asyncExecution: {
        value:
          'Yes: a workflow can be triggered in fire-and-forget async mode, returning HTTP 202 with a job ID immediately, then polled via a dedicated jobs endpoint through queued/processing/completed/failed states',
        detail:
          'Async jobs are tracked via polling the job endpoint rather than a completion webhook/callback option.',
        shortValue: 'Async mode: job ID returned immediately, poll for result',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/app/api/workflows/[id]/execute/route.ts',
            label: 'Sim codebase: async execution handler',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/app/api/jobs/[jobId]/route.ts',
            label: 'Sim codebase: async job status endpoint',
            asOf: '2026-07-02',
          },
        ],
      },
      executionLimits: {
        value:
          'Plan-gated: synchronous API calls time out at 5 minutes on the free plan and 50 minutes on paid plans, async calls at 90 minutes on every plan, with 10 to 1,000 concurrent executions per billing account depending on plan',
        detail:
          'Concurrency limits are published in the platform cost docs, and Enterprise limits are customizable. Request bodies are separately capped at 10 MB.',
        shortValue: '5-50 min sync timeout, 90 min async, 10-1,000 concurrent',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/platform/costs#concurrent-executions',
            label: 'Sim Docs: Concurrent Executions',
            asOf: '2026-07-13',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/lib/core/execution-limits/types.ts',
            label: 'Sim codebase: per-plan execution timeouts',
            asOf: '2026-07-02',
          },
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/lib/billing/calculations/usage-reservation.ts',
            label: 'Sim codebase: max concurrent executions per plan',
            asOf: '2026-07-13',
          },
        ],
      },
      partialFailureHandling: {
        value:
          'Yes: any block can be wired to a dedicated error-output edge, so a failing step routes execution down an error-handling branch instead of always halting the entire run',
        shortValue: 'Failed steps can route to an error-handling branch',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/executor/execution/edge-manager.ts',
            label: 'Sim codebase: error-output edge routing',
            asOf: '2026-07-02',
          },
        ],
      },
      unattendedExecution: {
        value:
          "Yes: scheduled, webhook, and chat-triggered runs execute as background jobs on trigger.dev workers, entirely on Sim's servers",
        detail:
          'No client device needs to be open, awake, or connected for a run to fire or complete; closing the browser tab or shutting down a laptop has no effect on a scheduled or triggered workflow.',
        shortValue: 'Runs server-side; no dependency on a client device staying open',
        confidence: 'verified',
        sources: [
          {
            url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/lib/core/async-jobs/backends/trigger-dev.ts',
            label: 'Sim codebase: trigger.dev background job backend',
            asOf: '2026-07-02',
          },
          {
            url: 'https://docs.sim.ai/triggers',
            label: 'Sim Docs: Triggers',
            asOf: '2026-07-02',
          },
        ],
      },
    },
    support: {
      supportChannels: {
        value:
          'Community (open source, GitHub) plus an unquantified "Dedicated Support" flag on the Enterprise plan',
        detail:
          'Enterprise and pricing pages do not include CSM, onboarding/enablement, or professional-services details beyond a plan-comparison-table "Dedicated Support" flag.',
        shortValue: "Community support plus Enterprise 'Dedicated Support'",
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.sim.ai/pricing',
            label: 'Sim Pricing Page',
            asOf: '2026-07-02',
          },
        ],
      },
      sla: {
        value:
          'Yes: the Enterprise plan includes a "Dedicated Support" feature per the pricing plan-comparison table; no SLA terminology, response-time, or uptime figures are published on the enterprise or pricing pages',
        shortValue: "Enterprise 'Dedicated Support' flag; no published SLA terms",
        confidence: 'verified',
        sources: [
          {
            url: 'https://www.sim.ai/pricing',
            label: 'Sim Pricing Page',
            asOf: '2026-07-08',
          },
        ],
      },
      community: {
        value: 'Over 100,000 builders use Sim',
        shortValue: '100,000+ builders',
        confidence: 'estimated',
        sources: [
          {
            url: 'https://sim.ai',
            label: 'Sim Landing Page',
            asOf: '2026-07-02',
          },
        ],
      },
      companyMaturity: {
        value:
          'Independent analysis (n8n\'s 2026 AI agent tools report) notes Sim.ai "has only been around for one year"',
        detail:
          'Newer to market than incumbents like Zapier, n8n, or Workato. The same report ranks Sim.ai second-highest on "Codability" (76%) among 14 vendors evaluated.',
        shortValue: 'About one year old per independent analysis',
        confidence: 'verified',
        sources: [
          {
            url: 'https://n8n.io/reports/2026-ai-agent-development-tools/#vendors',
            label: 'n8n: 2026 AI Agent Development Tools report',
            asOf: '2026-07-02',
          },
        ],
      },
      academy: {
        value:
          'Yes: Sim Academy is a dedicated structured-learning section of the docs site, separate from reference documentation and the API reference',
        shortValue: 'Sim Academy: dedicated structured-learning docs section',
        confidence: 'verified',
        sources: [
          {
            url: 'https://docs.sim.ai/academy',
            label: 'Sim Docs: Academy',
            asOf: '2026-07-02',
          },
        ],
      },
    },
  },
}
