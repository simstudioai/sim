import type { JotformDeleteLabelParams, JotformMessageResponse } from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  parseJotformResponse,
  requireValue,
  toStringOrNull,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteLabelTool: ToolConfig<JotformDeleteLabelParams, JotformMessageResponse> = {
  id: 'jotform_delete_label',
  name: 'Jotform Delete Label',
  description: 'Delete a Jotform label along with all of its sublabels.',
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
      description: 'ID of the label to delete',
    },
  },

  request: {
    url: (params) =>
      buildJotformUrl(
        params,
        `label/${encodeURIComponent(requireValue(params.labelId, 'labelId'))}`
      ).toString(),
    method: 'DELETE',
    headers: (params) => buildJotformHeaders(params.apiKey),
  },

  /**
   * Jotform publishes no response sample for this endpoint, so nothing is read out
   * of `content` beyond rendering it as text. The envelope itself still decides
   * success, which is what `parseJotformResponse` checks.
   */
  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Delete Label')

    return {
      success: true,
      output: {
        deleted: true,
        message: toStringOrNull(envelope.content) ?? envelope.message,
      },
    }
  },

  outputs: {
    deleted: {
      type: 'boolean',
      description: 'True when Jotform accepted the deletion',
    },
    message: {
      type: 'string',
      description: 'Confirmation text returned by Jotform',
      optional: true,
    },
  },
}
