import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Shared trigger dropdown options for all Zendesk triggers
 */
export const zendeskTriggerOptions = [
  { label: 'Ticket Created', id: 'zendesk_ticket_created' },
  { label: 'Ticket Status Changed', id: 'zendesk_ticket_status_changed' },
  { label: 'Ticket Comment Added', id: 'zendesk_ticket_comment_added' },
  { label: 'Ticket Priority Changed', id: 'zendesk_ticket_priority_changed' },
  { label: 'All Ticket Events', id: 'zendesk_webhook' },
]

/**
 * Maps each Zendesk trigger to the native event-subscription `type` it listens for.
 * `zendesk_webhook` is intentionally absent — it matches every ticket event.
 */
const TRIGGER_EVENT_TYPES: Record<string, string> = {
  zendesk_ticket_created: 'zen:event-type:ticket.created',
  zendesk_ticket_status_changed: 'zen:event-type:ticket.status_changed',
  zendesk_ticket_comment_added: 'zen:event-type:ticket.comment_added',
  zendesk_ticket_priority_changed: 'zen:event-type:ticket.priority_changed',
}

/**
 * Generate setup instructions for a specific Zendesk ticket event.
 */
export function zendeskSetupInstructions(eventLabel: string): string {
  const instructions = [
    'In Zendesk Admin Center, go to <strong>Apps and integrations &gt; Webhooks &gt; Webhooks</strong> and click <strong>Create webhook</strong>.',
    'Choose <strong>Connect with events</strong>, then select <strong>Ticket events</strong> as the source.',
    `Subscribe to the <strong>${eventLabel}</strong> event type.`,
    'Paste the <strong>Webhook URL</strong> above into the <strong>Endpoint URL</strong> field and save.',
    'Open the webhook and click <strong>Reveal secret</strong>, then paste it into the <strong>Signing Secret</strong> field above to verify deliveries.',
  ]
  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * Signing secret field used to verify the X-Zendesk-Webhook-Signature HMAC.
 */
export function buildZendeskExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'webhookSecret',
      title: 'Signing Secret',
      type: 'short-input',
      placeholder: 'Paste the webhook signing secret from Zendesk',
      description:
        'Validates that webhook deliveries originate from Zendesk (X-Zendesk-Webhook-Signature).',
      password: true,
      paramVisibility: 'user-only',
      required: false,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

/**
 * Output schema shared by every Zendesk ticket trigger — native
 * event-subscription deliveries share the same envelope and `detail` shape.
 */
export function buildZendeskTicketOutputs(): Record<string, TriggerOutput> {
  return {
    event_id: { type: 'string', description: 'Unique ID of the webhook event' },
    event_type: {
      type: 'string',
      description: 'Full event type (e.g. zen:event-type:ticket.created)',
    },
    time: { type: 'string', description: 'When the event occurred (ISO 8601)' },
    account_id: { type: 'number', description: 'Zendesk account ID' },
    ticket: {
      id: { type: 'string', description: 'Ticket ID' },
      subject: { type: 'string', description: 'Ticket subject' },
      status: { type: 'string', description: 'Ticket status (new, open, pending, solved, etc.)' },
      priority: { type: 'string', description: 'Ticket priority (low, normal, high, urgent)' },
      ticket_type: {
        type: 'string',
        description: 'Ticket type (question, incident, problem, task)',
      },
      description: { type: 'string', description: 'Ticket description' },
      requester_id: { type: 'string', description: 'ID of the requester' },
      assignee_id: { type: 'string', description: 'ID of the assignee' },
      group_id: { type: 'string', description: 'ID of the assigned group' },
      organization_id: { type: 'string', description: 'ID of the organization' },
      tags: { type: 'json', description: 'Array of ticket tags' },
      via_channel: { type: 'string', description: 'Channel the ticket came in through' },
      is_public: { type: 'boolean', description: 'Whether the ticket is public' },
      created_at: { type: 'string', description: 'Ticket creation timestamp' },
      updated_at: { type: 'string', description: 'Ticket last update timestamp' },
    },
    event: { type: 'json', description: 'Event-specific changed data (e.g. status/priority diff)' },
  }
}

/**
 * Returns true when an incoming event-subscription delivery matches the configured trigger.
 */
export function isZendeskEventMatch(triggerId: string, eventType: string): boolean {
  const expected = TRIGGER_EVENT_TYPES[triggerId]
  if (!expected) {
    return true
  }
  return expected === eventType
}
