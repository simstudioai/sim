import type { ToolResponse } from '@/tools/types'

// Common types
interface ApolloPerson {
  id: string
  first_name: string
  last_name: string
  name: string
  title: string
  email: string
  organization_name?: string
  linkedin_url?: string
  phone_numbers?: Array<{
    raw_number: string
    sanitized_number: string
    type: string
  }>
}

interface ApolloOrganization {
  id: string
  name: string
  website_url?: string
  linkedin_url?: string
  industry?: string
  phone?: string
  employees?: number
  founded_year?: number
}

interface ApolloContact {
  id: string
  first_name: string
  last_name: string
  email: string
  title?: string
  account_id?: string
  owner_id?: string
  created_at: string
}

interface ApolloAccount {
  id: string
  name: string
  domain?: string | null
  website_url?: string | null
  phone?: string | null
  sanitized_phone?: string | null
  raw_address?: string | null
  owner_id?: string | null
  account_stage_id?: string | null
  existence_level?: string
  show_intent?: boolean
  has_intent_signal_account?: boolean
  typed_custom_fields?: Record<string, unknown>
  created_at: string
}

interface ApolloTask {
  id: string
  user_id?: string
  contact_id?: string
  account_id?: string
  type?: string
  priority?: string
  status?: string
  due_at?: string
  note?: string
  created_at?: string
  updated_at?: string
}

interface ApolloOpportunity {
  id: string
  team_id?: string
  name: string
  account_id?: string | null
  owner_id?: string | null
  salesforce_owner_id?: string | null
  amount?: number | string | null
  amount_in_team_currency?: number | null
  forecasted_revenue?: number | null
  exchange_rate_code?: string
  exchange_rate_value?: number
  closed_date?: string | null
  actual_close_date?: string | null
  description?: string | null
  is_closed?: boolean
  is_won?: boolean
  stage_name?: string | null
  opportunity_stage_id?: string | null
  opportunity_pipeline_id?: string | null
  source?: string
  salesforce_id?: string | null
  forecast_category?: string
  deal_probability?: number
  probability?: number | null
  created_by_id?: string
  stage_updated_at?: string
  next_step?: string | null
  next_step_date?: string | null
  closed_lost_reason?: string | null
  closed_won_reason?: string | null
  last_activity_date?: string
  existence_level?: string
  typed_custom_fields?: Record<string, unknown>
  opportunity_rule_config_statuses?: unknown[]
  opportunity_contact_roles?: unknown[]
  currency?: { name?: string; iso_code?: string; symbol?: string }
  account?: { id?: string; name?: string; website_url?: string | null }
  created_at: string
  updated_at?: string
}

interface ApolloBaseParams {
  apiKey: string
}

// People Search Types
export interface ApolloPeopleSearchParams extends ApolloBaseParams {
  person_titles?: string[]
  include_similar_titles?: boolean
  person_locations?: string[]
  person_seniorities?: string[]
  organization_ids?: string[]
  organization_names?: string[]
  organization_locations?: string[]
  q_organization_domains_list?: string[]
  organization_num_employees_ranges?: string[]
  contact_email_status?: string[]
  q_keywords?: string
  page?: number
  per_page?: number
}

export interface ApolloPeopleSearchResponse extends ToolResponse {
  output: {
    people: ApolloPerson[]
    page: number
    per_page: number
    total_entries: number
  }
}

// People Enrichment Types
export interface ApolloPeopleEnrichParams extends ApolloBaseParams {
  first_name?: string
  last_name?: string
  name?: string
  id?: string
  hashed_email?: string
  organization_name?: string
  email?: string
  domain?: string
  linkedin_url?: string
  reveal_personal_emails?: boolean
  reveal_phone_number?: boolean
  webhook_url?: string
}

export interface ApolloPeopleEnrichResponse extends ToolResponse {
  output: {
    person: ApolloPerson | null
    enriched: boolean
  }
}

// Bulk People Enrichment Types
export interface ApolloPeopleBulkEnrichParams extends ApolloBaseParams {
  people: Array<{
    first_name?: string
    last_name?: string
    name?: string
    email?: string
    hashed_email?: string
    organization_name?: string
    domain?: string
    id?: string
    linkedin_url?: string
  }>
  reveal_personal_emails?: boolean
  reveal_phone_number?: boolean
  webhook_url?: string
}

