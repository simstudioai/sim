import { FILE_DOC_TIMEOUTS } from '@sim/realtime-protocol/file-doc'
import { env, getBaseUrl } from '@/env'

/**
 * The relay's client for the app's internal file-doc endpoints. The app owns the markdown↔Yjs
 * conversion engine (TipTap + jsdom) and blob/DB access; the relay owns the live document. So for any
 * operation that needs conversion, the relay delegates here over the shared `x-api-key` channel. The
 * timeouts (and their ordering vs. the app-side bounds) live in the shared `FILE_DOC_TIMEOUTS`.
 */

function postToApp(path: string, payload: unknown, timeoutMs: number): Promise<Response> {
  return fetch(`${getBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.INTERNAL_API_SECRET },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  })
}

/**
 * Ask the app to build a server-authoritative seed (markdown → Yjs) for a file's collaborative
 * document. Returns the Yjs update to apply, or `null` for a genuinely empty/missing file (an empty
 * document is correct). THROWS on a transport failure (non-2xx / network / timeout / malformed body)
 * so the caller can tell a real empty from a failure it should be allowed to retry.
 */
export async function fetchFileDocSeed(
  workspaceId: string,
  fileId: string
): Promise<{ update: Uint8Array; version: number } | null> {
  const response = await postToApp(
    '/api/internal/file-doc/seed',
    { workspaceId, fileId },
    FILE_DOC_TIMEOUTS.seedRequestMs
  )
  if (!response.ok) {
    throw new Error(`Seed fetch failed for file ${fileId}: ${response.status}`)
  }
  const body = (await response.json()) as { update?: unknown; version?: unknown }
  const update = body?.update
  // A well-formed response is `{ update: base64-string | null, version: number | null }`. Anything
  // else is a contract violation, not a "genuinely empty file" — throw so the caller retries rather
  // than silently treating a malformed body as empty and stranding the room unseeded.
  if (update === null) return null
  if (typeof update !== 'string' || typeof body?.version !== 'number') {
    throw new Error(`Seed fetch for file ${fileId} returned a malformed body`)
  }
  return { update: new Uint8Array(Buffer.from(update, 'base64')), version: body.version }
}

/**
 * Ask the app to merge new markdown into the live document as a minimal Yjs diff — Stage C, so a
 * copilot edit streams into open editors instead of the file changing underneath them. The relay
 * ships the document's current state and applies the returned diff (which Yjs reconciles with any
 * concurrent user edits). THROWS on a transport failure or malformed body.
 */
export async function fetchFileDocMerge(
  fileId: string,
  docState: Uint8Array,
  markdown: string
): Promise<Uint8Array> {
  const response = await postToApp(
    '/api/internal/file-doc/merge',
    { fileId, docState: Buffer.from(docState).toString('base64'), markdown },
    FILE_DOC_TIMEOUTS.mergeRequestMs
  )
  if (!response.ok) {
    throw new Error(`Merge fetch failed for file ${fileId}: ${response.status}`)
  }
  const body = (await response.json()) as { update?: unknown }
  if (typeof body?.update !== 'string') {
    throw new Error(`Merge fetch for file ${fileId} returned a malformed body`)
  }
  return new Uint8Array(Buffer.from(body.update, 'base64'))
}

/**
 * Result of a persist attempt (mirrors the app's `persistFileDoc` contract):
 * - `persisted` — written; `version` is the new durable version the relay records as synced.
 * - `missing` — the file is gone.
 * - `conflict` — the file changed out-of-band since `expectedVersion`; NOT written. `markdown` +
 *   `version` are the current durable content + version so the relay reconciles and re-persists.
 */
export type PersistResult =
  | { status: 'persisted'; version: number }
  | { status: 'missing' }
  | { status: 'conflict'; markdown: string; version: number }
  | { status: 'deferred' }

/**
 * Ask the app to project a live collaborative document back to durable markdown and write it to the
 * file (Yjs → markdown, through the exact editor engine) — the server-authoritative durable path that
 * replaces the editor's client autosave. `expectedVersion` (the durable version the live doc synced
 * from) is the optimistic-concurrency guard: on a mismatch the app returns `conflict` (rather than
 * clobbering) so the caller reconciles and retries. THROWS only on a transport/contract failure.
 */
export async function fetchFileDocPersist(
  workspaceId: string,
  fileId: string,
  userId: string,
  docState: Uint8Array,
  expectedVersion?: number
): Promise<PersistResult> {
  const response = await postToApp(
    '/api/internal/file-doc/persist',
    {
      workspaceId,
      fileId,
      userId,
      docState: Buffer.from(docState).toString('base64'),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    },
    FILE_DOC_TIMEOUTS.persistRequestMs
  )
  if (!response.ok) {
    throw new Error(`Persist failed for file ${fileId}: ${response.status}`)
  }
  const body = (await response.json()) as PersistResult
  if (
    body?.status !== 'persisted' &&
    body?.status !== 'missing' &&
    body?.status !== 'conflict' &&
    body?.status !== 'deferred'
  ) {
    throw new Error(`Persist for file ${fileId} returned a malformed body`)
  }
  return body
}
