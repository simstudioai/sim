import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { googleVaultDownloadExportFileContract } from '@/lib/api/contracts/tools/google'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { enhanceGoogleVaultError } from '@/tools/google_vault/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('GoogleVaultDownloadExportFileAPI')

/**
 * Rejects a value that would collapse the URL path segment it occupies.
 *
 * This route deliberately keeps `encodeURIComponent` on the object name: a GCS
 * object name legitimately contains `/`, and the JSON API addresses it as a
 * single segment with those slashes as `%2F`, so the multi-segment
 * `safeUrlPath` helper would misaddress the object. But encoding never
 * neutralizes a dot segment — `.` and `..` are unreserved, so they survive
 * encoding and the WHATWG parser removes the segment afterwards, turning
 * `/b/{bucket}/o/..` into the object *list* endpoint with the caller's bearer
 * token attached. Only rejection closes that, and only the whole value can do
 * it: an interior `..` is encoded into the same segment and stays inert.
 *
 * The check trims before comparing but the caller still sends the untrimmed
 * value, so no legitimate name is silently rewritten.
 */
function assertNotDotSegment(value: string, paramName: string): void {
  const trimmed = value.trim()
  if (trimmed === '.' || trimmed === '..') {
    throw new Error(`${paramName} cannot be "${trimmed}" (path traversal is not allowed)`)
  }
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Google Vault download attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    const parsed = await parseRequest(googleVaultDownloadExportFileContract, request, {})
    if (!parsed.success) return parsed.response
    const validatedData = parsed.data.body

    const { accessToken, bucketName, objectName, fileName } = validatedData

    try {
      assertNotDotSegment(bucketName, 'bucketName')
      assertNotDotSegment(objectName, 'objectName')
    } catch (error) {
      const message = getErrorMessage(error, 'Invalid request')
      logger.warn(`[${requestId}] Rejected unsafe Vault object path`, { error: message })
      return NextResponse.json({ success: false, error: message }, { status: 400 })
    }

    const bucket = encodeURIComponent(bucketName)
    const object = encodeURIComponent(objectName)
    const downloadUrl = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${object}?alt=media`

    logger.info(`[${requestId}] Downloading file from Google Vault`, { bucketName, objectName })

    const urlValidation = await validateUrlWithDNS(downloadUrl, 'downloadUrl')
    if (!urlValidation.isValid) {
      return NextResponse.json(
        { success: false, error: enhanceGoogleVaultError(urlValidation.error || 'Invalid URL') },
        { status: 400 }
      )
    }

    const downloadResponse = await secureFetchWithPinnedIP(downloadUrl, urlValidation.resolvedIP!, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!downloadResponse.ok) {
      const errorText = await downloadResponse.text().catch(() => '')
      const errorMessage = `Failed to download file: ${errorText || downloadResponse.statusText}`
      logger.error(`[${requestId}] Failed to download Vault export file`, {
        status: downloadResponse.status,
        error: errorText,
      })
      return NextResponse.json(
        { success: false, error: enhanceGoogleVaultError(errorMessage) },
        { status: 400 }
      )
    }

    const contentType = downloadResponse.headers.get('content-type') || 'application/octet-stream'
    const disposition = downloadResponse.headers.get('content-disposition') || ''
    const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"/)

    let resolvedName = fileName
    if (!resolvedName) {
      if (match?.[1]) {
        try {
          resolvedName = decodeURIComponent(match[1])
        } catch {
          resolvedName = match[1]
        }
      } else if (match?.[2]) {
        resolvedName = match[2]
      } else if (objectName) {
        const parts = objectName.split('/')
        resolvedName = parts[parts.length - 1] || 'vault-export.bin'
      } else {
        resolvedName = 'vault-export.bin'
      }
    }

    const arrayBuffer = await downloadResponse.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    logger.info(`[${requestId}] Vault export file downloaded successfully`, {
      name: resolvedName,
      size: buffer.length,
      mimeType: contentType,
    })

    return NextResponse.json({
      success: true,
      output: {
        file: {
          name: resolvedName,
          mimeType: contentType,
          data: buffer.toString('base64'),
          size: buffer.length,
        },
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error downloading Google Vault export file:`, error)
    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error, 'Unknown error occurred'),
      },
      { status: 500 }
    )
  }
})
