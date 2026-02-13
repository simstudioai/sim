import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Shared trigger dropdown options for all JSM triggers
 */
export const jsmTriggerOptions = [
  { label: 'Request Created', id: 'jsm_request_created' },
  { label: 'Request Updated', id: 'jsm_request_updated' },
  { label: 'Request Deleted', id: 'jsm_request_deleted' },
  { label: 'Request Commented', id: 'jsm_request_commented' },
  { label: 'Comment Updated', id: 'jsm_comment_updated' },
  { label: 'Comment Deleted', id: 'jsm_comment_deleted' },
  { label: 'Worklog Created', id: 'jsm_worklog_created' },
  { label: 'Worklog Updated', id: 'jsm_worklog_updated' },
  { label: 'Worklog Deleted', id: 'jsm_worklog_deleted' },
  { label: 'Attachment Created', id: 'jsm_attachment_created' },
  { label: 'Attachment Deleted', id: 'jsm_attachment_deleted' },
  { label: 'Generic Webhook (All Events)', id: 'jsm_webhook' },
]

/**
 * Generates setup instructions for JSM webhooks
 */
export function jsmSetupInstructions(eventType: string): string {
  const instructions = [
    '<strong>Note:</strong> You must have admin permissions in your Jira workspace to create webhooks. JSM uses the same webhook system as Jira. See the <a href="https://support.atlassian.com/jira-cloud-administration/docs/manage-webhooks/" target="_blank" rel="noopener noreferrer">Jira webhook documentation</a> for details.',
    'In Jira, navigate to <strong>Settings > System > WebHooks</strong>.',
    'Click <strong>"Create a WebHook"</strong> to add a new webhook.',
    'Paste the <strong>Webhook URL</strong> from above into the URL field.',
    'Optionally, enter the <strong>Webhook Secret</strong> from above into the secret field for added security.',
    `Select the events you want to trigger this workflow. For this trigger, select <strong>${eventType}</strong>.`,
    'Optionally, add a JQL filter to restrict to your service desk project (e.g., <code>project = SD</code>).',
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
 * Build extra fields for JSM triggers (webhook secret, JQL filter, and optional file download fields)
 * @param triggerId - The trigger ID for condition matching
 * @param options.includeFileFields - Whether to include file download fields (default: true)
 */
export function buildJsmExtraFields(
  triggerId: string,
  options?: { includeFileFields?: boolean }
): SubBlockConfig[] {
  const { includeFileFields = true } = options || {}

  const baseFields: SubBlockConfig[] = [
    {
      id: 'webhookSecret',
      title: 'Webhook Secret',
      type: 'short-input',
      placeholder: 'Enter a strong secret',
      description: 'Optional secret to validate webhook deliveries from Jira using HMAC signature',
      password: true,
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: triggerId,
      },
    },
    {
      id: 'jqlFilter',
      title: 'JQL Filter',
      type: 'long-input',
      placeholder: 'project = SD AND issuetype = "Service Request"',
      description:
        'Filter which service requests trigger this workflow using JQL (Jira Query Language)',
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: triggerId,
      },
    },
  ]

  if (!includeFileFields) {
    return baseFields
  }

  return [
    ...baseFields,
    {
      id: 'includeFiles',
      title: 'Include File Attachments',
      type: 'switch',
      defaultValue: false,
      description:
        'Download and include file attachments from webhook events. Requires Jira email and API token.',
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: triggerId,
      },
    },
    {
      id: 'jiraEmail',
      title: 'Jira Email',
      type: 'short-input',
      placeholder: 'user@example.com',
      description: 'Your Atlassian account email, used to download file attachments from Jira.',
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: triggerId,
      },
    },
    {
      id: 'jiraApiToken',
      title: 'Jira API Token',
      type: 'short-input',
      placeholder: 'Enter your Jira API token',
      description:
        'API token from https://id.atlassian.com/manage-profile/security/api-tokens. Used to download file attachments.',
      password: true,
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: triggerId,
      },
    },
  ]
}

function buildBaseWebhookOutputs(): Record<string, TriggerOutput> {
  return {
    webhookEvent: {
      type: 'string',
      description: 'The webhook event type (e.g., jira:issue_created, comment_created)',
    },
    timestamp: {
      type: 'number',
      description: 'Timestamp of the webhook event',
    },

    issue: {
      id: {
        type: 'string',
        description: 'Service request issue ID',
      },
      key: {
        type: 'string',
        description: 'Service request issue key (e.g., SD-123)',
      },
      self: {
        type: 'string',
        description: 'REST API URL for this request',
      },
      fields: {
        labels: {
          type: 'array',
          description: 'Array of labels applied to this request',
        },
        status: {
          name: {
            type: 'string',
            description: 'Request status name',
          },
          id: {
            type: 'string',
            description: 'Status ID',
          },
          statusCategory: {
            type: 'json',
            description: 'Status category information',
          },
        },
        created: {
          type: 'string',
          description: 'Request creation date (ISO format)',
        },
        creator: {
          displayName: {
            type: 'string',
            description: 'Creator display name',
          },
          accountId: {
            type: 'string',
            description: 'Creator account ID',
          },
          emailAddress: {
            type: 'string',
            description: 'Creator email address',
          },
        },
        duedate: {
          type: 'string',
          description: 'Due date for the request',
        },
        project: {
          key: {
            type: 'string',
            description: 'Project key',
          },
          name: {
            type: 'string',
            description: 'Project name',
          },
          id: {
            type: 'string',
            description: 'Project ID',
          },
        },
        summary: {
          type: 'string',
          description: 'Request summary/title',
        },
        updated: {
          type: 'string',
          description: 'Last updated date (ISO format)',
        },
        assignee: {
          displayName: {
            type: 'string',
            description: 'Assignee display name',
          },
          accountId: {
            type: 'string',
            description: 'Assignee account ID',
          },
          emailAddress: {
            type: 'string',
            description: 'Assignee email address',
          },
        },
        priority: {
          name: {
            type: 'string',
            description: 'Priority name',
          },
          id: {
            type: 'string',
            description: 'Priority ID',
          },
        },
        reporter: {
          displayName: {
            type: 'string',
            description: 'Reporter display name',
          },
          accountId: {
            type: 'string',
            description: 'Reporter account ID',
          },
          emailAddress: {
            type: 'string',
            description: 'Reporter email address',
          },
        },
        issuetype: {
          name: {
            type: 'string',
            description: 'Request type name',
          },
          id: {
            type: 'string',
            description: 'Request type ID',
          },
        },
      },
    },
  }
}

