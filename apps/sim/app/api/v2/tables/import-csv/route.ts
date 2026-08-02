import type { Readable } from 'node:stream'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { csvExtensionSchema } from '@/lib/api/contracts/tables'
import {
  v2CreateTableFromCsvContract,
  v2CreateTableFromCsvFormSchema,
} from '@/lib/api/contracts/v2/tables'
import { parseRequest } from '@/lib/api/server'
import { isMultipartError, readMultipart } from '@/lib/core/utils/multipart'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { findActiveFolder } from '@/lib/folders/queries'
import { CSV_MAX_FILE_SIZE_BYTES, getTableById } from '@/lib/table'
import { performCreateTableFromCsv } from '@/lib/table/orchestration'
import { getUserSettings } from '@/lib/users/queries'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2Data,
  v2Error,
  v2ErrorForOrchestration,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { toApiTable, v2CsvBodyCapError, v2MultipartError } from '@/app/api/v2/tables/utils'

const logger = createLogger('V2CreateTableFromCsvAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/v2/tables/import-csv — Create a table from a CSV/TSV.
 *
 * The column schema is inferred from the file's first rows and the table is
 * named after the file. Workspace-scoped rather than table-scoped, so the
 * permission check is the workspace one — there is no table to authorize
 * against yet.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  let fileStream: Readable | undefined

  try {
    const rateLimit = await checkRateLimit(request, 'table-import')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2CreateTableFromCsvContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response

    const oversize = v2CsvBodyCapError(request)
    if (oversize) return oversize

    let multipart: Awaited<ReturnType<typeof readMultipart>>
    try {
      multipart = await readMultipart(request, {
        maxFileBytes: CSV_MAX_FILE_SIZE_BYTES,
        requiredFieldsBeforeFile: ['workspaceId'],
        signal: request.signal,
      })
    } catch (err) {
      if (isMultipartError(err)) return v2MultipartError(err)
      throw err
    }

    const { fields, file } = multipart
    if (!file) return v2Error('BAD_REQUEST', 'CSV file is required')
    fileStream = file.stream

    const form = v2CreateTableFromCsvFormSchema.safeParse(fields)
    if (!form.success) return v2ValidationError(form.error)

    const extension = csvExtensionSchema.safeParse(file.filename.split('.').pop()?.toLowerCase())
    if (!extension.success) return v2ValidationError(extension.error)

    const accessError = await resolveWorkspaceAccess(
      rateLimit,
      userId,
      form.data.workspaceId,
      'write'
    )
    if (accessError) return v2WorkspaceAccessError(accessError)

    // Scoped to `resourceType: 'table'` so a folder id from another resource's
    // tree can't file the imported table where Tables never lists it.
    if (
      form.data.folderId &&
      !(await findActiveFolder(form.data.folderId, form.data.workspaceId, 'table'))
    ) {
      return v2Error('NOT_FOUND', 'Folder not found in this workspace')
    }

    const outcome = await performCreateTableFromCsv({
      workspaceId: form.data.workspaceId,
      userId,
      fileStream: file.stream,
      fileName: file.filename,
      fallbackDelimiter: extension.data === 'tsv' ? '\t' : ',',
      folderId: form.data.folderId ?? null,
      timezone: form.data.timezone ?? (await getUserSettings(userId)).timezone ?? 'UTC',
      requestId,
    })

    if (!outcome.success || !outcome.data) {
      return v2ErrorForOrchestration(outcome.errorCode, outcome.error ?? 'Failed to import CSV')
    }

    // Re-read so the response carries the canonical v2 table shape (row count,
    // plan row cap, timestamps) rather than the import's partial view.
    const table = await getTableById(outcome.data.table.id)
    if (!table) return v2Error('INTERNAL_ERROR', 'Internal server error')

    return v2Data({ table: toApiTable(table) }, { rateLimit, status: 201 })
  } catch (error) {
    if (isMultipartError(error)) return v2MultipartError(error)

    logger.error(`[${requestId}] Error creating table from CSV`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  } finally {
    fileStream?.destroy()
  }
})
