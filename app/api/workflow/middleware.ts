import { NextRequest } from 'next/server'
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
      const apiKey =
        request.headers.get('x-api-key') || request.nextUrl.searchParams.get('X-API-KEY')
      if (!apiKey || !workflow.apiKey || apiKey !== workflow.apiKey) {
        return {
          error: {
            message: 'Unauthorized',
            status: 401,
          },
        }
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
