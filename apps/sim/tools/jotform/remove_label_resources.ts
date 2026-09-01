import { normalizeLabelResourceRefs, toLabelResourcePayload } from '@/tools/jotform/normalize'
import type {
  JotformLabelResourceRefsResponse,
  JotformLabelResourcesParams,
} from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  parseJotformResponse,
  requireValue,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const removeLabelResourcesTool: ToolConfig<
  JotformLabelResourcesParams,
  JotformLabelResourceRefsResponse
> = {
  id: 'jotform_remove_label_resources',
  name: 'Jotform Remove Label Resources',
  description: 'Unassign forms, workflows, sheets, or apps from a Jotform label.',
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
      description: 'ID of the label to remove the assets from',
    },
    resources: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Assets to remove, each with an id and a type of form, workflow, sheet, or portal, e.g. [{"id":"251464995493876","type":"form"}]',
    },
  },

  request: {
    url: (params) =>
      buildJotformUrl(
        params,
        `label/${encodeURIComponent(requireValue(params.labelId, 'labelId'))}/remove-resources`
      ).toString(),
    method: 'PUT',
    headers: (params) => ({
      ...buildJotformHeaders(params.apiKey),
      'Content-Type': 'application/json',
    }),
    body: (params) => ({ resources: toLabelResourcePayload(params.resources) }),
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Remove Label Resources')

    return {
      success: true,
      output: { resources: normalizeLabelResourceRefs(envelope.content) },
    }
  },

  outputs: {
    resources: {
      type: 'array',
      description: 'The assets reported by the API after the removal',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Asset ID' },
          type: {
            type: 'string',
            description: 'Asset kind, echoed uppercase: FORM, WORKFLOW, SHEET, or PORTAL',
          },
        },
      },
    },
  },
}
