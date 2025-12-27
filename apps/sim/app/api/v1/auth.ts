import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { authenticateApiKeyFromHeader, updateApiKeyLastUsed } from '@/lib/api-key/service'
import { ANONYMOUS_USER_ID } from '@/lib/auth/constants'
import { isAuthDisabled } from '@/lib/core/config/feature-flags'

const logger = createLogger('V1Auth')

export interface AuthResult {
  authenticated: boolean
  userId?: string
  workspaceId?: string
  keyType?: 'personal' | 'workspace'
  error?: string
}

export async function authenticateV1Request(request: NextRequest): Promise<AuthResult> {
  if (isAuthDisabled) {
    return {
      authenticated: true,
      userId: ANONYMOUS_USER_ID,
      keyType: 'personal',
    }
  }

  const apiKey = request.headers.get('x-api-key')

  if (!apiKey) {
    return {
      authenticated: false,
      error: 'API key required',
    }
  }

  try {
    const result = await authenticateApiKeyFromHeader(apiKey)

    if (!result.success) {
      logger.warn('Invalid API key attempted', { keyPrefix: apiKey.slice(0, 8) })
      return {
        authenticated: false,
        error: result.error || 'Invalid API key',
      }
    }

    await updateApiKeyLastUsed(result.keyId!)

    return {
      authenticated: true,
      userId: result.userId!,
      workspaceId: result.workspaceId,
      keyType: result.keyType,
    }
  } catch (error) {
    logger.error('API key authentication error', { error })
    return {
      authenticated: false,
      error: 'Authentication failed',
    }
  }
}
