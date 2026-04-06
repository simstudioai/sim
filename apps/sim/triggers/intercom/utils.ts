import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Dropdown options for the Intercom trigger type selector.
 */
export const intercomTriggerOptions = [
  { label: 'Conversation Created', id: 'intercom_conversation_created' },
  { label: 'Conversation Reply', id: 'intercom_conversation_reply' },
  { label: 'Conversation Closed', id: 'intercom_conversation_closed' },
  { label: 'Contact Created', id: 'intercom_contact_created' },
  { label: 'User Created', id: 'intercom_user_created' },
  { label: 'All Events', id: 'intercom_webhook' },
]

/**
 * Generates HTML setup instructions for Intercom webhook triggers.
 */
export function intercomSetupInstructions(eventType: string): string {
  const instructions = [
    'Copy the <strong>Webhook URL</strong> above.',
    'Go to your <a href="https://app.intercom.com/a/apps/_/developer-hub" target="_blank" rel="noopener noreferrer">Intercom Developer Hub</a>.',
    'Select your app, then go to <strong>Webhooks</strong>.',
    'Paste the webhook URL into the <strong>Endpoint URL</strong> field.',
    `Select the <strong>${eventType}</strong> topic(s).`,
    "Copy your app's <strong>Client Secret</strong> from the app's <strong>Basic Information</strong> page and paste it into the <strong>Webhook Secret</strong> field above (recommended for security).",
    'Save the webhook configuration.',
    'Deploy your workflow to activate the trigger.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * Extra fields for Intercom triggers (webhook secret for signature verification).
 */
export function buildIntercomExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'webhookSecret',
      title: 'Webhook Secret',
      type: 'short-input',
      placeholder: 'Enter your Intercom app Client Secret',
      description:
        "Your app's Client Secret from the Developer Hub. Used to verify webhook authenticity via X-Hub-Signature.",
      password: true,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

/**
 * Maps trigger IDs to the Intercom webhook topics they should match.
 */
export const INTERCOM_TRIGGER_TOPIC_MAP: Record<string, string[]> = {
  intercom_conversation_created: ['conversation.user.created', 'conversation.admin.single.created'],
  intercom_conversation_reply: ['conversation.user.replied', 'conversation.admin.replied'],
  intercom_conversation_closed: ['conversation.admin.closed'],
  intercom_contact_created: ['contact.created'],
  intercom_user_created: ['user.created'],
  intercom_webhook: [], // Empty = accept all events
}

/**
 * Checks if an Intercom webhook event matches the configured trigger.
 */
export function isIntercomEventMatch(triggerId: string, topic: string): boolean {
  const allowedTopics = INTERCOM_TRIGGER_TOPIC_MAP[triggerId]
  if (allowedTopics === undefined) return false
  if (allowedTopics.length === 0) {
    return true
  }
  return allowedTopics.includes(topic)
}

/**
 * Shared base outputs for all Intercom webhook triggers.
 */
function buildIntercomBaseOutputs(dataDescription: string): Record<string, TriggerOutput> {
  return {
    topic: { type: 'string', description: 'The webhook topic (e.g., conversation.user.created)' },
    id: { type: 'string', description: 'Unique notification ID' },
    app_id: { type: 'string', description: 'Your Intercom app ID' },
    created_at: { type: 'number', description: 'Unix timestamp when the event occurred' },
    delivery_attempts: {
      type: 'number',
      description: 'Number of delivery attempts for this notification',
    },
    first_sent_at: {
      type: 'number',
      description: 'Unix timestamp of first delivery attempt',
    },
    data: { type: 'json', description: dataDescription },
  } as Record<string, TriggerOutput>
}

/**
 * Build outputs for Intercom conversation triggers.
 */
export function buildIntercomConversationOutputs(): Record<string, TriggerOutput> {
  return buildIntercomBaseOutputs(
    'Event data containing the conversation object. Access via data.item for conversation details including id, state, open, assignee, contacts, conversation_parts, tags, and source'
  )
}

/**
 * Build outputs for Intercom contact triggers.
 */
export function buildIntercomContactOutputs(): Record<string, TriggerOutput> {
  return buildIntercomBaseOutputs(
    'Event data containing the contact object. Access via data.item for contact details including id, role, email, name, phone, external_id, custom_attributes, location, avatar, tags, companies, and timestamps'
  )
}

/**
 * Build outputs for the generic Intercom webhook trigger.
 */
export function buildIntercomGenericOutputs(): Record<string, TriggerOutput> {
  return buildIntercomBaseOutputs(
    'Event data containing the affected object. Access via data.item for the resource (conversation, contact, company, ticket, etc.)'
  )
}
