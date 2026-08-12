import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { agiloftRetrieveContract } from '@/lib/api/contracts/tools/agiloft'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { secureFetchWithPinnedIP } from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveEffectiveMimeType } from '@/lib/uploads/utils/file-utils'
import { isEwRestBody } from '@/tools/agiloft/ewrest'
import {
  AGILOFT_MAX_ATTACHMENT_BYTES,
  buildRetrieveAttachmentUrl,
  describeAgiloftError,
} from '@/tools/agiloft/utils'
import { resolveAgiloftInstance } from '@/tools/agiloft/utils.server'

export const dynamic = 'force-dynamic'

const logger = createLogger('AgiloftRetrieveAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Agiloft retrieve attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      agiloftRetrieveContract,
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
       * EWRetrieve is the documented endpoint for this: GET on the legacy
       * surface, authenticating from inline credentials, answering with the
       * raw file bytes. It needs no login/logout pair, which also avoids two
       * extra round trips against Agiloft's one-second per-call delay.
       */
      const url = buildRetrieveAttachmentUrl(base, data)

      logger.info(`[${requestId}] Downloading attachment from Agiloft`, {
        recordId: data.recordId,
        fieldName: data.fieldName,
        position: data.position,
      })

      const agiloftResponse = await secureFetchWithPinnedIP(url, resolvedIP, {
        method: 'GET',
        maxResponseBytes: AGILOFT_MAX_ATTACHMENT_BYTES,
      })

      if (!agiloftResponse.ok) {
        const errorText = await agiloftResponse.text()
        logger.error(
          `[${requestId}] Agiloft retrieve error: ${agiloftResponse.status} - ${errorText}`
        )
        return NextResponse.json(
          {
            success: false,
            error: `Agiloft error ${agiloftResponse.status}: ${describeAgiloftError(errorText)}`,
          },
          { status: agiloftResponse.status }
        )
      }

      const contentType = agiloftResponse.headers.get('content-type') || 'application/octet-stream'
      const contentDisposition = agiloftResponse.headers.get('content-disposition')
      let fileName = 'attachment'

      if (contentDisposition) {
        const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
        if (match?.[1]) {
          fileName = match[1].replace(/['"]/g, '')
        }
      }

      const arrayBuffer = await agiloftResponse.arrayBuffer()
      const fileBuffer = Buffer.from(arrayBuffer)

      /**
       * A refusal comes back as an EWREST assignment or a plain-text error
       * rather than file bytes, so a body that parses as one is an error
       * document, not an attachment.
       */
      if (isEwRestBody(fileBuffer.subarray(0, 512).toString('utf8'))) {
        const envelope = fileBuffer.toString('utf8').slice(0, 300)
        logger.error(`[${requestId}] Agiloft refused the attachment retrieve`, { envelope })
        return NextResponse.json(
          { success: false, error: `Agiloft error: ${envelope}` },
          { status: 502 }
        )
      }

      /**
       * Agiloft labels most attachments application/octet-stream whatever they
       * are, so downstream consumers keyed on the header mis-handle them. The
       * filename Agiloft sends in Content-Disposition carries the real type.
       */
      const mimeType = resolveEffectiveMimeType(contentType, fileName)

      logger.info(`[${requestId}] Attachment downloaded successfully`, {
        name: fileName,
        size: fileBuffer.length,
        mimeType,
      })

      const base64Data = fileBuffer.toString('base64')

      return NextResponse.json({
        success: true,
        output: {
          file: {
            name: fileName,
            mimeType,
            data: base64Data,
            size: fileBuffer.length,
          },
        },
      })
    }
  } catch (error) {
    logger.error(`[${requestId}] Error retrieving Agiloft attachment:`, error)

    return NextResponse.json({ success: false, error: toError(error).message }, { status: 500 })
  }
})
