import type {
  ElevenLabsListVoicesParams,
  ElevenLabsListVoicesResponse,
  ElevenLabsVoiceSummary,
} from '@/tools/elevenlabs/types'
import type { ToolConfig } from '@/tools/types'

export const elevenLabsListVoicesTool: ToolConfig<
  ElevenLabsListVoicesParams,
  ElevenLabsListVoicesResponse
> = {
  id: 'elevenlabs_list_voices',
  name: 'ElevenLabs List Voices',
  description: 'List the voices available in your ElevenLabs account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your ElevenLabs API key',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term to filter voices by name, description, labels, or category',
    },
    category: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by category: premade, cloned, generated, or professional',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of voices to return (1-100, default 10)',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.search) query.set('search', params.search)
      if (params.category) query.set('category', params.category)
      if (params.pageSize !== undefined) query.set('page_size', String(params.pageSize))
      const qs = query.toString()
      return `https://api.elevenlabs.io/v2/voices${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      'xi-api-key': params.apiKey,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const voices: ElevenLabsVoiceSummary[] = (data.voices ?? []).map((voice: any) => ({
      voiceId: voice.voice_id,
      name: voice.name ?? null,
      category: voice.category ?? null,
      description: voice.description ?? null,
      labels: voice.labels ?? null,
      previewUrl: voice.preview_url ?? null,
      settings: voice.settings ?? null,
    }))

    return {
      success: true,
      output: {
        voices,
        totalCount: data.total_count ?? null,
        hasMore: data.has_more ?? false,
        nextPageToken: data.next_page_token ?? null,
      },
    }
  },

  outputs: {
    voices: {
      type: 'array',
      description: 'List of voices',
      items: {
        type: 'object',
        properties: {
          voiceId: { type: 'string', description: 'Unique voice identifier' },
          name: { type: 'string', description: 'Voice name' },
          category: { type: 'string', description: 'Voice category' },
          description: { type: 'string', description: 'Voice description' },
          labels: { type: 'json', description: 'Voice labels (accent, gender, age, use case)' },
          previewUrl: { type: 'string', description: 'URL to a preview audio sample' },
          settings: { type: 'json', description: 'Default voice settings' },
        },
      },
    },
    totalCount: { type: 'number', description: 'Total number of matching voices', optional: true },
    hasMore: { type: 'boolean', description: 'Whether more voices are available' },
    nextPageToken: { type: 'string', description: 'Token to fetch the next page', optional: true },
  },
}
