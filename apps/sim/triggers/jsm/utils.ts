import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Shared trigger dropdown options for all JSM triggers
 */
export const jsmTriggerOptions = [
  { label: 'Request Created', id: 'jsm_request_created' },
  { label: 'Request Updated', id: 'jsm_request_updated' },
  { label: 'Request Commented', id: 'jsm_request_commented' },
  { label: 'Request Resolved', id: 'jsm_request_resolved' },
  { label: 'Generic Webhook (All Events)', id: 'jsm_webhook' },
]

/**
 * Generates setup instructions for JSM webhooks.
 * JSM uses the Jira webhook infrastructure with service desk context.
 */
export function jsmSetupInstructions(eventType: string, additionalNotes?: string): string {
  const instructions = [
    '<strong>Note:</strong> You must have admin permissions in your Jira workspace to create webhooks. JSM uses the Jira webhook system. See the <a href="https://support.atlassian.com/jira-cloud-administration/docs/manage-webhooks/" target="_blank" rel="noopener noreferrer">Jira webhook documentation</a> for details.',
    'In Jira, navigate to <strong>Settings > System > WebHooks</strong>.',
    'Click <strong>"Create a WebHook"</strong> to add a new webhook.',
    'Paste the <strong>Webhook URL</strong> from above into the URL field.',
    'Optionally, enter the <strong>Webhook Secret</strong> from above into the secret field for added security.',
    `Select the events you want to trigger this workflow. For this trigger, select <strong>${eventType}</strong>.`,
    'Optionally add a JQL filter to restrict webhooks to your service desk project (e.g., <code>project = SD</code>).',
    'Click <strong>"Create"</strong> to activate the webhook.',
  ]

  if (additionalNotes) {
    instructions.push(additionalNotes)
  }

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3">${index === 0 ? instruction : `<strong>${index}.</strong> ${instruction}`}</div>`
    )
    .join('')
}

/**
 * Webhook secret field for JSM triggers
 */
function jsmWebhookSecretField(triggerId: string): SubBlockConfig {
  return {
    id: 'webhookSecret',
    title: 'Webhook Secret',
    type: 'short-input',
    placeholder: 'Enter a strong secret',
    description: 'Optional secret to validate webhook deliveries from Jira using HMAC signature',
    password: true,
    required: false,
    mode: 'trigger',
    condition: { field: 'selectedTriggerId', value: triggerId },
  }
}

/**
 * Extra fields for JSM triggers (webhook secret + JQL filter)
 */
export function buildJsmExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    jsmWebhookSecretField(triggerId),
    {
      id: 'jqlFilter',
      title: 'JQL Filter',
      type: 'long-input',
      placeholder: 'project = SD AND issuetype = "Service Request"',
      description:
        'Filter which service desk requests trigger this workflow using JQL (Jira Query Language)',
      required: false,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

/**
 * Base webhook output fields shared across all JSM triggers
 */
function buildBaseWebhookOutputs(): Record<string, TriggerOutput> {
  return {
    webhookEvent: {
      type: 'string',
      description:
        'The webhook event type (e.g., jira:issue_created, jira:issue_updated, comment_created)',
    },
    timestamp: {
      type: 'number',
      description: 'Timestamp of the webhook event',
    },
    user: {
      displayName: {
        type: 'string',
        description: 'Display name of the user who triggered the event',
      },
      accountId: {
        type: 'string',
        description: 'Account ID of the user who triggered the event',
      },
    },

    issue: {
      id: {
        type: 'string',
        description: 'Jira issue ID',
      },
      key: {
        type: 'string',
        description: 'Issue key (e.g., SD-123)',
      },
      self: {
        type: 'string',
        description: 'REST API URL for this issue',
      },
      fields: {
        summary: {
          type: 'string',
          description: 'Request summary/title',
        },
        status: {
          name: {
            type: 'string',
            description: 'Current status name',
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
        issuetype: {
          name: {
            type: 'string',
            description: 'Issue type name (e.g., Service Request, Incident)',
          },
          id: {
            type: 'string',
            description: 'Issue type ID',
          },
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
            description:
              'Email address (Jira Server only — not available in Jira Cloud webhook payloads)',
          },
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
            description:
              'Email address (Jira Server only — not available in Jira Cloud webhook payloads)',
          },
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
            description:
              'Email address (Jira Server only — not available in Jira Cloud webhook payloads)',
          },
        },
        created: {
          type: 'string',
          description: 'Request creation date (ISO format)',
        },
        updated: {
          type: 'string',
          description: 'Last updated date (ISO format)',
        },
        duedate: {
          type: 'string',
          description: 'Due date for the request',
        },
        labels: {
          type: 'array',
          description: 'Array of labels applied to this request',
        },
        resolution: {
          name: {
            type: 'string',
            description: 'Resolution name (e.g., Done, Fixed)',
          },
          id: {
            type: 'string',
            description: 'Resolution ID',
          },
        },
      },
    },
  }
}