export interface ApolloPeopleBulkEnrichResponse extends ToolResponse {
  output: {
    matches: Array<ApolloPerson | null>
    total_requested_enrichments: number
    unique_enriched_records: number
    missing_records: number | null
    credits_consumed: number | null
  }
}

// Organization Search Types
export interface ApolloOrganizationSearchParams extends ApolloBaseParams {
  organization_locations?: string[]
  organization_not_locations?: string[]
  organization_num_employees_ranges?: string[]
  q_organization_keyword_tags?: string[]
  q_organization_name?: string
  organization_ids?: string[]
  q_organization_domains_list?: string[]
  page?: number
  per_page?: number
}

export interface ApolloOrganizationSearchResponse extends ToolResponse {
  output: {
    organizations: ApolloOrganization[]
    page: number
    per_page: number
    total_entries: number
  }
}

// Organization Enrichment Types
export interface ApolloOrganizationEnrichParams extends ApolloBaseParams {
  domain: string
}

export interface ApolloOrganizationEnrichResponse extends ToolResponse {
  output: {
    organization: ApolloOrganization | null
    enriched: boolean
  }
}

// Bulk Organization Enrichment Types
export interface ApolloOrganizationBulkEnrichParams extends ApolloBaseParams {
  organizations: Array<{ name: string; domain?: string }>
}

export interface ApolloOrganizationBulkEnrichResponse extends ToolResponse {
  output: {
    organizations: ApolloOrganization[]
    total: number
    enriched: number
    missing_records: number
    unique_domains: number
  }
}

// Contact Create Types
export interface ApolloContactCreateParams extends ApolloBaseParams {
  first_name: string
  last_name: string
  email?: string
  title?: string
  account_id?: string
  owner_id?: string
  organization_name?: string
  website_url?: string
  label_names?: string[]
  contact_stage_id?: string
  present_raw_address?: string
  direct_phone?: string
  corporate_phone?: string
  mobile_phone?: string
  home_phone?: string
  other_phone?: string
  typed_custom_fields?: Record<string, unknown>
  run_dedupe?: boolean
}

export interface ApolloContactCreateResponse extends ToolResponse {
  output: {
    contact: ApolloContact | null
    created: boolean
  }
}

// Contact Update Types
export interface ApolloContactUpdateParams extends ApolloBaseParams {
  contact_id: string
  first_name?: string
  last_name?: string
  email?: string
  title?: string
  account_id?: string
  owner_id?: string
  organization_name?: string
  website_url?: string
  label_names?: string[]
  contact_stage_id?: string
  present_raw_address?: string
  direct_phone?: string
  corporate_phone?: string
  mobile_phone?: string
  home_phone?: string
  other_phone?: string
  typed_custom_fields?: Record<string, unknown>
}

export interface ApolloContactUpdateResponse extends ToolResponse {
  output: {
    contact: ApolloContact | null
    updated: boolean
  }
}

// Contact Bulk Create Types
export interface ApolloContactBulkCreateParams extends ApolloBaseParams {
  contacts: Array<{
    first_name?: string
    last_name?: string
    email?: string
    title?: string
    organization_name?: string
    account_id?: string
    owner_id?: string
    contact_stage_id?: string
    linkedin_url?: string
    phone?: string
    phone_numbers?: Array<{ raw_number: string; position?: number }>
    contact_emails?: Array<{ email: string; position?: number }>
    salesforce_contact_id?: string
    hubspot_id?: string
    team_id?: string
    typed_custom_fields?: Record<string, unknown>
    [key: string]: unknown
  }>
  run_dedupe?: boolean
  append_label_names?: string[]
}

export interface ApolloContactBulkCreateResponse extends ToolResponse {
  output: {
    created_contacts: ApolloContact[]
    existing_contacts: ApolloContact[]
    total_submitted: number
    created: number
    existing: number
  }
}

// Contact Bulk Update Types
export interface ApolloContactBulkUpdateParams extends ApolloBaseParams {
  contact_ids?: string[]
  contact_attributes?: Array<{ id: string; [key: string]: unknown }> | Record<string, unknown>
  async?: boolean
}

export interface ApolloContactBulkUpdateResponse extends ToolResponse {
  output: {
    message: string | null
    job_id: string | null
  }
}

// Contact Search Types
export interface ApolloContactSearchParams extends ApolloBaseParams {
  q_keywords?: string
  contact_stage_ids?: string[]
  contact_label_ids?: string[]
  sort_by_field?: string
  sort_ascending?: boolean
  page?: number
  per_page?: number
}

