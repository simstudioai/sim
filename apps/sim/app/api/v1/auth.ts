import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { authenticateApiKey } from '@/lib/security/api-key-auth'
import { db } from '@/db'
import { apiKey as apiKeyTable, workflow, workspace } from '@/db/schema'

const logger = createLogger('V1Auth')

export interface AuthResult {
  authenticated: boolean
  userId?: string
  workspaceId?: string
  keyType?: 'personal' | 'workspace'
  error?: string
}

export async function authenticateV1Request(
  request: NextRequest,
  workflowId?: string
): Promise<AuthResult> {
  const apiKey = request.headers.get('x-api-key')

  if (!apiKey) {
    return {
      authenticated: false,
      error: 'API key required',
    }
  }

  try {
    // Fetch all API keys with workspace context and test each one with encrypted authentication
    const keyRecords = await db
      .select({
        id: apiKeyTable.id,
        userId: apiKeyTable.userId,
        workspaceId: apiKeyTable.workspaceId,
        type: apiKeyTable.type,
        expiresAt: apiKeyTable.expiresAt,
        key: apiKeyTable.key,
        workspaceOwnerId: workspace.ownerId,
      })
      .from(apiKeyTable)
      .leftJoin(workspace, eq(apiKeyTable.workspaceId, workspace.id))

    let validKeyRecord = null

    for (const storedKeyRecord of keyRecords) {
      // Check if key is expired
      if (storedKeyRecord.expiresAt && storedKeyRecord.expiresAt < new Date()) {
        continue
      }

      try {
        const isValid = await authenticateApiKey(apiKey, storedKeyRecord.key)
        if (isValid) {
          validKeyRecord = storedKeyRecord
          break
        }
      } catch (error) {
        logger.error('Error authenticating API key:', error)
      }
    }

    if (!validKeyRecord) {
      logger.warn('Invalid API key attempted', { keyPrefix: apiKey.slice(0, 8) })
      return {
        authenticated: false,
        error: 'Invalid API key',
      }
    }

    const keyRecord = validKeyRecord

    if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
      logger.warn('Expired API key attempted', {
        userId: keyRecord.userId,
        type: keyRecord.type,
      })
      return {
        authenticated: false,
        error: 'API key expired',
      }
    }

    // Handle personal keys
    if (keyRecord.type === 'personal') {
      await db
        .update(apiKeyTable)
        .set({ lastUsed: new Date() })
        .where(eq(apiKeyTable.id, keyRecord.id))

      return {
        authenticated: true,
        userId: keyRecord.userId!,
        keyType: 'personal',
      }
    }

    // Handle workspace keys
    if (keyRecord.type === 'workspace' && keyRecord.workspaceId) {
      if (workflowId) {
        const [workflowRecord] = await db
          .select({
            workspaceId: workflow.workspaceId,
          })
          .from(workflow)
          .where(eq(workflow.id, workflowId))
          .limit(1)

        if (!workflowRecord || workflowRecord.workspaceId !== keyRecord.workspaceId) {
          logger.warn('Workspace API key attempted to access workflow from different workspace', {
            workspaceId: keyRecord.workspaceId,
            workflowId,
            workflowWorkspaceId: workflowRecord?.workspaceId,
          })
          return {
            authenticated: false,
            error: 'API key not authorized for this workflow',
          }
        }
      }

      await db
        .update(apiKeyTable)
        .set({ lastUsed: new Date() })
        .where(eq(apiKeyTable.id, keyRecord.id))

      return {
        authenticated: true,
        userId: keyRecord.workspaceOwnerId!,
        workspaceId: keyRecord.workspaceId!,
        keyType: 'workspace',
      }
    }

    // This shouldn't happen since we check for personal and workspace types
    logger.warn('Unknown API key type', { type: keyRecord.type })
    return {
      authenticated: false,
      error: 'Invalid API key type',
    }
  } catch (error) {
    logger.error('API key authentication error', { error })
    return {
      authenticated: false,
      error: 'Authentication failed',
    }
  }
}
