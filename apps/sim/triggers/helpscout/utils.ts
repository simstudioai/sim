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
  nullable: true,
  description: 'Person object (id, type, first, last, email)',
} as const

const CONVERSATION_OUTPUTS: Record<string, TriggerOutput> = {
  id: { type: 'number', description: 'Conversation ID', nullable: true },
  number: {
    type: 'number',
    description: 'Conversation number shown in Help Scout',
    nullable: true,
  },
  threadCount: {
    type: 'number',
    description: 'Number of published threads, excluding notes',
    nullable: true,
  },
  type: { type: 'string', description: 'email, chat, or phone', nullable: true },
  folderId: { type: 'number', description: 'Folder ID', nullable: true },
  status: { type: 'string', description: 'active, pending, closed, or spam', nullable: true },
  state: { type: 'string', description: 'published, draft, or deleted', nullable: true },
  subject: { type: 'string', description: 'Subject', nullable: true },
  preview: {
    type: 'string',
    description: 'Preview text from the most recent thread',
    nullable: true,
  },
  mailboxId: { type: 'number', description: 'Inbox ID', nullable: true },
  assignee: { ...PERSON_OUTPUT, description: 'User or team the conversation is assigned to' },
  createdBy: { ...PERSON_OUTPUT, description: 'User or customer who created the conversation' },
  primaryCustomer: { ...PERSON_OUTPUT, description: 'Primary customer of the conversation' },
  createdAt: { type: 'string', description: 'When the conversation was created', nullable: true },
  closedAt: { type: 'string', description: 'When the conversation was closed', nullable: true },
  closedBy: { type: 'number', description: 'ID of the user who closed it', nullable: true },
  userUpdatedAt: {
    type: 'string',
    description: 'When a user last updated the conversation',
    nullable: true,
  },
  customerWaitingSince: {
    type: 'string',
    description: 'When the customer started waiting for a reply',
    nullable: true,
  },
  sourceType: { type: 'string', description: 'Originating channel', nullable: true },
  sourceVia: { type: 'string', description: 'user or customer', nullable: true },
  tags: { type: 'array', description: 'Tags on the conversation (id, tag, color)' },
  cc: { type: 'array', description: 'CC email addresses' },
  bcc: { type: 'array', description: 'BCC email addresses' },
  customFields: { type: 'array', description: 'Custom field values (id, name, value, text)' },
  webUrl: { type: 'string', description: 'Link to the conversation in Help Scout', nullable: true },
}

const CUSTOMER_OUTPUTS: Record<string, TriggerOutput> = {
  id: { type: 'number', description: 'Customer ID', nullable: true },
  firstName: { type: 'string', description: 'First name', nullable: true },
  lastName: { type: 'string', description: 'Last name', nullable: true },
  gender: { type: 'string', description: 'Gender', nullable: true },
  jobTitle: { type: 'string', description: 'Job title', nullable: true },
  location: { type: 'string', description: 'Location', nullable: true },
  organization: { type: 'string', description: 'Organization name', nullable: true },
  organizationId: { type: 'number', description: 'Organization ID', nullable: true },
  photoType: { type: 'string', description: 'Photo source', nullable: true },
  photoUrl: { type: 'string', description: 'Photo URL', nullable: true },
  age: { type: 'string', description: 'Age', nullable: true },
  background: { type: 'string', description: 'Notes about the customer', nullable: true },
  conversationCount: { type: 'number', description: 'Number of conversations', nullable: true },
  draft: { type: 'boolean', description: 'Whether the customer is a draft record', nullable: true },
  createdAt: { type: 'string', description: 'When the customer was created', nullable: true },
  updatedAt: { type: 'string', description: 'When the customer was updated', nullable: true },
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
    conversationId: { type: 'number', description: 'Conversation ID', nullable: true },
    conversation: CONVERSATION_OUTPUTS,
    payload: { type: 'json', description: 'Raw Help Scout webhook payload' },
  }
}

export function buildConversationDeletedOutputs(): Record<string, TriggerOutput> {
  return {
    eventType: EVENT_TYPE_OUTPUT,
    conversationId: {
      type: 'number',
      description: 'ID of the deleted conversation',
      nullable: true,
    },
    payload: { type: 'json', description: 'Raw Help Scout webhook payload' },
  }
}

export function buildCustomerEventOutputs(): Record<string, TriggerOutput> {
  return {
    eventType: EVENT_TYPE_OUTPUT,
    customerId: { type: 'number', description: 'Customer ID', nullable: true },
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