interface ApolloPagination {
  page?: number
  per_page?: number
  total_entries?: number
  total_pages?: number
}

export interface ApolloContactSearchResponse extends ToolResponse {
  output: {
    contacts: ApolloContact[]
    pagination: ApolloPagination | null
  }
}

// Account Create Types
export interface ApolloAccountCreateParams extends ApolloBaseParams {
  name: string
  domain?: string
  phone?: string
  owner_id?: string
  account_stage_id?: string
  raw_address?: string
  typed_custom_fields?: Record<string, unknown>
}

export interface ApolloAccountCreateResponse extends ToolResponse {
  output: {
    account: ApolloAccount | null
    created: boolean
  }
}

// Account Update Types
export interface ApolloAccountUpdateParams extends ApolloBaseParams {
  account_id: string
  name?: string
  domain?: string
  phone?: string
  owner_id?: string
  account_stage_id?: string
  raw_address?: string
  typed_custom_fields?: Record<string, unknown>
}

export interface ApolloAccountUpdateResponse extends ToolResponse {
  output: {
    account: ApolloAccount | null
    updated: boolean
  }
}

// Account Search Types
export interface ApolloAccountSearchParams extends ApolloBaseParams {
  q_organization_name?: string
  account_stage_ids?: string[]
  account_label_ids?: string[]
  sort_by_field?: string
  sort_ascending?: boolean
  page?: number
  per_page?: number
}

export interface ApolloAccountSearchResponse extends ToolResponse {
  output: {
    accounts: ApolloAccount[]
    pagination: ApolloPagination | null
  }
}

// Account Bulk Create Types
export interface ApolloAccountBulkCreateParams extends ApolloBaseParams {
  accounts: Array<{
    name?: string
    domain?: string
    phone?: string
    phone_status_cd?: string
    raw_address?: string
    owner_id?: string
    linkedin_url?: string
    facebook_url?: string
    twitter_url?: string
    salesforce_id?: string
    hubspot_id?: string
    [key: string]: unknown
  }>
  append_label_names?: string[]
  run_dedupe?: boolean
}

export interface ApolloAccountBulkCreateResponse extends ToolResponse {
  output: {
    created_accounts: ApolloAccount[]
    existing_accounts: ApolloAccount[]
    failed_accounts: Array<Record<string, unknown>>
    total_submitted: number
    created: number
    existing: number
    failed: number
  }
}

// Account Bulk Update Types
export interface ApolloAccountBulkUpdateParams extends ApolloBaseParams {
  account_ids?: string[]
  name?: string
  owner_id?: string
  account_attributes?: Array<{ id: string; [key: string]: unknown }> | Record<string, unknown>
  async?: boolean
}

export interface ApolloAccountBulkUpdateResponse extends ToolResponse {
  output: {
    message: string | null
    account_ids: string[]
  }
}

// Sequence Add Contacts Types
export interface ApolloSequenceAddContactsParams extends ApolloBaseParams {
  sequence_id: string
  contact_ids?: string[]
  label_names?: string[]
  send_email_from_email_account_id: string
  send_email_from_email_address?: string
  sequence_no_email?: boolean
  sequence_unverified_email?: boolean
  sequence_job_change?: boolean
  sequence_active_in_other_campaigns?: boolean
  sequence_finished_in_other_campaigns?: boolean
  sequence_same_company_in_same_campaign?: boolean
  contacts_without_ownership_permission?: boolean
  add_if_in_queue?: boolean
  contact_verification_skipped?: boolean
  user_id?: string
  status?: string
  auto_unpause_at?: string
}

interface ApolloSequenceAddedContact {
  id: string
  first_name?: string
  last_name?: string
  email?: string
  status?: string
  opened_rate?: number | null
  replied_rate?: number | null
}

interface ApolloSequenceSkippedContact {
  id: string
  reason: string
}

export interface ApolloSequenceAddContactsResponse extends ToolResponse {
  output: {
    added: ApolloSequenceAddedContact[]
    skipped: ApolloSequenceSkippedContact[]
    skipped_contact_ids: string[] | Record<string, string> | null
    emailer_campaign: { id: string; name: string } | null
    sequence_id: string
    total_added: number
    total_skipped: number
  }
}

