import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { rampUploadReceiptContract } from '@/lib/api/contracts/tools/ramp'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processFilesToUserFiles, type RawFileInput } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import { extractRampError } from '@/tools/ramp/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('RampUploadReceiptAPI')

const RAMP_RECEIPTS_URL = 'https://api.ramp.com/developer/v1/receipts'

/**
 * Builds the multipart body for Ramp's receipt upload endpoint. Ramp expects
 * metadata parts with `Content-Disposition: form-data` and the receipt image
 * as a part named `receipt` with `Content-Disposition: attachment`.
 */
function buildReceiptMultipartBody(
  boundary: string,
  fields: Record<string, string>,
  file: { name: string; type: string; buffer: Buffer }
): Buffer {
  const parts: Buffer[] = []

  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
    )
  }

  const safeFileName = file.name.replace(/[\r\n"]/g, '_')
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: attachment; name="receipt"; filename="${safeFileName}"\r\nContent-Type: ${file.type}\r\n\r\n`
    )
  )
  parts.push(file.buffer)
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))

  return Buffer.concat(parts)
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Ramp receipt upload attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(rampUploadReceiptContract, request, {})
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    const userFiles = processFilesToUserFiles(
      [validatedData.file as RawFileInput],
      requestId,
      logger
    )

    if (userFiles.length === 0) {
      return NextResponse.json({ success: false, error: 'Invalid file input' }, { status: 400 })
    }

    const userFile = userFiles[0]
    logger.info(
      `[${requestId}] Downloading receipt file: ${userFile.name} (${userFile.size} bytes)`
    )

    const denied = await assertToolFileAccess(userFile.key, authResult.userId, requestId, logger)
    if (denied) return denied
    const fileBuffer = await downloadFileFromStorage(userFile, requestId, logger)

    const fields: Record<string, string> = {
      idempotency_key: generateId(),
      user_id: validatedData.userId,
    }
    if (validatedData.transactionId) {
      fields.transaction_id = validatedData.transactionId
    }

    const boundary = `----sim-ramp-receipt-${generateId()}`
    const body = buildReceiptMultipartBody(boundary, fields, {
      name: userFile.name,
      type: userFile.type || 'application/octet-stream',
      buffer: fileBuffer,
    })

    logger.info(`[${requestId}] Uploading receipt to Ramp (${fileBuffer.length} bytes)`)

    const response = await fetch(RAMP_RECEIPTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${validatedData.accessToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: new Uint8Array(body),
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      const errorMessage = extractRampError(data, 'Failed to upload receipt to Ramp')
      logger.error(`[${requestId}] Ramp API error:`, { status: response.status, data })
      return NextResponse.json({ success: false, error: errorMessage }, { status: response.status })
    }

    logger.info(`[${requestId}] Receipt uploaded successfully: ${data.id}`)

    return NextResponse.json({
      success: true,
      output: {
        receiptId: data.id,
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
