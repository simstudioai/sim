import { createLogger } from '@sim/logger'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { ZoomOperationError } from '@/lib/internal/zoom/errors'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { getExtensionFromMimeType } from '@/lib/uploads/utils/file-utils'
import type { ZoomGetMeetingRecordingsParams } from '@/tools/zoom/types'

const logger = createLogger('ZoomOperations')

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
}

export interface ZoomOperationContext {
  requestId: string
  signal?: AbortSignal
}

export async function getZoomMeetingRecordings(
  input: ZoomGetMeetingRecordingsParams,
  context: ZoomOperationContext
): Promise<{
  success: true
  output: {
    recording: ZoomRecordingsResponse & { recording_files: ZoomRecordingFile[] }
    files?: Array<{ name: string; mimeType: string; data: string; size: number }>
  }
}> {
  context.signal?.throwIfAborted()
  const query = new URLSearchParams()
  if (input.includeFolderItems != null) {
    query.set('include_folder_items', String(input.includeFolderItems))
  }
  if (input.ttl) query.set('ttl', String(input.ttl))
  const baseUrl = `https://api.zoom.us/v2/meetings/${encodeURIComponent(input.meetingId)}/recordings`
  const apiUrl = query.size > 0 ? `${baseUrl}?${query}` : baseUrl
  const validation = await validateUrlWithDNS(apiUrl, 'apiUrl')
  context.signal?.throwIfAborted()
  if (!validation.isValid || !validation.resolvedIP) {
    throw new ZoomOperationError(validation.error || 'Invalid Zoom API URL', 400)
  }

  const response = await secureFetchWithPinnedIP(apiUrl, validation.resolvedIP, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.accessToken}`,
    },
    signal: context.signal,
  })
  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as ZoomErrorResponse
    throw new ZoomOperationError(errorData.message || `Zoom API error: ${response.status}`, 400)
  }
  const data = (await response.json()) as ZoomRecordingsResponse
  const files: Array<{ name: string; mimeType: string; data: string; size: number }> = []
  let bufferedBytes = 0

  if (input.downloadFiles && Array.isArray(data.recording_files)) {
    for (const file of data.recording_files) {
      if (!file.download_url) continue
      context.signal?.throwIfAborted()
      try {
        const remainingBytes = MAX_BUFFERED_TRANSFER_BYTES - bufferedBytes
        if (remainingBytes <= 0) {
          throw new ZoomOperationError(
            `Downloaded recordings exceed the ${MAX_BUFFERED_TRANSFER_BYTES}-byte execution limit`,
            413
          )
        }
        const fileValidation = await validateUrlWithDNS(file.download_url, 'downloadUrl')
        if (!fileValidation.isValid || !fileValidation.resolvedIP) continue
        const downloadResponse = await secureFetchWithPinnedIP(
          file.download_url,
          fileValidation.resolvedIP,
          {
            method: 'GET',
            headers: { Authorization: `Bearer ${input.accessToken}` },
            maxResponseBytes: remainingBytes,
            signal: context.signal,
          }
        )
        if (!downloadResponse.ok) continue
        const buffer = Buffer.from(await downloadResponse.arrayBuffer())
        bufferedBytes += buffer.length
        if (bufferedBytes > MAX_BUFFERED_TRANSFER_BYTES) {
          throw new ZoomOperationError(
            `Downloaded recordings exceed the ${MAX_BUFFERED_TRANSFER_BYTES}-byte execution limit`,
            413
          )
        }
        const mimeType = downloadResponse.headers.get('content-type') || 'application/octet-stream'
        const extension =
          file.file_extension?.toLowerCase() || getExtensionFromMimeType(mimeType) || 'dat'
        files.push({
          name: `zoom-recording-${file.id || file.recording_start || Date.now()}.${extension}`,
          mimeType,
          data: buffer.toString('base64'),
          size: buffer.length,
        })
      } catch (error) {
        context.signal?.throwIfAborted()
        if (error instanceof ZoomOperationError) throw error
        if (isPayloadSizeLimitError(error)) {
          throw new ZoomOperationError(
            `Downloaded recordings exceed the ${MAX_BUFFERED_TRANSFER_BYTES}-byte execution limit`,
            413
          )
        }
        logger.warn(`[${context.requestId}] Failed to download Zoom recording file`, {
          fileId: file.id,
        })
      }
    }
  }

  return {
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
        recording_files: (data.recording_files || []).map((file) => ({
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
  }
}
