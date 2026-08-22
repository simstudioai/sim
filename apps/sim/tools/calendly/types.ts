import type { ToolResponse } from '@/tools/types'

/** Shared pagination envelope returned by every Calendly list endpoint. */
export interface CalendlyPagination {
  count: number
  next_page: string | null
  previous_page: string | null
  next_page_token: string | null
  previous_page_token: string | null
}

/** The User resource, returned by both `/users/me` and `/users/{uuid}`. */
export interface CalendlyUserResource {
  uri: string
  name: string
  slug: string
  email: string
  scheduling_url: string
  timezone: string
  time_notation: string
  avatar_url: string | null
  created_at: string
  updated_at: string
  current_organization: string
  resource_type: string
  locale: string
}

export interface CalendlyGetCurrentUserParams {
  apiKey: string
}

export interface CalendlyGetCurrentUserResponse extends ToolResponse {
  output: {
    resource: CalendlyUserResource
  }
}

export interface CalendlyGetUserParams {
  apiKey: string
  userUuid: string
}

export interface CalendlyGetUserResponse extends ToolResponse {
  output: {
    resource: CalendlyUserResource
  }
}

export interface CalendlyListEventTypesParams {
  apiKey: string
  user?: string
  organization?: string
  count?: number
  pageToken?: string
  sort?: string
  active?: boolean
}

export interface CalendlyListEventTypesResponse extends ToolResponse {
  output: {
    collection: Array<{
      uri: string
      name: string
      active: boolean
      booking_method: string
      color: string
      created_at: string
      description_html: string
      description_plain: string
      duration: number
      internal_note: string
      kind: string
      pooling_type: string
      profile: {
        name: string
        owner: string
        type: string
      }
      scheduling_url: string
      slug: string
      type: string
      updated_at: string
    }>
    pagination: {
      count: number
      next_page: string | null
      previous_page: string | null
      next_page_token: string | null
      previous_page_token: string | null
    }
  }
}

export interface CalendlyGetEventTypeParams {
  apiKey: string
  eventTypeUuid: string
}

export interface CalendlyGetEventTypeResponse extends ToolResponse {
  output: {
    resource: {
      uri: string
      name: string
      active: boolean
      booking_method: string
      color: string
      created_at: string
      custom_questions: Array<{
        name: string
        type: string
        position: number
        enabled: boolean
        required: boolean
        answer_choices: string[]
        include_other: boolean
      }>
      deleted_at: string | null
      description_html: string
      description_plain: string
      duration: number
      internal_note: string
      kind: string
      pooling_type: string
      profile: {
        name: string
        owner: string
        type: string
      }
      scheduling_url: string
      slug: string
      type: string
      updated_at: string
    }
  }
}

export interface CalendlyListScheduledEventsParams {
  apiKey: string
  user?: string
  organization?: string
  invitee_email?: string
  count?: number
  max_start_time?: string
  min_start_time?: string
  pageToken?: string
  sort?: string
  status?: string
}

export interface CalendlyListScheduledEventsResponse extends ToolResponse {
  output: {
    collection: Array<{
      uri: string
      name: string
      status: string
      start_time: string
      end_time: string
      event_type: string
      location: {
        type: string
        location: string
        join_url?: string
        data?: Record<string, any>
      }
      invitees_counter: {
        total: number
        active: number
        limit: number
      }
      created_at: string
      updated_at: string
      event_memberships: Array<{
        user: string
        user_email: string
        user_name: string
      }>
      event_guests: Array<{
        email: string
        created_at: string
        updated_at: string
      }>
      cancellation?: {
        canceled_by: string
        reason: string
        canceler_type: string
      }
    }>
    pagination: {
      count: number
      next_page: string | null
      previous_page: string | null
      next_page_token: string | null
      previous_page_token: string | null
    }
  }
}

export interface CalendlyGetScheduledEventParams {
  apiKey: string
  eventUuid: string
}

export interface CalendlyGetScheduledEventResponse extends ToolResponse {
  output: {
    resource: {
      uri: string
      name: string
      status: string
      start_time: string
      end_time: string
      event_type: string
      location: {
        type: string
        location: string
        join_url?: string
        data?: Record<string, any>
      }
      invitees_counter: {
        total: number
        active: number
        limit: number
      }
      created_at: string
      updated_at: string
      event_memberships: Array<{
        user: string
        user_email: string
        user_name: string
      }>
      event_guests: Array<{
        email: string
        created_at: string
        updated_at: string
      }>
      cancellation?: {
        canceled_by: string
        reason: string
        canceler_type: string
      }
    }
  }
}

