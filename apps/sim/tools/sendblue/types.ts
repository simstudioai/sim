import type { ToolResponse } from '@/tools/types'

/**
 * iMessage expressive styles supported by Sendblue.
 */
export type SendblueSendStyle =
  | 'celebration'
  | 'shooting_star'
  | 'fireworks'
  | 'lasers'
  | 'love'
  | 'confetti'
  | 'balloons'
  | 'spotlight'
  | 'echo'
  | 'invisible'
  | 'gentle'
  | 'loud'
  | 'slam'

export interface SendblueBaseParams {
  apiKeyId: string
  apiSecretKey: string
}

export interface SendblueSendMessageParams extends SendblueBaseParams {
  number: string
  from_number: string
  content?: string
  media_url?: string
  send_style?: SendblueSendStyle
  seat_id?: string
  status_callback?: string
}

export interface SendblueSendGroupMessageParams extends SendblueBaseParams {
  numbers?: string[]
  from_number: string
  content?: string
  media_url?: string
  send_style?: SendblueSendStyle
  seat_id?: string
  group_id?: string
  status_callback?: string
}

export interface SendblueEvaluateServiceParams extends SendblueBaseParams {
  number: string
}

export interface SendblueTypingIndicatorParams extends SendblueBaseParams {
  number: string
  from_number?: string
  state?: 'start' | 'stop'
  max_duration_ms?: number
}

export interface SendblueGetMessageParams extends SendblueBaseParams {
  message_id: string
}

/**
 * Shared shape of a Sendblue message resource returned by the send endpoints.
 */
export interface SendblueMessageOutput {
  status: string | null
  message_handle: string | null
  account_email: string | null
  content: string | null
  is_outbound: boolean | null
  from_number: string | null
  number: string | null
  media_url: string | null
  send_style: string | null
  seat_id: string | null
  sender_email: string | null
  error_code: number | null
  error_message: string | null
  date_created: string | null
  date_updated: string | null
}

export interface SendblueSendMessageResponse extends ToolResponse {
  output: SendblueMessageOutput
}

export interface SendblueSendGroupMessageResponse extends ToolResponse {
  output: SendblueMessageOutput & {
    group_id: string | null
    participants: string[]
  }
}

export interface SendblueEvaluateServiceResponse extends ToolResponse {
  output: {
    number: string | null
    service: string | null
  }
}

export interface SendblueTypingIndicatorResponse extends ToolResponse {
  output: {
    status: string | null
    status_code: number | null
    number: string | null
    error_message: string | null
  }
}

export interface SendblueGetMessageResponse extends ToolResponse {
  output: {
    status: string | null
    message_handle: string | null
    account_email: string | null
    content: string | null
    is_outbound: boolean | null
    from_number: string | null
    number: string | null
    to_number: string | null
    media_url: string | null
    message_type: string | null
    service: string | null
    group_id: string | null
    group_display_name: string | null
    participants: string[]
    send_style: string | null
    was_downgraded: boolean | null
    opted_out: boolean | null
    plan: string | null
    sendblue_number: string | null
    seat_id: string | null
    sender_email: string | null
    error_code: number | null
    error_message: string | null
    error_reason: string | null
    error_detail: string | null
    date_sent: string | null
    date_updated: string | null
  }
}
