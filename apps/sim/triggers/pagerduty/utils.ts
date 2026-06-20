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
 * Generate setup instructions for a specific PagerDuty incident event.
 */
export function pagerdutySetupInstructions(eventLabel: string): string {
  const instructions = [
    'In PagerDuty, go to <strong>Integrations &gt; Generic Webhooks (v3)</strong> and click <strong>New Webhook</strong>.',
    'Paste the <strong>Webhook URL</strong> above into the <strong>Webhook URL</strong> field.',
    'Scope the webhook to your <strong>account</strong>, <strong>service</strong>, or <strong>team</strong> as needed.',
    `Under <strong>Event Subscription</strong>, select <strong>${eventLabel}</strong>.`,
    'After saving, PagerDuty shows a <strong>signing secret once</strong> — copy it and paste it into the <strong>Signing Secret</strong> field above to verify deliveries.',
  ]
  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * Signing secret field used to verify the X-PagerDuty-Signature HMAC.
 */
export function buildPagerDutyExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'webhookSecret',
      title: 'Signing Secret',
      type: 'short-input',
      placeholder: 'Paste the signing secret shown when you created the webhook',
      description:
        'Validates that webhook deliveries originate from PagerDuty (X-PagerDuty-Signature).',
      password: true,
      paramVisibility: 'user-only',
      required: false,
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
