/**
 * POST /api/v1/admin/workflows/import
 *
 * Import a single workflow into a workspace.
 *
 * Request Body:
 *   {
 *     workspaceId: string,           // Required: target workspace
 *     folderId?: string,             // Optional: target folder
 *     name?: string,                 // Optional: override workflow name
 *     workflow: object | string      // The workflow JSON (from export or raw state)
 *   }
 *
 * Response: { workflowId: string, name: string, success: true }
 */

import { db } from '@sim/db'
import { workflow, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { parseWorkflowJson } from '@/lib/workflows/operations/import-export'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
} from '@/app/api/v1/admin/responses'
import {
  extractWorkflowMetadata,
  type WorkflowImportRequest,
  type WorkflowVariable,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminWorkflowImportAPI')

interface ImportSuccessResponse {
  workflowId: string
  name: string
  success: true
}

export const POST = withAdminAuth(async (request) => {
  try {
    const body = (await request.json()) as WorkflowImportRequest

    if (!body.workspaceId) {
      return badRequestResponse('workspaceId is required')
    }

    if (!body.workflow) {
      return badRequestResponse('workflow is required')
    }

    const { workspaceId, folderId, name: overrideName } = body

    const [workspaceData] = await db
      .select({ id: workspace.id, ownerId: workspace.ownerId })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

    if (!workspaceData) {
      return notFoundResponse('Workspace')
    }

    const workflowContent =
      typeof body.workflow === 'string' ? body.workflow : JSON.stringify(body.workflow)

    const { data: workflowData, errors } = parseWorkflowJson(workflowContent)

    if (!workflowData || errors.length > 0) {
      return badRequestResponse(`Invalid workflow: ${errors.join(', ')}`)
    }

    const parsedWorkflow =
      typeof body.workflow === 'string'
        ? (() => {
            try {
              return JSON.parse(body.workflow)
            } catch {
              return null
            }
          })()
        : body.workflow

    const {
      name: workflowName,
      color: workflowColor,
      description: workflowDescription,
    } = extractWorkflowMetadata(parsedWorkflow, overrideName)

    const workflowId = crypto.randomUUID()
    const now = new Date()

    await db.insert(workflow).values({
      id: workflowId,
      userId: workspaceData.ownerId,
      workspaceId,
      folderId: folderId || null,
      name: workflowName,
      description: workflowDescription,
      color: workflowColor,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      isDeployed: false,
      runCount: 0,
      variables: {},
    })

    const saveResult = await saveWorkflowToNormalizedTables(workflowId, workflowData)

    if (!saveResult.success) {
      await db.delete(workflow).where(eq(workflow.id, workflowId))
      return internalErrorResponse(`Failed to save workflow state: ${saveResult.error}`)
    }

    if (workflowData.variables && Array.isArray(workflowData.variables)) {
      const variablesRecord: Record<string, WorkflowVariable> = {}
      workflowData.variables.forEach((v) => {
        const varId = v.id || crypto.randomUUID()
        variablesRecord[varId] = {
          id: varId,
          name: v.name,
          type: v.type || 'string',
          value: v.value,
        }
      })

      await db
        .update(workflow)
        .set({ variables: variablesRecord, updatedAt: new Date() })
        .where(eq(workflow.id, workflowId))
    }

    logger.info(
      `Admin API: Imported workflow ${workflowId} (${workflowName}) into workspace ${workspaceId}`
    )

    const response: ImportSuccessResponse = {
      workflowId,
      name: workflowName,
      success: true,
    }

    return NextResponse.json(response)
  } catch (error) {
    logger.error('Admin API: Failed to import workflow', { error })
    return internalErrorResponse('Failed to import workflow')
  }
})
