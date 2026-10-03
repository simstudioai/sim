import { unwrapSingle } from '@/tools/jotform/normalize'
import type { JotformUpdateLabelParams, JotformUpdateLabelResponse } from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  parseJotformResponse,
  requireValue,
  trimOrUndefined,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const updateLabelTool: ToolConfig<JotformUpdateLabelParams, JotformUpdateLabelResponse> = {
  id: 'jotform_update_label',
  name: 'Jotform Update Label',
  description: 'Rename a Jotform label or change its color.',
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
      description: 'ID of the label to update',
    },
    labelName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New name for the label',
    },
    color: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New label color as a hex code, e.g. "#23FFDD"',
    },
  },

  request: {
    url: (params) =>
      buildJotformUrl(
        params,
        `label/${encodeURIComponent(requireValue(params.labelId, 'labelId'))}`
      ).toString(),
    method: 'PUT',
    headers: (params) => ({
      ...buildJotformHeaders(params.apiKey),
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      const name = trimOrUndefined(params.labelName)
      const color = trimOrUndefined(params.color)
      if (name) body.name = name
      if (color) body.color = color

      if (Object.keys(body).length === 0) {
        throw new Error('Supply a name or a color to update.')
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Update Label')

    return {
      success: true,
      output: { label: unwrapSingle(envelope.content) ?? {} },
    }
  },

  outputs: {
    label: {
      type: 'json',
      description:
        'The label fields that were edited, with their new values. Jotform echoes only the changed keys, such as name and color.',
    },
  },
}
