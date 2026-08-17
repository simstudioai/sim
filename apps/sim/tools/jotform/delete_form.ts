import { normalizeForm, unwrapSingle } from '@/tools/jotform/normalize'
import type { JotformDeleteFormParams, JotformDeleteFormResponse } from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  parseJotformResponse,
  requireValue,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteFormTool: ToolConfig<JotformDeleteFormParams, JotformDeleteFormResponse> = {
  id: 'jotform_delete_form',
  name: 'Jotform Delete Form',
  description: 'Delete a Jotform form. The API returns the form with status DELETED.',
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
      description: 'ID of the form to delete',
    },
  },

  request: {
    url: (params) =>
      buildJotformUrl(
        params,
        `form/${encodeURIComponent(requireValue(params.formId, 'formId'))}`
      ).toString(),
    method: 'DELETE',
    headers: (params) => buildJotformHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Delete Form')
    const raw = unwrapSingle(envelope.content)
    if (!raw) throw new Error('Jotform Delete Form returned no form.')

    return {
      success: true,
      output: { form: normalizeForm(raw) },
    }
  },

  outputs: {
    form: {
      type: 'object',
      description: 'The deleted form, as the API reports it after deletion',
      properties: {
        id: { type: 'string', description: 'Form ID' },
        username: { type: 'string', description: 'Account that owned the form' },
        title: { type: 'string', description: 'Form title' },
        height: { type: 'string', description: 'Form height in pixels' },
        status: { type: 'string', description: 'DELETED after a successful delete' },
        created_at: { type: 'string', description: 'Creation time, YYYY-MM-DD HH:MM:SS' },
        updated_at: { type: 'string', description: 'Deletion time, YYYY-MM-DD HH:MM:SS' },
        new: { type: 'string', description: 'Unread submission count' },
        count: { type: 'string', description: 'Total submission count' },
      },
    },
  },
}
