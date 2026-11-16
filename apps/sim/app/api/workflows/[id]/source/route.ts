import { getWorkflowSourceContract } from '@/lib/api/contracts/workflow-source'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalWorkflowErrorPolicies } from '@/lib/workflows/api'
import { getWorkflowSource } from '@/lib/workflows/application/get-workflow-source'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/workflows/[id]/source — the draft as TypeScript source for the canvas Code tab. The
 * same use case as `GET /api/v2/workflows/{workflowId}/source`, under session auth.
 */
export const GET = defineInternalJsonRoute({
  contract: getWorkflowSourceContract,
  auth: internalSessionAuth,
  operation: getWorkflowSource.operation,
  rateLimit: internalRateLimits.none({
    reason: 'A session read the Code tab refetches after edits, like GET /api/workflows/[id]',
  }),
  errorPolicy: internalWorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params, query }) => ({
    workflowId: params.id,
    ...(query.functionCode ? { functionCode: query.functionCode } : {}),
  }),
  useCase: getWorkflowSource,
  present: (source) => ({ data: source }),
})
