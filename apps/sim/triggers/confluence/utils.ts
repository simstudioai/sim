import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Shared trigger dropdown options for all Confluence triggers
 */
export const confluenceTriggerOptions = [
  // Page Events
  { label: 'Page Created', id: 'confluence_page_created' },
  { label: 'Page Updated', id: 'confluence_page_updated' },
  { label: 'Page Removed', id: 'confluence_page_removed' },
  { label: 'Page Moved', id: 'confluence_page_moved' },
  // Comment Events
  { label: 'Comment Created', id: 'confluence_comment_created' },
  { label: 'Comment Removed', id: 'confluence_comment_removed' },
  // Blog Events
  { label: 'Blog Post Created', id: 'confluence_blog_created' },
  { label: 'Blog Post Updated', id: 'confluence_blog_updated' },
  { label: 'Blog Post Removed', id: 'confluence_blog_removed' },
  // Attachment Events
  { label: 'Attachment Created', id: 'confluence_attachment_created' },
  { label: 'Attachment Removed', id: 'confluence_attachment_removed' },
  // Space Events
  { label: 'Space Created', id: 'confluence_space_created' },
  { label: 'Space Updated', id: 'confluence_space_updated' },
  // Label Events
  { label: 'Label Added', id: 'confluence_label_added' },
  { label: 'Label Removed', id: 'confluence_label_removed' },
  // Generic
  { label: 'Generic Webhook (All Events)', id: 'confluence_webhook' },
]

/**
 * Generates setup instructions for Confluence webhooks
 */
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

/**
 * Extra fields shared across Confluence triggers (webhook secret + optional domain)
 */
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

/**
 * Extra fields for attachment triggers that support file downloads.
 * Adds email, API token, and include toggle on top of the base fields.
 */
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
 * Base webhook outputs common to all Confluence triggers
 */
function buildBaseWebhookOutputs(): Record<string, TriggerOutput> {
  return {
    event: {
      type: 'string',
      description: 'The webhook event type (e.g., page_created, page_updated, comment_created)',
    },
    timestamp: {
      type: 'number',
      description: 'Timestamp of the webhook event',
    },
    userAccountId: {
      type: 'string',
      description: 'Account ID of the user who triggered the event',
    },
  }
}

/**
 * Page-related outputs for page events
 */
export function buildPageOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    page: {
      id: {
        type: 'string',
        description: 'Confluence page ID',
      },
      title: {
        type: 'string',
        description: 'Page title',
      },
      contentType: {
        type: 'string',
        description: 'Content type (page)',
      },
      status: {
        type: 'string',
        description: 'Page status (current, draft, trashed)',
      },
      space: {
        key: {
          type: 'string',
          description: 'Space key',
        },
        name: {
          type: 'string',
          description: 'Space name',
        },
        id: {
          type: 'string',
          description: 'Space ID',
        },
      },
      version: {
        number: {
          type: 'number',
          description: 'Version number',
        },
        when: {
          type: 'string',
          description: 'Version date (ISO format)',
        },
        by: {
          accountId: {
            type: 'string',
            description: 'Author account ID',
          },
          displayName: {
            type: 'string',
            description: 'Author display name',
          },
        },
      },
    },
  }
}

/**
 * Comment-related outputs for comment events
 */
export function buildCommentOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    comment: {
      id: {
        type: 'string',
        description: 'Comment ID',
      },
      body: {
        type: 'json',
        description: 'Comment body content',
      },
      container: {
        id: {
          type: 'string',
          description: 'Container (page/blog) ID',
        },
        title: {
          type: 'string',
          description: 'Container title',
        },
      },
      version: {
        number: {
          type: 'number',
          description: 'Comment version number',
        },
        when: {
          type: 'string',
          description: 'Comment date (ISO format)',
        },
        by: {
          accountId: {
            type: 'string',
            description: 'Author account ID',
          },
          displayName: {
            type: 'string',
            description: 'Author display name',
          },
        },
      },
    },
  }
}

/**
 * Blog post outputs for blog events
 */
export function buildBlogOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    blog: {
      id: {
        type: 'string',
        description: 'Blog post ID',
      },
      title: {
        type: 'string',
        description: 'Blog post title',
      },
      contentType: {
        type: 'string',
        description: 'Content type (blogpost)',
      },
      status: {
        type: 'string',
        description: 'Blog post status',
      },
      space: {
        key: {
          type: 'string',
          description: 'Space key',
        },
        name: {
          type: 'string',
          description: 'Space name',
        },
        id: {
          type: 'string',
          description: 'Space ID',
        },
      },
      version: {
        number: {
          type: 'number',
          description: 'Version number',
        },
        when: {
          type: 'string',
          description: 'Version date (ISO format)',
        },
        by: {
          accountId: {
            type: 'string',
            description: 'Author account ID',
          },
          displayName: {
            type: 'string',
            description: 'Author display name',
          },
        },
      },
    },
  }
}

