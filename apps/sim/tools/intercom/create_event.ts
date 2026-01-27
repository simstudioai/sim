import { createLogger } from '@sim/logger'
import { buildIntercomUrl, handleIntercomError } from '@/tools/intercom/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('IntercomCreateEvent')

export interface IntercomCreateEventParams {
  accessToken: string
  event_name: string
  created_at?: number
  user_id?: string
  email?: string
  id?: string
  metadata?: string
}

export interface IntercomCreateEventV2Response {
  success: boolean
  output: {
    accepted: boolean
  }
}

const createEventBase = {
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Intercom API access token',
    },
    event_name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The name of the event (e.g., "order-completed"). Use past-tense verb-noun format for readability.',
    },
    created_at: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Unix timestamp for when the event occurred. Strongly recommended for uniqueness.',
    },
    user_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Your identifier for the user (external_id)',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Email address of the user. Use only if your app uses email to uniquely identify users.',
    },
    id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The Intercom contact ID',
    },
    metadata: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object with up to 10 metadata key-value pairs about the event (e.g., {"order_value": 99.99})',
    },
  },

  request: {
    url: () => buildIntercomUrl('/events'),
    method: 'POST',
    headers: (params: IntercomCreateEventParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
      'Intercom-Version': '2.14',
    }),
    body: (params: IntercomCreateEventParams) => {
      const payload: any = {
        event_name: params.event_name,
      }

      if (params.created_at) {
        payload.created_at = params.created_at
      } else {
        payload.created_at = Math.floor(Date.now() / 1000)
      }

      if (params.user_id) {
        payload.user_id = params.user_id
      }

      if (params.email) {
        payload.email = params.email
      }

      if (params.id) {
        payload.id = params.id
      }

      if (params.metadata) {
        try {
          payload.metadata = JSON.parse(params.metadata)
        } catch (error) {
          logger.warn('Failed to parse metadata, ignoring', { error })
        }
      }

      return payload
    },
  },
} satisfies Pick<ToolConfig<IntercomCreateEventParams, any>, 'params' | 'request'>

export const intercomCreateEventV2Tool: ToolConfig<
  IntercomCreateEventParams,
  IntercomCreateEventV2Response
> = {
  ...createEventBase,
  id: 'intercom_create_event_v2',
  name: 'Create Event in Intercom',
  description: 'Track a custom event for a contact in Intercom',
  version: '2.0.0',

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const data = await response.json()
      handleIntercomError(data, response.status, 'create_event')
    }

    return {
      success: true,
      output: {
        accepted: true,
      },
    }
  },

  outputs: {
    accepted: {
      type: 'boolean',
      description: 'Whether the event was accepted (202 Accepted)',
    },
  },
}
