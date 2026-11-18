import type { RootlyDeleteIncidentParams, RootlyDeleteIncidentResponse } from '@/tools/rootly/types'
import { rootlyErrorMessage } from '@/tools/rootly/utils'
import { ROOTLY_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const rootlyDeleteIncidentTool: ToolConfig<
  RootlyDeleteIncidentParams,
  RootlyDeleteIncidentResponse
> = {
  id: 'rootly_delete_incident',
  name: 'Rootly Delete Incident',
  description: 'Delete an incident by ID from Rootly.',
  version: '1.0.0',
  oauth: ROOTLY_CREDENTIAL_OAUTH,

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
    url: (params) =>
      `https://api.rootly.com/v1/incidents/${safeUrlPathSegment(params.incidentId, 'incidentId')}`,
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
          message: rootlyErrorMessage(errorData, response),
        },
        error: rootlyErrorMessage(errorData, response),
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
