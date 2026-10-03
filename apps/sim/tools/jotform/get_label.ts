import { normalizeLabel, unwrapSingle } from '@/tools/jotform/normalize'
import type { JotformGetLabelParams, JotformLabelResponse } from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  parseJotformResponse,
  requireValue,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const getLabelTool: ToolConfig<JotformGetLabelParams, JotformLabelResponse> = {
  id: 'jotform_get_label',
  name: 'Jotform Get Label',
  description: 'Get the name, color, and owner of a single Jotform label.',
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
      description: 'ID of the label to read, available from the List Labels operation',
    },
  },

  request: {
    url: (params) =>
      buildJotformUrl(
        params,
        `label/${encodeURIComponent(requireValue(params.labelId, 'labelId'))}`
      ).toString(),
    method: 'GET',
    headers: (params) => buildJotformHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Get Label')
    const raw = unwrapSingle(envelope.content)
    if (!raw) throw new Error('Jotform Get Label returned no label.')

    return {
      success: true,
      output: { label: normalizeLabel(raw) },
    }
  },

  outputs: {
    label: {
      type: 'object',
      description: 'The requested label',
      properties: {
        id: { type: 'string', description: 'Label ID' },
        name: { type: 'string', description: 'Label name' },
        order: { type: 'string', description: 'Position among its siblings' },
        color: { type: 'string', description: 'Label color, as a hex code' },
        owner: { type: 'string', description: 'Account that owns the label' },
        ownerType: { type: 'string', description: 'Owner kind, e.g. USER' },
        created_at: { type: 'string', description: 'Creation time, YYYY-MM-DD HH:MM:SS' },
        updated_at: { type: 'string', description: 'Last update time, YYYY-MM-DD HH:MM:SS' },
      },
    },
  },
}
