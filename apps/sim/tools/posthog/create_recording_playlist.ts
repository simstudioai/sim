import type { ToolConfig } from '@/tools/types'

interface PostHogCreateRecordingPlaylistParams {
  apiKey: string
  projectId: string
  region?: 'us' | 'eu'
  name?: string
  description?: string
  filters?: string // JSON string of filter configuration
  derivedName?: string
}

interface PostHogRecordingPlaylist {
  id: string
  short_id: string
  name?: string
  description?: string
  created_at: string
  created_by: {
    id: string
    uuid: string
    distinct_id: string
    first_name: string
    email: string
  }
  deleted: boolean
  filters?: Record<string, any>
  last_modified_at: string
  last_modified_by: Record<string, any>
  derived_name?: string
}

interface PostHogCreateRecordingPlaylistResponse {
  success: boolean
  output: {
    playlist: PostHogRecordingPlaylist
  }
}

export const createRecordingPlaylistTool: ToolConfig<
  PostHogCreateRecordingPlaylistParams,
  PostHogCreateRecordingPlaylistResponse
> = {
  id: 'posthog_create_recording_playlist',
  name: 'PostHog Create Recording Playlist',
  description:
    'Create a new session recording playlist in PostHog. Playlists help organize and curate session recordings based on filters or manual selection.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PostHog Personal API Key',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'PostHog Project ID',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'PostHog cloud region: us or eu (default: us)',
      default: 'us',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Playlist name (optional, can be auto-generated from filters)',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Playlist description',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON string of filter configuration to automatically include recordings (date ranges, events, properties, etc.)',
    },
    derivedName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Auto-generated name based on filters',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
      return `${baseUrl}/api/projects/${params.projectId}/session_recording_playlists/`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, any> = {}

      if (params.name) body.name = params.name
      if (params.description) body.description = params.description

      // PostHog requires either 'filters' or 'collection'
      // Provide minimal valid filters with date range as default
      if (params.filters) {
        try {
          body.filters = JSON.parse(params.filters)
        } catch (e) {
          // Fallback to minimal valid filter on parse error
          body.filters = {
            date_from: '-7d', // Last 7 days
          }
        }
      } else {
        // Default to last 7 days if no filters provided
        body.filters = {
          date_from: '-7d',
        }
      }

      if (params.derivedName) body.derived_name = params.derivedName

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        playlist: data,
      },
    }
  },

  outputs: {
    playlist: {
      type: 'object',
      description: 'Created playlist details',
      properties: {
        id: { type: 'string', description: 'Playlist ID' },
        short_id: { type: 'string', description: 'Playlist short ID' },
        name: { type: 'string', description: 'Playlist name' },
        description: { type: 'string', description: 'Playlist description' },
        created_at: { type: 'string', description: 'Creation timestamp' },
        created_by: { type: 'object', description: 'Creator information' },
        deleted: { type: 'boolean', description: 'Whether playlist is deleted' },
        filters: { type: 'object', description: 'Playlist filters' },
        last_modified_at: { type: 'string', description: 'Last modification timestamp' },
        last_modified_by: { type: 'object', description: 'Last modifier information' },
        derived_name: { type: 'string', description: 'Auto-generated name from filters' },
      },
    },
  },
}
