import { normalizeForm, unwrapSingle } from '@/tools/jotform/normalize'
import type { JotformCreateFormParams, JotformFormResponse } from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  parseJotformResponse,
  toJsonArray,
  toJsonObject,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const createFormTool: ToolConfig<JotformCreateFormParams, JotformFormResponse> = {
  id: 'jotform_create_form',
  name: 'Jotform Create Form',
  description:
    'Create a new Jotform form from a list of questions, plus optional form properties and notification emails.',
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
    questions: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of question objects, each with type, text, order, and name, e.g. [{"type":"control_email","text":"Email","order":"1","name":"email"}]',
    },
    properties: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Form properties object, e.g. {"title":"Contact Us","height":"600"}',
    },
    emails: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of email objects, each with type (notification or autorespond), from, to, subject, html, and body',
    },
  },

  request: {
    url: (params) => buildJotformUrl(params, 'form').toString(),
    method: 'PUT',
    headers: (params) => ({
      ...buildJotformHeaders(params.apiKey),
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const questions = toJsonArray(params.questions, 'questions')
      if (questions.length === 0) {
        throw new Error('questions must contain at least one question object.')
      }

      const body: Record<string, unknown> = { questions }
      const properties = toJsonObject(params.properties, 'properties')
      if (Object.keys(properties).length > 0) body.properties = properties
      const emails = toJsonArray(params.emails, 'emails')
      if (emails.length > 0) body.emails = emails

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Create Form')
    const raw = unwrapSingle(envelope.content)
    if (!raw) throw new Error('Jotform Create Form returned no form.')

    return {
      success: true,
      output: { form: normalizeForm(raw) },
    }
  },

  outputs: {
    form: {
      type: 'object',
      description: 'The created form',
      properties: {
        id: { type: 'string', description: 'ID of the created form' },
        username: { type: 'string', description: 'Account that owns the form' },
        title: { type: 'string', description: 'Form title' },
        height: { type: 'string', description: 'Form height in pixels' },
        status: { type: 'string', description: 'ENABLED, DISABLED, or DELETED' },
        created_at: { type: 'string', description: 'Creation time, YYYY-MM-DD HH:MM:SS' },
        updated_at: { type: 'string', description: 'Last update time, YYYY-MM-DD HH:MM:SS' },
        new: { type: 'string', description: 'Unread submission count' },
        count: { type: 'string', description: 'Total submission count' },
        url: { type: 'string', description: 'Public form URL' },
      },
    },
  },
}
