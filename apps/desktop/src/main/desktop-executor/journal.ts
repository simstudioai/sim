/**
 * The background executor's durable outbox: one entry per call this device took, advanced before
 * each step it guards, so a restart knows exactly how far each call got.
 *
 * - `claiming`: a claim request is in flight; nothing ran.
 * - `claimed`: this device owns the call (its token is recorded) but has not started it.
 * - `started`: the action may have begun on this machine.
 * - `result`: the action finished; its completion is waiting for Sim to acknowledge it.
 *
 * An acknowledged entry is removed. The file is encrypted with Electron safeStorage and written
 * atomically, like every other account-bearing store in userData; without OS encryption nothing
 * is written and the journal lives in memory only.
 */
import type { DesktopToolCompletion } from '@sim/desktop-bridge/tool-results'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { safeStorage } from 'electron'
import {
  FileResourceLimitError,
  readFileWithinLimit,
  removeFileIfPresent,
  writeJsonFileAtomically,
} from '@/main/atomic-json-file'

const logger = createLogger('DesktopExecutorJournal')

const JOURNAL_VERSION = 1
/** Results can carry a screenshot, so the bound is the size of a few of them. */
const MAX_JOURNAL_BYTES = 64 * 1024 * 1024
/**
 * Result data kept on disk across all entries, in UTF-8 bytes. Encryption and base64 grow it by
 * about a third, so a journal within this budget always reads back under {@link MAX_JOURNAL_BYTES}.
 */
const MAX_PERSISTED_RESULT_BYTES = 32 * 1024 * 1024
const RESULT_NOT_KEPT =
  'The action finished, but its result was too large to keep on this computer. Do not repeat a side-effecting action; inspect the current state instead.'

/**
 * The entries as written to disk: a result whose data would push the journal past its budget is
 * kept as finished without its data, so the file never grows past what a restart can read.
 */
function boundedEntries(entries: Map<string, JournalEntry>): JournalEntry[] {
  let budget = MAX_PERSISTED_RESULT_BYTES
  return [...entries.values()].map((entry) => {
    if (entry.state !== 'result' || entry.completion.data === undefined) return entry
    const size = Buffer.byteLength(JSON.stringify(entry.completion.data), 'utf8')
    if (size <= budget) {
      budget -= size
      return entry
    }
    return {
      ...entry,
      completion: {
        status: entry.completion.status,
        message: RESULT_NOT_KEPT,
        data: { error: RESULT_NOT_KEPT, resultOmitted: true },
      },
    }
  })
}

export type JournalEntry =
  | { toolCallId: string; state: 'claiming' }
  | { toolCallId: string; state: 'claimed' | 'started'; executionToken: string }
  | {
      toolCallId: string
      state: 'result'
      executionToken: string
      completion: DesktopToolCompletion
    }

export interface ExecutorJournal {
  load(): Promise<JournalEntry[]>
  put(entry: JournalEntry): Promise<void>
  remove(toolCallId: string): Promise<void>
  clear(): Promise<void>
}

interface EncryptionProvider {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

function encryptionAvailable(encryption: EncryptionProvider): boolean {
  try {
    return encryption.isEncryptionAvailable()
  } catch {
    return false
  }
}

function isCompletion(value: unknown): value is DesktopToolCompletion {
  return (
    isRecordLike(value) &&
    (value.status === 'success' || value.status === 'error' || value.status === 'cancelled') &&
    typeof value.message === 'string' &&
    (value.data === undefined || isRecordLike(value.data))
  )
}

function parseEntry(value: unknown): JournalEntry | null {
  if (!isRecordLike(value) || typeof value.toolCallId !== 'string' || !value.toolCallId) return null
  const { toolCallId } = value
  if (value.state === 'claiming') return { toolCallId, state: 'claiming' }
  if (typeof value.executionToken !== 'string' || !value.executionToken) return null
  const { executionToken } = value
  if (value.state === 'claimed' || value.state === 'started') {
    return { toolCallId, state: value.state, executionToken }
  }
  if (value.state === 'result' && isCompletion(value.completion)) {
    return { toolCallId, state: 'result', executionToken, completion: value.completion }
  }
  return null
}

export function createExecutorJournal(
  filePath: string,
  encryption: EncryptionProvider = safeStorage
): ExecutorJournal {
  const entries = new Map<string, JournalEntry>()
  let mutationTail = Promise.resolve()

  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    const result = mutationTail.then(operation)
    mutationTail = result.catch(() => undefined)
    return result
  }

  /**
   * Rewrites the whole journal. A failure rejects, so the caller knows the transition is not
   * durable; the in-memory journal stays current and the next transition rewrites it all.
   */
  const persist = async (): Promise<void> => {
    if (!encryptionAvailable(encryption)) return
    if (entries.size === 0) {
      await removeFileIfPresent(filePath)
      return
    }
    const payload = JSON.stringify({ version: JOURNAL_VERSION, entries: boundedEntries(entries) })
    const ciphertext = encryption.encryptString(payload).toString('base64')
    await writeJsonFileAtomically(filePath, { version: JOURNAL_VERSION, ciphertext })
  }

  return {
    async load() {
      await enqueue(async () => {
        entries.clear()
        if (!encryptionAvailable(encryption)) return
        let raw: Buffer
        try {
          raw = await readFileWithinLimit(filePath, MAX_JOURNAL_BYTES)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
          logger.warn('Could not read the executor journal', {
            error: error instanceof FileResourceLimitError ? 'too large' : getErrorMessage(error),
          })
          return
        }
        try {
          const envelope = JSON.parse(raw.toString('utf8')) as unknown
          if (
            !isRecordLike(envelope) ||
            envelope.version !== JOURNAL_VERSION ||
            typeof envelope.ciphertext !== 'string'
          ) {
            return
          }
          const payload = JSON.parse(
            encryption.decryptString(Buffer.from(envelope.ciphertext, 'base64'))
          ) as unknown
          if (!isRecordLike(payload) || !Array.isArray(payload.entries)) return
          for (const candidate of payload.entries) {
            const entry = parseEntry(candidate)
            if (entry) entries.set(entry.toolCallId, entry)
          }
        } catch (error) {
          logger.warn('Discarding an unreadable executor journal', {
            error: getErrorMessage(error),
          })
        }
      })
      return [...entries.values()]
    },
    put(entry) {
      return enqueue(async () => {
        entries.set(entry.toolCallId, entry)
        await persist()
      })
    },
    remove(toolCallId) {
      return enqueue(async () => {
        if (!entries.delete(toolCallId)) return
        await persist()
      })
    },
    clear() {
      return enqueue(async () => {
        entries.clear()
        await removeFileIfPresent(filePath)
      })
    },
  }
}
