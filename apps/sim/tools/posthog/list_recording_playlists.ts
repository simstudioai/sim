import type { ToolConfig } from '@/tools/types'

interface PostHogListRecordingPlaylistsParams {
  apiKey: string
  projectId: string
  region?: 'us' | 'eu'
  limit?: number
  offset?: number
}

interface PostHogRecordingPlaylist {
  id: string
  short_id: string
  name: string
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

interface PostHogListRecordingPlaylistsResponse {
  success: boolean
  output: {
    playlists: PostHogRecordingPlaylist[]
    count: number
    next?: string
    previous?: string
  }
}

export const listRecordingPlaylistsTool: ToolConfig<
  PostHogListRecordingPlaylistsParams,
  PostHogListRecordingPlaylistsResponse
> = {
  id: 'posthog_list_recording_playlists',
  name: 'PostHog List Recording Playlists',
  description:
    'List session recording playlists in a PostHog project. Playlists allow you to organize and curate session recordings.',
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
      description: 'PostHog Project ID (e.g., "12345" or project UUID)',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'PostHog cloud region: us or eu (default: us)',
      default: 'us',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (default: 100, e.g., 10, 50, 100)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to skip for pagination (e.g., 0, 100, 200)',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
      const url = new URL(
        `${baseUrl}/api/projects/${params.projectId}/session_recording_playlists/`
      )

      if (params.limit) {
        url.searchParams.set('limit', params.limit.toString())
      }
      if (params.offset) {
        url.searchParams.set('offset', params.offset.toString())
      }

      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        playlists: data.results || [],
        count: data.count || 0,
        next: data.next ?? null,
        previous: data.previous ?? null,
      },
    }
  },

  outputs: {
    playlists: {
      type: 'array',
      description: 'List of session recording playlists',
      items: {
        type: 'object',
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
    count: {
      type: 'number',
      description: 'Total number of playlists',
    },
    next: {
      type: 'string',
      description: 'URL for next page of results',
      optional: true,
    },
    previous: {
      type: 'string',
      description: 'URL for previous page of results',
      optional: true,
    },
  },
}
