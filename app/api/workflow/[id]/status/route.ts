import { NextRequest } from 'next/server'
import { validateWorkflowAccess } from '../../middleware'
import { createErrorResponse, createSuccessResponse } from '../../utils'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const validation = await validateWorkflowAccess(request, id, false)
    if (validation.error) {
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    return createSuccessResponse({
      isDeployed: validation.workflow.isDeployed,
      deployedAt: validation.workflow.deployedAt,
    })
  } catch (error) {
    return createErrorResponse('Failed to get status', 500)
  }
}
