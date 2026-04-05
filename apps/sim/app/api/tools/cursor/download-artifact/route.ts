import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'

export const dynamic = 'force-dynamic'

const logger = createLogger('CursorDownloadArtifactAPI')

const DownloadArtifactSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  agentId: z.string().min(1, 'Agent ID is required'),
  path: z.string().min(1, 'Artifact path is required'),
})

export async function POST(request: NextRequest) {
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

    const body = await request.json()
    const { apiKey, agentId, path } = DownloadArtifactSchema.parse(body)

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
      { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' },
      { status: 500 }
    )
  }
}
