/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => mockLogger,
}))

import type { DbTransaction } from '@/lib/db/types'
import {
  readBoundMemorySecretProvenance,
  replaceMemorySecretProvenanceInTx,
} from '@/lib/memory/secret-provenance'

interface TxStub {
  tx: DbTransaction
  inserted: Record<string, unknown>[]
}

function createTxStub(): TxStub {
  const inserted: Record<string, unknown>[] = []
  const tx = {
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        inserted.push(value)
        return { onConflictDoUpdate: async () => undefined }
      },
    }),
    update: () => ({
      set: () => ({
        where: () => ({ returning: async () => [{ id: 'memory-1' }] }),
      }),
    }),
  }
  return { tx: tx as unknown as DbTransaction, inserted }
}

describe('memory secret provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('treats a marker-null row as legacy even when an old sidecar remains', () => {
    expect(
      readBoundMemorySecretProvenance({
        secretProvenanceVersion: null,
        data: { value: 'changed-by-old-app' },
        provenanceContentHash: 'stale',
        status: 'exact',
        entries: [{ name: 'SECRET', encryptedValue: 'encrypted' }],
      })
    ).toEqual({ status: 'exact', entries: [] })
  })

  it('binds exact provenance silently when nothing degrades', async () => {
    const { tx, inserted } = createTxStub()

    await replaceMemorySecretProvenanceInTx(tx, 'memory-1', [{ role: 'user', content: 'hello' }], {
      status: 'exact',
      entries: [{ name: 'SECRET', encryptedValue: 'encrypted' }],
    })

    expect(inserted[0]).toMatchObject({ status: 'exact' })
    expect(mockLogger.error).not.toHaveBeenCalled()
  })

  /**
   * The one degrade decided in this function: exact provenance arrived and the binding could not
   * hold it. Every later read proceeds unvouched, so the cause must be on record at write time.
   */
  it('logs the cause when exact provenance degrades because the record cannot be hashed', async () => {
    const { tx, inserted } = createTxStub()

    await replaceMemorySecretProvenanceInTx(
      tx,
      'memory-1',
      { unhashable: () => undefined },
      {
        status: 'exact',
        entries: [{ name: 'SECRET', encryptedValue: 'encrypted' }],
      }
    )

    expect(inserted[0]).toMatchObject({ status: 'unknown', contentHash: 'unavailable' })
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Memory write staged unrecorded secret provenance',
      { surface: 'memory', cause: 'hash-unavailable', memoryId: 'memory-1' }
    )
  })

  it('logs the cause when exact entries cannot be normalized', async () => {
    const { tx, inserted } = createTxStub()

    await replaceMemorySecretProvenanceInTx(tx, 'memory-1', [{ role: 'user', content: 'hello' }], {
      status: 'exact',
      entries: [{ encryptedValue: '' }],
    })

    expect(inserted[0]).toMatchObject({ status: 'unknown' })
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Memory write staged unrecorded secret provenance',
      { surface: 'memory', cause: 'entries-unnormalizable', memoryId: 'memory-1' }
    )
  })

  it('counts incoming unknowns even when their originating fault happened in an older run', async () => {
    const { tx, inserted } = createTxStub()

    await replaceMemorySecretProvenanceInTx(tx, 'memory-1', [{ role: 'user', content: 'hello' }], {
      status: 'unknown',
    })

    expect(inserted[0]).toMatchObject({ status: 'unknown' })
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Memory write staged unrecorded secret provenance',
      { surface: 'memory', cause: 'incoming-provenance-incomplete', memoryId: 'memory-1' }
    )
  })
})
