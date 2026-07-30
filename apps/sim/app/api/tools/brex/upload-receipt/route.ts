import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { brexUploadReceiptContract } from '@/lib/api/contracts/tools/brex'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processFilesToUserFiles, type RawFileInput } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import { BREX_API_BASE, buildBrexHeaders } from '@/tools/brex/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('BrexUploadReceiptAPI')

const MAX_RECEIPT_SIZE_BYTES = 50 * 1024 * 1024

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Brex receipt upload attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(brexUploadReceiptContract, request, {})
    if (!parsed.success) return parsed.response
    const { apiKey, expenseId, file, receiptName } = parsed.data.body

    const userFiles = processFilesToUserFiles([file as RawFileInput], requestId, logger)
    if (userFiles.length === 0) {
      return NextResponse.json({ success: false, error: 'Invalid file input' }, { status: 400 })
    }

    const userFile = userFiles[0]
    const denied = await assertToolFileAccess(userFile.key, authResult.userId, requestId, logger)
    if (denied) return denied

    let fileBuffer: Buffer
    try {
      const resolved = await downloadServableFileFromStorage(userFile, requestId, logger)
      fileBuffer = resolved.buffer
    } catch (error) {
      const notReady = docNotReadyResponse(error)
      if (notReady) return notReady
      logger.error(`[${requestId}] Failed to download receipt file:`, error)
      return NextResponse.json(
        { success: false, error: getErrorMessage(error, 'Unknown error') },
        { status: 500 }
      )
    }
    if (fileBuffer.length > MAX_RECEIPT_SIZE_BYTES) {
      return NextResponse.json(
        { success: false, error: 'Receipt file exceeds the 50 MB limit' },
        { status: 400 }
      )
    }

    const effectiveReceiptName = receiptName || userFile.name
    const endpoint = expenseId
      ? `${BREX_API_BASE}/v1/expenses/card/${encodeURIComponent(expenseId)}/receipt_upload`
      : `${BREX_API_BASE}/v1/expenses/card/receipt_match`

    logger.info(
      `[${requestId}] Creating Brex ${expenseId ? 'receipt upload' : 'receipt match'}: ${effectiveReceiptName} (${fileBuffer.length} bytes)`
    )

    const createResponse = await fetch(endpoint, {
      method: 'POST',
      headers: buildBrexHeaders(apiKey),
      body: JSON.stringify({ receipt_name: effectiveReceiptName }),
    })

    if (!createResponse.ok) {
      const errorText = await createResponse.text()
      logger.error(`[${requestId}] Brex API error:`, {
        status: createResponse.status,
        error: errorText,
      })
      let message = errorText
      try {
        message = JSON.parse(errorText).message ?? errorText
      } catch {
        message = errorText
      }
      return NextResponse.json(
        { success: false, error: `Brex API error (${createResponse.status}): ${message}` },
        { status: createResponse.status }
      )
    }

    const createData = await createResponse.json()
    if (!createData.uri || !createData.id) {
      return NextResponse.json(
        { success: false, error: 'Brex did not return an upload URL' },
        { status: 502 }
      )
    }

    const uriValidation = await validateUrlWithDNS(createData.uri, 'uri')
    if (!uriValidation.isValid) {
      logger.error(`[${requestId}] Pre-signed upload URL failed SSRF validation:`, {
        error: uriValidation.error,
      })
      return NextResponse.json(
        { success: false, error: 'Brex returned an invalid upload URL' },
        { status: 502 }
      )
    }

    const uploadResponse = await secureFetchWithPinnedIP(
      createData.uri,
      uriValidation.resolvedIP!,
      {
        method: 'PUT',
        body: new Uint8Array(fileBuffer),
      }
    )

    if (!uploadResponse.ok) {
      logger.error(`[${requestId}] Receipt upload to pre-signed URL failed:`, {
        status: uploadResponse.status,
      })
      return NextResponse.json(
        { success: false, error: `Failed to upload receipt file (${uploadResponse.status})` },
        { status: 502 }
      )
    }

    logger.info(`[${requestId}] Receipt uploaded successfully (ID: ${createData.id})`)

    return NextResponse.json({
      success: true,
      output: {
        receiptId: createData.id,
        receiptName: effectiveReceiptName,
        expenseId: expenseId ?? null,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Unexpected error:`, error)
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Unknown error') },
      { status: 500 }
    )
  }
})
