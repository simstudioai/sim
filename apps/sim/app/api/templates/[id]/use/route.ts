import { db } from '@sim/db'
import { templates, workflow, workflowDeploymentVersion } from '@sim/db/schema'
import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { generateRequestId } from '@/lib/utils'
import { regenerateWorkflowStateIds } from '@/lib/workflows/db-helpers'

const logger = createLogger('TemplateUseAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Type for template details
interface TemplateDetails {
  tagline?: string
  about?: string
}

// POST /api/templates/[id]/use - Use a template (increment views and create workflow)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized use attempt for template: ${id}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get workspace ID and connectToTemplate flag from request body
    const body = await request.json()
    const { workspaceId, connectToTemplate = false } = body

    if (!workspaceId) {
      logger.warn(`[${requestId}] Missing workspaceId in request body`)
      return NextResponse.json({ error: 'Workspace ID is required' }, { status: 400 })
    }

    logger.debug(
      `[${requestId}] Using template: ${id}, user: ${session.user.id}, workspace: ${workspaceId}, connect: ${connectToTemplate}`
    )

    // Get the template
    const template = await db
      .select({
        id: templates.id,
        name: templates.name,
        details: templates.details,
        state: templates.state,
        workflowId: templates.workflowId,
      })
      .from(templates)
      .where(eq(templates.id, id))
      .limit(1)

    if (template.length === 0) {
      logger.warn(`[${requestId}] Template not found: ${id}`)
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const templateData = template[0]

    // Create a new workflow ID
    const newWorkflowId = uuidv4()
    const now = new Date()

    // Extract variables from the template state and remap to the new workflow
    const templateVariables = (templateData.state as any)?.variables as
      | Record<string, any>
      | undefined
    const remappedVariables: Record<string, any> = (() => {
      if (!templateVariables || typeof templateVariables !== 'object') return {}
      const mapped: Record<string, any> = {}
      for (const [, variable] of Object.entries(templateVariables)) {
        const newVarId = uuidv4()
        mapped[newVarId] = { ...variable, id: newVarId, workflowId: newWorkflowId }
      }
      return mapped
    })()

    // Step 1: Create the workflow record (like imports do)
    await db.insert(workflow).values({
      id: newWorkflowId,
      workspaceId: workspaceId,
      name:
        connectToTemplate && !templateData.workflowId
          ? templateData.name
          : `${templateData.name} (copy)`,
      description: (templateData.details as TemplateDetails | null)?.tagline || null,
      userId: session.user.id,
      variables: remappedVariables, // Remap variable IDs and workflowId for the new workflow
      createdAt: now,
      updatedAt: now,
      lastSynced: now,
      isDeployed: connectToTemplate && !templateData.workflowId,
      deployedAt: connectToTemplate && !templateData.workflowId ? now : null,
    })

    // Step 2: Regenerate IDs when creating a copy (not when connecting/editing template)
    // When connecting to template (edit mode), keep original IDs
    // When using template (copy mode), regenerate all IDs to avoid conflicts
    const workflowState = connectToTemplate
      ? templateData.state
      : regenerateWorkflowStateIds(templateData.state)

    // Step 3: Save the workflow state using the existing state endpoint (like imports do)
    // Ensure variables in state are remapped for the new workflow as well
    const workflowStateWithVariables = { ...workflowState, variables: remappedVariables }
    const stateResponse = await fetch(`${getBaseUrl()}/api/workflows/${newWorkflowId}/state`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        // Forward the session cookie for authentication
        cookie: request.headers.get('cookie') || '',
      },
      body: JSON.stringify(workflowStateWithVariables),
    })

    if (!stateResponse.ok) {
      logger.error(`[${requestId}] Failed to save workflow state for template use`)
      // Clean up the workflow we created
      await db.delete(workflow).where(eq(workflow.id, newWorkflowId))
      return NextResponse.json(
        { error: 'Failed to create workflow from template' },
        { status: 500 }
      )
    }

    // Use a transaction for template updates and deployment version
    const result = await db.transaction(async (tx) => {
      // Prepare template update data
      const updateData: any = {
        views: sql`${templates.views} + 1`,
        updatedAt: now,
      }

      // If connecting to template for editing, also update the workflowId
      // Also create a new deployment version for this workflow with the same state
      if (connectToTemplate && !templateData.workflowId) {
        updateData.workflowId = newWorkflowId

        // Create a deployment version for the new workflow
        if (templateData.state) {
          const newDeploymentVersionId = uuidv4()
          await tx.insert(workflowDeploymentVersion).values({
            id: newDeploymentVersionId,
            workflowId: newWorkflowId,
            version: 1,
            state: templateData.state,
            isActive: true,
            createdAt: now,
            createdBy: session.user.id,
          })
        }
      }

      // Update template with view count and potentially new workflow connection
      await tx.update(templates).set(updateData).where(eq(templates.id, id))

      return { id: newWorkflowId }
    })

    logger.info(
      `[${requestId}] Successfully used template: ${id}, created workflow: ${newWorkflowId}`
    )

    // Track template usage
    try {
      const { trackPlatformEvent } = await import('@/lib/telemetry/tracer')
      const templateState = templateData.state as any
      trackPlatformEvent('platform.template.used', {
        'template.id': id,
        'template.name': templateData.name,
        'workflow.created_id': newWorkflowId,
        'workflow.blocks_count': templateState?.blocks
          ? Object.keys(templateState.blocks).length
          : 0,
        'workspace.id': workspaceId,
      })
    } catch (_e) {
      // Silently fail
    }

    return NextResponse.json(
      {
        message: 'Template used successfully',
        workflowId: newWorkflowId,
        workspaceId: workspaceId,
      },
      { status: 201 }
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Error using template: ${id}`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
