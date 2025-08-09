import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { getWorkflowById } from '@/lib/workflows/utils'
import { db } from '@/db'
import { apiKey } from '@/db/schema'

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
        // Otherwise, verify the key belongs to the workflow owner
        const [owned] = await db
          .select({ key: apiKey.key })
          .from(apiKey)
          .where(and(eq(apiKey.userId, workflow.userId), eq(apiKey.key, apiKeyHeader)))
          .limit(1)

        if (!owned) {
          return {
            error: {
              message: 'Unauthorized: Invalid API key',
              status: 401,
            },
          }
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
