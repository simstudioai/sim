import {
  ANONYMOUS_USER_ID,
  type PersonalApiKeyPrincipal,
  type WorkspaceApiKeyPrincipal,
} from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { apiKeyPrincipal } from '@/lib/api-key/principal'
import { authenticateApiKeyFromHeader, updateApiKeyLastUsed } from '@/lib/api-key/service'
import { isAuthDisabled } from '@/lib/core/config/env-flags'

const logger = createLogger('V1Auth')

export interface AuthResult {
  authenticated: boolean
  userId?: string
  workspaceId?: string
  keyType?: 'personal' | 'workspace'
  principal?: PersonalApiKeyPrincipal | WorkspaceApiKeyPrincipal
  error?: string
}

export async function authenticateV1Request(request: NextRequest): Promise<AuthResult> {
  if (isAuthDisabled) {
    return {
      authenticated: true,
      userId: ANONYMOUS_USER_ID,
      keyType: 'personal',
      principal: {
        kind: 'personal_api_key',
        userId: ANONYMOUS_USER_ID,
        keyId: 'auth-disabled',
        access: 'write',
      },
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

    const principal = apiKeyPrincipal(result)
    updateApiKeyLastUsed(principal.keyId)

    return {
      authenticated: true,
      userId: result.userId,
      workspaceId: result.workspaceId,
      keyType: result.keyType,
      principal,
    }
  } catch (error) {
    logger.error('API key authentication error', { error })
    return {
      authenticated: false,
      error: 'Authentication failed',
    }
  }
}
