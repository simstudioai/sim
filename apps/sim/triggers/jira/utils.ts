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
  { label: 'Worklog Created', id: 'jira_worklog_created' },
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
    provider: 'jira',
    serviceId: 'jira',
    requiredScopes: [
      'read:jira-work',
      'read:jira-user',
      'manage:jira-webhook', // Classic scope for webhook management
      'read:webhook:jira',
      'write:webhook:jira',
      'delete:webhook:jira',
      'read:issue-event:jira',
      'read:issue:jira', // Full issue data in webhook payloads
      'read:issue.changelog:jira', // Changelog data for update events
      'read:comment:jira', // Comment data for comment events
      'read:comment.property:jira',
      'read:issue.property:jira',
      'read:issue-worklog:jira', // Worklog data for worklog events
      'read:project:jira',
      'read:field:jira', // Required for webhook registration
      'read:jql:jira', // Required for JQL filtering
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
    '<strong>Note:</strong> You must have admin permissions in your Jira workspace to create webhooks.',
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

/**
 * Build comprehensive outputs for issue-related triggers
 */
export function buildIssueOutputs(): Record<string, TriggerOutput> {
  return {
    // Event metadata
    event_type: {
      type: 'string',
      description: 'The webhook event type (e.g., jira:issue_created, jira:issue_updated)',
    },
    issue_event_type_name: {
      type: 'string',
      description: 'Issue event type name from Jira',
    },
    timestamp: {
      type: 'number',
      description: 'Timestamp of the webhook event',
    },

    // Flattened issue fields for easy access
    issue_id: {
      type: 'string',
      description: 'Jira issue ID',
    },
    issue_key: {
      type: 'string',
      description: 'Jira issue key (e.g., PROJ-123)',
    },
    summary: {
      type: 'string',
      description: 'Issue summary/title',
    },
    description: {
      type: 'string',
      description: 'Issue description',
    },
    status: {
      type: 'string',
      description: 'Current issue status name',
    },
    status_id: {
      type: 'string',
      description: 'Current issue status ID',
    },
    priority: {
      type: 'string',
      description: 'Issue priority name',
    },
    priority_id: {
      type: 'string',
      description: 'Issue priority ID',
    },
    assignee: {
      type: 'string',
      description: 'Assignee display name',
    },
    assignee_id: {
      type: 'string',
      description: 'Assignee account ID',
    },
    reporter: {
      type: 'string',
      description: 'Reporter display name',
    },
    reporter_id: {
      type: 'string',
      description: 'Reporter account ID',
    },
    project_key: {
      type: 'string',
      description: 'Project key',
    },
    project_name: {
      type: 'string',
      description: 'Project name',
    },
    issue_type: {
      type: 'string',
      description: 'Issue type name (e.g., Bug, Task, Story)',
    },
    created_date: {
      type: 'string',
      description: 'Issue creation date (ISO format)',
    },
    updated_date: {
      type: 'string',
      description: 'Issue last updated date (ISO format)',
    },

    // User who triggered the event
    user_name: {
      type: 'string',
      description: 'Display name of user who triggered the event',
    },
    user_id: {
      type: 'string',
      description: 'Account ID of user who triggered the event',
    },
    user_email: {
      type: 'string',
      description: 'Email of user who triggered the event',
    },

    // Nested complete objects for detailed access
    jira: {
      type: 'json',
      description: 'Complete Jira webhook payload with issue, changelog, user, and event data',
    },
    issue: {
      type: 'json',
      description: 'Complete issue object from Jira',
    },
    changelog: {
      type: 'json',
      description: 'Changelog object (for update events) showing what fields changed',
    },
    user: {
      type: 'json',
      description: 'User object who triggered the event',
    },

    // Webhook metadata
    webhook: {
      type: 'json',
      description: 'Webhook metadata including provider, path, and raw payload',
    },
  }
}

/**
 * Build outputs for comment-related triggers
 */
export function buildCommentOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildIssueOutputs(),

    // Comment-specific fields
    comment_id: {
      type: 'string',
      description: 'Comment ID',
    },
    comment_body: {
      type: 'string',
      description: 'Comment text/body',
    },
    comment_author: {
      type: 'string',
      description: 'Comment author display name',
    },
    comment_author_id: {
      type: 'string',
      description: 'Comment author account ID',
    },
    comment_created: {
      type: 'string',
      description: 'Comment creation date (ISO format)',
    },
    comment_updated: {
      type: 'string',
      description: 'Comment last updated date (ISO format)',
    },

    comment: {
      type: 'json',
      description: 'Complete comment object',
    },
  }
}

