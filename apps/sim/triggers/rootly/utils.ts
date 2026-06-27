import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Shared trigger dropdown options for all Rootly triggers.
 * IDs map to Rootly webhook event type strings via {@link ROOTLY_EVENT_TYPE_MAP}.
 */
export const rootlyTriggerOptions = [
  { label: 'Incident Created', id: 'rootly_incident_created' },
  { label: 'Incident Updated', id: 'rootly_incident_updated' },
  { label: 'Incident Resolved', id: 'rootly_incident_resolved' },
  { label: 'Alert Created', id: 'rootly_alert_created' },
]

/**
 * Maps a Sim trigger ID to the exact Rootly webhook event type string.
 * Source: https://docs.rootly.com/configuration/webhooks
 */
export const ROOTLY_EVENT_TYPE_MAP: Record<string, string> = {
  rootly_incident_created: 'incident.created',
  rootly_incident_updated: 'incident.updated',
  rootly_incident_resolved: 'incident.resolved',
  rootly_alert_created: 'alert.created',
}

/**
 * Generate setup instructions for a specific Rootly event type.
 * Rootly webhook endpoints are created and torn down programmatically via the
 * Rootly API, so the user only needs to provide an API key — Sim registers the
 * endpoint and manages its signing secret automatically.
 */
export function rootlySetupInstructions(eventType: string): string {
  const instructions = [
    'In Rootly, go to <strong>Settings &gt; API Keys</strong> and generate (or copy) an API key.',
    'Paste the API key into the <strong>API Key</strong> field below.',
    `When you save, Sim creates a Rootly webhook endpoint subscribed to the <strong>${eventType}</strong> event and verifies request signatures automatically — no manual webhook setup needed.`,
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
 * Resolve the Rootly webhook `event_types` array to subscribe an endpoint to,
 * based on the configured Sim trigger. Unknown/generic trigger IDs subscribe to
 * every supported event type.
 */
export function rootlyEventTypesForTrigger(triggerId: string | undefined): string[] {
  const mapped = triggerId ? ROOTLY_EVENT_TYPE_MAP[triggerId] : undefined
  if (mapped) return [mapped]
  return Object.values(ROOTLY_EVENT_TYPE_MAP)
}

/**
 * Extra config fields for Rootly triggers. The Rootly webhook endpoint is
 * registered via API, so the user supplies an API key (masked) instead of
 * pasting a signing secret — Sim generates and stores the secret itself.
 */
export function buildRootlyExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Rootly API key',
      password: true,
      required: true,
      paramVisibility: 'user-only',
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

/**
 * Output schema for Rootly incident events (incident.created/updated/resolved).
 * `data` mirrors the documented Rootly incident resource. Field names are taken
 * verbatim from https://docs.rootly.com/configuration/event-payloads.
 */
export function buildRootlyIncidentOutputs(): Record<string, TriggerOutput> {
  return {
    eventId: { type: 'string', description: 'Unique webhook event ID' },
    eventType: { type: 'string', description: 'Rootly event type (e.g. incident.created)' },
    issuedAt: { type: 'string', description: 'When the event was issued (ISO 8601)' },
    data: {
      id: { type: 'string', description: 'Incident ID' },
      sequential_id: { type: 'number', description: 'Sequential incident number' },
      title: { type: 'string', description: 'Incident title' },
      public_title: { type: 'string', description: 'Public-facing incident title' },
      slug: { type: 'string', description: 'Incident slug' },
      kind: { type: 'string', description: 'Incident kind (normal, test, etc.)' },
      private: { type: 'boolean', description: 'Whether the incident is private' },
      summary: { type: 'string', description: 'Incident summary' },
      status: { type: 'string', description: 'Incident status' },
      url: { type: 'string', description: 'Incident URL in Rootly' },
      short_url: { type: 'string', description: 'Shortened incident URL' },
      mitigation_message: { type: 'string', description: 'Mitigation message' },
      resolution_message: { type: 'string', description: 'Resolution message' },
      cancellation_message: { type: 'string', description: 'Cancellation message' },
      slack_channel_name: { type: 'string', description: 'Linked Slack channel name' },
      slack_channel_id: { type: 'string', description: 'Linked Slack channel ID' },
      slack_channel_url: { type: 'string', description: 'Linked Slack channel URL' },
      started_at: { type: 'string', description: 'When the incident started' },
      detected_at: { type: 'string', description: 'When the incident was detected' },
      acknowledged_at: { type: 'string', description: 'When the incident was acknowledged' },
      mitigated_at: { type: 'string', description: 'When the incident was mitigated' },
      resolved_at: { type: 'string', description: 'When the incident was resolved' },
      cancelled_at: { type: 'string', description: 'When the incident was cancelled' },
      created_at: { type: 'string', description: 'Incident creation timestamp' },
      updated_at: { type: 'string', description: 'Incident last update timestamp' },
      labels: { type: 'json', description: 'Incident labels (key-value pairs)' },
      severity: { type: 'json', description: 'Incident severity object' },
      user: { type: 'json', description: 'User who owns the incident' },
      started_by: { type: 'json', description: 'User who started the incident' },
      mitigated_by: { type: 'json', description: 'User who mitigated the incident' },
      resolved_by: { type: 'json', description: 'User who resolved the incident' },
      cancelled_by: { type: 'json', description: 'User who cancelled the incident' },
      roles: { type: 'json', description: 'Assigned incident roles' },
      environments: { type: 'json', description: 'Affected environments' },
      incident_types: { type: 'json', description: 'Incident types' },
      services: { type: 'json', description: 'Affected services' },
      functionalities: { type: 'json', description: 'Affected functionalities' },
      groups: { type: 'json', description: 'Associated teams/groups' },
      events: { type: 'json', description: 'Timeline events' },
      action_items: { type: 'json', description: 'Action items' },
      incident_post_mortem: { type: 'json', description: 'Retrospective/post-mortem object' },
    },
  }
}

/**
 * Output schema for Rootly alert events (alert.created).
 * Field names are taken verbatim from the documented Rootly alert resource:
 * https://docs.rootly.com/configuration/event-payloads.
 */
export function buildRootlyAlertOutputs(): Record<string, TriggerOutput> {
  return {
    eventId: { type: 'string', description: 'Unique webhook event ID' },
    eventType: { type: 'string', description: 'Rootly event type (e.g. alert.created)' },
    issuedAt: { type: 'string', description: 'When the event was issued (ISO 8601)' },
    data: {
      id: { type: 'string', description: 'Alert ID' },
      team_id: { type: 'number', description: 'Team ID' },
      source: { type: 'string', description: 'Alert source (e.g. pagerduty)' },
      summary: { type: 'string', description: 'Alert summary' },
      labels: { type: 'json', description: 'Alert labels' },
      data: { type: 'json', description: 'Raw alert payload data' },
      external_id: { type: 'string', description: 'External alert ID' },
      external_url: { type: 'string', description: 'External alert URL' },
      webhook_type: { type: 'string', description: 'Webhook type' },
      webhook_id: { type: 'string', description: 'Webhook ID' },
      webhook_idempotency_key: { type: 'string', description: 'Webhook idempotency key' },
      started_at: { type: 'string', description: 'When the alert started' },
      ended_at: { type: 'string', description: 'When the alert ended' },
      deleted_at: { type: 'string', description: 'When the alert was deleted' },
      created_at: { type: 'string', description: 'Alert creation timestamp' },
      updated_at: { type: 'string', description: 'Alert last update timestamp' },
    },
  }
}

/**
 * Check whether an incoming Rootly event type matches the configured trigger.
 * Unknown trigger IDs are allowed through.
 */
export function isRootlyEventMatch(triggerId: string, eventType: string): boolean {
  const expected = ROOTLY_EVENT_TYPE_MAP[triggerId]
  if (!expected) {
    return true
  }
  return expected === eventType
}
