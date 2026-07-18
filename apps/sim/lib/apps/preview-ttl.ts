import { randomBytes } from 'node:crypto'

/** Preview pin sliding window (plan-locked). */
export const PREVIEW_PIN_TTL_MS = 4 * 60 * 60 * 1000
/** Builder should heartbeat at least this often. */
export const PREVIEW_HEARTBEAT_MAX_INTERVAL_MS = 5 * 60 * 1000
/** Hard max session age from session start. */
export const PREVIEW_SESSION_HARD_MAX_MS = 24 * 60 * 60 * 1000

export function previewPinExpiresAt(from = Date.now()): Date {
  return new Date(from + PREVIEW_PIN_TTL_MS)
}

export function previewPinExpiresAtForSession(sessionStartedAt: Date, from = Date.now()): Date {
  return new Date(
    Math.min(from + PREVIEW_PIN_TTL_MS, sessionStartedAt.getTime() + PREVIEW_SESSION_HARD_MAX_MS)
  )
}

export function isPreviewSessionPastHardMax(sessionStartedAt: Date, now = Date.now()): boolean {
  return now - sessionStartedAt.getTime() > PREVIEW_SESSION_HARD_MAX_MS
}

/** Server-minted preview capability nonce (≥128 bits). */
export function mintPreviewChannelNonce(): string {
  return randomBytes(32).toString('base64url')
}