/**
 * Build outputs for worklog-related triggers
 */
export function buildWorklogOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildIssueOutputs(),

    // Worklog-specific fields
    worklog_id: {
      type: 'string',
      description: 'Worklog entry ID',
    },
    worklog_author: {
      type: 'string',
      description: 'Worklog author display name',
    },
    worklog_author_id: {
      type: 'string',
      description: 'Worklog author account ID',
    },
    time_spent: {
      type: 'string',
      description: 'Time spent (e.g., "2h 30m")',
    },
    time_spent_seconds: {
      type: 'number',
      description: 'Time spent in seconds',
    },
    worklog_comment: {
      type: 'string',
      description: 'Worklog comment/description',
    },
    worklog_started: {
      type: 'string',
      description: 'When the work was started (ISO format)',
    },

    worklog: {
      type: 'json',
      description: 'Complete worklog object',
    },
  }
}

/**
 * Validates if a webhook event matches the expected trigger type
 */
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
    jira_worklog_created: ['worklog_created'],
    jira_worklog_updated: ['worklog_updated'],
    jira_worklog_deleted: ['worklog_deleted'],
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

/**
 * Extracts and flattens issue data from Jira webhook payload
 */
export function extractIssueData(body: any) {
  const issue = body.issue || {}
  const fields = issue.fields || {}
  const user = body.user || {}

  return {
    // Event metadata
    event_type: body.webhookEvent,
    issue_event_type_name: body.issue_event_type_name,
    timestamp: body.timestamp,

    // Flattened issue fields
    issue_id: issue.id,
    issue_key: issue.key,
    summary: fields.summary,
    description: fields.description,
    status: fields.status?.name,
    status_id: fields.status?.id,
    priority: fields.priority?.name,
    priority_id: fields.priority?.id,
    assignee: fields.assignee?.displayName,
    assignee_id: fields.assignee?.accountId,
    reporter: fields.reporter?.displayName,
    reporter_id: fields.reporter?.accountId,
    project_key: fields.project?.key,
    project_name: fields.project?.name,
    issue_type: fields.issuetype?.name,
    created_date: fields.created,
    updated_date: fields.updated,

    // User who triggered the event
    user_name: user.displayName,
    user_id: user.accountId,
    user_email: user.emailAddress,

    // Nested complete objects
    jira: {
      event: body.webhookEvent,
      issue: issue,
      changelog: body.changelog,
      user: user,
      timestamp: body.timestamp,
      matched_webhook_ids: body.matchedWebhookIds,
    },
    issue: issue,
    changelog: body.changelog,
    user: user,
  }
}

/**
 * Extracts comment data from Jira webhook payload
 */
export function extractCommentData(body: any) {
  const baseData = extractIssueData(body)
  const comment = body.comment || {}

  return {
    ...baseData,
    comment_id: comment.id,
    comment_body: comment.body,
    comment_author: comment.author?.displayName,
    comment_author_id: comment.author?.accountId,
    comment_created: comment.created,
    comment_updated: comment.updated,
    comment: comment,
  }
}

/**
 * Extracts worklog data from Jira webhook payload
 */
export function extractWorklogData(body: any) {
  const baseData = extractIssueData(body)
  const worklog = body.worklog || {}

  return {
    ...baseData,
    worklog_id: worklog.id,
    worklog_author: worklog.author?.displayName,
    worklog_author_id: worklog.author?.accountId,
    time_spent: worklog.timeSpent,
    time_spent_seconds: worklog.timeSpentSeconds,
    worklog_comment: worklog.comment,
    worklog_started: worklog.started,
    worklog: worklog,
  }
}