/**
 * Attachment-related outputs for attachment events
 */
export function buildAttachmentOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    attachment: {
      id: {
        type: 'string',
        description: 'Attachment ID',
      },
      title: {
        type: 'string',
        description: 'Attachment file name',
      },
      mediaType: {
        type: 'string',
        description: 'MIME type of the attachment',
      },
      fileSize: {
        type: 'number',
        description: 'File size in bytes',
      },
      container: {
        id: {
          type: 'string',
          description: 'Container (page/blog) ID',
        },
        title: {
          type: 'string',
          description: 'Container title',
        },
      },
    },
    files: {
      type: 'file[]',
      description:
        'Attachment file content downloaded from Confluence (if includeFileContent is enabled with credentials)',
    },
  }
}

/**
 * Space-related outputs for space events
 */
export function buildSpaceOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    space: {
      id: {
        type: 'string',
        description: 'Space ID',
      },
      key: {
        type: 'string',
        description: 'Space key',
      },
      name: {
        type: 'string',
        description: 'Space name',
      },
      status: {
        type: 'string',
        description: 'Space status',
      },
    },
  }
}

/**
 * Label-related outputs for label events
 */
export function buildLabelOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    label: {
      name: {
        type: 'string',
        description: 'Label name',
      },
      id: {
        type: 'string',
        description: 'Label ID',
      },
      prefix: {
        type: 'string',
        description: 'Label prefix (global, my, team)',
      },
    },
    content: {
      id: {
        type: 'string',
        description: 'Content ID the label was added to or removed from',
      },
      title: {
        type: 'string',
        description: 'Content title',
      },
    },
  }
}

/**
 * Combined outputs for the generic webhook trigger (all events)
 */
export function buildGenericWebhookOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    page: {
      id: {
        type: 'string',
        description: 'Page ID (present in page events)',
      },
      title: {
        type: 'string',
        description: 'Page title',
      },
      status: {
        type: 'string',
        description: 'Page status',
      },
      space: {
        key: {
          type: 'string',
          description: 'Space key',
        },
        name: {
          type: 'string',
          description: 'Space name',
        },
      },
    },
    comment: {
      id: {
        type: 'string',
        description: 'Comment ID (present in comment events)',
      },
      body: {
        type: 'json',
        description: 'Comment body',
      },
      container: {
        id: {
          type: 'string',
          description: 'Container ID',
        },
        title: {
          type: 'string',
          description: 'Container title',
        },
      },
    },
    blog: {
      id: {
        type: 'string',
        description: 'Blog post ID (present in blog events)',
      },
      title: {
        type: 'string',
        description: 'Blog post title',
      },
      status: {
        type: 'string',
        description: 'Blog post status',
      },
    },
    attachment: {
      id: {
        type: 'string',
        description: 'Attachment ID (present in attachment events)',
      },
      title: {
        type: 'string',
        description: 'Attachment file name',
      },
    },
    space: {
      id: {
        type: 'string',
        description: 'Space ID (present in space events)',
      },
      key: {
        type: 'string',
        description: 'Space key',
      },
      name: {
        type: 'string',
        description: 'Space name',
      },
    },
    label: {
      name: {
        type: 'string',
        description: 'Label name (present in label events)',
      },
      id: {
        type: 'string',
        description: 'Label ID',
      },
    },
    files: {
      type: 'file[]',
      description:
        'Attachment file content downloaded from Confluence (present in attachment events when includeFileContent is enabled)',
    },
  }
}

/**
 * Checks if a Confluence webhook event matches a specific trigger
 */
export function isConfluenceEventMatch(triggerId: string, event: string): boolean {
  const eventMappings: Record<string, string[]> = {
    // Page events
    confluence_page_created: ['page_created'],
    confluence_page_updated: ['page_updated'],
    confluence_page_removed: ['page_removed', 'page_trashed'],
    confluence_page_moved: ['page_moved'],
    // Comment events
    confluence_comment_created: ['comment_created'],
    confluence_comment_removed: ['comment_removed'],
    // Blog events
    confluence_blog_created: ['blog_created'],
    confluence_blog_updated: ['blog_updated'],
    confluence_blog_removed: ['blog_removed', 'blog_trashed'],
    // Attachment events
    confluence_attachment_created: ['attachment_created'],
    confluence_attachment_removed: ['attachment_removed', 'attachment_trashed'],
    // Space events
    confluence_space_created: ['space_created'],
    confluence_space_updated: ['space_updated'],
    // Label events
    confluence_label_added: ['label_added', 'label_created'],
    confluence_label_removed: ['label_removed', 'label_deleted'],
    // Generic webhook accepts all events
    confluence_webhook: ['*'],
  }

  const expectedEvents = eventMappings[triggerId]
  if (!expectedEvents) {
    return false
  }

  if (expectedEvents.includes('*')) {
    return true
  }

  return expectedEvents.includes(event)
}
