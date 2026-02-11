import type { ToolConfig } from '@/tools/types'
import type {
  ZoomGetMeetingRecordingsParams,
  ZoomGetMeetingRecordingsResponse,
} from '@/tools/zoom/types'
import { RECORDING_OUTPUT_PROPERTIES } from '@/tools/zoom/types'

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
      description:
        'The meeting ID or meeting UUID (e.g., "1234567890" or "4444AAABBBccccc12345==")',
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
    downloadFiles: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Download recording files into file outputs',
    },
  },

  request: {
    url: '/api/tools/zoom/get-recordings',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      accessToken: params.accessToken,
      meetingId: params.meetingId,
      includeFolderItems: params.includeFolderItems,
      ttl: params.ttl,
      downloadFiles: params.downloadFiles,
    }),
  },

  outputs: {
    recording: {
      type: 'object',
      description: 'The meeting recording with all files',
      properties: RECORDING_OUTPUT_PROPERTIES,
    },
    files: {
      type: 'file[]',
      description: 'Downloaded recording files',
      optional: true,
    },
  },
}
