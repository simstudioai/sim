import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Shared trigger dropdown options for all Jira triggers
 */
export const jiraTriggerOptions = [
  { label: 'Issue Created', id: 'jira_issue_created' },
  { label: 'Issue Updated', id: 'jira_issue_updated' },
  { label: 'Issue Deleted', id: 'jira_issue_deleted' },
  { label: 'Issue Commented', id: 'jira_issue_commented' },
  { label: 'Comment Updated', id: 'jira_comment_updated' },
  { label: 'Comment Deleted', id: 'jira_comment_deleted' },
  { label: 'Worklog Created', id: 'jira_worklog_created' },
  { label: 'Worklog Updated', id: 'jira_worklog_updated' },
  { label: 'Worklog Deleted', id: 'jira_worklog_deleted' },
  { label: 'Sprint Created', id: 'jira_sprint_created' },
  { label: 'Sprint Started', id: 'jira_sprint_started' },
  { label: 'Sprint Closed', id: 'jira_sprint_closed' },
  { label: 'Sprint Updated', id: 'jira_sprint_updated' },
  { label: 'Sprint Deleted', id: 'jira_sprint_deleted' },
  { label: 'Project Created', id: 'jira_project_created' },
  { label: 'Project Updated', id: 'jira_project_updated' },
  { label: 'Project Deleted', id: 'jira_project_deleted' },
  { label: 'Version Created', id: 'jira_version_created' },
  { label: 'Version Released', id: 'jira_version_released' },
  { label: 'Version Unreleased', id: 'jira_version_unreleased' },
  { label: 'Version Updated', id: 'jira_version_updated' },
  { label: 'Version Deleted', id: 'jira_version_deleted' },
  { label: 'Board Created', id: 'jira_board_created' },
  { label: 'Board Updated', id: 'jira_board_updated' },
  { label: 'Board Deleted', id: 'jira_board_deleted' },
  { label: 'Board Config Changed', id: 'jira_board_config_changed' },
  { label: 'Attachment Created', id: 'jira_attachment_created' },
  { label: 'Attachment Deleted', id: 'jira_attachment_deleted' },
  { label: 'Issue Link Created', id: 'jira_issuelink_created' },
  { label: 'Issue Link Deleted', id: 'jira_issuelink_deleted' },
  { label: 'Generic Webhook (All Events)', id: 'jira_webhook' },
]

/**
 * Common webhook subBlocks for Jira triggers
 * Used across all Jira webhook-based triggers
 */
export const jiraWebhookSubBlocks: SubBlockConfig[] = [
  {
    id: 'triggerCredentials',
    title: 'Jira Credentials',
    type: 'oauth-input',
    serviceId: 'jira',
    requiredScopes: [
      'read:jira-work',
      'read:jira-user',
      'manage:jira-webhook',
      'read:webhook:jira',
      'write:webhook:jira',
      'delete:webhook:jira',
      'read:issue-event:jira',
      'read:issue:jira',
      'read:issue.changelog:jira',
      'read:comment:jira',
      'read:comment.property:jira',
      'read:issue.property:jira',
      'read:issue-worklog:jira',
      'read:project:jira',
      'read:field:jira',
      'read:jql:jira',
    ],
    placeholder: 'Select Jira account',
    required: true,
    mode: 'trigger',
  },
  {
    id: 'webhookUrlDisplay',
    title: 'Webhook URL',
    type: 'short-input',
    readOnly: true,
    showCopyButton: true,
    useWebhookUrl: true,
    placeholder: 'Webhook URL will be generated after saving',
    mode: 'trigger',
    description: 'Copy this URL and use it when configuring the webhook in Jira',
  },
  {
    id: 'webhookSecret',
    title: 'Webhook Secret',
    type: 'short-input',
    placeholder: 'Enter webhook secret for validation',
    description: 'Optional secret to validate webhook deliveries from Jira using HMAC signature',
    password: true,
    required: false,
    mode: 'trigger',
  },
  {
    id: 'jiraDomain',
    title: 'Jira Domain',
    type: 'short-input',
    placeholder: 'your-company.atlassian.net',
    description: 'Your Jira Cloud domain',
    required: false,
    mode: 'trigger',
  },
]

