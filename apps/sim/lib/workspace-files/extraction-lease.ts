import { idempotencyKey } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { and, eq, sql } from 'drizzle-orm'
import { IdempotencyService } from '@/lib/core/idempotency/service'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbTransaction } from '@/lib/db/types'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'

const logger = createLogger('FileArchiveLease')
const leases = new IdempotencyService({
  namespace: 'file-archive',
  ttlSeconds: 6 * 60,
  forceStorage: 'database',
})

/** Cooperative work budget leaves time for compensation before the lease expires. */
export const FILE_EXTRACTION_BUDGET_MS = 180_000

interface FileExtractionLease {
  readonly key: string
  readonly token: string
}

/** Holds an exact, token-fenced database lease without memoizing any extraction result. */
export async function withFileExtractionLease<T>(
  owner: EditableFileOwner,
  fileId: string,
  action: (lease: FileExtractionLease) => Promise<T>
): Promise<T> {
  const claim = await leases.atomicallyClaim(
    'extract',
    `${owner.entityType}:${owner.entityId}:${fileId}`
  )
  if (!claim.claimed)
    throw new OrchestrationError('conflict', 'This archive is already being unzipped')
  if (!claim.claimToken) throw new Error('Archive extraction lease is missing its fencing token')
  try {
    return await action(Object.freeze({ key: claim.normalizedKey, token: claim.claimToken }))
  } finally {
    await leases
      .release(claim.normalizedKey, claim.storageMethod, claim.claimToken)
      .catch((error) => {
        logger.warn('Failed to release archive extraction lease', {
          owner,
          fileId,
          error: getErrorMessage(error),
        })
      })
  }
}

/** Serializes publication with claim replacement and refuses expired or superseded work. */
export async function requireFileExtractionLeaseInTx(
  tx: DbTransaction,
  lease: FileExtractionLease
) {
  const [claim] = await tx
    .select({ result: idempotencyKey.result })
    .from(idempotencyKey)
    .where(
      and(
        eq(idempotencyKey.key, lease.key),
        sql`${idempotencyKey.result}->>'claimToken' = ${lease.token}`
      )
    )
    .for('update')
    .limit(1)
  const result = claim?.result
  if (
    !isRecordLike(result) ||
    result.status !== 'in-progress' ||
    typeof result.inProgressExpiresAt !== 'number' ||
    result.inProgressExpiresAt <= Date.now()
  ) {
    throw new OrchestrationError('conflict', 'Archive extraction lease expired; retry')
  }
}
