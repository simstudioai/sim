import { NextRequest } from 'next/server'

// Configuration
const RATE_LIMIT_WINDOW = 60 // 1 minute window (in seconds)
const WAITLIST_MAX_REQUESTS = 5 // 5 requests per minute per IP
const WAITLIST_BLOCK_DURATION = 15 * 60 // 15 minutes block (in seconds)

// In-memory store for rate limiting
const inMemoryStore = new Map<
  string,
  { count: number; timestamp: number; blocked: boolean; blockedUntil?: number }
>()

// Clean up in-memory store periodically
if (typeof setInterval !== 'undefined') {
  setInterval(
    () => {
      const now = Math.floor(Date.now() / 1000)

      for (const [key, data] of inMemoryStore.entries()) {
        if (data.blocked && data.blockedUntil && data.blockedUntil < now) {
          inMemoryStore.delete(key)
        } else if (!data.blocked && now - data.timestamp > RATE_LIMIT_WINDOW) {
          inMemoryStore.delete(key)
        }
      }
    },
    5 * 60 * 1000
  )
}

// Get client IP from request
export function getClientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')

  if (xff) {
    const ips = xff.split(',')
    return ips[0].trim()
  }

  return realIp || '0.0.0.0'
}

// Check if a request is rate limited
export async function isRateLimited(
  request: NextRequest,
  type: 'waitlist' = 'waitlist'
): Promise<{
  limited: boolean
  message?: string
  remainingTime?: number
}> {
  const clientIp = getClientIp(request)
  const key = `ratelimit:${type}:${clientIp}`
  const now = Math.floor(Date.now() / 1000)

  let record = inMemoryStore.get(key)

  // Check if IP is blocked
  if (record?.blocked) {
    if (record.blockedUntil && record.blockedUntil < now) {
      record = { count: 1, timestamp: now, blocked: false }
      inMemoryStore.set(key, record)
      return { limited: false }
    }

    const remainingTime = record.blockedUntil ? record.blockedUntil - now : WAITLIST_BLOCK_DURATION
    return {
      limited: true,
      message: 'Too many requests. Please try again later.',
      remainingTime,
    }
  }

  // If no record exists or window expired, create/reset it
  if (!record || now - record.timestamp > RATE_LIMIT_WINDOW) {
    record = { count: 1, timestamp: now, blocked: false }
    inMemoryStore.set(key, record)
    return { limited: false }
  }

  // Increment counter
  record.count++

  // If limit exceeded, block the IP
  if (record.count > WAITLIST_MAX_REQUESTS) {
    record.blocked = true
    record.blockedUntil = now + WAITLIST_BLOCK_DURATION
    inMemoryStore.set(key, record)

    return {
      limited: true,
      message: 'Too many requests. Please try again later.',
      remainingTime: WAITLIST_BLOCK_DURATION,
    }
  }

  inMemoryStore.set(key, record)
  return { limited: false }
}
