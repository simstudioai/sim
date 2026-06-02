import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { linqUploadAttachmentContract } from '@/lib/api/contracts/tools/communication/messaging'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processFilesToUserFiles, type RawFileInput } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import { extractLinqError, LINQ_API_BASE, linqHeaders } from '@/tools/linq/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('LinqUploadAttachmentAPI')

/** Linq pre-upload caps attachments at 100MB. */
const MAX_SIZE_BYTES = 100 * 1024 * 1024

/**
 * Upload a file to Linq as a reusable attachment.
 *
 * Linq uses a two-step pre-upload flow: register the attachment metadata to
 * receive a presigned URL, then PUT the bytes to that URL with the exact
 * headers Linq returns. The resulting `attachment_id` can be referenced when
 * sending messages or voice memos.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Linq upload attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(linqUploadAttachmentContract, request, {})
    if (!parsed.success) return parsed.response
    const { apiKey, file, fileContent, filename, contentType } = parsed.data.body

    let buffer: Buffer
    let resolvedFilename = filename ?? ''
    let resolvedContentType = contentType ?? ''

    if (file) {
      const userFiles = processFilesToUserFiles([file as RawFileInput], requestId, logger)
      if (userFiles.length === 0) {
        return NextResponse.json(
          { success: false, error: 'No valid file provided' },
          { status: 400 }
        )
      }
      const userFile = userFiles[0]
      const denied = await assertToolFileAccess(userFile.key, authResult.userId, requestId, logger)
      if (denied) return denied
      buffer = await downloadFileFromStorage(userFile, requestId, logger)
      if (!resolvedFilename) resolvedFilename = userFile.name
      if (!resolvedContentType) resolvedContentType = userFile.type || 'application/octet-stream'
    } else if (fileContent) {
      buffer = Buffer.from(fileContent, 'base64')
      if (!resolvedFilename) resolvedFilename = 'file'
      if (!resolvedContentType) resolvedContentType = 'application/octet-stream'
    } else {
      return NextResponse.json(
        { success: false, error: 'A file is required to upload an attachment' },
        { status: 400 }
      )
    }

    const sizeBytes = buffer.length
    if (sizeBytes === 0) {
      return NextResponse.json({ success: false, error: 'File is empty' }, { status: 400 })
    }
    if (sizeBytes > MAX_SIZE_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: `File exceeds Linq's 100MB attachment limit (${(sizeBytes / (1024 * 1024)).toFixed(2)}MB)`,
        },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Registering Linq attachment`, {
      filename: resolvedFilename,
      contentType: resolvedContentType,
      sizeBytes,
    })

    const registerResponse = await fetch(`${LINQ_API_BASE}/attachments`, {
      method: 'POST',
      headers: linqHeaders(apiKey),
      body: JSON.stringify({
        filename: resolvedFilename,
        content_type: resolvedContentType,
        size_bytes: sizeBytes,
      }),
    })
    const registerData = await registerResponse.json().catch(() => null)
    if (!registerResponse.ok) {
      return NextResponse.json(
        { success: false, error: extractLinqError(registerData, 'Failed to register attachment') },
        { status: registerResponse.status }
      )
    }

    const uploadUrl: string | undefined = registerData?.upload_url
    const attachmentId: string | undefined = registerData?.attachment_id
    if (!uploadUrl || !attachmentId) {
      return NextResponse.json(
        { success: false, error: 'Linq did not return an upload URL or attachment ID' },
        { status: 502 }
      )
    }

    const requiredHeaders: Record<string, string> = registerData?.required_headers ?? {
      'Content-Type': resolvedContentType,
      'Content-Length': String(sizeBytes),
    }
    const uploadMethod: string = registerData?.http_method ?? 'PUT'

    logger.info(`[${requestId}] Uploading ${sizeBytes} bytes to presigned URL`)
    const uploadResponse = await fetch(uploadUrl, {
      method: uploadMethod,
      headers: requiredHeaders,
      body: new Uint8Array(buffer),
    })
    if (!uploadResponse.ok) {
      const uploadError = await uploadResponse.text().catch(() => '')
      logger.error(`[${requestId}] Presigned upload failed: ${uploadResponse.status}`, uploadError)
      return NextResponse.json(
        { success: false, error: `Failed to upload file bytes to Linq (${uploadResponse.status})` },
        { status: 502 }
      )
    }

    logger.info(`[${requestId}] Attachment uploaded`, { attachmentId })
    return NextResponse.json({
      success: true,
      output: {
        attachmentId,
        downloadUrl: registerData?.download_url ?? null,
        filename: resolvedFilename,
        contentType: resolvedContentType,
        sizeBytes,
        status: 'complete',
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error uploading Linq attachment:`, error)
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Unknown error occurred') },
      { status: 500 }
    )
  }
})
