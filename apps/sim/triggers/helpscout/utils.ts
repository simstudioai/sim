import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

export const HELPSCOUT_GENERIC_TRIGGER_ID = 'helpscout_webhook'

/** Trigger IDs mapped to the Help Scout event names they fire on (the `X-HelpScout-Event` header). */
const HELPSCOUT_TRIGGER_EVENTS: Record<string, string> = {
  helpscout_conversation_created: 'convo.created',
  helpscout_customer_replied: 'convo.customer.reply.created',
  helpscout_agent_replied: 'convo.agent.reply.created',
  helpscout_note_created: 'convo.note.created',
  helpscout_conversation_assigned: 'convo.assigned',
  helpscout_conversation_status_changed: 'convo.status',
  helpscout_conversation_tags_updated: 'convo.tags',
  helpscout_conversation_moved: 'convo.moved',
  helpscout_conversation_merged: 'convo.merged',
  helpscout_conversation_deleted: 'convo.deleted',
  helpscout_customer_created: 'customer.created',
  helpscout_customer_updated: 'customer.updated',
}

export const helpScoutTriggerOptions = [
  { label: 'Conversation Created', id: 'helpscout_conversation_created' },
  { label: 'Customer Replied', id: 'helpscout_customer_replied' },
  { label: 'Agent Replied', id: 'helpscout_agent_replied' },
  { label: 'Note Created', id: 'helpscout_note_created' },
  { label: 'Conversation Assigned', id: 'helpscout_conversation_assigned' },
  { label: 'Conversation Status Changed', id: 'helpscout_conversation_status_changed' },
  { label: 'Conversation Tags Updated', id: 'helpscout_conversation_tags_updated' },
  { label: 'Conversation Moved', id: 'helpscout_conversation_moved' },
  { label: 'Conversation Merged', id: 'helpscout_conversation_merged' },
  { label: 'Conversation Deleted', id: 'helpscout_conversation_deleted' },
  { label: 'Customer Created', id: 'helpscout_customer_created' },
  { label: 'Customer Updated', id: 'helpscout_customer_updated' },
  { label: 'All Selected Events', id: HELPSCOUT_GENERIC_TRIGGER_ID },
]

/** Whether a delivery's event name is the one the configured trigger listens for. */
export function isHelpScoutEventMatch(triggerId: string, eventType: string): boolean {
  const expected = HELPSCOUT_TRIGGER_EVENTS[triggerId]
  return expected !== undefined && expected === eventType
}

export function buildHelpScoutExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'webhookSecret',
      title: 'Secret Key',
      type: 'short-input',
      placeholder: 'Enter the secret key you set on the Help Scout webhook',
      description:
        'The same secret key (40 characters or fewer) entered in Help Scout. Sim rejects deliveries whose X-HelpScout-Signature does not match it.',
      password: true,
      required: true,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

