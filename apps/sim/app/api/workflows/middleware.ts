import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { getWorkflowById } from '@/lib/workflows/utils'
import { db } from '@/db'
import { apiKey, workspace, workspaceApiKey } from '@/db/schema'

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
      if (workflow.pinnedApiKey) {
        if (workflow.pinnedApiKey !== apiKeyHeader) {
          return {
            error: {
              message: 'Unauthorized: Invalid API key',
              status: 401,
            },
          }
        }
      } else {
        // Check both personal API keys and workspace API keys

        // First, check personal API keys belonging to the workflow owner
        const [personalKey] = await db
          .select({ key: apiKey.key })
          .from(apiKey)
          .where(and(eq(apiKey.userId, workflow.userId), eq(apiKey.key, apiKeyHeader)))
          .limit(1)

        // If not found in personal keys, check workspace API keys
        let workspaceKey = null
        if (!personalKey) {
          const [wsKey] = await db
            .select({
              key: workspaceApiKey.key,
              workspaceId: workspaceApiKey.workspaceId,
              workspaceOwnerId: workspace.ownerId,
            })
            .from(workspaceApiKey)
            .leftJoin(workspace, eq(workspaceApiKey.workspaceId, workspace.id))
            .where(
              and(
                eq(workspaceApiKey.key, apiKeyHeader),
                eq(workspace.id, workflow.workspaceId) // Key must belong to the same workspace as the workflow
              )
            )
            .limit(1)

          workspaceKey = wsKey
        }

        // If neither personal nor workspace key is valid, reject
        if (!personalKey && !workspaceKey) {
          return {
            error: {
              message: 'Unauthorized: Invalid API key',
              status: 401,
            },
          }
        }

        // Update last used for the key that was found
        if (personalKey) {
          await db.update(apiKey).set({ lastUsed: new Date() }).where(eq(apiKey.key, apiKeyHeader))
        } else if (workspaceKey) {
          await db
            .update(workspaceApiKey)
            .set({ lastUsed: new Date() })
            .where(eq(workspaceApiKey.key, apiKeyHeader))
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
