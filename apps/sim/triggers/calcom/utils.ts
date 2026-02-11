import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

/**
 * Shared output property definitions for Cal.com trigger payloads.
 */

/**
 * Organizer output definition with destructured properties
 */
const ORGANIZER_OUTPUT: TriggerOutput = {
  type: 'object',
  description: 'Organizer details',
  properties: {
    id: { type: 'number', description: 'Organizer user ID' },
    name: { type: 'string', description: 'Organizer name' },
    email: { type: 'string', description: 'Organizer email' },
    username: { type: 'string', description: 'Organizer username' },
    timeZone: { type: 'string', description: 'Organizer timezone' },
  },
}

/**
 * Attendees array output definition with destructured items
 */
const ATTENDEES_TRIGGER_OUTPUT: TriggerOutput = {
  type: 'array',
  description: 'List of attendees',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Attendee name' },
      email: { type: 'string', description: 'Attendee email' },
      timeZone: { type: 'string', description: 'Attendee timezone' },
      language: { type: 'string', description: 'Attendee language preference' },
    },
  },
}

export const calcomTriggerOptions = [
  { label: 'Booking Created', id: 'calcom_booking_created' },
  { label: 'Booking Cancelled', id: 'calcom_booking_cancelled' },
  { label: 'Booking Rescheduled', id: 'calcom_booking_rescheduled' },
  { label: 'Booking Requested', id: 'calcom_booking_requested' },
  { label: 'Booking Rejected', id: 'calcom_booking_rejected' },
  { label: 'Booking Paid', id: 'calcom_booking_paid' },
  { label: 'Meeting Ended', id: 'calcom_meeting_ended' },
  { label: 'Recording Ready', id: 'calcom_recording_ready' },
  { label: 'Generic Webhook (All Events)', id: 'calcom_webhook' },
]

/**
 * Creates the webhook secret field subBlock for a CalCom trigger
 */
export function calcomWebhookSecretField(triggerId: string): SubBlockConfig {
  return {
    id: 'webhookSecret',
    title: 'Webhook Secret',
    type: 'short-input',
    placeholder: 'Enter the same secret you configured in Cal.com',
    description: 'Used to verify webhook requests via X-Cal-Signature-256 header.',
    password: true,
    required: false,
    mode: 'trigger',
    condition: {
      field: 'selectedTriggerId',
      value: triggerId,
    },
  }
}

/**
 * Event type configuration for setup instructions
 */
type CalcomEventType =
  | 'created'
  | 'cancelled'
  | 'rescheduled'
  | 'requested'
  | 'rejected'
  | 'paid'
  | 'meeting_ended'
  | 'recording_ready'
  | 'generic'

/**
 * Generates setup instructions HTML for CalCom triggers
 */
