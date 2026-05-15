import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftAttachContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateUrlWithDNS } from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import { agiloftLogin, agiloftLogout, buildAttachFileUrl } from '@/tools/agiloft/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftAttachAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Agiloft attach attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      agiloftAttachContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn(`[${requestId}] Invalid request data`, { errors: error.issues })
          return NextResponse.json(
            {
              success: false,
              error: getValidationErrorMessage(error, 'Invalid request data'),
              details: error.issues,
            },
            { status: 400 }
          )
        },
      }
    )
    if (!parsed.success) return parsed.response
    const data = parsed.data.body

    if (!data.file) {
      return NextResponse.json({ success: false, error: 'File is required' }, { status: 400 })
    }

    const userFiles = processFilesToUserFiles([data.file as RawFileInput], requestId, logger)

    if (userFiles.length === 0) {
      return NextResponse.json({ success: false, error: 'Invalid file input' }, { status: 400 })
    }

    const userFile = userFiles[0]
    logger.info(
      `[${requestId}] Downloading file for Agiloft attach: ${userFile.name} (${userFile.size} bytes)`
    )

    const denied = await assertToolFileAccess(userFile.key, authResult.userId, requestId, logger)
    if (denied) return denied
    const fileBuffer = await downloadFileFromStorage(userFile, requestId, logger)
    const resolvedFileName = data.fileName || userFile.name || 'attachment'

    const urlValidation = await validateUrlWithDNS(data.instanceUrl, 'instanceUrl')
    if (!urlValidation.isValid) {
      logger.warn(`[${requestId}] SSRF attempt blocked for Agiloft instance URL`, {
        instanceUrl: data.instanceUrl,
      })
      return NextResponse.json(
        { success: false, error: urlValidation.error || 'Invalid instance URL' },
        { status: 400 }
      )
    }

    const token = await agiloftLogin(data)
    const base = data.instanceUrl.replace(/\/$/, '')

    try {
      const url = buildAttachFileUrl(base, data, resolvedFileName)

      logger.info(`[${requestId}] Uploading file to Agiloft: ${resolvedFileName}`)

      const agiloftResponse = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          Authorization: `Bearer ${token}`,
        },
        body: new Uint8Array(fileBuffer),
      })

      if (!agiloftResponse.ok) {
        const errorText = await agiloftResponse.text()
        logger.error(
          `[${requestId}] Agiloft attach error: ${agiloftResponse.status} - ${errorText}`
        )
        return NextResponse.json(
          { success: false, error: `Agiloft error: ${agiloftResponse.status} - ${errorText}` },
          { status: agiloftResponse.status }
        )
      }

      let totalAttachments = 0
      const responseText = await agiloftResponse.text()
      try {
        const responseData = JSON.parse(responseText)
        const result = responseData.result ?? responseData
        totalAttachments = typeof result === 'number' ? result : (result.count ?? result.total ?? 1)
      } catch {
        totalAttachments = Number(responseText) || 1
      }

      logger.info(
        `[${requestId}] File attached successfully. Total attachments: ${totalAttachments}`
      )

      return NextResponse.json({
        success: true,
        output: {
          recordId: data.recordId.trim(),
          fieldName: data.fieldName.trim(),
          fileName: resolvedFileName,
          totalAttachments,
        },
      })
    } finally {
      await agiloftLogout(data.instanceUrl, data.knowledgeBase, token)
    }
  } catch (error) {
    logger.error(`[${requestId}] Error attaching file to Agiloft:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
