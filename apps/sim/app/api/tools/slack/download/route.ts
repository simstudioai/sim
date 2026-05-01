import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { slackDownloadContract } from '@/lib/api/contracts/tools/communication/slack'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('SlackDownloadAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Slack download attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated Slack download request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const parsed = await parseRequest(slackDownloadContract, request, {})
    if (!parsed.success) return parsed.response
    const { accessToken, fileId, fileName } = parsed.data.body

    logger.info(`[${requestId}] Getting file info from Slack`, { fileId })

    const infoResponse = await fetch(`https://slack.com/api/files.info?file=${fileId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!infoResponse.ok) {
      const errorDetails = await infoResponse.json().catch(() => ({}))
      logger.error(`[${requestId}] Failed to get file info from Slack`, {
        status: infoResponse.status,
        statusText: infoResponse.statusText,
        error: errorDetails,
      })
      return NextResponse.json(
        {
          success: false,
          error: errorDetails.error || 'Failed to get file info',
        },
        { status: 400 }
      )
    }

    const data = await infoResponse.json()

    if (!data.ok) {
      logger.error(`[${requestId}] Slack API returned error`, { error: data.error })
      return NextResponse.json(
        {
          success: false,
          error: data.error || 'Slack API error',
        },
        { status: 400 }
      )
    }

    const file = data.file
    const resolvedFileName = fileName || file.name || 'download'
    const mimeType = file.mimetype || 'application/octet-stream'
    const urlPrivate = file.url_private

    if (!urlPrivate) {
      return NextResponse.json(
        {
          success: false,
          error: 'File does not have a download URL',
        },
        { status: 400 }
      )
    }

    const urlValidation = await validateUrlWithDNS(urlPrivate, 'urlPrivate')
    if (!urlValidation.isValid) {
      return NextResponse.json(
        {
          success: false,
          error: urlValidation.error,
        },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Downloading file from Slack`, {
      fileId,
      fileName: resolvedFileName,
      mimeType,
    })

    const downloadResponse = await secureFetchWithPinnedIP(urlPrivate, urlValidation.resolvedIP!, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!downloadResponse.ok) {
      logger.error(`[${requestId}] Failed to download file content`, {
        status: downloadResponse.status,
        statusText: downloadResponse.statusText,
      })
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to download file content',
        },
        { status: 400 }
      )
    }

    const arrayBuffer = await downloadResponse.arrayBuffer()
    const fileBuffer = Buffer.from(arrayBuffer)

    logger.info(`[${requestId}] File downloaded successfully`, {
      fileId,
      name: resolvedFileName,
      size: fileBuffer.length,
      mimeType,
    })

    const base64Data = fileBuffer.toString('base64')

    return NextResponse.json({
      success: true,
      output: {
        file: {
          name: resolvedFileName,
          mimeType,
          data: base64Data,
          size: fileBuffer.length,
        },
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error downloading Slack file:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
})
