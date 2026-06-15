import { env } from '@/lib/core/config/env'

/**
 * Maximum size of a webhook request body read into memory. The webhook receivers
 * are public and unauthenticated, so the body must be bounded before it is
 * buffered to prevent a memory-exhaustion DoS. Provider payloads rarely exceed a
 * few MB; defaults to 10 MB and is overridable via `WEBHOOK_MAX_REQUEST_BYTES`.
 *
 * Shared by every public webhook receiver so the cap is a single source of truth.
 */
export const WEBHOOK_MAX_BODY_BYTES =
  Number.parseInt(env.WEBHOOK_MAX_REQUEST_BYTES, 10) || 10 * 1024 * 1024
