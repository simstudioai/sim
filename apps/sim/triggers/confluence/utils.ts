import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

export const confluenceTriggerOptions = [
  { label: 'Page Created', id: 'confluence_page_created' },
  { label: 'Page Updated', id: 'confluence_page_updated' },
  { label: 'Page Removed', id: 'confluence_page_removed' },
  { label: 'Page Moved', id: 'confluence_page_moved' },
  { label: 'Comment Created', id: 'confluence_comment_created' },
  { label: 'Comment Removed', id: 'confluence_comment_removed' },
  { label: 'Blog Post Created', id: 'confluence_blog_created' },
  { label: 'Blog Post Updated', id: 'confluence_blog_updated' },
  { label: 'Blog Post Removed', id: 'confluence_blog_removed' },
  { label: 'Attachment Created', id: 'confluence_attachment_created' },
  { label: 'Attachment Removed', id: 'confluence_attachment_removed' },
  { label: 'Space Created', id: 'confluence_space_created' },
  { label: 'Space Updated', id: 'confluence_space_updated' },
  { label: 'Label Added', id: 'confluence_label_added' },
  { label: 'Label Removed', id: 'confluence_label_removed' },
  { label: 'Generic Webhook (All Events)', id: 'confluence_webhook' },
]

export function confluenceSetupInstructions(eventType: string): string {
  const instructions = [
    '<strong>Note:</strong> You must have admin permissions in your Confluence workspace to create webhooks. See the <a href="https://developer.atlassian.com/cloud/confluence/modules/webhook/" target="_blank" rel="noopener noreferrer">Confluence webhook documentation</a> for details.',
    'In Confluence, navigate to <strong>Settings > Webhooks</strong>.',
    'Click <strong>"Create a Webhook"</strong> to add a new webhook.',
    'Paste the <strong>Webhook URL</strong> from above into the URL field.',
    'Optionally, enter the <strong>Webhook Secret</strong> from above into the secret field for added security.',
    `Select the events you want to trigger this workflow. For this trigger, select <strong>${eventType}</strong>.`,
    'Click <strong>"Create"</strong> to activate the webhook.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3">${index === 0 ? instruction : `<strong>${index}.</strong> ${instruction}`}</div>`
    )
    .join('')
}

export function buildConfluenceExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'webhookSecret',
      title: 'Webhook Secret',
      type: 'short-input',
      placeholder: 'Enter a strong secret',
      description:
        'Optional secret to validate webhook deliveries from Confluence using HMAC signature',
      password: true,
      required: false,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'confluenceDomain',
      title: 'Confluence Domain',
      type: 'short-input',
      placeholder: 'your-company.atlassian.net',
      description: 'Your Confluence Cloud domain',
      required: false,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

export function buildConfluenceAttachmentExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    ...buildConfluenceExtraFields(triggerId),
    {
      id: 'confluenceEmail',
      title: 'Confluence Email',
      type: 'short-input',
      placeholder: 'user@example.com',
      description:
        'Your Atlassian account email. Required together with API token to download attachment files.',
      required: false,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'confluenceApiToken',
      title: 'API Token',
      type: 'short-input',
      placeholder: 'Enter your Atlassian API token',
      description:
        'API token from https://id.atlassian.com/manage-profile/security/api-tokens. Required to download attachment file content.',
      password: true,
      required: false,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'includeFileContent',
      title: 'Include File Content',
      type: 'switch',
      defaultValue: false,
      description:
        'Download and include actual file content from attachments. Requires email, API token, and domain.',
      required: false,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

/**
 * Base webhook outputs common to all Confluence triggers.
 */
function buildBaseWebhookOutputs(): Record<string, TriggerOutput> {
  return {
    timestamp: {
      type: 'number',
      description: 'Timestamp of the webhook event (Unix epoch milliseconds)',
    },
    userAccountId: {
      type: 'string',
      description: 'Account ID of the user who triggered the event',
    },
    accountType: {
      type: 'string',
      description: 'Account type (e.g., customer)',
    },
  }
}

/**
 * Shared content-entity output fields present on page, blog, comment, and attachment objects.
 */
function buildContentEntityFields(): Record<string, TriggerOutput> {
  return {
    id: { type: 'number', description: 'Content ID' },
    title: { type: 'string', description: 'Content title' },
    contentType: {
      type: 'string',
      description: 'Content type (page, blogpost, comment, attachment)',
    },
    version: { type: 'number', description: 'Version number' },
    spaceKey: { type: 'string', description: 'Space key the content belongs to' },
    creatorAccountId: { type: 'string', description: 'Account ID of the creator' },
    lastModifierAccountId: { type: 'string', description: 'Account ID of the last modifier' },
    self: { type: 'string', description: 'URL link to the content' },
    creationDate: { type: 'number', description: 'Creation timestamp (Unix epoch milliseconds)' },
    modificationDate: {
      type: 'number',
      description: 'Last modification timestamp (Unix epoch milliseconds)',
    },
  }
}

/** Page-related outputs for page events. */
export function buildPageOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    page: buildContentEntityFields(),
  }
}

