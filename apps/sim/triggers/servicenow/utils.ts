import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Shared trigger dropdown options for all ServiceNow triggers
 */
export const servicenowTriggerOptions = [
  { label: 'Incident Created', id: 'servicenow_incident_created' },
  { label: 'Incident Updated', id: 'servicenow_incident_updated' },
  { label: 'Change Request Created', id: 'servicenow_change_request_created' },
  { label: 'Change Request Updated', id: 'servicenow_change_request_updated' },
  { label: 'Generic Webhook (All Events)', id: 'servicenow_webhook' },
]

/**
 * Generates setup instructions for ServiceNow webhooks.
 * ServiceNow uses Business Rules with RESTMessageV2 for outbound webhooks.
 */
export function servicenowSetupInstructions(eventType: string): string {
  const instructions = [
    '<strong>Note:</strong> You need admin or developer permissions in your ServiceNow instance to create Business Rules.',
    'Navigate to <strong>System Definition > Business Rules</strong> and create a new Business Rule.',
    `Set the table (e.g., <strong>incident</strong>, <strong>change_request</strong>), set <strong>When</strong> to <strong>after</strong>, and check <strong>${eventType}</strong>.`,
    'Check the <strong>Advanced</strong> checkbox to enable the script editor.',
    'Copy the <strong>Webhook URL</strong> above and generate a <strong>Webhook Secret</strong> (any strong random string). Paste the secret in the <strong>Webhook Secret</strong> field here.',
    `In the script, use <strong>RESTMessageV2</strong> to POST the record data as JSON to the <strong>Webhook URL</strong> above. Include the secret as <code>Authorization: Bearer &lt;your secret&gt;</code> or <code>X-Sim-Webhook-Secret: &lt;your secret&gt;</code>. Example:<br/><code style="font-size: 0.85em; display: block; margin-top: 4px; white-space: pre-wrap;">var r = new sn_ws.RESTMessageV2();\nr.setEndpoint("&lt;webhook_url&gt;");\nr.setHttpMethod("POST");\nr.setRequestHeader("Content-Type", "application/json");\nr.setRequestHeader("Authorization", "Bearer &lt;your_webhook_secret&gt;");\nr.setRequestBody(JSON.stringify({\n  sysId: current.sys_id.toString(),\n  number: current.number.toString(),\n  shortDescription: current.short_description.toString(),\n  state: current.state.toString(),\n  priority: current.priority.toString()\n}));\nr.execute();</code>`,
    'Activate the Business Rule and click "Save" above to activate your trigger.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3">${index === 0 ? instruction : `<strong>${index}.</strong> ${instruction}`}</div>`
    )
    .join('')
}

/**
 * Webhook secret field for ServiceNow triggers
 */
function servicenowWebhookSecretField(triggerId: string): SubBlockConfig {
  return {
    id: 'webhookSecret',
    title: 'Webhook Secret',
    type: 'short-input',
    placeholder: 'Generate a secret and paste it here',
    description:
      'Required. Use the same value in your ServiceNow Business Rule as Bearer token or X-Sim-Webhook-Secret.',
    password: true,
    required: true,
    mode: 'trigger',
    condition: { field: 'selectedTriggerId', value: triggerId },
  }
}

/**
 * Extra fields for ServiceNow triggers (webhook secret + optional table filter)
 */
export function buildServiceNowExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    servicenowWebhookSecretField(triggerId),
    {
      id: 'tableName',
      title: 'Table Name (Optional)',
      type: 'short-input',
      placeholder: 'e.g., incident, change_request',
      description: 'Optionally filter to a specific ServiceNow table',
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

/**
 * Common record fields shared across ServiceNow trigger outputs
 */
function buildRecordOutputs(): Record<string, TriggerOutput> {
  return {
    sysId: { type: 'string', description: 'Unique system ID of the record' },
    number: { type: 'string', description: 'Record number (e.g., INC0010001, CHG0010001)' },
    tableName: { type: 'string', description: 'ServiceNow table name' },
    shortDescription: { type: 'string', description: 'Short description of the record' },
    description: { type: 'string', description: 'Full description of the record' },
    state: { type: 'string', description: 'Current state of the record' },
    priority: {
      type: 'string',
      description: 'Priority level (1=Critical, 2=High, 3=Moderate, 4=Low, 5=Planning)',
    },
    assignedTo: { type: 'string', description: 'User assigned to this record' },
    assignmentGroup: { type: 'string', description: 'Group assigned to this record' },
    createdBy: { type: 'string', description: 'User who created the record' },
    createdOn: { type: 'string', description: 'When the record was created (ISO 8601)' },
    updatedBy: { type: 'string', description: 'User who last updated the record' },
    updatedOn: { type: 'string', description: 'When the record was last updated (ISO 8601)' },
  }
}

/**
 * Outputs for incident triggers
 */
export function buildIncidentOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildRecordOutputs(),
    urgency: { type: 'string', description: 'Urgency level (1=High, 2=Medium, 3=Low)' },
    impact: { type: 'string', description: 'Impact level (1=High, 2=Medium, 3=Low)' },
    category: { type: 'string', description: 'Incident category' },
    subcategory: { type: 'string', description: 'Incident subcategory' },
    caller: { type: 'string', description: 'Caller/requester of the incident' },
    resolvedBy: { type: 'string', description: 'User who resolved the incident' },
    resolvedAt: { type: 'string', description: 'When the incident was resolved' },
    closeNotes: { type: 'string', description: 'Notes added when the incident was closed' },
    record: { type: 'json', description: 'Full incident record data' },
  }
}

