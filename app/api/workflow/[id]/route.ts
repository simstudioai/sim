import { NextRequest } from 'next/server'
import { Executor } from '@/executor'
import { SerializedWorkflow } from '@/serializer/types'
import { validateWorkflowAccess } from '../middleware'
import { createErrorResponse, createSuccessResponse } from '../utils'

export const dynamic = 'force-dynamic'

async function executeWorkflow(workflow: any, input?: any) {
  try {
    const executor = new Executor(workflow.state as SerializedWorkflow, input)
    const result = await executor.execute(workflow.id)
    return result
  } catch (error: any) {
    console.error('Workflow execution failed:', { workflowId: workflow.id, error })
    throw new Error(`Execution failed: ${error.message}`)
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    const validation = await validateWorkflowAccess(request, id)

    if (validation.error) {
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    const result = await executeWorkflow(validation.workflow)
    return createSuccessResponse(result)
  } catch (error: any) {
    console.error('Error executing workflow:', error)
    return createErrorResponse('Failed to execute workflow', 500, 'EXECUTION_ERROR')
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const validation = await validateWorkflowAccess(request, id)

    if (validation.error) {
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    const body = await request.json().catch(() => ({}))
    const result = await executeWorkflow(validation.workflow, body)
    return createSuccessResponse(result)
  } catch (error: any) {
    console.error('Error executing workflow:', error)
    return createErrorResponse('Failed to execute workflow', 500, 'EXECUTION_ERROR')
  }
}
