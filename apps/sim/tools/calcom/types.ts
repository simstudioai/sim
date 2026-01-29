import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Cal.com booking responses.
 * These are reusable across all booking-related tools to ensure consistency.
 */

/**
 * Output definition for attendee objects in booking responses
 */
export const ATTENDEE_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Attendee name' },
  email: { type: 'string', description: 'Attendee email' },
  timeZone: { type: 'string', description: 'Attendee timezone' },
  phoneNumber: { type: 'string', description: 'Attendee phone number' },
  language: { type: 'string', description: 'Attendee language preference' },
  absent: { type: 'boolean', description: 'Whether attendee was absent' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for host objects in booking responses
 */
export const HOST_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Host user ID' },
  name: { type: 'string', description: 'Host name' },
  email: { type: 'string', description: 'Host email' },
  username: { type: 'string', description: 'Host username' },
  timeZone: { type: 'string', description: 'Host timezone' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for event type objects in booking responses
 */
export const EVENT_TYPE_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Event type ID' },
  slug: { type: 'string', description: 'Event type slug' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete attendees array output definition with destructured items
 */
export const ATTENDEES_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'List of attendees',
  items: {
    type: 'object',
    properties: ATTENDEE_OUTPUT_PROPERTIES,
  },
}

/**
 * Complete hosts array output definition with destructured items
 */
export const HOSTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'List of hosts',
  items: {
    type: 'object',
    properties: HOST_OUTPUT_PROPERTIES,
  },
}

/**
 * Complete event type object output definition
 */
export const EVENT_TYPE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Event type details',
  properties: EVENT_TYPE_OUTPUT_PROPERTIES,
}

/**
 * Common booking data output properties shared across all booking tools
 */
export const BOOKING_DATA_OUTPUT_PROPERTIES = {
  id: {
    type: 'number',
    description: 'Numeric booking ID',
  },
  uid: {
    type: 'string',
    description: 'Unique identifier for the booking',
  },
  title: {
    type: 'string',
    description: 'Title of the booking',
  },
  description: {
    type: 'string',
    description: 'Description of the booking',
  },
  status: {
    type: 'string',
    description: 'Booking status (e.g., accepted, pending, cancelled)',
  },
  start: {
    type: 'string',
    description: 'Start time in ISO 8601 format',
  },
  end: {
    type: 'string',
    description: 'End time in ISO 8601 format',
  },
  duration: {
    type: 'number',
    description: 'Duration in minutes',
  },
  eventTypeId: {
    type: 'number',
    description: 'Event type ID',
  },
  eventType: EVENT_TYPE_OUTPUT,
  meetingUrl: {
    type: 'string',
    description: 'URL to join the meeting',
  },
  location: {
    type: 'string',
    description: 'Location of the booking',
  },
  absentHost: {
    type: 'boolean',
    description: 'Whether the host was absent',
  },
  attendees: ATTENDEES_OUTPUT,
  hosts: HOSTS_OUTPUT,
  guests: {
    type: 'array',
    description: 'Guest email addresses',
    items: {
      type: 'string',
      description: 'Guest email address',
    },
  },
  bookingFieldsResponses: {
    type: 'object',
    description: 'Custom booking field responses',
  },
  metadata: {
    type: 'object',
    description: 'Custom metadata attached to the booking',
  },
  rating: {
    type: 'number',
    description: 'Booking rating',
  },
  icsUid: {
    type: 'string',
    description: 'ICS calendar UID',
  },
  createdAt: {
    type: 'string',
    description: 'When the booking was created',
  },
  updatedAt: {
    type: 'string',
    description: 'When the booking was last updated',
  },
  cancellationReason: {
    type: 'string',
    description: 'Reason for cancellation if cancelled',
  },
  reschedulingReason: {
    type: 'string',
    description: 'Reason for rescheduling if rescheduled',
  },
  rescheduledFromUid: {
    type: 'string',
    description: 'Original booking UID if this booking was rescheduled',
  },
  rescheduledToUid: {
    type: 'string',
    description: 'New booking UID after reschedule',
  },
  cancelledByEmail: {
    type: 'string',
    description: 'Email of person who cancelled the booking',
  },
  rescheduledByEmail: {
    type: 'string',
    description: 'Email of person who rescheduled the booking',
  },
} as const satisfies Record<string, OutputProperty>

export interface CalcomCreateEventTypeParams {
  accessToken: string
  title: string
  slug: string
  lengthInMinutes: number
  description?: string
  slotInterval?: number
  minimumBookingNotice?: number
  beforeEventBuffer?: number
  afterEventBuffer?: number
  scheduleId?: number
  disableGuests?: boolean
}

export interface CalcomEventType {
  id: number
  title: string
  slug: string
  description: string | null
  lengthInMinutes: number
  slotInterval: number | null
  minimumBookingNotice: number
  beforeEventBuffer: number
  afterEventBuffer: number
  scheduleId: number | null
  disableGuests: boolean
  createdAt: string
  updatedAt: string
}

export interface CalcomCreateEventTypeResponse extends ToolResponse {
  output: {
    status: string
    data: CalcomEventType
  }
}

export interface CalcomGetEventTypeParams {
  accessToken: string
  eventTypeId: number
}

export interface CalcomGetEventTypeResponse extends ToolResponse {
  output: {
    status: string
    data: CalcomEventType
  }
}

export interface CalcomListEventTypesParams {
  accessToken: string
  sortCreatedAt?: 'asc' | 'desc'
}

export interface CalcomListEventTypesResponse extends ToolResponse {
  output: {
    status: string
    data: CalcomEventType[]
  }
}

