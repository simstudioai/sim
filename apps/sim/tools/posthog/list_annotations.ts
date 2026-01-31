import type { ToolConfig } from '@/tools/types'

interface PostHogListAnnotationsParams {
  apiKey: string
  projectId: string
  region: string
  limit?: number
  offset?: number
}

interface PostHogListAnnotationsResponse {
  success: boolean
  output: {
    count: number
    next: string | null
    previous: string | null
    results: Array<{
      id: number
      content: string
      date_marker: string
      created_at: string
      updated_at: string
      created_by: Record<string, any> | null
      dashboard_item: number | null
      insight_short_id: string | null
      insight_name: string | null
      scope: string
      deleted: boolean
    }>
  }
}

export const listAnnotationsTool: ToolConfig<
  PostHogListAnnotationsParams,
  PostHogListAnnotationsResponse
> = {
  id: 'posthog_list_annotations',
  name: 'PostHog List Annotations',
  description:
    'List all annotations in a PostHog project. Returns annotation content, timestamps, and associated insights.',
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
      description: 'The PostHog project ID (e.g., "12345" or project UUID)',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'PostHog cloud region: "us" or "eu" (default: "us")',
      default: 'us',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return per page (default: 100, e.g., 10, 50, 100)',
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
      let url = `${baseUrl}/api/projects/${params.projectId}/annotations/`

      const queryParams = []
      if (params.limit) queryParams.push(`limit=${params.limit}`)
      if (params.offset) queryParams.push(`offset=${params.offset}`)

      if (queryParams.length > 0) {
        url += `?${queryParams.join('&')}`
      }

      return url
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
        count: data.count || 0,
        next: data.next || null,
        previous: data.previous || null,
        results: (data.results || []).map((annotation: any) => ({
          id: annotation.id,
          content: annotation.content || '',
          date_marker: annotation.date_marker,
          created_at: annotation.created_at,
          updated_at: annotation.updated_at,
          created_by: annotation.created_by || null,
          dashboard_item: annotation.dashboard_item || null,
          insight_short_id: annotation.insight_short_id || null,
          insight_name: annotation.insight_name || null,
          scope: annotation.scope || '',
          deleted: annotation.deleted || false,
        })),
      },
    }
  },

  outputs: {
    count: {
      type: 'number',
      description: 'Total number of annotations in the project',
    },
    next: {
      type: 'string',
      description: 'URL for the next page of results',
      optional: true,
    },
    previous: {
      type: 'string',
      description: 'URL for the previous page of results',
      optional: true,
    },
    results: {
      type: 'array',
      description: 'List of annotations with their content and metadata',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Unique identifier for the annotation' },
          content: { type: 'string', description: 'Content/text of the annotation' },
          date_marker: {
            type: 'string',
            description: 'ISO timestamp marking when the annotation applies',
          },
          created_at: {
            type: 'string',
            description: 'ISO timestamp when annotation was created',
          },
          updated_at: {
            type: 'string',
            description: 'ISO timestamp when annotation was last updated',
          },
          created_by: { type: 'object', description: 'User who created the annotation' },
          dashboard_item: {
            type: 'number',
            description: 'ID of dashboard item this annotation is attached to',
          },
          insight_short_id: {
            type: 'string',
            description: 'Short ID of the insight this annotation is attached to',
          },
          insight_name: {
            type: 'string',
            description: 'Name of the insight this annotation is attached to',
          },
          scope: { type: 'string', description: 'Scope of the annotation (project or dashboard)' },
          deleted: { type: 'boolean', description: 'Whether the annotation is deleted' },
        },
      },
    },
  },
}
