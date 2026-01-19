import { db } from '@sim/db'
import { copilotChats, workflow, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { verifyEffectiveSuperUser } from '@/lib/templates/permissions'
import { parseWorkflowJson } from '@/lib/workflows/operations/import-export'
import {
  loadWorkflowFromNormalizedTables,
  saveWorkflowToNormalizedTables,
} from '@/lib/workflows/persistence/utils'
import { sanitizeForExport } from '@/lib/workflows/sanitization/json-sanitizer'

const logger = createLogger('SuperUserImportWorkflow')

interface ImportWorkflowRequest {
  workflowId: string
  targetWorkspaceId: string
}

/**
 * POST /api/superuser/import-workflow
 *
 * Superuser endpoint to import a workflow by ID along with its copilot chats.
 * This creates a copy of the workflow in the target workspace with new IDs.
 * Only the workflow structure and copilot chats are copied - no deployments,
 * webhooks, triggers, or other sensitive data.
 *
 * Requires both isSuperUser flag AND superUserModeEnabled setting.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { effectiveSuperUser, isSuperUser, superUserModeEnabled } =
      await verifyEffectiveSuperUser(session.user.id)

    if (!effectiveSuperUser) {
      logger.warn('Non-effective-superuser attempted to access import-workflow endpoint', {
        userId: session.user.id,
        isSuperUser,
        superUserModeEnabled,
      })
      return NextResponse.json({ error: 'Forbidden: Superuser access required' }, { status: 403 })
    }

    const body: ImportWorkflowRequest = await request.json()
    const { workflowId, targetWorkspaceId } = body

    if (!workflowId) {
      return NextResponse.json({ error: 'workflowId is required' }, { status: 400 })
    }

    if (!targetWorkspaceId) {
      return NextResponse.json({ error: 'targetWorkspaceId is required' }, { status: 400 })
    }

    // Verify target workspace exists
    const [targetWorkspace] = await db
      .select({ id: workspace.id, ownerId: workspace.ownerId })
      .from(workspace)
      .where(eq(workspace.id, targetWorkspaceId))
      .limit(1)

    if (!targetWorkspace) {
      return NextResponse.json({ error: 'Target workspace not found' }, { status: 404 })
    }

    // Get the source workflow
    const [sourceWorkflow] = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1)

    if (!sourceWorkflow) {
      return NextResponse.json({ error: 'Source workflow not found' }, { status: 404 })
    }

    // Load the workflow state from normalized tables
    const normalizedData = await loadWorkflowFromNormalizedTables(workflowId)

    if (!normalizedData) {
      return NextResponse.json(
        { error: 'Workflow has no normalized data - cannot import' },
        { status: 400 }
      )
    }

    // Use existing export logic to create export format
    const workflowState = {
      blocks: normalizedData.blocks,
      edges: normalizedData.edges,
      loops: normalizedData.loops,
      parallels: normalizedData.parallels,
      metadata: {
        name: sourceWorkflow.name,
        description: sourceWorkflow.description ?? undefined,
        color: sourceWorkflow.color,
      },
    }

    const exportData = sanitizeForExport(workflowState)

    // Use existing import logic (parseWorkflowJson regenerates IDs automatically)
    const { data: importedData, errors } = parseWorkflowJson(JSON.stringify(exportData))

    if (!importedData || errors.length > 0) {
      return NextResponse.json(
        { error: `Failed to parse workflow: ${errors.join(', ')}` },
        { status: 400 }
      )
    }

    // Create new workflow record
    const newWorkflowId = crypto.randomUUID()
    const now = new Date()

    await db.insert(workflow).values({
      id: newWorkflowId,
      userId: session.user.id,
      workspaceId: targetWorkspaceId,
      folderId: null, // Don't copy folder association
      name: `[Debug Import] ${sourceWorkflow.name}`,
      description: sourceWorkflow.description,
      color: sourceWorkflow.color,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      isDeployed: false, // Never copy deployment status
      runCount: 0,
      variables: sourceWorkflow.variables || {},
    })

    // Save using existing persistence logic
    const saveResult = await saveWorkflowToNormalizedTables(newWorkflowId, importedData)

    if (!saveResult.success) {
      // Clean up the workflow record if save failed
      await db.delete(workflow).where(eq(workflow.id, newWorkflowId))
      return NextResponse.json(
        { error: `Failed to save workflow state: ${saveResult.error}` },
        { status: 500 }
      )
    }

    // Copy copilot chats associated with the source workflow
    const sourceCopilotChats = await db
      .select()
      .from(copilotChats)
      .where(eq(copilotChats.workflowId, workflowId))

    let copilotChatsImported = 0

    for (const chat of sourceCopilotChats) {
      await db.insert(copilotChats).values({
        userId: session.user.id,
        workflowId: newWorkflowId,
        title: chat.title ? `[Import] ${chat.title}` : null,
        messages: chat.messages,
        model: chat.model,
        conversationId: null, // Don't copy conversation ID
        previewYaml: chat.previewYaml,
        planArtifact: chat.planArtifact,
        config: chat.config,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      copilotChatsImported++
    }

    logger.info('Superuser imported workflow', {
      userId: session.user.id,
      sourceWorkflowId: workflowId,
      newWorkflowId,
      targetWorkspaceId,
      copilotChatsImported,
    })

    return NextResponse.json({
      success: true,
      newWorkflowId,
      copilotChatsImported,
    })
  } catch (error) {
    logger.error('Error importing workflow', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
