import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { describe, expect, it } from 'vitest'
import type { DbTransaction } from '@/lib/db/types'
import {
  readBoundMemorySecretProvenance,
  replaceMemorySecretProvenanceInTx,
} from '@/lib/memory/secret-provenance'

const mockLogger = getMockLogger('MemorySecretProvenance')

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
