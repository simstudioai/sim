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
    'Paste the same <strong>verification_token</strong> into the <strong>Webhook Secret</strong> field above to enable signature verification on incoming events.',
    'Ensure the integration has access to the pages/databases you want to monitor (share them with the integration).',
  ]

  if (eventType === 'comment.created') {
    instructions.splice(
      7,
      0,
      'Enable the <strong>comment read</strong> capability in your Notion integration settings so comment events can be delivered.'
    )
  }

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
      placeholder: 'Enter your Notion verification_token',
      description:
        'The verification_token sent by Notion during webhook setup. This same token is used to verify X-Notion-Signature HMAC headers on all subsequent webhook deliveries.',
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
    api_version: { type: 'string', description: 'Notion API version included with the event' },
    workspace_id: { type: 'string', description: 'Workspace ID where the event occurred' },
    workspace_name: { type: 'string', description: 'Workspace name' },
    subscription_id: { type: 'string', description: 'Webhook subscription ID' },
    integration_id: { type: 'string', description: 'Integration ID that received the event' },
    attempt_number: {
      type: 'number',
      description: 'Delivery attempt number (1-8 per Notion retries)',
    },
    accessible_by: {
      type: 'array',
      description:
        'Users and bots with access to the entity (`id` + `type` per object); `type` is `person` or `bot`. Omitted on some deliveries (treat as empty).',
    },
  }
}

/**
 * Entity output schema (the resource that was affected).
 */
function buildEntityOutputs(): Record<string, TriggerOutput> {
  return {
    id: {
      type: 'string',
      description: 'Entity ID (page, database, block, comment, or data source ID)',
    },
    entity_type: {
      type: 'string',
      description: 'Entity type: `page`, `database`, `block`, `comment`, or `data_source`',
    },
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
      description:
        'Actors who triggered the event (`id` + `type` per object); `type` is `person`, `bot`, or `agent` per Notion',
    },
    entity: buildEntityOutputs(),
    data: {
      updated_blocks: {
        type: 'array',
        description: 'Blocks updated as part of the event, when provided by Notion',
      },
      updated_properties: {
        type: 'array',
        description: 'Property IDs updated as part of the event, when provided by Notion',
      },
      parent: {
        id: {
          type: 'string',
          description: 'Parent page, database, workspace (space), or block ID',
        },
        parent_type: {
          type: 'string',
          description: 'Parent type: `page`, `database`, `block`, `workspace`, or `space`',
        },
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
      description:
        'Actors who triggered the event (`id` + `type` per object); `type` is `person`, `bot`, or `agent` per Notion',
    },
    entity: buildEntityOutputs(),
    data: {
      updated_blocks: {
        type: 'array',
        description: 'Blocks updated as part of the event, when provided by Notion',
      },
      updated_properties: {
        type: 'array',
        description: 'Database properties updated as part of the event, when provided by Notion',
      },
      parent: {
        id: { type: 'string', description: 'Parent page, database, workspace, or space ID' },
        parent_type: {
          type: 'string',
          description: 'Parent type: `page`, `database`, `workspace`, or `space`',
        },
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
      description:
        'Actors who triggered the event (`id` + `type` per object); `type` is `person`, `bot`, or `agent` per Notion',
    },
    entity: {
      id: { type: 'string', description: 'Comment ID' },
      entity_type: { type: 'string', description: 'Entity type (comment)' },
    },
    data: {
      page_id: { type: 'string', description: 'Page ID that owns the comment thread' },
      parent: {
        id: { type: 'string', description: 'Parent page or block ID' },
        parent_type: { type: 'string', description: 'Parent type (page or block)' },
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
      description:
        'Actors who triggered the event (`id` + `type` per object); `type` is `person`, `bot`, or `agent` per Notion',
    },
    entity: buildEntityOutputs(),
    data: {
      parent: {
        id: { type: 'string', description: 'Parent entity ID, when provided by Notion' },
        parent_type: {
          type: 'string',
          description:
            'Parent type (`page`, `database`, `block`, `workspace`, `space`, …), when present',
        },
      },
      page_id: { type: 'string', description: 'Page ID related to the event, when present' },
      updated_blocks: {
        type: 'array',
        description: 'Blocks updated as part of the event, when provided by Notion',
      },
      updated_properties: {
        type: 'array',
        description: 'Updated properties included with the event, when provided by Notion',
      },
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
  notion_database_schema_updated: ['database.schema_updated', 'data_source.schema_updated'],
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
