import { generateId } from '@/lib/core/utils/uuid'
/**
 * Generate a short request ID for correlation
 */
export function generateRequestId(): string {
  return generateId().slice(0, 8)
}

/**
 * Extract the client IP from a request, checking `x-forwarded-for` then `x-real-ip`.
 */
export function getClientIp(request: { headers: { get(name: string): string | null } }): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown'
  )
}

/**
 * No-operation function for use as default callback
 */
export const noop = () => {}
