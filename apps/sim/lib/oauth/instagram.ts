import { z } from 'zod'

/** Refresh while the long-lived token still has this many days left. */
export const INSTAGRAM_PROACTIVE_REFRESH_THRESHOLD_DAYS = 14

/**
 * Meta rejects refresh until the long-lived token is at least 24 hours old.
 * @see https://developers.facebook.com/docs/instagram-platform/reference/refresh_access_token/
 */
export const INSTAGRAM_MIN_TOKEN_AGE_MS = 24 * 60 * 60 * 1000

const INSTAGRAM_ACCESS_TOKEN_MAX_LENGTH = 8192
const INSTAGRAM_GRAPH_ID_MAX_LENGTH = 256
const INSTAGRAM_PERMISSION_MAX_LENGTH = 256
const INSTAGRAM_PERMISSION_COUNT_MAX = 64
const INSTAGRAM_PROFILE_TEXT_MAX_LENGTH = 512
const INSTAGRAM_TOKEN_TYPE_MAX_LENGTH = 64
const INSTAGRAM_TOKEN_LIFETIME_MAX_SECONDS = 365 * 24 * 60 * 60

const instagramGraphIdSchema = z.union([
  z.string().min(1).max(INSTAGRAM_GRAPH_ID_MAX_LENGTH),
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
])

const instagramShortLivedTokenSchema = z.object({
  access_token: z.string().min(1).max(INSTAGRAM_ACCESS_TOKEN_MAX_LENGTH),
  user_id: instagramGraphIdSchema.optional(),
  permissions: z
    .union([
      z.string().min(1).max(INSTAGRAM_ACCESS_TOKEN_MAX_LENGTH),
      z
        .array(z.string().min(1).max(INSTAGRAM_PERMISSION_MAX_LENGTH))
        .max(INSTAGRAM_PERMISSION_COUNT_MAX),
    ])
    .optional(),
})

const instagramShortLivedTokenResponseSchema = z.union([
  instagramShortLivedTokenSchema,
  z.object({ data: z.array(instagramShortLivedTokenSchema).length(1) }),
])

export const instagramLongLivedTokenResponseSchema = z.object({
  access_token: z.string().min(1).max(INSTAGRAM_ACCESS_TOKEN_MAX_LENGTH),
  token_type: z.string().min(1).max(INSTAGRAM_TOKEN_TYPE_MAX_LENGTH).optional(),
  expires_in: z.number().int().positive().max(INSTAGRAM_TOKEN_LIFETIME_MAX_SECONDS),
})

export const instagramProfileResponseSchema = z.object({
  user_id: instagramGraphIdSchema.optional(),
  id: instagramGraphIdSchema.optional(),
  username: z.string().max(INSTAGRAM_PROFILE_TEXT_MAX_LENGTH).optional(),
  name: z.string().max(INSTAGRAM_PROFILE_TEXT_MAX_LENGTH).optional(),
})

export type InstagramShortLivedToken = z.output<typeof instagramShortLivedTokenSchema>
export type InstagramLongLivedToken = z.output<typeof instagramLongLivedTokenResponseSchema>
export type InstagramProfile = z.output<typeof instagramProfileResponseSchema>

/** Parses the direct or legacy data-array shape returned by Instagram's code exchange. */
export function parseInstagramShortLivedToken(value: unknown): InstagramShortLivedToken | null {
  const parsed = instagramShortLivedTokenResponseSchema.safeParse(value)
  if (!parsed.success) return null
  return 'data' in parsed.data ? parsed.data.data[0] : parsed.data
}

/** Parses and bounds the long-lived access-token exchange response. */
export function parseInstagramLongLivedToken(value: unknown): InstagramLongLivedToken | null {
  const parsed = instagramLongLivedTokenResponseSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** Parses the subset of the Instagram profile response persisted during OAuth. */
export function parseInstagramProfile(value: unknown): InstagramProfile | null {
  const parsed = instagramProfileResponseSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function isInstagramProvider(providerId: string): boolean {
  return providerId === 'instagram'
}

/**
 * Whether an Instagram long-lived token should be refreshed before it expires.
 * Meta cannot refresh expired tokens, so we must refresh while still valid.
 */
export function shouldProactivelyRefreshInstagramToken(options: {
  accessTokenExpiresAt?: Date | null
  updatedAt?: Date | null
  now?: Date
}): boolean {
  const now = options.now ?? new Date()
  const expiresAt = options.accessTokenExpiresAt
  if (!expiresAt || expiresAt <= now) {
    return false
  }

  const updatedAt = options.updatedAt
  if (updatedAt && now.getTime() - updatedAt.getTime() < INSTAGRAM_MIN_TOKEN_AGE_MS) {
    return false
  }

  const proactiveThreshold = new Date(
    now.getTime() + INSTAGRAM_PROACTIVE_REFRESH_THRESHOLD_DAYS * 24 * 60 * 60 * 1000
  )
  return expiresAt <= proactiveThreshold
}
