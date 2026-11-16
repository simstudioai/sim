import {
  INCIDENTIO_CURSOR_PAGINATION_OUTPUT,
  INCIDENTIO_FOLLOW_UP_SUMMARY_OUTPUT_PROPERTIES,
  INCIDENTIO_V3_MAX_PAGE_SIZE,
  type IncidentioFollowUpsListParams,
  type IncidentioFollowUpsListResponse,
} from '@/tools/incidentio/types'
import { collectIncidentioPages, mapIncidentioFollowUpSummary } from '@/tools/incidentio/utils'
import { INCIDENTIO_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ToolConfig } from '@/tools/types'

export const followUpsListTool: ToolConfig<
  IncidentioFollowUpsListParams,
  IncidentioFollowUpsListResponse
> = {
  id: 'incidentio_follow_ups_list',
  name: 'incident.io Follow-ups List',
  description:
    'List follow-ups from incident.io, optionally filtered by incident ID. Without page_size or after, follows pages automatically and returns up to 2,500 follow-ups, oldest first; if more remain, pagination_meta.after is set. Pass page_size or after to fetch a single page.',
  version: '1.0.0',
  oauth: INCIDENTIO_CREDENTIAL_OAUTH,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'incident.io API Key',
    },
    incident_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter follow-ups by incident ID (e.g., "01FCNDV6P870EA6S7TK1DSYDG0")',
    },
    incident_mode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter follow-ups by incident mode (standard, retrospective, test, tutorial, or stream). When omitted, follow-ups from standard and retrospective incidents are returned.',
    },
    page_size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Number of follow-ups per page, 1-250. Setting it fetches a single page instead of following pages automatically',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Pagination cursor from a previous page\'s pagination_meta.after (e.g., "01FDAG4SAP5TYPT98WGR2N7W91")',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.incident.io/v3/follow_ups')

      if (params.incident_id) {
        url.searchParams.append('incident_id', params.incident_id.trim())
      }

      if (params.incident_mode) {
        url.searchParams.append('incident_mode', params.incident_mode)
      }

      url.searchParams.append('page_size', String(params.page_size || INCIDENTIO_V3_MAX_PAGE_SIZE))

      if (params.after) {
        url.searchParams.append('after', params.after.trim())
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
        follow_ups: Array.isArray(data.follow_ups)
          ? data.follow_ups.map(mapIncidentioFollowUpSummary)
          : [],
        pagination_meta: data.pagination_meta,
      },
    }
  },

  postProcess: async (result, params, executeTool) => {
    const firstAfter = result.output.pagination_meta?.after
    if (params.page_size || params.after || !firstAfter) return result

    const collected = await collectIncidentioPages(
      { items: result.output.follow_ups, after: firstAfter },
      'follow_ups',
      (after) =>
        executeTool('incidentio_follow_ups_list', {
          ...params,
          after,
          page_size: INCIDENTIO_V3_MAX_PAGE_SIZE,
        })
    )
    if ('error' in collected) {
      return { success: false, output: result.output, error: collected.error }
    }
    return {
      success: true,
      output: {
        follow_ups: collected.items,
        pagination_meta: result.output.pagination_meta && {
          ...result.output.pagination_meta,
          after: collected.after,
        },
      },
    }
  },

  outputs: {
    follow_ups: {
      type: 'array',
      description: 'List of follow-ups',
      items: {
        type: 'object',
        properties: INCIDENTIO_FOLLOW_UP_SUMMARY_OUTPUT_PROPERTIES,
      },
    },
    pagination_meta: INCIDENTIO_CURSOR_PAGINATION_OUTPUT,
  },
}
