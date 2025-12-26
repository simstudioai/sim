/**
 * Admin API Authentication
 *
 * Authenticates admin API requests using the ADMIN_API_KEY environment variable.
 * Designed for self-hosted deployments where GitOps/scripted access is needed.
 *
 * Usage:
 *   curl -H "x-admin-key: your_admin_key" https://your-instance/api/v1/admin/...
 */

import { createHash, timingSafeEqual } from 'crypto'
import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { env } from '@/lib/core/config/env'

const logger = createLogger('AdminAuth')

export interface AdminAuthSuccess {
  authenticated: true
}

export interface AdminAuthFailure {
  authenticated: false
  error: string
  notConfigured?: boolean
}

export type AdminAuthResult = AdminAuthSuccess | AdminAuthFailure

/**
 * Authenticate an admin API request.
 *
 * @param request - The incoming Next.js request
 * @returns Authentication result with success status and optional error
 */
export function authenticateAdminRequest(request: NextRequest): AdminAuthResult {
  const adminKey = env.ADMIN_API_KEY

  if (!adminKey) {
    logger.warn('ADMIN_API_KEY environment variable is not set')
    return {
      authenticated: false,
      error: 'Admin API is not configured. Set ADMIN_API_KEY environment variable.',
      notConfigured: true,
    }
  }

  const providedKey = request.headers.get('x-admin-key')

  if (!providedKey) {
    return {
      authenticated: false,
      error: 'Admin API key required. Provide x-admin-key header.',
    }
  }

  if (!constantTimeCompare(providedKey, adminKey)) {
    logger.warn('Invalid admin API key attempted', { keyPrefix: providedKey.slice(0, 8) })
    return {
      authenticated: false,
      error: 'Invalid admin API key',
    }
  }

  return { authenticated: true }
}

/**
 * Constant-time string comparison.
 *
 * @param a - First string to compare
 * @param b - Second string to compare
 * @returns True if strings are equal, false otherwise
 */
function constantTimeCompare(a: string, b: string): boolean {
  const aHash = createHash('sha256').update(a).digest()
  const bHash = createHash('sha256').update(b).digest()
  return timingSafeEqual(aHash, bHash)
}
