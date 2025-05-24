import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { workflow, workspaceMember } from '@/db/schema'
import type { Variable } from '@/stores/panel/variables/types'

const logger = createLogger('WorkflowVariablesAPI')

// Schema for workflow variables updates
const VariablesSchema = z.object({
  variables: z.array(
    z.object({
      id: z.string(),
      workflowId: z.string(),
      name: z.string(),
      type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'plain']),
      value: z.union([z.string(), z.number(), z.boolean(), z.record(z.any()), z.array(z.any())]),
    })
  ),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const workflowId = (await params).id

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized workflow variables update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get the workflow record
    const workflowRecord = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowRecord.length) {
      logger.warn(`[${requestId}] Workflow not found: ${workflowId}`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const workflowData = workflowRecord[0]
    const workspaceId = workflowData.workspaceId

    // Check authorization - either the user owns the workflow or is a member of the workspace
    let isAuthorized = workflowData.userId === session.user.id

    // If not authorized by ownership and the workflow belongs to a workspace, check workspace membership
    if (!isAuthorized && workspaceId) {
      const membership = await db
        .select()
        .from(workspaceMember)
        .where(
          and(
            eq(workspaceMember.workspaceId, workspaceId),
            eq(workspaceMember.userId, session.user.id)
          )
        )
        .limit(1)

      isAuthorized = membership.length > 0
    }

    if (!isAuthorized) {
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted to update variables for workflow ${workflowId} without permission`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()

    try {
      const { variables } = VariablesSchema.parse(body)

      // Format variables for storage
      const variablesRecord: Record<string, Variable> = {}
      variables.forEach((variable) => {
        variablesRecord[variable.id] = variable
      })

      // Get existing variables to merge with the incoming ones
      const existingVariables = (workflowRecord[0].variables as Record<string, Variable>) || {}

      // Create a timestamp based on the current request

      // Merge variables: Keep existing ones and update/add new ones
      // This prevents variables from being deleted during race conditions
      const mergedVariables = {
        ...existingVariables,
        ...variablesRecord,
      }

      // Update workflow with variables
      await db
        .update(workflow)
        .set({
          variables: mergedVariables,
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
  const requestId = crypto.randomUUID().slice(0, 8)
  const workflowId = (await params).id

  try {
    // Get the session directly in the API route
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized workflow variables access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get the workflow record
    const workflowRecord = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!workflowRecord.length) {
      logger.warn(`[${requestId}] Workflow not found: ${workflowId}`)
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    const workflowData = workflowRecord[0]
    const workspaceId = workflowData.workspaceId

    // Check authorization - either the user owns the workflow or is a member of the workspace
    let isAuthorized = workflowData.userId === session.user.id

    // If not authorized by ownership and the workflow belongs to a workspace, check workspace membership
    if (!isAuthorized && workspaceId) {
      const membership = await db
        .select()
        .from(workspaceMember)
        .where(
          and(
            eq(workspaceMember.workspaceId, workspaceId),
            eq(workspaceMember.userId, session.user.id)
          )
        )
        .limit(1)

      isAuthorized = membership.length > 0
    }

    if (!isAuthorized) {
      logger.warn(
        `[${requestId}] User ${session.user.id} attempted to access variables for workflow ${workflowId} without permission`
      )
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Return variables if they exist
    const variables = (workflowData.variables as Record<string, Variable>) || {}

    // Add cache headers to prevent frequent reloading
    const headers = new Headers({
      'Cache-Control': 'max-age=60, stale-while-revalidate=300', // Cache for 1 minute, stale for 5
      ETag: `"${requestId}-${Object.keys(variables).length}"`,
    })

    return NextResponse.json(
      { data: variables },
      {
        status: 200,
        headers,
      }
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Workflow variables fetch error`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
