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
import {
  assertFolderInWorkspace,
  assertFolderMutable,
  FolderLockedError,
  FolderNotFoundError,
} from '@sim/platform-authz/workflow'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { adminV1ImportWorkflowContract } from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { parseWorkflowJson } from '@/lib/workflows/operations/import-export'
import { prepareWorkflowStateForPersistence } from '@/lib/workflows/persistence/prepare-state'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import { deduplicateWorkflowName } from '@/lib/workflows/utils'
import { normalizeImportedVariables } from '@/lib/workflows/variables/parse'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
} from '@/app/api/v1/admin/responses'
import { extractWorkflowMetadata, type WorkflowImportRequest } from '@/app/api/v1/admin/types'

const logger = createLogger('AdminWorkflowImportAPI')

interface ImportSuccessResponse {
  workflowId: string
  name: string
  success: true
}

export const POST = withRouteHandler(
  withAdminAuth(async (request) => {
    try {
      const parsed = await parseRequest(adminV1ImportWorkflowContract, request, {})
      if (!parsed.success) return parsed.response

      const body = parsed.data.body as WorkflowImportRequest
      const { workspaceId, folderId, name: overrideName } = body

      const [workspaceData] = await db
        .select({ id: workspace.id, ownerId: workspace.ownerId })
        .from(workspace)
        .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
        .limit(1)

      if (!workspaceData) {
        return notFoundResponse('Workspace')
      }

      /**
       * Migration 0272 dropped the FK on `workflow.folder_id`, so nothing but this check
       * stands between the caller and a folder in another workspace — or one from another
       * resource's tree. A workflow filed under an unreachable folder still executes and
       * bills, escapes the folder delete cascade, and never counts toward
       * `guardLastWorkflows`.
       *
       * Ownership before lock state, mirroring `v1/workflows/import`: `assertFolderMutable`
       * walks the ancestor chain without filtering on workspace, so checking it first would
       * let a caller distinguish a locked folder in someone else's workspace (423) from a
       * nonexistent one (404).
       */
      if (folderId) {
        await assertFolderInWorkspace(folderId, workspaceId)
      }
      await assertFolderMutable(folderId ?? null)

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

      const { name: workflowName, description: workflowDescription } = extractWorkflowMetadata(
        parsedWorkflow,
        overrideName
      )

      const workflowId = generateId()
      const now = new Date()
      const dedupedName = await deduplicateWorkflowName(workflowName, workspaceId, folderId || null)

      await db.insert(workflow).values({
        id: workflowId,
        userId: workspaceData.ownerId,
        workspaceId,
        folderId: folderId || null,
        name: dedupedName,
        description: workflowDescription,
        lastSynced: now,
        createdAt: now,
        updatedAt: now,
        isDeployed: false,
        runCount: 0,
        variables: {},
      })

      /**
       * Same normalization the editor and the v1 import API run, via the one
       * shared implementation — without it this route wrote raw parsed state,
       * so a dangling edge tripped the `workflow_edges` foreign key and a block
       * missing its backfilled columns could land unopenable.
       */
      const { state: preparedState, warnings } = prepareWorkflowStateForPersistence(workflowData)
      if (warnings.length > 0) {
        logger.warn('Admin API: normalized imported workflow with warnings', { warnings })
      }

      const saveResult = await saveWorkflowToNormalizedTables(workflowId, {
        ...workflowData,
        ...preparedState,
      })

      if (!saveResult.success) {
        await db.delete(workflow).where(eq(workflow.id, workflowId))
        return internalErrorResponse(`Failed to save workflow state: ${saveResult.error}`)
      }

      const variablesRecord = normalizeImportedVariables(workflowData.variables)
      if (Object.keys(variablesRecord).length > 0) {
        await db
          .update(workflow)
          .set({ variables: variablesRecord, updatedAt: new Date() })
          .where(eq(workflow.id, workflowId))
      }

      logger.info(
        `Admin API: Imported workflow ${workflowId} (${dedupedName}) into workspace ${workspaceId}`
      )

      const response: ImportSuccessResponse = {
        workflowId,
        name: dedupedName,
        success: true,
      }

      return NextResponse.json(response)
    } catch (error) {
      if (error instanceof FolderNotFoundError) {
        return badRequestResponse(error.message)
      }
      if (error instanceof FolderLockedError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }
      logger.error('Admin API: Failed to import workflow', { error })
      return internalErrorResponse('Failed to import workflow')
    }
  })
)
