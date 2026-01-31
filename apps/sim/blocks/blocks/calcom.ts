import { CalComIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { ToolResponse } from '@/tools/types'
import { getTrigger } from '@/triggers'

export const CalComBlock: BlockConfig<ToolResponse> = {
  type: 'calcom',
  name: 'Cal Com',
  description: 'Manage Cal.com bookings, event types, schedules, and availability',
  authMode: AuthMode.OAuth,
  triggerAllowed: true,
  longDescription:
    'Integrate Cal.com into your workflow. Create and manage bookings, event types, schedules, and check availability slots. Supports creating, listing, rescheduling, and canceling bookings, as well as managing event types and schedules. Can also trigger workflows based on Cal.com webhook events (booking created, cancelled, rescheduled). Connect your Cal.com account via OAuth.',
  docsLink: 'https://docs.sim.ai/tools/calcom',
  category: 'tools',
  bgColor: '#FFFFFE',
  icon: CalComIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Bookings', id: 'calcom_list_bookings' },
        { label: 'Create Booking', id: 'calcom_create_booking' },
        { label: 'Get Booking', id: 'calcom_get_booking' },
        { label: 'Cancel Booking', id: 'calcom_cancel_booking' },
        { label: 'Reschedule Booking', id: 'calcom_reschedule_booking' },
        { label: 'Confirm Booking', id: 'calcom_confirm_booking' },
        { label: 'Decline Booking', id: 'calcom_decline_booking' },
        { label: 'Create Event Type', id: 'calcom_create_event_type' },
        { label: 'Get Event Type', id: 'calcom_get_event_type' },
        { label: 'List Event Types', id: 'calcom_list_event_types' },
        { label: 'Update Event Type', id: 'calcom_update_event_type' },
        { label: 'Delete Event Type', id: 'calcom_delete_event_type' },
        { label: 'Create Schedule', id: 'calcom_create_schedule' },
        { label: 'Get Schedule', id: 'calcom_get_schedule' },
        { label: 'List Schedules', id: 'calcom_list_schedules' },
        { label: 'Update Schedule', id: 'calcom_update_schedule' },
        { label: 'Delete Schedule', id: 'calcom_delete_schedule' },
        { label: 'Get Default Schedule', id: 'calcom_get_default_schedule' },
        { label: 'Get Available Slots', id: 'calcom_get_slots' },
      ],
      value: () => 'calcom_list_bookings',
    },
    {
      id: 'credential',
      title: 'Cal.com Account',
      type: 'oauth-input',
      serviceId: 'calcom',
      placeholder: 'Select Cal.com account',
      required: true,
    },

    // === Create Booking fields ===
    {
      id: 'eventTypeId',
      title: 'Event Type ID',
      type: 'short-input',
      placeholder: 'Enter event type ID (number)',
      condition: {
        field: 'operation',
        value: ['calcom_create_booking', 'calcom_get_slots'],
      },
      required: { field: 'operation', value: 'calcom_create_booking' },
    },
    {
      id: 'start',
      title: 'Start Time',
      type: 'short-input',
      placeholder: 'ISO 8601 format (e.g., 2024-01-15T10:00:00Z)',
      condition: {
        field: 'operation',
        value: ['calcom_create_booking', 'calcom_reschedule_booking', 'calcom_get_slots'],
      },
      required: {
        field: 'operation',
        value: ['calcom_create_booking', 'calcom_reschedule_booking', 'calcom_get_slots'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp in UTC based on the user's description.
Format: YYYY-MM-DDTHH:MM:SSZ
Examples:
- "tomorrow at 2pm" -> Tomorrow's date at 14:00:00Z
- "next Monday 9am" -> Next Monday at 09:00:00Z
- "in 3 hours" -> Current time + 3 hours

Return ONLY the timestamp string - no explanations or quotes.`,
        placeholder: 'Describe the start time (e.g., "tomorrow at 2pm")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'end',
      title: 'End Time',
      type: 'short-input',
      placeholder: 'ISO 8601 format (e.g., 2024-01-15T11:00:00Z)',
      condition: { field: 'operation', value: 'calcom_get_slots' },
      required: { field: 'operation', value: 'calcom_get_slots' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an ISO 8601 timestamp in UTC based on the user's description.
Format: YYYY-MM-DDTHH:MM:SSZ
Examples:
- "end of tomorrow" -> Tomorrow at 23:59:59Z
- "next Friday" -> Next Friday at 23:59:59Z
- "in 1 week" -> Current date + 7 days

Return ONLY the timestamp string - no explanations or quotes.`,
        placeholder: 'Describe the end time (e.g., "end of next week")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'attendeeName',
      title: 'Attendee Name',
      type: 'short-input',
      placeholder: 'Enter attendee name',
      condition: { field: 'operation', value: 'calcom_create_booking' },
      required: true,
    },
    {
      id: 'attendeeEmail',
      title: 'Attendee Email',
      type: 'short-input',
      placeholder: 'Enter attendee email',
      condition: { field: 'operation', value: 'calcom_create_booking' },
    },
    {
      id: 'attendeeTimeZone',
      title: 'Attendee Time Zone',
      type: 'short-input',
      placeholder: 'e.g., America/New_York, Europe/London',
      condition: { field: 'operation', value: 'calcom_create_booking' },
      required: true,
      wandConfig: {
        enabled: true,
        prompt: `Convert the user's timezone description to a valid IANA timezone identifier.

Common examples:
- "New York" or "Eastern" -> America/New_York
- "Los Angeles" or "Pacific" -> America/Los_Angeles
- "Chicago" or "Central" -> America/Chicago
- "London" -> Europe/London
- "Paris" -> Europe/Paris
- "Tokyo" -> Asia/Tokyo
- "Sydney" -> Australia/Sydney
- "UTC" or "GMT" -> UTC

Return ONLY the IANA timezone string - no explanations or quotes.`,
        placeholder: 'Describe the timezone (e.g., "New York", "Pacific time")...',
        generationType: 'timezone',
      },
    },
    {
      id: 'attendeePhone',
      title: 'Attendee Phone',
      type: 'short-input',
      placeholder: 'International format (e.g., +1234567890)',
      condition: { field: 'operation', value: 'calcom_create_booking' },
      mode: 'advanced',
    },
    {
      id: 'guests',
      title: 'Guests',
      type: 'short-input',
      placeholder: 'Comma-separated email addresses',
      condition: { field: 'operation', value: 'calcom_create_booking' },
      mode: 'advanced',
    },
    {
      id: 'lengthInMinutes',
      title: 'Duration (minutes)',
      type: 'short-input',
      placeholder: 'Override default event duration',
      condition: { field: 'operation', value: 'calcom_create_booking' },
      mode: 'advanced',
    },
    {
      id: 'metadata',
      title: 'Metadata',
      type: 'code',
      language: 'json',
      placeholder: '{"key": "value"}',
      condition: { field: 'operation', value: 'calcom_create_booking' },
      mode: 'advanced',
    },

    // === Get/Cancel/Reschedule/Confirm/Decline Booking fields ===
    {
      id: 'bookingUid',
      title: 'Booking UID',
      type: 'short-input',
      placeholder: 'Enter booking UID',
      condition: {
        field: 'operation',
        value: [
          'calcom_get_booking',
          'calcom_cancel_booking',
          'calcom_reschedule_booking',
          'calcom_confirm_booking',
          'calcom_decline_booking',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'calcom_get_booking',
          'calcom_cancel_booking',
          'calcom_reschedule_booking',
          'calcom_confirm_booking',
          'calcom_decline_booking',
        ],
      },
    },
    {
      id: 'cancellationReason',
      title: 'Cancellation Reason',
      type: 'long-input',
      placeholder: 'Reason for cancellation',
      rows: 3,
      condition: { field: 'operation', value: 'calcom_cancel_booking' },
    },
    {
      id: 'reschedulingReason',
      title: 'Rescheduling Reason',
      type: 'long-input',
      placeholder: 'Reason for rescheduling',
      rows: 3,
      condition: { field: 'operation', value: 'calcom_reschedule_booking' },
      mode: 'advanced',
    },

    // === List Bookings filters ===
    {
      id: 'bookingStatus',
      title: 'Status',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Upcoming', id: 'upcoming' },
        { label: 'Recurring', id: 'recurring' },
        { label: 'Past', id: 'past' },
        { label: 'Cancelled', id: 'cancelled' },
        { label: 'Unconfirmed', id: 'unconfirmed' },
      ],
      condition: { field: 'operation', value: 'calcom_list_bookings' },
    },

    // === Event Type fields ===
    {
      id: 'eventTypeIdParam',
      title: 'Event Type ID',
      type: 'short-input',
      placeholder: 'Enter event type ID',
      condition: {
        field: 'operation',
        value: ['calcom_get_event_type', 'calcom_update_event_type', 'calcom_delete_event_type'],
      },
      required: {
        field: 'operation',
        value: ['calcom_get_event_type', 'calcom_update_event_type', 'calcom_delete_event_type'],
      },
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Event type title',
      condition: {
        field: 'operation',
        value: ['calcom_create_event_type', 'calcom_update_event_type'],
      },
      required: { field: 'operation', value: 'calcom_create_event_type' },
    },
    {
      id: 'slug',
      title: 'Slug',
      type: 'short-input',
      placeholder: 'URL-friendly identifier (e.g., 30-min-meeting)',
      condition: {
        field: 'operation',
        value: ['calcom_create_event_type', 'calcom_update_event_type'],
      },
      required: { field: 'operation', value: 'calcom_create_event_type' },
    },
    {
      id: 'eventLength',
      title: 'Duration (minutes)',
      type: 'short-input',
      placeholder: 'Event duration in minutes (e.g., 30)',
      condition: {
        field: 'operation',
        value: ['calcom_create_event_type', 'calcom_update_event_type'],
      },
      required: { field: 'operation', value: 'calcom_create_event_type' },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Event type description',
      rows: 3,
      condition: {
        field: 'operation',
        value: ['calcom_create_event_type', 'calcom_update_event_type'],
      },
      mode: 'advanced',
    },
    {
      id: 'slotInterval',
      title: 'Slot Interval (minutes)',
      type: 'short-input',
      placeholder: 'Minutes between available slots',
      condition: {
        field: 'operation',
        value: ['calcom_create_event_type', 'calcom_update_event_type'],
      },
      mode: 'advanced',
    },
    {
      id: 'minimumBookingNotice',
      title: 'Minimum Notice (minutes)',
      type: 'short-input',
      placeholder: 'Minimum advance notice required',
      condition: {
        field: 'operation',
        value: ['calcom_create_event_type', 'calcom_update_event_type'],
      },
      mode: 'advanced',
    },
    {
      id: 'beforeEventBuffer',
      title: 'Buffer Before (minutes)',
      type: 'short-input',
      placeholder: 'Buffer time before event',
      condition: {
        field: 'operation',
        value: ['calcom_create_event_type', 'calcom_update_event_type'],
      },
      mode: 'advanced',
    },
    {
      id: 'afterEventBuffer',
      title: 'Buffer After (minutes)',
      type: 'short-input',
      placeholder: 'Buffer time after event',
      condition: {
        field: 'operation',
        value: ['calcom_create_event_type', 'calcom_update_event_type'],
      },
      mode: 'advanced',
    },
    {
      id: 'eventTypeScheduleId',
      title: 'Schedule ID',
      type: 'short-input',
      placeholder: 'Assign to a specific schedule',
      condition: {
        field: 'operation',
        value: ['calcom_create_event_type', 'calcom_update_event_type'],
      },
      mode: 'advanced',
    },
    {
      id: 'disableGuests',
      title: 'Disable Guests',
      type: 'switch',
      description: 'Prevent attendees from adding guests',
      condition: {
        field: 'operation',
        value: ['calcom_create_event_type', 'calcom_update_event_type'],
      },
      mode: 'advanced',
    },

    // === Schedule fields ===
    {
      id: 'scheduleId',
      title: 'Schedule ID',
      type: 'short-input',
      placeholder: 'Enter schedule ID',
      condition: {
        field: 'operation',
        value: ['calcom_get_schedule', 'calcom_update_schedule', 'calcom_delete_schedule'],
      },
      required: {
        field: 'operation',
        value: ['calcom_get_schedule', 'calcom_update_schedule', 'calcom_delete_schedule'],
      },
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Schedule name (e.g., Working Hours)',
      condition: {
        field: 'operation',
        value: ['calcom_create_schedule', 'calcom_update_schedule'],
      },
      required: { field: 'operation', value: 'calcom_create_schedule' },
    },
    {
      id: 'timeZone',
      title: 'Time Zone',
      type: 'short-input',
      placeholder: 'e.g., America/New_York',
      condition: {
        field: 'operation',
        value: ['calcom_create_schedule', 'calcom_update_schedule', 'calcom_get_slots'],
      },
      required: { field: 'operation', value: 'calcom_create_schedule' },
      wandConfig: {
        enabled: true,
        prompt: `Convert the user's timezone description to a valid IANA timezone identifier.

Common examples:
- "New York" or "Eastern" -> America/New_York
- "Los Angeles" or "Pacific" -> America/Los_Angeles
- "Chicago" or "Central" -> America/Chicago
- "London" -> Europe/London
- "Paris" -> Europe/Paris
- "Tokyo" -> Asia/Tokyo
- "Sydney" -> Australia/Sydney
- "UTC" or "GMT" -> UTC

Return ONLY the IANA timezone string - no explanations or quotes.`,
        placeholder: 'Describe the timezone (e.g., "New York", "Pacific time")...',
        generationType: 'timezone',
      },
    },
    {
      id: 'isDefault',
      title: 'Default Schedule',
      type: 'switch',
      description: 'Set as the default schedule',
      condition: {
        field: 'operation',
        value: ['calcom_create_schedule', 'calcom_update_schedule'],
      },
    },
    {
      id: 'availability',
      title: 'Availability',
      type: 'code',
      language: 'json',
      placeholder: `[
  {
    "days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    "startTime": "09:00",
    "endTime": "17:00"
  }
]`,
      condition: {
        field: 'operation',
        value: ['calcom_create_schedule', 'calcom_update_schedule'],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Cal.com availability JSON array based on the user's description.

Each availability object has:
- days: Array of weekday names (Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday)
- startTime: HH:MM format (24-hour)
- endTime: HH:MM format (24-hour)

Example for "9-5 weekdays":
[{"days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], "startTime": "09:00", "endTime": "17:00"}]

Example for "mornings only, Monday and Wednesday":
[{"days": ["Monday", "Wednesday"], "startTime": "08:00", "endTime": "12:00"}]

Return ONLY valid JSON - no explanations.`,
        placeholder: 'Describe your availability (e.g., "9-5 weekdays")...',
        generationType: 'json-object',
      },
    },

    // === Slots fields ===
    {
      id: 'eventTypeSlug',
      title: 'Event Type Slug',
      type: 'short-input',
      placeholder: 'Event type slug (alternative to ID)',
      condition: { field: 'operation', value: 'calcom_get_slots' },
      mode: 'advanced',
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      placeholder: 'Cal.com username (required with slug)',
      condition: { field: 'operation', value: 'calcom_get_slots' },
      mode: 'advanced',
    },
    {
      id: 'duration',
      title: 'Duration (minutes)',
      type: 'short-input',
      placeholder: 'Slot duration in minutes',
      condition: { field: 'operation', value: 'calcom_get_slots' },
      mode: 'advanced',
    },

    // === List Event Types sorting ===
    {
      id: 'sortCreatedAt',
      title: 'Sort by Created',
      type: 'dropdown',
      options: [
        { label: 'None', id: '' },
        { label: 'Ascending', id: 'asc' },
        { label: 'Descending', id: 'desc' },
      ],
      condition: { field: 'operation', value: 'calcom_list_event_types' },
      mode: 'advanced',
    },
    // Trigger SubBlocks
    ...getTrigger('calcom_booking_created').subBlocks,
    ...getTrigger('calcom_booking_cancelled').subBlocks,
    ...getTrigger('calcom_booking_rescheduled').subBlocks,
    ...getTrigger('calcom_booking_requested').subBlocks,
    ...getTrigger('calcom_booking_rejected').subBlocks,
    ...getTrigger('calcom_booking_paid').subBlocks,
    ...getTrigger('calcom_meeting_ended').subBlocks,
    ...getTrigger('calcom_recording_ready').subBlocks,
    ...getTrigger('calcom_webhook').subBlocks,
  ],
  tools: {
    access: [
      'calcom_create_booking',
      'calcom_get_booking',
      'calcom_list_bookings',
      'calcom_cancel_booking',
      'calcom_reschedule_booking',
      'calcom_confirm_booking',
      'calcom_decline_booking',
      'calcom_create_event_type',
      'calcom_get_event_type',
      'calcom_list_event_types',
      'calcom_update_event_type',
      'calcom_delete_event_type',
      'calcom_create_schedule',
      'calcom_get_schedule',
      'calcom_list_schedules',
      'calcom_update_schedule',
      'calcom_delete_schedule',
      'calcom_get_default_schedule',
      'calcom_get_slots',
    ],
    config: {
      tool: (params) => params.operation || 'calcom_list_bookings',
      params: (params) => {
        const {
          operation,
          credential,
          attendeeName,
          attendeeEmail,
          attendeeTimeZone,
          attendeePhone,
          guests,
          start,
          end,
          bookingUid,
          cancellationReason,
          reschedulingReason,
          bookingStatus,
          lengthInMinutes,
          eventTypeIdParam,
          eventTypeId,
          eventLength,
          eventTypeScheduleId,
          slotInterval,
          minimumBookingNotice,
          beforeEventBuffer,
          afterEventBuffer,
          disableGuests,
          name,
          scheduleId,
          isDefault,
          eventTypeSlug,
          username,
          duration,
          metadata,
          availability,
          ...rest
        } = params

        const result: Record<string, unknown> = {}

        const toNumber = (value: unknown): number | undefined => {
          if (value === undefined || value === null || value === '') {
            return undefined
          }
          const num = Number(value)
          return Number.isNaN(num) ? undefined : num
        }

        switch (operation) {
          case 'calcom_create_booking':
            result.attendee = {
              name: attendeeName,
              ...(attendeeEmail && { email: attendeeEmail }),
              timeZone: attendeeTimeZone,
              ...(attendeePhone && { phoneNumber: attendeePhone }),
            }
            {
              const eventTypeIdNum = toNumber(eventTypeId)
              if (eventTypeIdNum !== undefined) result.eventTypeId = eventTypeIdNum
            }
            if (start) result.start = start
            if (end) result.end = end
            if (guests) result.guests = guests.split(',').map((g: string) => g.trim())
            {
              const lengthNum = toNumber(lengthInMinutes)
              if (lengthNum !== undefined) result.lengthInMinutes = lengthNum
            }
            if (metadata) {
              try {
                result.metadata = typeof metadata === 'string' ? JSON.parse(metadata) : metadata
              } catch {
                throw new Error('Invalid JSON for metadata')
              }
            }
            break

          case 'calcom_cancel_booking':
            if (bookingUid) result.bookingUid = bookingUid
            if (cancellationReason) result.cancellationReason = cancellationReason
            break

          case 'calcom_reschedule_booking':
            if (bookingUid) result.bookingUid = bookingUid
            if (start) result.start = start
            if (reschedulingReason) result.reschedulingReason = reschedulingReason
            break

          case 'calcom_list_bookings':
            if (bookingStatus) result.status = bookingStatus
            break

          case 'calcom_create_event_type':
          case 'calcom_update_event_type':
            {
              if (operation === 'calcom_update_event_type') {
                const eventTypeIdNum = toNumber(eventTypeIdParam)
                if (eventTypeIdNum !== undefined) result.eventTypeId = eventTypeIdNum
              }
              const lengthNum = toNumber(eventLength)
              if (lengthNum !== undefined) result.lengthInMinutes = lengthNum
              const scheduleIdNum = toNumber(eventTypeScheduleId)
              if (scheduleIdNum !== undefined) result.scheduleId = scheduleIdNum
              const slotIntervalNum = toNumber(slotInterval)
              if (slotIntervalNum !== undefined) result.slotInterval = slotIntervalNum
              const minNoticeNum = toNumber(minimumBookingNotice)
              if (minNoticeNum !== undefined) result.minimumBookingNotice = minNoticeNum
              const beforeBufferNum = toNumber(beforeEventBuffer)
              if (beforeBufferNum !== undefined) result.beforeEventBuffer = beforeBufferNum
              const afterBufferNum = toNumber(afterEventBuffer)
              if (afterBufferNum !== undefined) result.afterEventBuffer = afterBufferNum
              if (disableGuests !== undefined && disableGuests !== null) {
                result.disableGuests = disableGuests
              }
            }
            break

          case 'calcom_get_event_type':
          case 'calcom_delete_event_type':
            {
              const eventTypeIdNum = toNumber(eventTypeIdParam)
              if (eventTypeIdNum !== undefined) result.eventTypeId = eventTypeIdNum
            }
            break

          case 'calcom_create_schedule':
            if (name) result.name = name
            result.isDefault = isDefault === true
            if (availability) {
              try {
                result.availability =
                  typeof availability === 'string' ? JSON.parse(availability) : availability
              } catch {
                throw new Error('Invalid JSON for availability')
              }
            }
            break

          case 'calcom_get_schedule':
          case 'calcom_update_schedule':
          case 'calcom_delete_schedule':
            {
              const scheduleIdNum = toNumber(scheduleId)
              if (scheduleIdNum !== undefined) result.scheduleId = scheduleIdNum
            }
            if (operation === 'calcom_update_schedule') {
              if (name) result.name = name
              if (isDefault !== undefined && isDefault !== null) result.isDefault = isDefault
              if (availability) {
                try {
                  result.availability =
                    typeof availability === 'string' ? JSON.parse(availability) : availability
                } catch {
                  throw new Error('Invalid JSON for availability')
                }
              }
            }
            break

          case 'calcom_get_slots':
            {
              const eventTypeIdNum = toNumber(eventTypeId)
              const hasEventTypeId = eventTypeIdNum !== undefined
              const hasSlugAndUsername = Boolean(eventTypeSlug) && Boolean(username)

              if (!hasEventTypeId && !hasSlugAndUsername) {
                throw new Error(
                  'Event Type ID is required. Alternatively, provide both Event Type Slug and Username in advanced mode.'
                )
              }

              if (hasEventTypeId) result.eventTypeId = eventTypeIdNum
            }
            if (eventTypeSlug) result.eventTypeSlug = eventTypeSlug
            if (username) result.username = username
            if (start) result.start = start
            if (end) result.end = end
            {
              const durationNum = toNumber(duration)
              if (durationNum !== undefined) result.duration = durationNum
            }
            break
        }

        Object.entries(rest).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== '') {
            result[key] = value
          }
        })

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Cal.com OAuth credential' },
    eventTypeId: { type: 'number', description: 'Event type ID' },
    start: { type: 'string', description: 'Start time (ISO 8601)' },
    end: { type: 'string', description: 'End time (ISO 8601)' },
    attendeeName: { type: 'string', description: 'Attendee name' },
    attendeeEmail: { type: 'string', description: 'Attendee email' },
    attendeeTimeZone: { type: 'string', description: 'Attendee time zone' },
    attendeePhone: { type: 'string', description: 'Attendee phone number' },
    guests: { type: 'string', description: 'Comma-separated guest emails' },
    lengthInMinutes: { type: 'number', description: 'Duration override in minutes' },
    metadata: { type: 'json', description: 'Custom metadata object' },
    bookingUid: { type: 'string', description: 'Booking UID' },
    cancellationReason: { type: 'string', description: 'Reason for cancellation' },
    reschedulingReason: { type: 'string', description: 'Reason for rescheduling' },
    bookingStatus: { type: 'string', description: 'Filter by booking status' },
    eventTypeIdParam: { type: 'number', description: 'Event type ID for get/update/delete' },
    title: { type: 'string', description: 'Event type title' },
    slug: { type: 'string', description: 'URL-friendly slug' },
    eventLength: { type: 'number', description: 'Event duration in minutes' },
    description: { type: 'string', description: 'Event type description' },
    slotInterval: { type: 'number', description: 'Minutes between available slots' },
    minimumBookingNotice: { type: 'number', description: 'Minimum advance notice' },
    beforeEventBuffer: { type: 'number', description: 'Buffer before event' },
    afterEventBuffer: { type: 'number', description: 'Buffer after event' },
    eventTypeScheduleId: { type: 'number', description: 'Schedule ID for event type' },
    disableGuests: { type: 'boolean', description: 'Disable guest additions' },
    sortCreatedAt: { type: 'string', description: 'Sort order for event types' },
    scheduleId: { type: 'number', description: 'Schedule ID' },
    name: { type: 'string', description: 'Schedule name' },
    timeZone: { type: 'string', description: 'Time zone' },
    isDefault: { type: 'boolean', description: 'Set as default schedule' },
    availability: { type: 'json', description: 'Availability configuration' },
    eventTypeSlug: { type: 'string', description: 'Event type slug' },
    username: { type: 'string', description: 'Cal.com username' },
    duration: { type: 'number', description: 'Slot duration in minutes' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Whether operation succeeded' },
    bookingUid: { type: 'string', description: 'Booking unique identifier' },
    bookingId: { type: 'number', description: 'Booking ID' },
    status: { type: 'string', description: 'Booking or event status' },
    title: { type: 'string', description: 'Booking or event type title' },
    startTime: { type: 'string', description: 'Booking start time (ISO 8601)' },
    endTime: { type: 'string', description: 'Booking end time (ISO 8601)' },
    attendees: { type: 'json', description: 'List of attendees' },
    hosts: { type: 'json', description: 'List of hosts' },
    location: { type: 'string', description: 'Meeting location' },
    meetingUrl: { type: 'string', description: 'Video meeting URL' },
    bookings: { type: 'json', description: 'List of bookings' },
    eventTypes: { type: 'json', description: 'List of event types' },
    schedules: { type: 'json', description: 'List of schedules' },
    slots: { type: 'json', description: 'Available time slots' },
    id: { type: 'number', description: 'Event type or schedule ID' },
    slug: { type: 'string', description: 'Event type slug' },
    lengthInMinutes: { type: 'number', description: 'Event duration' },
    description: { type: 'string', description: 'Event type description' },
    name: { type: 'string', description: 'Schedule name' },
    timeZone: { type: 'string', description: 'Schedule time zone' },
    isDefault: { type: 'boolean', description: 'Whether schedule is default' },
    availability: { type: 'json', description: 'Availability configuration' },
    deleted: { type: 'boolean', description: 'Whether deletion succeeded' },
    message: { type: 'string', description: 'Status or error message' },
    triggerEvent: { type: 'string', description: 'Webhook event type' },
    createdAt: { type: 'string', description: 'Webhook event timestamp' },
    payload: { type: 'json', description: 'Complete webhook payload data' },
  },
  triggers: {
    enabled: true,
    available: [
      'calcom_booking_created',
      'calcom_booking_cancelled',
      'calcom_booking_rescheduled',
      'calcom_booking_requested',
      'calcom_booking_rejected',
      'calcom_booking_paid',
      'calcom_meeting_ended',
      'calcom_recording_ready',
      'calcom_webhook',
    ],
  },
}
