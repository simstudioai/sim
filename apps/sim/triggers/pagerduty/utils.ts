import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Shared trigger dropdown options for all PagerDuty triggers
 */
export const pagerdutyTriggerOptions = [
  { label: 'Incident Triggered', id: 'pagerduty_incident_triggered' },
  { label: 'Incident Acknowledged', id: 'pagerduty_incident_acknowledged' },
  { label: 'Incident Resolved', id: 'pagerduty_incident_resolved' },
  { label: 'Incident Escalated', id: 'pagerduty_incident_escalated' },
  { label: 'Incident Reassigned', id: 'pagerduty_incident_reassigned' },
  { label: 'All Incident Events', id: 'pagerduty_webhook' },
]

/**
 * Maps each PagerDuty trigger to the V3 webhook `event_type` it listens for.
 * `pagerduty_webhook` is intentionally absent — it matches every incident event.
 */
const TRIGGER_EVENT_TYPES: Record<string, string> = {
  pagerduty_incident_triggered: 'incident.triggered',
  pagerduty_incident_acknowledged: 'incident.acknowledged',
  pagerduty_incident_resolved: 'incident.resolved',
  pagerduty_incident_escalated: 'incident.escalated',
  pagerduty_incident_reassigned: 'incident.reassigned',
}

/**
 * Returns the V3 webhook event types to subscribe to for a given trigger.
 * `pagerduty_webhook` subscribes to every supported incident event.
 */
export function getPagerDutyEvents(triggerId: string): string[] {
  const specific = TRIGGER_EVENT_TYPES[triggerId]
  return specific ? [specific] : Object.values(TRIGGER_EVENT_TYPES)
}

/**
 * Generate setup instructions for a specific PagerDuty incident event. The
 * webhook is created automatically on deploy, so the user only supplies an API key.
 */
export function pagerdutySetupInstructions(eventLabel: string): string {
  const instructions = [
    'Create a <strong>General Access REST API Key</strong> under <strong>PagerDuty &gt; Integrations &gt; API Access Keys</strong>.',
    'Enter the API key above.',
    `Deploy the workflow — Sim creates the account-level webhook subscription in PagerDuty automatically and listens for <strong>${eventLabel}</strong>.`,
    'Undeploying the workflow removes the webhook subscription from PagerDuty.',
  ]
  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * API key Sim uses to create and delete the PagerDuty webhook subscription.
 */
export function buildPagerDutyExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'PagerDuty General Access REST API key',
      description: 'Used to create the webhook subscription. Must be a read/write REST API key.',
      password: true,
      paramVisibility: 'user-only',
      required: true,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

/**
 * Output schema shared by every PagerDuty incident trigger — V3 webhook
 * payloads share the same `event` envelope and `event.data` incident shape.
 */
export function buildPagerDutyIncidentOutputs(): Record<string, TriggerOutput> {
  return {
    event_id: { type: 'string', description: 'Unique ID of the webhook event' },
    event_type: {
      type: 'string',
      description: 'Event type (e.g. incident.triggered, incident.resolved)',
    },
    occurred_at: { type: 'string', description: 'When the event occurred (ISO 8601)' },
    agent: {
      type: 'json',
      description: 'The user or service that caused the event (may be null)',
    },
    incident: {
      id: { type: 'string', description: 'Incident ID' },
      number: { type: 'number', description: 'Incident number' },
      title: { type: 'string', description: 'Incident title' },
      status: {
        type: 'string',
        description: 'Incident status (triggered, acknowledged, resolved)',
      },
      urgency: { type: 'string', description: 'Incident urgency (high or low)' },
      html_url: { type: 'string', description: 'Web URL of the incident' },
      created_at: { type: 'string', description: 'Incident creation timestamp' },
      priority: { type: 'string', description: 'Priority label (may be null)' },
      service: {
        id: { type: 'string', description: 'Service ID' },
        summary: { type: 'string', description: 'Service name' },
        html_url: { type: 'string', description: 'Service web URL' },
      },
      escalation_policy: {
        id: { type: 'string', description: 'Escalation policy ID' },
        summary: { type: 'string', description: 'Escalation policy name' },
        html_url: { type: 'string', description: 'Escalation policy web URL' },
      },
      assignees: {
        type: 'json',
        description: 'Array of assignee references ({ id, summary, html_url })',
      },
    },
  }
}

/**
 * Returns true when an incoming V3 webhook event matches the configured trigger.
 */
export function isPagerDutyEventMatch(triggerId: string, eventType: string): boolean {
  const expected = TRIGGER_EVENT_TYPES[triggerId]
  if (!expected) {
    return true
  }
  return expected === eventType
}
