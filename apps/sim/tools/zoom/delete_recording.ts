import type { ToolConfig } from '@/tools/types'
import type { ZoomDeleteRecordingParams, ZoomDeleteRecordingResponse } from '@/tools/zoom/types'

export const zoomDeleteRecordingTool: ToolConfig<
  ZoomDeleteRecordingParams,
  ZoomDeleteRecordingResponse
> = {
  id: 'zoom_delete_recording',
  name: 'Zoom Delete Recording',
  description: 'Delete cloud recordings for a Zoom meeting',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'zoom',
    requiredScopes: ['cloud_recording:delete:recording_file'],
  },

  params: {
    meetingId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The meeting ID or meeting UUID (e.g., "1234567890" or "4444AAABBBccccc12345==")',
    },
    recordingId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Specific recording file ID to delete. If not provided, deletes all recordings.',
    },
    action: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Delete action: "trash" (move to trash) or "delete" (permanently delete)',
    },
  },

  request: {
    url: (params) => {
      let baseUrl = `https://api.zoom.us/v2/meetings/${encodeURIComponent(params.meetingId)}/recordings`

      if (params.recordingId) {
        baseUrl += `/${encodeURIComponent(params.recordingId)}`
      }

      const queryParams = new URLSearchParams()
      if (params.action) {
        queryParams.append('action', params.action)
      }

      const queryString = queryParams.toString()
      return queryString ? `${baseUrl}?${queryString}` : baseUrl
    },
    method: 'DELETE',
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
        output: { success: false },
      }
    }

    // Zoom returns 204 No Content on successful deletion
    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the recording was deleted successfully',
    },
  },
}
