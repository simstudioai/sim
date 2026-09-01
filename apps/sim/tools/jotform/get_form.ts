import { normalizeForm, unwrapSingle } from '@/tools/jotform/normalize'
import type { JotformFormResponse, JotformGetFormParams } from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  parseJotformResponse,
  requireValue,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const getFormTool: ToolConfig<JotformGetFormParams, JotformFormResponse> = {
  id: 'jotform_get_form',
  name: 'Jotform Get Form',
  description:
    'Get the details of a single Jotform form, including its status, URL, and submission counts.',
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
    formId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Form ID, the numeric segment of the form URL',
    },
  },

  request: {
    url: (params) =>
      buildJotformUrl(
        params,
        `form/${encodeURIComponent(requireValue(params.formId, 'formId'))}`
      ).toString(),
    method: 'GET',
    headers: (params) => buildJotformHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Get Form')
    const raw = unwrapSingle(envelope.content)
    if (!raw) throw new Error('Jotform Get Form returned no form.')

    return {
      success: true,
      output: { form: normalizeForm(raw) },
    }
  },

  outputs: {
    form: {
      type: 'object',
      description: 'The requested form',
      properties: {
        id: { type: 'string', description: 'Form ID' },
        username: { type: 'string', description: 'Account that owns the form' },
        title: { type: 'string', description: 'Form title' },
        height: { type: 'string', description: 'Form height in pixels' },
        status: { type: 'string', description: 'ENABLED, DISABLED, or DELETED' },
        created_at: { type: 'string', description: 'Creation time, YYYY-MM-DD HH:MM:SS' },
        updated_at: { type: 'string', description: 'Last update time, YYYY-MM-DD HH:MM:SS' },
        last_submission: { type: 'string', description: 'Time of the most recent submission' },
        new: { type: 'string', description: 'Unread submission count' },
        count: { type: 'string', description: 'Total submission count' },
        type: { type: 'string', description: 'LEGACY or CARD' },
        favorite: { type: 'string', description: '1 when the form is favorited, otherwise 0' },
        archived: { type: 'string', description: '1 when the form is archived, otherwise 0' },
        url: { type: 'string', description: 'Public form URL' },
      },
    },
  },
}
