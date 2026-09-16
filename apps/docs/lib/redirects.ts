import integrationNavigation from 'docs/content/integration-navigation.json'
import type { NextConfig } from 'next'

/** The shape Next expects back from `next.config.ts`'s `redirects()`. */
type DocsRedirect = Awaited<ReturnType<NonNullable<NextConfig['redirects']>>>[number]

/**
 * Every redirect the docs site serves, in match order — Next applies the first
 * matching rule.
 *
 * This lives outside `next.config.ts` so it can be read without evaluating that
 * module. `createMDX()` runs at import time and bundles `source.config.ts`
 * against `process.cwd()`, so importing the config from the root Vitest project
 * fails with `The entry point "source.config.ts" cannot be marked as external`.
 * `scripts/openapi/docs-redirects.test.ts` reads this array directly to keep the
 * `/api-reference/` rules honest against the specs.
 *
 * The whole table lives here rather than only the `/api-reference/` block: Next
 * applies the first matching rule, so splitting one ordered list across two
 * modules would make match order an emergent property of two files.
 */
export const DOCS_REDIRECTS: DocsRedirect[] = [
  ...Object.entries(integrationNavigation.redirects).map(([from, to]) => ({
    source: `/integrations/${from}`,
    destination: `/integrations/${to}`,
    permanent: true,
  })),
  {
    source: '/',
    destination: '/introduction',
    permanent: true,
  },
  { source: '/api-reference', destination: '/api-reference/getting-started', permanent: true },
  // building-agents/agents merged into the building-agents overview
  { source: '/building-agents/agents', destination: '/agents', permanent: true },
  // form deployment removed
  { source: '/deployment/form', destination: '/workflows/deployment', permanent: true },
  // copilot deprecated and removed
  { source: '/copilot', destination: '/chat', permanent: true },
  { source: '/copilot/:path*', destination: '/chat', permanent: true },
  // mothership/* renamed to chat/* — the surface is "Chat", the agent is "Sim"
  { source: '/mothership', destination: '/chat', permanent: true },
  { source: '/mothership/:path*', destination: '/chat/:path*', permanent: true },
  // connections/* and variables/* collapsed into single pages under workflows/
  { source: '/connections', destination: '/workflows/connections', permanent: true },
  { source: '/connections/:path*', destination: '/workflows/connections', permanent: true },
  { source: '/variables', destination: '/workflows/variables', permanent: true },
  { source: '/variables/:path*', destination: '/workflows/variables', permanent: true },
  // capabilities/* renamed to building-agents/*
  { source: '/capabilities', destination: '/agents', permanent: true },
  { source: '/capabilities/agents', destination: '/agents', permanent: true },
  {
    source: '/capabilities/choosing',
    destination: '/agents/choosing',
    permanent: true,
  },
  // execution/* was broken up; redirect old URLs to their new homes
  { source: '/execution', destination: '/workflows', permanent: true },
  { source: '/execution/index', destination: '/workflows', permanent: true },
  { source: '/execution/basics', destination: '/workflows/how-it-runs', permanent: true },
  { source: '/execution/files', destination: '/files/passing-files', permanent: true },
  { source: '/execution/logging', destination: '/logs-debugging/logging', permanent: true },
  { source: '/execution/costs', destination: '/platform/costs', permanent: true },
  { source: '/execution/api', destination: '/api-reference/getting-started', permanent: true },
  {
    source: '/execution/api-deployment',
    destination: '/workflows/deployment/api',
    permanent: true,
  },
  { source: '/execution/chat', destination: '/workflows/deployment/chat', permanent: true },
  // Points at the final page, not at `/deployment/form` — that is itself a
  // redirect source above, and Next does not chain rules internally.
  { source: '/execution/form', destination: '/workflows/deployment', permanent: true },
  {
    source: '/mcp/deploy-workflows',
    destination: '/workflows/deployment/mcp',
    permanent: true,
  },
  // building-agents section renamed to agents; mcp and skills folded into it
  { source: '/building-agents', destination: '/agents', permanent: true },
  { source: '/building-agents/:path*', destination: '/agents/:path*', permanent: true },
  { source: '/mcp', destination: '/agents/mcp', permanent: true },
  { source: '/skills', destination: '/agents/skills', permanent: true },
  // tools/ + triggers/<service> unified into per-service integrations/ pages.
  // Specific moves first (Next applies the first matching redirect):
  {
    source: '/tools/custom-tools',
    destination: '/agents/custom-tools',
    permanent: true,
  },
  // evernote integration page removed; without this the /tools/:slug rule below
  // would permanently redirect /tools/evernote into a 404.
  { source: '/tools/evernote', destination: '/integrations', permanent: true },
  { source: '/integrations/evernote', destination: '/integrations', permanent: true },
  { source: '/tools', destination: '/integrations', permanent: true },
  { source: '/tools/:slug', destination: '/integrations/:slug', permanent: true },
  // Old blocks/triggers index pages were folded into the workflows overview.
  // Native trigger pages (/triggers/start|schedule|webhook|rss|table) still exist.
  { source: '/blocks', destination: '/workflows#blocks', permanent: true },
  { source: '/triggers', destination: '/workflows#triggers', permanent: true },
  // Integration trigger pages: provider slug differs from the block type for a few.
  {
    source: '/triggers/jsm',
    destination: '/integrations/jira_service_management',
    permanent: true,
  },
  {
    source: '/triggers/google-calendar',
    destination: '/integrations/google_calendar',
    permanent: true,
  },
  {
    source: '/triggers/google-drive',
    destination: '/integrations/google_drive',
    permanent: true,
  },
  {
    source: '/triggers/google-sheets',
    destination: '/integrations/google_sheets',
    permanent: true,
  },
  {
    source: '/triggers/microsoft-teams',
    destination: '/integrations/microsoft_teams',
    permanent: true,
  },
  {
    source:
      '/triggers/:slug(airtable|ashby|attio|azure_devops|calcom|calendly|circleback|confluence|emailbison|fathom|fireflies|github|gmail|gong|google_forms|grain|greenhouse|hubspot|imap|intercom|jira|lemlist|linear|monday|notion|outlook|resend|salesforce|sendblue|servicenow|slack|stripe|telegram|twilio_voice|typeform|vercel|webflow|whatsapp|zoom)',
    destination: '/integrations/:slug',
    permanent: true,
  },
  // URL structure now mirrors the sidebar: sections own their pages.
  { source: '/blocks/:slug', destination: '/workflows/blocks/:slug', permanent: true },
  {
    source: '/triggers/:slug(start|schedule|webhook|rss|table|sim)',
    destination: '/workflows/triggers/:slug',
    permanent: true,
  },
  { source: '/deployment', destination: '/workflows/deployment', permanent: true },
  {
    source: '/deployment/:path*',
    destination: '/workflows/deployment/:path*',
    permanent: true,
  },
  { source: '/mailer', destination: '/chat/mailer', permanent: true },
  { source: '/credentials', destination: '/platform/credentials', permanent: true },
  {
    source: '/credentials/:path*',
    destination: '/platform/credentials',
    permanent: true,
  },
  { source: '/permissions', destination: '/platform/permissions', permanent: true },
  {
    source: '/permissions/:path*',
    destination: '/platform/permissions',
    permanent: true,
  },
  { source: '/workspaces/fundamentals', destination: '/platform/workspaces', permanent: true },
  {
    source: '/workspaces/:slug(organization|permissions|credentials)',
    destination: '/platform/:slug',
    permanent: true,
  },
  { source: '/costs', destination: '/platform/costs', permanent: true },
  { source: '/self-hosting', destination: '/platform/self-hosting', permanent: true },
  {
    source: '/self-hosting/:path*',
    destination: '/platform/self-hosting/:path*',
    permanent: true,
  },
  { source: '/enterprise', destination: '/platform/enterprise', permanent: true },
  {
    source: '/enterprise/:path*',
    destination: '/platform/enterprise/:path*',
    permanent: true,
  },

  /**
   * Continuity for the `/api-reference/` operation pages retired when the docs
   * moved from the single v1 `openapi.json` to the seven code-first v2 specs.
   *
   * Every source below was a live, sitemap-submitted page whose slug no longer
   * exists in the generated set. `scripts/openapi/docs-redirects.test.ts`
   * documents and implements the slug derivation.
   *
   * `permanent: true` (308) is reserved for a true 1:1 successor: same operation,
   * renamed. A 308 is cached indefinitely and is effectively unrecallable, so
   * anything that collapses two pages into one, changes the identifier model, or
   * lands on a merely adjacent operation uses `permanent: false` (307).
   *
   * `scripts/openapi/docs-redirects.test.ts` pins both halves of the invariant
   * against the specs: no source may shadow a live slug, and every destination
   * must resolve.
   */
  // Pure operationId renames — same path and method, v1 -> v2.
  {
    // `/rows/find` became `/rows/search`: same operation, renamed once the
    // surface settled on `query` for a structured predicate and `search` for
    // text.
    source: '/api-reference/tables/findTableRows',
    destination: '/api-reference/tables/searchTableRows',
    permanent: true,
  },
  {
    // `/columns/run` became `POST /tables/{tableId}/dispatches`: it always
    // created a dispatch and was polled as one, and `GET .../dispatches`
    // already sat at the path it now posts to.
    //
    // These two are the only operations that pass retired a *published* slug —
    // confirmed by diffing operationIds in the committed specs, not by reading
    // the diff, because a path can move while its operationId (and therefore
    // its docs slug) stays put, and an operationId can change without the path
    // moving. Everything else renamed alongside them was added and removed
    // within the same unreleased branch.
    source: '/api-reference/tables/runTableColumns',
    destination: '/api-reference/tables/createTableDispatch',
    permanent: true,
  },
  {
    source: '/api-reference/audit-logs/getAuditLogDetails',
    destination: '/api-reference/audit-logs/getAuditLog',
    permanent: true,
  },
  {
    source: '/api-reference/knowledge-bases/listDocuments',
    destination: '/api-reference/knowledge-bases/listKnowledgeDocuments',
    permanent: true,
  },
  {
    source: '/api-reference/knowledge-bases/getDocument',
    destination: '/api-reference/knowledge-bases/getKnowledgeDocument',
    permanent: true,
  },
  {
    source: '/api-reference/knowledge-bases/deleteDocument',
    destination: '/api-reference/knowledge-bases/deleteKnowledgeDocument',
    permanent: true,
  },
  {
    source: '/api-reference/knowledge-bases/uploadDocument',
    destination: '/api-reference/knowledge-bases/uploadKnowledgeDocument',
    permanent: true,
  },
  {
    source: '/api-reference/knowledge-bases/searchKnowledgeBase',
    destination: '/api-reference/knowledge-bases/searchKnowledge',
    permanent: true,
  },
  {
    source: '/api-reference/logs/queryLogs',
    destination: '/api-reference/logs/listLogs',
    permanent: true,
  },
  {
    source: '/api-reference/tables/listRows',
    destination: '/api-reference/tables/listTableRows',
    permanent: true,
  },
  {
    source: '/api-reference/tables/getRow',
    destination: '/api-reference/tables/getTableRow',
    permanent: true,
  },
  {
    source: '/api-reference/tables/insertRows',
    destination: '/api-reference/tables/createTableRows',
    permanent: true,
  },
  {
    source: '/api-reference/tables/updateRow',
    destination: '/api-reference/tables/updateTableRow',
    permanent: true,
  },
  // v1 `PUT /rows` and v2 `PATCH /rows` are both the filter-predicate bulk update.
  {
    source: '/api-reference/tables/updateRows',
    destination: '/api-reference/tables/updateTableRows',
    permanent: true,
  },
  {
    source: '/api-reference/tables/deleteRow',
    destination: '/api-reference/tables/deleteTableRow',
    permanent: true,
  },
  {
    source: '/api-reference/tables/deleteRows',
    destination: '/api-reference/tables/deleteTableRows',
    permanent: true,
  },
  {
    source: '/api-reference/tables/upsertRow',
    destination: '/api-reference/tables/upsertTableRow',
    permanent: true,
  },
  {
    source: '/api-reference/tables/addColumn',
    destination: '/api-reference/tables/addTableColumn',
    permanent: true,
  },
  {
    source: '/api-reference/tables/updateColumn',
    destination: '/api-reference/tables/updateTableColumn',
    permanent: true,
  },
  {
    source: '/api-reference/tables/deleteColumn',
    destination: '/api-reference/tables/deleteTableColumn',
    permanent: true,
  },
  {
    source: '/api-reference/workflows/executeWorkflow',
    destination: '/api-reference/workflows/executeWorkflowV2',
    permanent: true,
  },
  {
    source: '/api-reference/workflows/getWorkflowExecution',
    destination: '/api-reference/workflow-runs/getWorkflowRunV2',
    permanent: true,
  },
  {
    source: '/api-reference/workflows/cancelExecution',
    destination: '/api-reference/workflow-runs/cancelRunV2',
    permanent: true,
  },
  // Approximations — 307 so a better destination stays reachable later.
  // v1 took multipart up to 100MB; v2 `createFile` takes inline UTF-8/base64
  // and defers larger payloads to an upload session.
  {
    source: '/api-reference/files/uploadFile',
    destination: '/api-reference/files/createFile',
    permanent: false,
  },
  // The human-in-the-loop tag is retired: pause state is now a field on the
  // run resource rather than its own endpoint family.
  {
    source: '/api-reference/human-in-the-loop/listPausedExecutions',
    destination: '/api-reference/workflow-runs/listWorkflowRunsV2',
    permanent: false,
  },
  {
    source: '/api-reference/human-in-the-loop/getPausedExecution',
    destination: '/api-reference/workflow-runs/getWorkflowRunV2',
    permanent: false,
  },
  {
    source: '/api-reference/human-in-the-loop/getPausedExecutionByResumePath',
    destination: '/api-reference/workflow-runs/getWorkflowRunV2',
    permanent: false,
  },
  {
    source: '/api-reference/human-in-the-loop/getPauseContext',
    destination: '/api-reference/workflow-runs/getWorkflowRunV2',
    permanent: false,
  },
  {
    source: '/api-reference/human-in-the-loop/resumeExecution',
    destination: '/api-reference/workflow-runs/resumeWorkflowRunV2',
    permanent: false,
  },
  // Two v1 identifiers (log id, execution id) collapse onto one v2 runId.
  {
    source: '/api-reference/logs/getLogDetails',
    destination: '/api-reference/logs/getLog',
    permanent: false,
  },
  {
    source: '/api-reference/logs/getExecutionDetails',
    destination: '/api-reference/logs/getLog',
    permanent: false,
  },
  // v1 updated a batch of rows by id; v2 has no by-id batch, only the predicate form.
  {
    source: '/api-reference/tables/batchUpdateRows',
    destination: '/api-reference/tables/updateTableRows',
    permanent: false,
  },
  // v1 reported rate limits alongside spend and storage; v2 billing status
  // carries plan, credit allowance, and storage quota but not rate limits.
  {
    source: '/api-reference/usage/getUsageLimits',
    destination: '/api-reference/billing/getBillingStatus',
    permanent: false,
  },
  // v1 polled a jobId; the v2 queue receipt returns a `statusUrl` pointing at
  // this run endpoint, which is the successor poll target.
  {
    source: '/api-reference/workflows/getJobStatus',
    destination: '/api-reference/workflow-runs/getWorkflowRunV2',
    permanent: false,
  },
]
