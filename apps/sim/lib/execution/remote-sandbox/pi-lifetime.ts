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
 * {@link PI_SANDBOX_MAX_LIFETIME_MS}. Defaults to the cap: a run that finishes
 * kills its sandbox explicitly, so for the normal path the lifetime is a ceiling
 * rather than a budget. It is not entirely free — if the web process dies
 * mid-run the orphaned sandbox now bills until this ceiling instead of the SDK's
 * five minutes — but five minutes is short enough to kill live runs, which is
 * the bug this replaces.
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
