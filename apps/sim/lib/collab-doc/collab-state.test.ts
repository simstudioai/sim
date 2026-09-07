/** @vitest-environment node */
import { createHash } from 'crypto'
import { db } from '@sim/db'
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db/schema', () => ({
  ...schemaMock,
  workspaceFileCollabState: {
    fileId: 'file_id',
    docState: 'doc_state',
    sourceHash: 'source_hash',
  },
}))

import { workspaceFileCollabState, workspaceFiles } from '@sim/db/schema'
import {
  assertCollabDocStateSize,
  CollabDocStateConflictError,
  commitCollabDocState,
  hashMarkdown,
  loadCollabDocState,
  MAX_COLLAB_DOC_STATE_BYTES,
  type PreparedCollabDocState,
  saveCollabDocStateInTx,
} from '@/lib/collab-doc/collab-state'

const VERSION = new Date('2026-09-07T10:00:00.123Z')

function preparedState(expectedState: PreparedCollabDocState['expectedState'] = null) {
  return { docState: new Uint8Array([0, 0]), sourceHash: 'next-source', expectedState }
}

function saveState(prepared: PreparedCollabDocState) {
  return db.transaction((tx) => saveCollabDocStateInTx(tx, 'file-1', prepared))
}

function commitState(prepared = preparedState(), version = VERSION.getTime()) {
  return commitCollabDocState('workspace-1', 'file-1', version, prepared)
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
})

describe('loadCollabDocState', () => {
  it.each([undefined, { maxBytes: 1024 }, { maxBytes: MAX_COLLAB_DOC_STATE_BYTES * 2 }])(
    'bounds binary transfer and hashing in SQL with options %j',
    async (options) => {
      const docState = Buffer.from([0, 0])
      dbChainMockFns.limit.mockResolvedValueOnce([
        { docState, byteCount: 2, sourceHash: 'source-hash', stateHash: 'state-hash' },
      ])

      await expect(loadCollabDocState('file-1', options)).resolves.toEqual({
        docState: new Uint8Array(docState),
        sourceHash: 'source-hash',
        stateHash: 'state-hash',
      })
      const maxBytes = Math.min(
        options?.maxBytes ?? MAX_COLLAB_DOC_STATE_BYTES,
        MAX_COLLAB_DOC_STATE_BYTES
      )
      expect(dbChainMockFns.select).toHaveBeenCalledWith({
        byteCount: expect.objectContaining({ strings: ['octet_length(', ')'] }),
        docState: expect.objectContaining({
          strings: ['CASE WHEN ', ' <= ', ' THEN ', ' END'],
          values: [expect.anything(), maxBytes, 'doc_state'],
        }),
        sourceHash: 'source_hash',
        stateHash: expect.objectContaining({
          strings: ['CASE WHEN ', ' <= ', ' THEN encode(sha256(', "), 'hex') END"],
          values: [expect.anything(), maxBytes, 'doc_state'],
        }),
      })
      expect(dbChainMockFns.where).toHaveBeenCalledWith({
        type: 'eq',
        left: 'file_id',
        right: 'file-1',
      })
      expect(dbChainMockFns.limit).toHaveBeenCalledWith(1)
    }
  )

  it('returns null only when the cache row is absent', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([])
    await expect(loadCollabDocState('file-1', { maxBytes: 1024 })).resolves.toBeNull()
  })

  it.each([undefined, { maxBytes: 1024 }])(
    'rejects an oversized existing state: %j',
    async (options) => {
      dbChainMockFns.limit.mockResolvedValueOnce([
        {
          docState: null,
          stateHash: null,
          sourceHash: 'source',
          byteCount: MAX_COLLAB_DOC_STATE_BYTES + 1,
        },
      ])
      await expect(loadCollabDocState('file-1', options)).rejects.toThrow(RangeError)
    }
  )

  it('does not return an incomplete cache token', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { docState: Buffer.from([0, 0]), stateHash: null, sourceHash: 'source', byteCount: 2 },
    ])
    await expect(loadCollabDocState('file-1')).rejects.toThrow(RangeError)
  })

  it('returns an owned snapshot, not the driver buffer', async () => {
    const docState = Buffer.from([0, 0])
    dbChainMockFns.limit.mockResolvedValueOnce([
      { docState, byteCount: 2, sourceHash: 'source', stateHash: 'state' },
    ])
    const cached = await loadCollabDocState('file-1')
    docState[0] = 255
    expect(cached?.docState).toEqual(new Uint8Array([0, 0]))
  })

  it.each([-1, Number.NaN, 1.5])(
    'rejects invalid byte limit %s before querying',
    async (maxBytes) => {
      await expect(loadCollabDocState('file-1', { maxBytes })).rejects.toThrow(RangeError)
      expect(dbChainMockFns.select).not.toHaveBeenCalled()
    }
  )

  it('propagates database errors instead of reporting an absent cache', async () => {
    const error = new Error('database unavailable')
    dbChainMockFns.limit.mockRejectedValueOnce(error)
    await expect(loadCollabDocState('file-1')).rejects.toBe(error)
  })
})