/**
 * Build outputs for request created/deleted triggers
 */
export function buildRequestOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    issue_event_type_name: {
      type: 'string',
      description: 'Issue event type name from Jira',
    },
  }
}

/**
 * Build outputs for request updated triggers (includes changelog)
 */
export function buildRequestUpdatedOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    issue_event_type_name: {
      type: 'string',
      description: 'Issue event type name from Jira',
    },
    changelog: {
      id: {
        type: 'string',
        description: 'Changelog ID',
      },
      items: {
        type: 'array',
        description:
          'Array of changed items. Each item contains field, fieldtype, from, fromString, to, toString',
      },
    },
  }
}

/**
 * Build outputs for request commented triggers
 */
export function buildRequestCommentedOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),

    comment: {
      id: {
        type: 'string',
        description: 'Comment ID',
      },
      body: {
        type: 'string',
        description: 'Comment text/body',
      },
      author: {
        displayName: {
          type: 'string',
          description: 'Comment author display name',
        },
        accountId: {
          type: 'string',
          description: 'Comment author account ID',
        },
        emailAddress: {
          type: 'string',
          description: 'Comment author email address',
        },
      },
      created: {
        type: 'string',
        description: 'Comment creation date (ISO format)',
      },
      updated: {
        type: 'string',
        description: 'Comment last updated date (ISO format)',
      },
    },
  }
}

/**
 * Build outputs for worklog triggers
 */
export function buildWorklogOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),

    worklog: {
      id: {
        type: 'string',
        description: 'Worklog entry ID',
      },
      author: {
        displayName: {
          type: 'string',
          description: 'Worklog author display name',
        },
        accountId: {
          type: 'string',
          description: 'Worklog author account ID',
        },
        emailAddress: {
          type: 'string',
          description: 'Worklog author email address',
        },
      },
      timeSpent: {
        type: 'string',
        description: 'Time spent (e.g., "2h 30m")',
      },
      timeSpentSeconds: {
        type: 'number',
        description: 'Time spent in seconds',
      },
      comment: {
        type: 'string',
        description: 'Worklog comment/description',
      },
      started: {
        type: 'string',
        description: 'When the work was started (ISO format)',
      },
    },
  }
}

/**
 * Build outputs for attachment triggers
 */
export function buildAttachmentOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    attachment: {
      id: {
        type: 'string',
        description: 'Attachment ID',
      },
      filename: {
        type: 'string',
        description: 'Attachment file name',
      },
      mimeType: {
        type: 'string',
        description: 'Attachment MIME type',
      },
      size: {
        type: 'number',
        description: 'Attachment file size in bytes',
      },
      content: {
        type: 'string',
        description: 'URL to download the attachment',
      },
      author: {
        displayName: {
          type: 'string',
          description: 'Attachment author display name',
        },
        accountId: {
          type: 'string',
          description: 'Attachment author account ID',
        },
      },
      created: {
        type: 'string',
        description: 'Attachment creation date (ISO format)',
      },
    },
    files: {
      type: 'file[]',
      description:
        'Downloaded file attachments (if includeFiles is enabled and Jira credentials are provided)',
    },
  }
}

/**
 * Check if a Jira webhook event matches a JSM trigger
 * JSM uses the same webhook events as Jira
 */
export function isJsmEventMatch(
  triggerId: string,
  webhookEvent: string,
  issueEventTypeName?: string
): boolean {
  const eventMappings: Record<string, string[]> = {
    jsm_request_created: ['jira:issue_created', 'issue_created'],
    jsm_request_updated: ['jira:issue_updated', 'issue_updated', 'issue_generic'],
    jsm_request_deleted: ['jira:issue_deleted', 'issue_deleted'],
    jsm_request_commented: ['comment_created'],
    jsm_comment_updated: ['comment_updated'],
    jsm_comment_deleted: ['comment_deleted'],
    jsm_worklog_created: ['worklog_created'],
    jsm_worklog_updated: ['worklog_updated'],
    jsm_worklog_deleted: ['worklog_deleted'],
    jsm_attachment_created: ['attachment_created'],
    jsm_attachment_deleted: ['attachment_deleted'],
    jsm_webhook: ['*'],
  }

  const expectedEvents = eventMappings[triggerId]
  if (!expectedEvents) {
    return false
  }

  if (expectedEvents.includes('*')) {
    return true
  }

  return (
    expectedEvents.includes(webhookEvent) ||
    (issueEventTypeName !== undefined && expectedEvents.includes(issueEventTypeName))
  )
}
