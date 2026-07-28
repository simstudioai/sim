import { env, getBaseUrl } from '@/env'

/**
 * Bound the seed fetch so a slow/unreachable app never wedges a room's first join. Sized for the
 * worst case the app allows — converting a `MAX_SEED_BYTES` (5 MB) document markdown→Yjs plus a cold
 * blob read — so a large-but-valid file is not perpetually timed out into the retry path.
 */
const SEED_FETCH_TIMEOUT_MS = 20_000

/**
 * Ask the app to build a server-authoritative seed (markdown → Yjs) for a file's collaborative
 * document. Only the app can — it owns the editor extensions + blob access — so the relay delegates
 * over the internal endpoint.
 *
 * Returns the Yjs update to apply, or `null` for a genuinely empty/missing file (an empty document
 * is correct). THROWS on a transport failure (non-2xx / network / timeout) so the caller can tell a
 * real empty from a failure it should be allowed to retry.
 */
export async function fetchFileDocSeed(
  workspaceId: string,
  fileId: string
): Promise<Uint8Array | null> {
  const response = await fetch(`${getBaseUrl()}/api/internal/file-doc/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.INTERNAL_API_SECRET },
    body: JSON.stringify({ workspaceId, fileId }),
    signal: AbortSignal.timeout(SEED_FETCH_TIMEOUT_MS),
  })
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
