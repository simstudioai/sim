import { createLogger } from '@sim/logger'

const logger = createLogger('Mailchimp')

// Base params
export interface MailchimpBaseParams {
  apiKey: string // API key with server prefix (e.g., "key-us19")
}

export interface MailchimpPaginationParams {
  count?: string
  offset?: string
}

export interface MailchimpPagingInfo {
  total_items: number
}

export interface MailchimpResponse<T> {
  success: boolean
  output: {
    data?: T
    paging?: MailchimpPagingInfo
    metadata?: {
      [key: string]: unknown
    }
    success: boolean
  }
}

// Member/Subscriber
export interface MailchimpMember {
  id: string
  email_address: string
  unique_email_id?: string
  status: 'subscribed' | 'unsubscribed' | 'cleaned' | 'pending'
  merge_fields?: Record<string, unknown>
  interests?: Record<string, boolean>
  stats?: {
    avg_open_rate?: number
    avg_click_rate?: number
  }
  ip_signup?: string
  timestamp_signup?: string
  ip_opt?: string
  timestamp_opt?: string
  member_rating?: number
  last_changed?: string
  language?: string
  vip?: boolean
  email_client?: string
  location?: {
    latitude?: number
    longitude?: number
    gmtoff?: number
    dstoff?: number
    country_code?: string
    timezone?: string
  }
  tags?: Array<{ id: number; name: string }>
  [key: string]: unknown
}

// Audience/List
export interface MailchimpAudience {
  id: string
  name: string
  contact: {
    company: string
    address1: string
    address2?: string
    city: string
    state: string
    zip: string
    country: string
    phone?: string
  }
  permission_reminder: string
  campaign_defaults: {
    from_name: string
    from_email: string
    subject: string
    language: string
  }
  email_type_option: boolean
  stats?: {
    member_count?: number
    unsubscribe_count?: number
    cleaned_count?: number
    member_count_since_send?: number
    unsubscribe_count_since_send?: number
    cleaned_count_since_send?: number
    campaign_count?: number
    campaign_last_sent?: string
    merge_field_count?: number
    avg_sub_rate?: number
    avg_unsub_rate?: number
    target_sub_rate?: number
    open_rate?: number
    click_rate?: number
    last_sub_date?: string
    last_unsub_date?: string
  }
  date_created?: string
  list_rating?: number
  subscribe_url_short?: string
  subscribe_url_long?: string
  visibility?: string
  [key: string]: unknown
}

// Campaign
export interface MailchimpCampaign {
  id: string
  type: 'regular' | 'plaintext' | 'absplit' | 'rss' | 'variate'
  create_time?: string
  archive_url?: string
  long_archive_url?: string
  status: 'save' | 'paused' | 'schedule' | 'sending' | 'sent'
  emails_sent?: number
  send_time?: string
  content_type?: string
  recipients?: {
    list_id: string
    list_name?: string
    segment_text?: string
    recipient_count?: number
  }
  settings?: {
    subject_line?: string
    preview_text?: string
    title?: string
    from_name?: string
    reply_to?: string
    use_conversation?: boolean
    to_name?: string
    folder_id?: string
    authenticate?: boolean
    auto_footer?: boolean
    inline_css?: boolean
    auto_tweet?: boolean
    fb_comments?: boolean
    timewarp?: boolean
    template_id?: number
    drag_and_drop?: boolean
  }
  tracking?: {
    opens?: boolean
    html_clicks?: boolean
    text_clicks?: boolean
    goal_tracking?: boolean
    ecomm360?: boolean
    google_analytics?: string
    clicktale?: string
  }
  [key: string]: unknown
}

// Campaign Content
export interface MailchimpCampaignContent {
  html?: string
  plain_text?: string
  archive_html?: string
  [key: string]: unknown
}

// Campaign Report
export interface MailchimpCampaignReport {
  id: string
  campaign_title?: string
  type?: string
  emails_sent?: number
  abuse_reports?: number
  unsubscribed?: number
  send_time?: string
  bounces?: {
    hard_bounces?: number
    soft_bounces?: number
    syntax_errors?: number
  }
  forwards?: {
    forwards_count?: number
    forwards_opens?: number
  }
  opens?: {
    opens_total?: number
    unique_opens?: number
    open_rate?: number
    last_open?: string
  }
  clicks?: {
    clicks_total?: number
    unique_clicks?: number
    unique_subscriber_clicks?: number
    click_rate?: number
    last_click?: string
  }
  list_stats?: {
    sub_rate?: number
    unsub_rate?: number
    open_rate?: number
    click_rate?: number
  }
  [key: string]: unknown
}

