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

/**
 * Generates HTML setup instructions for the Salesforce trigger.
 * Salesforce has no native webhook API — users must configure
 * Flow HTTP Callouts or Outbound Messages manually.
 */
export function salesforceSetupInstructions(eventType: string): string {
  const isGeneric = eventType === 'All Events'

  const instructions = isGeneric
    ? [
        'Copy the <strong>Webhook URL</strong> above.',
        'In Salesforce, go to <strong>Setup → Flows</strong> and click <strong>New Flow</strong>.',
        'Select <strong>Record-Triggered Flow</strong> and choose the object(s) you want to monitor.',
        'Add an <strong>HTTP Callout</strong> action — set the method to <strong>POST</strong> and paste the webhook URL.',
        'In the request body, include the record fields you want sent as <strong>JSON</strong> (e.g., Id, Name, and any relevant fields).',
        'Repeat for each object type you want to send events for.',
        'Save and <strong>Activate</strong> the Flow(s).',
        'Click <strong>"Save"</strong> above to activate your trigger.',
      ]
    : [
        'Copy the <strong>Webhook URL</strong> above.',
        'In Salesforce, go to <strong>Setup → Flows</strong> and click <strong>New Flow</strong>.',
        `Select <strong>Record-Triggered Flow</strong> and choose the object and <strong>${eventType}</strong> trigger condition.`,
        'Add an <strong>HTTP Callout</strong> action — set the method to <strong>POST</strong> and paste the webhook URL.',
        'In the request body, include the record fields you want sent as <strong>JSON</strong> (e.g., Id, Name, and any relevant fields).',
        'Save and <strong>Activate</strong> the Flow.',
        'Click <strong>"Save"</strong> above to activate your trigger.',
        '<em>Alternative: You can also use <strong>Setup → Outbound Messages</strong> with a Workflow Rule, but this sends SOAP/XML instead of JSON.</em>',
      ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * Extra fields for Salesforce triggers (object type filter).
 */
export function buildSalesforceExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'objectType',
      title: 'Object Type (Optional)',
      type: 'short-input',
      placeholder: 'e.g., Account, Contact, Lead, Opportunity',
      description: 'Optionally filter to a specific Salesforce object type',
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
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
    objectType: { type: 'string', description: 'Salesforce object type (Case)' },
    recordId: { type: 'string', description: 'Case ID' },
    timestamp: { type: 'string', description: 'When the event occurred (ISO 8601)' },
    record: {
      Id: { type: 'string', description: 'Case ID' },
      Subject: { type: 'string', description: 'Case subject' },
      Status: { type: 'string', description: 'Current case status' },
      Priority: { type: 'string', description: 'Case priority' },
      CaseNumber: { type: 'string', description: 'Case number' },
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
    objectType: { type: 'string', description: 'Salesforce object type' },
    recordId: { type: 'string', description: 'ID of the affected record' },
    timestamp: { type: 'string', description: 'When the event occurred (ISO 8601)' },
    record: { type: 'json', description: 'Full record data' },
    payload: { type: 'json', description: 'Full webhook payload' },
  }
}
