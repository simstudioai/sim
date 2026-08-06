import type { ToolResponse } from '@/tools/types'

/**
 * Smartlead encodes several numeric fields as strings (`total_leads: "1"`,
 * `sent_count: "0"`, lead ids on some endpoints but not others). Every mapper in
 * this integration normalizes those to `number` so the same field never changes
 * type between operations.
 */

export interface SmartleadBaseParams {
  apiKey: string
}

export interface SmartleadCampaignIdParams extends SmartleadBaseParams {
  campaignId: number
}

export interface SmartleadCampaignLeadParams extends SmartleadCampaignIdParams {
  leadId: number
}

export interface SmartleadSchedulerCron {
  tz: string | null
  days: number[]
  startHour: string | null
  endHour: string | null
}

export interface SmartleadCampaign {
  id: number | null
  user_id: number | null
  name: string | null
  status: string | null
  created_at: string | null
  updated_at: string | null
  track_settings: string[]
  scheduler_cron_value: SmartleadSchedulerCron | null
  min_time_btwn_emails: number | null
  max_leads_per_day: number | null
  stop_lead_settings: string | null
  schedule_start_time: string | null
  enable_ai_esp_matching: boolean | null
  send_as_plain_text: boolean | null
  follow_up_percentage: number | null
  unsubscribe_text: string | null
  parent_campaign_id: number | null
  client_id: number | null
  tags: unknown[]
}

export interface SmartleadSequence {
  id: number | null
  created_at: string | null
  updated_at: string | null
  email_campaign_id: number | null
  seq_number: number | null
  delay_in_days: number | null
  subject: string | null
  email_body: string | null
  sequence_variants: unknown[]
}

export interface SmartleadSavedSequence {
  id: number | null
  seq_number: number | null
}

export interface SmartleadLead {
  id: number | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone_number: string | null
  company_name: string | null
  website: string | null
  location: string | null
  linkedin_profile: string | null
  company_url: string | null
  custom_fields: Record<string, unknown>
  is_unsubscribed: boolean | null
}

export interface SmartleadCampaignLead {
  campaign_lead_map_id: number | null
  lead_category_id: number | null
  status: string | null
  created_at: string | null
  lead: SmartleadLead
}

export interface SmartleadLeadCampaignData {
  campaign_id: number | null
  campaign_name: string | null
  campaign_lead_map_id: number | null
  lead_category_id: number | null
  last_sent_at: string | null
  last_reply_at: string | null
  last_activity_at: string | null
  client_id: number | null
  client_email: string | null
}

export interface SmartleadLeadDetail extends SmartleadLead {
  created_at: string | null
  lead_campaign_data: SmartleadLeadCampaignData[]
}

export interface SmartleadLeadCategory {
  id: number | null
  name: string | null
  sentiment_type: string | null
  created_at: string | null
}

export interface SmartleadCampaignLeadStats {
  total: number | null
  notStarted: number | null
  inprogress: number | null
  completed: number | null
  paused: number | null
  stopped: number | null
  blocked: number | null
  interested: number | null
  revenue: number | null
}

export interface SmartleadCampaignAnalytics {
  id: number | null
  user_id: number | null
  name: string | null
  status: string | null
  created_at: string | null
  sent_count: number | null
  unique_sent_count: number | null
  open_count: number | null
  unique_open_count: number | null
  click_count: number | null
  unique_click_count: number | null
  reply_count: number | null
  bounce_count: number | null
  block_count: number | null
  unsubscribed_count: number | null
  total_count: number | null
  drafted_count: number | null
  sequence_count: number | null
  campaign_lead_stats: SmartleadCampaignLeadStats
  client_id: number | null
  client_name: string | null
  client_email: string | null
  client_company_name: string | null
  parent_campaign_id: number | null
  send_as_plain_text: boolean | null
}

export interface SmartleadCampaignAnalyticsByDate {
  id: number | null
  user_id: number | null
  name: string | null
  status: string | null
  created_at: string | null
  start_date: string | null
  end_date: string | null
  sent_count: number | null
  unique_sent_count: number | null
  open_count: number | null
  unique_open_count: number | null
  click_count: number | null
  unique_click_count: number | null
  reply_count: number | null
  bounce_count: number | null
  block_count: number | null
  unsubscribed_count: number | null
  total_count: number | null
  drafted_count: number | null
}

