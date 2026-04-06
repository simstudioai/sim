import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Maps trigger IDs to the Zoom webhook event names they should match.
 */
const ZOOM_TRIGGER_EVENT_MAP: Record<string, string[]> = {
  zoom_meeting_started: ['meeting.started'],
  zoom_meeting_ended: ['meeting.ended'],
  zoom_participant_joined: ['meeting.participant_joined'],
  zoom_participant_left: ['meeting.participant_left'],
  zoom_recording_completed: ['recording.completed'],
}

/**
 * Checks whether a Zoom webhook payload matches the configured trigger type.
 * Returns true for the generic `zoom_webhook` trigger (accepts all events).
 */
export function isZoomEventMatch(triggerId: string, event: string): boolean {
  if (triggerId === 'zoom_webhook') {
    return true
  }

  const allowedEvents = ZOOM_TRIGGER_EVENT_MAP[triggerId]
  if (!allowedEvents) {
    return false
  }

  return allowedEvents.includes(event)
}

/**
 * Dropdown options for the Zoom trigger type selector.
 */
export const zoomTriggerOptions = [
  { label: 'Meeting Started', id: 'zoom_meeting_started' },
  { label: 'Meeting Ended', id: 'zoom_meeting_ended' },
  { label: 'Participant Joined', id: 'zoom_participant_joined' },
  { label: 'Participant Left', id: 'zoom_participant_left' },
  { label: 'Recording Completed', id: 'zoom_recording_completed' },
  { label: 'Generic Webhook (All Events)', id: 'zoom_webhook' },
]

type ZoomEventType =
  | 'meeting_started'
  | 'meeting_ended'
  | 'participant_joined'
  | 'participant_left'
  | 'recording_completed'
  | 'generic'

/**
 * Generates setup instructions HTML for Zoom triggers.
 */