/**
 * Outputs for change request triggers
 */
export function buildChangeRequestOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildRecordOutputs(),
    type: { type: 'string', description: 'Change type (Normal, Standard, Emergency)' },
    risk: { type: 'string', description: 'Risk level of the change' },
    impact: { type: 'string', description: 'Impact level of the change' },
    approval: { type: 'string', description: 'Approval status' },
    startDate: { type: 'string', description: 'Planned start date' },
    endDate: { type: 'string', description: 'Planned end date' },
    category: { type: 'string', description: 'Change category' },
    record: { type: 'json', description: 'Full change request record data' },
  }
}

function normalizeToken(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

/**
 * Extracts the table name from a ServiceNow webhook payload.
 * Business Rule scripts can send tableName in multiple formats.
 */
function extractTableName(body: Record<string, unknown>): string | undefined {
  const candidates = [body.tableName, body.table_name, body.table, body.sys_class_name]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      return c.trim()
    }
  }
  return undefined
}

/**
 * Extracts the event type from a ServiceNow webhook payload.
 */
function extractEventType(body: Record<string, unknown>): string | undefined {
  const candidates = [body.eventType, body.event_type, body.action, body.operation]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      return c.trim()
    }
  }
  return undefined
}

const INCIDENT_CREATED = new Set([
  'incident_created',
  'insert',
  'created',
  'create',
  'after_insert',
  'afterinsert',
])

const INCIDENT_UPDATED = new Set([
  'incident_updated',
  'update',
  'updated',
  'after_update',
  'afterupdate',
])

const CHANGE_REQUEST_CREATED = new Set([
  'change_request_created',
  'insert',
  'created',
  'create',
  'after_insert',
  'afterinsert',
])

const CHANGE_REQUEST_UPDATED = new Set([
  'change_request_updated',
  'update',
  'updated',
  'after_update',
  'afterupdate',
])

/**
 * Checks whether a ServiceNow webhook payload matches the configured trigger.
 * Used by the ServiceNow provider handler to filter events at runtime.
 */
export function isServiceNowEventMatch(
  triggerId: string,
  body: Record<string, unknown>,
  configuredTableName?: string
): boolean {
  const payloadTable = extractTableName(body)
  const eventType = extractEventType(body)

  if (triggerId === 'servicenow_webhook') {
    if (!configuredTableName?.trim()) {
      return true
    }
    if (!payloadTable) {
      return true
    }
    return normalizeToken(payloadTable) === normalizeToken(configuredTableName)
  }

  if (triggerId === 'servicenow_incident_created' || triggerId === 'servicenow_incident_updated') {
    if (configuredTableName?.trim()) {
      if (payloadTable && normalizeToken(payloadTable) !== normalizeToken(configuredTableName)) {
        return false
      }
    } else if (payloadTable && normalizeToken(payloadTable) !== 'incident') {
      return false
    }

    if (!eventType) {
      return true
    }

    const normalized = normalizeToken(eventType)
    return triggerId === 'servicenow_incident_created'
      ? INCIDENT_CREATED.has(normalized)
      : INCIDENT_UPDATED.has(normalized)
  }

  if (
    triggerId === 'servicenow_change_request_created' ||
    triggerId === 'servicenow_change_request_updated'
  ) {
    if (configuredTableName?.trim()) {
      if (payloadTable && normalizeToken(payloadTable) !== normalizeToken(configuredTableName)) {
        return false
      }
    } else if (payloadTable && normalizeToken(payloadTable) !== 'change_request') {
      return false
    }

    if (!eventType) {
      return true
    }

    const normalized = normalizeToken(eventType)
    return triggerId === 'servicenow_change_request_created'
      ? CHANGE_REQUEST_CREATED.has(normalized)
      : CHANGE_REQUEST_UPDATED.has(normalized)
  }

  return true
}

/**
 * Outputs for the generic webhook trigger (all events)
 */
export function buildServiceNowWebhookOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildRecordOutputs(),
    eventType: {
      type: 'string',
      description: 'The type of event that triggered this workflow (e.g., insert, update, delete)',
    },
    category: { type: 'string', description: 'Record category' },
    record: { type: 'json', description: 'Full record data from the webhook payload' },
  }
}
