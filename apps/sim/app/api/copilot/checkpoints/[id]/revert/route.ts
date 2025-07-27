import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { verifyInternalToken } from '@/lib/auth/internal'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { apiKey as apiKeyTable, copilotCheckpoints, workflow as workflowTable } from '@/db/schema'

const logger = createLogger('RevertCheckpointAPI')

/**
 * POST /api/copilot/checkpoints/[id]/revert
 * Revert workflow to a specific checkpoint
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const checkpointId = (await params).id

  try {
    // Check for internal JWT token for server-side calls
    const authHeader = request.headers.get('authorization')
    let isInternalCall = false

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1]
      isInternalCall = await verifyInternalToken(token)
    }

    let authenticatedUserId: string | null = null

    if (isInternalCall) {
      // For internal calls, get the checkpoint owner as the user context
      const [checkpointData] = await db
        .select({ userId: copilotCheckpoints.userId })
        .from(copilotCheckpoints)
        .where(eq(copilotCheckpoints.id, checkpointId))
        .limit(1)
      
      if (!checkpointData) {
        return NextResponse.json({ error: 'Checkpoint not found' }, { status: 404 })
      }
      authenticatedUserId = checkpointData.userId
    } else {
      // Try session auth first (for web UI)
      const session = await getSession()
      authenticatedUserId = session?.user?.id || null

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

      if (!authenticatedUserId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    // TypeScript assertion: authenticatedUserId is guaranteed non-null at this point
    const userId = authenticatedUserId as string

    logger.info(`[${requestId}] Reverting to checkpoint: ${checkpointId}`, {
      userId,
    })

    // Get the checkpoint
    const checkpoint = await db
      .select()
      .from(copilotCheckpoints)
      .where(
        and(eq(copilotCheckpoints.id, checkpointId), eq(copilotCheckpoints.userId, userId))
      )
      .limit(1)

    if (!checkpoint.length) {
      return NextResponse.json({ error: 'Checkpoint not found' }, { status: 404 })
    }

    const checkpointData = checkpoint[0]
    const { workflowId, yaml: yamlContent } = checkpointData

    logger.info(`[${requestId}] Processing checkpoint revert`, {
      workflowId,
      yamlLength: yamlContent.length,
    })

    // Use the consolidated YAML endpoint instead of duplicating the processing logic
    const yamlEndpointUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/workflows/${workflowId}/yaml`

    const yamlResponse = await fetch(yamlEndpointUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        // Forward auth cookies from the original request
        Cookie: request.headers.get('Cookie') || '',
      },
      body: JSON.stringify({
        yamlContent,
        description: `Reverted to checkpoint from ${new Date(checkpointData.createdAt).toLocaleString()}`,
        source: 'checkpoint_revert',
        applyAutoLayout: true,
        createCheckpoint: false, // Don't create a checkpoint when reverting to one
      }),
    })

    if (!yamlResponse.ok) {
      const errorData = await yamlResponse.json()
      logger.error(`[${requestId}] Consolidated YAML endpoint failed:`, errorData)
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to revert checkpoint via YAML endpoint',
          details: errorData.errors || [errorData.error || 'Unknown error'],
        },
        { status: yamlResponse.status }
      )
    }

    const yamlResult = await yamlResponse.json()

    if (!yamlResult.success) {
      logger.error(`[${requestId}] YAML endpoint returned failure:`, yamlResult)
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to process checkpoint YAML',
          details: yamlResult.errors || ['Unknown error'],
        },
        { status: 400 }
      )
    }

    // Update workflow's lastSynced timestamp
    await db
      .update(workflowTable)
      .set({
        lastSynced: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workflowTable.id, workflowId))

    // Notify the socket server to tell clients to rehydrate stores from database
    try {
      const socketUrl = process.env.SOCKET_URL || 'http://localhost:3002'
      await fetch(`${socketUrl}/api/copilot-workflow-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId,
          description: `Reverted to checkpoint from ${new Date(checkpointData.createdAt).toLocaleString()}`,
        }),
      })
      logger.info(`[${requestId}] Notified socket server of checkpoint revert`)
    } catch (socketError) {
      logger.warn(`[${requestId}] Failed to notify socket server:`, socketError)
    }

    logger.info(`[${requestId}] Successfully reverted to checkpoint`)

    return NextResponse.json({
      success: true,
      message: `Successfully reverted to checkpoint from ${new Date(checkpointData.createdAt).toLocaleString()}`,
      summary: yamlResult.summary || `Restored workflow from checkpoint.`,
      warnings: yamlResult.warnings || [],
      data: yamlResult.data,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error reverting checkpoint:`, error)
    return NextResponse.json(
      {
        error: `Failed to revert checkpoint: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 }
    )
  }
}
