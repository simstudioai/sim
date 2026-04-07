import { GONG_JWT_PUBLIC_KEY_CONFIG_KEY } from '@/lib/webhooks/providers/gong'
import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Shared trigger dropdown options for all Gong triggers
 */
export const gongTriggerOptions = [
  { label: 'General Webhook (All Events)', id: 'gong_webhook' },
  { label: 'Call Completed', id: 'gong_call_completed' },
]

/**
 * Optional Gong "Signed JWT header" verification (paste the public key from Gong).
 * When empty, security relies on the unguessable webhook URL path (Gong "URL includes key").
 */
export function buildGongExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: GONG_JWT_PUBLIC_KEY_CONFIG_KEY,
      title: 'Gong JWT public key (optional)',
      type: 'long-input',
      placeholder:
        'Paste the full PEM from Gong (-----BEGIN PUBLIC KEY----- …) or raw base64. Leave empty if the rule uses URL-includes-key only.',
      description:
        'Required only when your Gong rule uses **Signed JWT header**. Sim verifies RS256, `webhook_url`, and `body_sha256` per Gong. If empty, only the webhook URL path authenticates the request.',
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

/**
 * Generate setup instructions for a specific Gong event type
 */
export function gongSetupInstructions(eventType: string): string {
  const instructions = [
    '<strong>Note:</strong> You need admin access to Gong to set up webhooks. See the <a href="https://help.gong.io/docs/create-a-webhook-rule" target="_blank" rel="noopener noreferrer">Gong webhook documentation</a> for details.',
    'Copy the <strong>Webhook URL</strong> above.',
    'In Gong, go to <strong>Admin center > Settings > Ecosystem > Automation rules</strong>.',
    'Click <strong>"+ Add Rule"</strong> to create a new automation rule.',
    `Configure rule filters in Gong for the calls you want (e.g. <strong>${eventType}</strong>). Gong does not send a separate event name in the JSON payload — filtering happens in the rule.`,
    'Under Actions, select <strong>"Fire webhook"</strong>.',
    'Paste this workflow’s Webhook URL into the destination field.',
    '<strong>Authentication:</strong> Use either <strong>URL includes key</strong> (recommended default — Sim’s URL is already secret) or <strong>Signed JWT header</strong>. If you use Signed JWT, paste Gong’s public key into the field above so Sim can verify the <code>Authorization</code> token.',
    'Save the rule and click <strong>"Save"</strong> above to activate your trigger.',
  ]

  return instructions
    .map((instruction, index) => {
      if (index === 0) {
        return `<div class="mb-3">${instruction}</div>`
      }
      return `<div class="mb-3"><strong>${index}.</strong> ${instruction}</div>`
    })
    .join('')
}

/**
 * Build output schema for call events.
 * Gong webhooks deliver call data including metadata, participants, context, and content analysis.
 */
export function buildCallOutputs(): Record<string, TriggerOutput> {
  return {
    eventType: {
      type: 'string',
      description:
        'Constant identifier for automation-rule webhooks (`gong.automation_rule`). Gong does not send distinct event names in the payload.',
    },
    callId: {
      type: 'string',
      description: 'Gong call ID (same value as metaData.id when present)',
    },
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
      workspaceId: { type: 'string', description: 'Gong workspace ID' },
      direction: { type: 'string', description: 'Call direction (Inbound, Outbound, etc.)' },
      system: { type: 'string', description: 'Communication platform used (e.g. Zoom, Teams)' },
      scope: { type: 'string', description: 'Call scope (Internal, External, or Unknown)' },
      media: { type: 'string', description: 'Media type (Video or Audio)' },
      language: { type: 'string', description: 'Language code (ISO-639-2B)' },
      sdrDisposition: {
        type: 'string',
        description: 'SDR disposition classification (when present)',
      },
      clientUniqueId: {
        type: 'string',
        description: 'Call identifier from the origin recording system (when present)',
      },
      customData: {
        type: 'string',
        description: 'Custom metadata from call creation (when present)',
      },
      purpose: { type: 'string', description: 'Call purpose (when present)' },
      meetingUrl: { type: 'string', description: 'Web conference provider URL (when present)' },
      isPrivate: { type: 'boolean', description: 'Whether the call is private (when present)' },
      calendarEventId: { type: 'string', description: 'Calendar event identifier (when present)' },
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
      description:
        'Keyword and smart trackers from call content (same shape as Gong extensive-calls `content.trackers`)',
    },
    topics: {
      type: 'array',
      description: 'Topic segments with durations from call content (`content.topics`)',
    },
    highlights: {
      type: 'array',
      description: 'AI-generated highlights from call content (`content.highlights`)',
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
