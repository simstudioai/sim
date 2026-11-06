import { getScopesForService } from '@/lib/oauth/utils'
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
  { label: 'All Events', id: HELPSCOUT_GENERIC_TRIGGER_ID },
]

/** Whether a delivery's event name is the one the configured trigger listens for. */
export function isHelpScoutEventMatch(triggerId: string, eventType: string): boolean {
  const expected = HELPSCOUT_TRIGGER_EVENTS[triggerId]
  return expected !== undefined && expected === eventType
}

/**
 * Help Scout events Sim subscribes to for a trigger. The catch-all trigger subscribes to every
 * event the specific triggers cover, so its deliveries share their documented payloads.
 */
export function getHelpScoutSubscriptionEvents(triggerId: string): string[] {
  if (triggerId === HELPSCOUT_GENERIC_TRIGGER_ID) return Object.values(HELPSCOUT_TRIGGER_EVENTS)
  const event = HELPSCOUT_TRIGGER_EVENTS[triggerId]
  return event ? [event] : []
}

/** Account and optional inbox fields shown above the webhook URL for every Help Scout trigger. */
export function buildHelpScoutTriggerFields(
  triggerId: string,
  options: { inboxFilter?: boolean } = {}
): SubBlockConfig[] {
  const condition = { field: 'selectedTriggerId', value: triggerId }
  const credentialField: SubBlockConfig = {
    id: 'triggerCredentials',
    title: 'Help Scout Account',
    type: 'oauth-input',
    description:
      'Sim creates the Help Scout webhook with this account and deletes it when the workflow is undeployed.',
    serviceId: 'helpscout',
    requiredScopes: getScopesForService('helpscout'),
    canonicalParamId: 'oauthCredential',
    placeholder: 'Select Help Scout account',
    required: true,
    mode: 'trigger',
    condition,
  }
  if (options.inboxFilter === false) return [credentialField]
  return [
    credentialField,
    {
      id: 'triggerMailboxSelector',
      title: 'Inbox',
      type: 'project-selector',
      canonicalParamId: 'triggerMailboxId',
      serviceId: 'helpscout',
      selectorKey: 'helpscout.mailboxes',
      placeholder: 'All inboxes',
      description:
        'Only receive events for conversations in this inbox. Leave empty for every inbox.',
      dependsOn: ['triggerCredentials'],
      mode: 'trigger',
      condition,
    },
    {
      id: 'triggerMailboxId',
      title: 'Inbox ID',
      type: 'short-input',
      canonicalParamId: 'triggerMailboxId',
      placeholder: 'Defaults to all inboxes',
      mode: 'trigger-advanced',
      condition,
    },
  ]
}

export function helpScoutSetupInstructions(eventLabel: string): string {
  const instructions = [
    'Connect your Help Scout account above. The trigger needs a Help Scout account connected through sign-in (OAuth), and that user needs the Access API permission; saved app credentials cannot create webhooks for triggers.',
    `Deploy the workflow. Sim creates a Help Scout webhook for ${eventLabel} with its own signing secret, and removes it when the workflow is undeployed.`,
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

function personOutput(role: string): TriggerOutput {
  return {
    type: 'json',
    nullable: true,
    description: `${role} (id, type, first, last, name, email)`,
  }
}

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
  assignee: personOutput('User or team the conversation is assigned to'),
  createdBy: personOutput('User or customer who created the conversation'),
  primaryCustomer: personOutput('Primary customer of the conversation'),
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
  snoozedUntil: {
    type: 'string',
    description: 'When the snooze ends, if the conversation is snoozed',
    nullable: true,
  },
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
