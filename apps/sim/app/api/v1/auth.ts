import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { apiKey as apiKeyTable } from '@/db/schema'

const logger = createLogger('V1Auth')

export interface AuthResult {
  authenticated: boolean
  userId?: string
  error?: string
}

export async function authenticateApiKey(request: NextRequest): Promise<AuthResult> {
  const apiKey = request.headers.get('x-api-key')

  if (!apiKey) {
    return {
      authenticated: false,
      error: 'API key required',
    }
  }

  try {
    const [keyRecord] = await db
      .select({
        userId: apiKeyTable.userId,
        expiresAt: apiKeyTable.expiresAt,
      })
      .from(apiKeyTable)
      .where(eq(apiKeyTable.key, apiKey))
      .limit(1)

    if (!keyRecord) {
      logger.warn('Invalid API key attempted', { keyPrefix: apiKey.slice(0, 8) })
      return {
        authenticated: false,
        error: 'Invalid API key',
      }
    }

    if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
      logger.warn('Expired API key attempted', { userId: keyRecord.userId })
      return {
        authenticated: false,
        error: 'API key expired',
      }
    }

    await db.update(apiKeyTable).set({ lastUsed: new Date() }).where(eq(apiKeyTable.key, apiKey))

    return {
      authenticated: true,
      userId: keyRecord.userId,
    }
  } catch (error) {
    logger.error('API key authentication error', { error })
    return {
      authenticated: false,
      error: 'Authentication failed',
    }
  }
}
