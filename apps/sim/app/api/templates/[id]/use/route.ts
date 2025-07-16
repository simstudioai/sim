import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { templates, workflow, workflowBlocks, workflowEdges } from '@/db/schema'

const logger = createLogger('TemplateUseAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/templates/[id]/use - Use a template (increment views and create workflow)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id } = await params

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized use attempt for template: ${id}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get workspace ID from request body
    const body = await request.json()
    const { workspaceId } = body

    if (!workspaceId) {
      logger.warn(`[${requestId}] Missing workspaceId in request body`)
      return NextResponse.json({ error: 'Workspace ID is required' }, { status: 400 })
    }

    logger.debug(
      `[${requestId}] Using template: ${id}, user: ${session.user.id}, workspace: ${workspaceId}`
    )

    // Get the template with its data
    const template = await db
      .select({
        id: templates.id,
        name: templates.name,
        description: templates.description,
        state: templates.state,
        color: templates.color,
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

    // Use a transaction to ensure consistency
    const result = await db.transaction(async (tx) => {
      // Increment the template views
      await tx
        .update(templates)
        .set({
          views: sql`${templates.views} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(templates.id, id))

      const now = new Date()

      // Create a new workflow from the template
      const newWorkflow = await tx
        .insert(workflow)
        .values({
          id: newWorkflowId,
          workspaceId: workspaceId,
          name: `${templateData.name} (copy)`,
          description: templateData.description,
          state: templateData.state,
          color: templateData.color,
          userId: session.user.id,
          createdAt: now,
          updatedAt: now,
          lastSynced: now,
        })
        .returning({ id: workflow.id })

      // Create workflow_blocks entries from the template state
      const templateState = templateData.state as any
      if (templateState?.blocks) {
        // Create a mapping from old block IDs to new block IDs for reference updates
        const blockIdMap = new Map<string, string>()

        const blockEntries = Object.values(templateState.blocks).map((block: any) => {
          const newBlockId = uuidv4()
          blockIdMap.set(block.id, newBlockId)

          return {
            id: newBlockId,
            workflowId: newWorkflowId,
            type: block.type,
            name: block.name,
            positionX: block.position?.x?.toString() || '0',
            positionY: block.position?.y?.toString() || '0',
            enabled: block.enabled !== false,
            horizontalHandles: block.horizontalHandles !== false,
            isWide: block.isWide || false,
            advancedMode: block.advancedMode || false,
            height: block.height?.toString() || '0',
            subBlocks: block.subBlocks || {},
            outputs: block.outputs || {},
            data: block.data || {},
            parentId: block.parentId ? blockIdMap.get(block.parentId) || null : null,
            extent: block.extent || null,
            createdAt: now,
            updatedAt: now,
          }
        })

        // Create edge entries with new IDs
        const edgeEntries = (templateState.edges || []).map((edge: any) => ({
          id: uuidv4(),
          workflowId: newWorkflowId,
          sourceBlockId: blockIdMap.get(edge.source) || edge.source,
          targetBlockId: blockIdMap.get(edge.target) || edge.target,
          sourceHandle: edge.sourceHandle || null,
          targetHandle: edge.targetHandle || null,
          createdAt: now,
        }))

        // Update the workflow state with new block IDs
        const updatedState = { ...templateState }
        if (updatedState.blocks) {
          const newBlocks: any = {}
          Object.entries(updatedState.blocks).forEach(([oldId, blockData]: [string, any]) => {
            const newId = blockIdMap.get(oldId)
            if (newId) {
              newBlocks[newId] = {
                ...blockData,
                id: newId,
              }
            }
          })
          updatedState.blocks = newBlocks
        }

        // Update edges to use new block IDs
        if (updatedState.edges) {
          updatedState.edges = updatedState.edges.map((edge: any) => ({
            ...edge,
            id: uuidv4(),
            source: blockIdMap.get(edge.source) || edge.source,
            target: blockIdMap.get(edge.target) || edge.target,
          }))
        }

        // Update the workflow with the corrected state
        await tx.update(workflow).set({ state: updatedState }).where(eq(workflow.id, newWorkflowId))

        // Insert blocks and edges
        if (blockEntries.length > 0) {
          await tx.insert(workflowBlocks).values(blockEntries)
        }
        if (edgeEntries.length > 0) {
          await tx.insert(workflowEdges).values(edgeEntries)
        }
      }

      return newWorkflow[0]
    })

    logger.info(
      `[${requestId}] Successfully used template: ${id}, created workflow: ${newWorkflowId}, database returned: ${result.id}`
    )

    // Verify the workflow was actually created
    const verifyWorkflow = await db
      .select({ id: workflow.id })
      .from(workflow)
      .where(eq(workflow.id, newWorkflowId))
      .limit(1)

    if (verifyWorkflow.length === 0) {
      logger.error(`[${requestId}] Workflow was not created properly: ${newWorkflowId}`)
      return NextResponse.json({ error: 'Failed to create workflow' }, { status: 500 })
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
