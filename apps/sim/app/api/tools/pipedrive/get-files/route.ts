import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('PipedriveGetFilesAPI')

interface PipedriveFile {
  id?: number
  name?: string
  url?: string
}

interface PipedriveApiResponse {
  success: boolean
  data?: PipedriveFile[]
  error?: string
}

const PipedriveGetFilesSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  deal_id: z.string().optional().nullable(),
  person_id: z.string().optional().nullable(),
  org_id: z.string().optional().nullable(),
  limit: z.string().optional().nullable(),
  downloadFiles: z.boolean().optional().default(false),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Pipedrive get files attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    const body = await request.json()
    const validatedData = PipedriveGetFilesSchema.parse(body)

    const { accessToken, deal_id, person_id, org_id, limit, downloadFiles } = validatedData

    const baseUrl = 'https://api.pipedrive.com/v1/files'
    const queryParams = new URLSearchParams()

    if (deal_id) queryParams.append('deal_id', deal_id)
    if (person_id) queryParams.append('person_id', person_id)
    if (org_id) queryParams.append('org_id', org_id)
    if (limit) queryParams.append('limit', limit)

    const queryString = queryParams.toString()
    const apiUrl = queryString ? `${baseUrl}?${queryString}` : baseUrl

    logger.info(`[${requestId}] Fetching files from Pipedrive`, { deal_id, person_id, org_id })

    const urlValidation = await validateUrlWithDNS(apiUrl, 'apiUrl')
    if (!urlValidation.isValid) {
      return NextResponse.json({ success: false, error: urlValidation.error }, { status: 400 })
    }

    const response = await secureFetchWithPinnedIP(apiUrl, urlValidation.resolvedIP!, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    const data = (await response.json()) as PipedriveApiResponse

    if (!data.success) {
      logger.error(`[${requestId}] Pipedrive API request failed`, { data })
      return NextResponse.json(
        { success: false, error: data.error || 'Failed to fetch files from Pipedrive' },
        { status: 400 }
      )
    }

    const files = data.data || []
    const downloadedFiles: Array<{
      name: string
      mimeType: string
      data: string
      size: number
    }> = []

    if (downloadFiles) {
      for (const file of files) {
        if (!file?.url) continue

        try {
          const fileUrlValidation = await validateUrlWithDNS(file.url, 'fileUrl')
          if (!fileUrlValidation.isValid) continue

          const downloadResponse = await secureFetchWithPinnedIP(
            file.url,
            fileUrlValidation.resolvedIP!,
            {
              method: 'GET',
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          )

          if (!downloadResponse.ok) continue

          const arrayBuffer = await downloadResponse.arrayBuffer()
          const buffer = Buffer.from(arrayBuffer)
          const extension = getFileExtension(file.name || '')
          const mimeType =
            downloadResponse.headers.get('content-type') || getMimeTypeFromExtension(extension)
          const fileName = file.name || `pipedrive-file-${file.id || Date.now()}`

          downloadedFiles.push({
            name: fileName,
            mimeType,
            data: buffer.toString('base64'),
            size: buffer.length,
          })
        } catch (error) {
          logger.warn(`[${requestId}] Failed to download file ${file.id}:`, error)
        }
      }
    }

    logger.info(`[${requestId}] Pipedrive files fetched successfully`, {
      fileCount: files.length,
      downloadedCount: downloadedFiles.length,
    })

    return NextResponse.json({
      success: true,
      output: {
        files,
        downloadedFiles: downloadedFiles.length > 0 ? downloadedFiles : undefined,
        total_items: files.length,
        success: true,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Pipedrive files:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}
