import { normalizeLabelTree } from '@/tools/jotform/normalize'
import type { JotformListLabelsParams, JotformListLabelsResponse } from '@/tools/jotform/types'
import { buildJotformHeaders, buildJotformUrl, parseJotformResponse } from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const listLabelsTool: ToolConfig<JotformListLabelsParams, JotformListLabelsResponse> = {
  id: 'jotform_list_labels',
  name: 'Jotform List Labels',
  description:
    'List the labels on the account as a tree. Labels are how Jotform groups forms, workflows, sheets, and apps, replacing the older folder endpoints.',
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
    addResources: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to "true" to include the resources assigned to each label',
    },
  },

  request: {
    url: (params) => {
      const url = buildJotformUrl(params, 'user/labels')
      const addResources = params.addResources?.trim()
      if (addResources) url.searchParams.set('addResources', addResources)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => buildJotformHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform List Labels')

    return {
      success: true,
      output: { labels: normalizeLabelTree(envelope.content) },
    }
  },

  outputs: {
    labels: {
      type: 'array',
      description:
        'Labels on the account. The API returns a root entry whose sublabels hold the user-visible labels, nested to arbitrary depth.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Label ID' },
          name: { type: 'string', description: 'Label name' },
          order: { type: 'string', description: 'Position among its siblings' },
          color: { type: 'string', description: 'Label color, as a hex code' },
          owner: { type: 'string', description: 'Account that owns the label' },
          parent_label_id: { type: 'string', description: 'ID of the parent label' },
          created_at: { type: 'string', description: 'Creation time, YYYY-MM-DD HH:MM:SS' },
          updated_at: { type: 'string', description: 'Last update time, YYYY-MM-DD HH:MM:SS' },
          sublabels: { type: 'json', description: 'Nested labels beneath this one' },
        },
      },
    },
  },
}
