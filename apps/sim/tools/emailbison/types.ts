import type { ToolResponse } from '@/tools/types'

export interface EmailBisonBaseParams {
  apiKey: string
  apiBaseUrl: string
}

export interface EmailBisonCustomVariable {
  name: string | null
  value: string | null
}

export interface EmailBisonLeadStats {
  emails_sent: number | null
  opens: number | null
  replies: number | null
  unique_replies: number | null
  unique_opens: number | null
}

export interface EmailBisonLead {
  id: number | null
  first_name: string | null
  last_name: string | null
  email: string | null
  title: string | null
  company: string | null
  notes: string | null
  status: string | null
  custom_variables: EmailBisonCustomVariable[]
  lead_campaign_data: unknown[]
  overall_stats: EmailBisonLeadStats
  created_at: string | null
  updated_at: string | null
}

export interface EmailBisonTag {
  id: number | null
  name: string | null
  default: boolean | null
  created_at?: string | null
  updated_at?: string | null
}

export interface EmailBisonCampaignTag {
  id: number | null
  name: string | null
  default: boolean | null
}

export interface EmailBisonCampaign {
  id: number | null
  uuid: string | null
  name: string | null
  type: string | null
  status: string | null
  emails_sent: number | null
  opened: number | null
  unique_opens: number | null
  replied: number | null
  unique_replies: number | null
  bounced: number | null
  unsubscribed: number | null
  interested: number | null
  total_leads_contacted: number | null
  total_leads: number | null
  max_emails_per_day: number | null
  max_new_leads_per_day: number | null
  plain_text: boolean | null
  open_tracking: boolean | null
  can_unsubscribe: boolean | null
  unsubscribe_text: string | null
  sequence_prioritization?: string | null
  tags: EmailBisonCampaignTag[]
  created_at: string | null
  updated_at: string | null
}

export interface EmailBisonReplyAddress {
  name: string | null
  address: string | null
}

export interface EmailBisonReplyAttachment {
  id: number | null
  uuid: string | null
  reply_id: number | null
  file_name: string | null
  download_url: string | null
  created_at: string | null
  updated_at: string | null
}

export interface EmailBisonReply {
  id: number | null
  uuid: string | null
  folder: string | null
  subject: string | null
  read: boolean | null
  interested: boolean | null
  automated_reply: boolean | null
  html_body: string | null
  text_body: string | null
  raw_body: string | null
  headers: string | null
  date_received: string | null
  type: string | null
  tracked_reply: boolean | null
  scheduled_email_id: number | string | null
  campaign_id: number | string | null
  lead_id: number | null
  sender_email_id: number | null
  raw_message_id: string | null
  from_name: string | null
  from_email_address: string | null
  primary_to_email_address: string | null
  to: EmailBisonReplyAddress[]
  cc: string | null
  bcc: string | null
  parent_id: number | string | null
  attachments: EmailBisonReplyAttachment[]
  created_at: string | null
  updated_at: string | null
}

export interface EmailBisonListLeadsParams extends EmailBisonBaseParams {
  search?: string
  campaignStatus?: string
  tagIds?: number[]
  excludedTagIds?: number[]
  withoutTags?: boolean
}

export interface EmailBisonGetLeadParams extends EmailBisonBaseParams {
  leadId: string
}

export interface EmailBisonLeadMutationParams extends EmailBisonBaseParams {
  leadId?: string
  firstName: string
  lastName: string
  email: string
  title?: string
  company?: string
  notes?: string
  customVariables?: EmailBisonCustomVariable[]
}

export interface EmailBisonCreateCampaignParams extends EmailBisonBaseParams {
  name: string
  campaignType?: 'outbound' | 'reply_followup'
}

export interface EmailBisonUpdateCampaignParams extends EmailBisonBaseParams {
  campaignId: number
  name?: string
  maxEmailsPerDay?: number
  maxNewLeadsPerDay?: number
  plainText?: boolean
  openTracking?: boolean
  reputationBuilding?: boolean
  canUnsubscribe?: boolean
  includeAutoRepliesInStats?: boolean
  sequencePrioritization?: 'followups' | 'new_leads'
}

export interface EmailBisonCampaignStatusParams extends EmailBisonBaseParams {
  campaignId: number
  action: 'pause' | 'resume' | 'archive'
}

export interface EmailBisonAttachLeadsParams extends EmailBisonBaseParams {
  campaignId: number
  leadIds: number[]
  allowParallelSending?: boolean
}

export interface EmailBisonListRepliesParams extends EmailBisonBaseParams {
  search?: string
  status?: string
  folder?: string
  read?: boolean
  campaignId?: number
  senderEmailId?: number
  leadId?: number
  tagIds?: number[]
}

export interface EmailBisonCreateTagParams extends EmailBisonBaseParams {
  name: string
}

export interface EmailBisonAttachTagsToLeadsParams extends EmailBisonBaseParams {
  tagIds: number[]
  leadIds: number[]
  skipWebhooks?: boolean
}

export interface EmailBisonListLeadsResponse extends ToolResponse {
  output: {
    leads: EmailBisonLead[]
    count: number
  }
}

export interface EmailBisonLeadResponse extends ToolResponse {
  output: EmailBisonLead
}

export interface EmailBisonListCampaignsResponse extends ToolResponse {
  output: {
    campaigns: EmailBisonCampaign[]
    count: number
  }
}

export interface EmailBisonCampaignResponse extends ToolResponse {
  output: EmailBisonCampaign
}

export interface EmailBisonActionResponse extends ToolResponse {
  output: {
    success: boolean
    message: string | null
  }
}

export interface EmailBisonListRepliesResponse extends ToolResponse {
  output: {
    replies: EmailBisonReply[]
    count: number
  }
}

export interface EmailBisonListTagsResponse extends ToolResponse {
  output: {
    tags: EmailBisonTag[]
    count: number
  }
}

export interface EmailBisonTagResponse extends ToolResponse {
  output: EmailBisonTag
}

export type EmailBisonResponse =
  | EmailBisonListLeadsResponse
  | EmailBisonLeadResponse
  | EmailBisonListCampaignsResponse
  | EmailBisonCampaignResponse
  | EmailBisonActionResponse
  | EmailBisonListRepliesResponse
  | EmailBisonListTagsResponse
  | EmailBisonTagResponse
