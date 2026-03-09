import type { ToolConfig } from '@/tools/types'

interface PostHogCreateAnnotationParams {
  apiKey: string
  projectId: string
  region: string
  content: string
  date_marker: string
  scope?: string
  dashboard_item?: string
  insight_short_id?: string
}

interface PostHogCreateAnnotationResponse {
  success: boolean
  output: {
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
  }
}

export const createAnnotationTool: ToolConfig<
  PostHogCreateAnnotationParams,
  PostHogCreateAnnotationResponse
> = {
  id: 'posthog_create_annotation',
  name: 'PostHog Create Annotation',
  description:
    'Create a new annotation in PostHog. Mark important events on your graphs with date and description.',
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
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Content/text of the annotation',
    },
    date_marker: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'ISO timestamp marking when the annotation applies (e.g., "2024-01-15T10:00:00Z")',
    },
    scope: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Scope of the annotation: "project" or "dashboard_item" (default: "project")',
    },
    dashboard_item: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of dashboard item to attach this annotation to',
    },
    insight_short_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Short ID of the insight to attach this annotation to',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = params.region === 'eu' ? 'https://eu.posthog.com' : 'https://us.posthog.com'
      return `${baseUrl}/api/projects/${params.projectId}/annotations/`
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        content: params.content,
        date_marker: params.date_marker,
      }

      if (params.scope) {
        body.scope = params.scope
      }

      if (params.dashboard_item) {
        body.dashboard_item = Number(params.dashboard_item)
      }

      if (params.insight_short_id) {
        body.insight_short_id = params.insight_short_id
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id,
        content: data.content || '',
        date_marker: data.date_marker,
        created_at: data.created_at,
        updated_at: data.updated_at,
        created_by: data.created_by || null,
        dashboard_item: data.dashboard_item || null,
        insight_short_id: data.insight_short_id || null,
        insight_name: data.insight_name || null,
        scope: data.scope || '',
        deleted: data.deleted || false,
      },
    }
  },

  outputs: {
    id: {
      type: 'number',
      description: 'Unique identifier for the created annotation',
    },
    content: {
      type: 'string',
      description: 'Content/text of the annotation',
    },
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
    created_by: {
      type: 'object',
      description: 'User who created the annotation',
      optional: true,
    },
    dashboard_item: {
      type: 'number',
      description: 'ID of dashboard item this annotation is attached to',
      optional: true,
    },
    insight_short_id: {
      type: 'string',
      description: 'Short ID of the insight this annotation is attached to',
      optional: true,
    },
    insight_name: {
      type: 'string',
      description: 'Name of the insight this annotation is attached to',
      optional: true,
    },
    scope: {
      type: 'string',
      description: 'Scope of the annotation (project or dashboard_item)',
    },
    deleted: {
      type: 'boolean',
      description: 'Whether the annotation is deleted',
    },
  },
}
