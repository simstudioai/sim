import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { copilotCheckpoints, workflow as workflowTable } from '@/db/schema'

const logger = createLogger('RevertCheckpointAPI')

/**
 * POST /api/copilot/checkpoints/[id]/revert
 * Revert workflow to a specific checkpoint
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const checkpointId = (await params).id

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    logger.info(`[${requestId}] Reverting to checkpoint: ${checkpointId}`, {
      userId: session.user.id,
    })

    // Get the checkpoint
    const checkpoint = await db
      .select()
      .from(copilotCheckpoints)
      .where(
        and(eq(copilotCheckpoints.id, checkpointId), eq(copilotCheckpoints.userId, session.user.id))
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
