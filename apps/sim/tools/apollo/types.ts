import type { ToolResponse } from '@/tools/types'

// Common types
export interface ApolloPerson {
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

export interface ApolloOrganization {
  id: string
  name: string
  website_url?: string
  linkedin_url?: string
  industry?: string
  phone?: string
  employees?: number
  founded_year?: number
}

export interface ApolloContact {
  id: string
  first_name: string
  last_name: string
  email: string
  title?: string
  account_id?: string
  owner_id?: string
  created_at: string
}

export interface ApolloAccount {
  id: string
  name: string
  website_url?: string
  phone?: string
  owner_id?: string
  created_at: string
}

export interface ApolloTask {
  id: string
  note: string
  contact_id?: string
  account_id?: string
  due_at?: string
  completed: boolean
  created_at: string
}

export interface ApolloOpportunity {
  id: string
  name: string
  account_id: string
  amount?: number
  stage_id?: string
  owner_id?: string
  close_date?: string
  description?: string
  created_at: string
}

interface ApolloBaseParams {
  apiKey: string
}

// People Search Types
export interface ApolloPeopleSearchParams extends ApolloBaseParams {
  person_titles?: string[]
  person_locations?: string[]
  person_seniorities?: string[]
  organization_ids?: string[]
  organization_names?: string[]
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
  organization_name?: string
  email?: string
  domain?: string
  linkedin_url?: string
  reveal_personal_emails?: boolean
  reveal_phone_number?: boolean
}

export interface ApolloPeopleEnrichResponse extends ToolResponse {
  output: {
    person: ApolloPerson
    enriched: boolean
  }
}

// Bulk People Enrichment Types
export interface ApolloPeopleBulkEnrichParams extends ApolloBaseParams {
  people: Array<{
    first_name?: string
    last_name?: string
    organization_name?: string
    email?: string
    domain?: string
  }>
  reveal_personal_emails?: boolean
  reveal_phone_number?: boolean
}

export interface ApolloPeopleBulkEnrichResponse extends ToolResponse {
  output: {
    people: ApolloPerson[]
    total: number
    enriched: number
  }
}

// Organization Search Types
export interface ApolloOrganizationSearchParams extends ApolloBaseParams {
  organization_locations?: string[]
  organization_num_employees_ranges?: string[]
  q_organization_keyword_tags?: string[]
  q_organization_name?: string
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
  organization_name?: string
  domain?: string
}

export interface ApolloOrganizationEnrichResponse extends ToolResponse {
  output: {
    organization: ApolloOrganization
    enriched: boolean
  }
}

// Bulk Organization Enrichment Types
export interface ApolloOrganizationBulkEnrichParams extends ApolloBaseParams {
  organizations: Array<{
    organization_name?: string
    domain?: string
  }>
}

export interface ApolloOrganizationBulkEnrichResponse extends ToolResponse {
  output: {
    organizations: ApolloOrganization[]
    total: number
    enriched: number
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
    first_name: string
    last_name: string
    email?: string
    title?: string
    account_id?: string
    owner_id?: string
  }>
  run_dedupe?: boolean
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
  contacts: Array<{
    id: string
    first_name?: string
    last_name?: string
    email?: string
    title?: string
    account_id?: string
    owner_id?: string
  }>
}

export interface ApolloContactBulkUpdateResponse extends ToolResponse {
  output: {
    updated_contacts: ApolloContact[]
    failed_contacts: Array<{ id: string; error: string }>
    total_submitted: number
    updated: number
    failed: number
  }
}

// Contact Search Types
export interface ApolloContactSearchParams extends ApolloBaseParams {
  q_keywords?: string
  contact_stage_ids?: string[]
  page?: number
  per_page?: number
}

export interface ApolloPagination {
  page?: number
  per_page?: number
  total_entries?: number
  total_pages?: number
}

export interface ApolloContactSearchResponse extends ToolResponse {
  output: {
    contacts: ApolloContact[] | null
    pagination: ApolloPagination | null
  }
}

// Account Create Types
export interface ApolloAccountCreateParams extends ApolloBaseParams {
  name: string
  website_url?: string
  phone?: string
  owner_id?: string
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
  website_url?: string
  phone?: string
  owner_id?: string
}

export interface ApolloAccountUpdateResponse extends ToolResponse {
  output: {
    account: ApolloAccount | null
    updated: boolean
  }
}

// Account Search Types
export interface ApolloAccountSearchParams extends ApolloBaseParams {
  q_keywords?: string
  owner_id?: string
  account_stage_ids?: string[]
  page?: number
  per_page?: number
}

export interface ApolloAccountSearchResponse extends ToolResponse {
  output: {
    accounts: ApolloAccount[] | null
    pagination: ApolloPagination | null
  }
}

// Account Bulk Create Types
export interface ApolloAccountBulkCreateParams extends ApolloBaseParams {
  accounts: Array<{
    name: string
    website_url?: string
    phone?: string
    owner_id?: string
  }>
}

export interface ApolloAccountBulkCreateResponse extends ToolResponse {
  output: {
    created_accounts: ApolloAccount[]
    failed_accounts: Array<{ name: string; error: string }>
    total_submitted: number
    created: number
    failed: number
  }
}

// Account Bulk Update Types
export interface ApolloAccountBulkUpdateParams extends ApolloBaseParams {
  accounts: Array<{
    id: string
    name?: string
    website_url?: string
    phone?: string
    owner_id?: string
  }>
}

export interface ApolloAccountBulkUpdateResponse extends ToolResponse {
  output: {
    updated_accounts: ApolloAccount[]
    failed_accounts: Array<{ id: string; error: string }>
    total_submitted: number
    updated: number
    failed: number
  }
}

// Sequence Add Contacts Types
export interface ApolloSequenceAddContactsParams extends ApolloBaseParams {
  sequence_id: string
  contact_ids: string[]
  emailer_campaign_id?: string
  send_email_from_user_id?: string
}

export interface ApolloSequenceAddContactsResponse extends ToolResponse {
  output: {
    contacts_added: string[]
    sequence_id: string
    total_added: number
  }
}

// Task Create Types
export interface ApolloTaskCreateParams extends ApolloBaseParams {
  note: string
  contact_id?: string
  account_id?: string
  due_at?: string
  priority?: string
  type?: string
}

export interface ApolloTaskCreateResponse extends ToolResponse {
  output: {
    task: ApolloTask | null
    created: boolean
  }
}

// Task Search Types
export interface ApolloTaskSearchParams extends ApolloBaseParams {
  contact_id?: string
  account_id?: string
  completed?: boolean
  page?: number
  per_page?: number
}

export interface ApolloTaskSearchResponse extends ToolResponse {
  output: {
    tasks: ApolloTask[] | null
    pagination: ApolloPagination | null
  }
}

// Email Accounts List Types
export interface ApolloEmailAccountsParams extends ApolloBaseParams {}

export interface ApolloEmailAccountsResponse extends ToolResponse {
  output: {
    email_accounts: Array<{
      id: string
      email: string
      active: boolean
    }>
    total: number
  }
}

// Opportunity Create Types
export interface ApolloOpportunityCreateParams extends ApolloBaseParams {
  name: string
  account_id: string
  amount?: number
  stage_id?: string
  owner_id?: string
  close_date?: string
  description?: string
}

export interface ApolloOpportunityCreateResponse extends ToolResponse {
  output: {
    opportunity: ApolloOpportunity | null
    created: boolean
  }
}

// Opportunity Search Types
export interface ApolloOpportunitySearchParams extends ApolloBaseParams {
  q_keywords?: string
  account_ids?: string[]
  stage_ids?: string[]
  owner_ids?: string[]
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
    opportunity: ApolloOpportunity
    found: boolean
  }
}

// Opportunity Update Types
export interface ApolloOpportunityUpdateParams extends ApolloBaseParams {
  opportunity_id: string
  name?: string
  amount?: number
  stage_id?: string
  owner_id?: string
  close_date?: string
  description?: string
}

export interface ApolloOpportunityUpdateResponse extends ToolResponse {
  output: {
    opportunity: ApolloOpportunity | null
    updated: boolean
  }
}

// Sequence/Campaign Types
export interface ApolloSequence {
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
  active?: boolean
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