/** Comment-related outputs for comment events. */
export function buildCommentOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    comment: {
      ...buildContentEntityFields(),
      parent: {
        id: { type: 'number', description: 'Parent page/blog ID' },
        title: { type: 'string', description: 'Parent page/blog title' },
        contentType: { type: 'string', description: 'Parent content type (page or blogpost)' },
        spaceKey: { type: 'string', description: 'Space key of the parent' },
        self: { type: 'string', description: 'URL link to the parent content' },
      },
    },
  }
}

/** Blog post outputs for blog events. */
export function buildBlogOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    blog: buildContentEntityFields(),
  }
}

/** Attachment-related outputs for attachment events. */
export function buildAttachmentOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    attachment: {
      ...buildContentEntityFields(),
      mediaType: { type: 'string', description: 'MIME type of the attachment' },
      fileSize: { type: 'number', description: 'File size in bytes' },
      parent: {
        id: { type: 'number', description: 'Container page/blog ID' },
        title: { type: 'string', description: 'Container page/blog title' },
        contentType: { type: 'string', description: 'Container content type' },
      },
    },
    files: {
      type: 'file[]',
      description:
        'Attachment file content downloaded from Confluence (if includeFileContent is enabled with credentials)',
    },
  }
}

/** Space-related outputs for space events. */
export function buildSpaceOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    space: {
      key: { type: 'string', description: 'Space key' },
      name: { type: 'string', description: 'Space name' },
      self: { type: 'string', description: 'URL link to the space' },
    },
  }
}

/** Label-related outputs for label events. */
export function buildLabelOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    label: {
      name: { type: 'string', description: 'Label name' },
      id: { type: 'string', description: 'Label ID' },
      prefix: { type: 'string', description: 'Label prefix (global, my, team)' },
    },
    content: {
      id: { type: 'number', description: 'Content ID the label was added to or removed from' },
      title: { type: 'string', description: 'Content title' },
      contentType: { type: 'string', description: 'Content type (page, blogpost)' },
    },
  }
}

/** Combined outputs for the generic webhook trigger (all events). */
export function buildGenericWebhookOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    page: { type: 'json', description: 'Page object (present in page events)' },
    comment: { type: 'json', description: 'Comment object (present in comment events)' },
    blog: { type: 'json', description: 'Blog post object (present in blog events)' },
    attachment: { type: 'json', description: 'Attachment object (present in attachment events)' },
    space: { type: 'json', description: 'Space object (present in space events)' },
    label: { type: 'json', description: 'Label object (present in label events)' },
    content: { type: 'json', description: 'Content object (present in label events)' },
    files: {
      type: 'file[]',
      description:
        'Attachment file content (present in attachment events when includeFileContent is enabled)',
    },
  }
}

export function extractPageData(body: any) {
  return {
    timestamp: body.timestamp,
    userAccountId: body.userAccountId,
    accountType: body.accountType,
    page: body.page || {},
  }
}

export function extractCommentData(body: any) {
  return {
    timestamp: body.timestamp,
    userAccountId: body.userAccountId,
    accountType: body.accountType,
    comment: body.comment || {},
  }
}

