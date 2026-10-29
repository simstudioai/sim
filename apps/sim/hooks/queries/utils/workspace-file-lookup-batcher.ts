import { MAX_WORKSPACE_FILE_LOOKUP_ENTRIES } from '@/lib/api/contracts/workspace-files'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import type { WorkspaceFileLookupKind } from '@/hooks/queries/utils/workspace-file-keys'

/** One `POST /files/lookup` body: at most {@link MAX_WORKSPACE_FILE_LOOKUP_ENTRIES} of each kind. */
interface WorkspaceFileLookupBody {
  ids?: string[]
  keys?: string[]
  references?: string[]
}

interface WorkspaceFileLookupResponse {
  files: WorkspaceFileRecord[]
  references: { reference: string; fileId: string | null }[]
}

type FetchLookup = (
  workspaceId: string,
  body: WorkspaceFileLookupBody
) => Promise<WorkspaceFileLookupResponse>

interface PendingLookup {
  kind: WorkspaceFileLookupKind
  value: string
  resolve: (file: WorkspaceFileRecord | null) => void
  reject: (error: unknown) => void
}

const BODY_FIELD = { id: 'ids', key: 'keys', reference: 'references' } as const

/** Splits a workspace's pending lookups into request bodies, deduplicated and within the per-kind cap. */
function chunkLookups(entries: PendingLookup[]): WorkspaceFileLookupBody[] {
  const chunks: Record<WorkspaceFileLookupKind, Set<string>>[] = []
  for (const { kind, value } of entries) {
    if (chunks.some((chunk) => chunk[kind].has(value))) continue
    let chunk = chunks.find((candidate) => candidate[kind].size < MAX_WORKSPACE_FILE_LOOKUP_ENTRIES)
    if (!chunk) {
      chunk = { id: new Set(), key: new Set(), reference: new Set() }
      chunks.push(chunk)
    }
    chunk[kind].add(value)
  }
  return chunks.map((chunk) => {
    const body: WorkspaceFileLookupBody = {}
    for (const kind of ['id', 'key', 'reference'] as const) {
      if (chunk[kind].size > 0) body[BODY_FIELD[kind]] = [...chunk[kind]]
    }
    return body
  })
}

function resolveFrom(
  response: WorkspaceFileLookupResponse,
  kind: WorkspaceFileLookupKind,
  value: string
): WorkspaceFileRecord | null {
  if (kind === 'id') return response.files.find((file) => file.id === value) ?? null
  if (kind === 'key') return response.files.find((file) => file.key === value) ?? null
  const fileId = response.references.find((entry) => entry.reference === value)?.fileId
  return fileId ? (response.files.find((file) => file.id === fileId) ?? null) : null
}

/**
 * Coalesces individual file lookups into batched `POST /files/lookup` requests.
 *
 * Many surfaces resolve files one at a time — a chat full of file chips, a table column of file
 * cells — and each mounts its own query. Lookups requested in the same task are collected and
 * sent together after it, one request per workspace and per {@link MAX_WORKSPACE_FILE_LOOKUP_ENTRIES}
 * values of a kind, so N chips cost one round trip instead of N, and none of them needs the
 * workspace's whole file list.
 *
 * A caller that aborts before the batch is sent is dropped from it; one that aborts after is
 * rejected at once while the shared request carries on for the rest.
 */
export function createWorkspaceFileLookupBatcher(fetchLookup: FetchLookup) {
  let pending = new Map<string, PendingLookup[]>()
  let scheduled = false

  function flush() {
    scheduled = false
    const batch = pending
    pending = new Map()
    for (const [workspaceId, entries] of batch) {
      for (const body of chunkLookups(entries)) {
        const inBody = (entry: PendingLookup) =>
          body[BODY_FIELD[entry.kind]]?.includes(entry.value) ?? false
        const waiters = entries.filter(inBody)
        fetchLookup(workspaceId, body).then(
          (response) => {
            for (const waiter of waiters)
              waiter.resolve(resolveFrom(response, waiter.kind, waiter.value))
          },
          (error: unknown) => {
            for (const waiter of waiters) waiter.reject(error)
          }
        )
      }
    }
  }

  return {
    load(
      workspaceId: string,
      kind: WorkspaceFileLookupKind,
      value: string,
      signal?: AbortSignal
    ): Promise<WorkspaceFileRecord | null> {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason)
          return
        }
        const entry: PendingLookup = { kind, value, resolve, reject }
        const entries = pending.get(workspaceId)
        if (entries) entries.push(entry)
        else pending.set(workspaceId, [entry])
        signal?.addEventListener(
          'abort',
          () => {
            const queued = pending.get(workspaceId)
            const index = queued?.indexOf(entry) ?? -1
            if (queued && index !== -1) queued.splice(index, 1)
            reject(signal.reason)
          },
          { once: true }
        )
        if (!scheduled) {
          scheduled = true
          setTimeout(flush, 0)
        }
      })
    },
  }
}
