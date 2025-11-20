import type { ToolResponse } from '@/tools/types'

export interface CalendlyGetCurrentUserParams {
  apiKey: string
}

export interface CalendlyGetCurrentUserResponse extends ToolResponse {
  output: {
    resource: {
      uri: string
      name: string
      slug: string
      email: string
      scheduling_url: string
      timezone: string
      avatar_url: string
      created_at: string
      updated_at: string
      current_organization: string
      resource_type: string
      locale: string
    }
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
  count?: number
  pageToken?: string
  scope?: string
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
  events: string[]
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
