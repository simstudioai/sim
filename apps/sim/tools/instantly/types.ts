import type { ToolResponse } from '@/tools/types'

export type InstantlyScalar = string | number | boolean | null

export interface InstantlyBaseParams {
  apiKey: string
}

export interface InstantlyLead {
  id: string | null
  timestamp_created: string | null
  timestamp_updated: string | null
  organization: string | null
  campaign: string | null
  status: number | null
  email: string | null
  personalization: string | null
  website: string | null
  last_name: string | null
  first_name: string | null
  company_name: string | null
  job_title: string | null
  phone: string | null
  email_open_count: number | null
  email_reply_count: number | null
  email_click_count: number | null
  company_domain: string | null
  payload: Record<string, unknown> | null
  lt_interest_status: number | null
}

export interface InstantlyCampaign {
  id: string | null
  name: string | null
  pl_value: number | null
  status: number | null
  is_evergreen: boolean | null
  timestamp_created: string | null
  timestamp_updated: string | null
  email_gap: number | null
  daily_limit: number | null
  daily_max_leads: number | null
  open_tracking: boolean | null
  stop_on_reply: boolean | null
  sequences: unknown[]
  campaign_schedule: Record<string, unknown> | null
}

export interface InstantlyEmail {
  id: string | null
  timestamp_created: string | null
  timestamp_email: string | null
  message_id: string | null
  subject: string | null
  from_address_email: string | null
  to_address_email_list: string | null
  cc_address_email_list: string | null
  bcc_address_email_list: string | null
  reply_to: string | null
  body: {
    text: string | null
    html: string | null
  }
  organization_id: string | null
  campaign_id: string | null
  subsequence_id: string | null
  list_id: string | null
  lead: string | null
  lead_id: string | null
  eaccount: string | null
  ue_type: number | null
  is_unread: number | null
  is_auto_reply: number | null
  i_status: number | null
  thread_id: string | null
  content_preview: string | null
}

export interface InstantlyLeadList {
  id: string | null
  organization_id: string | null
  has_enrichment_task: boolean | null
  owned_by: string | null
  name: string | null
  timestamp_created: string | null
}

export interface InstantlyListLeadsParams extends InstantlyBaseParams {
  search?: string
  filter?: string
  campaign?: string
  list_id?: string
  in_campaign?: boolean
  in_list?: boolean
  ids?: string[]
  excluded_ids?: string[]
  contacts?: string[]
  limit?: number
  starting_after?: string
  organization_user_ids?: string[]
  smart_view_id?: string
  is_website_visitor?: boolean
  distinct_contacts?: boolean
  enrichment_status?: number
  esg_code?: string
}

export interface InstantlyGetLeadParams extends InstantlyBaseParams {
  leadId: string
}

export interface InstantlyCreateLeadParams extends InstantlyBaseParams {
  campaign?: string | null
  email?: string | null
  personalization?: string | null
  website?: string | null
  last_name?: string | null
  first_name?: string | null
  company_name?: string | null
  job_title?: string | null
  phone?: string | null
  lt_interest_status?: number
  pl_value_lead?: string | null
  list_id?: string | null
  assigned_to?: string | null
  skip_if_in_workspace?: boolean
  skip_if_in_campaign?: boolean
  skip_if_in_list?: boolean
  blocklist_id?: string
  verify_leads_for_lead_finder?: boolean
  verify_leads_on_import?: boolean
  custom_variables?: Record<string, InstantlyScalar>
}

export interface InstantlyDeleteLeadsParams extends InstantlyBaseParams {
  campaign_id?: string
  list_id?: string
  status?: number
  ids?: string[]
  limit?: number
}

export interface InstantlyUpdateLeadInterestStatusParams extends InstantlyBaseParams {
  lead_email: string
  interest_value: number | null
  campaign_id?: string
  ai_interest_value?: number
  disable_auto_interest?: boolean
  list_id?: string
}

