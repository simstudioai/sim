import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { validateApiKey } from '@/lib/utils'
import { getWorkflowById } from '@/lib/workflows'

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

    // Check deployment status if required
    if (requireDeployment && !workflow.isDeployed) {
      return {
        error: {
          message: 'Workflow is not deployed',
          status: 403,
        },
      }
    }

    // Try API key authentication first
    const apiKey = request.headers.get('x-api-key')
    if (apiKey && workflow.apiKey) {
      const isValidApiKey = await validateApiKey(apiKey, workflow.apiKey)
      if (isValidApiKey) {
        return { workflow }
      }
    }

    // Fall back to session auth
    const session = await auth.api.getSession({
      headers: request.headers,
    })

    const isOwner = session?.user?.id === workflow.userId
    if (!isOwner) {
      return {
        error: {
          message: 'Unauthorized',
          status: 401,
        },
      }
    }

    return { workflow }
  } catch (error) {
    console.error('Validation error:', error)
    return {
      error: {
        message: 'Internal server error',
        status: 500,
      },
    }
  }
}
