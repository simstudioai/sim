import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
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

      // Verify API key belongs to the user who owns the workflow
      const userApiKeys = await db
        .select({
          key: apiKey.key,
        })
        .from(apiKey)
        .where(eq(apiKey.userId, workflow.userId))

      const validApiKey = userApiKeys.some((k) => k.key === apiKeyHeader)

      if (!validApiKey) {
        return {
          error: {
            message: 'Unauthorized: Invalid API key',
            status: 401,
          },
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
