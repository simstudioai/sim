/**
 * GET /api/v1/admin/workspaces/[id]/export
 *
 * Export an entire workspace as a ZIP file or JSON (raw, unsanitized for admin backup/restore).
 *
 * Query Parameters:
 *   - format: 'zip' (default) or 'json'
 *
 * Response:
 *   - ZIP file download (Content-Type: application/zip)
 *   - JSON: WorkspaceExportPayload
 */

import { db } from '@sim/db'
import { workflow, workflowFolder, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { exportWorkspaceToZip, sanitizePathSegment } from '@/lib/workflows/operations/import-export'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  internalErrorResponse,
  notFoundResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import {
  type FolderExportPayload,
  parseWorkflowVariables,
  type WorkflowExportState,
  type WorkspaceExportPayload,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminWorkspaceExportAPI')

interface RouteParams {
  id: string
}

export const GET = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: workspaceId } = await context.params
  const url = new URL(request.url)
  const format = url.searchParams.get('format') || 'zip'

  try {
    const [workspaceData] = await db
      .select({ id: workspace.id, name: workspace.name })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

    if (!workspaceData) {
      return notFoundResponse('Workspace')
    }

    const workflows = await db.select().from(workflow).where(eq(workflow.workspaceId, workspaceId))

    const folders = await db
      .select()
      .from(workflowFolder)
      .where(eq(workflowFolder.workspaceId, workspaceId))

    const workflowExports: Array<{
      workflow: WorkspaceExportPayload['workflows'][number]['workflow']
      state: WorkflowExportState
    }> = []

    for (const wf of workflows) {
      try {
        const normalizedData = await loadWorkflowFromNormalizedTables(wf.id)

        if (!normalizedData) {
          logger.warn(`Skipping workflow ${wf.id} - no normalized data found`)
          continue
        }

        const variables = parseWorkflowVariables(wf.variables)

        const state: WorkflowExportState = {
          blocks: normalizedData.blocks,
          edges: normalizedData.edges,
          loops: normalizedData.loops,
          parallels: normalizedData.parallels,
          metadata: {
            name: wf.name,
            description: wf.description ?? undefined,
            color: wf.color,
            exportedAt: new Date().toISOString(),
          },
          variables,
        }

        workflowExports.push({
          workflow: {
            id: wf.id,
            name: wf.name,
            description: wf.description,
            color: wf.color,
            workspaceId: wf.workspaceId,
            folderId: wf.folderId,
          },
          state,
        })
      } catch (error) {
        logger.error(`Failed to load workflow ${wf.id}:`, { error })
      }
    }

    const folderExports: FolderExportPayload[] = folders.map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
    }))

    logger.info(
      `Admin API: Exporting workspace ${workspaceId} with ${workflowExports.length} workflows and ${folderExports.length} folders`
    )

    if (format === 'json') {
      const exportPayload: WorkspaceExportPayload = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        workspace: {
          id: workspaceData.id,
          name: workspaceData.name,
        },
        workflows: workflowExports,
        folders: folderExports,
      }

      return singleResponse(exportPayload)
    }

    const zipWorkflows = workflowExports.map((wf) => ({
      workflow: {
        id: wf.workflow.id,
        name: wf.workflow.name,
        description: wf.workflow.description ?? undefined,
        color: wf.workflow.color ?? undefined,
        folderId: wf.workflow.folderId,
      },
      state: wf.state,
      variables: wf.state.variables,
    }))

    const zipBlob = await exportWorkspaceToZip(workspaceData.name, zipWorkflows, folderExports)
    const arrayBuffer = await zipBlob.arrayBuffer()

    const sanitizedName = sanitizePathSegment(workspaceData.name)
    const filename = `${sanitizedName}-${new Date().toISOString().split('T')[0]}.zip`

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': arrayBuffer.byteLength.toString(),
      },
    })
  } catch (error) {
    logger.error('Admin API: Failed to export workspace', { error, workspaceId })
    return internalErrorResponse('Failed to export workspace')
  }
})