/**
 * Generates setup instructions for Jira webhooks
 */
export function jiraSetupInstructions(eventType: string, additionalNotes?: string): string {
  const instructions = [
    '<strong>Note:</strong> You must have admin permissions in your Jira workspace to create webhooks. See the <a href="https://support.atlassian.com/jira-cloud-administration/docs/manage-webhooks/" target="_blank" rel="noopener noreferrer">Jira webhook documentation</a> for details.',
    'In Jira, navigate to <strong>Settings > System > WebHooks</strong>.',
    'Click <strong>"Create a WebHook"</strong> to add a new webhook.',
    'Paste the <strong>Webhook URL</strong> from above into the URL field.',
    'Optionally, enter the <strong>Webhook Secret</strong> from above into the secret field for added security.',
    `Select the events you want to trigger this workflow. For this trigger, select <strong>${eventType}</strong>.`,
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

function buildBaseWebhookOutputs(): Record<string, TriggerOutput> {
  return {
    webhookEvent: {
      type: 'string',
      description:
        'The webhook event type (e.g., jira:issue_created, comment_created, worklog_created)',
    },
    timestamp: {
      type: 'number',
      description: 'Timestamp of the webhook event',
    },

    issue: {
      id: {
        type: 'string',
        description: 'Jira issue ID',
      },
      key: {
        type: 'string',
        description: 'Jira issue key (e.g., PROJ-123)',
      },
      self: {
        type: 'string',
        description: 'REST API URL for this issue',
      },
      fields: {
        votes: {
          type: 'json',
          description: 'Votes on this issue',
        },
        labels: {
          type: 'array',
          description: 'Array of labels applied to this issue',
        },
        status: {
          name: {
            type: 'string',
            description: 'Status name',
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
          description: 'Issue creation date (ISO format)',
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
          description: 'Due date for the issue',
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
          description: 'Issue summary/title',
        },
        updated: {
          type: 'string',
          description: 'Last updated date (ISO format)',
        },
        watches: {
          type: 'json',
          description: 'Watchers information',
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
        progress: {
          type: 'json',
          description: 'Progress tracking information',
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
        security: {
          type: 'string',
          description: 'Security level',
        },
        subtasks: {
          type: 'array',
          description: 'Array of subtask objects',
        },
        versions: {
          type: 'array',
          description: 'Array of affected versions',
        },
        issuetype: {
          name: {
            type: 'string',
            description: 'Issue type name',
          },
          id: {
            type: 'string',
            description: 'Issue type ID',
          },
        },
      },
    },
  }
}

export function buildIssueOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    issue_event_type_name: {
      type: 'string',
      description: 'Issue event type name from Jira (only present in issue events)',
    },
  }
}

export function buildIssueUpdatedOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildBaseWebhookOutputs(),
    issue_event_type_name: {
      type: 'string',
      description: 'Issue event type name from Jira (only present in issue events)',
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

export function buildCommentOutputs(): Record<string, TriggerOutput> {
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

export function buildSprintOutputs(): Record<string, TriggerOutput> {
  return {
    webhookEvent: {
      type: 'string',
      description: 'The webhook event type (e.g., sprint_created, sprint_started)',
    },
    timestamp: {
      type: 'number',
      description: 'Timestamp of the webhook event',
    },
    sprint: {
      id: {
        type: 'number',
        description: 'Sprint ID',
      },
      name: {
        type: 'string',
        description: 'Sprint name',
      },
      state: {
        type: 'string',
        description: 'Sprint state (future, active, closed)',
      },
      startDate: {
        type: 'string',
        description: 'Sprint start date (ISO format)',
      },
      endDate: {
        type: 'string',
        description: 'Sprint end date (ISO format)',
      },
      completeDate: {
        type: 'string',
        description: 'Sprint completion date (ISO format)',
      },
      goal: {
        type: 'string',
        description: 'Sprint goal',
      },
      originBoardId: {
        type: 'number',
        description: 'ID of the board the sprint belongs to',
      },
    },
  }
}

export function buildProjectOutputs(): Record<string, TriggerOutput> {
  return {
    webhookEvent: {
      type: 'string',
      description: 'The webhook event type (e.g., project_created, project_updated)',
    },
    timestamp: {
      type: 'number',
      description: 'Timestamp of the webhook event',
    },
    project: {
      id: {
        type: 'string',
        description: 'Project ID',
      },
      key: {
        type: 'string',
        description: 'Project key (e.g., PROJ)',
      },
      name: {
        type: 'string',
        description: 'Project name',
      },
      projectTypeKey: {
        type: 'string',
        description: 'Project type (software, business, service_desk)',
      },
      lead: {
        displayName: {
          type: 'string',
          description: 'Project lead display name',
        },
        accountId: {
          type: 'string',
          description: 'Project lead account ID',
        },
      },
    },
  }
}

export function buildVersionOutputs(): Record<string, TriggerOutput> {
  return {
    webhookEvent: {
      type: 'string',
      description: 'The webhook event type (e.g., jira:version_created, jira:version_released)',
    },
    timestamp: {
      type: 'number',
      description: 'Timestamp of the webhook event',
    },
    version: {
      id: {
        type: 'string',
        description: 'Version ID',
      },
      name: {
        type: 'string',
        description: 'Version name',
      },
      released: {
        type: 'boolean',
        description: 'Whether the version is released',
      },
      archived: {
        type: 'boolean',
        description: 'Whether the version is archived',
      },
      releaseDate: {
        type: 'string',
        description: 'Release date (ISO format)',
      },
      projectId: {
        type: 'number',
        description: 'ID of the project this version belongs to',
      },
    },
  }
}

export function buildBoardOutputs(): Record<string, TriggerOutput> {
  return {
    webhookEvent: {
      type: 'string',
      description:
        'The webhook event type (e.g., board_created, board_updated, board_configuration_changed)',
    },
    timestamp: {
      type: 'number',
      description: 'Timestamp of the webhook event',
    },
    board: {
      id: {
        type: 'number',
        description: 'Board ID',
      },
      name: {
        type: 'string',
        description: 'Board name',
      },
      boardType: {
        type: 'string',
        description: 'Board type (scrum, kanban)',
      },
    },
  }
}

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
    hasAttachments: {
      type: 'boolean',
      description: 'Whether this event includes a downloadable attachment',
    },
    attachments: {
      type: 'file[]',
      description:
        'Downloaded attachment files as UserFile objects (if includeAttachments is enabled and API credentials are provided)',
    },
  }
}

export function buildIssueLinkOutputs(): Record<string, TriggerOutput> {
  return {
    webhookEvent: {
      type: 'string',
      description: 'The webhook event type (e.g., issuelink_created, issuelink_deleted)',
    },
    timestamp: {
      type: 'number',
      description: 'Timestamp of the webhook event',
    },
    issueLink: {
      id: {
        type: 'string',
        description: 'Issue link ID',
      },
      linkType: {
        name: {
          type: 'string',
          description: 'Link type name (e.g., Blocks, Duplicate)',
        },
        inward: {
          type: 'string',
          description: 'Inward link description (e.g., "is blocked by")',
        },
        outward: {
          type: 'string',
          description: 'Outward link description (e.g., "blocks")',
        },
      },
      sourceIssueId: {
        type: 'string',
        description: 'Source issue ID',
      },
      destinationIssueId: {
        type: 'string',
        description: 'Destination issue ID',
      },
    },
  }
}

export function isJiraEventMatch(
  triggerId: string,
  webhookEvent: string,
  issueEventTypeName?: string
): boolean {
  const eventMappings: Record<string, string[]> = {
    jira_issue_created: ['jira:issue_created', 'issue_created'],
    jira_issue_updated: ['jira:issue_updated', 'issue_updated', 'issue_generic'],
    jira_issue_deleted: ['jira:issue_deleted', 'issue_deleted'],
    jira_issue_commented: ['comment_created'],
    jira_comment_updated: ['comment_updated'],
    jira_comment_deleted: ['comment_deleted'],
    jira_worklog_created: ['worklog_created'],
    jira_worklog_updated: ['worklog_updated'],
    jira_worklog_deleted: ['worklog_deleted'],
    jira_sprint_created: ['sprint_created'],
    jira_sprint_started: ['sprint_started'],
    jira_sprint_closed: ['sprint_closed'],
    jira_sprint_updated: ['sprint_updated'],
    jira_sprint_deleted: ['sprint_deleted'],
    jira_project_created: ['project_created'],
    jira_project_updated: ['project_updated'],
    jira_project_deleted: ['project_deleted'],
    jira_version_created: ['jira:version_created'],
    jira_version_released: ['jira:version_released'],
    jira_version_unreleased: ['jira:version_unreleased'],
    jira_version_updated: ['jira:version_updated'],
    jira_version_deleted: ['jira:version_deleted'],
    jira_board_created: ['board_created'],
    jira_board_updated: ['board_updated'],
    jira_board_deleted: ['board_deleted'],
    jira_board_config_changed: ['board_configuration_changed'],
    jira_attachment_created: ['attachment_created'],
    jira_attachment_deleted: ['attachment_deleted'],
    jira_issuelink_created: ['issuelink_created'],
    jira_issuelink_deleted: ['issuelink_deleted'],
    // Generic webhook accepts all events
    jira_webhook: ['*'],
  }

  const expectedEvents = eventMappings[triggerId]
  if (!expectedEvents) {
    return false
  }

  // Generic webhook accepts all events
  if (expectedEvents.includes('*')) {
    return true
  }

  // Check if webhookEvent or issueEventTypeName matches
  return (
    expectedEvents.includes(webhookEvent) ||
    (issueEventTypeName !== undefined && expectedEvents.includes(issueEventTypeName))
  )
}

export function extractIssueData(body: any) {
  return {
    webhookEvent: body.webhookEvent,
    timestamp: body.timestamp,
    issue_event_type_name: body.issue_event_type_name,
    issue: body.issue || {},
    changelog: body.changelog,
  }
}

export function extractCommentData(body: any) {
  return {
    webhookEvent: body.webhookEvent,
    timestamp: body.timestamp,
    issue: body.issue || {},
    comment: body.comment || {},
  }
}

export function extractAttachmentData(body: any) {
  const attachment = body.attachment || {}
  return {
    webhookEvent: body.webhookEvent,
    timestamp: body.timestamp,
    issue: body.issue || {},
    attachment,
    hasAttachments: Boolean(attachment.content),
    attachments: [] as Array<{ name: string; data: string; mimeType: string; size: number }>,
  }
}

export function extractWorklogData(body: any) {
  return {
    webhookEvent: body.webhookEvent,
    timestamp: body.timestamp,
    issue: body.issue || {},
    worklog: body.worklog || {},
  }
}

export function extractSprintData(body: any) {
  return {
    webhookEvent: body.webhookEvent,
    timestamp: body.timestamp,
    sprint: body.sprint || {},
  }
}

export function extractProjectData(body: any) {
  return {
    webhookEvent: body.webhookEvent,
    timestamp: body.timestamp,
    project: body.project || {},
  }
}

export function extractVersionData(body: any) {
  return {
    webhookEvent: body.webhookEvent,
    timestamp: body.timestamp,
    version: body.version || {},
  }
}

export function extractBoardData(body: any) {
  return {
    webhookEvent: body.webhookEvent,
    timestamp: body.timestamp,
    board: body.board || {},
  }
}

export function extractIssueLinkData(body: any) {
  return {
    webhookEvent: body.webhookEvent,
    timestamp: body.timestamp,
    issueLink: body.issueLink || {},
  }
}
