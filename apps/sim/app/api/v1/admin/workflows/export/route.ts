/**
 * POST /api/v1/admin/workflows/export
 *
 * Export multiple workflows as a ZIP file or JSON array (raw, unsanitized for admin backup/restore).
 *
 * Request Body:
 *   - ids: string[] - Array of workflow IDs to export
 *
 * Query Parameters:
 *   - format: 'zip' (default) or 'json'
 *
 * Response:
 *   - ZIP file download (Content-Type: application/zip) - each workflow as JSON in root
 *   - JSON: AdminListResponse<WorkflowExportPayload[]>
 */

import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { inArray } from 'drizzle-orm'
import JSZip from 'jszip'
import { NextResponse } from 'next/server'
import { adminV1ExportWorkflowsContract } from '@/lib/api/contracts/v1/admin'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { sanitizePathSegment } from '@/lib/workflows/operations/import-export'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  listResponse,
} from '@/app/api/v1/admin/responses'
import {
  parseWorkflowVariables,
  type WorkflowExportPayload,
  type WorkflowExportState,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminWorkflowsExportAPI')

export const POST = withRouteHandler(
  withAdminAuth(async (request) => {
    const parsed = await parseRequest(adminV1ExportWorkflowsContract, request, {})
    if (!parsed.success) return parsed.response

    const { format } = parsed.data.query
    const body = parsed.data.body

    try {
      const workflows = await db.select().from(workflow).where(inArray(workflow.id, body.ids))

      if (workflows.length === 0) {
        return badRequestResponse('No workflows found with the provided IDs')
      }

      const workflowExports: WorkflowExportPayload[] = []

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

          const exportPayload: WorkflowExportPayload = {
            version: '1.0',
            exportedAt: new Date().toISOString(),
            workflow: {
              id: wf.id,
              name: wf.name,
              description: wf.description,
              color: wf.color,
              workspaceId: wf.workspaceId,
              folderId: wf.folderId,
            },
            state,
          }

          workflowExports.push(exportPayload)
        } catch (error) {
          logger.error(`Failed to load workflow ${wf.id}:`, { error })
        }
      }

      logger.info(`Admin API: Exporting ${workflowExports.length} workflows`)

      if (format === 'json') {
        return listResponse(workflowExports, {
          total: workflowExports.length,
          limit: workflowExports.length,
          offset: 0,
          hasMore: false,
        })
      }

      const zip = new JSZip()

      for (const exportPayload of workflowExports) {
        const filename = `${sanitizePathSegment(exportPayload.workflow.name)}.json`
        zip.file(filename, JSON.stringify(exportPayload, null, 2))
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const arrayBuffer = await zipBlob.arrayBuffer()

      const filename = `workflows-export-${new Date().toISOString().split('T')[0]}.zip`

      return new NextResponse(arrayBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': arrayBuffer.byteLength.toString(),
        },
      })
    } catch (error) {
      logger.error('Admin API: Failed to export workflows', { error, ids: body.ids })
      return internalErrorResponse('Failed to export workflows')
    }
  })
)
