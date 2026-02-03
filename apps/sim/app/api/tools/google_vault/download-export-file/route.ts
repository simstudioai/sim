import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { enhanceGoogleVaultError } from '@/tools/google_vault/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('GoogleVaultDownloadExportFileAPI')

const GoogleVaultDownloadExportFileSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  bucketName: z.string().min(1, 'Bucket name is required'),
  objectName: z.string().min(1, 'Object name is required'),
  fileName: z.string().optional().nullable(),
})

export async function POST(request: NextRequest) {
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

    const body = await request.json()
    const validatedData = GoogleVaultDownloadExportFileSchema.parse(body)

    const { accessToken, bucketName, objectName, fileName } = validatedData

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
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}
