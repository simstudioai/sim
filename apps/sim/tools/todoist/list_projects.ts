import type { TodoistListProjectsParams, TodoistListProjectsResponse } from '@/tools/todoist/types'
import { mapTodoistProject } from '@/tools/todoist/utils'
import type { ToolConfig } from '@/tools/types'

export const todoistListProjectsTool: ToolConfig<
  TodoistListProjectsParams,
  TodoistListProjectsResponse
> = {
  id: 'todoist_list_projects',
  name: 'Todoist List Projects',
  description: "List all projects in the user's Todoist account",
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Todoist API token from settings/integrations',
    },
  },

  request: {
    url: 'https://api.todoist.com/rest/v2/projects',
    method: 'GET',
    headers: (params) => {
      if (!params.apiKey) {
        throw new Error('Missing API key for Todoist API request')
      }
      return {
        Authorization: `Bearer ${params.apiKey}`,
      }
    },
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: errorText || `Todoist API error: ${response.status} ${response.statusText}`,
        output: {
          projects: [],
        },
      }
    }

    const data = await response.json()
    return {
      success: true,
      output: {
        projects: Array.isArray(data) ? data.map(mapTodoistProject) : [],
      },
    }
  },

  outputs: {
    projects: {
      type: 'array',
      description: 'List of projects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The unique project ID' },
          name: { type: 'string', description: 'The name of the project' },
          color: { type: 'string', description: 'The color theme of the project' },
          isFavorite: {
            type: 'boolean',
            description: 'Whether the project is marked as a favorite',
          },
          isInboxProject: {
            type: 'boolean',
            description: "Whether the project is the user's Inbox",
          },
          viewStyle: {
            type: 'string',
            description: 'The display view style of the project (list or board)',
          },
        },
      },
    },
  },
}