// Automation
export interface MailchimpAutomation {
  id: string
  create_time?: string
  start_time?: string
  status: 'save' | 'paused' | 'sending'
  emails_sent?: number
  recipients?: {
    list_id: string
    list_name?: string
    segment_opts?: unknown
  }
  settings?: {
    title?: string
    from_name?: string
    reply_to?: string
    use_conversation?: boolean
    to_name?: string
    authenticate?: boolean
    auto_footer?: boolean
    inline_css?: boolean
  }
  tracking?: {
    opens?: boolean
    html_clicks?: boolean
    text_clicks?: boolean
    goal_tracking?: boolean
    ecomm360?: boolean
    google_analytics?: string
    clicktale?: string
  }
  [key: string]: unknown
}

// Segment
export interface MailchimpSegment {
  id: number
  name: string
  member_count?: number
  type: 'saved' | 'static' | 'fuzzy'
  created_at?: string
  updated_at?: string
  options?: {
    match?: 'any' | 'all'
    conditions?: Array<{
      condition_type?: string
      field?: string
      op?: string
      value?: unknown
    }>
  }
  list_id?: string
  [key: string]: unknown
}

// Template
export interface MailchimpTemplate {
  id: number
  type: string
  name: string
  drag_and_drop?: boolean
  responsive?: boolean
  category?: string
  date_created?: string
  date_edited?: string
  created_by?: string
  edited_by?: string
  active?: boolean
  folder_id?: string
  thumbnail?: string
  share_url?: string
  [key: string]: unknown
}

// Landing Page
export interface MailchimpLandingPage {
  id: string
  name: string
  title?: string
  description?: string
  template_id?: number
  status: 'draft' | 'published' | 'unpublished'
  list_id?: string
  store_id?: string
  web_id?: number
  created_at?: string
  published_at?: string
  unpublished_at?: string
  updated_at?: string
  url?: string
  tracking?: {
    opens?: boolean
    html_clicks?: boolean
    text_clicks?: boolean
    goal_tracking?: boolean
    ecomm360?: boolean
    google_analytics?: string
    clicktale?: string
  }
  [key: string]: unknown
}

// Interest Category
export interface MailchimpInterestCategory {
  list_id?: string
  id: string
  title: string
  display_order?: number
  type: 'checkboxes' | 'dropdown' | 'radio' | 'hidden'
  [key: string]: unknown
}

// Interest
export interface MailchimpInterest {
  category_id?: string
  list_id?: string
  id: string
  name: string
  subscriber_count?: string
  display_order?: number
  [key: string]: unknown
}

// Merge Field
export interface MailchimpMergeField {
  merge_id?: number
  tag: string
  name: string
  type:
    | 'text'
    | 'number'
    | 'address'
    | 'phone'
    | 'date'
    | 'url'
    | 'imageurl'
    | 'radio'
    | 'dropdown'
    | 'birthday'
    | 'zip'
  required?: boolean
  default_value?: string
  public?: boolean
  display_order?: number
  options?: {
    default_country?: number
    phone_format?: string
    date_format?: string
    choices?: string[]
    size?: number
  }
  help_text?: string
  list_id?: string
  [key: string]: unknown
}

// Batch Operation
export interface MailchimpBatchOperation {
  id: string
  status: 'pending' | 'preprocessing' | 'started' | 'finalizing' | 'finished'
  total_operations?: number
  finished_operations?: number
  errored_operations?: number
  submitted_at?: string
  completed_at?: string
  response_body_url?: string
  [key: string]: unknown
}

// Tag
export interface MailchimpTag {
  id: number
  name: string
  [key: string]: unknown
}

// Error Response
export interface MailchimpErrorResponse {
  type?: string
  title?: string
  status?: number
  detail?: string
  instance?: string
  errors?: Array<{
    field?: string
    message?: string
  }>
}

// Helper function to extract server prefix from API key
export function extractServerPrefix(apiKey: string): string {
  const parts = apiKey.split('-')
  if (parts.length < 2) {
    throw new Error('Invalid Mailchimp API key format. Expected format: key-dc (e.g., abc123-us19)')
  }
  return parts[parts.length - 1]
}

// Helper function to build Mailchimp API URLs
export function buildMailchimpUrl(apiKey: string, path: string): string {
  const serverPrefix = extractServerPrefix(apiKey)
  return `https://${serverPrefix}.api.mailchimp.com/3.0${path}`
}

// Helper function for consistent error handling
export function handleMailchimpError(data: unknown, status: number, operation: string): never {
  logger.error(`Mailchimp API request failed for ${operation}`, { data, status })

  const errorData = data as Record<string, unknown>
  const errorMessage =
    errorData.detail || errorData.title || errorData.error || errorData.message || 'Unknown error'
  throw new Error(`Mailchimp ${operation} failed: ${errorMessage}`)
}
