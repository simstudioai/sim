import { generateShortId } from '@sim/utils/id'

/**
 * Header naming the browser tab that sent a request.
 *
 * Shared by the client that sets it and the route handlers that read it. An opaque correlation
 * token, never an authorization input.
 */
export const CLIENT_ID_HEADER = 'x-sim-client-id'

/**
 * Generated ids are {@link generateShortId} length; the ceiling is slack for that, not a format.
 * Bounded because the value is caller-controlled and gets fanned out to every subscriber of a
 * table — uncapped, one request could inflate every broadcast payload it triggers.
 */
const MAX_CLIENT_ID_LENGTH = 64

let cachedClientId: string | undefined

/**
 * An id for this browser tab, generated once per page load and not stable across reloads.
 *
 * Deliberately per-TAB rather than per-user or per-session: its only consumer compares it against
 * the originator stamped on a broadcast, so two tabs belonging to the same user must not share one.
 * A shared id would make the second tab ignore the first tab's edits and silently go stale.
 *
 * Returns `undefined` on the server, where there is no tab to identify.
 */
export function getClientId(): string | undefined {
  if (typeof window === 'undefined') return undefined
  cachedClientId ??= generateShortId()
  return cachedClientId
}

/**
 * The sending tab's id, as seen by a route handler. Absent for server-to-server callers, for any
 * client that did not send one, and for an over-long value — all read as "unattributed", never as
 * "not the actor".
 *
 * Untrusted, and never safe to broadcast as-is: see {@link fingerprintClientId}.
 */
export function readClientId(request: Request): string | undefined {
  const raw = request.headers.get(CLIENT_ID_HEADER)
  return raw && raw.length <= MAX_CLIENT_ID_LENGTH ? raw : undefined
}

/**
 * One-way digest of a tab id, for naming the originator of a broadcast.
 *
 * The raw id must never travel on a broadcast. Every subscriber of a table sees every event, so a
 * raw id would be observable by any collaborator, who could then replay it as their own
 * `x-sim-client-id` — their write would be attributed to your tab, your tab would suppress its
 * refetch, and it would sit on stale rows. Publishing the digest instead means matching it
 * requires already knowing the id, which only the tab that generated it does.
 *
 * Web Crypto rather than `node:crypto` so one implementation serves both sides — the server
 * stamping the event and the browser recognising its own — with no chance of the two disagreeing.
 */
export async function fingerprintClientId(clientId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clientId))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

let cachedFingerprint: string | undefined

/**
 * This tab's fingerprint, as it appears on a broadcast it caused. `undefined` on the server, and
 * until the first digest resolves — callers must treat that as "not me" and take the normal path.
 */
export async function getClientFingerprint(): Promise<string | undefined> {
  const clientId = getClientId()
  if (!clientId) return undefined
  cachedFingerprint ??= await fingerprintClientId(clientId)
  return cachedFingerprint
}
