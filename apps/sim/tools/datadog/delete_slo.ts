import type { DeleteSloParams, DeleteSloResponse } from '@/tools/datadog/types'
import {
  datadogApiUrl,
  datadogErrorMessage,
  datadogHeaders,
  datadogPathSegment,
} from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteSloTool: ToolConfig<DeleteSloParams, DeleteSloResponse> = {
  id: 'datadog_delete_slo',
  name: 'Datadog Delete SLO',
  description:
    'Permanently delete a service level objective. Datadog returns a conflict when the SLO is still referenced by a dashboard.',
  version: '1.0.0',

  params: {
    sloId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the service level objective to delete',
    },
    force: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Delete even when the SLO is referenced by other resources',
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
    url: (params) => {
      const queryString = params.force ? '?force=true' : ''
      return datadogApiUrl(
        params.site,
        `/api/v1/slo/${datadogPathSegment(params.sloId)}${queryString}`
      )
    },
    method: 'DELETE',
    headers: datadogHeaders,
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        output: { success: false, deletedIds: [] },
        error: await datadogErrorMessage(response),
      }
    }

    const data = await response.json().catch(() => ({}))

    return {
      success: true,
      output: {
        success: true,
        deletedIds: data.data ?? [],
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the SLO was deleted',
    },
    deletedIds: {
      type: 'array',
      description: 'IDs of the deleted service level objectives',
      items: { type: 'string' },
    },
  },
}
