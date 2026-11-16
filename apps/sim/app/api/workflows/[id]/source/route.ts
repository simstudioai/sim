import { getWorkflowSourceContract } from '@/lib/api/contracts/workflow-source'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalWorkflowErrorPolicies } from '@/lib/workflows/api'
import { readWorkflowSource } from '@/lib/workflows/application/read-workflow-source'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/workflows/[id]/source — the draft as TypeScript source for the canvas Code tab. The
 * same use case as `GET /api/v2/workflows/{workflowId}/source`, under session auth.
 */
export const GET = defineInternalJsonRoute({
  contract: getWorkflowSourceContract,
  auth: internalSessionAuth,
  operation: readWorkflowSource.operation,
  rateLimit: internalRateLimits.user({
    bucketName: 'workflow-source-read',
    // Unlike the other canvas reads (a row fetch), each read canonicalizes and prints the whole
    // workflow and may bind resource keys. The Code tab refetches after every persisted edit, so
    // the budget allows a steady two reads a second.
    config: { maxTokens: 120, refillRate: 120, refillIntervalMs: 60_000 },
  }),
  errorPolicy: internalWorkflowErrorPolicies.concealWorkflowAuthorization,
  mapInput: ({ params, query }) => ({
    workflowId: params.id,
    ...(query.functionCode ? { functionCode: query.functionCode } : {}),
  }),
  useCase: readWorkflowSource,
  present: (source) => ({ data: source }),
})
