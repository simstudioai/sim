/**
 * POST /api/v1/admin/workspaces/[id]/import
 *
 * Import workflows into a workspace from a ZIP file or JSON.
 *
 * Content-Type:
 *   - application/zip or multipart/form-data (with 'file' field) for ZIP upload
 *   - application/json for JSON payload
 *
 * JSON Body:
 *   {
 *     workflows: Array<{
 *       content: string | object,  // Workflow JSON
 *       name?: string,             // Override name
 *       folderPath?: string[]      // Folder path to create
 *     }>
 *   }
 *
 * Query Parameters:
 *   - createFolders: 'true' (default) or 'false'
 *   - rootFolderName: optional name for root import folder
 *
 * Response: WorkspaceImportResponse
 */

import { db } from '@sim/db'
import { workflow, workflowFolder, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import {
  extractWorkflowName,
  extractWorkflowsFromZip,
  parseWorkflowJson,
} from '@/lib/workflows/operations/import-export'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
} from '@/app/api/v1/admin/responses'
import {
  extractWorkflowMetadata,
  type ImportResult,
  type WorkflowVariable,
  type WorkspaceImportRequest,
  type WorkspaceImportResponse,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminWorkspaceImportAPI')

interface RouteParams {
  id: string
}

interface ParsedWorkflow {
  content: string
  name: string
  folderPath: string[]
}

export const POST = withAdminAuthParams<RouteParams>(async (request, context) => {
  const { id: workspaceId } = await context.params
  const url = new URL(request.url)
  const createFolders = url.searchParams.get('createFolders') !== 'false'
  const rootFolderName = url.searchParams.get('rootFolderName')

  try {
    const [workspaceData] = await db
      .select({ id: workspace.id, ownerId: workspace.ownerId })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)

    if (!workspaceData) {
      return notFoundResponse('Workspace')
    }

    const contentType = request.headers.get('content-type') || ''
    let workflowsToImport: ParsedWorkflow[] = []

    if (contentType.includes('application/json')) {
      const body = (await request.json()) as WorkspaceImportRequest

      if (!body.workflows || !Array.isArray(body.workflows)) {
        return badRequestResponse('Invalid JSON body. Expected { workflows: [...] }')
      }

      workflowsToImport = body.workflows.map((w) => ({
        content: typeof w.content === 'string' ? w.content : JSON.stringify(w.content),
        name: w.name || 'Imported Workflow',
        folderPath: w.folderPath || [],
      }))
    } else if (
      contentType.includes('application/zip') ||
      contentType.includes('multipart/form-data')
    ) {
      let zipBuffer: ArrayBuffer

      if (contentType.includes('multipart/form-data')) {
        const formData = await request.formData()
        const file = formData.get('file') as File | null

        if (!file) {
          return badRequestResponse('No file provided in form data. Use field name "file".')
        }

        zipBuffer = await file.arrayBuffer()
      } else {
        zipBuffer = await request.arrayBuffer()
      }

      const blob = new Blob([zipBuffer], { type: 'application/zip' })
      const file = new File([blob], 'import.zip', { type: 'application/zip' })

      const { workflows } = await extractWorkflowsFromZip(file)
      workflowsToImport = workflows
    } else {
      return badRequestResponse(
        'Unsupported Content-Type. Use application/json or application/zip.'
      )
    }

    if (workflowsToImport.length === 0) {
      return badRequestResponse('No workflows found to import')
    }

    let rootFolderId: string | undefined
    if (rootFolderName && createFolders) {
      rootFolderId = crypto.randomUUID()
      await db.insert(workflowFolder).values({
        id: rootFolderId,
        name: rootFolderName,
        userId: workspaceData.ownerId,
        workspaceId,
        parentId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    }

    const folderMap = new Map<string, string>()
    const results: ImportResult[] = []

    for (const wf of workflowsToImport) {
      const result = await importSingleWorkflow(
        wf,
        workspaceId,
        workspaceData.ownerId,
        createFolders,
        rootFolderId,
        folderMap
      )
      results.push(result)

      if (result.success) {
        logger.info(`Admin API: Imported workflow ${result.workflowId} (${result.name})`)
      } else {
        logger.warn(`Admin API: Failed to import workflow ${result.name}: ${result.error}`)
      }
    }

    const imported = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length

    logger.info(`Admin API: Import complete - ${imported} succeeded, ${failed} failed`)

    const response: WorkspaceImportResponse = { imported, failed, results }
    return NextResponse.json(response)
  } catch (error) {
    logger.error('Admin API: Failed to import into workspace', { error, workspaceId })
    return internalErrorResponse('Failed to import workflows')
  }
})

async function importSingleWorkflow(
  wf: ParsedWorkflow,
  workspaceId: string,
  ownerId: string,
  createFolders: boolean,
  rootFolderId: string | undefined,
  folderMap: Map<string, string>
): Promise<ImportResult> {
  try {
    const { data: workflowData, errors } = parseWorkflowJson(wf.content)

    if (!workflowData || errors.length > 0) {
      return {
        workflowId: '',
        name: wf.name,
        success: false,
        error: `Parse error: ${errors.join(', ')}`,
      }
    }

    const workflowName = extractWorkflowName(wf.content, wf.name)
    let targetFolderId: string | null = rootFolderId || null

    if (createFolders && wf.folderPath.length > 0) {
      let parentId = rootFolderId || null

      for (let i = 0; i < wf.folderPath.length; i++) {
        const pathSegment = wf.folderPath.slice(0, i + 1).join('/')
        const fullPath = rootFolderId ? `root/${pathSegment}` : pathSegment

        if (!folderMap.has(fullPath)) {
          const folderId = crypto.randomUUID()
          await db.insert(workflowFolder).values({
            id: folderId,
            name: wf.folderPath[i],
            userId: ownerId,
            workspaceId,
            parentId,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          folderMap.set(fullPath, folderId)
          parentId = folderId
        } else {
          parentId = folderMap.get(fullPath)!
        }
      }

      const fullFolderPath = rootFolderId
        ? `root/${wf.folderPath.join('/')}`
        : wf.folderPath.join('/')
      targetFolderId = folderMap.get(fullFolderPath) || parentId
    }

    const parsedContent = (() => {
      try {
        return JSON.parse(wf.content)
      } catch {
        return null
      }
    })()
    const { color: workflowColor } = extractWorkflowMetadata(parsedContent)
    const workflowId = crypto.randomUUID()
    const now = new Date()

    await db.insert(workflow).values({
      id: workflowId,
      userId: ownerId,
      workspaceId,
      folderId: targetFolderId,
      name: workflowName,
      description: workflowData.metadata?.description || 'Imported via Admin API',
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
      return {
        workflowId: '',
        name: workflowName,
        success: false,
        error: `Failed to save state: ${saveResult.error}`,
      }
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

    return {
      workflowId,
      name: workflowName,
      success: true,
    }
  } catch (error) {
    return {
      workflowId: '',
      name: wf.name,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
