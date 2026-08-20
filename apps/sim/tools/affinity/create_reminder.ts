import type { AffinityCreateReminderParams, AffinityEntityResponse } from '@/tools/affinity/types'
import { REMINDER_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  optionalParam,
  requireId,
  requireOneOf,
  transformEntity,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

/** A reminder either fires once or resets on a signal. */
const REMINDER_TYPES = ['one-time', 'recurring'] as const

/** Entities a reminder can be tagged to. Exactly one is required. */
const REMINDER_ENTITY_TYPES = ['company', 'person', 'opportunity'] as const

/** What restarts the clock on a recurring reminder. */
const RESET_TRIGGERS = ['interaction', 'email', 'event'] as const

export const affinityCreateReminderTool: ToolConfig<
  AffinityCreateReminderParams,
  AffinityEntityResponse<Record<string, unknown>>
> = {
  id: 'affinity_create_reminder',
  name: 'Affinity Create Reminder',
  description:
    'Create a reminder on one company, person, or opportunity. A recurring reminder resets whenever the chosen signal happens instead of firing once.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'one-time to fire once, or recurring to reset on a signal',
    },
    entityType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'What the reminder is about: company, person, or opportunity',
    },
    entityId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of that company, person, or opportunity',
    },
    dueDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'When the reminder is due, as an ISO 8601 timestamp. Required for a one-time reminder; on a recurring one Affinity computes it from the period when omitted',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'What the reminder says',
    },
    ownerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'User the reminder is assigned to. Must be an internal user. The API key holder is recorded as the creator, which is a separate field',
    },
    resetTrigger: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'What restarts a recurring reminder: interaction, email, or event. Required when the type is recurring',
    },
    periodDays: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Days between firings of a recurring reminder. Required when the type is recurring',
    },
  },

  request: {
    url: () => buildAffinityUrl('/reminders'),
    method: 'POST',
    headers: (params) => affinityHeaders(params.apiKey, true),
    body: (params) => {
      const type = requireOneOf(params.type, REMINDER_TYPES, 'type')
      const body: Record<string, unknown> = {
        type,
        owner: { id: requireId(params.ownerId, 'ownerId') },
        entity: {
          type: requireOneOf(params.entityType, REMINDER_ENTITY_TYPES, 'entityType'),
          id: requireId(params.entityId, 'entityId'),
        },
      }

      const dueDate = optionalParam(params.dueDate)
      if (type === 'one-time' && !dueDate) {
        throw new Error('Affinity "dueDate" is required for a one-time reminder')
      }
      if (dueDate) body.dueDate = dueDate

      if (params.content) body.content = params.content

      if (type === 'recurring') {
        if (params.periodDays === undefined) {
          throw new Error('Affinity "periodDays" is required for a recurring reminder')
        }
        body.recurrence = {
          resetTrigger: requireOneOf(params.resetTrigger, RESET_TRIGGERS, 'resetTrigger'),
          periodDays: params.periodDays,
        }
      }

      return body
    },
  },

  transformResponse: transformEntity(),

  outputs: REMINDER_OUTPUT_PROPERTIES,
}
