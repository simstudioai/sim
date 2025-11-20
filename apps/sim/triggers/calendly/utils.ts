import type { TriggerOutput } from '@/triggers/types'

/**
 * Shared trigger dropdown options for all Calendly triggers
 */
export const calendlyTriggerOptions = [
  { label: 'Invitee Created', id: 'calendly_invitee_created' },
  { label: 'Invitee Canceled', id: 'calendly_invitee_canceled' },
  { label: 'Routing Form Submitted', id: 'calendly_routing_form_submitted' },
  { label: 'General Webhook (All Events)', id: 'calendly_webhook' },
]

/**
 * Generate setup instructions for a specific Calendly event type
 */
export function calendlySetupInstructions(eventType: string, additionalNotes?: string): string {
  const instructions = [
    '<strong>Note:</strong> Webhooks require a paid Calendly subscription (Professional, Teams, or Enterprise plan).',
    '<strong>Important:</strong> Calendly does not provide a UI for creating webhooks. You must create them programmatically using the API.',
    'Get your Calendly <strong>Personal Access Token</strong> from the Calendly dashboard under <strong>Integrations > API & Webhooks</strong>.',
    'In your workflow, add a Calendly block and select the <strong>"Create Webhook"</strong> operation.',
    'Enter your Personal Access Token in the Calendly block.',
    'Copy the <strong>Webhook URL</strong> shown above and paste it into the webhook URL field in the Create Webhook operation.',
    `Select the event types to monitor. For this trigger, select <strong>${eventType}</strong>.`,
    'Set the scope to <strong>Organization</strong> or <strong>User</strong> as needed (routing form submissions require organization scope).',
    'Run the workflow to create the webhook subscription. You can use the "List Webhooks" operation to verify it was created.',
  ]

  if (additionalNotes) {
    instructions.push(additionalNotes)
  }

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3">${index === 0 ? instruction : `<strong>${index}.</strong> ${instruction}`}</div>`
    )
    .join('')
}

/**
 * Shared tracking output schema
 */
export const trackingOutputs = {
  utm_campaign: {
    type: 'string',
    description: 'UTM campaign parameter',
  },
  utm_source: {
    type: 'string',
    description: 'UTM source parameter',
  },
  utm_medium: {
    type: 'string',
    description: 'UTM medium parameter',
  },
  utm_content: {
    type: 'string',
    description: 'UTM content parameter',
  },
  utm_term: {
    type: 'string',
    description: 'UTM term parameter',
  },
  salesforce_uuid: {
    type: 'string',
    description: 'Salesforce UUID',
  },
} as const

/**
 * Shared questions and answers output schema
 */
export const questionsAndAnswersOutputs = {
  type: 'array',
  description: 'Questions and answers from the booking form',
  items: {
    question: {
      type: 'string',
      description: 'Question text',
    },
    answer: {
      type: 'string',
      description: 'Answer text',
    },
  },
} as const

/**
 * Build output schema for invitee events
 */
