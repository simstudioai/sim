import type { AddIncidentTodoParams, AddIncidentTodoResponse } from '@/tools/datadog/types'
import {
  datadogApiUrl,
  datadogErrorMessage,
  datadogHeaders,
  datadogPathSegment,
  splitCommaList,
} from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const addIncidentTodoTool: ToolConfig<AddIncidentTodoParams, AddIncidentTodoResponse> = {
  id: 'datadog_add_incident_todo',
  name: 'Datadog Add Incident Todo',
  description:
    'Add a follow-up task (todo) to an incident. Requires the Incident Management `incident_write` permission; the Incidents API is in public beta.',
  version: '1.0.0',

  params: {
    incidentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The UUID of the incident the todo belongs to',
    },
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The follow-up task content (e.g., "Restore lost data")',
    },
    assignees: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Comma-separated assignee handles (e.g., "@jane@example.com,@on-call"). Datadog requires at least one assignee',
    },
    dueDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO-8601 timestamp for when the todo should be completed',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog API key',
    },
    applicationKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog Application key',
    },
    site: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Datadog site/region (default: datadoghq.com)',
    },
  },

  request: {
    url: (params) =>
      datadogApiUrl(
        params.site,
        `/api/v2/incidents/${datadogPathSegment(params.incidentId)}/relationships/todos`
      ),
    method: 'POST',
    headers: datadogHeaders,
    body: (params) => {
      const attributes: Record<string, unknown> = {
        content: params.content,
        assignees: splitCommaList(params.assignees) ?? [],
        incident_id: params.incidentId,
      }
      if (params.dueDate) attributes.due_date = params.dueDate

      return { data: { type: 'incident_todos', attributes } }
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        output: { todo: { attributes: {} } },
        error: await datadogErrorMessage(response),
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        todo: {
          id: data.data?.id,
          type: data.data?.type,
          attributes: data.data?.attributes ?? {},
        },
      },
    }
  },

  outputs: {
    todo: {
      type: 'object',
      description: 'The created incident todo',
      properties: {
        id: { type: 'string', description: 'Todo UUID' },
        type: { type: 'string', description: 'Resource type (incident_todos)' },
        attributes: {
          type: 'object',
          description: 'Todo attributes',
          properties: {
            content: { type: 'string', description: 'Task content' },
            assignees: { type: 'array', description: 'Assignee handles' },
            due_date: { type: 'string', description: 'Due date' },
            completed: { type: 'string', description: 'Completion timestamp' },
            incident_id: { type: 'string', description: 'UUID of the parent incident' },
          },
        },
      },
    },
  },
}