export interface CalcomUpdateEventTypeParams {
  accessToken: string
  eventTypeId: number
  title?: string
  slug?: string
  lengthInMinutes?: number
  description?: string
  slotInterval?: number
  minimumBookingNotice?: number
  beforeEventBuffer?: number
  afterEventBuffer?: number
  scheduleId?: number
  disableGuests?: boolean
}

export interface CalcomUpdateEventTypeResponse extends ToolResponse {
  output: {
    status: string
    data: CalcomEventType
  }
}

export interface CalcomDeleteEventTypeParams {
  accessToken: string
  eventTypeId: number
}

export interface CalcomDeleteEventTypeResponse extends ToolResponse {
  output: {
    deleted: boolean
    message: string
  }
}

/**
 * Common attendee structure for Cal.com bookings
 */
export interface CalcomAttendee {
  name: string
  email?: string
  timeZone: string
  phoneNumber?: string
}

/**
 * Common booking structure returned by Cal.com API
 */
export interface CalcomBooking {
  uid: string
  title: string
  description?: string
  hosts: Array<{
    id: number
    name: string
    email: string
    timeZone: string
  }>
  status: string
  cancellationReason?: string
  reschedulingReason?: string
  rescheduledFromUid?: string
  start: string
  end: string
  duration: number
  eventTypeId: number
  eventType: {
    id: number
    slug: string
  }
  meetingUrl?: string
  location?: string
  absentHost: boolean
  createdAt: string
  updatedAt?: string
  metadata?: Record<string, unknown>
  rating?: number
  attendees: Array<{
    name: string
    email: string
    timeZone: string
    phoneNumber?: string
    language: string
    absent: boolean
  }>
  guests?: string[]
  bookingFieldsResponses?: Record<string, unknown>
}

/**
 * Create booking params
 */
export interface CalcomCreateBookingParams {
  accessToken: string
  eventTypeId: number
  start: string
  attendee: CalcomAttendee
  guests?: string[]
  lengthInMinutes?: number
  metadata?: Record<string, unknown>
}

export interface CalcomCreateBookingResponse extends ToolResponse {
  output: {
    status: string
    data: CalcomBooking
  }
}

/**
 * Get booking params
 */
export interface CalcomGetBookingParams {
  accessToken: string
  bookingUid: string
}

export interface CalcomGetBookingResponse extends ToolResponse {
  output: {
    status: string
    data: CalcomBooking
  }
}

/**
 * List bookings params
 */
export interface CalcomListBookingsParams {
  accessToken: string
  status?: 'upcoming' | 'recurring' | 'past' | 'cancelled' | 'unconfirmed'
  take?: number
  skip?: number
}

export interface CalcomListBookingsResponse extends ToolResponse {
  output: {
    status: string
    data: CalcomBooking[]
  }
}

/**
 * Cancel booking params
 */
export interface CalcomCancelBookingParams {
  accessToken: string
  bookingUid: string
  cancellationReason?: string
}

export interface CalcomCancelBookingResponse extends ToolResponse {
  output: {
    status: string
    data: CalcomBooking
  }
}

/**
 * Reschedule booking params
 */
export interface CalcomRescheduleBookingParams {
  accessToken: string
  bookingUid: string
  start: string
  reschedulingReason?: string
}

export interface CalcomRescheduleBookingResponse extends ToolResponse {
  output: {
    status: string
    data: CalcomBooking
  }
}

/**
 * Confirm booking params
 */
export interface CalcomConfirmBookingParams {
  accessToken: string
  bookingUid: string
}

export interface CalcomConfirmBookingResponse extends ToolResponse {
  output: {
    status: string
    data: CalcomBooking
  }
}

/**
 * Decline booking params
 */
export interface CalcomDeclineBookingParams {
  accessToken: string
  bookingUid: string
  reason?: string
}

export interface CalcomDeclineBookingResponse extends ToolResponse {
  output: {
    status: string
    data: CalcomBooking
  }
}

/**
 * Availability interval for a schedule
 */
export interface CalcomAvailability {
  days: ('Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday')[]
  startTime: string
  endTime: string
}

/**
 * Schedule object returned by Cal.com API
 */
export interface CalcomSchedule {
  id: number
  name: string
  timeZone: string
  isDefault: boolean
  availability: CalcomAvailability[]
}

export interface CalcomCreateScheduleParams {
  accessToken: string
  name: string
  timeZone: string
  isDefault: boolean
  availability?: CalcomAvailability[]
}

export interface CalcomCreateScheduleResponse extends ToolResponse {
  output: {
    status: string
    data: CalcomSchedule
  }
}

export interface CalcomGetScheduleParams {
  accessToken: string
  scheduleId: string
}

export interface CalcomGetScheduleResponse extends ToolResponse {
  output: {
    status: string
    data: CalcomSchedule
  }
}

export interface CalcomListSchedulesParams {
  accessToken: string
}

export interface CalcomListSchedulesResponse extends ToolResponse {
  output: {
    status: string
    data: CalcomSchedule[]
  }
}

export interface CalcomUpdateScheduleParams {
  accessToken: string
  scheduleId: string
  name?: string
  timeZone?: string
  isDefault?: boolean
  availability?: CalcomAvailability[]
}

export interface CalcomUpdateScheduleResponse extends ToolResponse {
  output: {
    status: string
    data: CalcomSchedule
  }
}

export interface CalcomDeleteScheduleParams {
  accessToken: string
  scheduleId: string
}

export interface CalcomDeleteScheduleResponse extends ToolResponse {
  output: {
    status: string
    data: {
      id: number
      name: string
      timeZone: string
      isDefault: boolean
    }
  }
}

export interface CalcomGetDefaultScheduleParams {
  accessToken: string
}

export interface CalcomGetDefaultScheduleResponse extends ToolResponse {
  output: {
    status: string
    data: CalcomSchedule
  }
}