export interface InstantlyListCampaignsParams extends InstantlyBaseParams {
  limit?: number
  starting_after?: string
  search?: string
  tag_ids?: string
  ai_sales_agent_id?: string
  status?: number
}

export interface InstantlyCreateCampaignParams extends InstantlyBaseParams {
  name: string
  campaign_schedule: Record<string, unknown>
  sequences?: unknown[]
  pl_value?: number | null
  email_gap?: number | null
  text_only?: boolean | null
  email_list?: string[]
  daily_limit?: number | null
  stop_on_reply?: boolean | null
  link_tracking?: boolean | null
  open_tracking?: boolean
  daily_max_leads?: number | null
}

export interface InstantlyPatchCampaignParams extends Partial<InstantlyCreateCampaignParams> {
  apiKey: string
  campaignId: string
}

export interface InstantlyActivateCampaignParams extends InstantlyBaseParams {
  campaignId: string
}

export interface InstantlyListEmailsParams extends InstantlyBaseParams {
  limit?: number
  starting_after?: string
  search?: string
  campaign_id?: string
  list_id?: string
  i_status?: number
  eaccount?: string
  lead?: string
  is_unread?: boolean
}

export interface InstantlyReplyToEmailParams extends InstantlyBaseParams {
  eaccount: string
  reply_to_uuid: string
  subject: string
  body: {
    text?: string
    html?: string
  }
  cc_address_email_list?: string
  bcc_address_email_list?: string
}

export interface InstantlyListLeadListsParams extends InstantlyBaseParams {
  limit?: number
  starting_after?: string
  has_enrichment_task?: boolean
  search?: string
}

export interface InstantlyCreateLeadListParams extends InstantlyBaseParams {
  name: string
  has_enrichment_task?: boolean | null
  owned_by?: string | null
}

export interface InstantlyListLeadsResponse extends ToolResponse {
  output: {
    leads: InstantlyLead[]
    count: number
    next_starting_after: string | null
  }
}

export interface InstantlyLeadResponse extends ToolResponse {
  output: {
    lead: InstantlyLead
    id: string | null
    email_address: string | null
    first_name: string | null
    last_name: string | null
    campaign: string | null
    status: number | null
  }
}

export interface InstantlyDeleteLeadsResponse extends ToolResponse {
  output: {
    count: number | null
  }
}

export interface InstantlyUpdateLeadInterestStatusResponse extends ToolResponse {
  output: {
    message: string | null
  }
}

export interface InstantlyListCampaignsResponse extends ToolResponse {
  output: {
    campaigns: InstantlyCampaign[]
    count: number
    next_starting_after: string | null
  }
}

export interface InstantlyCampaignResponse extends ToolResponse {
  output: {
    campaign: InstantlyCampaign
    id: string | null
    name: string | null
    status: number | null
  }
}

export interface InstantlyListEmailsResponse extends ToolResponse {
  output: {
    emails: InstantlyEmail[]
    count: number
    next_starting_after: string | null
  }
}

export interface InstantlyEmailResponse extends ToolResponse {
  output: {
    email: InstantlyEmail
    id: string | null
    subject: string | null
    thread_id: string | null
  }
}

export interface InstantlyListLeadListsResponse extends ToolResponse {
  output: {
    lead_lists: InstantlyLeadList[]
    count: number
    next_starting_after: string | null
  }
}

export interface InstantlyLeadListResponse extends ToolResponse {
  output: {
    lead_list: InstantlyLeadList
    id: string | null
    name: string | null
  }
}

export type InstantlyResponse =
  | InstantlyListLeadsResponse
  | InstantlyLeadResponse
  | InstantlyDeleteLeadsResponse
  | InstantlyUpdateLeadInterestStatusResponse
  | InstantlyListCampaignsResponse
  | InstantlyCampaignResponse
  | InstantlyListEmailsResponse
  | InstantlyEmailResponse
  | InstantlyListLeadListsResponse
  | InstantlyLeadListResponse
