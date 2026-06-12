import {
  QUARTR_AUDIO_OUTPUT_PROPERTIES,
  type QuartrAudioDto,
  type QuartrGetAudioParams,
  type QuartrGetAudioResponse,
  type QuartrSingleDto,
} from '@/tools/quartr/types'
import { buildQuartrUrl, mapQuartrAudio, parseQuartrResponse } from '@/tools/quartr/utils'
import type { ToolConfig } from '@/tools/types'

export const quartrGetAudioTool: ToolConfig<QuartrGetAudioParams, QuartrGetAudioResponse> = {
  id: 'quartr_get_audio',
  name: 'Quartr Get Audio',
  description:
    'Retrieve an archived event audio recording from Quartr by its audio ID. Returns download (MPEG) and streaming (M3U8) URLs.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Quartr API key',
    },
    audioId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Quartr audio ID (e.g., 123964)',
    },
  },

  request: {
    url: (params) =>
      buildQuartrUrl(`/audio/${encodeURIComponent(String(params.audioId).trim())}`, {
        expand: 'event',
      }),
    method: 'GET',
    headers: (params) => ({ 'x-api-key': params.apiKey }),
  },

  transformResponse: async (response) => {
    const data = await parseQuartrResponse<QuartrSingleDto<QuartrAudioDto>>(response, 'get audio')

    return {
      success: true,
      output: {
        audio: mapQuartrAudio(data.data),
      },
    }
  },

  outputs: {
    audio: {
      type: 'object',
      description: 'The requested audio recording',
      properties: QUARTR_AUDIO_OUTPUT_PROPERTIES,
    },
  },
}