// Task Create Types
export interface ApolloTaskCreateParams extends ApolloBaseParams {
  user_id: string
  contact_ids: string[]
  priority?: string
  due_at: string
  type: string
  status: string
  note?: string
}

export interface ApolloTaskCreateResponse extends ToolResponse {
  output: {
    tasks: ApolloTask[]
    created: boolean
  }
}

// Task Search Types
export interface ApolloTaskSearchParams extends ApolloBaseParams {
  sort_by_field?: string
  open_factor_names?: string[]
  page?: number
  per_page?: number
}

export interface ApolloTaskSearchResponse extends ToolResponse {
  output: {
    tasks: ApolloTask[]
    pagination: ApolloPagination | null
  }
}

// Email Accounts List Types
export interface ApolloEmailAccountsParams extends ApolloBaseParams {}

interface ApolloEmailAccount {
  id: string | number
  email: string
  type?: string
  active?: boolean
  default?: boolean
  linked_at?: string | null
}

export interface ApolloEmailAccountsResponse extends ToolResponse {
  output: {
    email_accounts: ApolloEmailAccount[]
    total: number
  }
}

// Opportunity Create Types
export interface ApolloOpportunityCreateParams extends ApolloBaseParams {
  name: string
  account_id?: string
  amount?: string
  opportunity_stage_id?: string
  owner_id?: string
  closed_date?: string
  typed_custom_fields?: Record<string, unknown>
}

export interface ApolloOpportunityCreateResponse extends ToolResponse {
  output: {
    opportunity: ApolloOpportunity | null
    created: boolean
  }
}

// Opportunity Search Types
export interface ApolloOpportunitySearchParams extends ApolloBaseParams {
  sort_by_field?: string
  page?: number
  per_page?: number
}

export interface ApolloOpportunitySearchResponse extends ToolResponse {
  output: {
    opportunities: ApolloOpportunity[]
    page: number
    per_page: number
    total_entries: number
  }
}

// Opportunity Get Types
export interface ApolloOpportunityGetParams extends ApolloBaseParams {
  opportunity_id: string
}

export interface ApolloOpportunityGetResponse extends ToolResponse {
  output: {
    opportunity: ApolloOpportunity | null
    found: boolean
  }
}

// Opportunity Update Types
export interface ApolloOpportunityUpdateParams extends ApolloBaseParams {
  opportunity_id: string
  name?: string
  amount?: string
  opportunity_stage_id?: string
  owner_id?: string
  closed_date?: string
  typed_custom_fields?: Record<string, unknown>
}

export interface ApolloOpportunityUpdateResponse extends ToolResponse {
  output: {
    opportunity: ApolloOpportunity | null
    updated: boolean
  }
}

// Sequence/Campaign Types
interface ApolloSequence {
  id: string
  name: string
  active: boolean
  num_steps?: number
  num_contacts?: number
  created_at: string
  updated_at?: string
  user_id?: string
  permissions?: string
}

// Sequence Search Types
export interface ApolloSequenceSearchParams extends ApolloBaseParams {
  q_name?: string
  page?: number
  per_page?: number
}

export interface ApolloSequenceSearchResponse extends ToolResponse {
  output: {
    sequences: ApolloSequence[]
    page: number
    per_page: number
    total_entries: number
  }
}

// Union type for all Apollo responses
export type ApolloResponse =
  | ApolloPeopleSearchResponse
  | ApolloPeopleEnrichResponse
  | ApolloPeopleBulkEnrichResponse
  | ApolloOrganizationSearchResponse
  | ApolloOrganizationEnrichResponse
  | ApolloOrganizationBulkEnrichResponse
  | ApolloContactCreateResponse
  | ApolloContactUpdateResponse
  | ApolloContactBulkCreateResponse
  | ApolloContactBulkUpdateResponse
  | ApolloContactSearchResponse
  | ApolloAccountCreateResponse
  | ApolloAccountUpdateResponse
  | ApolloAccountSearchResponse
  | ApolloAccountBulkCreateResponse
  | ApolloAccountBulkUpdateResponse
  | ApolloSequenceAddContactsResponse
  | ApolloTaskCreateResponse
  | ApolloTaskSearchResponse
  | ApolloEmailAccountsResponse
  | ApolloSequenceSearchResponse
  | ApolloOpportunityCreateResponse
  | ApolloOpportunitySearchResponse
  | ApolloOpportunityGetResponse
  | ApolloOpportunityUpdateResponse
