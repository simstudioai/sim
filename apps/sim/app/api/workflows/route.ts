import crypto from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { workflow, workflowBlocks } from '@/db/schema'

const logger = createLogger('WorkflowAPI')

export const dynamic = 'force-dynamic'

// Schema for workflow creation
const CreateWorkflowSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional().default(''),
  color: z.string().optional().default('#3972F6'),
  workspaceId: z.string().optional(),
  folderId: z.string().nullable().optional(),
})

// POST /api/workflows - Create a new workflow
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const session = await getSession()

  if (!session?.user?.id) {
    logger.warn(`[${requestId}] Unauthorized workflow creation attempt`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { name, description, color, workspaceId, folderId } = CreateWorkflowSchema.parse(body)

    const workflowId = crypto.randomUUID()
    const starterId = crypto.randomUUID()
    const now = new Date()

    logger.info(`[${requestId}] Creating workflow ${workflowId} for user ${session.user.id}`)

    // Create initial state with start block
    const initialState = {
      blocks: {
        [starterId]: {
          id: starterId,
          type: 'starter',
          name: 'Start',
          position: { x: 100, y: 100 },
          subBlocks: {
            startWorkflow: {
              id: 'startWorkflow',
              type: 'dropdown',
              value: 'manual',
            },
            webhookPath: {
              id: 'webhookPath',
              type: 'short-input',
              value: '',
            },
            webhookSecret: {
              id: 'webhookSecret',
              type: 'short-input',
              value: '',
            },
            scheduleType: {
              id: 'scheduleType',
              type: 'dropdown',
              value: 'daily',
            },
            minutesInterval: {
              id: 'minutesInterval',
              type: 'short-input',
              value: '',
            },
            minutesStartingAt: {
              id: 'minutesStartingAt',
              type: 'short-input',
              value: '',
            },
            hourlyMinute: {
              id: 'hourlyMinute',
              type: 'short-input',
              value: '',
            },
            dailyTime: {
              id: 'dailyTime',
              type: 'short-input',
              value: '',
            },
            weeklyDay: {
              id: 'weeklyDay',
              type: 'dropdown',
              value: 'MON',
            },
            weeklyDayTime: {
              id: 'weeklyDayTime',
              type: 'short-input',
              value: '',
            },
            monthlyDay: {
              id: 'monthlyDay',
              type: 'short-input',
              value: '',
            },
            monthlyTime: {
              id: 'monthlyTime',
              type: 'short-input',
              value: '',
            },
            cronExpression: {
              id: 'cronExpression',
              type: 'short-input',
              value: '',
            },
            timezone: {
              id: 'timezone',
              type: 'dropdown',
              value: 'UTC',
            },
          },
          outputs: {
            response: {
              type: {
                input: 'any',
              },
            },
          },
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          advancedMode: false,
          triggerMode: false,
          height: 95,
        },
      },
      edges: [],
      subflows: {},
      variables: {},
      metadata: {
        version: '1.0.0',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    }

    // Create the workflow and start block in a transaction
    await db.transaction(async (tx) => {
      // Create the workflow
      await tx.insert(workflow).values({
        id: workflowId,
        userId: session.user.id,
        workspaceId: workspaceId || null,
        folderId: folderId || null,
        name,
        description,
        state: initialState,
        color,
        lastSynced: now,
        createdAt: now,
        updatedAt: now,
        isDeployed: false,
        collaborators: [],
        runCount: 0,
        variables: {},
        isPublished: false,
        marketplaceData: null,
      })

      // Insert the start block into workflow_blocks table
      await tx.insert(workflowBlocks).values({
        id: starterId,
        workflowId: workflowId,
        type: 'starter',
        name: 'Start',
        positionX: '100',
        positionY: '100',
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false,
        triggerMode: false,
        height: '95',
        subBlocks: {
          startWorkflow: {
            id: 'startWorkflow',
            type: 'dropdown',
            value: 'manual',
          },
          webhookPath: {
            id: 'webhookPath',
            type: 'short-input',
            value: '',
          },
          webhookSecret: {
            id: 'webhookSecret',
            type: 'short-input',
            value: '',
          },
          scheduleType: {
            id: 'scheduleType',
            type: 'dropdown',
            value: 'daily',
          },
          minutesInterval: {
            id: 'minutesInterval',
            type: 'short-input',
            value: '',
          },
          minutesStartingAt: {
            id: 'minutesStartingAt',
            type: 'short-input',
            value: '',
          },
          hourlyMinute: {
            id: 'hourlyMinute',
            type: 'short-input',
            value: '',
          },
          dailyTime: {
            id: 'dailyTime',
            type: 'short-input',
            value: '',
          },
          weeklyDay: {
            id: 'weeklyDay',
            type: 'dropdown',
            value: 'MON',
          },
          weeklyDayTime: {
            id: 'weeklyDayTime',
            type: 'short-input',
            value: '',
          },
          monthlyDay: {
            id: 'monthlyDay',
            type: 'short-input',
            value: '',
          },
          monthlyTime: {
            id: 'monthlyTime',
            type: 'short-input',
            value: '',
          },
          cronExpression: {
            id: 'cronExpression',
            type: 'short-input',
            value: '',
          },
          timezone: {
            id: 'timezone',
            type: 'dropdown',
            value: 'UTC',
          },
        },
        outputs: {
          response: {
            type: {
              input: 'any',
            },
          },
        },
        createdAt: now,
        updatedAt: now,
      })

      logger.info(
        `[${requestId}] Successfully created workflow ${workflowId} with start block in workflow_blocks table`
      )
    })

    return NextResponse.json({
      id: workflowId,
      name,
      description,
      color,
      workspaceId,
      folderId,
      createdAt: now,
      updatedAt: now,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid workflow creation data`, {
        errors: error.errors,
      })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Error creating workflow`, error)
    return NextResponse.json({ error: 'Failed to create workflow' }, { status: 500 })
  }
}
