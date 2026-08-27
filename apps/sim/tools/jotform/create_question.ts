import { normalizeQuestion, unwrapSingle } from '@/tools/jotform/normalize'
import type { JotformCreateQuestionParams, JotformQuestionResponse } from '@/tools/jotform/types'
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

export const createQuestionTool: ToolConfig<JotformCreateQuestionParams, JotformQuestionResponse> =
  {
    id: 'jotform_create_question',
    name: 'Jotform Create Question',
    description: 'Add a question to an existing Jotform form.',
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
        description: 'ID of the form to add the question to',
      },
      questionType: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Field type, e.g. control_textbox, control_textarea, control_dropdown, control_radio, control_checkbox, control_fileupload, control_fullname, control_email, or control_datetime',
      },
      text: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Question label shown on the form',
      },
      order: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Position of the question on the form',
      },
      name: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Slug for the question label',
      },
      questionProperties: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Additional type-specific properties merged into the question, e.g. {"required":"Yes","validation":"Numeric"}',
      },
    },

    request: {
      url: (params) =>
        buildJotformUrl(
          params,
          `form/${encodeURIComponent(requireValue(params.formId, 'formId'))}/questions`
        ).toString(),
      method: 'POST',
      headers: (params) => jotformFormHeaders(params.apiKey),
      body: (params) => {
        const question: Record<string, unknown> = {
          ...toJsonObject(params.questionProperties, 'questionProperties'),
          type: requireValue(params.questionType, 'questionType'),
        }

        const text = trimOrUndefined(params.text)
        const order = trimOrUndefined(params.order)
        const name = trimOrUndefined(params.name)
        if (text) question.text = text
        if (order) question.order = order
        if (name) question.name = name

        return toFormBody({ question })
      },
    },

    transformResponse: async (response: Response) => {
      const envelope = await parseJotformResponse(response, 'Jotform Create Question')
      const raw = unwrapSingle(envelope.content)
      if (!raw) throw new Error('Jotform Create Question returned no question.')

      return {
        success: true,
        output: { question: normalizeQuestion(raw) },
      }
    },

    outputs: {
      question: {
        type: 'object',
        description: 'The created question, as stored on the form',
        properties: {
          qid: { type: 'string', description: 'ID assigned to the new question' },
          name: { type: 'string', description: 'Slug of the question label' },
          order: { type: 'string', description: 'Position of the question on the form' },
          text: { type: 'string', description: 'Question label' },
          type: { type: 'string', description: 'Field type of the question' },
          required: { type: 'string', description: 'Yes when the question is required' },
        },
      },
    },
  }
