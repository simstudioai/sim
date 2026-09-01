import { normalizeLabel, unwrapSingle } from '@/tools/jotform/normalize'
import type { JotformCreateLabelParams, JotformLabelResponse } from '@/tools/jotform/types'
import {
  buildJotformUrl,
  jotformFormHeaders,
  parseJotformResponse,
  requireValue,
  toFormBody,
  trimOrUndefined,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const createLabelTool: ToolConfig<JotformCreateLabelParams, JotformLabelResponse> = {
  id: 'jotform_create_label',
  name: 'Jotform Create Label',
  description:
    'Create a Jotform label for grouping forms and other assets, optionally nested under a parent label.',
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
    labelName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the label, e.g. "IT Operations"',
    },
    color: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Label color as a hex code, e.g. "#FFDC7B"',
    },
    parent: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the parent label to nest this label under',
    },
  },

  request: {
    url: (params) => buildJotformUrl(params, 'label').toString(),
    method: 'POST',
    headers: (params) => jotformFormHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        name: requireValue(params.labelName, 'labelName'),
      }
      const color = trimOrUndefined(params.color)
      const parent = trimOrUndefined(params.parent)
      if (color) body.color = color
      if (parent) body.parent = parent
      return toFormBody(body)
    },
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Create Label')
    const raw = unwrapSingle(envelope.content)
    if (!raw) throw new Error('Jotform Create Label returned no label.')

    return {
      success: true,
      output: { label: normalizeLabel(raw) },
    }
  },

  outputs: {
    label: {
      type: 'object',
      description: 'The created label',
      properties: {
        id: { type: 'string', description: 'ID assigned to the new label' },
        name: { type: 'string', description: 'Label name' },
        color: { type: 'string', description: 'Label color, as a hex code' },
        owner: { type: 'string', description: 'Account that owns the label' },
        created_at: { type: 'string', description: 'Creation time, YYYY-MM-DD HH:MM:SS' },
        updated_at: { type: 'string', description: 'Last update time, YYYY-MM-DD HH:MM:SS' },
      },
    },
  },
}
