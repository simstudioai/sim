import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { authenticateApiKey } from '@/lib/security/api-key-auth'
import { getWorkflowById } from '@/lib/workflows/utils'
import { db } from '@/db'
import { apiKey, workspace } from '@/db/schema'

const logger = createLogger('WorkflowMiddleware')

export interface ValidationResult {
  error?: { message: string; status: number }
  workflow?: any
}

export async function validateWorkflowAccess(
  request: NextRequest,
  workflowId: string,
  requireDeployment = true
): Promise<ValidationResult> {
  try {
    const workflow = await getWorkflowById(workflowId)
    if (!workflow) {
      return {
        error: {
          message: 'Workflow not found',
          status: 404,
        },
      }
    }

    if (requireDeployment) {
      if (!workflow.isDeployed) {
        return {
          error: {
            message: 'Workflow is not deployed',
            status: 403,
          },
        }
      }

      // API key authentication
      let apiKeyHeader = null
      for (const [key, value] of request.headers.entries()) {
        if (key.toLowerCase() === 'x-api-key' && value) {
          apiKeyHeader = value
          break
        }
      }

      if (!apiKeyHeader) {
        return {
          error: {
            message: 'Unauthorized: API key required',
            status: 401,
          },
        }
      }

      // If a pinned key exists, only accept that specific key
      if (workflow.pinnedApiKey?.key) {
        const isValidPinnedKey = await authenticateApiKey(apiKeyHeader, workflow.pinnedApiKey.key)
        if (!isValidPinnedKey) {
          return {
            error: {
              message: 'Unauthorized: Invalid API key',
              status: 401,
            },
          }
        }
      } else {
        // Check both personal API keys and workspace API keys
        const personalKeys = await db
          .select({
            id: apiKey.id,
            key: apiKey.key,
          })
          .from(apiKey)
          .where(and(eq(apiKey.userId, workflow.userId as string), eq(apiKey.type, 'personal')))

        let validPersonalKey = null

        for (const key of personalKeys) {
          const isValid = await authenticateApiKey(apiKeyHeader, key.key)
          if (isValid) {
            validPersonalKey = key
            break
          }
        }

        let validWorkspaceKey = null
        if (!validPersonalKey && workflow.workspaceId) {
          const workspaceKeys = await db
            .select({
              id: apiKey.id,
              key: apiKey.key,
              workspaceId: apiKey.workspaceId,
            })
            .from(apiKey)
            .leftJoin(workspace, eq(apiKey.workspaceId, workspace.id))
            .where(
              and(eq(workspace.id, workflow.workspaceId as string), eq(apiKey.type, 'workspace'))
            ) // Key must belong to the same workspace as the workflow and be a workspace key

          for (const key of workspaceKeys) {
            const isValid = await authenticateApiKey(apiKeyHeader, key.key)
            if (isValid) {
              validWorkspaceKey = key
              break
            }
          }
        }

        // If neither personal nor workspace key is valid, reject
        if (!validPersonalKey && !validWorkspaceKey) {
          return {
            error: {
              message: 'Unauthorized: Invalid API key',
              status: 401,
            },
          }
        }

        // Update last used timestamp for valid keys
        if (validPersonalKey) {
          await db
            .update(apiKey)
            .set({ lastUsed: new Date() })
            .where(eq(apiKey.id, validPersonalKey.id))
        } else if (validWorkspaceKey) {
          await db
            .update(apiKey)
            .set({ lastUsed: new Date() })
            .where(eq(apiKey.id, validWorkspaceKey.id))
        }
      }
    }
    return { workflow }
  } catch (error) {
    logger.error('Validation error:', { error })
    return {
      error: {
        message: 'Internal server error',
        status: 500,
      },
    }
  }
}