/**
 * Outputs for request created triggers
 */
export function buildJsmRequestOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    issue_event_type_name: {
      type: 'string',
      description: 'Issue event type name from Jira',
    },
  }
}

/**
 * Outputs for request updated/resolved triggers (includes changelog)
 */
export function buildJsmRequestUpdatedOutputs(): Record<string, TriggerOutput> {
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
 * Outputs for comment triggers
 */
export function buildJsmCommentOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),

    comment: {
      id: {
        type: 'string',
        description: 'Comment ID',
      },
      body: {
        type: 'json',
        description:
          'Comment body in Atlassian Document Format (ADF). On Jira Server this may be a plain string.',
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
      updateAuthor: {
        displayName: {
          type: 'string',
          description: 'Display name of the user who last updated the comment',
        },
        accountId: {
          type: 'string',
          description: 'Account ID of the user who last updated the comment',
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
 * Checks whether a JSM webhook event matches the configured trigger.
 *
 * JSM events come through Jira's webhook system. The matching logic considers:
 * - The webhook event type (jira:issue_created, jira:issue_updated, comment_created)
 * - The issue_event_type_name for finer-grained matching
 * - Changelog items for approval, SLA, and resolution events
 */
export function isJsmEventMatch(
  triggerId: string,
  webhookEvent: string,
  issueEventTypeName?: string,
  changelog?: { items?: Array<{ field?: string; toString?: string }> }
): boolean {
  switch (triggerId) {
    case 'jsm_request_created':
      return webhookEvent === 'jira:issue_created' || issueEventTypeName === 'issue_created'

    case 'jsm_request_updated':
      return (
        webhookEvent === 'jira:issue_updated' ||
        issueEventTypeName === 'issue_updated' ||
        issueEventTypeName === 'issue_generic'
      )

    case 'jsm_request_commented':
      return webhookEvent === 'comment_created'

    case 'jsm_request_resolved': {
      if (webhookEvent !== 'jira:issue_updated' && issueEventTypeName !== 'issue_updated') {
        return false
      }
      const resolvedItems = changelog?.items ?? []
      return resolvedItems.some(
        (item) =>
          item.field === 'status' &&
          (item.toString?.toLowerCase() === 'resolved' ||
            item.toString?.toLowerCase() === 'done' ||
            item.toString?.toLowerCase() === 'closed')
      )
    }

    case 'jsm_webhook':
      return true

    default:
      return false
  }
}

/**
 * Extracts request data from a JSM webhook payload
 */
export function extractRequestData(body: Record<string, unknown>) {
  return {
    webhookEvent: body.webhookEvent,
    timestamp: body.timestamp,
    user: body.user || null,
    issue_event_type_name: body.issue_event_type_name,
    issue: body.issue || {},
    changelog: body.changelog,
  }
}

/**
 * Extracts comment data from a JSM webhook payload
 */
export function extractCommentData(body: Record<string, unknown>) {
  return {
    webhookEvent: body.webhookEvent,
    timestamp: body.timestamp,
    user: body.user || null,
    issue: body.issue || {},
    comment: body.comment || {},
  }
}
