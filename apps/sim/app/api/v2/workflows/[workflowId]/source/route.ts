import { SOURCE_REQUEST_MAX_BYTES } from '@sim/workflow-code/limits'
import {
  v2ApplyWorkflowSourceContract,
  v2GetWorkflowSourceContract,
} from '@/lib/api/contracts/v2/workflow-source'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { applyWorkflowSource } from '@/lib/workflows/application/apply-workflow-source'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { readWorkflowSource } from '@/lib/workflows/application/read-workflow-source'

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
  encodeLargeBody: true,
})

/**
 * POST /api/v2/workflows/[workflowId]/source — writes TypeScript source to the draft in one
 * all-or-nothing write. Error diagnostics (and a `base` read from another workflow) answer 400, a
 * stale fingerprint 409, a locked workflow 423; a dry run answers 200 with its diagnostics in the
 * body. Answers 403 while the `workflow-code` flag is off. Analytics are recorded by the use case.
 * Applies and dry runs draw on the source-write budget (`v2RateLimits.sourceWrite`), not the
 * generic one: each compiles and diffs a body of up to `SOURCE_REQUEST_MAX_BYTES`.
 */
export const POST = defineV2JsonRoute({
  contract: v2ApplyWorkflowSourceContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.applySource,
  rateLimit: v2RateLimits.sourceWrite,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowGraphAuthorization,
  parseOptions: { maxBodyBytes: SOURCE_REQUEST_MAX_BYTES },
  mapInput: ({ params, query, body }) => ({
    workflowId: params.workflowId,
    files: body.files,
    lock: body.lock,
    base: body.base,
    ...(body.provenance ? { provenance: body.provenance } : {}),
    ...(query.dryRun !== undefined ? { dryRun: query.dryRun } : {}),
    ...(query.allowDelete !== undefined ? { allowDelete: query.allowDelete } : {}),
  }),
  useCase: applyWorkflowSource,
  present: (result) => ({ data: result }),
})