export interface SmartleadLeadImportResult {
  upload_count: number | null
  total_leads: number | null
  already_added_to_campaign: number | null
  duplicate_count: number | null
  invalid_email_count: number | null
  block_count: number | null
  bounce_count: number | null
  lead_import_stopped_count: number | null
  is_lead_limit_exhausted: boolean | null
  invalid_emails: unknown[]
  unsubscribed_leads: unknown[]
}

export interface SmartleadWebhook {
  id: number | null
  name: string | null
  webhook_url: string | null
  email_campaign_id: number | null
  event_types: string[]
  categories: string[]
  created_at: string | null
  updated_at: string | null
}

export interface SmartleadSavedWebhook {
  id: number | null
  name: string | null
  webhook_url: string | null
  email_campaign_id: number | null
  event_types: string[]
  categories: string[]
}

export interface SmartleadListCampaignsResponse extends ToolResponse {
  output: {
    campaigns: SmartleadCampaign[]
    count: number
  }
}

export interface SmartleadCampaignResponse extends ToolResponse {
  output: SmartleadCampaign
}

export interface SmartleadCreateCampaignResponse extends ToolResponse {
  output: {
    id: number | null
    name: string | null
    created_at: string | null
  }
}

export interface SmartleadActionResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export interface SmartleadCampaignAnalyticsResponse extends ToolResponse {
  output: SmartleadCampaignAnalytics
}

export interface SmartleadCampaignAnalyticsByDateResponse extends ToolResponse {
  output: SmartleadCampaignAnalyticsByDate
}

export interface SmartleadSequencesResponse extends ToolResponse {
  output: {
    sequences: SmartleadSequence[]
    count: number
  }
}

export interface SmartleadSaveSequencesResponse extends ToolResponse {
  output: {
    success: boolean
    sequences: SmartleadSavedSequence[]
    count: number
  }
}

export interface SmartleadCampaignStatisticsResponse extends ToolResponse {
  output: {
    stats: unknown[]
    total_stats: number | null
    offset: number | null
    limit: number | null
  }
}

export interface SmartleadAddLeadsResponse extends ToolResponse {
  output: SmartleadLeadImportResult
}

export interface SmartleadListCampaignLeadsResponse extends ToolResponse {
  output: {
    leads: SmartleadCampaignLead[]
    total_leads: number | null
    offset: number | null
    limit: number | null
    count: number
  }
}

export interface SmartleadLeadDetailResponse extends ToolResponse {
  output: SmartleadLeadDetail
}

export interface SmartleadLeadCategoriesResponse extends ToolResponse {
  output: {
    categories: SmartleadLeadCategory[]
    count: number
  }
}

export interface SmartleadMessageHistoryResponse extends ToolResponse {
  output: {
    history: unknown[]
    count: number
  }
}

export interface SmartleadListWebhooksResponse extends ToolResponse {
  output: {
    webhooks: SmartleadWebhook[]
    count: number
  }
}

export interface SmartleadUpsertWebhookResponse extends ToolResponse {
  output: SmartleadSavedWebhook
}

export type SmartleadResponse =
  | SmartleadListCampaignsResponse
  | SmartleadCampaignResponse
  | SmartleadCreateCampaignResponse
  | SmartleadActionResponse
  | SmartleadCampaignAnalyticsResponse
  | SmartleadCampaignAnalyticsByDateResponse
  | SmartleadSequencesResponse
  | SmartleadSaveSequencesResponse
  | SmartleadCampaignStatisticsResponse
  | SmartleadAddLeadsResponse
  | SmartleadListCampaignLeadsResponse
  | SmartleadLeadDetailResponse
  | SmartleadLeadCategoriesResponse
  | SmartleadMessageHistoryResponse
  | SmartleadListWebhooksResponse
  | SmartleadUpsertWebhookResponse
