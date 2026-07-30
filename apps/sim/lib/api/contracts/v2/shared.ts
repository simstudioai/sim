import { z } from 'zod'

/**
 * Shared building blocks for the v2 API contract surface.
 *
 * v2 standardizes on a single response family across every endpoint:
 * - single resource:   `{ data: T }`
 * - list:              `{ data: T[], nextCursor: string | null }`
 * - error:             `{ error: { code, message, details? } }`
 *
 * Every list uses the opaque-cursor envelope (Stripe/Slack-style): `limit` +
 * `cursor` in, `{ data, nextCursor }` out. Cursors are opaque so the underlying
 * scheme (keyset / offset / full-set) can change without a contract change.
 * Total counts are not returned on lists — they're available on the parent
 * resource where relevant (e.g. `rowCount` on a table, `docCount` on a KB).
 *
 * Rate-limit state is carried in `X-RateLimit-*` response headers (not the
 * body). Usage limits are available from the dedicated usage endpoint rather
 * than being inlined into every response.
 */

/** Canonical v2 error envelope. */
export const v2ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
})

/** `{ data: T }` */
export const v2DataResponse = <T extends z.ZodType>(dataSchema: T) => z.object({ data: dataSchema })

/** `{ data: T[], nextCursor: string | null }` — the v2 list envelope. */
export const v2CursorListResponse = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    nextCursor: z.string().nullable(),
  })
