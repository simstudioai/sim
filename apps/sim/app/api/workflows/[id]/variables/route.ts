import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { getWorkflowAccessContext } from '@/lib/workflows/utils'
import type { Variable } from '@/stores/panel/variables/types'

const logger = createLogger('WorkflowVariablesAPI')

const VariableSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'plain']),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.record(z.unknown()),
    z.array(z.unknown()),
  ]),
})

const VariablesSchema = z.object({
  variables: z.record(z.string(), VariableSchema),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const workflowId = (await params).id

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized workflow variables update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get the workflow record
    const accessContext = await getWorkflowAccessContext(workflowId, session.user.id)
    const workflowData = accessContext?.workflow

    if (!workflowData) {
      logger.warn(`[${requestId}] Workflow not found: ${workflowId}`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }
    const workspaceId = workflowData.workspaceId

    // Check authorization - either the user owns the workflow or has workspace permissions
    const isAuthorized =
      accessContext?.isOwner || (workspaceId ? accessContext?.workspacePermission !== null : false)

    if (!isAuthorized) {
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted to update variables for workflow ${workflowId} without permission`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    try {
      const { variables } = VariablesSchema.parse(body)

      // Variables are already in Record format - use directly
      // The frontend is the source of truth for what variables should exist
      await db
        .update(workflow)
        .set({
          variables,
          updatedAt: new Date(),
        })
        .where(eq(workflow.id, workflowId))

      return NextResponse.json({ success: true })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.warn(`[${requestId}] Invalid workflow variables data`, {
          errors: validationError.errors,
        })
        return NextResponse.json(
          { error: 'Invalid request data', details: validationError.errors },
          { status: 400 }
        )
      }
      throw validationError
    }
  } catch (error) {
    logger.error(`[${requestId}] Error updating workflow variables`, error)
    return NextResponse.json({ error: 'Failed to update workflow variables' }, { status: 500 })
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const workflowId = (await params).id

  try {
    // Get the session directly in the API route
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized workflow variables access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get the workflow record
    const accessContext = await getWorkflowAccessContext(workflowId, session.user.id)
    const workflowData = accessContext?.workflow

    if (!workflowData) {
      logger.warn(`[${requestId}] Workflow not found: ${workflowId}`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }
    const workspaceId = workflowData.workspaceId

    // Check authorization - either the user owns the workflow or has workspace permissions
    const isAuthorized =
      accessContext?.isOwner || (workspaceId ? accessContext?.workspacePermission !== null : false)

    if (!isAuthorized) {
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted to access variables for workflow ${workflowId} without permission`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Return variables if they exist
    const variables = (workflowData.variables as Record<string, Variable>) || {}

    // Add cache headers to prevent frequent reloading
    const variableHash = JSON.stringify(variables).length
    const headers = new Headers({
      'Cache-Control': 'max-age=30, stale-while-revalidate=300', // Cache for 30 seconds, stale for 5 min
      ETag: `"variables-${workflowId}-${variableHash}"`,
    })

    return NextResponse.json(
      { data: variables },
      {
        status: 200,
        headers,
      }
    )
  } catch (error) {
    logger.error(`[${requestId}] Workflow variables fetch error`, error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
