import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Maps Sim Granola trigger IDs to the Granola webhook event names they
 * subscribe to. Event names verified against the Granola webhooks
 * documentation (https://docs.granola.ai/webhooks).
 *
 * The "All Events" trigger maps to every event name, which is also what
 * Granola subscribes an endpoint to when `events` is omitted.
 */
export const GRANOLA_TRIGGER_TO_EVENT_TYPES: Record<string, readonly string[]> = {
  granola_note_generated: ['note.generated'],
  granola_note_edited: ['note.edited'],
  granola_note_access_granted: ['note.access_granted'],
  granola_webhook: ['note.generated', 'note.edited', 'note.access_granted'],
}

/**
 * Shared trigger dropdown options for all Granola triggers.
 */
export const granolaTriggerOptions = [
  { label: 'Note Generated', id: 'granola_note_generated' },
  { label: 'Note Edited', id: 'granola_note_edited' },
  { label: 'Note Access Granted', id: 'granola_note_access_granted' },
  { label: 'All Note Events', id: 'granola_webhook' },
]

/**
 * Setup instructions for a Granola trigger.
 *
 * Granola exposes programmatic webhook endpoint registration, so Sim creates
 * and deletes the endpoint automatically on deploy and undeploy — the user
 * only supplies an API key.
 */
export function granolaSetupInstructions(eventLabel: string): string {
  const instructions = [
    'In the Granola desktop app, go to <strong>Settings → Connectors → API keys</strong> and click <strong>Create new key</strong>, selecting the note access scopes the key should include. See the <a href="https://docs.granola.ai/help-center/sharing/integrations/granola-api" target="_blank" rel="noopener noreferrer">Granola API documentation</a> for details.',
    'Paste the key into the <strong>API Key</strong> field below. Webhooks require a Granola Business or Enterprise plan.',
    'Choose the <strong>Scopes</strong> that match the notes you want events for. Use <code>workspace</code> on its own if the key is a Workspace API key.',
    'Optionally restrict deliveries to specific folders with <strong>Folder IDs</strong>.',
    `Click <strong>"Save"</strong> above — Sim registers a Granola webhook endpoint for <strong>${eventLabel}</strong> and verifies every delivery with the signing secret Granola returns.`,
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * Granola-specific trigger fields.
 *
 * The API key is used both to register the endpoint at deploy time and to
 * delete it at undeploy time, so it is required. `scopes` and `folderIds` are
 * passed through to the Create Webhook Endpoint call.
 */
export function buildGranolaExtraFields(triggerId: string): SubBlockConfig[] {
  return [
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'grn_...',
      description:
        'Your Granola API key. Used to register the webhook endpoint on deploy and remove it on undeploy.',
      password: true,
      paramVisibility: 'user-only',
      required: true,
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'scopes',
      title: 'Scopes',
      type: 'short-input',
      placeholder: 'personal, public',
      description:
        'Comma-separated scopes deciding which notes send events: personal, public. With a Workspace API key pass exactly "workspace". Defaults to "personal, public".',
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'folderIds',
      title: 'Folder IDs',
      type: 'short-input',
      placeholder: 'fol_2mKr8fQxLp7Ta3, fol_4y6LduVdwSKC27',
      description:
        'Optional comma-separated folder IDs (max 100). Deliveries are restricted to notes in these folders or their subfolders. Leave blank for every note matching the scopes.',
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

/**
 * Outputs for every Granola note event.
 *
 * Field shapes verified against the documented delivery payload
 * (https://docs.granola.ai/webhooks). Payloads carry no note content — fetch
 * the note with the Granola block's Get Note operation using `noteId`.
 */
export function buildGranolaOutputs(): Record<string, TriggerOutput> {
  return {
    event_id: {
      type: 'string',
      description: 'Unique ID for the event. Retries of the same delivery reuse it.',
    },
    event_type: {
      type: 'string',
      description: 'Which event occurred: note.generated, note.edited, or note.access_granted.',
    },
    note_id: {
      type: 'string',
      description:
        'ID of the note the event is about (e.g., not_1d3tmYTlCICgjy). Fetch it with the Get Note operation.',
    },
    occurred_at: {
      type: 'string',
      description: 'ISO 8601 timestamp of when the event occurred.',
    },
    changed_fields: {
      type: 'json',
      description:
        'Note fields that changed. Present on note.edited events (currently always ["summary"]); null otherwise.',
    },
    payload: {
      type: 'json',
      description: 'Full raw webhook body as delivered by Granola.',
    },
  }
}

/**
 * Check whether a Granola webhook event matches the configured trigger.
 * An unknown trigger ID matches everything rather than silently dropping events.
 */
export function isGranolaEventMatch(triggerId: string, eventType: string): boolean {
  const expected = GRANOLA_TRIGGER_TO_EVENT_TYPES[triggerId]
  if (!expected) return true
  return expected.includes(eventType)
}