export interface CalendlyListEventInviteesParams {
  apiKey: string
  eventUuid: string
  count?: number
  email?: string
  pageToken?: string
  sort?: string
  status?: string
}

export interface CalendlyListEventInviteesResponse extends ToolResponse {
  output: {
    collection: Array<{
      uri: string
      email: string
      name: string
      first_name: string | null
      last_name: string | null
      status: string
      questions_and_answers: Array<{
        question: string
        answer: string
        position: number
      }>
      timezone: string
      event: string
      created_at: string
      updated_at: string
      tracking: {
        utm_campaign: string | null
        utm_source: string | null
        utm_medium: string | null
        utm_content: string | null
        utm_term: string | null
        salesforce_uuid: string | null
      }
      text_reminder_number: string | null
      rescheduled: boolean
      old_invitee: string | null
      new_invitee: string | null
      cancel_url: string
      reschedule_url: string
      cancellation?: {
        canceled_by: string
        reason: string
        canceler_type: string
      }
      payment?: {
        id: string
        provider: string
        amount: number
        currency: string
        terms: string
        successful: boolean
      }
      no_show?: {
        created_at: string
      }
      reconfirmation?: {
        created_at: string
        confirmed_at: string | null
      }
    }>
    pagination: {
      count: number
      next_page: string | null
      previous_page: string | null
      next_page_token: string | null
      previous_page_token: string | null
    }
  }
}

export interface CalendlyCancelEventParams {
  apiKey: string
  eventUuid: string
  reason?: string
}

export interface CalendlyCancelEventResponse extends ToolResponse {
  output: {
    resource: {
      canceler_type: string
      canceled_by: string
      reason: string | null
      created_at: string
    }
  }
}

export interface CalendlyListWebhooksParams {
  apiKey: string
  organization: string
  scope: string
  count?: number
  pageToken?: string
  user?: string
}

export interface CalendlyListWebhooksResponse extends ToolResponse {
  output: {
    collection: Array<{
      uri: string
      callback_url: string
      created_at: string
      updated_at: string
      retry_started_at: string | null
      state: string
      events: string[]
      signing_key: string
      scope: string
      organization: string
      user?: string
      creator: string
    }>
    pagination: {
      count: number
      next_page: string | null
      previous_page: string | null
      next_page_token: string | null
      previous_page_token: string | null
    }
  }
}

export interface CalendlyCreateWebhookParams {
  apiKey: string
  url: string
  events: string[] | string
  organization: string
  user?: string
  scope: string
  signing_key?: string
}

export interface CalendlyCreateWebhookResponse extends ToolResponse {
  output: {
    resource: {
      uri: string
      callback_url: string
      created_at: string
      updated_at: string
      retry_started_at: string | null
      state: string
      events: string[]
      signing_key: string
      scope: string
      organization: string
      user?: string
      creator: string
    }
  }
}

export interface CalendlyDeleteWebhookParams {
  apiKey: string
  webhookUuid: string
}

export interface CalendlyDeleteWebhookResponse extends ToolResponse {
  output: {
    deleted: boolean
    message: string
  }
}

/** The Invitee resource, returned by the single-invitee read and by the booking endpoint. */
export interface CalendlyInviteeResource {
  uri: string
  email: string
  name: string
  first_name: string | null
  last_name: string | null
  status: string
  timezone: string
  event: string
  created_at: string
  updated_at: string
  cancel_url: string
  reschedule_url: string
  rescheduled: boolean
  old_invitee: string | null
  new_invitee: string | null
  text_reminder_number: string | null
  routing_form_submission: string | null
  scheduling_method: string | null
  invitee_scheduled_by: string | null
  questions_and_answers: Array<{
    question: string
    answer: string
    position: number
  }>
  tracking: {
    utm_campaign: string | null
    utm_source: string | null
    utm_medium: string | null
    utm_content: string | null
    utm_term: string | null
    salesforce_uuid: string | null
  }
  cancellation?: {
    canceled_by: string
    reason: string
    canceler_type: string
    created_at: string
  }
  payment?: {
    external_id: string
    provider: string
    amount: number
    currency: string
    terms: string
    successful: boolean
  } | null
  no_show?: {
    uri: string
    created_at: string
  } | null
  reconfirmation?: {
    created_at: string
    confirmed_at: string | null
  } | null
}

export interface CalendlyGetEventInviteeParams {
  apiKey: string
  eventUuid: string
  inviteeUuid: string
}

export interface CalendlyGetEventInviteeResponse extends ToolResponse {
  output: {
    resource: CalendlyInviteeResource
  }
}

