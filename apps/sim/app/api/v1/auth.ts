import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { apiKey as apiKeyTable, workflow, workspace, workspaceApiKey } from '@/db/schema'

const logger = createLogger('V1Auth')

export interface AuthResult {
  authenticated: boolean
  userId?: string
  workspaceId?: string
  keyType?: 'personal' | 'workspace'
  error?: string
}

export async function authenticateApiKey(
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
    const [personalKey] = await db
      .select({
        userId: apiKeyTable.userId,
        expiresAt: apiKeyTable.expiresAt,
      })
      .from(apiKeyTable)
      .where(eq(apiKeyTable.key, apiKey))
      .limit(1)

    if (personalKey) {
      if (personalKey.expiresAt && personalKey.expiresAt < new Date()) {
        logger.warn('Expired personal API key attempted', { userId: personalKey.userId })
        return {
          authenticated: false,
          error: 'API key expired',
        }
      }

      await db.update(apiKeyTable).set({ lastUsed: new Date() }).where(eq(apiKeyTable.key, apiKey))

      return {
        authenticated: true,
        userId: personalKey.userId,
        keyType: 'personal',
      }
    }

    const [workspaceKey] = await db
      .select({
        workspaceId: workspaceApiKey.workspaceId,
        expiresAt: workspaceApiKey.expiresAt,
        workspaceOwnerId: workspace.ownerId,
      })
      .from(workspaceApiKey)
      .leftJoin(workspace, eq(workspaceApiKey.workspaceId, workspace.id))
      .where(eq(workspaceApiKey.key, apiKey))
      .limit(1)

    if (workspaceKey) {
      if (workspaceKey.expiresAt && workspaceKey.expiresAt < new Date()) {
        logger.warn('Expired workspace API key attempted', {
          workspaceId: workspaceKey.workspaceId,
        })
        return {
          authenticated: false,
          error: 'API key expired',
        }
      }

      if (workflowId) {
        const [workflowRecord] = await db
          .select({
            workspaceId: workflow.workspaceId,
          })
          .from(workflow)
          .where(eq(workflow.id, workflowId))
          .limit(1)

        if (!workflowRecord || workflowRecord.workspaceId !== workspaceKey.workspaceId) {
          logger.warn('Workspace API key attempted to access workflow from different workspace', {
            workspaceId: workspaceKey.workspaceId,
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
        .update(workspaceApiKey)
        .set({ lastUsed: new Date() })
        .where(eq(workspaceApiKey.key, apiKey))

      return {
        authenticated: true,
        userId: workspaceKey.workspaceOwnerId!,
        workspaceId: workspaceKey.workspaceId,
        keyType: 'workspace',
      }
    }

    logger.warn('Invalid API key attempted', { keyPrefix: apiKey.slice(0, 8) })
    return {
      authenticated: false,
      error: 'Invalid API key',
    }
  } catch (error) {
    logger.error('API key authentication error', { error })
    return {
      authenticated: false,
      error: 'Authentication failed',
    }
  }
}
