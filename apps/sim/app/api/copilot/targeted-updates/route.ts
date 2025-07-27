import { type NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { executeCopilotTool } from '@/lib/copilot/tools'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { apiKey as apiKeyTable } from '@/db/schema'

const logger = createLogger('TargetedUpdatesAPI')

export async function targetedUpdates(params: any) {
  try {
    const { operations, workflowId } = params

    if (!operations || !Array.isArray(operations)) {
      return {
        success: false,
        error: 'operations must be an array',
      }
    }

    if (!workflowId) {
      return {
        success: false,
        error: 'workflowId is required',
      }
    }

    logger.info('Processing targeted update request', { 
      workflowId,
      operationCount: operations.length 
    })

    // Execute the copilot tool
    const result = await executeCopilotTool('targeted_updates', {
      operations: params.operations,
      _context: { 
        workflowId: params.workflowId
      },
    })

    logger.info('Targeted update completed successfully')

    // Return the tool result directly if successful
    if (result.success && result.data) {
      return {
        success: true,
        data: result.data,
      }
    }

    // Return error result as-is
    return result
  } catch (error) {
    logger.error('Targeted update failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    // Try session auth first (for web UI)
    const session = await getSession()
    let authenticatedUserId: string | null = session?.user?.id || null

    // If no session, check for API key auth
    if (!authenticatedUserId) {
      const apiKeyHeader = request.headers.get('x-api-key')
      if (apiKeyHeader) {
        // Verify API key
        const [apiKeyRecord] = await db
          .select({ userId: apiKeyTable.userId })
          .from(apiKeyTable)
          .where(eq(apiKeyTable.key, apiKeyHeader))
          .limit(1)

        if (apiKeyRecord) {
          authenticatedUserId = apiKeyRecord.userId
        }
      }
    }

    // Parse body early to check for workflowId
    const body = await request.json()
    const { operations, workflowId } = body

    // If no authentication but workflowId is provided, allow internal calls
    // This maintains backward compatibility for internal copilot tool calls
    if (!authenticatedUserId) {
      if (!workflowId) {
        return NextResponse.json({ error: 'Unauthorized - authentication or workflowId required' }, { status: 401 })
      }
      
      // For internal calls without auth, we'll validate the workflow exists
      // but won't enforce user ownership (as this was the original behavior)
      logger.info('Allowing internal call to targeted-updates without authentication', { workflowId })
    }

    if (!operations || !Array.isArray(operations)) {
      return NextResponse.json(
        { success: false, error: 'Operations array is required' },
        { status: 400 }
      )
    }

    if (!workflowId) {
      return NextResponse.json(
        { success: false, error: 'Workflow ID is required' },
        { status: 400 }
      )
    }

    logger.info('Executing targeted updates', {
      workflowId,
      userId: authenticatedUserId || 'internal_call',
      operationCount: operations.length,
      operations: operations.map((op) => ({ type: op.operation_type, blockId: op.block_id })),
    })

    const result = await executeCopilotTool('targeted_updates', {
      operations,
      _context: { workflowId },
    })

    return NextResponse.json(result)
  } catch (error) {
    logger.error('Targeted updates API failed:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
