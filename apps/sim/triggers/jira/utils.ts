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
  { label: 'Project Created', id: 'jira_project_created' },
  { label: 'Version Released', id: 'jira_version_released' },
  { label: 'Generic Webhook (All Events)', id: 'jira_webhook' },
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
    user: {
      displayName: {
        type: 'string',
        description: 'Display name of the user who triggered the event',
      },
      accountId: {
        type: 'string',
        description: 'Account ID of the user who triggered the event',
      },
      emailAddress: {
        type: 'string',
        description: 'Email address of the user who triggered the event',
      },
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
            description:
              'Email address (Jira Server only — not available in Jira Cloud webhook payloads)',
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
        description: {
          type: 'json',
          description:
            'Issue description in Atlassian Document Format (ADF). On Jira Server this may be a plain string.',
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
            description:
              'Email address (Jira Server only — not available in Jira Cloud webhook payloads)',
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
            description:
              'Email address (Jira Server only — not available in Jira Cloud webhook payloads)',
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
        components: {
          type: 'array',
          description: 'Array of component objects associated with this issue',
        },
        fixVersions: {
          type: 'array',
          description: 'Array of fix version objects for this issue',
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
      self: {
        type: 'string',
        description: 'REST API URL for this comment',
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
      updateAuthor: {
        displayName: {
          type: 'string',
          description: 'Display name of the user who last updated the worklog',
        },
        accountId: {
          type: 'string',
          description: 'Account ID of the user who last updated the worklog',
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
      created: {
        type: 'string',
        description: 'When the worklog entry was created (ISO format)',
      },
      updated: {
        type: 'string',
        description: 'When the worklog entry was last updated (ISO format)',
      },
      issueId: {
        type: 'string',
        description: 'ID of the issue this worklog belongs to',
      },
      self: {
        type: 'string',
        description: 'REST API URL for this worklog entry',
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
    jira_project_created: ['project_created'],
    jira_version_released: ['jira:version_released'],
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

export function extractIssueData(body: unknown) {
  const obj = body as Record<string, unknown>
  return {
    webhookEvent: obj.webhookEvent,
    timestamp: obj.timestamp,
    user: obj.user || null,
    issue_event_type_name: obj.issue_event_type_name,
    issue: obj.issue || {},
    changelog: obj.changelog,
  }
}

export function extractCommentData(body: unknown) {
  const obj = body as Record<string, unknown>
  return {
    webhookEvent: obj.webhookEvent,
    timestamp: obj.timestamp,
    user: obj.user || null,
    issue: obj.issue || {},
    comment: obj.comment || {},
  }
}

export function extractWorklogData(body: unknown) {
  const obj = body as Record<string, unknown>
  return {
    webhookEvent: obj.webhookEvent,
    timestamp: obj.timestamp,
    user: obj.user || null,
    issue: obj.issue || {},
    worklog: obj.worklog || {},
  }
}

/**
 * Builds output schema for sprint-related webhook events
 */
export function buildSprintOutputs(): Record<string, TriggerOutput> {
  return {
    webhookEvent: {
      type: 'string',
      description: 'The webhook event type (e.g., sprint_started, sprint_closed)',
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
      emailAddress: {
        type: 'string',
        description: 'Email address of the user who triggered the event',
      },
    },
    sprint: {
      id: {
        type: 'number',
        description: 'Sprint ID',
      },
      self: {
        type: 'string',
        description: 'REST API URL for this sprint',
      },
      state: {
        type: 'string',
        description: 'Sprint state (future, active, closed)',
      },
      name: {
        type: 'string',
        description: 'Sprint name',
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
      originBoardId: {
        type: 'number',
        description: 'Board ID the sprint belongs to',
      },
      goal: {
        type: 'string',
        description: 'Sprint goal',
      },
      createdDate: {
        type: 'string',
        description: 'Sprint creation date (ISO format)',
      },
    },
  }
}

/**
 * Builds output schema for project_created webhook events
 */
export function buildProjectCreatedOutputs(): Record<string, TriggerOutput> {
  return {
    webhookEvent: {
      type: 'string',
      description: 'The webhook event type (project_created)',
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
      emailAddress: {
        type: 'string',
        description: 'Email address of the user who triggered the event',
      },
    },
    project: {
      id: {
        type: 'string',
        description: 'Project ID',
      },
      key: {
        type: 'string',
        description: 'Project key',
      },
      name: {
        type: 'string',
        description: 'Project name',
      },
      self: {
        type: 'string',
        description: 'REST API URL for this project',
      },
      projectTypeKey: {
        type: 'string',
        description: 'Project type (e.g., software, business)',
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

/**
 * Builds output schema for version_released webhook events
 */
export function buildVersionReleasedOutputs(): Record<string, TriggerOutput> {
  return {
    webhookEvent: {
      type: 'string',
      description: 'The webhook event type (jira:version_released)',
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
      emailAddress: {
        type: 'string',
        description: 'Email address of the user who triggered the event',
      },
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
      self: {
        type: 'string',
        description: 'REST API URL for this version',
      },
      released: {
        type: 'boolean',
        description: 'Whether the version is released',
      },
      releaseDate: {
        type: 'string',
        description: 'Release date (ISO format)',
      },
      projectId: {
        type: 'number',
        description: 'Project ID the version belongs to',
      },
      description: {
        type: 'string',
        description: 'Version description',
      },
      archived: {
        type: 'boolean',
        description: 'Whether the version is archived',
      },
    },
  }
}

/**
 * Extracts sprint data from a Jira webhook payload
 */
export function extractSprintData(body: unknown) {
  const obj = body as Record<string, unknown>
  return {
    webhookEvent: obj.webhookEvent,
    timestamp: obj.timestamp,
    user: obj.user || null,
    sprint: obj.sprint || {},
  }
}

/**
 * Extracts project data from a Jira webhook payload
 */
export function extractProjectData(body: unknown) {
  const obj = body as Record<string, unknown>
  return {
    webhookEvent: obj.webhookEvent,
    timestamp: obj.timestamp,
    user: obj.user || null,
    project: obj.project || {},
  }
}

/**
 * Extracts version data from a Jira webhook payload
 */
export function extractVersionData(body: unknown) {
  const obj = body as Record<string, unknown>
  return {
    webhookEvent: obj.webhookEvent,
    timestamp: obj.timestamp,
    user: obj.user || null,
    version: obj.version || {},
  }
}
