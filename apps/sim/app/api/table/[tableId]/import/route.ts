import type { Readable } from 'node:stream'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  csvExtensionSchema,
  csvImportCreateColumnsSchema,
  csvImportFormSchema,
  csvImportMappingSchema,
  csvImportModeSchema,
  tableIdParamsSchema,
} from '@/lib/api/contracts/tables'
import { ianaTimezoneSchema } from '@/lib/api/contracts/user'
import { getValidationErrorMessage } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { isMultipartError, readMultipart } from '@/lib/core/utils/multipart'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { CSV_SYNC_MAX_FILE_SIZE_BYTES, type CsvHeaderMapping } from '@/lib/table'
import { performTableCsvImport } from '@/lib/table/orchestration'
import { getUserSettings } from '@/lib/users/queries'
import {
  accessError,
  checkAccess,
  csvProxyBodyCapResponse,
  multipartErrorResponse,
} from '@/app/api/table/utils'

const logger = createLogger('TableImportCSVExisting')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface RouteParams {
  params: Promise<{ tableId: string }>
}

export const POST = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  const requestId = generateRequestId()
  const { tableId } = tableIdParamsSchema.parse(await params)
  let fileStream: Readable | undefined

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

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

    const rawMode = fields.mode ?? 'append'
    const modeValidation = csvImportModeSchema.safeParse(rawMode)
    if (!modeValidation.success) {
      return NextResponse.json(
        { error: `Invalid mode "${String(rawMode)}". Must be "append" or "replace".` },
        { status: 400 }
      )
    }
    const mode = modeValidation.data

    const ext = file.filename.split('.').pop()?.toLowerCase()
    const extensionValidation = csvExtensionSchema.safeParse(ext)
    if (!extensionValidation.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(extensionValidation.error) },
        { status: 400 }
      )
    }

    const accessResult = await checkAccess(tableId, authResult.userId, 'write')
    if (!accessResult.ok) return accessError(accessResult, requestId, tableId)

    const { table } = accessResult

    if (table.workspaceId !== workspaceId) {
      logger.warn(
        `[${requestId}] Workspace ID mismatch for table ${tableId}. Provided: ${workspaceId}, Actual: ${table.workspaceId}`
      )
      return NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 })
    }

    let mapping: CsvHeaderMapping | undefined
    if (fields.mapping) {
      const mappingValidation = csvImportMappingSchema.safeParse(fields.mapping)
      if (!mappingValidation.success) {
        return NextResponse.json(
          { error: getValidationErrorMessage(mappingValidation.error) },
          { status: 400 }
        )
      }
      mapping = mappingValidation.data
    }

    let createColumns: string[] | undefined
    if (fields.createColumns) {
      const createColumnsValidation = csvImportCreateColumnsSchema.safeParse(fields.createColumns)
      if (!createColumnsValidation.success) {
        return NextResponse.json(
          { error: getValidationErrorMessage(createColumnsValidation.error) },
          { status: 400 }
        )
      }
      createColumns = createColumnsValidation.data
    }

    let timezone = (await getUserSettings(authResult.userId)).timezone ?? 'UTC'
    if (fields.timezone) {
      const timezoneValidation = ianaTimezoneSchema.safeParse(fields.timezone)
      if (!timezoneValidation.success) {
        return NextResponse.json(
          { error: getValidationErrorMessage(timezoneValidation.error) },
          { status: 400 }
        )
      }
      timezone = timezoneValidation.data
    }

    const outcome = await performTableCsvImport({
      table,
      workspaceId,
      userId: authResult.userId,
      fileStream: file.stream,
      fileName: file.filename,
      fallbackDelimiter: extensionValidation.data === 'tsv' ? '\t' : ',',
      mode,
      mapping,
      createColumns,
      timezone,
      requestId,
    })

    if (!outcome.success) {
      // A lock rejection renders `{ error, lock }` and deliberately carries NO
      // `details`: the client's `isValidationError` treats any array-valued
      // `details` as a field-validation error and swallows the toast.
      if (outcome.errorCode === 'locked') {
        return NextResponse.json({ error: outcome.error, lock: outcome.lock }, { status: 423 })
      }
      return NextResponse.json(
        {
          error: outcome.errorCode === 'internal' ? 'Failed to import CSV' : outcome.error,
          ...(outcome.details !== undefined ? { details: outcome.details } : {}),
          // The append dialog reads this to distinguish "nothing landed" from a
          // partial import; only that mode has ever carried it.
          ...(mode === 'append' ? { data: { insertedCount: 0 } } : {}),
        },
        { status: statusForOrchestrationError(outcome.errorCode) }
      )
    }

    return NextResponse.json({ success: true, data: outcome.data })
  } catch (error) {
    if (isMultipartError(error)) return multipartErrorResponse(error)

    logger.error(`[${requestId}] CSV import into existing table failed:`, error)
    return NextResponse.json({ error: 'Failed to import CSV' }, { status: 500 })
  } finally {
    fileStream?.destroy()
  }
})
