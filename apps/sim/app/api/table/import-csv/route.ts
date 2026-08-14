import type { Readable } from 'node:stream'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { csvExtensionSchema, csvImportFormSchema } from '@/lib/api/contracts/tables'
import { ianaTimezoneSchema } from '@/lib/api/contracts/user'
import { getValidationErrorMessage } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { isMultipartError, readMultipart } from '@/lib/core/utils/multipart'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { findActiveFolder } from '@/lib/folders/queries'
import { CSV_SYNC_MAX_FILE_SIZE_BYTES } from '@/lib/table'
import { performCreateTableFromCsv } from '@/lib/table/orchestration'
import { getUserSettings } from '@/lib/users/queries'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import {
  csvProxyBodyCapResponse,
  multipartErrorResponse,
  orchestrationOutcomeErrorResponse,
} from '@/app/api/table/utils'

const logger = createLogger('TableImportCSV')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  let fileStream: Readable | undefined

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    const userId = authResult.userId

    const oversize = csvProxyBodyCapResponse(request)
    if (oversize) return oversize

    let parsed: Awaited<ReturnType<typeof readMultipart>>
    try {
      parsed = await readMultipart(request, {
        maxFileBytes: CSV_SYNC_MAX_FILE_SIZE_BYTES,
        requiredFieldsBeforeFile: ['workspaceId'],
        signal: request.signal,
      })
    } catch (err) {
      if (isMultipartError(err)) return multipartErrorResponse(err)
      throw err
    }

    const { fields, file } = parsed
    if (!file) {
      return NextResponse.json({ error: 'CSV file is required' }, { status: 400 })
    }
    fileStream = file.stream

    const workspaceIdResult = csvImportFormSchema.shape.workspaceId.safeParse(fields.workspaceId)
    if (!workspaceIdResult.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(workspaceIdResult.error) },
        { status: 400 }
      )
    }
    const workspaceId = workspaceIdResult.data

    const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (permission !== 'write' && permission !== 'admin') {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    let folderId: string | null = null
    if (fields.folderId) {
      const folderIdResult = csvImportFormSchema.shape.folderId.safeParse(fields.folderId)
      if (!folderIdResult.success) {
        return NextResponse.json(
          { error: getValidationErrorMessage(folderIdResult.error) },
          { status: 400 }
        )
      }
      // Scoped to `resourceType: 'table'` so a folder from another resource's tree
      // can't file the imported table where Tables never lists it.
      if (!(await findActiveFolder(folderIdResult.data as string, workspaceId, 'table'))) {
        return NextResponse.json({ error: 'Folder not found in this workspace' }, { status: 404 })
      }
      folderId = folderIdResult.data as string
    }

    let timezone = (await getUserSettings(userId)).timezone ?? 'UTC'
    if (fields.timezone) {
      const timezoneResult = ianaTimezoneSchema.safeParse(fields.timezone)
      if (!timezoneResult.success) {
        return NextResponse.json(
          { error: getValidationErrorMessage(timezoneResult.error) },
          { status: 400 }
        )
      }
      timezone = timezoneResult.data
    }

    const ext = file.filename.split('.').pop()?.toLowerCase()
    const extensionResult = csvExtensionSchema.safeParse(ext)
    if (!extensionResult.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(extensionResult.error) },
        { status: 400 }
      )
    }

    const outcome = await performCreateTableFromCsv({
      workspaceId,
      userId,
      fileStream: file.stream,
      fileName: file.filename,
      fallbackDelimiter: extensionResult.data === 'tsv' ? '\t' : ',',
      folderId,
      timezone,
      requestId,
    })

    if (!outcome.success) {
      return orchestrationOutcomeErrorResponse(outcome, 'Failed to import CSV')
    }

    return NextResponse.json({ success: true, data: outcome.data })
  } catch (error) {
    if (isMultipartError(error)) return multipartErrorResponse(error)

    logger.error(`[${requestId}] CSV import failed:`, error)
    return NextResponse.json({ error: 'Failed to import CSV' }, { status: 500 })
  } finally {
    fileStream?.destroy()
  }
})
