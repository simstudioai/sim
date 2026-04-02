import type {
  RootlyCreateActionItemParams,
  RootlyCreateActionItemResponse,
} from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyCreateActionItemTool: ToolConfig<
  RootlyCreateActionItemParams,
  RootlyCreateActionItemResponse
> = {
  id: 'rootly_create_action_item',
  name: 'Rootly Create Action Item',
  description: 'Create a new action item for an incident in Rootly.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rootly API key',
    },
    incidentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the incident to add the action item to',
    },
    summary: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The title of the action item',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A detailed description of the action item',
    },
    kind: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The kind of action item (task, follow_up)',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Priority level (high, medium, low)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Action item status (open, in_progress, cancelled, done)',
    },
    assignedToUserId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The user ID to assign the action item to',
    },
    dueDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Due date for the action item',
    },
  },

  request: {
    url: (params) => `https://api.rootly.com/v1/incidents/${params.incidentId.trim()}/action_items`,
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const attributes: Record<string, unknown> = {
        summary: params.summary,
      }
      if (params.description) attributes.description = params.description
      if (params.kind) attributes.kind = params.kind
      if (params.priority) attributes.priority = params.priority
      if (params.status) attributes.status = params.status
      if (params.assignedToUserId) {
        const numericId = Number.parseInt(params.assignedToUserId, 10)
        if (!Number.isNaN(numericId)) attributes.assigned_to_user_id = numericId
      }
      if (params.dueDate) attributes.due_date = params.dueDate
      return { data: { type: 'incident_action_items', attributes } }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        output: { actionItem: {} as RootlyCreateActionItemResponse['output']['actionItem'] },
        error: errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const data = await response.json()
    const attrs = data.data?.attributes || {}
    return {
      success: true,
      output: {
        actionItem: {
          id: data.data?.id ?? null,
          summary: attrs.summary ?? '',
          description: attrs.description ?? null,
          kind: attrs.kind ?? null,
          priority: attrs.priority ?? null,
          status: attrs.status ?? null,
          dueDate: attrs.due_date ?? null,
          createdAt: attrs.created_at ?? '',
          updatedAt: attrs.updated_at ?? '',
        },
      },
    }
  },

  outputs: {
    actionItem: {
      type: 'object',
      description: 'The created action item',
      properties: {
        id: { type: 'string', description: 'Unique action item ID' },
        summary: { type: 'string', description: 'Action item title' },
        description: { type: 'string', description: 'Action item description' },
        kind: { type: 'string', description: 'Action item kind (task, follow_up)' },
        priority: { type: 'string', description: 'Priority level' },
        status: { type: 'string', description: 'Action item status' },
        dueDate: { type: 'string', description: 'Due date' },
        createdAt: { type: 'string', description: 'Creation date' },
        updatedAt: { type: 'string', description: 'Last update date' },
      },
    },
  },
}
