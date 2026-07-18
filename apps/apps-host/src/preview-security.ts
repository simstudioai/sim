/**
 * Preview / serve-meta security helpers (pure — unit-tested).
 */

/** Escape JSON for embedding inside a HTML <script> element. */
export function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** Normalize to a precise http(s) origin; reject malformed values. */
export function normalizePreviewParentOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin
  } catch {
    return null
  }
}

/** Server-minted channel nonces are base64url; reject short / injectable values. */
export function isValidPreviewChannelNonce(nonce: string): boolean {
  return /^[A-Za-z0-9_-]{32,128}$/.test(nonce)
}

/** Canonical directory URL for a bare /a/{publicId}/{slug} document request. */
export function appDirectoryRedirect(
  publicOrigin: string,
  pathname: string,
  search: string,
  assetPath: string | undefined
): string | null {
  if (assetPath !== undefined || pathname.endsWith('/')) return null
  const target = new URL(`${pathname}/`, publicOrigin)
  target.search = search
  return target.toString()
}

/** Published document navigations must revalidate the current release pointer. */
export function isPublishedDocumentRequest(assetPath: string, acceptHeader: string): boolean {
  if (!assetPath || assetPath.endsWith('.html')) return true
  const looksLikeAsset = /\.[a-zA-Z0-9]{1,12}$/.test(assetPath)
  return !looksLikeAsset && acceptHeader.includes('text/html')
}

export function ttlLruGet<V extends { fetchedAt: number }>(
  map: Map<string, V>,
  key: string,
  ttlMs: number
): V | undefined {
  const value = map.get(key)
  if (!value) return undefined
  if (Date.now() - value.fetchedAt >= ttlMs) {
    map.delete(key)
    return undefined
  }
  map.delete(key)
  map.set(key, value)
  return value
}

export function ttlLruSet<V>(map: Map<string, V>, key: string, value: V, max: number): void {
  if (map.has(key)) map.delete(key)
  map.set(key, value)
  while (map.size > max) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}
