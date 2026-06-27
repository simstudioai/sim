import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Shared trigger dropdown options for all Sentry triggers.
 */
export const sentryTriggerOptions = [
  { label: 'Issue Created', id: 'sentry_issue_created' },
  { label: 'Issue Resolved', id: 'sentry_issue_resolved' },
  { label: 'Error Created', id: 'sentry_error_created' },
  { label: 'Issue Alert Triggered', id: 'sentry_issue_alert' },
  { label: 'Metric Alert', id: 'sentry_metric_alert' },
]

/**
 * Generate HTML setup instructions for creating a Sentry Internal Integration
 * with a webhook. Sentry signs webhooks with the integration's Client Secret,
 * which the user pastes into the trigger configuration (manual setup model).
 */
export function sentrySetupInstructions(eventType: string): string {
  const instructions = [
    'In Sentry, go to <strong>Settings &gt; Developer Settings &gt; Custom Integrations</strong> (Internal Integration) and click <strong>Create New Integration</strong>.',
    'Give the integration a name, then paste the <strong>Webhook URL</strong> shown above into the <strong>Webhook URL</strong> field and toggle <strong>Alert Rule Action</strong> on if you plan to use alerts.',
    'Under <strong>Permissions</strong>, grant at least <strong>Read</strong> access to <strong>Issue &amp; Event</strong>.',
    `Under <strong>Webhooks</strong>, enable the resource for this trigger: <strong>${eventType}</strong>.`,
    'Click <strong>Save</strong>. Copy the generated <strong>Client Secret</strong> and paste it into the <strong>Client Secret</strong> field below.',
    'For <strong>Issue Alert</strong> and <strong>Metric Alert</strong> triggers, add this integration as an action on the relevant alert rule in <strong>Alerts</strong>.',
    'Click "Save" above to activate your trigger.',
  ]
  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * Extra fields shared by all Sentry triggers. The Client Secret is the
 * Internal Integration secret used to verify the `sentry-hook-signature`
 * HMAC-SHA256 header.
 */
export function buildSentryExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'clientSecret',
      title: 'Client Secret',
      type: 'short-input',
      placeholder: "Paste your Sentry Internal Integration's Client Secret",
      password: true,
      paramVisibility: 'user-only',
      required: true,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

/**
 * Common envelope fields present on every Sentry webhook payload.
 */
const commonEnvelopeOutputs = {
  action: {
    type: 'string',
    description: 'The action that triggered the webhook (e.g., created, resolved, triggered)',
  },
  installation: {
    type: 'json',
    description: 'Installation object containing the integration installation uuid',
  },
  actor: {
    type: 'json',
    description: 'Who triggered the webhook (user, the integration application, or Sentry)',
  },
} as const

/**
 * Output schema for issue webhooks (resource `issue`).
 * Payload envelope: { action, installation, data: { issue }, actor }.
 */
export function buildIssueOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonEnvelopeOutputs,
    issue: {
      id: { type: 'string', description: 'Issue ID' },
      shortId: { type: 'string', description: 'Short human-readable issue ID' },
      shareId: { type: 'string', description: 'Share ID for the issue' },
      title: { type: 'string', description: 'Issue title' },
      culprit: { type: 'string', description: 'Issue culprit (location/transaction)' },
      logger: { type: 'string', description: 'Logger name' },
      level: { type: 'string', description: 'Issue level (error, warning, etc.)' },
      status: { type: 'string', description: 'Issue status (unresolved, resolved, ignored)' },
      substatus: { type: 'string', description: 'Issue substatus' },
      statusDetails: { type: 'json', description: 'Status details (inRelease, inCommit, ignore*)' },
      platform: { type: 'string', description: 'Platform of the issue' },
      eventType: {
        type: 'string',
        description: "Issue type (the payload's `type` field; `type` is reserved)",
      },
      issueType: { type: 'string', description: 'Specific issue type classification' },
      issueCategory: { type: 'string', description: 'Issue category' },
      isUnhandled: { type: 'boolean', description: 'Whether the issue is unhandled' },
      isPublic: { type: 'boolean', description: 'Whether the issue is public' },
      isBookmarked: { type: 'boolean', description: 'Whether the issue is bookmarked' },
      isSubscribed: { type: 'boolean', description: 'Whether the viewer is subscribed' },
      hasSeen: { type: 'boolean', description: 'Whether the issue has been seen' },
      numComments: { type: 'number', description: 'Number of comments on the issue' },
      count: { type: 'string', description: 'Total event count' },
      userCount: { type: 'number', description: 'Number of affected users' },
      firstSeen: { type: 'string', description: 'Timestamp when first seen' },
      lastSeen: { type: 'string', description: 'Timestamp when last seen' },
      priority: { type: 'string', description: 'Issue priority' },
      assignedTo: { type: 'json', description: 'Assignee (user or team), or null' },
      annotations: { type: 'json', description: 'Issue annotations' },
      metadata: { type: 'json', description: 'Issue metadata (title, type, value, sdk, severity)' },
      project: {
        id: { type: 'string', description: 'Project ID' },
        name: { type: 'string', description: 'Project name' },
        slug: { type: 'string', description: 'Project slug' },
        platform: { type: 'string', description: 'Project platform' },
      },
      url: { type: 'string', description: 'API URL for the issue' },
      web_url: { type: 'string', description: 'Browser URL for the issue' },
      project_url: { type: 'string', description: 'Browser URL for the project' },
      permalink: { type: 'string', description: 'Permalink to the issue' },
    },
  }
}

