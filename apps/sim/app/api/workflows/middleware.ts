import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import type { NextRequest } from 'next/server'
import { WORKSPACE_KEY_SCOPE_DENIED } from '@/lib/api-key/policy-messages'
import { type AuthResult, checkHybridAuth } from '@/lib/auth/hybrid'
import { getWorkflowById } from '@/lib/workflows/utils'

const logger = createLogger('WorkflowMiddleware')

export interface ValidationResult {
  error?: { message: string; status: number }
  workflow?: any
  auth?: AuthResult
}

export async function validateWorkflowAccess(
  request: NextRequest,
  workflowId: string
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

    if (!workflow.workspaceId) {
      return {
        error: {
          message:
            'This workflow is not attached to a workspace. Personal workflows are deprecated and cannot be accessed.',
          status: 403,
        },
      }
    }

    const auth = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return {
        error: {
          message: auth.error || 'Unauthorized',
          status: 401,
        },
      }
    }

    if (auth.apiKeyType === 'workspace' && auth.workspaceId !== workflow.workspaceId) {
      return {
        error: {
          message: WORKSPACE_KEY_SCOPE_DENIED,
          status: 403,
        },
      }
    }

    const authorization = await authorizeWorkflowByWorkspacePermission({
      workflowId,
      userId: auth.userId,
      action: 'read',
    })
    if (!authorization.allowed) {
      return {
        error: {
          message: authorization.message || 'Access denied',
          status: authorization.status,
        },
      }
    }

    return { workflow, auth }
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
