import type { NextRequest } from 'next/server'
import { authenticateApiKeyFromHeader, updateApiKeyLastUsed } from '@/lib/api-key/service'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('V1Auth')

export interface AuthResult {
  authenticated: boolean
  userId?: string
  workspaceId?: string
  keyType?: 'personal' | 'workspace'
  error?: string
}

export async function authenticateV1Request(request: NextRequest): Promise<AuthResult> {
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
