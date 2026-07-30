import type {
  ElevenLabsAudioIsolationParams,
  ElevenLabsAudioResponse,
} from '@/tools/elevenlabs/types'
import type { ToolConfig } from '@/tools/types'

export const elevenLabsAudioIsolationTool: ToolConfig<
  ElevenLabsAudioIsolationParams,
  ElevenLabsAudioResponse
> = {
  id: 'elevenlabs_audio_isolation',
  name: 'ElevenLabs Audio Isolation',
  description: 'Remove background noise from an audio file, isolating the speech using ElevenLabs',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your ElevenLabs API key',
    },
    audioFile: {
      type: 'file',
      required: true,
      visibility: 'user-only',
      description: 'The audio file to isolate speech from (e.g., MP3, WAV, M4A)',
    },
  },

  request: {
    url: '/api/tools/elevenlabs/audio',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (
      params: ElevenLabsAudioIsolationParams & {
        _context?: { workspaceId?: string; workflowId?: string; executionId?: string }
      }
    ) => ({
      operation: 'audio_isolation',
      apiKey: params.apiKey,
      audioFile: params.audioFile,
      workspaceId: params._context?.workspaceId,
      workflowId: params._context?.workflowId,
      executionId: params._context?.executionId,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok || data.error) {
      return {
        success: false,
        error: data.error || 'Audio isolation failed',
        output: { audioUrl: '' },
      }
    }
    return {
      success: true,
      output: {
        audioUrl: data.audioUrl,
        audioFile: data.audioFile,
      },
    }
  },

  outputs: {
    audioUrl: { type: 'string', description: 'URL of the isolated audio' },
    audioFile: { type: 'file', description: 'The isolated audio file' },
  },
}
