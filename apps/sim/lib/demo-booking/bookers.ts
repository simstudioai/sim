import { createHash } from 'node:crypto'
import { getRedisClient } from '@/lib/core/config/redis'

/** How long a submitted demo form vouches for a booking made with the same email. */
const BOOKER_TTL_SECONDS = 24 * 60 * 60

/** How long a booking keeps the lookup it claimed, which covers Cal.com's repeat deliveries. */
const CLAIM_TTL_SECONDS = 7 * 24 * 60 * 60

/**
 * How far the demo form vouched for an email. `verified` passed Turnstile.
 * `unverified` reached the server without a Turnstile pass the server could
 * check (the widget was blocked or unsupported, or Cloudflare was unreachable),
 * so a person may still be behind it.
 */
export type DemoBookerStatus = 'verified' | 'unverified'

/**
 * What a booking request finds for its attendee: the form's verdict, `unseen`
 * when no form submission vouches for the email, or `unavailable` when there is
 * no Redis to ask.
 */
export type DemoBookerLookup = DemoBookerStatus | 'unseen' | 'unavailable'

/** Keys on a hash, so Redis never holds a visitor's email address. */
function bookerKey(email: string): string {
  const digest = createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
  return `demo-booking:booker:${digest}`
}

/**
 * Records that the demo form vouched for an email. A `verified` record replaces
 * any earlier one; an `unverified` record never downgrades a `verified` one.
 */
export async function recordDemoBooker(email: string, status: DemoBookerStatus): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  if (status === 'verified') {
    await redis.set(bookerKey(email), status, 'EX', BOOKER_TTL_SECONDS)
  } else {
    await redis.set(bookerKey(email), status, 'EX', BOOKER_TTL_SECONDS, 'NX')
  }
}

function parseLookup(value: string | null): DemoBookerLookup | null {
  return value === 'verified' || value === 'unverified' || value === 'unseen' ? value : null
}

/**
 * Claims the email's record for one booking and remembers the result against
 * that booking. One form submission vouches for exactly one booking, and a
 * repeated webhook delivery for the same booking reads back the same lookup
 * instead of finding the record already spent. Of two concurrent deliveries,
 * the first to store its claim wins and the other adopts it.
 */
export async function claimDemoBooker(
  email: string,
  bookingUid: string
): Promise<DemoBookerLookup> {
  const redis = getRedisClient()
  if (!redis) return 'unavailable'

  const claimKey = `demo-booking:claim:${bookingUid}`
  const existing = parseLookup(await redis.get(claimKey))
  if (existing) return existing

  const lookup = parseLookup(await redis.getdel(bookerKey(email))) ?? 'unseen'
  const stored = await redis.set(claimKey, lookup, 'EX', CLAIM_TTL_SECONDS, 'NX')
  if (stored === 'OK') return lookup
  return parseLookup(await redis.get(claimKey)) ?? lookup
}
