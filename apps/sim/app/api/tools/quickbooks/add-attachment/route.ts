import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { quickBooksAddAttachmentContract } from '@/lib/api/contracts/tools/quickbooks'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { assertKnownSizeWithinLimit, isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import { buildQuickBooksCompanyUrl, buildQuickBooksHeaders } from '@/tools/quickbooks/client'
import {
  assertSingleQuickBooksFile,
  buildQuickBooksAttachableMetadata,
  getQuickBooksDocumentError,
  parseQuickBooksAttachableResponse,
  sanitizeQuickBooksFileName,
  validateQuickBooksAttachmentFileType,
} from '@/tools/quickbooks/documents_utils'

export const dynamic = 'force-dynamic'
const logger = createLogger('QuickBooksAddAttachmentAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = `quickbooks-attachment-${Date.now()}`
  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { success: false, error: authResult.error || 'Unauthorized' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(
      quickBooksAddAttachmentContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          NextResponse.json(
            { success: false, error: getValidationErrorMessage(error, 'Invalid request') },
            { status: 400 }
          ),
      }
    )
    if (!parsed.success) return parsed.response
    const data = parsed.data.body
    request.signal.throwIfAborted()
    const url = buildQuickBooksCompanyUrl(
      data.realmId,
      data.attachmentKind === 'file' ? 'upload' : 'attachable'
    )
    let response: Response

    if (data.attachmentKind === 'note') {
      const metadata = buildQuickBooksAttachableMetadata(data.targetType, data.targetId, {
        note: data.note!,
      })
      response = await fetch(url, {
        method: 'POST',
        headers: {
          ...buildQuickBooksHeaders(data.accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metadata),
        signal: request.signal,
      })
    } else {
      request.signal.throwIfAborted()
      const rawFile = assertSingleQuickBooksFile(data.file ?? undefined)
      const files = processFilesToUserFiles([rawFile], requestId, logger)
      if (files.length !== 1) throw new Error('Exactly one valid file is required')
      const file = files[0]
      assertKnownSizeWithinLimit(file.size, MAX_FILE_SIZE, 'QuickBooks attachment file')
      const denied = await assertToolFileAccess(file.key, authResult.userId, requestId, logger)
      if (denied) return denied
      let downloaded: Awaited<ReturnType<typeof downloadServableFileFromStorage>>
      try {
        downloaded = await downloadServableFileFromStorage(file, requestId, logger, {
          maxBytes: MAX_FILE_SIZE,
          signal: request.signal,
        })
      } catch (error) {
        const notReady = docNotReadyResponse(error)
        if (notReady) return notReady
        throw error
      }
      request.signal.throwIfAborted()
      assertKnownSizeWithinLimit(
        downloaded.buffer.length,
        MAX_FILE_SIZE,
        'QuickBooks attachment file'
      )
      if (downloaded.buffer.length === 0)
        throw new Error('QuickBooks attachment file cannot be empty')
      const resolvedName = sanitizeQuickBooksFileName(data.fileName ?? undefined, file.name)
      const storedMime = (downloaded.contentType || file.type || '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase()
      const requestedMime = data.contentType?.trim().toLowerCase() || storedMime
      const mimeType = validateQuickBooksAttachmentFileType(resolvedName, requestedMime)
      if (data.contentType && storedMime && requestedMime !== storedMime) {
        validateQuickBooksAttachmentFileType(resolvedName, storedMime)
      }
      const metadata = buildQuickBooksAttachableMetadata(data.targetType, data.targetId, {
        fileName: resolvedName,
        contentType: mimeType,
        description: data.description ?? undefined,
      })
      const formData = new FormData()
      formData.append(
        'file_metadata_01',
        new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
        'attachment.json'
      )
      formData.append(
        'file_content_01',
        new Blob([new Uint8Array(downloaded.buffer)], { type: mimeType }),
        resolvedName
      )
      request.signal.throwIfAborted()
      response = await fetch(url, {
        method: 'POST',
        headers: buildQuickBooksHeaders(data.accessToken),
        body: formData,
        signal: request.signal,
      })
    }

    if (!response.ok) throw await getQuickBooksDocumentError(response, request.signal)
    const transformed = await parseQuickBooksAttachableResponse(response, request.signal)
    return NextResponse.json({
      success: true,
      output: {
        attachment: transformed.attachment,
        attachmentId: transformed.attachment.Id.trim(),
        attachmentKind: data.attachmentKind,
        targetType: data.targetType,
        targetId: data.targetId,
        time: transformed.time,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] QuickBooks attachment creation failed`, {
      error: getErrorMessage(error),
    })
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Failed to add QuickBooks attachment') },
      { status: isPayloadSizeLimitError(error) ? 413 : 500 }
    )
  }
})
