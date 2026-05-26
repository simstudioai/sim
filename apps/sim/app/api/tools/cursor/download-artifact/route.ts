import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { cursorDownloadArtifactContract } from '@/lib/api/contracts/tools/cursor'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const logger = createLogger('CursorDownloadArtifactAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(
        `[${requestId}] Unauthorized Cursor download artifact attempt: ${authResult.error}`
      )
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    logger.info(
      `[${requestId}] Authenticated Cursor download artifact request via ${authResult.authType}`,
      {
        userId: authResult.userId,
      }
    )

    const parsed = await parseRequest(
      cursorDownloadArtifactContract,
      request,
      {},
      {
        validationErrorResponse: (error) =>
          NextResponse.json(
            {
              success: false,
              error: getValidationErrorMessage(error, 'Invalid request data'),
              details: error.issues,
            },
            { status: 400 }
          ),
      }
    )
    if (!parsed.success) return parsed.response
    const { apiKey, agentId, path } = parsed.data.body

    const authHeader = `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`

    logger.info(`[${requestId}] Requesting presigned URL for artifact`, { agentId, path })

    const artifactResponse = await fetch(
      `https://api.cursor.com/v0/agents/${encodeURIComponent(agentId)}/artifacts/download?path=${encodeURIComponent(path)}`,
      {
        method: 'GET',
        headers: {
          Authorization: authHeader,
        },
      }
    )

    if (!artifactResponse.ok) {
      const errorText = await artifactResponse.text().catch(() => '')
      logger.error(`[${requestId}] Failed to get artifact presigned URL`, {
        status: artifactResponse.status,
        error: errorText,
      })
      return NextResponse.json(
        {
          success: false,
          error: errorText || `Failed to get artifact URL (${artifactResponse.status})`,
        },
        { status: artifactResponse.status }
      )
    }

    const artifactData = await artifactResponse.json()
    const downloadUrl = artifactData.url || artifactData.downloadUrl || artifactData.presignedUrl

    if (!downloadUrl) {
      logger.error(`[${requestId}] No download URL in artifact response`, { artifactData })
      return NextResponse.json(
        { success: false, error: 'No download URL returned for artifact' },
        { status: 400 }
      )
    }

    const urlValidation = await validateUrlWithDNS(downloadUrl, 'downloadUrl')
    if (!urlValidation.isValid) {
      return NextResponse.json({ success: false, error: urlValidation.error }, { status: 400 })
    }

    logger.info(`[${requestId}] Downloading artifact from presigned URL`, { agentId, path })

    const downloadResponse = await secureFetchWithPinnedIP(
      downloadUrl,
      urlValidation.resolvedIP!,
      {}
    )

    if (!downloadResponse.ok) {
      logger.error(`[${requestId}] Failed to download artifact content`, {
        status: downloadResponse.status,
        statusText: downloadResponse.statusText,
      })
      return NextResponse.json(
        {
          success: false,
          error: `Failed to download artifact content (${downloadResponse.status}: ${downloadResponse.statusText})`,
        },
        { status: downloadResponse.status }
      )
    }

    const contentType = downloadResponse.headers.get('content-type') || 'application/octet-stream'
    const arrayBuffer = await downloadResponse.arrayBuffer()
    const fileBuffer = Buffer.from(arrayBuffer)

    const fileName = path.split('/').pop() || 'artifact'

    logger.info(`[${requestId}] Artifact downloaded successfully`, {
      agentId,
      path,
      name: fileName,
      size: fileBuffer.length,
      mimeType: contentType,
    })

    return NextResponse.json({
      success: true,
      output: {
        file: {
          name: fileName,
          mimeType: contentType,
          data: fileBuffer.toString('base64'),
          size: fileBuffer.length,
        },
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error downloading Cursor artifact:`, error)
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, 'Unknown error occurred') },
      { status: 500 }
    )
  }
})