/**
 * Output schema for error webhooks (resource `error`).
 * Payload envelope: { action, installation, data: { error }, actor }.
 */
export function buildErrorOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonEnvelopeOutputs,
    error: {
      event_id: { type: 'string', description: 'Unique event ID' },
      issue_id: { type: 'string', description: 'ID of the issue this error belongs to' },
      issue_url: { type: 'string', description: 'API URL of the issue' },
      project: { type: 'number', description: 'Project ID' },
      key_id: { type: 'string', description: 'Project key ID' },
      level: { type: 'string', description: 'Error level' },
      title: { type: 'string', description: 'Error title' },
      eventType: {
        type: 'string',
        description: "Event type (the payload's `type` field; `type` is reserved)",
      },
      message: { type: 'string', description: 'Error message' },
      culprit: { type: 'string', description: 'Error culprit (location/transaction)' },
      platform: { type: 'string', description: 'Platform' },
      logger: { type: 'string', description: 'Logger name' },
      timestamp: { type: 'number', description: 'Event timestamp (epoch seconds)' },
      datetime: { type: 'string', description: 'Event datetime (ISO 8601)' },
      received: { type: 'number', description: 'Received timestamp (epoch seconds)' },
      dist: { type: 'string', description: 'Distribution identifier' },
      release: { type: 'string', description: 'Release version' },
      fingerprint: { type: 'json', description: 'Grouping fingerprint' },
      tags: { type: 'json', description: 'Event tags' },
      user: { type: 'json', description: 'User context' },
      request: { type: 'json', description: 'HTTP request context' },
      contexts: { type: 'json', description: 'Additional contexts (browser, os, device)' },
      sdk: { type: 'json', description: 'SDK information' },
      exception: { type: 'json', description: 'Exception details including stack frames' },
      metadata: { type: 'json', description: 'Error metadata' },
      url: { type: 'string', description: 'API URL for the event' },
      web_url: { type: 'string', description: 'Browser URL for the event' },
    },
  }
}

/**
 * Output schema for issue alert webhooks (resource `event_alert`).
 * Payload envelope: { action: 'triggered', installation,
 *   data: { event, triggered_rule, issue_alert }, actor }.
 */
export function buildIssueAlertOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonEnvelopeOutputs,
    event: { type: 'json', description: 'The event that triggered the alert rule' },
    triggered_rule: { type: 'string', description: 'Label of the alert rule that was triggered' },
    issue_alert: {
      title: { type: 'string', description: 'Alert rule name' },
      settings: { type: 'json', description: 'Alert rule action settings (name/value pairs)' },
    },
  }
}

/**
 * Output schema for metric alert webhooks (resource `metric_alert`).
 * Payload envelope: { action: 'critical'|'warning'|'resolved', installation,
 *   data: { metric_alert, description_text, description_title }, actor }.
 */
export function buildMetricAlertOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonEnvelopeOutputs,
    metric_alert: {
      type: 'json',
      description: 'Metric alert object (alert_rule + incident details)',
    },
    description_text: { type: 'string', description: 'Human-friendly description of the alert' },
    description_title: { type: 'string', description: 'Human-friendly title of the alert' },
    web_url: { type: 'string', description: 'API URL for the incident' },
  }
}

/**
 * Maps each Sentry trigger ID to the `sentry-hook-resource` header value and
 * the allowed top-level `action` values. When `actions` is undefined, any
 * action for that resource matches.
 */
export const SENTRY_EVENT_MATCH: Record<string, { resource: string; actions?: string[] }> = {
  sentry_issue_created: { resource: 'issue', actions: ['created'] },
  sentry_issue_resolved: { resource: 'issue', actions: ['resolved'] },
  sentry_error_created: { resource: 'error', actions: ['created'] },
  sentry_issue_alert: { resource: 'event_alert', actions: ['triggered'] },
  sentry_metric_alert: { resource: 'metric_alert' },
}

/**
 * Check whether a Sentry webhook matches the configured trigger. The resource
 * comes from the `sentry-hook-resource` header and the action from the payload.
 */
export function isSentryEventMatch(
  triggerId: string,
  resource: string | null | undefined,
  action: string | null | undefined
): boolean {
  const match = SENTRY_EVENT_MATCH[triggerId]
  if (!match) {
    return true
  }
  if (!resource || resource !== match.resource) {
    return false
  }
  if (match.actions && (!action || !match.actions.includes(action))) {
    return false
  }
  return true
}
