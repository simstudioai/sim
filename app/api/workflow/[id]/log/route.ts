import { NextRequest } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { persistLog } from '@/lib/logging'
import { validateWorkflowAccess } from '../../middleware'
import { createErrorResponse, createSuccessResponse } from '../../utils'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const validation = await validateWorkflowAccess(request, id, false)
    if (validation.error) {
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    const body = await request.json()
    const { logs, executionId } = body

    // Persist each log
    for (const log of logs) {
      await persistLog({
        id: uuidv4(),
        workflowId: id,
        executionId,
        level: log.level,
        message: log.message,
        duration: log.duration,
        trigger: 'manual',
        createdAt: new Date(log.createdAt || new Date()),
      })
    }

    return createSuccessResponse({ message: 'Logs persisted successfully' })
  } catch (error: any) {
    console.error('Error persisting logs:', error)
    return createErrorResponse(error.message || 'Failed to persist logs', 500)
  }
}
