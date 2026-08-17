import { normalizeQuestion, toList } from '@/tools/jotform/normalize'
import type {
  JotformCreateQuestionsParams,
  JotformListQuestionsResponse,
} from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  isRecord,
  parseJotformResponse,
  requireValue,
  toJsonArray,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const createQuestionsTool: ToolConfig<
  JotformCreateQuestionsParams,
  JotformListQuestionsResponse
> = {
  id: 'jotform_create_questions',
  name: 'Jotform Create Questions',
  description: 'Add several questions to an existing Jotform form in one call.',
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
      description: 'ID of the form to add the questions to',
    },
    questions: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of question objects, each with type, text, order, and name, e.g. [{"type":"control_head","text":"Text 1","order":"1","name":"Header1"}]',
    },
  },

  request: {
    url: (params) =>
      buildJotformUrl(
        params,
        `form/${encodeURIComponent(requireValue(params.formId, 'formId'))}/questions`
      ).toString(),
    method: 'PUT',
    headers: (params) => ({
      ...buildJotformHeaders(params.apiKey),
      'Content-Type': 'application/json',
    }),
    /**
     * The endpoint reads a `questions` envelope whose value is keyed by position
     * rather than a bare array — `{"questions":{"1":{...},"2":{...}}}` — so an array
     * of question objects is indexed from 1 on the way out.
     */
    body: (params) => {
      const questions = toJsonArray(params.questions, 'questions')
      if (questions.length === 0) {
        throw new Error('questions must contain at least one question object.')
      }

      const indexed: Record<string, unknown> = {}
      questions.forEach((question, index) => {
        if (!isRecord(question)) {
          throw new Error('Every entry in questions must be a JSON object.')
        }
        indexed[String(index + 1)] = question
      })

      return { questions: indexed }
    },
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Create Questions')

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
      description: 'The questions that were added, as stored on the form',
      items: {
        type: 'object',
        properties: {
          qid: { type: 'string', description: 'ID assigned to the question' },
          name: { type: 'string', description: 'Slug of the question label' },
          order: { type: 'string', description: 'Position of the question on the form' },
          text: { type: 'string', description: 'Question label' },
          type: { type: 'string', description: 'Field type of the question' },
          required: { type: 'string', description: 'Yes when the question is required' },
        },
      },
    },
  },
}
