import type { ToolConfig } from '@/tools/types'
import type {
  ZoomGetMeetingRecordingsParams,
  ZoomGetMeetingRecordingsResponse,
} from '@/tools/zoom/types'

export const zoomGetMeetingRecordingsTool: ToolConfig<
  ZoomGetMeetingRecordingsParams,
  ZoomGetMeetingRecordingsResponse
> = {
  id: 'zoom_get_meeting_recordings',
  name: 'Zoom Get Meeting Recordings',
  description: 'Get all recordings for a specific Zoom meeting',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'zoom',
    requiredScopes: ['cloud_recording:read:list_recording_files'],
  },

  params: {
    meetingId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The meeting ID or meeting UUID',
    },
    includeFolderItems: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include items within a folder',
    },
    ttl: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Time to live for download URLs in seconds (max 604800)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.zoom.us/v2/meetings/${encodeURIComponent(params.meetingId)}/recordings`
      const queryParams = new URLSearchParams()

      if (params.includeFolderItems != null) {
        queryParams.append('include_folder_items', String(params.includeFolderItems))
      }
      if (params.ttl) {
        queryParams.append('ttl', String(params.ttl))
      }

      const queryString = queryParams.toString()
      return queryString ? `${baseUrl}?${queryString}` : baseUrl
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Zoom API request')
      }
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error: errorData.message || `Zoom API error: ${response.status} ${response.statusText}`,
        output: { recording: {} as any },
      }
    }

    const data = await response.json()

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
          recording_files: (data.recording_files || []).map((file: any) => ({
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
      },
    }
  },

  outputs: {
    recording: {
      type: 'object',
      description: 'The meeting recording with all files',
      properties: {
        uuid: { type: 'string', description: 'Meeting UUID' },
        id: { type: 'number', description: 'Meeting ID' },
        topic: { type: 'string', description: 'Meeting topic' },
        start_time: { type: 'string', description: 'Meeting start time' },
        duration: { type: 'number', description: 'Meeting duration in minutes' },
        total_size: { type: 'number', description: 'Total size of recordings in bytes' },
        share_url: { type: 'string', description: 'URL to share recordings' },
        recording_files: { type: 'array', description: 'List of recording files' },
      },
    },
  },
}
