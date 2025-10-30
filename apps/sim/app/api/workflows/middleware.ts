import type { NextRequest } from 'next/server'
import {
  type ApiKeyAuthResult,
  authenticateApiKeyFromHeader,
  updateApiKeyLastUsed,
} from '@/lib/api-key/service'
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

      let validResult: ApiKeyAuthResult | null = null

      if (workflow.workspaceId) {
        const workspaceResult = await authenticateApiKeyFromHeader(apiKeyHeader, {
          workspaceId: workflow.workspaceId as string,
          keyTypes: ['workspace', 'personal'],
        })

        if (workspaceResult.success) {
          validResult = workspaceResult
        }
      } else {
        const personalResult = await authenticateApiKeyFromHeader(apiKeyHeader, {
          userId: workflow.userId as string,
          keyTypes: ['personal'],
        })

        if (personalResult.success) {
          validResult = personalResult
        }
      }

      if (!validResult) {
        return {
          error: {
            message: 'Unauthorized: Invalid API key',
            status: 401,
          },
        }
      }

      if (validResult.keyId) {
        await updateApiKeyLastUsed(validResult.keyId)
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
