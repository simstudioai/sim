import { normalizeQuestion, toList } from '@/tools/jotform/normalize'
import type {
  JotformListQuestionsParams,
  JotformListQuestionsResponse,
} from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  parseJotformResponse,
  requireValue,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const listQuestionsTool: ToolConfig<
  JotformListQuestionsParams,
  JotformListQuestionsResponse
> = {
  id: 'jotform_list_questions',
  name: 'Jotform List Questions',
  description:
    'List every question on a form with its question ID, label, and field type. Question IDs are what submissions are keyed by.',
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
      description: 'ID of the form whose questions to list',
    },
  },

  request: {
    url: (params) =>
      buildJotformUrl(
        params,
        `form/${encodeURIComponent(requireValue(params.formId, 'formId'))}/questions`
      ).toString(),
    method: 'GET',
    headers: (params) => buildJotformHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform List Questions')

    return {
      success: true,
      output: {
        questions: toList(envelope.content).map(normalizeQuestion),
      },
    }
  },

  outputs: {
    questions: {
      type: 'array',
      description:
        'Questions on the form. Each entry also carries the type-specific properties Jotform stores for that field, such as validation, sublabels, or options.',
      items: {
        type: 'object',
        properties: {
          qid: { type: 'string', description: 'Question ID, used to key submission answers' },
          name: { type: 'string', description: 'Slug of the question label' },
          order: { type: 'string', description: 'Position of the question on the form' },
          text: { type: 'string', description: 'Question label' },
          type: {
            type: 'string',
            description:
              'Field type, e.g. control_textbox, control_textarea, control_dropdown, control_fullname, control_email, control_fileupload',
          },
          required: { type: 'string', description: 'Yes when the question is required' },
        },
      },
    },
  },
}
