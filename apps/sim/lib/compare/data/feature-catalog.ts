import type { SimFeature } from '@/lib/compare/data/types'

/**
 * Sim's full feature catalog, sourced directly from the codebase (file paths
 * as of the compare-pages-data worktree, checked 2026-07-02). This is a
 * superset of {@link ComparisonFacts}. A page builder can filter this list
 * by {@link SimFeature.category} or tag to assemble the subset relevant to
 * a specific "Sim vs X" page, without re-deriving facts each time.
 *
 * Absence is recorded as honestly as presence: entries tagged "not-found"
 * document a capability that was searched for and does not currently exist,
 * so a future page builder doesn't have to re-verify it.
 */
export const SIM_FEATURES: SimFeature[] = [
  // ---- deployment-api ----------------------------------------------------
  {
    id: 'deploy-versioned-rest-api',
    name: 'Deploy a workflow as a versioned REST API',
    category: 'deployment-api',
    tags: ['api', 'enterprise'],
    description:
      'Workflows deploy/undeploy via POST/DELETE on /api/v1/workflows/[id]/deploy. Each deploy creates an immutable, numbered entry in a workflow_deployment_version table (state snapshot, isActive flag); executions, webhooks, and schedules all pin to the exact deployed version that ran, so draft edits never affect live traffic until redeployed. Rollback to a prior version is a first-class action.',
    competitiveNote:
      'The draft/deployed split with per-version execution pinning is more explicit than a simple "publish" toggle. Live traffic is isolated from in-progress edits by construction, not by convention.',
    sources: [
      {
        url: 'https://docs.sim.ai/execution/api',
        label: 'Sim Docs: External API',
        asOf: '2026-07-02',
      },
      {
        url: 'https://github.com/simstudioai/sim/blob/main/packages/db/schema.ts',
        label: 'Sim codebase: workflow_deployment_version table',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'streaming-api-responses',
    name: 'Streaming API responses (SSE)',
    category: 'deployment-api',
    tags: ['api'],
    description:
      'Workflow execution can stream over Server-Sent Events by passing a stream body param or X-Stream-Response header, returning stream:chunk/stream:done events. A separate reconnect/replay endpoint lets a client resume a stream from a given event id, backed by an event buffer, capped at 55 minutes. Agent-block responses stream per-provider through a shared StreamingExecution wrapper.',
    competitiveNote:
      'Streaming plus a resumable/replayable event buffer is a level of durability beyond a plain SSE passthrough. A dropped client connection does not lose the run.',
    sources: [
      {
        url: 'https://docs.sim.ai/execution/api',
        label: 'Sim Docs: External API',
        asOf: '2026-07-02',
      },
      {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/app/api/workflows/[id]/executions/[executionId]/stream/route.ts',
        label: 'Sim codebase: stream reconnect/replay route',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'chat-deployment-surface',
    name: 'Deploy a workflow as an embeddable public chat',
    category: 'deployment-api',
    tags: ['api'],
    description:
      'A chat_trigger block plus /api/chat routes let a workflow be deployed as a public or gated (password/email/SSO) chat endpoint, addressable by a custom subdomain/identifier, independent of the REST API deployment.',
    sources: [
      {
        url: 'https://docs.sim.ai/workflows/deployment/chat',
        label: 'Sim Docs - Chat Deployment',
        asOf: '2026-07-02',
      },
      {
        url: 'https://docs.sim.ai/workflows/deployment/chat',
        label: 'Sim Docs - Chat Deployment',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'inbound-webhook-trigger',
    name: 'Generic inbound webhook trigger',
    category: 'deployment-api',
    tags: ['api'],
    description:
      'A generic_webhook trigger accepts any HTTP method with optional Bearer/header auth, payload-path-based idempotency (7-day dedup window), and configurable response mode/status/body. Usable without a pre-built app-specific integration.',
    sources: [
      {
        url: 'https://docs.sim.ai/triggers/webhook',
        label: 'Sim Docs: Webhook Trigger',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'api-key-auth-and-rate-limiting',
    name: 'API-key auth with plan-based rate limiting',
    category: 'deployment-api',
    tags: ['api', 'enterprise'],
    description:
      'The public v1 API authenticates via an x-api-key header (personal or workspace-scoped keys); workspace-scoped keys are restricted to their workspace, and personal keys can be disabled per-workspace. Rate limits are keyed by subscription plan and per-endpoint, with standard X-RateLimit-* headers and 429/Retry-After on exceed.',
    sources: [
      {
        url: 'https://docs.sim.ai/api-reference/authentication',
        label: 'Sim Docs: API Authentication',
        asOf: '2026-07-02',
      },
      {
        url: 'https://docs.sim.ai/execution/api',
        label: 'Sim Docs: External API (rate limits)',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'official-sdk',
    name: 'Official client SDK',
    category: 'deployment-api',
    tags: ['not-found'],
    description:
      'No official JS/Python (or other language) client SDK exists in the repo or as a published package. The public API is REST-only, consumed via a plain x-api-key header. This is recorded as an honest gap, not inferred.',
    sources: [],
  },

  // ---- human-in-the-loop --------------------------------------------------
  {
    id: 'human-in-the-loop-approval-block',
    name: 'Human-in-the-loop approval block',
    category: 'human-in-the-loop',
    tags: ['enterprise'],
    description:
      'A dedicated human_in_the_loop block pauses workflow execution and waits for a human to submit a "Resume Form," with configurable display data and notification tool calls (e.g. Slack, email) fired on pause. A separate wait block supports plain time-based pauses (in-process ≤5 min, or a persisted async pause ≤30 days) without requiring human input.',
    competitiveNote:
      'This is a first-class, deeply implemented capability, not a workaround built from generic wait/poll nodes.',
    sources: [
      {
        url: 'https://docs.sim.ai/blocks/human-in-the-loop',
        label: 'Sim Docs: Human in the Loop Block',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'durable-pause-resume-execution',
    name: 'Durable pause/resume via execution snapshots',
    category: 'human-in-the-loop',
    tags: ['enterprise'],
    description:
      'Paused runs persist their full execution state (ExecutionSnapshot) to the database, independent of any third-party durable-execution service. Resume happens via a public per-execution resume URL (API + UI), supporting sync, streaming, or async job-queue-dispatched resume; an approver opens a link (surfaced via the notification tool call) rather than needing product access.',
    sources: [
      {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/executor/execution/snapshot.ts',
        label: 'Sim codebase: execution snapshot serializer',
        asOf: '2026-07-02',
      },
      {
        url: 'https://docs.sim.ai/blocks/human-in-the-loop',
        label: 'Sim Docs - Human-in-the-Loop Block',
        asOf: '2026-07-02',
      },
    ],
  },

  // ---- enterprise-governance ----------------------------------------------
  {
    id: 'sso-saml-oidc',
    name: 'SSO (SAML and OIDC)',
    category: 'enterprise-governance',
    tags: ['enterprise', 'security'],
    description:
      "SSO is implemented via better-auth's sso plugin, supporting both SAML and OIDC configs per provider. Registration requires an Enterprise-plan org, org owner/admin role, and DNS-validated domain ownership (no cross-org domain squatting). Self-hostable via an SSO_ENABLED flag, independent of the hosted Enterprise-plan gate.",
    sources: [
      {
        url: 'https://docs.sim.ai/platform/enterprise/sso',
        label: 'Sim Docs: Single Sign-On (SSO)',
        asOf: '2026-07-02',
      },
      {
        url: 'https://docs.sim.ai/platform/enterprise/sso',
        label: 'Sim Docs - Single Sign-On (SSO)',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'scim-directory-sync',
    name: 'SCIM / automated directory sync',
    category: 'enterprise-governance',
    tags: ['not-found'],
    description:
      'No SCIM table, route, or plugin exists. User provisioning is invite-based only. There is no automated push-provisioning from an identity provider (e.g. Okta/Azure AD SCIM).',
    sources: [],
  },
  {
    id: 'org-admin-console',
    name: 'Org-level team management console',
    category: 'enterprise-governance',
    tags: ['enterprise'],
    description:
      'Org owner/admins manage seats, invite/remove members, transfer ownership, and view billing in a Team Management settings surface. Roles are binary (admin/member) at the team level. There is no granular custom-role RBAC beyond that.',
    sources: [
      {
        url: 'https://docs.sim.ai/permissions/roles-and-permissions',
        label: 'Sim Docs: Roles and Permissions',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'per-member-usage-limits',
    name: 'Org-pooled and per-member usage limits',
    category: 'enterprise-governance',
    tags: ['enterprise'],
    description:
      'Usage governance supports both an org-level pooled cap (organization.orgUsageLimit) and individual per-member overrides (organizationMemberUsageLimit, keyed by org+user, with an auditable setBy field recording which admin set the limit).',
    sources: [
      {
        url: 'https://github.com/simstudioai/sim/blob/main/packages/db/schema.ts',
        label: 'Sim codebase: orgUsageLimit / organizationMemberUsageLimit',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'audit-log-siem-export',
    name: 'Audit logging with SIEM/warehouse export',
    category: 'enterprise-governance',
    tags: ['enterprise', 'security'],
    description:
      'A customer-facing audit-logs API (org admin/owner + active Enterprise plan required) supports filtering by action/resource/actor/date range with cursor pagination. Beyond in-product viewing, a generic "data drains" dispatcher can continuously stream audit logs (and workflow logs) to Datadog, S3, GCS, Azure Blob, BigQuery, Snowflake, or a generic webhook, with encryption at rest.',
    competitiveNote:
      'Continuous SIEM/warehouse export across six destination types is materially deeper than a downloadable CSV export.',
    sources: [
      {
        url: 'https://docs.sim.ai/enterprise/audit-logs',
        label: 'Sim Docs: Audit Logs',
        asOf: '2026-07-02',
      },
      {
        url: 'https://docs.sim.ai/platform/enterprise/data-drains',
        label: 'Sim Docs: Data Drains',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'admin-api-self-hosted-gitops',
    name: 'Separate admin API for self-hosted GitOps',
    category: 'enterprise-governance',
    tags: ['enterprise', 'self-hosted'],
    description:
      'A distinct /api/v1/admin/** surface (organizations, users, workspaces, subscriptions, credits, audit logs, workflows, folders, access control) is authenticated by a static ADMIN_API_KEY header rather than a user session, explicitly documented for self-hosted GitOps/scripting rather than interactive use.',
    sources: [
      {
        url: 'https://docs.sim.ai/platform/enterprise',
        label: 'Sim Docs: Enterprise Admin API (x-admin-key)',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'environment-promotion',
    name: 'Dev/staging/prod environment promotion',
    category: 'enterprise-governance',
    tags: ['not-found'],
    description:
      'No customer-facing deployment-environment concept (separate staging/prod deploy targets) exists. What does exist is versioned deploy/rollback of a single workflow (see deploy-versioned-rest-api) and per-user/per-workspace encrypted environment variable stores, which are secret stores, not deployment stages.',
    sources: [],
  },

  // ---- knowledge-base-search -----------------------------------------------
  {
    id: 'kb-connector-live-sync',
    name: '51 knowledge-base source connectors with recurring sync',
    category: 'knowledge-base-search',
    tags: ['integrations'],
    description:
      'Knowledge bases can sync documents from 51 external source connectors (including Google Drive, Notion, Confluence, SharePoint, S3, Slack, Salesforce, HubSpot, Jira, GitHub, Zendesk, and more). Sync is interval-based and recurring, not one-time import, via a syncIntervalMinutes/nextSyncAt schedule (default daily) polled by a cron endpoint every 5 minutes, with a per-run sync log (docs added/updated/deleted/failed) and stale-lock recovery. Manual on-demand re-sync is also supported. No push/webhook-driven re-sync (e.g. Drive change notifications) was found. The mechanism is polling-based.',
    sources: [
      {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/connectors/registry.ts',
        label: 'Sim codebase: connector registry (51 connectors)',
        asOf: '2026-07-02',
      },
      {
        url: 'https://docs.sim.ai/knowledgebase/connectors',
        label: 'Sim Docs - Knowledge Base Connectors',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'kb-hybrid-search',
    name: 'Hybrid semantic + keyword knowledge-base search',
    category: 'knowledge-base-search',
    tags: [],
    description:
      'Knowledge base search combines pgvector embedding similarity with a generated tsvector full-text index; searching across knowledge bases with different embedding models is explicitly blocked to avoid meaningless cross-model comparisons.',
    sources: [
      {
        url: 'https://docs.sim.ai/tools/knowledge',
        label: 'Sim Docs - Knowledge Base Tool',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'global-product-search',
    name: 'Unified cross-entity global search',
    category: 'knowledge-base-search',
    tags: ['not-found'],
    description:
      'No single search spans workflows, execution logs, files, and knowledge bases together. What exists is a command-palette-style search modal scoped to blocks/tools/tool-operations/triggers/docs (for building workflows), plus separate page-local filters on Logs and Files.',
    sources: [],
  },

  // ---- data-tables ---------------------------------------------------------
  {
    id: 'tables-builtin-database',
    name: 'Tables: a built-in database module',
    category: 'data-tables',
    tags: ['data'],
    description:
      'Tables store rows as flexible JSONB documents against a per-table JSON column schema (not fixed per-user Postgres tables), with fractional ordering keys and a GIN(jsonb_path_ops) index for containment queries. A REST API (internal and public v1) covers rows, columns, CSV import/export, and bulk jobs; a Table workflow block supports query/insert/upsert/update/delete/get-row/get-schema operations, and tables can themselves trigger workflow runs on new rows.',
    competitiveNote:
      'Column types are simple (no spreadsheet-style formula/computed-column engine); "enrichment" is LLM-driven per-row/per-column-group enrichment, not formulas.',
    sources: [
      {
        url: 'https://github.com/simstudioai/sim/blob/main/packages/db/schema.ts',
        label: 'Sim codebase: userTableDefinitions/userTableRows',
        asOf: '2026-07-02',
      },
      {
        url: 'https://docs.sim.ai/integrations/table',
        label: 'Sim Docs: Table integration',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'tables-llm-enrichment',
    name: 'LLM-driven row/column enrichment',
    category: 'data-tables',
    tags: ['ai'],
    description:
      'Tables support per-row enrichment via LLM-backed "column groups". An enrichment run populates cells using an LLM given the row and column context, distinct from static spreadsheet formulas.',
    sources: [
      {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/lib/copilot/tools/server/enrichment/enrichment-run.ts',
        label: 'Sim codebase: table enrichment run',
        asOf: '2026-07-02',
      },
    ],
  },

  // ---- files -----------------------------------------------------------------
  {
    id: 'files-shared-team-store',
    name: 'Shared, workspace-scoped file store',
    category: 'files',
    tags: ['data'],
    description:
      'Files are stored in a genuinely shared, workspace-scoped store (not per-user), with nested folders and soft delete. A REST API (internal and public v1) covers upload/serve/manage. A File workflow block reads, writes, appends, fetches, compresses/decompresses, and manages sharing for files as workflow inputs or outputs.',
    sources: [
      {
        url: 'https://github.com/simstudioai/sim/blob/main/packages/db/schema.ts',
        label: 'Sim codebase: workspaceFile/workspaceFileFolder',
        asOf: '2026-07-02',
      },
      {
        url: 'https://docs.sim.ai/tools/file',
        label: 'Sim Docs: File Tool',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'files-rich-viewers',
    name: 'Rich in-app file viewers and editors',
    category: 'files',
    tags: [],
    description:
      'The Files module renders CSV, XLSX, PDF, DOCX, PPTX (sandboxed), images, Mermaid diagrams, and plain text/code inline, plus a dedicated rich WYSIWYG Markdown editor (not just a preview) for editing Markdown files in place.',
    sources: [
      {
        url: 'https://docs.sim.ai/files',
        label: 'Sim Docs: Files',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'copilot-virtual-filesystem',
    name: 'Copilot virtual filesystem (VFS)',
    category: 'files',
    tags: ['ai'],
    description:
      "A distinct in-memory virtual filesystem abstraction lets the Copilot agent browse workspace resources (workflows, tables, docs) as file-like paths/tools. It reads from the Files module and table data but is a separate concept from a user's actual file store.",
    sources: [
      {
        url: 'https://github.com/simstudioai/sim/tree/main/apps/sim/lib/copilot/vfs/',
        label: 'Sim codebase: copilot VFS',
        asOf: '2026-07-02',
      },
    ],
  },

  // ---- environments-enterprise (workspace forking / dev-qa-prod promote) ----
  {
    id: 'workspace-fork-promote',
    name: 'Fork a workspace and promote changes between environments',
    category: 'environments-enterprise',
    tags: ['enterprise', 'flagship'],
    description:
      'A whole workspace (not a single workflow) can be forked to create a dev/qa/prod-style child environment. Deployed workflows are cloned into the child (left undeployed there), with an optional copy of files, tables, knowledge bases, custom tools, skills, and MCP server configs. Changes can then be synced bidirectionally between the parent and child ("promote": push parent→child or pull child→parent), with a diff preview before applying and a stored snapshot enabling one-level rollback of each promote run.',
    competitiveNote:
      'This is a genuine git-like fork/diff/promote/rollback system scoped to an entire workspace, not a single-workflow versioning feature. Most workflow-automation competitors only version individual workflows, not whole environments with cross-environment resource remapping.',
    sources: [
      {
        url: 'https://github.com/simstudioai/sim/blob/main/packages/db/schema.ts',
        label: 'Sim codebase: workspaceForkResourceMap / workspaceForkPromoteRun tables',
        asOf: '2026-07-02',
      },
      {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/lib/workspaces/fork/promote/promote.ts',
        label: 'Sim codebase: fork promote engine',
        asOf: '2026-07-02',
      },
      {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/app/api/workspaces/[id]/fork/route.ts',
        label: 'Sim codebase: fork creation API',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'fork-credential-remapping',
    name: 'Per-environment credential and env-var remapping on promote',
    category: 'environments-enterprise',
    tags: ['enterprise', 'security', 'flagship'],
    description:
      "Forking never copies credentials. All credential references are cleared in the child workspace at creation time. Instead, an admin explicitly maps each source OAuth/service-account credential to the target workspace's own credential via a dedicated mapping UI/API before promoting; environment variables remap by name (including rewriting {{ENV_KEY}} references inside copied custom-tool code or MCP headers if renamed, e.g. SLACK_API_KEY → SLACK_API_KEY_TEST). Credential and env-var mappings are required. An unmapped one blocks the promote rather than silently syncing a secret across environments, while optional resources (knowledge bases, tables, files, MCP servers) clear gracefully if unmapped.",
    competitiveNote:
      'Treating credentials/env-vars as required-and-blocking on promote (rather than silently copying secrets) is a specific, auditable safety design for enterprise dev→qa→prod pipelines.',
    sources: [
      {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/lib/workspaces/fork/create-fork.ts',
        label: 'Sim codebase: fork creation (credentials cleared)',
        asOf: '2026-07-02',
      },
      {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/lib/workspaces/fork/remap/remap-references.ts',
        label: 'Sim codebase: required-kinds remap/block logic',
        asOf: '2026-07-02',
      },
      {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/app/api/workspaces/[id]/fork/mapping/route.ts',
        label: 'Sim codebase: fork credential mapping API',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'fork-enterprise-gating',
    name: 'Workspace forking gated to Enterprise plan (or self-hosted flag)',
    category: 'environments-enterprise',
    tags: ['enterprise'],
    description:
      'Forking/promotion is gated on the billed account having Enterprise-tier access on hosted Sim, mirroring the same access-gate pattern used for SSO. Self-hosted deployments can enable it independent of billing via a FORKING_ENABLED/NEXT_PUBLIC_FORKING_ENABLED environment flag.',
    sources: [
      {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/lib/workspaces/fork/lineage/authz.ts',
        label: 'Sim codebase: assertForkingEnabled / assertCanFork',
        asOf: '2026-07-02',
      },
    ],
  },

  // ---- version-control ------------------------------------------------------
  {
    id: 'copilot-checkpoint-revert',
    name: 'Server-persisted checkpoint/revert for AI-driven edits',
    category: 'version-control',
    tags: ['ai'],
    description:
      'Before and after each Copilot AI edit to a workflow, a full canvas-state snapshot is saved server-side (keyed by user/workflow/chat/message) and can be restored via a revert endpoint or browsed via a checkpoint list. This is real server-side point-in-time restore, but scoped to Copilot-driven sessions. Manual drag-and-drop edits are not autosaved server-side.',
    sources: [
      {
        url: 'https://github.com/simstudioai/sim/blob/main/packages/db/schema.ts',
        label: 'Sim codebase: workflowCheckpoints table',
        asOf: '2026-07-02',
      },
      {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/app/api/copilot/checkpoints/revert/route.ts',
        label: 'Sim codebase: checkpoint revert API',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'ai-edit-visual-diff',
    name: 'Visual diff with accept/reject for AI-proposed changes',
    category: 'version-control',
    tags: ['ai'],
    description:
      'A dedicated diff engine computes added/edited/deleted blocks and edges (plus field-level diffs) between the live workflow and a Copilot-proposed change, rendered with an accept/reject UI before the change is applied. This diff view is scoped to Copilot-proposed edits vs. the current baseline. There is no user-facing tool to diff two arbitrary past deployment versions against each other.',
    sources: [
      {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/lib/workflows/diff/diff-engine.ts',
        label: 'Sim codebase: WorkflowDiffEngine',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'manual-edit-history',
    name: 'Persisted history for manual (non-AI) canvas edits',
    category: 'version-control',
    tags: ['not-found'],
    description:
      'Undo/redo for manual drag-and-drop editing is client-side only (localStorage-persisted, capped at 100 ops / 5 stacks per browser). It is not synced across devices or recoverable server-side. There is no autosave history timeline or arbitrary-version diff/compare tool for manual edits, and no per-workflow git-like branch/merge model (only the workspace-level fork/promote system, cataloged separately). Knowledge base documents have no version/history tracking at all.',
    sources: [
      {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/stores/undo-redo/store.ts',
        label: 'Sim codebase: client-side undo/redo store',
        asOf: '2026-07-02',
      },
    ],
  },

  // ---- durability-observability ---------------------------------------------
  {
    id: 'otel-telemetry',
    name: 'OpenTelemetry-instrumented execution telemetry',
    category: 'durability-observability',
    tags: [],
    description:
      'Sim ships real OpenTelemetry instrumentation (NodeSDK, batched OTLP trace/metric export, sampling) covering generative-AI, copilot, and tool-execution spans. This is aimed at product/ops-level observability (togglable by the user, and disableable via NEXT_TELEMETRY_DISABLED) rather than a customer-facing per-execution trace-waterfall UI inside the product. Block-level execution timing is tracked via start/end timestamps on execution logs, not an exposed span tree.',
    sources: [
      {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/instrumentation-node.ts',
        label: 'Sim codebase: OTel NodeSDK setup',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'execution-stats-dashboard',
    name: 'Aggregate execution stats (success rate, avg duration)',
    category: 'durability-observability',
    tags: [],
    description:
      'A stats API buckets execution logs into time segments and returns total/successful/failed execution counts, average duration, and overall success rate per workflow and in aggregate. This covers averages and error-rate only. There is no p50/p95/p99 latency percentile view or a dedicated cost-over-time chart in this endpoint.',
    sources: [
      {
        url: 'https://docs.sim.ai/execution/logging',
        label: 'Sim Docs - Logging',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'workspace-event-trigger-for-alerting',
    name: 'Build custom failure/cost-spike alerting via a workspace-event trigger',
    category: 'durability-observability',
    tags: [],
    description:
      "There is no turnkey 'email me when a run fails' checkbox. Instead, a sim_workspace_event trigger fires on Sim's own platform events (run success/failure, deployments, cost/latency spikes), which a user can wire to any notification block (Slack, email, generic webhook, SMTP) to build custom alerting. The primitive exists, but it is build-it-yourself, not a pre-built alert rule UI.",
    sources: [
      {
        url: 'https://docs.sim.ai/workflows/triggers/sim',
        label: 'Sim Docs: Sim Workspace Events trigger',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'deliberate-no-auto-retry',
    name: 'Deliberate no-automatic-retry execution model',
    category: 'durability-observability',
    tags: [],
    description:
      "Background job retries are explicitly disabled at the infrastructure layer (maxAttempts: 1) by design; durability instead comes from app-level bookkeeping. Scheduled executions track consecutive infrastructure-failure counts and auto-disable a schedule after a threshold, distinguishing infra failures from business-logic failures. There is no automatic block-level retry loop, no idempotency-key-based exactly-once block execution, no dead-letter queue for failed runs, and no 'replay a past execution with its original inputs' feature. The only checkpoint/resume path is the human-in-the-loop pause/resume mechanism (cataloged separately).",
    sources: [
      {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/trigger.config.ts',
        label: 'Sim codebase: retries.default.maxAttempts = 1',
        asOf: '2026-07-02',
      },
      {
        url: 'https://docs.sim.ai/triggers/schedule',
        label: 'Sim Docs: Schedule Trigger (Automatic Disabling)',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'per-model-call-cost-attribution',
    name: 'Cost/token tracking per model-call event',
    category: 'durability-observability',
    tags: [],
    description:
      'Usage log rows carry execution/workflow/workspace IDs plus input/output token counts and tool cost, categorized as model/fixed/tool spend, giving cost attribution per model-call event within an execution. This approximates per-block cost for single-call agent blocks, but attribution below the model-call level (e.g. disambiguating multiple tool calls inside one agent block) is not confirmed as a distinct column.',
    sources: [
      {
        url: 'https://docs.sim.ai/execution/logging',
        label: 'Sim Docs: Logging',
        asOf: '2026-07-02',
      },
    ],
  },

  // ---- generative-media -------------------------------------------------------
  {
    id: 'image-generation-multi-provider',
    name: 'Image generation across 4 provider families',
    category: 'generative-media',
    tags: ['ai'],
    description:
      "A dedicated Image Generator block supports OpenAI (GPT Image 1.5/1/1 Mini, DALL-E 3), Google Gemini 'Nano Banana' image models, and (via a Fal.ai multi-model proxy) Nano Banana 2/Pro, Seedream 4.5, FLUX 2 Pro, and Grok Imagine Image. Stability AI, Midjourney, Ideogram, and Recraft are not integrated.",
    sources: [
      {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/blocks/blocks/image_generator.ts',
        label: 'Sim codebase: Image Generator V2 block',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'video-generation-multi-provider',
    name: 'Video generation across 5+ provider families',
    category: 'generative-media',
    tags: ['ai'],
    description:
      'A dedicated Video Generator block supports Runway Gen-4, Google Veo (3 / 3 Fast / 3.1 / 3.1 Fast), Luma Dream Machine (Ray 2), MiniMax Hailuo (2.3 / 02), and (via a Fal.ai multi-model proxy) Sora 2 / Sora 2 Pro, ByteDance Seedance 2.0, Kling (3.0 Pro/4K, O3 Pro/4K, 2.5/2.1 Turbo Pro), WAN 2.1/2.2, and LTX-family models. HeyGen and Pika are not integrated.',
    competitiveNote:
      'Depth here (5+ first-party providers plus a multi-model proxy spanning a dozen more video models) is unusually broad for a workflow-automation platform. This is typically the domain of dedicated media-gen tools, not general automation builders.',
    sources: [
      {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/blocks/blocks/video_generator.ts',
        label: 'Sim codebase: Video Generator V3 block',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'text-to-speech-multi-provider',
    name: 'Text-to-speech across 7 provider families',
    category: 'generative-media',
    tags: ['ai'],
    description:
      'A dedicated TTS block supports OpenAI TTS, Deepgram Aura, ElevenLabs, Cartesia Sonic, Google Cloud TTS, Azure TTS, and PlayHT. A separate dedicated ElevenLabs block additionally covers sound effects, speech-to-speech, and audio isolation.',
    sources: [
      {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/blocks/blocks/tts.ts',
        label: 'Sim codebase: TTS block',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'speech-to-text-multi-provider',
    name: 'Speech-to-text across 5 provider families',
    category: 'generative-media',
    tags: ['ai'],
    description:
      'A dedicated STT block supports OpenAI Whisper, Deepgram (Nova 3/2/Whisper Large), ElevenLabs Scribe, AssemblyAI, and Google Gemini transcription variants.',
    sources: [
      {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/blocks/blocks/stt.ts',
        label: 'Sim codebase: STT block',
        asOf: '2026-07-02',
      },
    ],
  },

  // ---- control-flow-execution ---------------------------------------------------
  {
    id: 'control-flow-primitives',
    name: 'Conditional branching, LLM-based routing, loops, and parallel execution',
    category: 'control-flow-execution',
    tags: [],
    description:
      'Beyond simple if/else (Condition block), a Router block lets an LLM semantically pick the next path among candidate downstream blocks rather than evaluating a boolean. Loop and Parallel are canvas subflow containers (not single blocks) supporting for-each/while-style iteration and concurrent fan-out branching, respectively.',
    sources: [
      {
        url: 'https://docs.sim.ai/workflows/blocks/router',
        label: 'Sim Docs: Router block',
        asOf: '2026-07-02',
      },
      {
        url: 'https://docs.sim.ai/blocks/loop',
        label: 'Sim Docs: Loop Block',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'nested-sub-workflow-invocation',
    name: 'Invoke another workflow as a step (nested sub-workflows)',
    category: 'control-flow-execution',
    tags: [],
    description:
      "A Workflow block lets one Sim workflow call another as a single step, passing an input variable exposed as the child's start input, enabling composable, reusable sub-workflows.",
    sources: [
      {
        url: 'https://docs.sim.ai/workflows/blocks/workflow',
        label: 'Sim Docs: Workflow (sub-workflow) block',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'sandboxed-code-execution',
    name: 'Sandboxed JavaScript and Python code execution',
    category: 'control-flow-execution',
    tags: [],
    description:
      'A Function block runs arbitrary code: import-free JavaScript executes in a fast local VM, while JavaScript with imports and all Python execute in a remote E2B sandbox using dedicated templates (including one with python-pptx/docx/openpyxl/reportlab preinstalled for document generation).',
    sources: [
      {
        url: 'https://docs.sim.ai/blocks/function',
        label: 'Sim Docs: Function Block',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'browser-automation-blocks',
    name: 'Browser automation and web scraping (multiple engines)',
    category: 'control-flow-execution',
    tags: [],
    description:
      'Dedicated blocks cover natural-language browser automation (Browser Use: navigate + act), structured or agentic web extraction (Stagehand), and full crawl/scrape/map/extract operations (Firecrawl), alongside additional named scraping/search integrations (Apify, Bright Data, Linkup, Jina).',
    sources: [
      {
        url: 'https://docs.sim.ai/tools/browser_use',
        label: 'Sim Docs: Browser Use Integration',
        asOf: '2026-07-02',
      },
      {
        url: 'https://docs.sim.ai/tools/firecrawl',
        label: 'Sim Docs: Firecrawl Integration',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'guardrails-and-evaluator-blocks',
    name: 'Guardrails and LLM-judge evaluator blocks',
    category: 'control-flow-execution',
    tags: [],
    description:
      'A Guardrails block covers JSON-validity checks, regex validation, RAG/hallucination scoring (0-10 with reasoning), and PII detection/masking. An Evaluator block scores content against user-defined named metrics via an LLM judge. These are per-call scoring/validation primitives. There is no batch golden-dataset eval-suite runner or A/B prompt-testing harness in the block library.',
    sources: [
      {
        url: 'https://docs.sim.ai/blocks/guardrails',
        label: 'Sim Docs: Guardrails Block',
        asOf: '2026-07-02',
      },
      {
        url: 'https://docs.sim.ai/blocks/evaluator',
        label: 'Sim Docs: Evaluator Block',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'memory-and-variable-blocks',
    name: 'Cross-turn memory and workflow-scoped variables',
    category: 'control-flow-execution',
    tags: [],
    description:
      'A Memory block stores/retrieves records keyed by conversation ID for injecting artificial memory into agent blocks (which also have native memory modes of their own). A Variables block provides a workflow-scoped variable store shared across Variables blocks within a single run (not persisted across separate runs). Third-party Mem0 and Zep memory-service integrations are also available as blocks.',
    sources: [
      {
        url: 'https://docs.sim.ai/integrations/memory',
        label: 'Sim Docs: Memory integration',
        asOf: '2026-07-02',
      },
      {
        url: 'https://docs.sim.ai/workflows/blocks/variables',
        label: 'Sim Docs: Variables block',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'agent-to-agent-interop',
    name: 'Agent-to-Agent (A2A) protocol client',
    category: 'control-flow-execution',
    tags: [],
    description:
      "An A2A block lets a Sim workflow act as a client to any Agent-to-Agent-protocol-compliant external agent: send a message, get/cancel a task, and fetch the remote agent's Agent Card. This is distinct from MCP (tool-calling protocol). A2A is agent-to-agent messaging.",
    sources: [
      {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/blocks/blocks/a2a.ts',
        label: 'Sim codebase: A2A block',
        asOf: '2026-07-02',
      },
    ],
  },

  // ---- enterprise-governance (permission groups, follow-up findings) --------
  {
    id: 'permission-group-model-and-tool-governance',
    name: 'Permission groups: per-role model and tool allow/deny lists',
    category: 'enterprise-governance',
    tags: ['enterprise', 'security'],
    description:
      'Beyond workspace-level admin/write/read roles, an Enterprise "permission group" config can allow-list or deny-list specific LLM providers/models a role may use, and separately deny specific tools/integrations (or disable all MCP or custom tools) for that role. E.g. allow Slack but deny Salesforce, or allow OpenAI but deny a specific Ollama model. Enforced server-side at execution time (agent, evaluator, and router blocks), not just in the UI.',
    sources: [
      {
        url: 'https://docs.sim.ai/permissions/roles-and-permissions',
        label: 'Sim Docs: Roles and Permissions',
        asOf: '2026-07-02',
      },
      {
        url: 'https://docs.sim.ai/permissions/roles-and-permissions',
        label: 'Sim Docs: Roles and Permissions',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'log-retention-window-and-pii-redaction',
    name: 'Configurable log-retention window with PII redaction',
    category: 'enterprise-governance',
    tags: ['enterprise', 'security'],
    description:
      'An Enterprise-gated feature lets an org configure how long execution logs are retained and enable Presidio-based redaction of PII from logged inputs/outputs. This is a log-retention/redaction policy, not a "zero data retention" mode for LLM providers. It does not affect whether a model provider itself retains prompts.',
    sources: [
      {
        url: 'https://docs.sim.ai/platform/enterprise',
        label: 'Sim Docs: Enterprise (Data Retention)',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'zero-data-retention-llm-mode',
    name: 'Zero-data-retention (ZDR) mode for LLM calls',
    category: 'enterprise-governance',
    tags: ['not-found'],
    description:
      'No "zero data retention" or "incognito" mode exists for how Sim itself handles LLM requests (i.e. no documented ZDR agreements with model providers, no request-level opt-out of provider-side retention). The only genuine ZDR references in the codebase describe a competitor\'s offering in this same comparison dataset.',
    sources: [],
  },
  {
    id: 'ai-gateway-proxy-routing',
    name: 'Governed AI request proxy/gateway',
    category: 'enterprise-governance',
    tags: ['not-found'],
    description:
      "Model calls go directly from the execution environment to each provider's API (after a permission-group pre-call gate), not through a dedicated policy-enforcing AI gateway/proxy layer.",
    sources: [],
  },
  {
    id: 'dynamic-agent-tool-discovery',
    name: 'Dynamic (browse-and-pick) tool use by agents',
    category: 'ai-capabilities',
    tags: ['not-found'],
    description:
      'An Agent block can only call tools the workflow author explicitly attached to it at build time. It cannot browse and choose from a broader pool (e.g. an MCP server\'s full tool catalog, or "every tool in the workspace") at inference time. Runtime MCP discovery exists but only refreshes the schema of an already-configured tool.',
    sources: [
      {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/executor/handlers/agent/agent-handler.ts',
        label: 'Sim codebase: agent tool resolution (pre-wired only)',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'automatic-model-fallback',
    name: 'Automatic LLM model/provider fallback',
    category: 'ai-capabilities',
    tags: ['not-found'],
    description:
      'A failed or rate-limited LLM call is not automatically retried against a different model or provider; the error is thrown rather than retried with a fallback model.',
    sources: [
      {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/providers/index.ts',
        label: 'Sim codebase: executeProviderRequest (no retry/fallback)',
        asOf: '2026-07-02',
      },
    ],
  },

  // ---- files (artifact generation, follow-up findings) -----------------------
  {
    id: 'copilot-document-artifact-generation',
    name: 'Copilot-generated document artifacts (decks, docs, spreadsheets)',
    category: 'files',
    tags: [],
    description:
      'Copilot has an internal document-compilation tool that runs Python (python-pptx/python-docx/openpyxl) or Node (pptxgenjs/docx) in a dedicated E2B sandbox to produce real .pptx/.docx/.xlsx binaries, content-addressed and served back to the user.',
    competitiveNote:
      'This capability is scoped to Copilot\'s own chat-assistant tool. It is not exposed as a configurable option in the workflow-builder Function block, so a workflow author cannot wire "generate a slide deck" into a reusable automation today, only ask Copilot for one interactively.',
    sources: [
      {
        url: 'https://github.com/simstudioai/sim/blob/main/apps/sim/lib/copilot/tools/server/files/doc-compile.ts',
        label: 'Sim codebase: Copilot doc-compile tool',
        asOf: '2026-07-02',
      },
    ],
  },
  {
    id: 'workflow-builder-artifact-generation',
    name: 'Workflow-author-facing artifact generation (decks/docs from a workflow step)',
    category: 'files',
    tags: ['not-found'],
    description:
      'The canvas Function/code block does not expose the pptx/docx/xlsx-capable sandbox template, and there is no first-class "artifact" object (with versioning) anywhere in the codebase. Generating a shareable, versioned document from an ordinary workflow step is not currently possible outside asking Copilot directly.',
    sources: [],
  },
  {
    id: 'native-end-user-forms',
    name: 'Native end-user input forms (non-chat trigger surface)',
    category: 'deployment-api',
    tags: ['not-found'],
    description:
      'There is no Sim-native "Forms" builder. A simple field-based input form a non-technical person fills out to trigger a workflow, distinct from the chat or API surfaces. Only third-party form integrations (Google Forms, Typeform, JSM forms) exist, which consume external form services rather than hosting a form within Sim.',
    sources: [],
  },
]
