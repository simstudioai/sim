import { isUserCredentialPrincipal } from '@sim/auth/principal'
import {
  v2ApplyWorkflowSourceContract,
  v2GetWorkflowSourceContract,
} from '@/lib/api/contracts/v2/workflow-source'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { captureServerEvent } from '@/lib/posthog/server'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { applyWorkflowSource } from '@/lib/workflows/application/apply-workflow-source'
import { getWorkflowSource } from '@/lib/workflows/application/get-workflow-source'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { MAX_IMPORT_BODY_BYTES } from '@/lib/workflows/operations/import-workflow'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/workflows/[workflowId]/source — the draft as TypeScript source with its identity
 * lock and freshness fingerprint. Head-safe and unaudited, like `GET .../state`, which it
 * projects. Answers 403 while the `workflow-code` flag is off.
 */
export const GET = defineV2JsonRoute({
  contract: v2GetWorkflowSourceContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.readSource,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params, query }) => ({
    workflowId: params.workflowId,
    ...(query.annotateIds !== undefined ? { annotateIds: query.annotateIds } : {}),
    ...(query.functionCode ? { functionCode: query.functionCode } : {}),
  }),
  useCase: getWorkflowSource,
  present: (source) => ({ data: source }),
})

/**
 * POST /api/v2/workflows/[workflowId]/source — writes TypeScript source to the draft in one
 * all-or-nothing write. Error diagnostics answer 400, a stale fingerprint 409, a locked workflow
 * 423; a dry run answers 200 with its diagnostics in the body. Answers 403 while the
 * `workflow-code` flag is off.
 */
export const POST = defineV2JsonRoute({
  contract: v2ApplyWorkflowSourceContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.applySource,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowGraphAuthorization,
  parseOptions: { maxBodyBytes: MAX_IMPORT_BODY_BYTES },
  mapInput: ({ params, query, body }) => ({
    workflowId: params.workflowId,
    files: body.files,
    lock: body.lock,
    baseFingerprint: body.baseFingerprint,
    ...(body.lockBase ? { lockBase: body.lockBase } : {}),
    ...(body.layout ? { layout: body.layout } : {}),
    ...(body.provenance ? { provenance: body.provenance } : {}),
    ...(query.dryRun !== undefined ? { dryRun: query.dryRun } : {}),
  }),
  useCase: applyWorkflowSource,
  present: (result) => ({
    data: {
      workflowId: result.workflowId,
      workspaceId: result.workspaceId,
      dryRun: result.dryRun,
      applied: result.applied,
      diff: result.diff,
      diagnostics: result.diagnostics,
      newFingerprint: result.newFingerprint,
      files: result.files,
      lock: result.lock,
      lockBase: result.lockBase,
      mintedIds: result.mintedIds,
      warnings: result.warnings,
      needsRedeployment: result.needsRedeployment,
    },
  }),
  /** Telemetry only, for writes that changed the draft. */
  onSuccess: ({ principal, input, result }) => {
    if (!result.applied || !isUserCredentialPrincipal(principal)) return
    captureServerEvent(
      principal.userId,
      'workflow_source_applied',
      {
        workflow_id: result.workflowId,
        workspace_id: result.workspaceId,
        blocks_added: result.diff.blocks.added.length,
        blocks_removed: result.diff.blocks.removed.length,
        blocks_modified: result.diff.blocks.modified.length,
        client: input.provenance?.client ?? 'api',
      },
      { groups: { workspace: result.workspaceId } }
    )
  },
})
