import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Dropdown options for the Notion trigger type selector.
 */
export const notionTriggerOptions = [
  { label: 'Page Created', id: 'notion_page_created' },
  { label: 'Page Properties Updated', id: 'notion_page_properties_updated' },
  { label: 'Page Content Updated', id: 'notion_page_content_updated' },
  { label: 'Page Deleted', id: 'notion_page_deleted' },
  { label: 'Database Created', id: 'notion_database_created' },
  { label: 'Database Schema Updated', id: 'notion_database_schema_updated' },
  { label: 'Database Deleted', id: 'notion_database_deleted' },
  { label: 'Comment Created', id: 'notion_comment_created' },
  { label: 'Generic Webhook (All Events)', id: 'notion_webhook' },
]

/**
 * Generates HTML setup instructions for Notion webhook triggers.
 * Notion webhooks must be configured manually through the integration settings UI.
 */
export function notionSetupInstructions(eventType: string): string {
  const instructions = [
    'Go to <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noopener noreferrer"><strong>notion.so/profile/integrations</strong></a> and select your integration (or create one).',
    'Navigate to the <strong>Webhooks</strong> tab.',
    'Click <strong>"Create a subscription"</strong>.',
    'Paste the <strong>Webhook URL</strong> above into the URL field.',
    `Select the <strong>${eventType}</strong> event type(s).`,
    'Notion will send a verification request. Copy the <strong>verification_token</strong> from the payload and paste it into the Notion UI to complete verification.',
    'Ensure the integration has access to the pages/databases you want to monitor (share them with the integration).',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * Extra fields for Notion triggers (no extra fields needed since setup is manual).
 */
export function buildNotionExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'webhookSecret',
      title: 'Webhook Secret',
      type: 'short-input',
      placeholder: 'Enter your Notion webhook signing secret',
      description:
        'The signing secret from your Notion integration settings page, used to verify X-Notion-Signature headers. This is separate from the verification_token used during initial setup.',
      password: true,
      required: false,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

/**
 * Base webhook outputs common to all Notion triggers.
 */
function buildBaseOutputs(): Record<string, TriggerOutput> {
  return {
    id: { type: 'string', description: 'Webhook event ID' },
    type: {
      type: 'string',
      description: 'Event type (e.g., page.created, database.schema_updated)',
    },
    timestamp: { type: 'string', description: 'ISO 8601 timestamp of the event' },
    workspace_id: { type: 'string', description: 'Workspace ID where the event occurred' },
    workspace_name: { type: 'string', description: 'Workspace name' },
    subscription_id: { type: 'string', description: 'Webhook subscription ID' },
    integration_id: { type: 'string', description: 'Integration ID that received the event' },
    attempt_number: { type: 'number', description: 'Delivery attempt number' },
  }
}

/**
 * Entity output schema (the resource that was affected).
 */
function buildEntityOutputs(): Record<string, TriggerOutput> {
  return {
    id: { type: 'string', description: 'Entity ID (page or database ID)' },
    entity_type: { type: 'string', description: 'Entity type (page or database)' },
  }
}

/**
 * Build outputs for page event triggers.
 */
export function buildPageEventOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseOutputs(),
    authors: {
      type: 'array',
      description: 'Array of users who triggered the event',
    },
    entity: buildEntityOutputs(),
    data: {
      parent: {
        id: { type: 'string', description: 'Parent page or database ID' },
        parent_type: { type: 'string', description: 'Parent type (database, page, workspace)' },
      },
    },
  }
}

/**
 * Build outputs for database event triggers.
 */
export function buildDatabaseEventOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseOutputs(),
    authors: {
      type: 'array',
      description: 'Array of users who triggered the event',
    },
    entity: buildEntityOutputs(),
    data: {
      parent: {
        id: { type: 'string', description: 'Parent page or workspace ID' },
        parent_type: { type: 'string', description: 'Parent type (page, workspace)' },
      },
    },
  }
}

/**
 * Build outputs for comment event triggers.
 */
export function buildCommentEventOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseOutputs(),
    authors: {
      type: 'array',
      description: 'Array of users who triggered the event',
    },
    entity: {
      id: { type: 'string', description: 'Comment ID' },
      entity_type: { type: 'string', description: 'Entity type (comment)' },
    },
    data: {
      parent: {
        id: { type: 'string', description: 'Parent page ID' },
        parent_type: { type: 'string', description: 'Parent type (page)' },
      },
    },
  }
}

/**
 * Build outputs for the generic webhook trigger (all events).
 */
export function buildGenericWebhookOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseOutputs(),
    authors: {
      type: 'array',
      description: 'Array of users who triggered the event',
    },
    entity: buildEntityOutputs(),
    data: {
      type: 'json',
      description: 'Event-specific data including parent information',
    },
  }
}

/**
 * Maps trigger IDs to the Notion event type strings they accept.
 */
const TRIGGER_EVENT_MAP: Record<string, string[]> = {
  notion_page_created: ['page.created'],
  notion_page_properties_updated: ['page.properties_updated'],
  notion_page_content_updated: ['page.content_updated'],
  notion_page_deleted: ['page.deleted'],
  notion_database_created: ['database.created'],
  notion_database_schema_updated: ['database.schema_updated'],
  notion_database_deleted: ['database.deleted'],
  notion_comment_created: ['comment.created'],
}

/**
 * Checks if a Notion webhook payload matches a trigger.
 */
export function isNotionPayloadMatch(triggerId: string, body: Record<string, unknown>): boolean {
  if (triggerId === 'notion_webhook') {
    return true
  }

  const eventType = body.type as string | undefined
  if (!eventType) {
    return false
  }

  const acceptedEvents = TRIGGER_EVENT_MAP[triggerId]
  return acceptedEvents ? acceptedEvents.includes(eventType) : false
}
