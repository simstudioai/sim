import { normalizeOtterEvent } from '@/tools/otter/utils'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Maps Sim Otter trigger IDs to the workspace webhook event they accept.
 *
 * Otter's docs name the events `conversation.completed` / `conversation.shared`
 * while the documented payload carries `meta.webhook.event: "conversation_completed"`,
 * so event names are compared after `normalizeOtterEvent`. The All Events
 * trigger has no entry and accepts every event.
 * @see https://help.otter.ai/hc/en-us/articles/35634832371735-Workspace-Webhooks
 */
export const OTTER_TRIGGER_TO_EVENT: Record<string, string> = {
  otter_conversation_completed: 'conversation_completed',
  otter_conversation_shared: 'conversation_shared',
}

export const otterTriggerOptions = [
  { label: 'Conversation Completed', id: 'otter_conversation_completed' },
  { label: 'Conversation Shared', id: 'otter_conversation_shared' },
  { label: 'All Events', id: 'otter_webhook' },
]

/**
 * Whether a delivery's event matches the trigger. The All Events trigger
 * accepts everything; a typed trigger requires the documented event name, so a
 * delivery without one cannot start a workflow for an event it did not prove.
 */
export function isOtterEventMatch(triggerId: string, event: string | null): boolean {
  const expected = OTTER_TRIGGER_TO_EVENT[triggerId]
  if (!expected) return true
  if (!event) return false
  return normalizeOtterEvent(event) === expected
}

/**
 * Setup instructions for an Otter trigger. Otter has no API for creating
 * webhooks, so a Workspace Admin registers the Sim URL in Otter by hand. Each
 * Otter webhook carries exactly one event type, so the All Events trigger
 * needs one Otter webhook per event, both pointing at the same URL.
 */
export function otterSetupInstructions(events: readonly string[]): string {
  const eventStep =
    events.length === 1
      ? `Set <strong>Event type</strong> to <strong>${events[0]}</strong> and save.`
      : `Set <strong>Event type</strong> to <strong>${events[0]}</strong> and save, then repeat steps 2–5 with the same URL for ${events
          .slice(1)
          .map((event) => `<strong>${event}</strong>`)
          .join(' and ')}. Each Otter webhook sends one event type.`
  const instructions = [
    'Copy the <strong>Webhook URL</strong> above.',
    'In Otter, go to <strong>Manage Workspace → Developer</strong> and click <strong>+ Create webhook</strong>. Only Workspace Admins can create workspace webhooks. See the <a href="https://help.otter.ai/hc/en-us/articles/35634832371735-Workspace-Webhooks" target="_blank" rel="noopener noreferrer">Otter webhook documentation</a> for details.',
    'Paste the URL into <strong>Endpoint URL</strong> and optionally give the webhook a name.',
    'Choose the <strong>Source</strong>: <strong>Workspace</strong> for every conversation shared to the whole workspace, or <strong>Channel</strong> for conversations in the channels you select.',
    eventStep,
    ...(events.includes('conversation.completed')
      ? [
          'For <strong>conversation.completed</strong>, the conversation must be shared to the workspace or channel <strong>before the meeting ends</strong> to be sent.',
        ]
      : []),
    'Otter cannot edit a webhook after it is created. To change it, create a new one and delete the old one.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

const USER_OUTPUT: Record<string, TriggerOutput> = {
  id: { type: 'string', description: 'User ID' },
  name: { type: 'string', description: 'Full name' },
  firstName: { type: 'string', description: 'First name' },
  lastName: { type: 'string', description: 'Last name' },
  email: { type: 'string', description: 'Email address' },
}

/**
 * Outputs for every Otter webhook delivery, verified against the documented
 * payload. Conversation fields share names and shapes with the Get Conversation
 * tool so a workflow can switch between trigger and lookup without remapping.
 */
export function buildOtterOutputs(): Record<string, TriggerOutput> {
  return {
    event: {
      type: 'string',
      description: 'Webhook event (e.g., conversation_completed or conversation_shared)',
    },
    webhookName: { type: 'string', description: 'Name of the Otter webhook, if set' },
    sourceType: {
      type: 'string',
      description: 'Where the webhook listens: workspace or channel',
    },
    source: {
      type: 'json',
      description:
        'The webhook source; for a channel source (id, name, memberCount, owner, discoverability)',
    },
    createdBy: USER_OUTPUT,
    retrievedAt: { type: 'string', description: 'When Otter assembled the payload (ISO 8601)' },
    id: { type: 'string', description: 'Conversation ID' },
    title: { type: 'string', description: 'Conversation title' },
    url: { type: 'string', description: 'URL to view the conversation in Otter' },
    owner: USER_OUTPUT,
    createdAt: { type: 'string', description: 'When the conversation was created' },
    processStatus: {
      abstractSummary: { type: 'string', description: 'Summary processing status' },
      actionItem: { type: 'string', description: 'Action item processing status' },
      outline: { type: 'string', description: 'Outline processing status' },
    },
    calendarGuests: {
      type: 'json',
      description: 'Calendar event guests (name, email, permission)',
    },
    sharedEmails: {
      type: 'json',
      description:
        'Users or emails the conversation is shared with (email, user {id, name, firstName, lastName, email}, permission)',
    },
    sharedChannels: {
      type: 'json',
      description:
        'Channels the conversation is shared with (channel {id, name, memberCount, owner, discoverability}, permission)',
    },
    abstractSummary: { type: 'string', description: 'AI-generated summary of the conversation' },
    confJoinUrl: {
      type: 'string',
      description: 'Meeting join URL (Zoom, Google Meet, Microsoft Teams, etc.)',
    },
    actionItems: {
      type: 'json',
      description:
        'Action items (id, text, assignee {id, name, firstName, lastName, email}, status {completed, createdAt, lastModifiedAt, completedAt})',
    },
    insights: { type: 'json', description: 'Key topics discussed (topic, text[])' },
    outline: { type: 'json', description: 'Meeting outline sections (section, text[])' },
    transcript: {
      content: { type: 'string', description: 'Full transcript text' },
      format: { type: 'string', description: 'Transcript format (e.g., txt)' },
    },
    customPrompt: {
      label: { type: 'string', description: 'Custom prompt label' },
      output: { type: 'string', description: 'Custom prompt output' },
    },
    payload: { type: 'json', description: 'Full raw webhook body as delivered by Otter' },
  }
}
