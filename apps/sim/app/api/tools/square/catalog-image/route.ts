import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { squareCatalogImageContract } from '@/lib/api/contracts/tools/square'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processFilesToUserFiles, type RawFileInput } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import { SQUARE_API_VERSION, SQUARE_BASE_URL } from '@/tools/square/types'

export const dynamic = 'force-dynamic'

const logger = createLogger('SquareCatalogImageAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized Square catalog image upload: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(squareCatalogImageContract, request, {})
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    if (!validatedData.file) {
      return NextResponse.json({ success: false, error: 'File is required' }, { status: 400 })
    }

    const userFiles = processFilesToUserFiles(
      [validatedData.file as RawFileInput],
      requestId,
      logger
    )

    if (userFiles.length === 0) {
      return NextResponse.json({ success: false, error: 'Invalid file input' }, { status: 400 })
    }

    const userFile = userFiles[0]
    const denied = await assertToolFileAccess(userFile.key, authResult.userId, requestId, logger)
    if (denied) return denied

    const fileBuffer = await downloadFileFromStorage(userFile, requestId, logger)
    const fileName = validatedData.fileName || userFile.name
    const mimeType = userFile.type || 'application/octet-stream'

    const imageRequest: Record<string, unknown> = {
      idempotency_key: validatedData.idempotencyKey || generateId(),
      image: {
        type: 'IMAGE',
        id: '#square_catalog_image',
        image_data: validatedData.caption ? { caption: validatedData.caption } : {},
      },
    }
    if (validatedData.objectId) imageRequest.object_id = validatedData.objectId

    const formData = new FormData()
    formData.append('request', JSON.stringify(imageRequest))
    formData.append('file', new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), fileName)

    const response = await fetch(`${SQUARE_BASE_URL}/v2/catalog/images`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${validatedData.accessToken}`,
        'Square-Version': SQUARE_API_VERSION,
      },
      body: formData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      let detail: string | undefined
      try {
        detail = JSON.parse(errorText)?.errors?.[0]?.detail
      } catch {
        detail = undefined
      }
      logger.error(`[${requestId}] Square API error:`, { status: response.status, body: errorText })
      return NextResponse.json(
        {
          success: false,
          error: detail || `Failed to upload catalog image (HTTP ${response.status})`,
        },
        { status: response.status }
      )
    }

    const data = await response.json()
    const object = data.image ?? {}

    return NextResponse.json({
      success: true,
      output: {
        object,
        metadata: {
          id: object.id ?? '',
          type: object.type ?? null,
          version: object.version ?? null,
        },
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
