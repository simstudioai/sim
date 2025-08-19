import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { authenticateCopilotRequestSessionOnly } from '@/lib/copilot/auth'
import { copilotToolRegistry } from '@/lib/copilot/tools/server-tools/registry'

const logger = createLogger('CopilotWorkflowsEditExecuteAPI')

const Schema = z.object({
  operations: z.array(z.object({}).passthrough()),
  workflowId: z.string().min(1),
  currentUserWorkflow: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID()
  const start = Date.now()

  try {
    const sessionAuth = await authenticateCopilotRequestSessionOnly()
    if (!sessionAuth.isAuthenticated) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const params = Schema.parse(body)

    logger.info(`[${requestId}] Executing edit_workflow (logic-only)`, {
      workflowId: params.workflowId,
      operationCount: params.operations.length,
      hasCurrentUserWorkflow: !!params.currentUserWorkflow,
    })

    // Execute the server tool WITHOUT emitting completion to sim-agent
    const result = await copilotToolRegistry.execute('edit_workflow', params)

    const duration = Date.now() - start
    logger.info(`[${requestId}] edit_workflow (logic-only) completed`, {
      success: result.success,
      duration,
    })

    return NextResponse.json(result, { status: result.success ? 200 : 400 })
  } catch (error) {
    logger.error('Logic execution failed for edit_workflow', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors.map((e) => e.message).join(', ') },
        { status: 400 }
      )
    }
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
} 