'use client'

import { createLogger } from '@sim/logger'
import { FILE_DOC_LIMITS } from '@sim/realtime-protocol/file-doc'
import { get, update as updateValue } from 'idb-keyval'
import * as Y from 'yjs'

const logger = createLogger('PendingFileDocUpdateJournal')
const JOURNAL_VERSION = 1
const JOURNAL_TTL_MS = 7 * 24 * 60 * 60 * 1_000
const MAX_DOCUMENTS = 3
const RECOVERY_SNAPSHOT_MAX_BYTES = FILE_DOC_LIMITS.updateBytes * 2

export interface PendingDocumentRecovery {
  docId: string
  pendingUpdate: Uint8Array
  recoverySnapshot: Uint8Array | null
  updatedAt: number
}

interface PendingUpdateJournalRecord {
  version: typeof JOURNAL_VERSION
  documents: JournalDocument[]
}

interface JournalDocument extends PendingDocumentRecovery {
  quarantined?: boolean
}

interface PendingUpdateJournalScope {
  workspaceId: string
  fileId: string
  userId: string
}

interface JournalSaveResult {
  pendingUpdate: Uint8Array
  status: 'saved' | 'limit-exceeded' | 'unavailable'
}

function isRecovery(value: unknown): value is JournalDocument {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<JournalDocument>
  return (
    typeof candidate.docId === 'string' &&
    candidate.docId.length > 0 &&
    candidate.pendingUpdate instanceof Uint8Array &&
    candidate.pendingUpdate.byteLength > 0 &&
    candidate.pendingUpdate.byteLength <= FILE_DOC_LIMITS.updateBytes &&
    (candidate.recoverySnapshot === null ||
      (candidate.recoverySnapshot instanceof Uint8Array &&
        candidate.recoverySnapshot.byteLength > 0 &&
        candidate.recoverySnapshot.byteLength <= RECOVERY_SNAPSHOT_MAX_BYTES)) &&
    typeof candidate.updatedAt === 'number' &&
    Number.isFinite(candidate.updatedAt) &&
    (candidate.quarantined === undefined || typeof candidate.quarantined === 'boolean')
  )
}

function liveDocuments(value: unknown, now: number): JournalDocument[] {
  if (typeof value !== 'object' || value === null) return []
  const candidate = value as Partial<PendingUpdateJournalRecord>
  if (candidate.version !== JOURNAL_VERSION || !Array.isArray(candidate.documents)) return []
  return candidate.documents
    .filter(isRecovery)
    .filter((document) => now - document.updatedAt <= JOURNAL_TTL_MS)
    .sort(
      (left, right) =>
        Number(left.quarantined === true) - Number(right.quarantined === true) ||
        right.updatedAt - left.updatedAt
    )
    .slice(0, MAX_DOCUMENTS)
}

function record(documents: JournalDocument[]): PendingUpdateJournalRecord {
  return { version: JOURNAL_VERSION, documents }
}

function sameUpdate(left: Uint8Array | null, right: Uint8Array | null): boolean {
  if (left === null || right === null) return left === right
  if (left.byteLength !== right.byteLength) return false
  return left.every((byte, index) => byte === right[index])
}

function validateRecovery({
  pendingUpdate,
  recoverySnapshot,
}: Pick<PendingDocumentRecovery, 'pendingUpdate' | 'recoverySnapshot'>): void {
  const validationDoc = new Y.Doc()
  try {
    if (recoverySnapshot) Y.applyUpdate(validationDoc, recoverySnapshot)
    Y.applyUpdate(validationDoc, pendingUpdate)
  } finally {
    validationDoc.destroy()
  }
}

/**
 * A bounded crash-recovery journal for user edits the relay has not acknowledged. One atomic
 * file-scoped envelope retains up to three recent Yjs document identities, so rebuilding a live
 * document cannot overwrite an older local draft. The pending delta is wire-bounded separately from
 * the full recovery snapshot: only the delta is ever replayed to a matching server document.
 */
export class PendingFileDocUpdateJournal {
  private readonly key: string
  private mutationQueue = Promise.resolve()

  constructor({ workspaceId, fileId, userId }: PendingUpdateJournalScope) {
    const origin = typeof location === 'undefined' ? 'server' : location.origin
    this.key = [
      'sim',
      'file-doc-pending',
      JOURNAL_VERSION,
      origin,
      userId,
      workspaceId,
      fileId,
    ].join(':')
  }

