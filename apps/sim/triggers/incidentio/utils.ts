import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Maps Sim incident.io trigger IDs to their incident.io webhook event type.
 * Event-type strings verified verbatim against the incident.io webhooks
 * OpenAPI spec (https://docs.incident.io/openapi/webhooks.json). Note the
 * alert event is versioned `_v1` (there is no `public_alert.alert_created_v2`).
 */
export const INCIDENTIO_TRIGGER_TO_EVENT_TYPE: Record<string, string> = {
  incidentio_incident_created: 'public_incident.incident_created_v2',
  incidentio_incident_updated: 'public_incident.incident_updated_v2',
  incidentio_incident_status_updated: 'public_incident.incident_status_updated_v2',
  incidentio_alert_created: 'public_alert.alert_created_v1',
}

/**
 * Shared trigger dropdown options for all incident.io triggers.
 */
export const incidentioTriggerOptions = [
  { label: 'Incident Created', id: 'incidentio_incident_created' },
  { label: 'Incident Updated', id: 'incidentio_incident_updated' },
  { label: 'Incident Status Updated', id: 'incidentio_incident_status_updated' },
  { label: 'Alert Created', id: 'incidentio_alert_created' },
]

/**
 * Generate setup instructions for a specific incident.io webhook event type.
 * incident.io webhooks are configured manually in the dashboard and secured
 * with a Svix signing secret that must be pasted into the trigger config.
 */
export function incidentioSetupInstructions(eventLabel: string): string {
  const instructions = [
    'Copy the <strong>Webhook URL</strong> above.',
    'In incident.io, go to <strong>Settings > Webhooks</strong> and click <strong>Add webhook endpoint</strong>. See the <a href="https://docs.incident.io/integrations/webhooks" target="_blank" rel="noopener noreferrer">incident.io webhooks documentation</a> for details.',
    'Paste the Webhook URL as the endpoint URL.',
    `Under <strong>Event types</strong>, enable <strong>${eventLabel}</strong>.`,
    'Save the endpoint, then open it and copy the <strong>Signing secret</strong> (starts with <code>whsec_</code>).',
    'Paste the signing secret into the <strong>Signing Secret</strong> field below so incoming events can be verified.',
    'Click <strong>"Save"</strong> above to activate your trigger.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * incident.io-specific extra fields.
 * The Svix signing secret is entered manually and used to verify webhook signatures.
 */
export function buildIncidentioExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'signingSecret',
      title: 'Signing Secret',
      type: 'short-input',
      placeholder: 'whsec_...',
      description:
        'The signing secret from your incident.io webhook endpoint. Used to verify events.',
      password: true,
      paramVisibility: 'user-only',
      required: true,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

/**
 * Outputs common to every incident.io webhook event.
 *
 * Field shapes are verified against the incident.io webhooks OpenAPI spec
 * (https://docs.incident.io/openapi/webhooks.json). Every event body is a
 * Svix envelope of the form:
 *   `{ "event_type": "<type>", "<type>": { ...entity... } }`
 */
const commonIncidentioOutputs: Record<string, TriggerOutput> = {
  event_type: {
    type: 'string',
    description:
      'incident.io event type (e.g., public_incident.incident_created_v2). Top-level `event_type` field.',
  },
  payload: {
    type: 'json',
    description: 'Full raw webhook body as delivered by incident.io (the entire Svix envelope).',
  },
}

/**
 * Build outputs for incident webhook events (created / updated / status updated).
 *
 * For `incident_created_v2` / `incident_updated_v2` the incident object sits
 * directly under the event-type key. For `incident_status_updated_v2` the
 * incident sits under `<type>.incident`, alongside `new_status`,
 * `previous_status`, and `message` — surfaced here as the `new_status`,
 * `previous_status`, and `update_message` outputs (null on the other events).
 */
export function buildIncidentioIncidentOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonIncidentioOutputs,
    incident: {
      type: 'json',
      description: 'The full incident object from the webhook payload.',
    },
    incident_id: {
      type: 'string',
      description: 'Unique incident ID (e.g., 01FDAG4SAP5TYPT98WGR2N7W91).',
    },
    name: { type: 'string', description: 'Incident name.' },
    reference: {
      type: 'string',
      description: 'Human-readable incident reference (e.g., INC-123).',
    },
    summary: { type: 'string', description: 'Incident summary, when set.' },
    incident_status: {
      type: 'json',
      description: 'The incident status object (id, name, category, rank).',
    },
    severity: {
      type: 'json',
      description: 'The incident severity object (id, name, rank), when set.',
    },
    mode: {
      type: 'string',
      description: 'Incident mode (standard, retrospective, test, tutorial, stream).',
    },
    visibility: { type: 'string', description: 'Incident visibility (public or private).' },
    permalink: {
      type: 'string',
      description: 'Link to the incident in incident.io, when present.',
    },
    created_at: {
      type: 'string',
      description: 'ISO 8601 timestamp when the incident was created.',
    },
    updated_at: {
      type: 'string',
      description: 'ISO 8601 timestamp when the incident was last updated.',
    },
    new_status: {
      type: 'json',
      description: 'New status object (status-updated events only; null otherwise).',
    },
    previous_status: {
      type: 'json',
      description: 'Previous status object (status-updated events only; null otherwise).',
    },
    update_message: {
      type: 'string',
      description:
        'Update message accompanying a status change (status-updated events only; null otherwise).',
    },
  }
}

/**
 * Build outputs for the alert created webhook event (`public_alert.alert_created_v1`).
 * The alert object sits directly under the event-type key.
 */
export function buildIncidentioAlertOutputs(): Record<string, TriggerOutput> {
  return {
    ...commonIncidentioOutputs,
    alert: {
      type: 'json',
      description: 'The full alert object from the webhook payload.',
    },
    alert_id: { type: 'string', description: 'Unique alert ID.' },
    title: { type: 'string', description: 'Alert title.' },
    description: { type: 'string', description: 'Alert description, when set.' },
    status: { type: 'string', description: 'Alert status (e.g., firing, resolved).' },
    alert_source_id: {
      type: 'string',
      description: 'ID of the alert source that raised the alert.',
    },
    deduplication_key: {
      type: 'string',
      description: 'Deduplication key for the alert, when set.',
    },
    source_url: {
      type: 'string',
      description: 'URL to the alert in the originating system, when set.',
    },
    created_at: { type: 'string', description: 'ISO 8601 timestamp when the alert was created.' },
    updated_at: {
      type: 'string',
      description: 'ISO 8601 timestamp when the alert was last updated.',
    },
    resolved_at: {
      type: 'string',
      description: 'ISO 8601 timestamp when the alert was resolved, when applicable.',
    },
  }
}

/**
 * Check whether an incident.io webhook event matches the expected trigger.
 */
export function isIncidentioEventMatch(triggerId: string, eventType: string): boolean {
  const expected = INCIDENTIO_TRIGGER_TO_EVENT_TYPE[triggerId]
  if (!expected) {
    return true
  }
  return expected === eventType
}
