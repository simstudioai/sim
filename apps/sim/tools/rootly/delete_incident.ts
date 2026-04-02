import type { RootlyDeleteIncidentParams, RootlyDeleteIncidentResponse } from '@/tools/rootly/types'
import type { ToolConfig } from '@/tools/types'

export const rootlyDeleteIncidentTool: ToolConfig<
  RootlyDeleteIncidentParams,
  RootlyDeleteIncidentResponse
> = {
  id: 'rootly_delete_incident',
  name: 'Rootly Delete Incident',
  description: 'Delete an incident by ID from Rootly.',
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
      description: 'The ID of the incident to delete',
    },
  },

  request: {
    url: (params) => `https://api.rootly.com/v1/incidents/${params.incidentId.trim()}`,
    method: 'DELETE',
    headers: (params) => ({
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        output: {
          success: false,
          message:
            errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
        },
        error: errorData.errors?.[0]?.detail || `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    return {
      success: true,
      output: {
        success: true,
        message: 'Incident deleted successfully',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the deletion succeeded' },
    message: { type: 'string', description: 'Result message' },
  },
}
