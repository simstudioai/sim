/**
 * GET /api/v1/admin/folders/[id]/export
 *
 * Export a folder and all its contents (workflows + subfolders) as a ZIP file or JSON (raw, unsanitized for admin backup/restore).
 *
 * Query Parameters:
 *   - format: 'zip' (default) or 'json'
 *
 * Response:
 *   - ZIP file download (Content-Type: application/zip)
 *   - JSON: FolderExportFullPayload
 */

import { db } from '@sim/db'
import { workflow, workflowFolder } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { exportFolderToZip, sanitizePathSegment } from '@/lib/workflows/operations/import-export'
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
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminFolderExportAPI')

interface RouteParams {
  id: string
}

interface CollectedWorkflow {
  id: string
  folderId: string | null
}

/**
 * Recursively collects all workflows within a folder and its subfolders.
 */
function collectWorkflowsInFolder(
  folderId: string,
  allWorkflows: Array<{ id: string; folderId: string | null }>,
  allFolders: Array<{ id: string; parentId: string | null }>
): CollectedWorkflow[] {
  const collected: CollectedWorkflow[] = []

  for (const wf of allWorkflows) {
    if (wf.folderId === folderId) {
      collected.push({ id: wf.id, folderId: wf.folderId })
    }
  }

  for (const folder of allFolders) {
    if (folder.parentId === folderId) {
      const childWorkflows = collectWorkflowsInFolder(folder.id, allWorkflows, allFolders)
      collected.push(...childWorkflows)
    }
  }

  return collected
}

/**
 * Collects all subfolders recursively under a root folder.
 * Returns folders with parentId adjusted so direct children of rootFolderId have parentId: null.
 */
function collectSubfolders(
  rootFolderId: string,
  allFolders: Array<{ id: string; name: string; parentId: string | null }>
): FolderExportPayload[] {
  const subfolders: FolderExportPayload[] = []

  function collect(parentId: string) {
    for (const folder of allFolders) {
      if (folder.parentId === parentId) {
        subfolders.push({
          id: folder.id,
          name: folder.name,
          parentId: folder.parentId === rootFolderId ? null : folder.parentId,
        })
        collect(folder.id)
      }
    }
  }

  collect(rootFolderId)
  return subfolders
}

export const GET = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: folderId } = await context.params
  const url = new URL(request.url)
  const format = url.searchParams.get('format') || 'zip'

  try {
    const [folderData] = await db
      .select({
        id: workflowFolder.id,
        name: workflowFolder.name,
        workspaceId: workflowFolder.workspaceId,
      })
      .from(workflowFolder)
      .where(eq(workflowFolder.id, folderId))
      .limit(1)

    if (!folderData) {
      return notFoundResponse('Folder')
    }

    const allWorkflows = await db
      .select({ id: workflow.id, folderId: workflow.folderId })
      .from(workflow)
      .where(eq(workflow.workspaceId, folderData.workspaceId))

    const allFolders = await db
      .select({
        id: workflowFolder.id,
        name: workflowFolder.name,
        parentId: workflowFolder.parentId,
      })
      .from(workflowFolder)
      .where(eq(workflowFolder.workspaceId, folderData.workspaceId))

    const workflowsInFolder = collectWorkflowsInFolder(folderId, allWorkflows, allFolders)
    const subfolders = collectSubfolders(folderId, allFolders)

    const workflowExports: Array<{
      workflow: {
        id: string
        name: string
        description: string | null
        color: string | null
        folderId: string | null
      }
      state: WorkflowExportState
    }> = []

    for (const collectedWf of workflowsInFolder) {
      try {
        const [wfData] = await db
          .select()
          .from(workflow)
          .where(eq(workflow.id, collectedWf.id))
          .limit(1)

        if (!wfData) {
          logger.warn(`Skipping workflow ${collectedWf.id} - not found`)
          continue
        }

        const normalizedData = await loadWorkflowFromNormalizedTables(collectedWf.id)

        if (!normalizedData) {
          logger.warn(`Skipping workflow ${collectedWf.id} - no normalized data found`)
          continue
        }

        const variables = parseWorkflowVariables(wfData.variables)

        const remappedFolderId = collectedWf.folderId === folderId ? null : collectedWf.folderId

        const state: WorkflowExportState = {
          blocks: normalizedData.blocks,
          edges: normalizedData.edges,
          loops: normalizedData.loops,
          parallels: normalizedData.parallels,
          metadata: {
            name: wfData.name,
            description: wfData.description ?? undefined,
            color: wfData.color,
            exportedAt: new Date().toISOString(),
          },
          variables,
        }

        workflowExports.push({
          workflow: {
            id: wfData.id,
            name: wfData.name,
            description: wfData.description,
            color: wfData.color,
            folderId: remappedFolderId,
          },
          state,
        })
      } catch (error) {
        logger.error(`Failed to load workflow ${collectedWf.id}:`, { error })
      }
    }

    logger.info(
      `Admin API: Exporting folder ${folderId} with ${workflowExports.length} workflows and ${subfolders.length} subfolders`
    )

    if (format === 'json') {
      const exportPayload = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        folder: {
          id: folderData.id,
          name: folderData.name,
        },
        workflows: workflowExports,
        folders: subfolders,
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

    const zipBlob = await exportFolderToZip(folderData.name, zipWorkflows, subfolders)
    const arrayBuffer = await zipBlob.arrayBuffer()

    const sanitizedName = sanitizePathSegment(folderData.name)
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
    logger.error('Admin API: Failed to export folder', { error, folderId })
    return internalErrorResponse('Failed to export folder')
  }
})
