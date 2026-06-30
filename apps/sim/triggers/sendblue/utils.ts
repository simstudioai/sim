import type { TriggerOutput } from '@/triggers/types'

export const sendblueTriggerOptions = [
  { label: 'Message Received', id: 'sendblue_message_received' },
  { label: 'Message Status Updated', id: 'sendblue_message_status_updated' },
]

export function sendblueSetupInstructions(eventType: string): string {
  const instructions = [
    'Copy the <strong>Webhook URL</strong> above.',
    'Open your <a href="https://dashboard.sendblue.com" target="_blank" rel="noopener noreferrer">Sendblue dashboard</a> and go to <strong>Settings &gt; Webhooks</strong>.',
    eventType === 'Message Received'
      ? 'Paste the Webhook URL into the <strong>Receive Webhook</strong> field to receive inbound messages.'
      : 'Paste the Webhook URL into the <strong>Send / Status Webhook</strong> field to receive outbound message status updates. You can also pass it per-message as the <code>status_callback</code> parameter.',
    'Save your webhook settings in Sendblue.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * Outputs shared by both Sendblue message webhooks. Inbound and outbound
 * status callbacks use the same payload schema.
 */
export function buildSendblueOutputs(): Record<string, TriggerOutput> {
  return {
    account_email: { type: 'string', description: 'Email of the Sendblue account' },
    content: { type: 'string', description: 'Message text content' },
    media_url: { type: 'string', description: 'CDN link to attached media, if any' },
    is_outbound: { type: 'boolean', description: 'True for outbound messages, false for inbound' },
    status: {
      type: 'string',
      description: 'Message status (e.g., RECEIVED, QUEUED, SENT, DELIVERED, ERROR)',
    },
    error_code: { type: 'number', description: 'Error identifier, null if none' },
    error_message: { type: 'string', description: 'Descriptive error text, null if none' },
    error_reason: { type: 'string', description: 'Additional error context, null if none' },
    error_detail: { type: 'string', description: 'Detailed error information, null if none' },
    message_handle: {
      type: 'string',
      description: 'Sendblue message identifier (use to deduplicate)',
    },
    date_sent: { type: 'string', description: 'ISO 8601 creation timestamp' },
    date_updated: { type: 'string', description: 'ISO 8601 last-update timestamp' },
    from_number: { type: 'string', description: 'E.164 sender phone number' },
    number: { type: 'string', description: 'E.164 recipient/counterparty phone number' },
    to_number: { type: 'string', description: 'E.164 destination phone number' },
    was_downgraded: {
      type: 'boolean',
      description: 'True if the recipient lacks iMessage support',
    },
    plan: { type: 'string', description: 'Account plan type' },
    message_type: { type: 'string', description: 'Message category (e.g., message, group)' },
    group_id: { type: 'string', description: 'Group identifier, null for non-group messages' },
    participants: { type: 'array', description: 'Participant phone numbers for group messages' },
    send_style: { type: 'string', description: 'Expressive style if applied' },
    opted_out: { type: 'boolean', description: 'True if the recipient has opted out' },
    sendblue_number: { type: 'string', description: 'Sendblue phone number used' },
    service: { type: 'string', description: 'Messaging service (iMessage or SMS)' },
    group_display_name: {
      type: 'string',
      description: 'Group chat name, null for non-group messages',
    },
    sender_email: { type: 'string', description: 'Email of the user who sent the message' },
    seat_id: { type: 'string', description: 'Seat UUID, null if absent' },
    raw: {
      type: 'string',
      description: 'Complete raw webhook payload from Sendblue as a JSON string',
    },
  }
}
