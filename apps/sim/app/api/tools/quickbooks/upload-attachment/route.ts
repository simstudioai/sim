import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { quickBooksUploadAttachmentContract } from '@/lib/api/contracts/tools/quickbooks'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processFilesToUserFiles, type RawFileInput } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import {
  assertQuickBooksAttachmentUploadResponse,
  buildQuickBooksHeaders,
  buildQuickBooksUploadUrl,
  normalizeQuickBooksAttachmentEntity,
  parseQuickBooksJson,
} from '@/tools/quickbooks/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('QuickBooksUploadAttachmentAPI')
const QUICKBOOKS_MAX_UPLOAD_BYTES = 100 * 1024 * 1024

function uploadSizeError(bytes: number): NextResponse {
  const sizeMb = (bytes / (1024 * 1024)).toFixed(2)
  return NextResponse.json(
    {
      success: false,
      error: `File size (${sizeMb}MB) exceeds QuickBooks attachment limit of 100MB`,
    },
    { status: 400 }
  )
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json(
      { success: false, error: authResult.error || 'Authentication required' },
      { status: 401 }
    )
  }

  const parsed = await parseRequest(quickBooksUploadAttachmentContract, request, {})
  if (!parsed.success) return parsed.response
  const params = parsed.data.body
  const requestId = generateRequestId()
  const userFiles = processFilesToUserFiles([params.file as RawFileInput], requestId, logger)
  if (userFiles.length === 0) {
    return NextResponse.json({ success: false, error: 'Invalid file input' }, { status: 400 })
  }

  const userFile = userFiles[0]
  const denied = await assertToolFileAccess(userFile.key, authResult.userId, requestId, logger)
  if (denied) return denied
  if (userFile.size > QUICKBOOKS_MAX_UPLOAD_BYTES) return uploadSizeError(userFile.size)

  try {
    const downloaded = await downloadServableFileFromStorage(userFile, requestId, logger, {
      maxBytes: QUICKBOOKS_MAX_UPLOAD_BYTES,
    })
    if (downloaded.buffer.length > QUICKBOOKS_MAX_UPLOAD_BYTES) {
      return uploadSizeError(downloaded.buffer.length)
    }

    const contentType = downloaded.contentType || userFile.type || 'application/octet-stream'
    const entity = normalizeQuickBooksAttachmentEntity(params.entity)
    const metadata = {
      AttachableRef: [
        {
          EntityRef: {
            type: entity,
            value: params.entityId,
          },
          IncludeOnSend: params.includeOnSend ?? false,
        },
      ],
      FileName: userFile.name,
      ContentType: contentType,
      ...(params.note ? { Note: params.note } : {}),
    }
    const formData = new FormData()
    formData.append(
      'file_content_01',
      new Blob([new Uint8Array(downloaded.buffer)], { type: contentType }),
      userFile.name
    )
    formData.append(
      'file_metadata_01',
      new Blob([JSON.stringify(metadata)], { type: 'application/json' })
    )

    const response = await fetch(
      buildQuickBooksUploadUrl({
        realmId: params.realmId,
        apiEnvironment: params.apiEnvironment,
        minorVersion: params.minorVersion,
      }),
      {
        method: 'POST',
        headers: {
          Authorization: buildQuickBooksHeaders(params.accessToken).Authorization,
          Accept: 'application/json',
        },
        body: formData,
      }
    )
    const data = assertQuickBooksAttachmentUploadResponse(await parseQuickBooksJson(response))
    return NextResponse.json({ success: true, output: { result: data } })
  } catch (error) {
    const notReady = docNotReadyResponse(error)
    if (notReady) return notReady
    if (error instanceof PayloadSizeLimitError) {
      return uploadSizeError(error.observedBytes ?? userFile.size)
    }
    logger.error('QuickBooks attachment upload failed', error)
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Failed to upload QuickBooks attachment') },
      { status: 500 }
    )
  }
})
