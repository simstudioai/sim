import { NextRequest } from 'next/server'
import { generateApiKey } from '@/lib/utils'
import { updateWorkflowDeploymentStatus } from '@/lib/workflows'
import { validateWorkflowAccess } from '../../middleware'
import { createErrorResponse, createSuccessResponse } from '../../utils'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const validation = await validateWorkflowAccess(request, params.id, false)
    if (validation.error) {
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    // Generate and store API key
    const apiKey = await generateApiKey()
    await updateWorkflowDeploymentStatus(params.id, true, apiKey)

    return createSuccessResponse({
      success: true,
      apiKey,
    })
  } catch (error: any) {
    console.error('Error deploying workflow:', error)
    return createErrorResponse('Failed to deploy workflow', 500, 'DEPLOYMENT_ERROR')
  }
}
