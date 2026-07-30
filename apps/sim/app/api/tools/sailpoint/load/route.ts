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

  const formData = new FormData()

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
      formData.append(
        'file',
        new Blob([new Uint8Array(buffer)], { type: userFile.type || 'text/csv' }),
        userFile.name || 'aggregation.csv'
      )
    } catch (error) {
      const notReady = docNotReadyResponse(error)
      if (notReady) return notReady
      return NextResponse.json(
        { success: false, error: getErrorMessage(error, 'Failed to download file') },
        { status: 500 }
      )
    }
  }

  if (body.operation === 'sailpoint_load_accounts' && body.disableOptimization) {
    formData.append('disableOptimization', 'true')
  }

  const loadPath = LOAD_PATHS[body.operation]

  try {
    logger.info(`[${requestId}] SailPoint aggregation`, {
      operation: body.operation,
      apiVersion: creds.apiVersion,
      hasFile: formData.has('file'),
    })

    const result = await sailpointFetch(creds, (_token, hosts) => ({
      url: `${hosts.apiBaseUrl}/sources/${encodeURIComponent(body.sourceId)}/${loadPath}`,
      init: { method: 'POST', body: formData },
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