export function extractBlogData(body: any) {
  return {
    timestamp: body.timestamp,
    userAccountId: body.userAccountId,
    accountType: body.accountType,
    blog: body.blog || body.blogpost || {},
  }
}

export function extractAttachmentData(body: any) {
  return {
    timestamp: body.timestamp,
    userAccountId: body.userAccountId,
    accountType: body.accountType,
    attachment: body.attachment || {},
  }
}

export function extractSpaceData(body: any) {
  return {
    timestamp: body.timestamp,
    userAccountId: body.userAccountId,
    accountType: body.accountType,
    space: body.space || {},
  }
}

export function extractLabelData(body: any) {
  return {
    timestamp: body.timestamp,
    userAccountId: body.userAccountId,
    accountType: body.accountType,
    label: body.label || {},
    content: body.content || body.page || body.blog || {},
  }
}

/**
 * Maps trigger IDs to the exact Confluence event strings they accept.
 * Admin REST API webhooks include an `event` field (e.g. `"event": "page_created"`).
 * Connect app webhooks do NOT — for those we fall back to entity-category matching.
 */
const TRIGGER_EVENT_MAP: Record<string, string[]> = {
  confluence_page_created: ['page_created'],
  confluence_page_updated: ['page_updated'],
  confluence_page_removed: ['page_removed', 'page_trashed'],
  confluence_page_moved: ['page_moved'],
  confluence_comment_created: ['comment_created'],
  confluence_comment_removed: ['comment_removed'],
  confluence_blog_created: ['blog_created'],
  confluence_blog_updated: ['blog_updated'],
  confluence_blog_removed: ['blog_removed', 'blog_trashed'],
  confluence_attachment_created: ['attachment_created'],
  confluence_attachment_removed: ['attachment_removed', 'attachment_trashed'],
  confluence_space_created: ['space_created'],
  confluence_space_updated: ['space_updated'],
  confluence_label_added: ['label_added', 'label_created'],
  confluence_label_removed: ['label_removed', 'label_deleted'],
}

const TRIGGER_CATEGORY_MAP: Record<string, string> = {
  confluence_page_created: 'page',
  confluence_page_updated: 'page',
  confluence_page_removed: 'page',
  confluence_page_moved: 'page',
  confluence_comment_created: 'comment',
  confluence_comment_removed: 'comment',
  confluence_blog_created: 'blog',
  confluence_blog_updated: 'blog',
  confluence_blog_removed: 'blog',
  confluence_attachment_created: 'attachment',
  confluence_attachment_removed: 'attachment',
  confluence_space_created: 'space',
  confluence_space_updated: 'space',
  confluence_label_added: 'label',
  confluence_label_removed: 'label',
}

/**
 * Infers the entity category from a Confluence webhook payload by checking
 * which entity key is present in the body.
 */
function inferEntityCategory(body: Record<string, unknown>): string | null {
  if (body.comment) return 'comment'
  if (body.attachment) return 'attachment'
  if (body.blog || body.blogpost) return 'blog'
  if (body.label) return 'label'
  if (body.page) return 'page'
  if (body.space) return 'space'
  return null
}

/**
 * Checks if a Confluence webhook payload matches a trigger.
 *
 * Admin REST API webhooks (Settings > Webhooks) include an `event` field
 * for exact action-level matching. Connect app webhooks omit it, so we
 * fall back to entity-category matching (page vs comment vs blog, etc.).
 */
export function isConfluencePayloadMatch(
  triggerId: string,
  body: Record<string, unknown>
): boolean {
  if (triggerId === 'confluence_webhook') {
    return true
  }

  const event = body.event as string | undefined
  if (event) {
    const acceptedEvents = TRIGGER_EVENT_MAP[triggerId]
    return acceptedEvents ? acceptedEvents.includes(event) : false
  }

  const expectedCategory = TRIGGER_CATEGORY_MAP[triggerId]
  if (!expectedCategory) {
    return false
  }
  return inferEntityCategory(body) === expectedCategory
}
