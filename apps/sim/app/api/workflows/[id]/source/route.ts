import { sha256Hex } from '@sim/security/hash'
import { getWorkflowSourceContract } from '@/lib/api/contracts/workflow-source'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import type { TokenBucketConfig } from '@/lib/core/rate-limiter'
import {
  internalWorkflowErrorPolicies,
  withBoundSourceFindings,
  withSourceSlot,
} from '@/lib/workflows/api'
import { readWorkflowSource } from '@/lib/workflows/application/read-workflow-source'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Unlike the other canvas reads (a row fetch), each read canonicalizes and prints the whole
 * workflow and may bind resource keys. The Code tab refetches after every persisted edit, so the
 * budget allows a steady two reads a second.
 */
const SOURCE_READ_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 120,
  refillRate: 120,
  refillIntervalMs: 60_000,
}

/**
 * GET /api/workflows/[id]/source — the draft as TypeScript source for the canvas Code tab. The
 * same use case as `GET /api/v2/workflows/{workflowId}/source`, under session auth.
 *
 * Answers with an `ETag` that digests the printed source (its `sf1:` fingerprint, files, lock,
 * catalog hash and findings), so the Code tab's refetch of an unchanged draft is a bodiless `304`.
 * The bare fingerprint would not do: it ignores what it does not hash (canvas positions,
 * comments), which the printed files and lock can still carry.
 *
 * Runs in a source slot of the editor's own lane, so API and CLI gets never starve the Code tab
 * (`429` with `Retry-After` when the server already runs as many Code tab reads as it may).
 * The tag is taken after the read: the printed resource keys are known only once the graph is
 * canonicalized, so no earlier tag would be sound.
 *
 * `headSafe: false` because the first read that references a resource with no key allocates one
 * (`workspace_resource_key`), so a `HEAD` probe must not run it.
 */
export const GET = defineInternalJsonRoute({
  contract: getWorkflowSourceContract,
  auth: internalSessionAuth,
  headSafe: false,
  operation: readWorkflowSource.operation,
  rateLimit: internalRateLimits.user({
    bucketName: 'workflow-source-read',
    config: SOURCE_READ_RATE_LIMIT,
  }),
  errorPolicy: internalWorkflowErrorPolicies.concealWorkflowSourceRead,
  mapInput: ({ params, query }) => ({
    workflowId: params.id,
    ...(query.functionCode ? { functionCode: query.functionCode } : {}),
  }),
  useCase: withSourceSlot(readWorkflowSource, 'editor'),
  entityTag: (source) => `${source.base.fingerprint}.${sha256Hex(JSON.stringify(source))}`,
  present: (source) => ({ data: withBoundSourceFindings(source) }),
})
