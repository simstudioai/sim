import type { Readable } from 'node:stream'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { csvExtensionSchema } from '@/lib/api/contracts/tables'
import {
  v2ImportIntoTableFormSchema,
  v2ImportTableCsvContract,
} from '@/lib/api/contracts/v2/tables'
import { parseRequest } from '@/lib/api/server'
import { isMultipartError, readMultipart } from '@/lib/core/utils/multipart'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { CSV_MAX_FILE_SIZE_BYTES } from '@/lib/table'
import { performTableCsvImport } from '@/lib/table/orchestration'
import { getUserSettings } from '@/lib/users/queries'
import { checkAccess } from '@/app/api/table/utils'
import { checkRateLimit, resolveWorkspaceScope } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2Data,
  v2Error,
  v2ErrorForOrchestration,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { v2CsvBodyCapError, v2MultipartError, v2TableAccessError } from '@/app/api/v2/tables/utils'

const logger = createLogger('V2TableImportAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface TableRouteParams {
  params: Promise<{ tableId: string }>
}

/**
 * POST /api/v2/tables/[tableId]/import — Synchronous CSV/TSV import.
 *
 * `multipart/form-data`, so the body never goes through `parseRequest` — the
 * streaming reader consumes the parts and the collected text fields are parsed
 * in one pass against the contract's form schema. Auth still runs first: the
 * reader is told to require `workspaceId` ahead of the file part so an
 * unauthorized upload is rejected before its bytes are read.
 */
export const POST = withRouteHandler(async (request: NextRequest, context: TableRouteParams) => {
  const requestId = generateRequestId()
  let fileStream: Readable | undefined

  try {
    const rateLimit = await checkRateLimit(request, 'table-import')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2ImportTableCsvContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { tableId } = parsed.data.params

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

    const form = v2ImportIntoTableFormSchema.safeParse(fields)
    if (!form.success) return v2ValidationError(form.error)

    const extension = csvExtensionSchema.safeParse(file.filename.split('.').pop()?.toLowerCase())
    if (!extension.success) return v2ValidationError(extension.error)

    const scopeError = await resolveWorkspaceScope(rateLimit, form.data.workspaceId)
    if (scopeError) return v2WorkspaceAccessError(scopeError)

    const access = await checkAccess(tableId, userId, 'write')
    if (!access.ok) return v2TableAccessError(access)

    if (access.table.workspaceId !== form.data.workspaceId) {
      return v2Error('NOT_FOUND', 'Table not found')
    }

    const outcome = await performTableCsvImport({
      table: access.table,
      workspaceId: form.data.workspaceId,
      userId,
      fileStream: file.stream,
      fileName: file.filename,
      fallbackDelimiter: extension.data === 'tsv' ? '\t' : ',',
      mode: form.data.mode,
      mapping: form.data.mapping,
      createColumns: form.data.createColumns,
      timezone: form.data.timezone ?? (await getUserSettings(userId)).timezone ?? 'UTC',
      requestId,
    })

    if (!outcome.success || !outcome.data) {
      // Naming the lock is the difference between an actionable 423 and one the
      // caller has to guess at — there are four flags.
      if (outcome.errorCode === 'locked') {
        return v2Error('LOCKED', outcome.error ?? 'Table is locked', {
          details: { lock: outcome.lock },
        })
      }
      return v2ErrorForOrchestration(outcome.errorCode, outcome.error ?? 'Failed to import CSV')
    }

    return v2Data(outcome.data, { rateLimit })
  } catch (error) {
    if (isMultipartError(error)) return v2MultipartError(error)

    logger.error(`[${requestId}] Error importing CSV into table`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  } finally {
    fileStream?.destroy()
  }
})
