import { env, getBaseUrl } from '@/env'

/**
 * The relay's client for the app's internal file-doc endpoints. The app owns the markdown↔Yjs
 * conversion engine (TipTap + jsdom) and blob/DB access; the relay owns the live document. So for any
 * operation that needs conversion, the relay delegates here over the shared `x-api-key` channel.
 */

/**
 * Bound each request so a slow/unreachable app never wedges the relay. 8s is generous for the
 * underlying markdown↔Yjs conversion — collab is gated client-side to ≤256 KB documents
 * (`isRoundTripSafe`), which convert in well under a second. The seed additionally must stay under the
 * client's readiness deadline (`READINESS_DEADLINE_MS`, 12s, in `file-doc-provider.ts`), which this
 * satisfies.
 */
const APP_REQUEST_TIMEOUT_MS = 8_000

function postToApp(path: string, payload: unknown): Promise<Response> {
  return fetch(`${getBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.INTERNAL_API_SECRET },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(APP_REQUEST_TIMEOUT_MS),
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
  const response = await postToApp('/api/internal/file-doc/seed', { workspaceId, fileId })
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
  const response = await postToApp('/api/internal/file-doc/merge', {
    fileId,
    docState: Buffer.from(docState).toString('base64'),
    markdown,
  })
  if (!response.ok) {
    throw new Error(`Merge fetch failed for file ${fileId}: ${response.status}`)
  }
  const body = (await response.json()) as { update?: unknown }
  if (typeof body?.update !== 'string') {
    throw new Error(`Merge fetch for file ${fileId} returned a malformed body`)
  }
  return new Uint8Array(Buffer.from(body.update, 'base64'))
}