export function helpScoutSetupInstructions(eventLabel: string): string {
  const instructions = [
    'Copy the <strong>Webhook URL</strong> above.',
    'In Help Scout, click the gear icon (Settings), go to <strong>Workspace &gt; Apps</strong>, and open the <strong>Webhooks</strong> app.',
    'Paste the Webhook URL into the <strong>Callback URL</strong> field.',
    'Enter a <strong>Secret Key</strong> of up to 40 characters and paste the same value into the Secret Key field above.',
    `Select ${eventLabel}, leave notification-only delivery off so Sim receives the full payload, and save the webhook.`,
    'Click "Save" above to activate your trigger.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

const PERSON_OUTPUT = {
  type: 'json',
  description: 'Person object (id, type, first, last, email)',
} as const

const CONVERSATION_OUTPUTS: Record<string, TriggerOutput> = {
  id: { type: 'number', description: 'Conversation ID' },
  number: { type: 'number', description: 'Conversation number shown in Help Scout' },
  threadCount: { type: 'number', description: 'Number of published threads, excluding notes' },
  type: { type: 'string', description: 'email, chat, or phone' },
  folderId: { type: 'number', description: 'Folder ID' },
  status: { type: 'string', description: 'active, pending, closed, or spam' },
  state: { type: 'string', description: 'published, draft, or deleted' },
  subject: { type: 'string', description: 'Subject' },
  preview: { type: 'string', description: 'Preview text from the most recent thread' },
  mailboxId: { type: 'number', description: 'Inbox ID' },
  assignee: { ...PERSON_OUTPUT, description: 'User or team the conversation is assigned to' },
  createdBy: { ...PERSON_OUTPUT, description: 'User or customer who created the conversation' },
  primaryCustomer: { ...PERSON_OUTPUT, description: 'Primary customer of the conversation' },
  createdAt: { type: 'string', description: 'When the conversation was created' },
  closedAt: { type: 'string', description: 'When the conversation was closed' },
  closedBy: { type: 'number', description: 'ID of the user who closed it' },
  userUpdatedAt: { type: 'string', description: 'When a user last updated the conversation' },
  customerWaitingSince: {
    type: 'string',
    description: 'When the customer started waiting for a reply',
  },
  sourceType: { type: 'string', description: 'Originating channel' },
  sourceVia: { type: 'string', description: 'user or customer' },
  tags: { type: 'array', description: 'Tags on the conversation (id, tag, color)' },
  cc: { type: 'array', description: 'CC email addresses' },
  bcc: { type: 'array', description: 'BCC email addresses' },
  customFields: { type: 'array', description: 'Custom field values (id, name, value, text)' },
  webUrl: { type: 'string', description: 'Link to the conversation in Help Scout' },
}

const CUSTOMER_OUTPUTS: Record<string, TriggerOutput> = {
  id: { type: 'number', description: 'Customer ID' },
  firstName: { type: 'string', description: 'First name' },
  lastName: { type: 'string', description: 'Last name' },
  gender: { type: 'string', description: 'Gender' },
  jobTitle: { type: 'string', description: 'Job title' },
  location: { type: 'string', description: 'Location' },
  organization: { type: 'string', description: 'Organization name' },
  organizationId: { type: 'number', description: 'Organization ID' },
  photoType: { type: 'string', description: 'Photo source' },
  photoUrl: { type: 'string', description: 'Photo URL' },
  age: { type: 'string', description: 'Age' },
  background: { type: 'string', description: 'Notes about the customer' },
  conversationCount: { type: 'number', description: 'Number of conversations' },
  draft: { type: 'boolean', description: 'Whether the customer is a draft record' },
  createdAt: { type: 'string', description: 'When the customer was created' },
  updatedAt: { type: 'string', description: 'When the customer was updated' },
  emails: { type: 'array', description: 'Email addresses (id, value, type)' },
  phones: { type: 'array', description: 'Phone numbers (id, value, type)' },
  websites: { type: 'array', description: 'Websites (id, value, type)' },
  socialProfiles: { type: 'array', description: 'Social profiles (id, value, type)' },
  chats: { type: 'array', description: 'Chat handles (id, value, type)' },
  properties: { type: 'array', description: 'Customer property values' },
}

const EVENT_TYPE_OUTPUT: TriggerOutput = {
  type: 'string',
  description: 'Help Scout event name, e.g. convo.created',
}

export function buildConversationEventOutputs(): Record<string, TriggerOutput> {
  return {
    eventType: EVENT_TYPE_OUTPUT,
    conversationId: { type: 'number', description: 'Conversation ID' },
    conversation: CONVERSATION_OUTPUTS,
    payload: { type: 'json', description: 'Raw Help Scout webhook payload' },
  }
}

export function buildConversationDeletedOutputs(): Record<string, TriggerOutput> {
  return {
    eventType: EVENT_TYPE_OUTPUT,
    conversationId: { type: 'number', description: 'ID of the deleted conversation' },
    payload: { type: 'json', description: 'Raw Help Scout webhook payload' },
  }
}

export function buildCustomerEventOutputs(): Record<string, TriggerOutput> {
  return {
    eventType: EVENT_TYPE_OUTPUT,
    customerId: { type: 'number', description: 'Customer ID' },
    customer: CUSTOMER_OUTPUTS,
    payload: { type: 'json', description: 'Raw Help Scout webhook payload' },
  }
}

export function buildGenericWebhookOutputs(): Record<string, TriggerOutput> {
  return {
    eventType: EVENT_TYPE_OUTPUT,
    payload: { type: 'json', description: 'Raw Help Scout webhook payload' },
  }
}
