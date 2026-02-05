import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { getExtensionFromMimeType } from '@/lib/uploads/utils/file-utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('ZoomGetRecordingsAPI')

interface ZoomRecordingFile {
  id?: string
  meeting_id?: string
  recording_start?: string
  recording_end?: string
  file_type?: string
  file_extension?: string
  file_size?: number
  play_url?: string
  download_url?: string
  status?: string
  recording_type?: string
}

interface ZoomRecordingsResponse {
  uuid?: string
  id?: string | number
  account_id?: string
  host_id?: string
  topic?: string
  type?: number
  start_time?: string
  duration?: number
  total_size?: number
  recording_count?: number
  share_url?: string
  recording_files?: ZoomRecordingFile[]
}

interface ZoomErrorResponse {
  message?: string
  code?: number
}

const ZoomGetRecordingsSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  meetingId: z.string().min(1, 'Meeting ID is required'),
  includeFolderItems: z.boolean().optional(),
  ttl: z.number().optional(),
  downloadFiles: z.boolean().optional().default(false),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized Zoom get recordings attempt: ${authResult.error}`)
      return NextResponse.json(
        {
          success: false,
          error: authResult.error || 'Authentication required',
        },
        { status: 401 }
      )
    }

    const body = await request.json()
    const validatedData = ZoomGetRecordingsSchema.parse(body)

    const { accessToken, meetingId, includeFolderItems, ttl, downloadFiles } = validatedData

    const baseUrl = `https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}/recordings`
    const queryParams = new URLSearchParams()

    if (includeFolderItems != null) {
      queryParams.append('include_folder_items', String(includeFolderItems))
    }
    if (ttl) {
      queryParams.append('ttl', String(ttl))
    }

    const queryString = queryParams.toString()
    const apiUrl = queryString ? `${baseUrl}?${queryString}` : baseUrl

    logger.info(`[${requestId}] Fetching recordings from Zoom`, { meetingId })

    const urlValidation = await validateUrlWithDNS(apiUrl, 'apiUrl')
    if (!urlValidation.isValid) {
      return NextResponse.json({ success: false, error: urlValidation.error }, { status: 400 })
    }

    const response = await secureFetchWithPinnedIP(apiUrl, urlValidation.resolvedIP!, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as ZoomErrorResponse
      logger.error(`[${requestId}] Zoom API error`, {
        status: response.status,
        error: errorData,
      })
      return NextResponse.json(
        { success: false, error: errorData.message || `Zoom API error: ${response.status}` },
        { status: 400 }
      )
    }

    const data = (await response.json()) as ZoomRecordingsResponse
    const files: Array<{
      name: string
      mimeType: string
      data: string
      size: number
    }> = []

    if (downloadFiles && Array.isArray(data.recording_files)) {
      for (const file of data.recording_files) {
        if (!file?.download_url) continue

        try {
          const fileUrlValidation = await validateUrlWithDNS(file.download_url, 'downloadUrl')
          if (!fileUrlValidation.isValid) continue

          const downloadResponse = await secureFetchWithPinnedIP(
            file.download_url,
            fileUrlValidation.resolvedIP!,
            {
              method: 'GET',
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          )

          if (!downloadResponse.ok) continue

          const contentType =
            downloadResponse.headers.get('content-type') || 'application/octet-stream'
          const arrayBuffer = await downloadResponse.arrayBuffer()
          const buffer = Buffer.from(arrayBuffer)
          const extension =
            file.file_extension?.toString().toLowerCase() ||
            getExtensionFromMimeType(contentType) ||
            'dat'
          const fileName = `zoom-recording-${file.id || file.recording_start || Date.now()}.${extension}`

          files.push({
            name: fileName,
            mimeType: contentType,
            data: buffer.toString('base64'),
            size: buffer.length,
          })
        } catch (error) {
          logger.warn(`[${requestId}] Failed to download recording file:`, error)
        }
      }
    }

    logger.info(`[${requestId}] Zoom recordings fetched successfully`, {
      recordingCount: data.recording_files?.length || 0,
      downloadedCount: files.length,
    })

    return NextResponse.json({
      success: true,
      output: {
        recording: {
          uuid: data.uuid,
          id: data.id,
          account_id: data.account_id,
          host_id: data.host_id,
          topic: data.topic,
          type: data.type,
          start_time: data.start_time,
          duration: data.duration,
          total_size: data.total_size,
          recording_count: data.recording_count,
          share_url: data.share_url,
          recording_files: (data.recording_files || []).map((file: ZoomRecordingFile) => ({
            id: file.id,
            meeting_id: file.meeting_id,
            recording_start: file.recording_start,
            recording_end: file.recording_end,
            file_type: file.file_type,
            file_extension: file.file_extension,
            file_size: file.file_size,
            play_url: file.play_url,
            download_url: file.download_url,
            status: file.status,
            recording_type: file.recording_type,
          })),
        },
        files: files.length > 0 ? files : undefined,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Zoom recordings:`, error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}
