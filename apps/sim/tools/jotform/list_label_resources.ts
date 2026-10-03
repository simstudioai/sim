import { normalizeLabelResource, toList } from '@/tools/jotform/normalize'
import type {
  JotformListLabelResourcesParams,
  JotformListLabelResourcesResponse,
} from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  parseJotformResponse,
  requireValue,
  trimOrUndefined,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const listLabelResourcesTool: ToolConfig<
  JotformListLabelResourcesParams,
  JotformListLabelResourcesResponse
> = {
  id: 'jotform_list_label_resources',
  name: 'Jotform List Label Resources',
  description:
    'List the assets assigned to a label — forms, workflows, sheets, and apps — with their status and titles.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Jotform API key',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Jotform data residency region the API key belongs to: "us" (default), "eu", or "hipaa"',
    },
    labelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the label whose assets to list',
    },
    offset: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Index of the first result to return. Default 0',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of assets to return',
    },
    orderby: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Field to order by, e.g. created_at',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by asset status, e.g. active',
    },
  },

  request: {
    url: (params) => {
      const url = buildJotformUrl(
        params,
        `label/${encodeURIComponent(requireValue(params.labelId, 'labelId'))}/resources`
      )
      const offset = trimOrUndefined(params.offset)
      const limit = trimOrUndefined(params.limit)
      const orderby = trimOrUndefined(params.orderby)
      const status = trimOrUndefined(params.status)

      if (offset) url.searchParams.set('offset', offset)
      if (limit) url.searchParams.set('limit', limit)
      if (orderby) url.searchParams.set('orderby', orderby)
      if (status) url.searchParams.set('status', status)

      return url.toString()
    },
    method: 'GET',
    headers: (params) => buildJotformHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform List Label Resources')

    return {
      success: true,
      output: {
        resources: toList(envelope.content).map(normalizeLabelResource),
      },
    }
  },

  outputs: {
    resources: {
      type: 'array',
      description: 'Assets assigned to the label',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Asset ID' },
          username: { type: 'string', description: 'Account that owns the asset' },
          title: { type: 'string', description: 'Asset title' },
          status: { type: 'string', description: 'Asset status, e.g. ENABLED or AUTODISABLED' },
          assetType: {
            type: 'string',
            description: 'Kind of asset: form, workflow, sheet, or portal',
          },
          type: { type: 'string', description: 'Asset subtype, e.g. LEGACY, APP, or default' },
          labels: { type: 'string', description: 'Label IDs the asset belongs to' },
          created_at: { type: 'string', description: 'Creation time, YYYY-MM-DD HH:MM:SS' },
          updated_at: { type: 'string', description: 'Last update time, YYYY-MM-DD HH:MM:SS' },
        },
      },
    },
  },
}