export function buildInviteeOutputs(): Record<string, TriggerOutput> {
  return {
    event: {
      type: 'string',
      description: 'Event type (invitee.created or invitee.canceled)',
    },
    created_at: {
      type: 'string',
      description: 'Webhook event creation timestamp',
    },
    created_by: {
      type: 'string',
      description: 'URI of the Calendly user who created this webhook',
    },
    payload: {
      uri: {
        type: 'string',
        description: 'Invitee URI',
      },
      email: {
        type: 'string',
        description: 'Invitee email address',
      },
      name: {
        type: 'string',
        description: 'Invitee full name',
      },
      first_name: {
        type: 'string',
        description: 'Invitee first name',
      },
      last_name: {
        type: 'string',
        description: 'Invitee last name',
      },
      status: {
        type: 'string',
        description: 'Invitee status (active or canceled)',
      },
      timezone: {
        type: 'string',
        description: 'Invitee timezone',
      },
      event: {
        type: 'string',
        description: 'Scheduled event URI',
      },
      questions_and_answers: questionsAndAnswersOutputs,
      tracking: trackingOutputs,
      text_reminder_number: {
        type: 'string',
        description: 'Phone number for text reminders',
      },
      rescheduled: {
        type: 'boolean',
        description: 'Whether this invitee rescheduled',
      },
      old_invitee: {
        type: 'string',
        description: 'URI of the old invitee (if rescheduled)',
      },
      new_invitee: {
        type: 'string',
        description: 'URI of the new invitee (if rescheduled)',
      },
      cancel_url: {
        type: 'string',
        description: 'URL to cancel the event',
      },
      reschedule_url: {
        type: 'string',
        description: 'URL to reschedule the event',
      },
      created_at: {
        type: 'string',
        description: 'Invitee creation timestamp',
      },
      updated_at: {
        type: 'string',
        description: 'Invitee last update timestamp',
      },
      canceled: {
        type: 'boolean',
        description: 'Whether the event was canceled',
      },
      cancellation: {
        type: 'object',
        description: 'Cancellation details',
        properties: {
          canceled_by: {
            type: 'string',
            description: 'Who canceled the event',
          },
          reason: {
            type: 'string',
            description: 'Cancellation reason',
          },
        },
      },
      payment: {
        type: 'object',
        description: 'Payment details',
        properties: {
          id: {
            type: 'string',
            description: 'Payment ID',
          },
          provider: {
            type: 'string',
            description: 'Payment provider',
          },
          amount: {
            type: 'number',
            description: 'Payment amount',
          },
          currency: {
            type: 'string',
            description: 'Payment currency',
          },
          terms: {
            type: 'string',
            description: 'Payment terms',
          },
          successful: {
            type: 'boolean',
            description: 'Whether payment was successful',
          },
        },
      },
      no_show: {
        type: 'object',
        description: 'No-show details',
        properties: {
          created_at: {
            type: 'string',
            description: 'No-show marked timestamp',
          },
        },
      },
      reconfirmation: {
        type: 'object',
        description: 'Reconfirmation details',
        properties: {
          created_at: {
            type: 'string',
            description: 'Reconfirmation timestamp',
          },
          confirmed_at: {
            type: 'string',
            description: 'Confirmation timestamp',
          },
        },
      },
    },
  } as any
}

/**
 * Build output schema for routing form submission events
 */
export function buildRoutingFormOutputs(): Record<string, TriggerOutput> {
  return {
    event: {
      type: 'string',
      description: 'Event type (routing_form_submission.created)',
    },
    created_at: {
      type: 'string',
      description: 'Webhook event creation timestamp',
    },
    created_by: {
      type: 'string',
      description: 'URI of the Calendly user who created this webhook',
    },
    payload: {
      uri: {
        type: 'string',
        description: 'Routing form submission URI',
      },
      routing_form: {
        type: 'string',
        description: 'Routing form URI',
      },
      submitter: {
        type: 'object',
        description: 'Submitter details',
        properties: {
          uri: {
            type: 'string',
            description: 'Submitter URI',
          },
          email: {
            type: 'string',
            description: 'Submitter email address',
          },
          name: {
            type: 'string',
            description: 'Submitter full name',
          },
        },
      },
      submitter_type: {
        type: 'string',
        description: 'Type of submitter',
      },
      questions_and_answers: questionsAndAnswersOutputs,
      tracking: trackingOutputs,
      result: {
        type: 'object',
        description: 'Routing result details',
        properties: {
          type: {
            type: 'string',
            description: 'Result type (event_type, custom_message, or external_url)',
          },
          value: {
            type: 'string',
            description: 'Result value (event type URI, message, or URL)',
          },
        },
      },
      created_at: {
        type: 'string',
        description: 'Submission creation timestamp',
      },
      updated_at: {
        type: 'string',
        description: 'Submission last update timestamp',
      },
    },
  } as any
}

/**
 * Check if a Calendly event matches the expected trigger configuration
 */
export function isCalendlyEventMatch(triggerId: string, eventType: string): boolean {
  const eventMap: Record<string, string> = {
    calendly_invitee_created: 'invitee.created',
    calendly_invitee_canceled: 'invitee.canceled',
    calendly_routing_form_submitted: 'routing_form_submission.created',
  }

  const expectedEvent = eventMap[triggerId]
  if (!expectedEvent) {
    return true // Unknown trigger or general webhook, allow through
  }

  return expectedEvent === eventType
}
