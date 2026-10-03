import type { JotformDeleteQuestionParams, JotformMessageResponse } from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  parseJotformResponse,
  requireValue,
  toStringOrNull,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteQuestionTool: ToolConfig<JotformDeleteQuestionParams, JotformMessageResponse> = {
  id: 'jotform_delete_question',
  name: 'Jotform Delete Question',
  description: 'Delete a question from a Jotform form.',
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
      description: 'ID of the form the question belongs to',
    },
    questionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the question to delete',
    },
  },

  request: {
    url: (params) =>
      buildJotformUrl(
        params,
        `form/${encodeURIComponent(requireValue(params.formId, 'formId'))}/question/${encodeURIComponent(
          requireValue(params.questionId, 'questionId')
        )}`
      ).toString(),
    method: 'DELETE',
    headers: (params) => buildJotformHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Delete Question')

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
