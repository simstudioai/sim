import type { NextRequest } from 'next/server'
import { authenticateApiKey } from '@/lib/api-key/auth'
import { authenticateApiKeyFromHeader, updateApiKeyLastUsed } from '@/lib/api-key/service'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { getWorkflowById } from '@/lib/workflows/utils'

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

      const internalSecret = request.headers.get('X-Internal-Secret')
      if (internalSecret === env.INTERNAL_API_SECRET) {
        return { workflow }
      }

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
        // Try personal keys first
        const personalResult = await authenticateApiKeyFromHeader(apiKeyHeader, {
          userId: workflow.userId as string,
          keyTypes: ['personal'],
        })

        let validResult = null
        if (personalResult.success) {
          validResult = personalResult
        } else if (workflow.workspaceId) {
          // Try workspace keys
          const workspaceResult = await authenticateApiKeyFromHeader(apiKeyHeader, {
            workspaceId: workflow.workspaceId as string,
            keyTypes: ['workspace'],
          })

          if (workspaceResult.success) {
            validResult = workspaceResult
          }
        }

        // If no valid key found, reject
        if (!validResult) {
          return {
            error: {
              message: 'Unauthorized: Invalid API key',
              status: 401,
            },
          }
        }

        await updateApiKeyLastUsed(validResult.keyId!)
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
