import { env, getBaseUrl } from '@/env'

/** Bound the seed fetch so a slow/unreachable app never wedges a room's first join. */
const SEED_FETCH_TIMEOUT_MS = 5000

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
  const { update } = (await response.json()) as { update: string | null }
  return update ? new Uint8Array(Buffer.from(update, 'base64')) : null
}
