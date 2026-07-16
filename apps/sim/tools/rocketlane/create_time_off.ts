import {
  mapTimeOff,
  ROCKETLANE_API_BASE,
  type RocketlaneTimeOffCreateParams,
  type RocketlaneTimeOffResponse,
  rocketlaneError,
  rocketlaneHeaders,
  TIME_OFF_OUTPUT_PROPERTIES,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneCreateTimeOffTool: ToolConfig<
  RocketlaneTimeOffCreateParams,
  RocketlaneTimeOffResponse
> = {
  id: 'rocketlane_create_time_off',
  name: 'Rocketlane Create Time-Off',
  description:
    'Create a time-off for a team member in Rocketlane. Holidays and weekends within the date range are automatically excluded from the duration.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    userId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'User ID of the team member taking the time-off (provide this or the user email)',
    },
    userEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email of the team member taking the time-off (provide this or the user ID)',
    },
    startDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Time-off start date in YYYY-MM-DD format',
    },
    endDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Time-off end date in YYYY-MM-DD format (on or after the start date)',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Type of the time-off: FULL_DAY, HALF_DAY, or CUSTOM',
    },
    durationInMinutes: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Duration in minutes per day; required when type is CUSTOM',
    },
    note: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Note or comment about the time-off',
    },
    notifyProjectOwners: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Notify project owners of projects the user is part of',
    },
    notifyUserIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'User IDs of additional users to notify about the time-off',
      items: { type: 'number' },
    },
    notifyUserEmails: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Emails of additional users to notify about the time-off',
      items: { type: 'string' },
    },
    includeFields: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional fields to include in the response: note, notifyUsers',
      items: { type: 'string' },
    },
    includeAllFields: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return all fields in the response',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${ROCKETLANE_API_BASE}/time-offs`)
      if (params.includeFields?.length) {
        url.searchParams.set('includeFields', params.includeFields.join(','))
      }
      if (params.includeAllFields != null) {
        url.searchParams.set('includeAllFields', String(params.includeAllFields))
      }
      return url.toString()
    },
    method: 'POST',
    headers: (params) => rocketlaneHeaders(params.apiKey),
    body: (params) => {
      const user: Record<string, unknown> = {}
      if (params.userId != null) user.userId = params.userId
      if (params.userEmail) user.emailId = params.userEmail
      const body: Record<string, unknown> = {
        user,
        startDate: params.startDate,
        endDate: params.endDate,
        type: params.type,
      }
      if (params.note) body.note = params.note
      if (params.durationInMinutes != null) body.durationInMinutes = params.durationInMinutes
      const others = [
        ...(params.notifyUserIds ?? []).map((userId) => ({ userId })),
        ...(params.notifyUserEmails ?? []).map((emailId) => ({ emailId })),
      ]
      if (params.notifyProjectOwners != null || others.length > 0) {
        const notifyUsers: Record<string, unknown> = {}
        if (params.notifyProjectOwners != null) {
          notifyUsers.projectOwners = params.notifyProjectOwners
        }
        if (others.length > 0) notifyUsers.others = others
        body.notifyUsers = notifyUsers
      }
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    const data = await response.json()
    return {
      success: true,
      output: { timeOff: mapTimeOff(data) },
    }
  },

  outputs: {
    timeOff: {
      type: 'object',
      description: 'The created time-off',
      properties: TIME_OFF_OUTPUT_PROPERTIES,
    },
  },
}
