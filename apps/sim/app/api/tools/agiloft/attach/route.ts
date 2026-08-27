import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftAttachContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { secureFetchWithPinnedIP } from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import { parseEwRest } from '@/tools/agiloft/ewrest'
import { buildAttachFileUrl, describeAgiloftError } from '@/tools/agiloft/utils'
import { resolveAgiloftInstance } from '@/tools/agiloft/utils.server'

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

    let fileBuffer: Buffer
    try {
      const servable = await downloadServableFileFromStorage(userFile, requestId, logger, {
        maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
      })
      fileBuffer = servable.buffer
    } catch (error) {
      const notReady = docNotReadyResponse(error)
      if (notReady) return notReady
      logger.error(`[${requestId}] Failed to download file from storage:`, error)
      return NextResponse.json(
        { success: false, error: toError(error).message },
        { status: isPayloadSizeLimitError(error) ? 413 : 500 }
      )
    }

    const resolvedFileName = data.fileName || userFile.name || 'attachment'

    let resolvedIP: string
    try {
      resolvedIP = await resolveAgiloftInstance(data.instanceUrl)
    } catch (error) {
      logger.warn(`[${requestId}] SSRF attempt blocked for Agiloft instance URL`, {
        instanceUrl: data.instanceUrl,
      })
      return NextResponse.json({ success: false, error: toError(error).message }, { status: 400 })
    }

    const base = data.instanceUrl.replace(/\/$/, '')

    {
      /**
       * EWAttach lives on the legacy surface, which authenticates from the
       * inline credentials in the URL and rejects a bearer token — so there is
       * no login/logout pair here.
       */
      const url = buildAttachFileUrl(base, data, resolvedFileName)

      logger.info(`[${requestId}] Uploading file to Agiloft: ${resolvedFileName}`)

      const agiloftResponse = await secureFetchWithPinnedIP(url, resolvedIP, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        body: new Uint8Array(fileBuffer),
      })

      if (!agiloftResponse.ok) {
        const errorText = await agiloftResponse.text()
        logger.error(
          `[${requestId}] Agiloft attach error: ${agiloftResponse.status} - ${errorText}`
        )
        return NextResponse.json(
          {
            success: false,
            error: `Agiloft error ${agiloftResponse.status}: ${describeAgiloftError(errorText)}`,
          },
          { status: agiloftResponse.status }
        )
      }

      /**
       * EWAttach reports the new file count against the field it wrote to, as
       * EWREST_<fieldName>.length='1'; — the key is field-specific, so the
       * single returned assignment is read rather than a fixed key.
       */
      const responseText = await agiloftResponse.text()
      const assignments = parseEwRest(responseText)
      const countRaw =
        assignments.get(`${data.fieldName.trim()}.length`) ?? [...assignments.values()][0]
      const totalAttachments = Number(countRaw)

      /**
       * A 200 with no parsable count is not a confirmed write, so it fails
       * closed rather than reporting success with zero attachments.
       */
      if (!Number.isFinite(totalAttachments)) {
        logger.error(`[${requestId}] Agiloft attach returned an unrecognised body`, {
          body: responseText.slice(0, 200),
        })
        return NextResponse.json(
          {
            success: false,
            error: `Agiloft did not confirm the attachment: ${describeAgiloftError(responseText) || '(empty response)'}`,
          },
          { status: 502 }
        )
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
    }
  } catch (error) {
    logger.error(`[${requestId}] Error attaching file to Agiloft:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