  async load(preferredDocId?: string): Promise<PendingDocumentRecovery | null> {
    try {
      await this.mutationQueue
      const documents = liveDocuments(await get<unknown>(this.key), Date.now()).filter(
        (document) => !document.quarantined
      )
      const recovered = preferredDocId
        ? (documents.find((document) => document.docId === preferredDocId) ?? null)
        : (documents[0] ?? null)
      if (!recovered) return null
      try {
        validateRecovery(recovered)
        return recovered
      } catch (error) {
        logger.warn('Isolating malformed pending file edits', { error })
        await this.quarantine(recovered)
        return null
      }
    } catch (error) {
      logger.warn('Failed to load pending file edits', { error })
      return null
    }
  }

  save(
    docId: string,
    pendingUpdate: Uint8Array,
    recoverySnapshot: Uint8Array
  ): Promise<JournalSaveResult> {
    const pendingWithinLimit =
      pendingUpdate.byteLength > 0 && pendingUpdate.byteLength <= FILE_DOC_LIMITS.updateBytes
    const snapshotWithinLimit =
      recoverySnapshot.byteLength > 0 && recoverySnapshot.byteLength <= RECOVERY_SNAPSHOT_MAX_BYTES
    const limited: JournalSaveResult = { pendingUpdate, status: 'limit-exceeded' }
    if (!pendingWithinLimit || !snapshotWithinLimit) return Promise.resolve(limited)

    return this.enqueue(
      async () => {
        let result = limited
        await updateValue<unknown>(this.key, (value) => {
          const now = Date.now()
          const documents = liveDocuments(value, now)
          const existing = documents.find(
            (document) => document.docId === docId && !document.quarantined
          )
          let merged = pendingUpdate
          let mergedSnapshot = recoverySnapshot
          if (existing) {
            try {
              merged = Y.mergeUpdates([existing.pendingUpdate, pendingUpdate])
              if (merged.byteLength > FILE_DOC_LIMITS.updateBytes) return record(documents)
              if (existing.recoverySnapshot) {
                mergedSnapshot = Y.mergeUpdates([existing.recoverySnapshot, recoverySnapshot])
              }
            } catch (error) {
              let existingIsValid = true
              try {
                validateRecovery(existing)
              } catch {
                existingIsValid = false
              }
              if (existingIsValid) throw error
              validateRecovery({ pendingUpdate, recoverySnapshot })
              logger.warn('Isolating malformed pending file edits during save', { error })
              documents.splice(documents.indexOf(existing), 1)
              documents.push({ ...existing, quarantined: true })
              merged = pendingUpdate
              mergedSnapshot = recoverySnapshot
            }
          }
          if (mergedSnapshot.byteLength > RECOVERY_SNAPSHOT_MAX_BYTES) return record(documents)

          const next: PendingDocumentRecovery = {
            docId,
            pendingUpdate: merged,
            recoverySnapshot: mergedSnapshot,
            updatedAt: now,
          }
          const retained = [
            next,
            ...documents.filter((document) => document.docId !== docId || document.quarantined),
          ].slice(0, MAX_DOCUMENTS)
          result = {
            pendingUpdate: merged,
            status: 'saved',
          }
          return record(retained)
        })
        if (result.status === 'limit-exceeded') {
          logger.warn('Pending file edits exceeded the crash-recovery journal limit')
        }
        return result
      },
      { pendingUpdate, status: 'unavailable' }
    )
  }

  clear(docId: string, acknowledgedUpdate: Uint8Array): Promise<void> {
    return this.enqueue(
      () =>
        updateValue<unknown>(this.key, (value) => {
          const documents = liveDocuments(value, Date.now())
          return record(
            documents.filter(
              (document) =>
                document.quarantined ||
                document.docId !== docId ||
                !sameUpdate(document.pendingUpdate, acknowledgedUpdate)
            )
          )
        }),
      undefined
    )
  }

  /** Retain invalid bytes within the journal's existing bounds without replaying or merging them. */
  private quarantine(recovered: PendingDocumentRecovery): Promise<void> {
    return this.enqueue(
      () =>
        updateValue<unknown>(this.key, (value) =>
          record(
            liveDocuments(value, Date.now()).map((document) =>
              document.docId === recovered.docId &&
              document.updatedAt === recovered.updatedAt &&
              sameUpdate(document.pendingUpdate, recovered.pendingUpdate) &&
              sameUpdate(document.recoverySnapshot, recovered.recoverySnapshot)
                ? { ...document, quarantined: true }
                : document
            )
          )
        ),
      undefined
    )
  }

  private enqueue<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result.catch((error) => {
      logger.warn('Failed to persist pending file edits', { error })
      return fallback
    })
  }
}
