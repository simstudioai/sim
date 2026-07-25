/**
 * How long a Pi sandbox may live. Separate from the provider adapters and the
 * `remote-sandbox` barrel so the Pi backends can cap their per-command timeouts
 * against the same number without importing the provider SDKs.
 */

import { env } from '@/lib/core/config/env'

/**
 * E2B documents a one-hour maximum sandbox lifetime for Hobby accounts (24 hours
 * for Pro) and rejects a create above it. The cap sits strictly below that hour:
 * one hour is the documented boundary, and betting on an exact-boundary create
 * buys nothing.
 */
export const PI_SANDBOX_MAX_LIFETIME_MS = 59 * 60 * 1000

/**
 * The lifetime requested for a Pi sandbox, always clamped to
 * {@link PI_SANDBOX_MAX_LIFETIME_MS}. Defaults to the cap because the sandbox is
 * killed explicitly when the run finishes — the lifetime is a ceiling that stops
 * an orphan from living forever, not a budget that costs anything to raise.
 *
 * `PI_SANDBOX_LIFETIME_MS` lowers it (a Pro account can raise the constant, but
 * the env var may only reduce it, so a misconfigured value cannot make every
 * create fail on a Hobby key).
 */
export function resolvePiSandboxLifetimeMs(): number {
  const configured = Number.parseInt(env.PI_SANDBOX_LIFETIME_MS ?? '', 10)
  if (!Number.isFinite(configured) || configured <= 0) return PI_SANDBOX_MAX_LIFETIME_MS
  return Math.min(configured, PI_SANDBOX_MAX_LIFETIME_MS)
}
