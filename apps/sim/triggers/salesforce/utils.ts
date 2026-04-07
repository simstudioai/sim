import { extractSalesforceObjectTypeFromPayload } from '@/lib/webhooks/providers/salesforce'
import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Dropdown options for the Salesforce trigger type selector.
 */
export const salesforceTriggerOptions = [
  { label: 'Record Created', id: 'salesforce_record_created' },
  { label: 'Record Updated', id: 'salesforce_record_updated' },
  { label: 'Record Deleted', id: 'salesforce_record_deleted' },
  { label: 'Opportunity Stage Changed', id: 'salesforce_opportunity_stage_changed' },
  { label: 'Case Status Changed', id: 'salesforce_case_status_changed' },
  { label: 'Generic Webhook (All Events)', id: 'salesforce_webhook' },
]

function normalizeToken(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

const RECORD_CREATED = new Set([
  'record_created',
  'created',
  'create',
  'after_insert',
  'afterinsert',
  'insert',
])

const RECORD_UPDATED = new Set([
  'record_updated',
  'updated',
  'update',
  'after_update',
  'afterupdate',
])

const RECORD_DELETED = new Set([
  'record_deleted',
  'deleted',
  'delete',
  'after_delete',
  'afterdelete',
])

const OPP_STAGE = new Set([
  'opportunity_stage_changed',
  'stage_changed',
  'stage_change',
  'opportunity_stage_change',
  'opportunitystagechanged',
])

const CASE_STATUS = new Set([
  'case_status_changed',
  'status_changed',
  'status_change',
  'case_status_change',
  'casestatuschanged',
])

function matchesRecordTrigger(triggerId: string, normalizedEvent: string): boolean {
  if (triggerId === 'salesforce_record_created') {
    return RECORD_CREATED.has(normalizedEvent)
  }
  if (triggerId === 'salesforce_record_updated') {
    return RECORD_UPDATED.has(normalizedEvent)
  }
  if (triggerId === 'salesforce_record_deleted') {
    return RECORD_DELETED.has(normalizedEvent)
  }
  return false
}

/**
 * Server-side filter for Salesforce Flow (JSON) payloads.
 * Users should send a string `eventType` (or `simEventType`) from the Flow body.
 * Optional `objectType` in provider config is enforced against payload when set.
 */
export function isSalesforceEventMatch(
  triggerId: string,
  body: Record<string, unknown>,
  configuredObjectType?: string
): boolean {
  if (triggerId === 'salesforce_webhook') {
    const want = configuredObjectType?.trim()
    if (!want) {
      return true
    }
    const got = extractSalesforceObjectTypeFromPayload(body)
    if (!got) {
      return false
    }
    return normalizeToken(got) === normalizeToken(want)
  }

  const wantType = configuredObjectType?.trim()
  const gotType = extractSalesforceObjectTypeFromPayload(body)
  if (wantType) {
    if (!gotType) {
      return false
    }
    if (normalizeToken(gotType) !== normalizeToken(wantType)) {
      return false
    }
  }

  if (triggerId === 'salesforce_opportunity_stage_changed') {
    if (gotType && normalizeToken(gotType) !== 'opportunity') {
      return false
    }
    const etRaw =
      (typeof body.eventType === 'string' && body.eventType) ||
      (typeof body.simEventType === 'string' && body.simEventType) ||
      ''
    if (!etRaw.trim()) {
      return Boolean(gotType && normalizeToken(gotType) === 'opportunity')
    }
    return OPP_STAGE.has(normalizeToken(etRaw))
  }

  if (triggerId === 'salesforce_case_status_changed') {
    if (gotType && normalizeToken(gotType) !== 'case') {
      return false
    }
    const etRaw =
      (typeof body.eventType === 'string' && body.eventType) ||
      (typeof body.simEventType === 'string' && body.simEventType) ||
      ''
    if (!etRaw.trim()) {
      return Boolean(gotType && normalizeToken(gotType) === 'case')
    }
    return CASE_STATUS.has(normalizeToken(etRaw))
  }

  const etRaw =
    (typeof body.eventType === 'string' && body.eventType) ||
    (typeof body.simEventType === 'string' && body.simEventType) ||
    ''

  if (!etRaw.trim()) {
    return false
  }

  const normalized = normalizeToken(etRaw)
  return matchesRecordTrigger(triggerId, normalized)
}

/**
 * Generates HTML setup instructions for the Salesforce trigger.
 * Use Flow HTTP Callouts with a JSON body. Outbound Messages are SOAP/XML and are not supported.
 */
export function salesforceSetupInstructions(eventType: string): string {
  const isGeneric = eventType === 'All Events'

  const instructions = isGeneric
    ? [
        'Copy the <strong>Webhook URL</strong> above and generate a <strong>Webhook Secret</strong> (any strong random string). Paste the secret in the <strong>Webhook Secret</strong> field here.',
        'In your Flow’s HTTP Callout, set header <code>Authorization: Bearer &lt;your secret&gt;</code> or <code>X-Sim-Webhook-Secret: &lt;your secret&gt;</code> (same value).',
        'In Salesforce, go to <strong>Setup → Flows</strong> and click <strong>New Flow</strong>.',
        'Select <strong>Record-Triggered Flow</strong> and choose the object(s) you want to monitor.',
        'Add an <strong>Action</strong> that performs an <strong>HTTP Callout</strong> — method <strong>POST</strong>, <code>Content-Type: application/json</code>, and paste the webhook URL.',
        'Build the request body as <strong>JSON</strong> (not SOAP/XML). Include <code>eventType</code> and record fields (e.g. <code>Id</code>, <code>Name</code>). Outbound Messages use SOAP and will not work with this trigger.',
        'Save and <strong>Activate</strong> the Flow(s).',
        '<strong>Save this trigger in Sim first</strong> so the URL is registered; Salesforce connectivity checks may arrive before the Flow runs.',
        'Click <strong>"Save"</strong> above to activate your trigger.',
      ]
    : [
        'Copy the <strong>Webhook URL</strong> above and set a <strong>Webhook Secret</strong>. In the Flow HTTP Callout, send the same value as <code>Authorization: Bearer …</code> or <code>X-Sim-Webhook-Secret: …</code>.',
        'In Salesforce, go to <strong>Setup → Flows</strong> and click <strong>New Flow</strong>.',
        `Select <strong>Record-Triggered Flow</strong> for the right object and <strong>${eventType}</strong> as the entry condition.`,
        'Add an <strong>HTTP Callout</strong> — <strong>POST</strong>, JSON body, URL = webhook URL.',
        `Include <code>eventType</code> in the JSON body using a value this trigger accepts (e.g. for Record Created use <code>record_created</code>, <code>created</code>, or <code>after_insert</code>).`,
        'If you use <strong>Object Type (Optional)</strong>, you must also include matching type metadata in the JSON body (for example <code>objectType</code>, <code>sobjectType</code>, or <code>attributes.type</code>) or the event will be rejected.',
        'Save and <strong>Activate</strong> the Flow.',
        'Click <strong>"Save"</strong> above to activate your trigger.',
      ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

function salesforceWebhookSecretField(triggerId: string): SubBlockConfig {
  return {
    id: 'webhookSecret',
    title: 'Webhook Secret',
    type: 'short-input',
    placeholder: 'Generate a secret and paste it here',
    description:
      'Required. Use the same value in your Salesforce HTTP Callout as Bearer token or X-Sim-Webhook-Secret.',
    password: true,
    required: true,
    mode: 'trigger',
    condition: { field: 'selectedTriggerId', value: triggerId },
  }
}

function salesforceObjectTypeField(triggerId: string): SubBlockConfig {
  return {
    id: 'objectType',
    title: 'Object Type (Optional)',
    type: 'short-input',
    placeholder: 'e.g., Account, Contact, Opportunity',
    description:
      'When set, the payload must include matching object type metadata (for example objectType, sobjectType, or attributes.type) or the event is rejected.',
    mode: 'trigger',
    condition: { field: 'selectedTriggerId', value: triggerId },
  }
}

/** Secret + optional object filter (record triggers and generic webhook). */
export function buildSalesforceExtraFields(triggerId: string): SubBlockConfig[] {
  return [salesforceWebhookSecretField(triggerId), salesforceObjectTypeField(triggerId)]
}

/** Webhook secret only (Opportunity / Case specialized triggers — object is implied). */
export function buildSalesforceAuthOnlyFields(triggerId: string): SubBlockConfig[] {
  return [salesforceWebhookSecretField(triggerId)]
}

/**
 * Outputs for record lifecycle events (created, updated, deleted).
 */
export function buildSalesforceRecordOutputs(): Record<string, TriggerOutput> {
  return {
    eventType: {
      type: 'string',
      description: 'The type of event (e.g., created, updated, deleted)',
    },
    /** Present when the Flow JSON body uses `simEventType` instead of or in addition to `eventType`. */
    simEventType: {
      type: 'string',
      description:
        'Optional alias from the payload (`simEventType`). Empty when only `eventType` is sent.',
    },
    objectType: {
      type: 'string',
      description: 'Salesforce object type (e.g., Account, Contact, Lead)',
    },
    recordId: { type: 'string', description: 'ID of the affected record' },
    timestamp: { type: 'string', description: 'When the event occurred (ISO 8601)' },
    record: {
      Id: { type: 'string', description: 'Record ID' },
      Name: { type: 'string', description: 'Record name' },
      CreatedDate: { type: 'string', description: 'Record creation date' },
      LastModifiedDate: { type: 'string', description: 'Last modification date' },
      OwnerId: {
        type: 'string',
        description: 'Record owner ID (standard field when sent in the Flow body)',
      },
      SystemModstamp: {
        type: 'string',
        description: 'System modstamp from the record (ISO 8601) when included in the payload',
      },
    },
    changedFields: { type: 'json', description: 'Fields that were changed (for update events)' },
    payload: { type: 'json', description: 'Full webhook payload' },
  }
}

/**
 * Outputs for opportunity stage change events.
 */
export function buildSalesforceOpportunityStageOutputs(): Record<string, TriggerOutput> {
  return {
    eventType: { type: 'string', description: 'The type of event' },
    simEventType: {
      type: 'string',
      description:
        'Optional alias from the payload (`simEventType`). Empty when only `eventType` is sent.',
    },
    objectType: { type: 'string', description: 'Salesforce object type (Opportunity)' },
    recordId: { type: 'string', description: 'Opportunity ID' },
    timestamp: { type: 'string', description: 'When the event occurred (ISO 8601)' },
    record: {
      Id: { type: 'string', description: 'Opportunity ID' },
      Name: { type: 'string', description: 'Opportunity name' },
      StageName: { type: 'string', description: 'Current stage name' },
      Amount: { type: 'string', description: 'Deal amount' },
      CloseDate: { type: 'string', description: 'Expected close date' },
      Probability: { type: 'string', description: 'Win probability' },
      AccountId: { type: 'string', description: 'Related Account ID (standard Opportunity field)' },
      OwnerId: { type: 'string', description: 'Opportunity owner ID' },
    },
    previousStage: { type: 'string', description: 'Previous stage name' },
    newStage: { type: 'string', description: 'New stage name' },
    payload: { type: 'json', description: 'Full webhook payload' },
  }
}

/**
 * Outputs for case status change events.
 */
export function buildSalesforceCaseStatusOutputs(): Record<string, TriggerOutput> {
  return {
    eventType: { type: 'string', description: 'The type of event' },
    simEventType: {
      type: 'string',
      description:
        'Optional alias from the payload (`simEventType`). Empty when only `eventType` is sent.',
    },
    objectType: { type: 'string', description: 'Salesforce object type (Case)' },
    recordId: { type: 'string', description: 'Case ID' },
    timestamp: { type: 'string', description: 'When the event occurred (ISO 8601)' },
    record: {
      Id: { type: 'string', description: 'Case ID' },
      Subject: { type: 'string', description: 'Case subject' },
      Status: { type: 'string', description: 'Current case status' },
      Priority: { type: 'string', description: 'Case priority' },
      CaseNumber: { type: 'string', description: 'Case number' },
      AccountId: { type: 'string', description: 'Related Account ID' },
      ContactId: { type: 'string', description: 'Related Contact ID' },
      OwnerId: { type: 'string', description: 'Case owner ID' },
    },
    previousStatus: { type: 'string', description: 'Previous case status' },
    newStatus: { type: 'string', description: 'New case status' },
    payload: { type: 'json', description: 'Full webhook payload' },
  }
}

/**
 * Outputs for the generic webhook trigger.
 */
export function buildSalesforceWebhookOutputs(): Record<string, TriggerOutput> {
  return {
    eventType: { type: 'string', description: 'The type of event' },
    simEventType: {
      type: 'string',
      description:
        'Optional alias from the payload (`simEventType`). Empty when only `eventType` is sent.',
    },
    objectType: { type: 'string', description: 'Salesforce object type' },
    recordId: { type: 'string', description: 'ID of the affected record' },
    timestamp: { type: 'string', description: 'When the event occurred (ISO 8601)' },
    record: { type: 'json', description: 'Full record data' },
    payload: { type: 'json', description: 'Full webhook payload' },
  }
}
