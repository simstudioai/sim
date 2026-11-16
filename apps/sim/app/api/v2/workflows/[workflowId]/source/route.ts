import {
  v2ApplyWorkflowSourceContract,
  v2GetWorkflowSourceContract,
} from '@/lib/api/contracts/v2/workflow-source'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { captureServerEvent } from '@/lib/posthog/server'
import { sourceWriteActor, v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { applyWorkflowSource } from '@/lib/workflows/application/apply-workflow-source'
import { getWorkflowSource } from '@/lib/workflows/application/get-workflow-source'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { MAX_IMPORT_BODY_BYTES } from '@/lib/workflows/operations/import-workflow'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/workflows/[workflowId]/source — the draft as TypeScript source with its identity
 * lock and freshness fingerprint. Unaudited, like `GET .../state`, which it projects. Answers 403
 * while the `workflow-code` flag is off.
 *
 * `headSafe: false` because the first read that references a resource with no key allocates one
 * (`workspace_resource_binding`), so a `HEAD` probe must not run it.
 */
export const GET = defineV2JsonRoute({
  contract: v2GetWorkflowSourceContract,
  auth: v2ApiKeyAuth,
  headSafe: false,
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
  /**
   * Telemetry only, for writes that changed the draft. A personal key or OAuth token counts as
   * the user behind it (`cli` when the CLI submitted it), and a Copilot delegation as its subject
   * user with `source: 'copilot'`. Workspace API keys are denied at admission, so no actorless
   * write reaches here.
   */
  onSuccess: ({ principal, input, result }) => {
    if (!result.applied) return
    const actor = sourceWriteActor(principal, input.provenance?.client)
    if (!actor) return
    const { blocks, edges, variables } = result.diff
    captureServerEvent(
      actor.userId,
      'workflow_source_applied',
      {
        workflow_id: result.workflowId,
        workspace_id: result.workspaceId,
        source: actor.source,
        ok: true,
        ops:
          blocks.added.length +
          blocks.removed.length +
          blocks.renamed.length +
          blocks.modified.length +
          edges.added +
          edges.removed +
          variables.added.length +
          variables.removed.length +
          variables.modified.length,
      },
      { groups: { workspace: result.workspaceId } }
    )
  },
})
