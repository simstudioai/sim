import { unwrapSingle } from '@/tools/jotform/normalize'
import type {
  JotformUpdateQuestionParams,
  JotformUpdateQuestionResponse,
} from '@/tools/jotform/types'
import {
  buildJotformUrl,
  jotformFormHeaders,
  parseJotformResponse,
  requireValue,
  toFormBody,
  toJsonObject,
  trimOrUndefined,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const updateQuestionTool: ToolConfig<
  JotformUpdateQuestionParams,
  JotformUpdateQuestionResponse
> = {
  id: 'jotform_update_question',
  name: 'Jotform Update Question',
  description:
    'Edit the properties of a form question, such as its label, order, or validation. Only the supplied properties change.',
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
      description: 'ID of the question to edit',
    },
    text: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New question label',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New position of the question on the form',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New slug for the question label',
    },
    questionProperties: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Additional type-specific properties to set, e.g. {"required":"Yes","validation":"Email"}',
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
    method: 'POST',
    headers: (params) => jotformFormHeaders(params.apiKey),
    body: (params) => {
      const question: Record<string, unknown> = {
        ...toJsonObject(params.questionProperties, 'questionProperties'),
      }

      const text = trimOrUndefined(params.text)
      const order = trimOrUndefined(params.order)
      const name = trimOrUndefined(params.name)
      if (text) question.text = text
      if (order) question.order = order
      if (name) question.name = name

      if (Object.keys(question).length === 0) {
        throw new Error('Supply at least one question property to update.')
      }

      return toFormBody({ question })
    },
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Update Question')

    return {
      success: true,
      output: { question: unwrapSingle(envelope.content) ?? {} },
    }
  },

  outputs: {
    question: {
      type: 'json',
      description:
        'The question properties that were edited, with their new values. Jotform echoes only the changed keys, such as text, order, and type.',
    },
  },
}