describe('saveCollabDocStateInTx', () => {
  it('fences an unchanged snapshot without rewriting its binary or timestamp', async () => {
    const prepared = preparedState()
    prepared.expectedState = {
      sourceHash: prepared.sourceHash,
      stateHash: createHash('sha256').update(prepared.docState).digest('hex'),
    }
    queueTableRows(workspaceFileCollabState, [{ fileId: 'file-1' }])

    await expect(saveState(prepared)).resolves.toBeUndefined()
    expect(dbChainMockFns.select).toHaveBeenCalledWith({ fileId: 'file_id' })
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1)
    expect(dbChainMockFns.where).toHaveBeenCalledWith(
      expect.objectContaining({
        conditions: expect.arrayContaining([
          { type: 'eq', left: 'file_id', right: 'file-1' },
          { type: 'eq', left: 'source_hash', right: prepared.sourceHash },
          expect.objectContaining({ type: 'eq', right: prepared.expectedState.stateHash }),
        ]),
      })
    )
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('rejects an unchanged snapshot when its cached revision no longer matches', async () => {
    const prepared = preparedState()
    prepared.expectedState = {
      sourceHash: prepared.sourceHash,
      stateHash: createHash('sha256').update(prepared.docState).digest('hex'),
    }

    await expect(saveState(prepared)).rejects.toBeInstanceOf(CollabDocStateConflictError)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('inserts an observed absent state without replacing a racing writer', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ fileId: 'file-1' }])
    const prepared = preparedState()
    await expect(saveState(prepared)).resolves.toBeUndefined()
    expect(dbChainMockFns.values).toHaveBeenCalledWith({
      fileId: 'file-1',
      docState: Buffer.from(prepared.docState),
      sourceHash: 'next-source',
      updatedAt: expect.any(Date),
    })
    expect(dbChainMockFns.onConflictDoNothing).toHaveBeenCalledWith({ target: 'file_id' })
    expect(dbChainMockFns.onConflictDoUpdate).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('conflicts when another writer inserted the first state', async () => {
    await expect(saveState(preparedState())).rejects.toBeInstanceOf(CollabDocStateConflictError)
    expect(dbChainMockFns.onConflictDoUpdate).not.toHaveBeenCalled()
  })

  it('requires both the projected source and exact binary history token', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ fileId: 'file-1' }])
    await saveState(preparedState({ sourceHash: 'previous-source', stateHash: 'previous-state' }))
    expect(dbChainMockFns.where).toHaveBeenCalledWith({
      type: 'and',
      conditions: [
        { type: 'eq', left: 'file_id', right: 'file-1' },
        { type: 'eq', left: 'source_hash', right: 'previous-source' },
        {
          type: 'eq',
          left: expect.objectContaining({
            strings: ['CASE WHEN octet_length(', ') <= ', ' THEN encode(sha256(', "), 'hex') END"],
            values: ['doc_state', MAX_COLLAB_DOC_STATE_BYTES, 'doc_state'],
          }),
          right: 'previous-state',
        },
      ],
    })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('does not fall back to an insert after a stale token or deleted cache row', async () => {
    await expect(
      saveState(preparedState({ sourceHash: 'source', stateHash: 'stale' }))
    ).rejects.toBeInstanceOf(CollabDocStateConflictError)
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('rejects oversized writes before preparing any mutation', async () => {
    await expect(
      saveState({
        ...preparedState(),
        docState: new Uint8Array(MAX_COLLAB_DOC_STATE_BYTES + 1),
      })
    ).rejects.toThrow(RangeError)
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('propagates a failed cache write so its caller rolls back the transaction', async () => {
    const error = new Error('write failed')
    dbChainMockFns.returning.mockRejectedValueOnce(error)
    await expect(saveState(preparedState())).rejects.toBe(error)
  })
})

describe('commitCollabDocState', () => {
  it('locks only the active scoped workspace file before committing its cache', async () => {
    queueTableRows(workspaceFiles, [{ contentUpdatedAt: VERSION }])
    dbChainMockFns.returning.mockResolvedValueOnce([{ fileId: 'file-1' }])
    await expect(commitState()).resolves.toEqual({
      status: 'committed',
      version: VERSION.getTime(),
    })
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1)
    expect(dbChainMockFns.where).toHaveBeenCalledWith({
      type: 'and',
      conditions: [
        { type: 'eq', left: workspaceFiles.id, right: 'file-1' },
        { type: 'eq', left: workspaceFiles.workspaceId, right: 'workspace-1' },
        { type: 'eq', left: workspaceFiles.context, right: 'workspace' },
        { type: 'isNull', column: workspaceFiles.deletedAt },
      ],
    })
    expect(dbChainMockFns.for.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.insert.mock.invocationCallOrder[0]
    )
    expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('does not create cache state for a missing, deleted, or differently scoped file', async () => {
    await expect(commitState()).resolves.toEqual({ status: 'missing' })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it.each([-1, 1])(
    'rejects a changed durable version (%s ms) under the lock',
    async (difference) => {
      queueTableRows(workspaceFiles, [
        { contentUpdatedAt: new Date(VERSION.getTime() + difference) },
      ])
      await expect(commitState()).resolves.toEqual({ status: 'conflict' })
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    }
  )

  it('reports a racing cache revision as a conflict, even with unchanged durable content', async () => {
    queueTableRows(workspaceFiles, [{ contentUpdatedAt: VERSION }])
    const prepared = preparedState({ sourceHash: 'next-source', stateHash: 'stale-history' })
    await expect(commitState(prepared)).resolves.toEqual({ status: 'conflict' })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('rejects an oversized state before opening a transaction', async () => {
    await expect(
      commitState({
        ...preparedState(),
        docState: new Uint8Array(MAX_COLLAB_DOC_STATE_BYTES + 1),
      })
    ).rejects.toThrow(RangeError)
    expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
  })

  it('propagates infrastructure failures instead of misclassifying them as conflicts', async () => {
    queueTableRows(workspaceFiles, [{ contentUpdatedAt: VERSION }])
    const error = new Error('database connection lost')
    dbChainMockFns.returning.mockRejectedValueOnce(error)
    await expect(commitState()).rejects.toBe(error)
  })
})

describe('collaborative state byte bounds', () => {
  it('accepts the exact maximum and rejects one byte more', () => {
    expect(() => assertCollabDocStateSize(new Uint8Array(MAX_COLLAB_DOC_STATE_BYTES))).not.toThrow()
    expect(() => assertCollabDocStateSize(new Uint8Array(MAX_COLLAB_DOC_STATE_BYTES + 1))).toThrow(
      RangeError
    )
  })

  it('hashes the exact markdown bytes', () => {
    expect(hashMarkdown(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })
})