export interface CalendlyCreateEventInviteeParams {
  apiKey: string
  eventTypeUri: string
  startTime: string
  inviteeEmail: string
  inviteeTimezone: string
  inviteeName?: string
  inviteeFirstName?: string
  inviteeLastName?: string
  textReminderNumber?: string
  eventGuests?: string[] | string
}

export interface CalendlyCreateEventInviteeResponse extends ToolResponse {
  output: {
    resource: CalendlyInviteeResource
  }
}

export interface CalendlyListEventTypeAvailableTimesParams {
  apiKey: string
  eventTypeUri: string
  startTime: string
  endTime: string
}

export interface CalendlyListEventTypeAvailableTimesResponse extends ToolResponse {
  output: {
    collection: Array<{
      status: string
      invitees_remaining: number
      start_time: string
      scheduling_url: string
    }>
  }
}

export interface CalendlyListUserBusyTimesParams {
  apiKey: string
  user: string
  startTime: string
  endTime: string
}

export interface CalendlyListUserBusyTimesResponse extends ToolResponse {
  output: {
    collection: Array<{
      type: string
      start_time: string
      end_time: string
      buffered_start_time?: string
      buffered_end_time?: string
      event?: {
        uri: string
      }
    }>
  }
}

export interface CalendlyListUserAvailabilitySchedulesParams {
  apiKey: string
  user: string
}

export interface CalendlyListUserAvailabilitySchedulesResponse extends ToolResponse {
  output: {
    collection: Array<{
      uri: string
      default: boolean
      name: string
      user: string
      timezone: string
      rules: Array<{
        type: string
        intervals: Array<{
          from: string
          to: string
        }>
        wday?: string
        date?: string
      }>
    }>
  }
}

export interface CalendlyCreateSchedulingLinkParams {
  apiKey: string
  eventTypeUri: string
}

export interface CalendlyCreateSchedulingLinkResponse extends ToolResponse {
  output: {
    resource: {
      booking_url: string
      owner: string
      owner_type: string
    }
  }
}

export interface CalendlyCreateInviteeNoShowParams {
  apiKey: string
  inviteeUri: string
}

export interface CalendlyCreateInviteeNoShowResponse extends ToolResponse {
  output: {
    resource: {
      uri: string
      invitee: string
      created_at: string
    }
  }
}

export interface CalendlyDeleteInviteeNoShowParams {
  apiKey: string
  noShowUuid: string
}

export interface CalendlyDeleteInviteeNoShowResponse extends ToolResponse {
  output: {
    deleted: boolean
    message: string
  }
}

export interface CalendlyListOrganizationMembershipsParams {
  apiKey: string
  organization?: string
  user?: string
  email?: string
  role?: string
  count?: number
  pageToken?: string
}

export interface CalendlyListOrganizationMembershipsResponse extends ToolResponse {
  output: {
    collection: Array<{
      uri: string
      role: string
      organization: string
      created_at: string
      updated_at: string
      user: {
        uri: string
        name: string
        slug: string
        email: string
        scheduling_url: string
        timezone: string
        time_notation: string
        avatar_url: string | null
        locale: string
        created_at: string
        updated_at: string
      }
    }>
    pagination: CalendlyPagination
  }
}

export interface CalendlyListRoutingFormsParams {
  apiKey: string
  organization: string
  count?: number
  pageToken?: string
  sort?: string
}

export interface CalendlyListRoutingFormsResponse extends ToolResponse {
  output: {
    collection: Array<{
      uri: string
      organization: string
      name: string
      status: string
      questions: Array<{
        uuid: string
        name: string
        type: string
        required: boolean
        answer_choices: string[] | null
      }>
      created_at: string
      updated_at: string
    }>
    pagination: CalendlyPagination
  }
}

export interface CalendlyListRoutingFormSubmissionsParams {
  apiKey: string
  formUri: string
  count?: number
  pageToken?: string
  sort?: string
}

export interface CalendlyListRoutingFormSubmissionsResponse extends ToolResponse {
  output: {
    collection: Array<{
      uri: string
      routing_form: string
      submitter: string | null
      submitter_type: string | null
      created_at: string
      updated_at: string
      questions_and_answers: Array<{
        question_uuid: string
        question: string
        answer: string
      }>
      tracking: {
        utm_campaign: string | null
        utm_source: string | null
        utm_medium: string | null
        utm_content: string | null
        utm_term: string | null
        salesforce_uuid: string | null
      }
      result: {
        type: string
        value: string
      } | null
    }>
    pagination: CalendlyPagination
  }
}
