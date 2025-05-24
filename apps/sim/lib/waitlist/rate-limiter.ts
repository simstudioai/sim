import type { NextRequest } from 'next/server'
import { isProd } from '@/lib/environment'
import { getRedisClient } from '../redis'

// Configuration
const RATE_LIMIT_WINDOW = 60 // 1 minute window (in seconds)
const WAITLIST_MAX_REQUESTS = 5 // 5 requests per minute per IP
const WAITLIST_BLOCK_DURATION = 15 * 60 // 15 minutes block (in seconds)

// Fallback in-memory store for development or if Redis fails
const inMemoryStore = new Map<
  string,
  { count: number; timestamp: number; blocked: boolean; blockedUntil?: number }
>()

// Clean up in-memory store periodically (only used in development)
if (!isProd && typeof setInterval !== 'undefined') {
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

  // Get the shared Redis client
  const redisClient = getRedisClient()

  // Use Redis if available
  if (redisClient) {
    try {
      // Check if IP is blocked
      const isBlocked = await redisClient.get(`${key}:blocked`)

      if (isBlocked) {
        const ttl = await redisClient.ttl(`${key}:blocked`)
        if (ttl > 0) {
          return {
            limited: true,
            message: 'Too many requests. Please try again later.',
            remainingTime: ttl,
          }
        }
        // Block expired, remove it
        await redisClient.del(`${key}:blocked`)
      }

      // Increment counter with expiry
      const count = await redisClient.incr(key)

      // Set expiry on first request
      if (count === 1) {
        await redisClient.expire(key, RATE_LIMIT_WINDOW)
      }

      // If limit exceeded, block the IP
      if (count > WAITLIST_MAX_REQUESTS) {
        await redisClient.set(`${key}:blocked`, '1', 'EX', WAITLIST_BLOCK_DURATION)

        return {
          limited: true,
          message: 'Too many requests. Please try again later.',
          remainingTime: WAITLIST_BLOCK_DURATION,
        }
      }

      return { limited: false }
    } catch (error) {
      console.error('Redis rate limit error:', error)
      // Fall back to in-memory if Redis fails
    }
  }

  // In-memory fallback implementation
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
