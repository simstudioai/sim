import { toList } from '@/tools/jotform/normalize'
import type { JotformGetHistoryParams, JotformGetHistoryResponse } from '@/tools/jotform/types'
import {
  buildJotformHeaders,
  buildJotformUrl,
  parseJotformResponse,
  toStringOrNull,
  trimOrUndefined,
} from '@/tools/jotform/utils'
import type { ToolConfig } from '@/tools/types'

export const getHistoryTool: ToolConfig<JotformGetHistoryParams, JotformGetHistoryResponse> = {
  id: 'jotform_get_history',
  name: 'Jotform Get History',
  description:
    'Read the account activity log: forms created, updated, deleted or purged, and account logins.',
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
    action: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Activity to filter by: all (default), userCreation, userLogin, formCreation, formUpdate, formDelete, or formPurge',
    },
    date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Named date range to limit results to, e.g. lastWeek. Use startDate and endDate for an explicit range instead',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: ASC or DESC',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return activity after this date. Format MM/DD/YYYY',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return activity before this date. Format MM/DD/YYYY',
    },
  },

  request: {
    url: (params) => {
      const url = buildJotformUrl(params, 'user/history')
      const action = trimOrUndefined(params.action)
      const date = trimOrUndefined(params.date)
      const sortBy = trimOrUndefined(params.sortBy)
      const startDate = trimOrUndefined(params.startDate)
      const endDate = trimOrUndefined(params.endDate)

      if (action) url.searchParams.set('action', action)
      if (date) url.searchParams.set('date', date)
      if (sortBy) url.searchParams.set('sortBy', sortBy)
      if (startDate) url.searchParams.set('startDate', startDate)
      if (endDate) url.searchParams.set('endDate', endDate)

      return url.toString()
    },
    method: 'GET',
    headers: (params) => buildJotformHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const envelope = await parseJotformResponse(response, 'Jotform Get History')

    return {
      success: true,
      output: {
        history: toList(envelope.content).map((entry) => ({
          type: toStringOrNull(entry.type),
          formID: toStringOrNull(entry.formID),
          username: toStringOrNull(entry.username),
          formTitle: toStringOrNull(entry.formTitle),
          formStatus: toStringOrNull(entry.formStatus),
          ip: toStringOrNull(entry.ip),
          timestamp: toStringOrNull(entry.timestamp),
        })),
      },
    }
  },

  outputs: {
    history: {
      type: 'array',
      description: 'Account activity entries',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description:
              'Activity type: userCreation, userLogin, formCreation, formUpdate, formDelete, or formPurge',
          },
          formID: { type: 'string', description: 'Form the activity applied to' },
          username: { type: 'string', description: 'Account that performed the activity' },
          formTitle: { type: 'string', description: 'Title of the affected form' },
          formStatus: { type: 'string', description: 'Status of the form after the activity' },
          ip: { type: 'string', description: 'IP address the activity came from' },
          timestamp: { type: 'string', description: 'Unix timestamp of the activity, in seconds' },
        },
      },
    },
  },
}