export function zoomSetupInstructions(eventType: ZoomEventType): string {
  const eventNames: Record<ZoomEventType, string> = {
    meeting_started: 'meeting.started',
    meeting_ended: 'meeting.ended',
    participant_joined: 'meeting.participant_joined',
    participant_left: 'meeting.participant_left',
    recording_completed: 'recording.completed',
    generic: 'your desired event type(s)',
  }

  const instructions = [
    'Copy the <strong>Webhook URL</strong> above.',
    'Go to the <a href="https://marketplace.zoom.us/" target="_blank" rel="noopener noreferrer">Zoom Marketplace</a> and open your app (or create a new Webhook Only app).',
    "Copy the <strong>Secret Token</strong> from your Zoom app's <strong>Features</strong> page and paste it in the <strong>Secret Token</strong> field above.",
    'Click <strong>"Save Configuration"</strong> above to activate the trigger.',
    'Navigate to <strong>Features > Event Subscriptions</strong> and click <strong>Add Event Subscription</strong>.',
    'Enter a subscription name and paste the webhook URL into the <strong>Event notification endpoint URL</strong> field.',
    'Click <strong>Validate</strong> to verify the endpoint.',
    `Click <strong>Add Events</strong> and select the <strong>${eventNames[eventType]}</strong> event type.`,
    'Save the event subscription in Zoom.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * Creates the secret token field subBlock for a Zoom trigger.
 */
export function zoomSecretTokenField(triggerId: string): SubBlockConfig {
  return {
    id: 'secretToken',
    title: 'Secret Token',
    type: 'short-input',
    placeholder: 'Enter your Zoom app Secret Token',
    description:
      "Found in your Zoom app's Features page. Required for endpoint validation and webhook signature verification.",
    password: true,
    required: true,
    mode: 'trigger',
    condition: {
      field: 'selectedTriggerId',
      value: triggerId,
    },
  }
}

/**
 * Builds outputs for meeting lifecycle events (started/ended).
 */
export function buildMeetingOutputs(): Record<string, TriggerOutput> {
  return {
    event: {
      type: 'string',
      description: 'The webhook event type (e.g., meeting.started)',
    },
    event_ts: {
      type: 'number',
      description: 'Unix timestamp in milliseconds when the event occurred',
    },
    payload: {
      account_id: {
        type: 'string',
        description: 'Zoom account ID',
      },
      object: {
        type: 'object',
        description: 'Meeting details',
        properties: {
          id: { type: 'number', description: 'Meeting ID' },
          uuid: { type: 'string', description: 'Meeting UUID' },
          topic: { type: 'string', description: 'Meeting topic' },
          meeting_type: {
            type: 'number',
            description: 'Meeting type (1=instant, 2=scheduled, etc.)',
          },
          host_id: { type: 'string', description: 'Host user ID' },
          start_time: { type: 'string', description: 'Meeting start time (ISO 8601)' },
          end_time: {
            type: 'string',
            description: 'Meeting end time (ISO 8601, present on meeting.ended)',
          },
          timezone: { type: 'string', description: 'Meeting timezone' },
          duration: { type: 'number', description: 'Meeting duration in minutes' },
        },
      },
    },
  }
}

/**
 * Builds outputs for participant events (joined/left).
 */
export function buildParticipantOutputs(): Record<string, TriggerOutput> {
  return {
    event: {
      type: 'string',
      description: 'The webhook event type (e.g., meeting.participant_joined)',
    },
    event_ts: {
      type: 'number',
      description: 'Unix timestamp in milliseconds when the event occurred',
    },
    payload: {
      account_id: {
        type: 'string',
        description: 'Zoom account ID',
      },
      object: {
        type: 'object',
        description: 'Meeting details',
        properties: {
          id: { type: 'number', description: 'Meeting ID' },
          uuid: { type: 'string', description: 'Meeting UUID' },
          topic: { type: 'string', description: 'Meeting topic' },
          host_id: { type: 'string', description: 'Host user ID' },
          participant: {
            type: 'object',
            description: 'Participant details',
            properties: {
              id: { type: 'string', description: 'Participant user ID' },
              user_id: { type: 'string', description: 'Participant user ID (16-digit)' },
              user_name: { type: 'string', description: 'Participant display name' },
              email: { type: 'string', description: 'Participant email' },
              join_time: { type: 'string', description: 'Time participant joined (ISO 8601)' },
              leave_time: {
                type: 'string',
                description: 'Time participant left (ISO 8601, present on participant_left)',
              },
            },
          },
        },
      },
    },
  }
}

/**
 * Builds outputs for recording completed events.
 */
export function buildRecordingOutputs(): Record<string, TriggerOutput> {
  return {
    event: {
      type: 'string',
      description: 'The webhook event type (recording.completed)',
    },
    event_ts: {
      type: 'number',
      description: 'Unix timestamp in milliseconds when the event occurred',
    },
    payload: {
      account_id: {
        type: 'string',
        description: 'Zoom account ID',
      },
      object: {
        type: 'object',
        description: 'Recording details',
        properties: {
          id: { type: 'number', description: 'Meeting ID' },
          uuid: { type: 'string', description: 'Meeting UUID' },
          topic: { type: 'string', description: 'Meeting topic' },
          host_id: { type: 'string', description: 'Host user ID' },
          host_email: { type: 'string', description: 'Host email' },
          start_time: { type: 'string', description: 'Recording start time (ISO 8601)' },
          duration: { type: 'number', description: 'Recording duration in minutes' },
          total_size: { type: 'number', description: 'Total recording size in bytes' },
          recording_count: { type: 'number', description: 'Number of recording files' },
          share_url: { type: 'string', description: 'URL to share the recording' },
          recording_files: {
            type: 'json',
            description: 'Array of recording file objects with download URLs',
          },
        },
      },
    },
  }
}

/**
 * Builds outputs for generic webhook (any event type).
 */
export function buildGenericOutputs(): Record<string, TriggerOutput> {
  return {
    event: {
      type: 'string',
      description: 'The webhook event type (e.g., meeting.started, recording.completed)',
    },
    event_ts: {
      type: 'number',
      description: 'Unix timestamp in milliseconds when the event occurred',
    },
    payload: {
      type: 'json',
      description: 'Complete webhook payload (structure varies by event type)',
    },
  }
}
