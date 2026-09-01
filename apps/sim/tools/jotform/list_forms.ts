import { normalizeForm, toList } from '@/tools/jotform/normalize'
import type { JotformListFormsParams, JotformListFormsResponse } from '@/tools/jotform/types'
import {
  applyListQuery,
  buildJotformHeaders,
  buildJotformUrl,
  parseJotformResponse,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const listFormsTool: ToolConfig<JotformListFormsParams, JotformListFormsResponse> = {
  id: 'jotform_list_forms',
  name: 'Jotform List Forms',
  description:
    'List the forms on a Jotform account with their titles, status, and submission counts.',
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
    offset: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Index of the first result to return. Default 0',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of forms to return. Default 20, maximum 1000',
    },
    orderby: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Field to order by: id, username, title, status, created_at, updated_at, new, count, or slug',
    },
    direction: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction: ASC or DESC',
    },
    filter: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter object, e.g. {"status":"ENABLED"} or {"created_at:gt":"2024-01-01 00:00:00"}',
    },
  },

  request: {
    url: (params) => {
      const url = buildJotformUrl(params, 'user/forms')
      applyListQuery(url, params)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => buildJotformHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform List Forms')

    return {
      success: true,
      output: {
        forms: toList(envelope.content).map(normalizeForm),
        pagination: envelope.resultSet,
      },
    }
  },

  outputs: {
    forms: {
      type: 'array',
      description: 'Forms on the account',
      items: {
        type: 'object',
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
    pagination: {
      type: 'object',
      description: 'Result window reported by the API',
      optional: true,
      properties: {
        offset: { type: 'number', description: 'Index of the first returned form' },
        limit: { type: 'number', description: 'Page size applied' },
        count: { type: 'number', description: 'Number of forms returned' },
      },
    },
  },
}
