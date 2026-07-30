import { idempotencyKey } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

interface TransactionalIdempotencyRecord<TResult> {
  status: 'in-progress' | 'completed'
  requestFingerprint: string
  result?: TResult
}

export class IdempotencyPayloadMismatchError extends Error {
  constructor() {
    super('This operation ID was already used with a different request')
    this.name = 'IdempotencyPayloadMismatchError'
  }
}

function readRecord<TResult>(value: unknown): TransactionalIdempotencyRecord<TResult> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.status !== 'in-progress' && record.status !== 'completed') return null
  if (typeof record.requestFingerprint !== 'string') return null
  return {
    status: record.status,
    requestFingerprint: record.requestFingerprint,
    ...('result' in record ? { result: record.result as TResult } : {}),
  }
}

/**
 * Claims an existing Postgres idempotency key and stores its result in the
 * caller's transaction. The claim, domain mutation, and completed result
 * therefore commit or roll back together.
 *
 * The caller must acquire its domain lock before invoking this helper. That
 * keeps lock ordering explicit and serializes independent operation IDs which
 * mutate the same aggregate.
 */
export async function executeTransactionallyIdempotent<TResult>(
  tx: DbOrTx,
  params: {
    namespace: string
    operationId: string
    requestFingerprint: string
    operation: () => Promise<TResult>
  }
): Promise<{ result: TResult; isFirstTime: boolean }> {
  const key = `${params.namespace}:${params.operationId}`
  const [claim] = await tx
    .insert(idempotencyKey)
    .values({
      key,
      result: {
        status: 'in-progress',
        requestFingerprint: params.requestFingerprint,
      } satisfies TransactionalIdempotencyRecord<TResult>,
      createdAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ key: idempotencyKey.key })

  if (!claim) {
    const [existing] = await tx
      .select({ result: idempotencyKey.result })
      .from(idempotencyKey)
      .where(eq(idempotencyKey.key, key))
      .for('update')
      .limit(1)
    const record = readRecord<TResult>(existing?.result)

    if (!record) {
      throw new Error('Existing idempotency result is invalid')
    }
    if (record.requestFingerprint !== params.requestFingerprint) {
      throw new IdempotencyPayloadMismatchError()
    }
    if (record.status !== 'completed' || !('result' in record)) {
      // An in-progress row cannot normally be observed: its insertion and
      // completion happen in one transaction. Treat a manually-created or
      // legacy partial row as unsafe instead of running the mutation twice.
      throw new Error('Existing idempotency operation has not completed')
    }

    return { result: record.result as TResult, isFirstTime: false }
  }

  const result = await params.operation()
  await tx
    .update(idempotencyKey)
    .set({
      result: {
        status: 'completed',
        requestFingerprint: params.requestFingerprint,
        result,
      } satisfies TransactionalIdempotencyRecord<TResult>,
    })
    .where(eq(idempotencyKey.key, key))

  return { result, isFirstTime: true }
}
