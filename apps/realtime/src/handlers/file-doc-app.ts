import { env, getBaseUrl } from '@/env'

/**
 * The relay's client for the app's internal file-doc endpoints. The app owns the markdown↔Yjs
 * conversion engine (TipTap + jsdom) and blob/DB access; the relay owns the live document. So for any
 * operation that needs conversion, the relay delegates here over the shared `x-api-key` channel.
 */

/**
 * The seed reads a (possibly cold) blob + converts it, so give it a generous bound. Collab is gated
 * client-side to ≤256 KB documents (`isRoundTripSafe`), so the conversion itself is well under a
 * second; the headroom is for the blob read. Stays under the client's readiness deadline
 * (`READINESS_DEADLINE_MS`, 12s, in `file-doc-provider.ts`), which it must.
 */
const SEED_REQUEST_TIMEOUT_MS = 8_000

/**
 * The merge is a PURE conversion (the caller supplies both the doc state and the markdown — no blob or
 * DB I/O), so it is fast and gets a tight bound. Critically it must stay BELOW the app→relay apply-edit
 * timeout (`APPLY_EDIT_TIMEOUT_MS`, in `apps/sim/lib/realtime/notify.ts`) that wraps this call — else
 * that outer request aborts while this inner one is still running, and the relay could apply a merge
 * after the caller has already moved on, racing a follow-on edit.
 */
const MERGE_REQUEST_TIMEOUT_MS = 3_000

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
): Promise<Uint8Array | null> {
  const response = await postToApp(
    '/api/internal/file-doc/seed',
    { workspaceId, fileId },
    SEED_REQUEST_TIMEOUT_MS
  )
  if (!response.ok) {
    throw new Error(`Seed fetch failed for file ${fileId}: ${response.status}`)
  }
  const body = (await response.json()) as { update?: unknown }
  const update = body?.update
  // A well-formed response is `{ update: base64-string | null }`. Anything else is a contract
  // violation, not a "genuinely empty file" — throw so the caller retries rather than silently
  // treating a malformed body as empty and stranding the room unseeded.
  if (update === null) return null
  if (typeof update !== 'string') {
    throw new Error(`Seed fetch for file ${fileId} returned a malformed body`)
  }
  return new Uint8Array(Buffer.from(update, 'base64'))
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
    MERGE_REQUEST_TIMEOUT_MS
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
