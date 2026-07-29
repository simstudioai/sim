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
import { folder as folderTable, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import {
  adminV1ImportWorkspaceContract,
  adminV1WorkspaceImportBodySchema,
} from '@/lib/api/contracts/v1/admin'
import { parseJsonBody, parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  extractWorkflowName,
  extractWorkflowsFromZip,
  parseWorkflowJson,
} from '@/lib/workflows/operations/import-export'
import { prepareWorkflowStateForPersistence } from '@/lib/workflows/persistence/prepare-state'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import { deduplicateWorkflowName } from '@/lib/workflows/utils'
import { normalizeImportedVariables } from '@/lib/workflows/variables/parse'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'
import { withAdminAuthParams } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
} from '@/app/api/v1/admin/responses'
import type {
  ImportResult,
  WorkspaceImportRequest,
  WorkspaceImportResponse,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminWorkspaceImportAPI')

/**
 * Body cap for admin bulk workflow imports, which can carry many serialized
 * workflows and legitimately exceed the default contract-route limit.
 */
const ADMIN_IMPORT_MAX_BODY_BYTES = 100 * 1024 * 1024

interface RouteParams {
  id: string
}

interface ParsedWorkflow {
  content: string
  name: string
  folderPath: string[]
}

/**
 * Returns the id of the active workflow folder named `name` under `parentId`, creating it if
 * absent — `mkdir -p` semantics.
 *
 * The generic `folder` table enforces active sibling-name uniqueness, which
 * `workflow_folder` did not, so blindly inserting an import path segment that already exists
 * now fails the whole import on a unique violation. Reusing the existing folder is also the
 * behaviour an import of a folder *path* should have: importing into "Reports/2026" twice
 * should land in one tree, not two.
 */
async function ensureImportFolder(
  workspaceId: string,
  userId: string,
  name: string,
  parentId: string | null
): Promise<string> {
  const [existing] = await db
    .select({ id: folderTable.id })
    .from(folderTable)
    .where(
      and(
        eq(folderTable.workspaceId, workspaceId),
        eq(folderTable.resourceType, 'workflow'),
        eq(folderTable.name, name),
        parentId ? eq(folderTable.parentId, parentId) : isNull(folderTable.parentId),
        isNull(folderTable.deletedAt)
      )
    )
    .limit(1)
  if (existing) return existing.id

  const folderId = generateId()
  await db.insert(folderTable).values({
    id: folderId,
    resourceType: 'workflow',
    name,
    userId,
    workspaceId,
    parentId,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return folderId
}

export const POST = withRouteHandler(
  withAdminAuthParams<RouteParams>(async (request, context) => {
    const parsed = await parseRequest(adminV1ImportWorkspaceContract, request, context)
    if (!parsed.success) return parsed.response

    const { id: workspaceId } = parsed.data.params
    const { createFolders, rootFolderName } = parsed.data.query

    try {
      const workspaceData = await getWorkspaceWithOwner(workspaceId)

      if (!workspaceData) {
        return notFoundResponse('Workspace')
      }

      const contentType = request.headers.get('content-type') || ''
      let workflowsToImport: ParsedWorkflow[] = []

      if (contentType.includes('application/json')) {
        const rawBody = await parseJsonBody(request, 'response', ADMIN_IMPORT_MAX_BODY_BYTES)

        if (!rawBody.success) {
          // Preserve the 413 for an oversized body; only invalid JSON maps to 400.
          return rawBody.reason === 'too_large'
            ? rawBody.response
            : badRequestResponse('Invalid JSON body. Expected { workflows: [...] }')
        }

        const validation = adminV1WorkspaceImportBodySchema.safeParse(rawBody.data)
        if (!validation.success) {
          return badRequestResponse('Invalid JSON body. Expected { workflows: [...] }')
        }

        const body = validation.data as WorkspaceImportRequest
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
        rootFolderId = await ensureImportFolder(
          workspaceId,
          workspaceData.ownerId,
          rootFolderName,
          null
        )
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
)

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
          const folderId = await ensureImportFolder(
            workspaceId,
            ownerId,
            wf.folderPath[i],
            parentId
          )
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

    const workflowId = generateId()
    const now = new Date()
    const dedupedName = await deduplicateWorkflowName(workflowName, workspaceId, targetFolderId)

    await db.insert(workflow).values({
      id: workflowId,
      userId: ownerId,
      workspaceId,
      folderId: targetFolderId,
      name: dedupedName,
      description: workflowData.metadata?.description || 'Imported via Admin API',
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      isDeployed: false,
      runCount: 0,
      variables: {},
    })

    /**
     * Same normalization the editor, the v1 import API and the single-workflow
     * admin import run, via the one shared implementation. Without it this route
     * wrote raw parsed state, so a dangling edge tripped the `workflow_edges`
     * foreign key and failed the restore, and blocks missing their backfilled
     * columns could land unopenable.
     */
    const { state: preparedState, warnings } = prepareWorkflowStateForPersistence(workflowData)
    if (warnings.length > 0) {
      logger.warn(`Admin API: normalized "${dedupedName}" with warnings`, { warnings })
    }

    const saveResult = await saveWorkflowToNormalizedTables(workflowId, {
      ...workflowData,
      ...preparedState,
    })

    if (!saveResult.success) {
      await db.delete(workflow).where(eq(workflow.id, workflowId))
      return {
        workflowId: '',
        name: dedupedName,
        success: false,
        error: `Failed to save state: ${saveResult.error}`,
      }
    }

    /**
     * Previously guarded on `Array.isArray`, which silently dropped every
     * variable in the current record form — the exact shape this workspace's
     * own export emits — so an export/import round trip lost all of them.
     */
    const variablesRecord = normalizeImportedVariables(workflowData.variables)
    if (Object.keys(variablesRecord).length > 0) {
      await db
        .update(workflow)
        .set({ variables: variablesRecord, updatedAt: new Date() })
        .where(eq(workflow.id, workflowId))
    }

    return {
      workflowId,
      name: dedupedName,
      success: true,
    }
  } catch (error) {
    return {
      workflowId: '',
      name: wf.name,
      success: false,
      error: getErrorMessage(error, 'Unknown error'),
    }
  }
}
