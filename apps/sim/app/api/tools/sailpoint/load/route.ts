import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { sailpointLoadContract } from '@/lib/api/contracts/tools/sailpoint'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processFilesToUserFiles, type RawFileInput } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import {
  getSailPointErrorMessage,
  normalizeApiVersion,
  type SailPointServerCredentials,
  sailpointFetch,
} from '@/app/api/tools/sailpoint/client'

const logger = createLogger('SailPointLoadAPI')

const LOAD_PATHS: Record<string, string> = {
  sailpoint_load_accounts: 'load-accounts',
  sailpoint_load_entitlements: 'load-entitlements',
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json(
      { success: false, error: authResult.error || 'Unauthorized' },
      { status: 401 }
    )
  }

  const parsed = await parseRequest(
    sailpointLoadContract,
    request,
    {},
    {
      validationErrorResponse: (error) =>
        NextResponse.json(
          {
            success: false,
            error: getValidationErrorMessage(error, 'Invalid SailPoint load request'),
            details: error.issues,
          },
          { status: 400 }
        ),
    }
  )
  if (!parsed.success) return parsed.response

  const body = parsed.data.body
  const creds: SailPointServerCredentials = {
    clientId: body.clientId,
    clientSecret: body.clientSecret,
    tenant: body.tenant,
    apiVersion: normalizeApiVersion(body.apiVersion),
  }

  let fileBuffer: Buffer | null = null
  let fileName = 'aggregation.csv'
  let fileType = 'text/csv'

  if (body.file && typeof body.file === 'object') {
    const userFiles = processFilesToUserFiles([body.file as RawFileInput], requestId, logger)
    if (userFiles.length === 0) {
      return NextResponse.json({ success: false, error: 'Invalid file input' }, { status: 400 })
    }
    const userFile = userFiles[0]

    const denied = await assertToolFileAccess(userFile.key, authResult.userId, requestId, logger)
    if (denied) return denied

    try {
      const { buffer } = await downloadServableFileFromStorage(userFile, requestId, logger)
      fileBuffer = buffer
      fileName = userFile.name || 'aggregation.csv'
      fileType = userFile.type || 'text/csv'
    } catch (error) {
      const notReady = docNotReadyResponse(error)
      if (notReady) return notReady
      return NextResponse.json(
        { success: false, error: getErrorMessage(error, 'Failed to download file') },
        { status: 500 }
      )
    }
  }

  const includeDisableOptimization =
    body.operation === 'sailpoint_load_accounts' && body.disableOptimization === true
  const loadPath = LOAD_PATHS[body.operation]

  /**
   * Builds a fresh multipart body for every attempt. A single FormData instance can be a consumed
   * (non-replayable) stream, so reusing it across the client's 401/429 retries could send the
   * aggregation without the CSV - rebuild it per request instead.
   */
  const buildFormData = (): FormData => {
    const formData = new FormData()
    if (fileBuffer) {
      formData.append('file', new Blob([new Uint8Array(fileBuffer)], { type: fileType }), fileName)
    }
    if (includeDisableOptimization) {
      formData.append('disableOptimization', 'true')
    }
    return formData
  }

  try {
    logger.info(`[${requestId}] SailPoint aggregation`, {
      operation: body.operation,
      apiVersion: creds.apiVersion,
      hasFile: fileBuffer != null,
    })

    const result = await sailpointFetch(creds, (_token, hosts) => ({
      url: `${hosts.apiBaseUrl}/sources/${encodeURIComponent(body.sourceId)}/${loadPath}`,
      init: { method: 'POST', body: buildFormData() },
    }))

    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          error: getSailPointErrorMessage(result.data, 'SailPoint aggregation failed'),
        },
        { status: result.status || 502 }
      )
    }

    return NextResponse.json({ success: true, output: { task: result.data ?? null } })
  } catch (error) {
    const message = getErrorMessage(error, 'SailPoint aggregation failed')
    logger.error(`[${requestId}] SailPoint aggregation failed`, { error: message })
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
})
