/** @vitest-environment node */

import { describe, expect, it, vi } from 'vitest'
import {
  executeTransactionallyIdempotent,
  IdempotencyPayloadMismatchError,
} from '@/lib/core/idempotency/transaction'

function createTransaction(records = new Map<string, unknown>()) {
  return {
    records,
    tx: {
      insert: () => {
        let value: { key: string; result: unknown }
        const chain = {
          values(next: typeof value) {
            value = next
            return chain
          },
          onConflictDoNothing() {
            return chain
          },
          async returning() {
            if (records.has(value.key)) return []
            records.set(value.key, value.result)
            return [{ key: value.key }]
          },
        }
        return chain
      },
      select: () => {
        const chain = {
          from: () => chain,
          where: () => chain,
          for: () => chain,
          async limit() {
            const result = records.values().next().value
            return result === undefined ? [] : [{ result }]
          },
        }
        return chain
      },
      update: () => {
        let value: { result: unknown }
        return {
          set(next: typeof value) {
            value = next
            return {
              async where() {
                const key = records.keys().next().value
                if (key) records.set(key, value.result)
              },
            }
          },
        }
      },
    },
  }
}

describe('executeTransactionallyIdempotent', () => {
  it('stores the first result and returns it without repeating the operation', async () => {
    const { tx, records } = createTransaction()
    const operation = vi.fn(async () => ({ prepaidCredits: 12_000 }))
    const params = {
      namespace: 'admin-credit-grant',
      operationId: 'operation-1',
      requestFingerprint: '{"organizationId":"org-1","credits":10000,"reason":null}',
      operation,
    }

    const first = await executeTransactionallyIdempotent(tx as never, params)
    const replay = await executeTransactionallyIdempotent(tx as never, params)

    expect(first).toEqual({ result: { prepaidCredits: 12_000 }, isFirstTime: true })
    expect(replay).toEqual({ result: { prepaidCredits: 12_000 }, isFirstTime: false })
    expect(operation).toHaveBeenCalledTimes(1)
    expect(records.get('admin-credit-grant:operation-1')).toMatchObject({ status: 'completed' })
  })

  it('rejects reuse of an operation ID with a different request', async () => {
    const { tx } = createTransaction()
    await executeTransactionallyIdempotent(tx as never, {
      namespace: 'admin-credit-grant',
      operationId: 'operation-1',
      requestFingerprint: 'request-1',
      operation: async () => 'first result',
    })
    const conflictingOperation = vi.fn(async () => 'second result')

    await expect(
      executeTransactionallyIdempotent(tx as never, {
        namespace: 'admin-credit-grant',
        operationId: 'operation-1',
        requestFingerprint: 'request-2',
        operation: conflictingOperation,
      })
    ).rejects.toBeInstanceOf(IdempotencyPayloadMismatchError)
    expect(conflictingOperation).not.toHaveBeenCalled()
  })
})