export function calcomSetupInstructions(eventType: CalcomEventType): string {
  const eventDescriptions: Record<CalcomEventType, string> = {
    created: 'This webhook triggers when a new booking is created.',
    cancelled: 'This webhook triggers when a booking is cancelled.',
    rescheduled: 'This webhook triggers when a booking is rescheduled.',
    requested:
      'This webhook triggers when a booking request is submitted (for event types requiring confirmation).',
    rejected: 'This webhook triggers when a booking request is rejected by the host.',
    paid: 'This webhook triggers when payment is completed for a paid booking.',
    meeting_ended: 'This webhook triggers when a meeting ends.',
    recording_ready: 'This webhook triggers when a meeting recording is ready for download.',
    generic: 'This webhook can receive any Cal.com event type you configure.',
  }

  const eventNames: Record<CalcomEventType, string> = {
    created: 'BOOKING_CREATED',
    cancelled: 'BOOKING_CANCELLED',
    rescheduled: 'BOOKING_RESCHEDULED',
    requested: 'BOOKING_REQUESTED',
    rejected: 'BOOKING_REJECTED',
    paid: 'BOOKING_PAID',
    meeting_ended: 'MEETING_ENDED',
    recording_ready: 'RECORDING_READY',
    generic: 'your desired event type(s)',
  }

  return [
    'Copy the webhook URL above.',
    'Go to your <a href="https://app.cal.com/settings/developer/webhooks" target="_blank" rel="noopener noreferrer">Cal.com Webhook Settings</a>.',
    'Click "New Webhook" and paste the URL.',
    `Select the <strong>${eventNames[eventType]}</strong> event trigger.`,
    eventDescriptions[eventType],
    'If you add a secret key in Cal.com, enter the same secret in the <strong>Webhook Secret</strong> field above to verify webhook authenticity.',
  ]
    .map(
      (instruction, index) =>
        `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
    )
    .join('')
}

/**
 * Builds common booking outputs for CalCom triggers
 */
export function buildBookingOutputs(): Record<string, TriggerOutput> {
  return {
    triggerEvent: {
      type: 'string',
      description: 'The webhook event type',
    },
    createdAt: {
      type: 'string',
      description: 'When the webhook event was created (ISO 8601)',
    },
    payload: {
      title: {
        type: 'string',
        description: 'Booking title',
      },
      description: {
        type: 'string',
        description: 'Booking description',
      },
      eventTypeId: {
        type: 'number',
        description: 'Event type ID',
      },
      startTime: {
        type: 'string',
        description: 'Booking start time (ISO 8601)',
      },
      endTime: {
        type: 'string',
        description: 'Booking end time (ISO 8601)',
      },
      uid: {
        type: 'string',
        description: 'Unique booking identifier',
      },
      bookingId: {
        type: 'number',
        description: 'Numeric booking ID',
      },
      status: {
        type: 'string',
        description: 'Booking status',
      },
      location: {
        type: 'string',
        description: 'Meeting location or URL',
      },
      organizer: ORGANIZER_OUTPUT,
      attendees: ATTENDEES_TRIGGER_OUTPUT,
      responses: {
        type: 'json',
        description:
          'Booking form responses (dynamic - fields depend on your event type configuration)',
      },
      metadata: {
        type: 'json',
        description:
          'Custom metadata attached to the booking (dynamic - user-defined key-value pairs)',
      },
      videoCallData: {
        type: 'json',
        description: 'Video call details (structure varies by provider)',
      },
    },
  } as any
}

/**
 * Builds outputs specific to cancelled bookings
 */
export function buildCancelledOutputs(): Record<string, TriggerOutput> {
  return {
    triggerEvent: {
      type: 'string',
      description: 'The webhook event type',
    },
    createdAt: {
      type: 'string',
      description: 'When the webhook event was created (ISO 8601)',
    },
    payload: {
      title: {
        type: 'string',
        description: 'Booking title',
      },
      description: {
        type: 'string',
        description: 'Booking description',
      },
      eventTypeId: {
        type: 'number',
        description: 'Event type ID',
      },
      startTime: {
        type: 'string',
        description: 'Booking start time (ISO 8601)',
      },
      endTime: {
        type: 'string',
        description: 'Booking end time (ISO 8601)',
      },
      uid: {
        type: 'string',
        description: 'Unique booking identifier',
      },
      bookingId: {
        type: 'number',
        description: 'Numeric booking ID',
      },
      status: {
        type: 'string',
        description: 'Booking status',
      },
      location: {
        type: 'string',
        description: 'Meeting location or URL',
      },
      cancellationReason: {
        type: 'string',
        description: 'Reason for cancellation',
      },
      organizer: ORGANIZER_OUTPUT,
      attendees: ATTENDEES_TRIGGER_OUTPUT,
      responses: {
        type: 'json',
        description: 'Booking form responses',
      },
      metadata: {
        type: 'json',
        description: 'Custom metadata attached to the booking',
      },
    },
  } as any
}

/**
 * Builds outputs specific to rescheduled bookings
 */
export function buildRescheduledOutputs(): Record<string, TriggerOutput> {
  return {
    triggerEvent: {
      type: 'string',
      description: 'The webhook event type',
    },
    createdAt: {
      type: 'string',
      description: 'When the webhook event was created (ISO 8601)',
    },
    payload: {
      title: {
        type: 'string',
        description: 'Booking title',
      },
      description: {
        type: 'string',
        description: 'Booking description',
      },
      eventTypeId: {
        type: 'number',
        description: 'Event type ID',
      },
      startTime: {
        type: 'string',
        description: 'New booking start time (ISO 8601)',
      },
      endTime: {
        type: 'string',
        description: 'New booking end time (ISO 8601)',
      },
      uid: {
        type: 'string',
        description: 'Unique booking identifier',
      },
      bookingId: {
        type: 'number',
        description: 'Numeric booking ID',
      },
      status: {
        type: 'string',
        description: 'Booking status',
      },
      location: {
        type: 'string',
        description: 'Meeting location or URL',
      },
      rescheduleId: {
        type: 'number',
        description: 'Previous booking ID',
      },
      rescheduleUid: {
        type: 'string',
        description: 'Previous booking UID',
      },
      rescheduleStartTime: {
        type: 'string',
        description: 'Original start time (ISO 8601)',
      },
      rescheduleEndTime: {
        type: 'string',
        description: 'Original end time (ISO 8601)',
      },
      organizer: ORGANIZER_OUTPUT,
      attendees: ATTENDEES_TRIGGER_OUTPUT,
      responses: {
        type: 'json',
        description: 'Booking form responses',
      },
      metadata: {
        type: 'json',
        description: 'Custom metadata attached to the booking',
      },
    },
  } as any
}

/**
 * Builds outputs for booking requested events (pending confirmation)
 */
export function buildRequestedOutputs(): Record<string, TriggerOutput> {
  return {
    triggerEvent: {
      type: 'string',
      description: 'The webhook event type (BOOKING_REQUESTED)',
    },
    createdAt: {
      type: 'string',
      description: 'When the webhook event was created (ISO 8601)',
    },
    payload: {
      title: {
        type: 'string',
        description: 'Booking title',
      },
      description: {
        type: 'string',
        description: 'Booking description',
      },
      eventTypeId: {
        type: 'number',
        description: 'Event type ID',
      },
      startTime: {
        type: 'string',
        description: 'Requested start time (ISO 8601)',
      },
      endTime: {
        type: 'string',
        description: 'Requested end time (ISO 8601)',
      },
      uid: {
        type: 'string',
        description: 'Unique booking identifier',
      },
      bookingId: {
        type: 'number',
        description: 'Numeric booking ID',
      },
      status: {
        type: 'string',
        description: 'Booking status (pending)',
      },
      location: {
        type: 'string',
        description: 'Meeting location or URL',
      },
      organizer: ORGANIZER_OUTPUT,
      attendees: ATTENDEES_TRIGGER_OUTPUT,
      responses: {
        type: 'json',
        description: 'Booking form responses',
      },
      metadata: {
        type: 'json',
        description: 'Custom metadata attached to the booking',
      },
    },
  } as any
}

/**
 * Builds outputs for booking rejected events
 */
export function buildRejectedOutputs(): Record<string, TriggerOutput> {
  return {
    triggerEvent: {
      type: 'string',
      description: 'The webhook event type (BOOKING_REJECTED)',
    },
    createdAt: {
      type: 'string',
      description: 'When the webhook event was created (ISO 8601)',
    },
    payload: {
      title: {
        type: 'string',
        description: 'Booking title',
      },
      description: {
        type: 'string',
        description: 'Booking description',
      },
      eventTypeId: {
        type: 'number',
        description: 'Event type ID',
      },
      startTime: {
        type: 'string',
        description: 'Requested start time (ISO 8601)',
      },
      endTime: {
        type: 'string',
        description: 'Requested end time (ISO 8601)',
      },
      uid: {
        type: 'string',
        description: 'Unique booking identifier',
      },
      bookingId: {
        type: 'number',
        description: 'Numeric booking ID',
      },
      status: {
        type: 'string',
        description: 'Booking status (rejected)',
      },
      rejectionReason: {
        type: 'string',
        description: 'Reason for rejection provided by host',
      },
      organizer: ORGANIZER_OUTPUT,
      attendees: ATTENDEES_TRIGGER_OUTPUT,
      metadata: {
        type: 'json',
        description: 'Custom metadata attached to the booking',
      },
    },
  } as any
}

/**
 * Builds outputs for booking paid events
 */
export function buildPaidOutputs(): Record<string, TriggerOutput> {
  return {
    triggerEvent: {
      type: 'string',
      description: 'The webhook event type (BOOKING_PAID)',
    },
    createdAt: {
      type: 'string',
      description: 'When the webhook event was created (ISO 8601)',
    },
    payload: {
      title: {
        type: 'string',
        description: 'Booking title',
      },
      description: {
        type: 'string',
        description: 'Booking description',
      },
      eventTypeId: {
        type: 'number',
        description: 'Event type ID',
      },
      startTime: {
        type: 'string',
        description: 'Booking start time (ISO 8601)',
      },
      endTime: {
        type: 'string',
        description: 'Booking end time (ISO 8601)',
      },
      uid: {
        type: 'string',
        description: 'Unique booking identifier',
      },
      bookingId: {
        type: 'number',
        description: 'Numeric booking ID',
      },
      status: {
        type: 'string',
        description: 'Booking status',
      },
      location: {
        type: 'string',
        description: 'Meeting location or URL',
      },
      payment: {
        type: 'object',
        description: 'Payment details',
        properties: {
          id: { type: 'string', description: 'Payment ID' },
          amount: { type: 'number', description: 'Payment amount' },
          currency: { type: 'string', description: 'Payment currency' },
          success: { type: 'boolean', description: 'Whether payment succeeded' },
        },
      },
      organizer: ORGANIZER_OUTPUT,
      attendees: ATTENDEES_TRIGGER_OUTPUT,
      metadata: {
        type: 'json',
        description: 'Custom metadata attached to the booking',
      },
    },
  } as any
}

/**
 * Builds outputs for meeting ended events
 */
export function buildMeetingEndedOutputs(): Record<string, TriggerOutput> {
  return {
    triggerEvent: {
      type: 'string',
      description: 'The webhook event type (MEETING_ENDED)',
    },
    createdAt: {
      type: 'string',
      description: 'When the webhook event was created (ISO 8601)',
    },
    payload: {
      title: {
        type: 'string',
        description: 'Meeting title',
      },
      eventTypeId: {
        type: 'number',
        description: 'Event type ID',
      },
      startTime: {
        type: 'string',
        description: 'Meeting start time (ISO 8601)',
      },
      endTime: {
        type: 'string',
        description: 'Meeting end time (ISO 8601)',
      },
      uid: {
        type: 'string',
        description: 'Unique booking identifier',
      },
      bookingId: {
        type: 'number',
        description: 'Numeric booking ID',
      },
      duration: {
        type: 'number',
        description: 'Actual meeting duration in minutes',
      },
      organizer: ORGANIZER_OUTPUT,
      attendees: ATTENDEES_TRIGGER_OUTPUT,
      videoCallData: {
        type: 'json',
        description: 'Video call details',
      },
    },
  } as any
}

/**
 * Builds outputs for recording ready events
 */
export function buildRecordingReadyOutputs(): Record<string, TriggerOutput> {
  return {
    triggerEvent: {
      type: 'string',
      description: 'The webhook event type (RECORDING_READY)',
    },
    createdAt: {
      type: 'string',
      description: 'When the webhook event was created (ISO 8601)',
    },
    payload: {
      title: {
        type: 'string',
        description: 'Meeting title',
      },
      eventTypeId: {
        type: 'number',
        description: 'Event type ID',
      },
      startTime: {
        type: 'string',
        description: 'Meeting start time (ISO 8601)',
      },
      endTime: {
        type: 'string',
        description: 'Meeting end time (ISO 8601)',
      },
      uid: {
        type: 'string',
        description: 'Unique booking identifier',
      },
      bookingId: {
        type: 'number',
        description: 'Numeric booking ID',
      },
      recordingUrl: {
        type: 'string',
        description: 'URL to download the recording',
      },
      transcription: {
        type: 'string',
        description: 'Meeting transcription text (if available)',
      },
      organizer: ORGANIZER_OUTPUT,
      attendees: ATTENDEES_TRIGGER_OUTPUT,
    },
  } as any
}

/**
 * Builds outputs for generic webhook (any event type)
 */
export function buildGenericOutputs(): Record<string, TriggerOutput> {
  return {
    triggerEvent: {
      type: 'string',
      description: 'The webhook event type (e.g., BOOKING_CREATED, MEETING_ENDED)',
    },
    createdAt: {
      type: 'string',
      description: 'When the webhook event was created (ISO 8601)',
    },
    payload: {
      type: 'json',
      description: 'Complete webhook payload (structure varies by event type)',
    },
  }
}
