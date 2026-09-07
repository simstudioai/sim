/**
 * @vitest-environment node
 */
import { FILE_DOC_LIMITS } from '@sim/realtime-protocol/file-doc'
import { get, update as updateValue } from 'idb-keyval'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

const storage = vi.hoisted(() => new Map<string, unknown>())

vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => storage.get(key)),
  update: vi.fn((key: string, updater: (value: unknown) => unknown) => {
    storage.set(key, updater(storage.get(key)))
  }),
}))

import {
  type PendingDocumentRecovery,
  PendingFileDocUpdateJournal,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/collaboration/pending-update-journal'

function journal(): PendingFileDocUpdateJournal {
  return new PendingFileDocUpdateJournal({
    workspaceId: 'workspace-1',
    fileId: 'file-1',
    userId: 'user-1',
  })
}

function updateWith(text: string): Uint8Array {
  const doc = new Y.Doc()
  doc.getText('body').insert(0, text)
  return Y.encodeStateAsUpdate(doc)
}

describe('PendingFileDocUpdateJournal', () => {
  beforeEach(() => {
    storage.clear()
    vi.mocked(updateValue)
      .mockReset()
      .mockImplementation(async (key, updater) => {
        storage.set(String(key), updater(storage.get(String(key))))
      })
  })

  it('stores a full recovery snapshot separately from the pending wire update', async () => {
    const subject = journal()
    const pendingUpdate = updateWith('pending')
    const recoverySnapshot = updateWith('complete local draft')

    await subject.save('doc-1', pendingUpdate, recoverySnapshot)

    await expect(subject.load('doc-1')).resolves.toEqual(
      expect.objectContaining({ docId: 'doc-1', pendingUpdate, recoverySnapshot })
    )
  })

  it('reports when the current full recovery snapshot cannot be stored', async () => {
    const subject = journal()
    const pendingUpdate = updateWith('pending')

    const result = await subject.save(
      'doc-1',
      pendingUpdate,
      new Uint8Array(FILE_DOC_LIMITS.updateBytes * 2 + 1)
    )

    expect(result).toMatchObject({ status: 'limit-exceeded' })
  })

  it('loads an existing draft without requiring a writable transaction', async () => {
    const subject = journal()
    const pendingUpdate = updateWith('recoverable draft')
    await subject.save('doc-1', pendingUpdate, pendingUpdate)
    const writes = vi.mocked(updateValue).mock.calls.length
    vi.mocked(updateValue).mockRejectedValueOnce(new Error('Read-only storage'))

    await expect(subject.load('doc-1')).resolves.toMatchObject({ docId: 'doc-1', pendingUpdate })
    expect(updateValue).toHaveBeenCalledTimes(writes)
  })

  it.each(['pendingUpdate', 'recoverySnapshot'] as const)(
    'isolates malformed %s bytes without replaying or deleting them',
    async (field) => {
      const subject = journal()
      const valid = updateWith('preserved snapshot')
      const invalid = new Uint8Array([255])
      const pending = field === 'pendingUpdate' ? invalid : valid
      const snapshot = field === 'recoverySnapshot' ? invalid : valid
      await subject.save('doc-1', pending, snapshot)

      await expect(subject.load('doc-1')).resolves.toBeNull()
      await expect(journal().load()).resolves.toBeNull()
      expect([...storage.values()]).toEqual([
        expect.objectContaining({
          documents: [
            expect.objectContaining({
              docId: 'doc-1',
              pendingUpdate: pending,
              recoverySnapshot: snapshot,
              quarantined: true,
            }),
          ],
        }),
      ])

      const newUpdate = updateWith('new edits')
      await expect(subject.save('doc-1', newUpdate, newUpdate)).resolves.toMatchObject({
        status: 'saved',
        pendingUpdate: newUpdate,
      })
      await expect(subject.load('doc-1')).resolves.toMatchObject({ pendingUpdate: newUpdate })
      await subject.clear('doc-1', newUpdate)
      await expect(subject.load()).resolves.toBeNull()
      expect([...storage.values()]).toEqual([
        expect.objectContaining({
          documents: [expect.objectContaining({ pendingUpdate: pending, quarantined: true })],
        }),
      ])
    }
  )

  it('ignores malformed recovery even if browser storage cannot be updated', async () => {
    const subject = journal()
    const invalid = new Uint8Array([255])
    await subject.save('doc-1', invalid, invalid)
    const before = structuredClone([...storage.values()])
    vi.mocked(updateValue).mockRejectedValueOnce(new Error('Storage denied'))

    await expect(subject.load()).resolves.toBeNull()
    expect([...storage.values()]).toEqual(before)
  })

  it.each(['pendingUpdate', 'recoverySnapshot'] as const)(
    'saves new edits before loading a malformed existing %s without deleting the original',
    async (field) => {
      vi.useFakeTimers()
      const restored = new Y.Doc()
      try {
        const subject = journal()
        const valid = updateWith('recoverable original half')
        const invalid = new Uint8Array([255])
        await subject.save(
          'doc-1',
          field === 'pendingUpdate' ? invalid : valid,
          field === 'recoverySnapshot' ? invalid : valid
        )
        const original = (
          structuredClone([...storage.values()][0]) as { documents: PendingDocumentRecovery[] }
        ).documents[0]
        await vi.advanceTimersByTimeAsync(1_000)
        const current = updateWith('current edits')

        await expect(subject.save('doc-1', current, current)).resolves.toEqual({
          status: 'saved',
          pendingUpdate: current,
        })
        await expect(journal().load('doc-1')).resolves.toMatchObject({ pendingUpdate: current })
        expect([...storage.values()]).toEqual([
          expect.objectContaining({
            documents: [
              expect.objectContaining({ pendingUpdate: current }),
              { ...original, quarantined: true },
            ],
          }),
        ])

        const peer = journal()
        const later = updateWith('later peer edits')
        const combined = await peer.save('doc-1', later, later)
        expect(combined.status).toBe('saved')
        const recovery = await subject.load('doc-1')
        Y.applyUpdate(restored, recovery!.recoverySnapshot!)
        Y.applyUpdate(restored, recovery!.pendingUpdate)
        expect(restored.getText('body').toString()).toContain('current edits')
        expect(restored.getText('body').toString()).toContain('later peer edits')

        await peer.clear('doc-1', combined.pendingUpdate)
        await expect(subject.load('doc-1')).resolves.toBeNull()
        expect([...storage.values()]).toEqual([
          expect.objectContaining({ documents: [{ ...original, quarantined: true }] }),
        ])
      } finally {
        restored.destroy()
        vi.useRealTimers()
      }
    }
  )

  it.each(['pendingUpdate', 'recoverySnapshot'] as const)(
    'preserves valid existing recovery when the incoming %s is malformed',
    async (field) => {
      const subject = journal()
      const existing = updateWith('existing valid history')
      await subject.save('doc-1', existing, existing)
      const before = structuredClone([...storage.values()])
      const current = updateWith('current edits')
      const invalid = new Uint8Array([255])

      await expect(
        subject.save(
          'doc-1',
          field === 'pendingUpdate' ? invalid : current,
          field === 'recoverySnapshot' ? invalid : current
        )
      ).resolves.toMatchObject({ status: 'unavailable' })

      expect([...storage.values()]).toEqual(before)
      await expect(subject.load('doc-1')).resolves.toMatchObject({ pendingUpdate: existing })
    }
  )

  it('does not replace malformed existing recovery with malformed incoming recovery', async () => {
    const subject = journal()
    const invalid = new Uint8Array([255])
    await subject.save('doc-1', invalid, invalid)
    const before = structuredClone([...storage.values()])

    await expect(subject.save('doc-1', invalid, invalid)).resolves.toMatchObject({
      status: 'unavailable',
    })

    expect([...storage.values()]).toEqual(before)
  })

  it('prioritizes valid records when isolating malformed recovery during a save', async () => {
    const subject = journal()
    const valid = updateWith('valid recovery')
    await subject.save('first', valid, valid)
    await subject.save('second', valid, valid)
    await subject.save('current', new Uint8Array([255]), valid)

    await expect(subject.save('current', valid, valid)).resolves.toMatchObject({ status: 'saved' })

    for (const docId of ['first', 'second', 'current']) {
      await expect(subject.load(docId)).resolves.toMatchObject({ docId })
    }
    expect((storage.values().next().value as { documents: unknown[] }).documents).toHaveLength(3)
  })

  it('does not quarantine a record that another tab replaced after the read', async () => {
    const subject = journal()
    const invalid = new Uint8Array([255])
    await subject.save('doc-1', invalid, invalid)
    const stale = structuredClone([...storage.values()][0])
    storage.clear()
    const valid = updateWith('concurrent valid edits')
    await subject.save('doc-1', valid, valid)
    vi.mocked(get).mockResolvedValueOnce(stale)

    await expect(subject.load()).resolves.toBeNull()
    await expect(subject.load()).resolves.toMatchObject({ pendingUpdate: valid })
  })

  it('prioritizes valid recovery within the existing record cap', async () => {
    const subject = journal()
    const valid = updateWith('valid')
    await subject.save('first', valid, valid)
    const invalid = new Uint8Array([255])
    await subject.save('invalid', invalid, invalid)
    await expect(subject.load('invalid')).resolves.toBeNull()
    await subject.save('second', valid, valid)
    await subject.save('third', valid, valid)

    for (const docId of ['first', 'second', 'third']) {
      await expect(subject.load(docId)).resolves.toMatchObject({ docId })
    }
    expect([...storage.values()]).toEqual([
      expect.objectContaining({
        documents: expect.arrayContaining([
          expect.objectContaining({ docId: 'first' }),
          expect.objectContaining({ docId: 'second' }),
          expect.objectContaining({ docId: 'third' }),
        ]),
      }),
    ])
    expect((storage.values().next().value as { documents: unknown[] }).documents).toHaveLength(3)
  })

  it('does not extend malformed recovery retention while quarantining it', async () => {
    vi.useFakeTimers()
    try {
      const subject = journal()
      const invalid = new Uint8Array([255])
      await subject.save('invalid', invalid, invalid)
      await vi.advanceTimersByTimeAsync(6 * 24 * 60 * 60 * 1_000)
      await expect(subject.load()).resolves.toBeNull()
      await vi.advanceTimersByTimeAsync(2 * 24 * 60 * 60 * 1_000)
      const valid = updateWith('new edits')
      await subject.save('current', valid, valid)

      expect([...storage.values()]).toEqual([
        expect.objectContaining({ documents: [expect.objectContaining({ docId: 'current' })] }),
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('distinguishes unavailable browser storage from a configured size limit', async () => {
    vi.mocked(updateValue).mockRejectedValueOnce(new Error('Storage denied'))
    const pendingUpdate = updateWith('pending')

    await expect(journal().save('doc-1', pendingUpdate, pendingUpdate)).resolves.toEqual({
      pendingUpdate,
      status: 'unavailable',
    })
  })

  it('atomically preserves concurrent providers until their aggregate is acknowledged', async () => {
    const first = journal()
    const second = journal()
    const firstUpdate = updateWith('a')
    const secondUpdate = updateWith('b')

    await first.save('doc-1', firstUpdate, firstUpdate)
    const combined = await second.save('doc-1', secondUpdate, secondUpdate)
    await first.clear('doc-1', firstUpdate)
    await expect(first.load('doc-1')).resolves.not.toBeNull()

    const recovered = new Y.Doc()
    Y.applyUpdate(recovered, combined.pendingUpdate)
    expect(recovered.getText('body').toString()).toHaveLength(2)

    await second.clear('doc-1', combined.pendingUpdate)
    await expect(first.load('doc-1')).resolves.toBeNull()
  })

  it('preserves the snapshot dependencies of pending edits from concurrent tabs', async () => {
    const first = journal()
    const second = journal()
    const base = new Y.Doc()
    base.getText('body').insert(0, 'base')
    const firstDoc = new Y.Doc()
    const secondDoc = new Y.Doc()
    Y.applyUpdate(firstDoc, Y.encodeStateAsUpdate(base))
    Y.applyUpdate(secondDoc, Y.encodeStateAsUpdate(base))

    firstDoc.getText('body').insert(4, ' acknowledged')
    const firstVector = Y.encodeStateVector(firstDoc)
    firstDoc.getText('body').insert(17, ' pending-first')
    await first.save(
      'doc-1',
      Y.encodeStateAsUpdate(firstDoc, firstVector),
      Y.encodeStateAsUpdate(firstDoc)
    )

    const secondVector = Y.encodeStateVector(secondDoc)
    secondDoc.getText('body').insert(4, ' pending-second')
    await second.save(
      'doc-1',
      Y.encodeStateAsUpdate(secondDoc, secondVector),
      Y.encodeStateAsUpdate(secondDoc)
    )

    const stored = await journal().load('doc-1')
    expect(stored).not.toBeNull()
    const recovered = new Y.Doc()
    Y.applyUpdate(recovered, stored!.recoverySnapshot!)
    Y.applyUpdate(recovered, stored!.pendingUpdate)

    const expected = new Y.Doc()
    Y.applyUpdate(expected, Y.encodeStateAsUpdate(firstDoc))
    Y.applyUpdate(expected, Y.encodeStateAsUpdate(secondDoc))
    expect(recovered.getText('body').toString()).toBe(expected.getText('body').toString())
    expect(recovered.getText('body').toString()).toContain('pending-first')
    expect(recovered.getText('body').toString()).toContain('pending-second')
    for (const doc of [base, firstDoc, secondDoc, recovered, expected]) doc.destroy()
  })

  it('bounds the combined snapshots without overwriting the previous recovery copy', async () => {
    const subject = journal()
    const pendingUpdate = updateWith('pending')
    const firstSnapshot = updateWith('a'.repeat(FILE_DOC_LIMITS.updateBytes))
    const secondSnapshot = updateWith('b'.repeat(FILE_DOC_LIMITS.updateBytes))
    await subject.save('doc-1', pendingUpdate, firstSnapshot)

    await expect(subject.save('doc-1', pendingUpdate, secondSnapshot)).resolves.toMatchObject({
      status: 'limit-exceeded',
    })
    const recovered = await subject.load('doc-1')
    expect(recovered?.recoverySnapshot).toBeInstanceOf(Uint8Array)
    expect(Buffer.from(recovered!.recoverySnapshot!).equals(Buffer.from(firstSnapshot))).toBe(true)
  })

  it('retains bounded recovery records for separate document identities', async () => {
    const subject = journal()
    for (const docId of ['doc-1', 'doc-2', 'doc-3', 'doc-4']) {
      const update = updateWith(docId)
      await subject.save(docId, update, update)
    }

    await expect(subject.load('doc-4')).resolves.toMatchObject({ docId: 'doc-4' })
    await expect(subject.load('doc-2')).resolves.toMatchObject({ docId: 'doc-2' })
    await expect(subject.load('doc-1')).resolves.toBeNull()
    await expect(subject.load()).resolves.toMatchObject({ docId: 'doc-4' })
  })

  it('clears only the acknowledged document identity', async () => {
    const subject = journal()
    const oldUpdate = updateWith('old')
    const currentUpdate = updateWith('current')
    await subject.save('old-doc', oldUpdate, oldUpdate)
    await subject.save('current-doc', currentUpdate, currentUpdate)

    await subject.clear('old-doc', oldUpdate)

    await expect(subject.load('old-doc')).resolves.toBeNull()
    await expect(subject.load('current-doc')).resolves.toMatchObject({ docId: 'current-doc' })
  })

  it('isolates records by user, workspace, and file', async () => {
    const first = journal()
    const otherUser = new PendingFileDocUpdateJournal({
      workspaceId: 'workspace-1',
      fileId: 'file-1',
      userId: 'user-2',
    })
    const update = updateWith('draft')

    await first.save('doc-1', update, update)

    await expect(first.load()).resolves.not.toBeNull()
    await expect(otherUser.load()).resolves.toBeNull()
  })
})
