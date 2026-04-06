import type { TriggerOutput } from '@/triggers/types'

/**
 * Shared trigger dropdown options for all Gong triggers
 */
export const gongTriggerOptions = [
  { label: 'General Webhook (All Events)', id: 'gong_webhook' },
  { label: 'Call Completed', id: 'gong_call_completed' },
]

/**
 * Generate setup instructions for a specific Gong event type
 */
export function gongSetupInstructions(eventType: string): string {
  const instructions = [
    '<strong>Note:</strong> You need admin access to Gong to set up webhooks. See the <a href="https://help.gong.io/docs/create-a-webhook-rule" target="_blank" rel="noopener noreferrer">Gong webhook documentation</a> for details.',
    'Copy the <strong>Webhook URL</strong> above.',
    'In Gong, go to <strong>Admin center > Settings > Ecosystem > Automation rules</strong>.',
    'Click <strong>"+ Add Rule"</strong> to create a new automation rule.',
    `Configure rule filters to match <strong>${eventType}</strong> calls.`,
    'Under Actions, select <strong>"Fire webhook"</strong>.',
    'Paste the Webhook URL into the destination field.',
    'Choose an authentication method (URL includes key or Signed JWT header).',
    'Save the rule and click <strong>"Save"</strong> above to activate your trigger.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3">${index === 0 ? instruction : `<strong>${index}.</strong> ${instruction}`}</div>`
    )
    .join('')
}

/**
 * Build output schema for call events.
 * Gong webhooks deliver call data including metadata, participants, context, and content analysis.
 */
export function buildCallOutputs(): Record<string, TriggerOutput> {
  return {
    isTest: {
      type: 'boolean',
      description: 'Whether this is a test webhook from the Gong UI',
    },
    callData: {
      type: 'json',
      description: 'Full call data object',
    },
    metaData: {
      id: { type: 'string', description: 'Gong call ID' },
      url: { type: 'string', description: 'URL to the call in Gong' },
      title: { type: 'string', description: 'Call title' },
      scheduled: { type: 'string', description: 'Scheduled start time (ISO 8601)' },
      started: { type: 'string', description: 'Actual start time (ISO 8601)' },
      duration: { type: 'number', description: 'Call duration in seconds' },
      primaryUserId: { type: 'string', description: 'Primary Gong user ID' },
      direction: { type: 'string', description: 'Call direction (Conference, Call, etc.)' },
      system: { type: 'string', description: 'Meeting system (Zoom, Teams, etc.)' },
      scope: { type: 'string', description: 'Call scope (External or Internal)' },
      media: { type: 'string', description: 'Media type (Video or Audio)' },
      language: { type: 'string', description: 'Call language code' },
    },
    parties: {
      type: 'array',
      description: 'Array of call participants with name, email, title, and affiliation',
    },
    context: {
      type: 'array',
      description: 'Array of CRM context objects (Salesforce opportunities, accounts, etc.)',
    },
    trackers: {
      type: 'array',
      description: 'Array of tracked topics/keywords with counts',
    },
  } as Record<string, TriggerOutput>
}

/**
 * Build output schema for generic webhook events.
 * Uses the same call output structure since Gong webhooks primarily deliver call data.
 */
export function buildGenericOutputs(): Record<string, TriggerOutput> {
  return buildCallOutputs()
}
