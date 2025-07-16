import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { db } from '@/db'
import { workflow } from '@/db/schema'
import type { Variable } from '@/stores/panel/variables/types'

const logger = createLogger('WorkflowVariablesAPI')

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

    // Check authorization - either the user owns the workflow or has workspace permissions
    let isAuthorized = workflowData.userId === session.user.id

    // If not authorized by ownership and the workflow belongs to a workspace, check workspace permissions
    if (!isAuthorized && workspaceId) {
      const userPermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        workspaceId
      )
      isAuthorized = userPermission !== null
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

      // Replace variables completely with the incoming ones
      // The frontend is the source of truth for what variables should exist
      const updatedVariables = variablesRecord

      // Update workflow with variables
      await db
        .update(workflow)
        .set({
          variables: updatedVariables,
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

    // Check authorization - either the user owns the workflow or has workspace permissions
    let isAuthorized = workflowData.userId === session.user.id

    // If not authorized by ownership and the workflow belongs to a workspace, check workspace permissions
    if (!isAuthorized && workspaceId) {
      const userPermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        workspaceId
      )
      isAuthorized = userPermission !== null
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
  } catch (error: any) {
    logger.error(`[${requestId}] Workflow variables fetch error`, error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
