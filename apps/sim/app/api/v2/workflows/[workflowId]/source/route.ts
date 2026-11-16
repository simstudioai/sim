import {
  v2ApplyWorkflowSourceContract,
  v2GetWorkflowSourceContract,
} from '@/lib/api/contracts/v2/workflow-source'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { applyWorkflowSource } from '@/lib/workflows/application/apply-workflow-source'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { readWorkflowSource } from '@/lib/workflows/application/read-workflow-source'
import { MAX_IMPORT_BODY_BYTES } from '@/lib/workflows/operations/import-workflow'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/workflows/[workflowId]/source — the draft as TypeScript source with its identity
 * lock and freshness fingerprint. Unaudited, like `GET .../state`, which it projects. Answers 403
 * while the `workflow-code` flag is off.
 *
 * `headSafe: false` because the first read that references a resource with no key allocates one
 * (`workspace_resource_key`), so a `HEAD` probe must not run it.
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
    ...(query.functionCode ? { functionCode: query.functionCode } : {}),
  }),
  useCase: readWorkflowSource,
  present: (source) => ({ data: source }),
})

/**
 * POST /api/v2/workflows/[workflowId]/source — writes TypeScript source to the draft in one
 * all-or-nothing write. Error diagnostics (and a `base` read from another workflow) answer 400, a
 * stale fingerprint 409, a locked workflow 423; a dry run answers 200 with its diagnostics in the
 * body. Answers 403 while the `workflow-code` flag is off. Analytics are recorded by the use case.
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
    base: body.base,
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
      fingerprint: result.fingerprint,
      files: result.files,
      lock: result.lock,
      base: result.base,
      mintedIds: result.mintedIds,
      notes: result.notes,
      needsRedeployment: result.needsRedeployment,
    },
  }),
})
