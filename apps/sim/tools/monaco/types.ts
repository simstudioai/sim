import type { OutputProperty, ToolResponse } from '@/tools/types'

/** Monaco's documented `pagination` object on every list response. */
export interface MonacoPagination {
  page: number
  page_size: number
  total_count: number
  total_pages: number
}

/** Monaco's documented `ContactResponse` resource. */
export interface MonacoContact {
  id: string
  account_id: string | null
  account_name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  title: string | null
  phone_number: string | null
  linkedin_url: string | null
  location: string | null
  country: string | null
  job_start_date: string | null
  source: string | null
  do_not_contact: boolean
  notes: string | null
  scoring: { heat_score: string | null } | null
  tags: string[]
  created_at: string
  updated_at: string
  last_activity_at: string | null
  last_activity_type: string | null
  last_outbound_at: string | null
  last_outbound_type: string | null
  last_inbound_at: string | null
  last_inbound_type: string | null
  custom_fields: Record<string, unknown>
}

/** One signal behind a Monaco heat score. */
export interface MonacoScoreSignal {
  signal_type: string
  signal_point: string
}

/** Monaco's documented `ScoreExplanation`: the signals behind a heat score tier. */
export interface MonacoScoreExplanation {
  explanations: MonacoScoreSignal[]
  firmographic: MonacoScoreSignal[]
}

/** Monaco's documented `ContactDetailResponse`: a contact plus heat score explanations. */
export interface MonacoContactDetail extends MonacoContact {
  heat_score_explanation: MonacoScoreExplanation | null
}

/** Every Monaco tool authenticates with the saved Monaco API key credential. */
export interface MonacoBaseParams {
  accessToken: string
}

/** Shared body of Monaco's `POST /v1/{entity}/list` endpoints. */
export interface MonacoListParams extends MonacoBaseParams {
  filters?: unknown
  sort?: string
  page?: number
  pageSize?: number
}

/** Page controls for Monaco's GET list endpoints, which take `page` and `page_size` as query parameters. */
export interface MonacoPageParams extends MonacoBaseParams {
  page?: number
  pageSize?: number
}

export const MONACO_PAGINATION_OUTPUT = {
  type: 'object',
  description: 'Pagination for the returned page',
  properties: {
    page: { type: 'number', description: 'Current page number (1-indexed)' },
    page_size: { type: 'number', description: 'Number of results per page' },
    total_count: { type: 'number', description: 'Total number of matching records' },
    total_pages: { type: 'number', description: 'Total number of pages' },
  },
} as const satisfies OutputProperty

const MONACO_CUSTOM_FIELDS_OUTPUT = {
  type: 'json',
  description:
    'Custom field values keyed by their `custom_field_<id>` key. Use Get Field Schemas to see what each key means.',
} as const satisfies OutputProperty

export const MONACO_CONTACT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the contact' },
  account_id: {
    type: 'string',
    description: 'ID of the associated account',
    nullable: true,
  },
  account_name: {
    type: 'string',
    description:
      "Display name of the associated account: its user-set name, falling back to the company name, then the account's domain",
    nullable: true,
  },
  first_name: { type: 'string', description: 'First name of the contact', nullable: true },
  last_name: { type: 'string', description: 'Last name of the contact', nullable: true },
  email: { type: 'string', description: 'Email address of the contact', nullable: true },
  title: { type: 'string', description: 'Job title of the contact', nullable: true },
  phone_number: { type: 'string', description: 'Phone number of the contact', nullable: true },
  linkedin_url: { type: 'string', description: 'LinkedIn profile URL', nullable: true },
  location: { type: 'string', description: 'Location of the contact', nullable: true },
  country: { type: 'string', description: 'Country of the contact', nullable: true },
  job_start_date: {
    type: 'string',
    description: "Start date of the contact's current job (YYYY-MM-DD)",
    nullable: true,
  },
  source: {
    type: 'string',
    description: 'Source from which the contact was added',
    nullable: true,
  },
  do_not_contact: {
    type: 'boolean',
    description: 'Whether the contact has opted out of outreach',
  },
  notes: { type: 'string', description: 'Notes about the contact', nullable: true },
  scoring: {
    type: 'object',
    description: 'Contact scoring information',
    nullable: true,
    properties: {
      heat_score: { type: 'string', description: 'Heat score tier', nullable: true },
    },
  },
  tags: {
    type: 'array',
    description: 'Tag names associated with the contact',
    items: { type: 'string', description: 'Tag name' },
  },
  created_at: { type: 'string', description: 'When the contact was created (ISO 8601)' },
  updated_at: { type: 'string', description: 'When the contact was last updated (ISO 8601)' },
  last_activity_at: {
    type: 'string',
    description: "When the contact's most recent activity (inbound or outbound) happened",
    nullable: true,
  },
  last_activity_type: {
    type: 'string',
    description: "Type of the contact's most recent activity",
    nullable: true,
  },
  last_outbound_at: {
    type: 'string',
    description: 'When the most recent outbound interaction with the contact happened',
    nullable: true,
  },
  last_outbound_type: {
    type: 'string',
    description: 'Type of the most recent outbound interaction with the contact',
    nullable: true,
  },
  last_inbound_at: {
    type: 'string',
    description: 'When the most recent inbound interaction from the contact happened',
    nullable: true,
  },
  last_inbound_type: {
    type: 'string',
    description: 'Type of the most recent inbound interaction from the contact',
    nullable: true,
  },
  custom_fields: MONACO_CUSTOM_FIELDS_OUTPUT,
} as const satisfies Record<string, OutputProperty>

const MONACO_SCORE_SIGNAL_LIST = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      signal_type: { type: 'string', description: 'Type of signal contributing to the score' },
      signal_point: {
        type: 'string',
        description: "Human-readable explanation of the signal's contribution",
      },
    },
  },
} as const

/** Monaco's documented `ScoreExplanation` object, shared by contact and account details. */
const MONACO_SCORE_EXPLANATION_OUTPUT = {
  type: 'object',
  description: 'Per-signal explanations behind the heat score tier',
  nullable: true,
  properties: {
    explanations: {
      ...MONACO_SCORE_SIGNAL_LIST,
      description: 'Behavioral and intent signals behind the score',
    },
    firmographic: {
      ...MONACO_SCORE_SIGNAL_LIST,
      description: 'Firmographic signals behind the score',
    },
  },
} as const satisfies OutputProperty

export const MONACO_CONTACT_DETAIL_OUTPUT_PROPERTIES = {
  ...MONACO_CONTACT_OUTPUT_PROPERTIES,
  heat_score_explanation: MONACO_SCORE_EXPLANATION_OUTPUT,
} as const satisfies Record<string, OutputProperty>

export interface MonacoListContactsParams extends MonacoListParams {
  includeCustomFields?: boolean
}

export interface MonacoListContactsResponse extends ToolResponse {
  output: {
    contacts: MonacoContact[]
    pagination: MonacoPagination
  }
}

export interface MonacoGetContactParams extends MonacoBaseParams {
  contactId: string
  includeReasoning?: boolean
}

export interface MonacoGetContactResponse extends ToolResponse {
  output: {
    contact: MonacoContactDetail
  }
}

export interface MonacoDeleteContactParams extends MonacoBaseParams {
  contactId: string
}

export interface MonacoDeleteResponse extends ToolResponse {
  output: {
    id: string
    deleted: boolean
  }
}

/** Monaco's documented `ContactWriteResponse`: a contact plus how enriching it ended. */
export interface MonacoContactWrite extends MonacoContact {
  enrichment_status: string | null
}

/** Monaco's documented `OwnerInfo`: the user who owns a record. */
export interface MonacoOwner {
  id: string
  first_name: string | null
  last_name: string | null
}

/** Monaco's documented `ParentAccountInfo`. */
interface MonacoParentAccount {
  id: string
  name: string | null
}

/** Monaco's documented `CompanyInfo` on an account. */
export interface MonacoAccountCompany {
  domain: string | null
  linkedin_url: string | null
  description: string | null
  employee_count: number | null
  founded_year: number | null
  industries: string[]
  total_funding_usd: number | null
  last_funding_date: string | null
  company_name: string | null
  estimated_annual_revenue_usd: number | null
  last_funding_round: string | null
  business_model: string | null
  company_status: string | null
  location: string | null
}

/** Monaco's documented `AccountResponse` resource. */
export interface MonacoAccount {
  id: string
  name: string | null
  status: string | null
  owner: MonacoOwner | null
  parent_account: MonacoParentAccount | null
  notes: string | null
  domains: string[]
  company: MonacoAccountCompany | null
  overridden_fields: string[]
  scoring: { tier: string | null; heat_score: string | null } | null
  tags: string[]
  created_at: string
  updated_at: string
  last_activity_at: string | null
  last_activity_type: string | null
  last_contacted_at: string | null
  last_contacted_type: string | null
  last_inbound_at: string | null
  last_inbound_type: string | null
  custom_fields: Record<string, unknown>
}

/** Monaco's documented `AccountDetailResponse`: an account plus heat score explanations. */
export interface MonacoAccountDetail extends MonacoAccount {
  heat_score_explanation: MonacoScoreExplanation | null
}

/** Monaco's documented `AccountDomainError`: a domain Monaco did not add to an account. */
export interface MonacoAccountDomainError {
  domain: string
  reason: string
  account_id: string | null
  account_name: string | null
}

/** Monaco's documented `AccountWriteResponse`: an account plus the domains it skipped. */
export interface MonacoAccountWrite extends MonacoAccount {
  skipped_domains: MonacoAccountDomainError[] | null
}

/** Writable fields shared by Monaco's `ContactCreateRequest` and `ContactUpsertRequest`. */
export interface MonacoContactWriteParams extends MonacoBaseParams {
  email?: string
  linkedinUrl?: string
  firstName?: string
  lastName?: string
  title?: string
  phoneNumber?: string
  location?: string
  accountId?: string
  domain?: string
  doNotContact?: boolean
  notes?: string
  tags?: unknown
  isInbound?: boolean
  customFields?: unknown
}

export type MonacoCreateContactParams = MonacoContactWriteParams

export interface MonacoUpsertContactParams extends MonacoContactWriteParams {
  id?: string
  clearFields?: unknown
}

export interface MonacoUpdateContactParams extends MonacoBaseParams {
  contactId: string
  customFields?: unknown
  firstName?: string
  lastName?: string
  email?: string
  title?: string
  phoneNumber?: string
  linkedinUrl?: string
  location?: string
  notes?: string
  doNotContact?: boolean
  tags?: unknown
  country?: string
  jobStartDate?: string
  clearFields?: unknown
}

export interface MonacoContactWriteResponse extends ToolResponse {
  output: {
    contact: MonacoContactWrite
  }
}

export interface MonacoUpdateContactResponse extends ToolResponse {
  output: {
    contact: MonacoContact
  }
}

export interface MonacoListAccountsParams extends MonacoListParams {
  includeCustomFields?: boolean
}

export interface MonacoListAccountsResponse extends ToolResponse {
  output: {
    accounts: MonacoAccount[]
    pagination: MonacoPagination
  }
}

export interface MonacoGetAccountParams extends MonacoBaseParams {
  accountId: string
  includeReasoning?: boolean
}

export interface MonacoGetAccountResponse extends ToolResponse {
  output: {
    account: MonacoAccountDetail
  }
}

/** Writable fields shared by Monaco's `AccountUpdateRequest` and `AccountUpsertRequest`. */
export interface MonacoAccountWriteParams extends MonacoBaseParams {
  linkedinUrl?: string
  description?: string
  employeeCount?: number
  foundedYear?: number
  estimatedAnnualRevenueUsd?: number
  totalFundingUsd?: number
  lastFundingRound?: string
  lastFundingDate?: string
  industries?: unknown
  businessModel?: string
  companyStatus?: string
  location?: string
  name?: string
  status?: string
  notes?: string
  owner?: string
  tags?: unknown
  parentAccount?: string
  domains?: unknown
  companyId?: string
  replaceEditedFields?: boolean
  resetFields?: unknown
  clearFields?: unknown
  customFields?: unknown
}

export interface MonacoUpsertAccountParams extends MonacoAccountWriteParams {
  id?: string
  domainLookup?: string
}

export interface MonacoUpdateAccountParams extends MonacoAccountWriteParams {
  accountId: string
}

export interface MonacoAccountWriteResponse extends ToolResponse {
  output: {
    account: MonacoAccountWrite
  }
}

export interface MonacoDeleteAccountParams extends MonacoBaseParams {
  accountId: string
}

/** Monaco's documented `ContactWriteResponse` fields. */
export const MONACO_CONTACT_WRITE_OUTPUT_PROPERTIES = {
  ...MONACO_CONTACT_OUTPUT_PROPERTIES,
  enrichment_status: {
    type: 'string',
    description:
      'How enriching the contact from its identifiers ended: enriched; not_found, when no person matches them; or failed, when the lookup errored or timed out and the contact was saved with only the fields sent',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

/** Monaco's documented `CompanyInfo` on an account. */
const MONACO_ACCOUNT_COMPANY_OUTPUT = {
  type: 'object',
  description: 'Company information associated with the account',
  nullable: true,
  properties: {
    domain: {
      type: 'string',
      description: "The account's primary domain: the first entry of the account's domains list",
      nullable: true,
    },
    linkedin_url: { type: 'string', description: 'LinkedIn company page URL', nullable: true },
    description: { type: 'string', description: 'Company description', nullable: true },
    employee_count: { type: 'number', description: 'Number of employees', nullable: true },
    founded_year: { type: 'number', description: 'Year the company was founded', nullable: true },
    industries: {
      type: 'array',
      description: 'Industry classifications',
      items: { type: 'string', description: 'Industry' },
    },
    total_funding_usd: {
      type: 'number',
      description: 'Total funding raised in USD',
      nullable: true,
    },
    last_funding_date: {
      type: 'string',
      description: 'Date of the most recent funding round',
      nullable: true,
    },
    company_name: { type: 'string', description: 'Company name', nullable: true },
    estimated_annual_revenue_usd: {
      type: 'number',
      description: 'Estimated annual revenue in USD',
      nullable: true,
    },
    last_funding_round: {
      type: 'string',
      description: 'Type of the most recent funding round',
      nullable: true,
    },
    business_model: { type: 'string', description: 'Business model', nullable: true },
    company_status: {
      type: 'string',
      description: 'Operating status of the company',
      nullable: true,
    },
    location: {
      type: 'string',
      description: 'Headquarters as "city, state, country"',
      nullable: true,
    },
  },
} as const satisfies OutputProperty

/** Monaco's documented `AccountResponse` fields. */
export const MONACO_ACCOUNT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the account' },
  name: { type: 'string', description: 'Name of the account', nullable: true },
  status: { type: 'string', description: 'Current status of the account', nullable: true },
  owner: {
    type: 'object',
    description: 'User who owns the account',
    nullable: true,
    properties: {
      id: { type: 'string', description: 'Unique identifier of the user' },
      first_name: { type: 'string', description: 'First name of the user', nullable: true },
      last_name: { type: 'string', description: 'Last name of the user', nullable: true },
    },
  },
  parent_account: {
    type: 'object',
    description: 'Account this account is a sub-account of',
    nullable: true,
    properties: {
      id: { type: 'string', description: 'Unique identifier of the parent account' },
      name: { type: 'string', description: 'Name of the parent account', nullable: true },
    },
  },
  notes: { type: 'string', description: 'Notes about the account', nullable: true },
  domains: {
    type: 'array',
    description: "The account's own domains, primary first",
    items: { type: 'string', description: 'Domain' },
  },
  company: MONACO_ACCOUNT_COMPANY_OUTPUT,
  overridden_fields: {
    type: 'array',
    description: "Fields set by a user. Company data updates don't overwrite them",
    items: { type: 'string', description: 'Field name' },
  },
  scoring: {
    type: 'object',
    description: 'Account scoring information',
    nullable: true,
    properties: {
      tier: { type: 'string', description: 'Firmographic tier', nullable: true },
      heat_score: { type: 'string', description: 'Heat score tier', nullable: true },
    },
  },
  tags: {
    type: 'array',
    description: 'Tag names associated with the account',
    items: { type: 'string', description: 'Tag name' },
  },
  created_at: { type: 'string', description: 'When the account was created (ISO 8601)' },
  updated_at: { type: 'string', description: 'When the account was last updated (ISO 8601)' },
  last_activity_at: {
    type: 'string',
    description:
      "When the most recent activity (inbound or outbound) across the account's contacts happened",
    nullable: true,
  },
  last_activity_type: {
    type: 'string',
    description: "Type of the account's most recent contact activity",
    nullable: true,
  },
  last_contacted_at: {
    type: 'string',
    description: "When the most recent outbound interaction with the account's contacts happened",
    nullable: true,
  },
  last_contacted_type: {
    type: 'string',
    description: "Type of the most recent outbound interaction with the account's contacts",
    nullable: true,
  },
  last_inbound_at: {
    type: 'string',
    description: "When the most recent inbound interaction from the account's contacts happened",
    nullable: true,
  },
  last_inbound_type: {
    type: 'string',
    description: "Type of the most recent inbound interaction from the account's contacts",
    nullable: true,
  },
  custom_fields: MONACO_CUSTOM_FIELDS_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/** Monaco's documented `AccountDetailResponse` fields. */
export const MONACO_ACCOUNT_DETAIL_OUTPUT_PROPERTIES = {
  ...MONACO_ACCOUNT_OUTPUT_PROPERTIES,
  heat_score_explanation: MONACO_SCORE_EXPLANATION_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/** Monaco's documented `AccountWriteResponse` fields. */
export const MONACO_ACCOUNT_WRITE_OUTPUT_PROPERTIES = {
  ...MONACO_ACCOUNT_OUTPUT_PROPERTIES,
  skipped_domains: {
    type: 'array',
    description: 'Company websites not added because another account uses them',
    nullable: true,
    items: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'The domain that was rejected' },
        reason: {
          type: 'string',
          description:
            'Why it was rejected: conflict (another account uses it), invalid (not a domain), consumer (a consumer email domain such as gmail.com) or own_org (your own organization domain)',
        },
        account_id: {
          type: 'string',
          description: 'For a conflict, the ID of the account that already uses the domain',
          nullable: true,
        },
        account_name: {
          type: 'string',
          description: 'For a conflict, the name of the account that already uses the domain',
          nullable: true,
        },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

/** Monaco's documented `EstimatedValue` on an opportunity. */
export interface MonacoEstimatedValue {
  currency_code: string | null
  amount: number | null
  amount_precise: number | null
}

/**
 * Monaco's documented `OpportunityResponse`. `OpportunityDetailResponse` documents the same
 * fields, so list, get, create, and update share this shape.
 */
export interface MonacoOpportunity {
  id: string
  account_id: string
  name: string | null
  owner: MonacoOwner | null
  stage: string | null
  stage_id: string | null
  pipeline_id: string | null
  pipeline_name: string | null
  estimated_value: MonacoEstimatedValue | null
  estimated_close_date: string | null
  actual_close_date: string | null
  summary: string | null
  risks: string[]
  notes: string | null
  tags: string[]
  contact_ids: string[]
  last_activity_at: string | null
  updated_at: string | null
  created_at: string
  custom_fields: Record<string, unknown>
}

/** Monaco's documented `OpportunityContactLinkResponse`: one contact linked to an opportunity. */
export interface MonacoOpportunityContactLink {
  contact_id: string
  source: string
  created_at: string
  email: string | null
  first_name: string | null
  last_name: string | null
  title: string | null
  account_id: string | null
}

/** Monaco's documented `PipelineStageResponse`. */
interface MonacoPipelineStage {
  id: string
  key: string
  display_name: string
}

/** Monaco's documented `PipelineResponse`. */
export interface MonacoPipeline {
  id: string
  name: string
  is_default: boolean
  stages: MonacoPipelineStage[]
}

/** Monaco's documented `EstimatedValue` output object. */
const MONACO_ESTIMATED_VALUE_OUTPUT = {
  type: 'object',
  description: 'Estimated monetary value of the opportunity',
  nullable: true,
  properties: {
    currency_code: {
      type: 'string',
      description: 'ISO 4217 currency code',
      nullable: true,
    },
    amount: {
      type: 'number',
      description: 'Deprecated: prefer amount_precise. Whole units of the currency.',
      nullable: true,
    },
    amount_precise: {
      type: 'number',
      description: 'Estimated value as a decimal amount of the specified currency',
      nullable: true,
    },
  },
} as const satisfies OutputProperty

/** Monaco's documented `OpportunityResponse` fields, shared by every opportunity tool. */
export const MONACO_OPPORTUNITY_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the opportunity' },
  account_id: { type: 'string', description: 'ID of the associated account' },
  name: { type: 'string', description: 'Name of the opportunity', nullable: true },
  owner: {
    type: 'object',
    description: 'User who owns the opportunity',
    nullable: true,
    properties: {
      id: { type: 'string', description: 'Unique identifier of the user' },
      first_name: { type: 'string', description: 'First name of the user', nullable: true },
      last_name: { type: 'string', description: 'Last name of the user', nullable: true },
    },
  },
  stage: {
    type: 'string',
    description: 'Current pipeline stage key of the opportunity',
    nullable: true,
  },
  stage_id: {
    type: 'string',
    description: "ID of the opportunity's stage within its pipeline",
    nullable: true,
  },
  pipeline_id: {
    type: 'string',
    description: 'ID of the pipeline the opportunity is in',
    nullable: true,
  },
  pipeline_name: {
    type: 'string',
    description: 'Name of the pipeline the opportunity is in',
    nullable: true,
  },
  estimated_value: MONACO_ESTIMATED_VALUE_OUTPUT,
  estimated_close_date: {
    type: 'string',
    description: 'Expected close date for the opportunity',
    nullable: true,
  },
  actual_close_date: {
    type: 'string',
    description: 'Actual date the opportunity was closed',
    nullable: true,
  },
  summary: {
    type: 'string',
    description: 'AI-generated summary of the opportunity',
    nullable: true,
  },
  risks: {
    type: 'array',
    description: 'Identified risks for the opportunity',
    items: { type: 'string', description: 'Risk' },
  },
  notes: { type: 'string', description: 'Notes about the opportunity', nullable: true },
  tags: {
    type: 'array',
    description: 'Tag names associated with the opportunity',
    items: { type: 'string', description: 'Tag name' },
  },
  contact_ids: {
    type: 'array',
    description: 'IDs of contacts linked to the opportunity',
    items: { type: 'string', description: 'Contact ID' },
  },
  last_activity_at: {
    type: 'string',
    description: 'When the last activity on the opportunity happened (ISO 8601)',
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'When the opportunity was last updated (ISO 8601)',
    nullable: true,
  },
  created_at: { type: 'string', description: 'When the opportunity was created (ISO 8601)' },
  custom_fields: MONACO_CUSTOM_FIELDS_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/** Monaco's documented `OpportunityContactLinkResponse` fields. */
export const MONACO_OPPORTUNITY_CONTACT_LINK_OUTPUT_PROPERTIES = {
  contact_id: { type: 'string', description: 'ID of the linked contact' },
  source: {
    type: 'string',
    description:
      'How the link was created: `manual` (rep or API), `ai` (auto-detected), or `system`',
  },
  created_at: { type: 'string', description: 'When the link was created (ISO 8601)' },
  email: { type: 'string', description: 'Email of the linked contact', nullable: true },
  first_name: {
    type: 'string',
    description: 'First name of the linked contact',
    nullable: true,
  },
  last_name: { type: 'string', description: 'Last name of the linked contact', nullable: true },
  title: { type: 'string', description: 'Job title of the linked contact', nullable: true },
  account_id: {
    type: 'string',
    description: 'Account ID of the linked contact',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

/** Monaco's documented `PipelineResponse` fields. */
export const MONACO_PIPELINE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier of the pipeline' },
  name: { type: 'string', description: 'Name of the pipeline' },
  is_default: {
    type: 'boolean',
    description: 'Whether opportunities created without a pipeline ID go to this pipeline',
  },
  stages: {
    type: 'array',
    description: "The pipeline's stages in display order",
    items: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: "Unique identifier of the stage, as written to an opportunity's `stage_id`",
        },
        key: {
          type: 'string',
          description: "Stage key, as written to an opportunity's `stage`",
        },
        display_name: { type: 'string', description: 'Display name of the stage' },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

export interface MonacoListOpportunitiesParams extends MonacoListParams {
  includeCustomFields?: boolean
  pipelineId?: string
}

export interface MonacoListOpportunitiesResponse extends ToolResponse {
  output: {
    opportunities: MonacoOpportunity[]
    pagination: MonacoPagination
  }
}

export interface MonacoGetOpportunityParams extends MonacoBaseParams {
  opportunityId: string
  includeReasoning?: boolean
}

/** Fields shared by Monaco's opportunity create and update requests. */
interface MonacoOpportunityWriteParams extends MonacoBaseParams {
  ownerUserId?: string
  stage?: string
  stageId?: string
  pipelineId?: string
  currencyCode?: string
  amount?: number
  estimatedCloseDate?: string
  notes?: string
  tags?: unknown
  customFields?: unknown
}

export interface MonacoCreateOpportunityParams extends MonacoOpportunityWriteParams {
  name: string
  accountId: string
  idempotencyKey?: string
}

export interface MonacoUpdateOpportunityParams extends MonacoOpportunityWriteParams {
  opportunityId: string
  name?: string
  actualCloseDate?: string
}

export interface MonacoOpportunityResponse extends ToolResponse {
  output: {
    opportunity: MonacoOpportunity
  }
}

export interface MonacoDeleteOpportunityParams extends MonacoBaseParams {
  opportunityId: string
}

export interface MonacoListOpportunityContactsParams extends MonacoPageParams {
  opportunityId: string
}

export interface MonacoListOpportunityContactsResponse extends ToolResponse {
  output: {
    contacts: MonacoOpportunityContactLink[]
    pagination: MonacoPagination
  }
}

export interface MonacoOpportunityContactsParams extends MonacoBaseParams {
  opportunityId: string
  contactIds: unknown
}

export interface MonacoOpportunityContactsResponse extends ToolResponse {
  output: {
    opportunityId: string
    contactIds: string[]
  }
}

export interface MonacoListPipelinesResponse extends ToolResponse {
  output: {
    pipelines: MonacoPipeline[]
  }
}

/** Monaco's documented `EmailRecipient`. */
export interface MonacoEmailRecipient {
  name: string
  email: string
}

/** Monaco's documented `MessageDraft`, stored on tasks with `task_type=EMAIL`. */
export interface MonacoMessageDraft {
  recipients: MonacoEmailRecipient[]
  cc: MonacoEmailRecipient[] | null
  subject: string
  body: string
  sent_at: string | null
}

/** Monaco's documented `TaskResponse` resource. */
export interface MonacoTask {
  id: string
  account_id: string | null
  opportunity_id: string | null
  title: string | null
  description: string | null
  task_type: string | null
  assignee: MonacoOwner | null
  status: string | null
  due_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  message_draft: MonacoMessageDraft | null
}

/** Monaco's documented `AccountCandidate`. */
export interface MonacoAccountCandidate {
  account_id: string
  name: string | null
}

/** Monaco's documented `MeetingOpportunityCandidate`. */
interface MonacoMeetingOpportunityCandidate {
  opportunity_id: string
  name: string | null
}

/** Monaco's documented `MeetingOrganizerInfo`. */
interface MonacoMeetingOrganizer {
  email: string | null
  display_name: string | null
}

/** Monaco's documented `MeetingAttendeeInfo`. */
interface MonacoMeetingAttendee {
  email: string | null
  display_name: string | null
  response_status: string | null
}

/** Monaco's documented `MeetingResponse` resource. */
export interface MonacoMeeting {
  id: string
  account_id: string | null
  account_candidates: MonacoAccountCandidate[]
  opportunity_id: string | null
  opportunity_candidates: MonacoMeetingOpportunityCandidate[]
  title: string | null
  description: string | null
  start_time: string | null
  end_time: string | null
  occurred_at: string | null
  meeting_platform: string | null
  meeting_url: string | null
  organizer: MonacoMeetingOrganizer | null
  attendees: MonacoMeetingAttendee[]
  next_actions: string[] | null
  created_at: string | null
  updated_at: string | null
}

/** Monaco's documented `TranscriptWord`. */
interface MonacoTranscriptWord {
  text: string
  start_timestamp: number
  end_timestamp: number
}

/** Monaco's documented `TranscriptSegment`. */
export interface MonacoTranscriptSegment {
  speaker: string
  language: string
  words: MonacoTranscriptWord[]
}

/** Monaco's documented `MeetingDetailResponse`: a meeting plus AI notes, summary, video, and transcript. */
export interface MonacoMeetingDetail extends MonacoMeeting {
  ai_premeeting_notes: string | null
  meeting_summary: string | null
  video_url: string | null
  transcript: MonacoTranscriptSegment[] | null
  transcript_source: string | null
}

/** Monaco's documented `MessageRow`: the latest message of one conversation. */
export interface MonacoMessageRow {
  conversation_id: string
  channel: string
  direction: string
  subject: string | null
  preview: string
  timestamp: string
  contact_id: string | null
  account_id: string | null
}

/** Monaco's documented `ConversationParticipantInfo`. */
export interface MonacoConversationParticipant {
  name: string
  email: string | null
  linkedin_url: string | null
  contact_id: string | null
  company_name: string | null
  is_current_user: boolean
}

/** Monaco's documented `ConversationMessageItem`. */
export interface MonacoConversationMessage {
  id: string
  channel: string
  sender: MonacoConversationParticipant
  to: MonacoConversationParticipant[] | null
  cc: MonacoConversationParticipant[] | null
  bcc: MonacoConversationParticipant[] | null
  subject: string | null
  body: string
  body_truncated: boolean
  timestamp: string
}

/** Monaco's documented `ConversationDetailResponse`. */
export interface MonacoConversationDetail {
  id: string
  channel: string
  subject: string | null
  participants: MonacoConversationParticipant[]
  account_id: string | null
  account_candidates: MonacoAccountCandidate[]
  messages: MonacoConversationMessage[]
  message_pagination: MonacoPagination
}

/** Monaco's documented `TagResponse`. */
export interface MonacoTag {
  id: string
  name: string
  color: string | null
}

/** Monaco's documented `UserResponse`. */
export interface MonacoUser {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  role: string
}

/** Monaco's documented `MeResponse`: the user and organization behind the API key. */
export interface MonacoCurrentUser {
  org_id: string
  user_id: string
  user_email: string | null
  user_first_name: string | null
  user_last_name: string | null
  org_name: string | null
}

/** Monaco's documented `EnumValueOption`. */
interface MonacoEnumValueOption {
  key: string
  display_value: string
}

/** Monaco's documented `FieldSchemaResponse`. */
export interface MonacoFieldSchema {
  name: string
  key: string
  type: string
  parent: string | null
  filterable: boolean
  sortable: boolean
  updatable: boolean
  allowed_operators: string[]
  custom_field_settings: {
    id: string
    is_ai_auto_filled: boolean
    question: string | null
  } | null
  enum_field_settings: { allowed_values: MonacoEnumValueOption[] } | null
}

export type MonacoListTasksParams = MonacoListParams

export interface MonacoListTasksResponse extends ToolResponse {
  output: {
    tasks: MonacoTask[]
    pagination: MonacoPagination
  }
}

export interface MonacoGetTaskParams extends MonacoBaseParams {
  taskId: string
}

export interface MonacoTaskResponse extends ToolResponse {
  output: {
    task: MonacoTask
  }
}

export interface MonacoCreateTaskParams extends MonacoBaseParams {
  title: string
  description?: string
  accountId?: string
  opportunityId?: string
  taskType?: string
  assigneeId?: string
  dueAt?: string
  messageDraft?: unknown
}

export interface MonacoUpdateTaskParams extends MonacoBaseParams {
  taskId: string
  title?: string
  description?: string
  status?: string
  accountId?: string
  assigneeId?: string
  dueAt?: string
  messageDraft?: unknown
}

export type MonacoListMeetingsParams = MonacoListParams

export interface MonacoListMeetingsResponse extends ToolResponse {
  output: {
    meetings: MonacoMeeting[]
    pagination: MonacoPagination
  }
}

export interface MonacoGetMeetingParams extends MonacoBaseParams {
  meetingId: string
}

export interface MonacoGetMeetingResponse extends ToolResponse {
  output: {
    meeting: MonacoMeetingDetail
  }
}

export interface MonacoListMessagesParams extends MonacoBaseParams {
  contactId?: string
  accountId?: string
  cursor?: string
  channels?: unknown
  pageSize?: number
}

export interface MonacoListMessagesResponse extends ToolResponse {
  output: {
    messages: MonacoMessageRow[]
    nextCursor: string | null
    hasMore: boolean
  }
}

export interface MonacoGetConversationParams extends MonacoPageParams {
  conversationId: string
  channel: string
}

export interface MonacoGetConversationResponse extends ToolResponse {
  output: {
    conversation: MonacoConversationDetail
  }
}

export interface MonacoListTagsParams extends MonacoBaseParams {
  object: string
}

export interface MonacoListTagsResponse extends ToolResponse {
  output: {
    tags: MonacoTag[]
  }
}

export interface MonacoCreateTagParams extends MonacoBaseParams {
  object: string
  name: string
  color?: string
}

export interface MonacoCreateTagResponse extends ToolResponse {
  output: {
    tag: MonacoTag
  }
}

export interface MonacoListUsersParams extends MonacoBaseParams {
  query?: string
}

export interface MonacoListUsersResponse extends ToolResponse {
  output: {
    users: MonacoUser[]
  }
}

export type MonacoGetCurrentUserParams = MonacoBaseParams

export interface MonacoGetCurrentUserResponse extends ToolResponse {
  output: {
    currentUser: MonacoCurrentUser
  }
}

export interface MonacoGetFieldSchemasParams extends MonacoBaseParams {
  entity: string
}

export interface MonacoGetFieldSchemasResponse extends ToolResponse {
  output: {
    fields: MonacoFieldSchema[]
  }
}

const MONACO_EMAIL_RECIPIENT_OUTPUT = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Display name of the recipient' },
    email: { type: 'string', description: 'Email address of the recipient' },
  },
} as const satisfies OutputProperty

/** Monaco's documented `MessageDraft` object on email tasks. */
const MONACO_MESSAGE_DRAFT_OUTPUT = {
  type: 'object',
  description:
    'Draft email contents. Populated on single-task, create, and update responses for EMAIL tasks; always null in list responses.',
  nullable: true,
  properties: {
    recipients: {
      type: 'array',
      description: 'Primary recipients (To) of the email',
      items: MONACO_EMAIL_RECIPIENT_OUTPUT,
    },
    cc: {
      type: 'array',
      description: 'Carbon-copy recipients of the email',
      nullable: true,
      items: MONACO_EMAIL_RECIPIENT_OUTPUT,
    },
    subject: { type: 'string', description: 'Subject line of the email' },
    body: { type: 'string', description: 'Body of the email (plain text or HTML)' },
    sent_at: {
      type: 'string',
      description: 'When the email was sent (ISO 8601)',
      nullable: true,
    },
  },
} as const satisfies OutputProperty

export const MONACO_TASK_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the task' },
  account_id: { type: 'string', description: 'ID of the associated account', nullable: true },
  opportunity_id: {
    type: 'string',
    description: 'ID of the associated opportunity',
    nullable: true,
  },
  title: { type: 'string', description: 'Title of the task', nullable: true },
  description: {
    type: 'string',
    description: 'Detailed description of the task',
    nullable: true,
  },
  task_type: {
    type: 'string',
    description: 'Type of task (e.g. GENERAL_ACTION_ITEM, EMAIL)',
    nullable: true,
  },
  assignee: {
    type: 'object',
    description: 'User assigned to the task',
    nullable: true,
    properties: {
      id: { type: 'string', description: 'Unique identifier of the user' },
      first_name: { type: 'string', description: 'First name of the user', nullable: true },
      last_name: { type: 'string', description: 'Last name of the user', nullable: true },
    },
  },
  status: {
    type: 'string',
    description: 'Current status of the task (TODO, DONE, or CANCELLED)',
    nullable: true,
  },
  due_at: { type: 'string', description: 'When the task is due (ISO 8601)', nullable: true },
  completed_at: {
    type: 'string',
    description: 'When the task was completed (ISO 8601)',
    nullable: true,
  },
  created_at: { type: 'string', description: 'When the task was created (ISO 8601)' },
  updated_at: { type: 'string', description: 'When the task was last updated (ISO 8601)' },
  message_draft: MONACO_MESSAGE_DRAFT_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/** Monaco's documented `AccountCandidate` list, shared by meetings and conversations. */
const MONACO_ACCOUNT_CANDIDATES_OUTPUT = {
  type: 'array',
  description: 'Accounts the record associates to',
  items: {
    type: 'object',
    properties: {
      account_id: { type: 'string', description: 'ID of the account' },
      name: { type: 'string', description: 'Display name of the account', nullable: true },
    },
  },
} as const satisfies OutputProperty

export const MONACO_MEETING_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the meeting' },
  account_id: {
    type: 'string',
    description: 'Deprecated: use account_candidates. ID of the associated account',
    nullable: true,
  },
  account_candidates: {
    ...MONACO_ACCOUNT_CANDIDATES_OUTPUT,
    description: 'Accounts the meeting associates to',
  },
  opportunity_id: {
    type: 'string',
    description: 'Deprecated: use opportunity_candidates. ID of the associated open opportunity',
    nullable: true,
  },
  opportunity_candidates: {
    type: 'array',
    description: 'Open opportunities the meeting associates to',
    items: {
      type: 'object',
      properties: {
        opportunity_id: { type: 'string', description: 'ID of the open opportunity' },
        name: { type: 'string', description: 'Name of the opportunity', nullable: true },
      },
    },
  },
  title: { type: 'string', description: 'Meeting title from the calendar event', nullable: true },
  description: { type: 'string', description: 'Meeting description', nullable: true },
  start_time: { type: 'string', description: 'Meeting start time (ISO 8601)', nullable: true },
  end_time: { type: 'string', description: 'Meeting end time (ISO 8601)', nullable: true },
  occurred_at: {
    type: 'string',
    description:
      'When the meeting actually occurred: recording start time (ISO 8601). Null for meetings that were never recorded, including future and declined events.',
    nullable: true,
  },
  meeting_platform: {
    type: 'string',
    description: 'Video conferencing platform',
    nullable: true,
  },
  meeting_url: { type: 'string', description: 'URL to join the meeting', nullable: true },
  organizer: {
    type: 'object',
    description: 'Meeting organizer',
    nullable: true,
    properties: {
      email: { type: 'string', description: 'Email address of the organizer', nullable: true },
      display_name: {
        type: 'string',
        description: 'Display name of the organizer',
        nullable: true,
      },
    },
  },
  attendees: {
    type: 'array',
    description: 'Meeting attendees',
    items: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Email address of the attendee', nullable: true },
        display_name: {
          type: 'string',
          description: 'Display name of the attendee',
          nullable: true,
        },
        response_status: { type: 'string', description: 'RSVP response status', nullable: true },
      },
    },
  },
  next_actions: {
    type: 'array',
    description: 'AI-generated action items from the meeting',
    nullable: true,
    items: { type: 'string', description: 'Action item' },
  },
  created_at: {
    type: 'string',
    description: 'When the meeting was created in Monaco (ISO 8601)',
    nullable: true,
  },
  updated_at: {
    type: 'string',
    description: 'When the meeting was last updated in Monaco (ISO 8601)',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const MONACO_MEETING_DETAIL_OUTPUT_PROPERTIES = {
  ...MONACO_MEETING_OUTPUT_PROPERTIES,
  ai_premeeting_notes: {
    type: 'string',
    description:
      'AI-generated preparation notes for an upcoming meeting; null when not generated yet',
    nullable: true,
  },
  meeting_summary: { type: 'string', description: 'AI-generated meeting summary', nullable: true },
  video_url: {
    type: 'string',
    description: 'Presigned URL for the meeting recording; null when there is no recording yet',
    nullable: true,
  },
  transcript: {
    type: 'array',
    description:
      'Full transcript as speaker-attributed segments with word-level timestamps. Can be very large for long meetings.',
    nullable: true,
    items: {
      type: 'object',
      properties: {
        speaker: { type: 'string', description: 'Name of the speaker' },
        language: { type: 'string', description: 'Language code of the segment' },
        words: {
          type: 'array',
          description: 'Words in this segment',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'The transcribed word' },
              start_timestamp: { type: 'number', description: 'Start time in seconds' },
              end_timestamp: { type: 'number', description: 'End time in seconds' },
            },
          },
        },
      },
    },
  },
  transcript_source: {
    type: 'string',
    description:
      "Where the transcript came from: recall (Monaco's recorder), granola, circleback, or custom (imported). Null when the meeting has no transcript.",
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const MONACO_MESSAGE_ROW_OUTPUT_PROPERTIES = {
  conversation_id: {
    type: 'string',
    description: 'Thread or chat identifier; pass to Get Conversation with the channel',
  },
  channel: { type: 'string', description: 'Channel the message was sent over (email or linkedin)' },
  direction: {
    type: 'string',
    description: 'Message direction: inbound, outbound, internal, or unknown',
  },
  subject: { type: 'string', description: 'Subject line of the conversation', nullable: true },
  preview: { type: 'string', description: 'Short preview of the most recent message' },
  timestamp: {
    type: 'string',
    description: 'When the most recent message was sent (ISO 8601)',
  },
  contact_id: { type: 'string', description: 'ID of the associated contact', nullable: true },
  account_id: { type: 'string', description: 'ID of the associated account', nullable: true },
} as const satisfies Record<string, OutputProperty>

const MONACO_CONVERSATION_PARTICIPANT_PROPERTIES = {
  name: { type: 'string', description: 'Display name of the participant' },
  email: { type: 'string', description: 'Email address of the participant', nullable: true },
  linkedin_url: {
    type: 'string',
    description: 'LinkedIn profile URL of the participant',
    nullable: true,
  },
  contact_id: { type: 'string', description: 'ID of the associated contact', nullable: true },
  company_name: {
    type: 'string',
    description: 'Company name of the participant',
    nullable: true,
  },
  is_current_user: {
    type: 'boolean',
    description: 'Whether this participant is the requesting user',
  },
} as const satisfies Record<string, OutputProperty>

const MONACO_CONVERSATION_PARTICIPANT_LIST = {
  type: 'array',
  items: { type: 'object', properties: MONACO_CONVERSATION_PARTICIPANT_PROPERTIES },
} as const

export const MONACO_CONVERSATION_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the conversation' },
  channel: { type: 'string', description: 'Channel of the conversation (email or linkedin)' },
  subject: { type: 'string', description: 'Subject line of the conversation', nullable: true },
  participants: {
    ...MONACO_CONVERSATION_PARTICIPANT_LIST,
    description: 'All participants in the conversation',
  },
  account_id: {
    type: 'string',
    description: 'Deprecated: use account_candidates. ID of the associated account',
    nullable: true,
  },
  account_candidates: {
    ...MONACO_ACCOUNT_CANDIDATES_OUTPUT,
    description: 'Accounts the conversation associates to',
  },
  messages: {
    type: 'array',
    description: 'Messages on this page, in thread order',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the message' },
        channel: {
          type: 'string',
          description: 'Channel the message was sent over (email or linkedin)',
        },
        sender: {
          type: 'object',
          description: 'Sender of the message',
          properties: MONACO_CONVERSATION_PARTICIPANT_PROPERTIES,
        },
        to: {
          ...MONACO_CONVERSATION_PARTICIPANT_LIST,
          description: 'TO recipients of the message',
          nullable: true,
        },
        cc: {
          ...MONACO_CONVERSATION_PARTICIPANT_LIST,
          description: 'CC recipients of the message',
          nullable: true,
        },
        bcc: {
          ...MONACO_CONVERSATION_PARTICIPANT_LIST,
          description: 'BCC recipients of the message',
          nullable: true,
        },
        subject: { type: 'string', description: 'Subject line of the message', nullable: true },
        body: {
          type: 'string',
          description: 'Plain-text body of the message (truncated past 20,000 characters)',
        },
        body_truncated: {
          type: 'boolean',
          description: 'Whether the body was truncated due to length',
        },
        timestamp: { type: 'string', description: 'When the message was sent (ISO 8601)' },
      },
    },
  },
  message_pagination: {
    ...MONACO_PAGINATION_OUTPUT,
    description: "Pagination over the conversation's messages",
  },
} as const satisfies Record<string, OutputProperty>

export const MONACO_TAG_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the tag' },
  name: { type: 'string', description: 'Display name of the tag' },
  color: { type: 'string', description: 'Display color of the tag', nullable: true },
} as const satisfies Record<string, OutputProperty>

export const MONACO_USER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier of the user' },
  first_name: { type: 'string', description: 'First name of the user', nullable: true },
  last_name: { type: 'string', description: 'Last name of the user', nullable: true },
  email: { type: 'string', description: 'Email address of the user', nullable: true },
  role: {
    type: 'string',
    description: 'Workspace role: ADMIN (manages organization-wide settings and users) or MEMBER',
  },
} as const satisfies Record<string, OutputProperty>

export const MONACO_CURRENT_USER_OUTPUT_PROPERTIES = {
  org_id: { type: 'string', description: 'Authenticated organization ID' },
  user_id: { type: 'string', description: 'Authenticated user ID' },
  user_email: { type: 'string', description: 'Authenticated user email', nullable: true },
  user_first_name: {
    type: 'string',
    description: 'Authenticated user first name',
    nullable: true,
  },
  user_last_name: { type: 'string', description: 'Authenticated user last name', nullable: true },
  org_name: { type: 'string', description: 'Authenticated organization name', nullable: true },
} as const satisfies Record<string, OutputProperty>

export const MONACO_FIELD_SCHEMA_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Display name of the field' },
  key: { type: 'string', description: 'Key used for filtering and sorting' },
  type: {
    type: 'string',
    description:
      'Data type: string, number, time, boolean, enum, array, date, datetime, text, uuid, or object. A multi-select custom field is array.',
  },
  parent: {
    type: 'string',
    description: 'Key of the parent object field this field belongs to; null for top-level fields',
    nullable: true,
  },
  filterable: { type: 'boolean', description: 'Whether the field can be used in filter rules' },
  sortable: { type: 'boolean', description: 'Whether the field can be used for sorting' },
  updatable: {
    type: 'boolean',
    description:
      'Whether the field can be written via the update endpoint; false marks a read-only field',
  },
  allowed_operators: {
    type: 'array',
    description: 'Operators that can be used to filter this field',
    items: { type: 'string', description: 'Filter operator' },
  },
  custom_field_settings: {
    type: 'object',
    description: 'Settings present only for custom fields',
    nullable: true,
    properties: {
      id: { type: 'string', description: 'Unique identifier of the custom field schema' },
      is_ai_auto_filled: {
        type: 'boolean',
        description: 'Whether this custom field is automatically populated by AI',
      },
      question: {
        type: 'string',
        description: 'For an AI auto-filled field, the question AI answers to fill it',
        nullable: true,
      },
    },
  },
  enum_field_settings: {
    type: 'object',
    description:
      "Settings present only for enum/select fields. For date and datetime fields these are semantic periods (e.g. 'previous_week') used with the is operator.",
    nullable: true,
    properties: {
      allowed_values: {
        type: 'array',
        description: 'Valid values that can be used in filters',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'The value to use in filter rules' },
            display_value: { type: 'string', description: 'Human-readable label for the value' },
          },
        },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

/** Most recently triggered rules-of-engagement violation on an excluded Monaco sequence. */
interface MonacoSequenceExclusionInfo {
  rule_name: string
  description: string
  overridability: string
}

/** Monaco's documented `SequenceResponse` resource. */
export interface MonacoSequence {
  id: string
  contact_id: string
  name: string | null
  description: string | null
  status: string | null
  template_id: string | null
  created_at: string
  updated_at: string | null
  last_interaction: string | null
  enqueued_at: string | null
  started_at: string | null
  responded_at: string | null
  meeting_booked_at: string | null
  sender_id: string | null
  sender_name: string | null
  exclusion_info: MonacoSequenceExclusionInfo | null
}

/** Monaco's documented `SequenceTaskResponse`: one task within a sequence. */
export interface MonacoSequenceTask {
  id: string
  sequence_id: string
  order: number
  name: string | null
  type: string
  status: string
  scheduled_at: string
  completed_at: string | null
  task_body: string | null
  subject: string | null
  outcome: string | null
  hold_reason: string | null
  hold_until: string | null
}

/** Monaco's documented `SequenceDetailResponse`: a sequence with its ordered tasks. */
export interface MonacoSequenceDetail extends MonacoSequence {
  tasks: MonacoSequenceTask[]
}

/** Monaco's documented `AudienceResponse` resource. */
export interface MonacoAudience {
  id: string
  name: string
  type: string
  status: string
  contact_count: number
  created_at: string
  updated_at: string
}

/** Monaco's documented `AudienceContactFailureGroup`: contacts that failed for one reason. */
export interface MonacoAudienceContactFailure {
  reason: string
  contact_ids: string[]
}

/** Monaco's documented `CampaignAudienceRef`: an audience attached to a campaign. */
interface MonacoCampaignAudienceRef {
  id: string
  name: string
}

/** Monaco's documented `CampaignResponse` summary. */
export interface MonacoCampaign {
  id: string
  name: string
  status: string
  prioritized: boolean
  end_date: string | null
  template_id: string
  template_name: string | null
  audiences: MonacoCampaignAudienceRef[]
  enrollment_status: string
  created_at: string
  updated_at: string
}

/** One sender's share in a Monaco `percentage` distribution. */
interface MonacoSenderPercentage {
  sender_id: string
  percentage: number
}

/**
 * Monaco's campaign `distribution`, a `percentage` or `account_owner` union. `percentages`
 * is only set in `percentage` mode and `fallback_sender_id` only in `account_owner` mode.
 */
export interface MonacoCampaignDistribution {
  mode: string
  sender_ids: string[]
  percentages: MonacoSenderPercentage[] | null
  fallback_sender_id: string | null
}

/** Monaco's `PublicToggleRule`. */
export interface MonacoToggleRule {
  enabled: boolean
}

/** Monaco's `PublicCooldownRule`. */
export interface MonacoCooldownRule {
  enabled: boolean
  days: number | null
}

/** Monaco's `PublicMaxContactsInSequenceRule`. */
interface MonacoMaxContactsInSequenceRule {
  enabled: boolean
  max_contacts: number | null
}

/** Monaco's `PublicStopAndDismissRule`. */
export interface MonacoStopAndDismissRule {
  enabled: boolean
  statuses: string[] | null
}

/** Monaco's `PublicRulesOfEngagement`: per-rule overrides on the org's default rules. */
export interface MonacoRulesOfEngagement {
  do_not_contact: MonacoToggleRule | null
  allow_sequence_stop_on_meeting_booked: MonacoToggleRule | null
  contact_cooldown: MonacoCooldownRule | null
  account_cooldown: MonacoCooldownRule | null
  max_contacts_in_sequence: MonacoMaxContactsInSequenceRule | null
  allow_non_account_owner_campaigns: MonacoToggleRule | null
  allow_stop_and_dismiss_on_account_status: MonacoStopAndDismissRule | null
  exclude_sequences_on_account_status: MonacoStopAndDismissRule | null
}

/** Monaco's `SenderAutopilotRate`. */
interface MonacoSenderAutopilotRate {
  sender_id: string
  daily_rate_target: number
}

/** Monaco's `PublicContactReadinessSettings`. */
interface MonacoContactReadinessSettings {
  email: { check_on_enroll: boolean; on_failure: string | null } | null
}

/** Monaco's documented `CampaignDetailResponse`: the full campaign resource. */
export interface MonacoCampaignDetail extends MonacoCampaign {
  distribution: MonacoCampaignDistribution | null
  rules_of_engagement: MonacoRulesOfEngagement | null
  autopilot_mode: string
  autopilot_settings: { sender_rates: MonacoSenderAutopilotRate[] }
  contact_readiness_settings: MonacoContactReadinessSettings
}

/** Monaco's documented `EnrollFailureReason`. */
export interface MonacoEnrollFailureReason {
  code: string
  description: string
  count: number
}

const MONACO_SEQUENCE_EXCLUSION_INFO_OUTPUT = {
  type: 'object',
  description:
    'Why this sequence was excluded: the most recently triggered rules-of-engagement violation. Null unless the status is `Excluded` and a violation was recorded.',
  nullable: true,
  properties: {
    rule_name: { type: 'string', description: 'Rules-of-engagement rule that was violated' },
    description: {
      type: 'string',
      description: 'Human-readable reason the sequence was excluded',
    },
    overridability: {
      type: 'string',
      description: 'Whether the rule can be overridden: `HARD` or `SOFT`',
    },
  },
} as const satisfies OutputProperty

export const MONACO_SEQUENCE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the sequence' },
  contact_id: {
    type: 'string',
    description: 'ID of the contact this sequence is associated with',
  },
  name: { type: 'string', description: 'Name of the sequence', nullable: true },
  description: { type: 'string', description: 'Description of the sequence', nullable: true },
  status: { type: 'string', description: 'Current status of the sequence', nullable: true },
  template_id: {
    type: 'string',
    description: 'ID of the sequence template this sequence was created from',
    nullable: true,
  },
  created_at: { type: 'string', description: 'When the sequence was created (ISO 8601)' },
  updated_at: {
    type: 'string',
    description: 'When the sequence was last updated (ISO 8601)',
    nullable: true,
  },
  last_interaction: {
    type: 'string',
    description:
      'Human-readable summary of the most recent interaction on this sequence (e.g. "Email today", "No interactions yet")',
    nullable: true,
  },
  enqueued_at: {
    type: 'string',
    description: 'When the sequence was enqueued (ISO 8601)',
    nullable: true,
  },
  started_at: {
    type: 'string',
    description: 'When the sequence was started (ISO 8601)',
    nullable: true,
  },
  responded_at: {
    type: 'string',
    description: 'When the contact responded on this sequence (ISO 8601)',
    nullable: true,
  },
  meeting_booked_at: {
    type: 'string',
    description: 'When a meeting was booked off this sequence (ISO 8601)',
    nullable: true,
  },
  sender_id: {
    type: 'string',
    description: 'ID of the user sending this sequence',
    nullable: true,
  },
  sender_name: {
    type: 'string',
    description: 'Full name of the user sending this sequence',
    nullable: true,
  },
  exclusion_info: MONACO_SEQUENCE_EXCLUSION_INFO_OUTPUT,
} as const satisfies Record<string, OutputProperty>

const MONACO_SEQUENCE_TASK_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the task' },
  sequence_id: { type: 'string', description: 'ID of the sequence this task belongs to' },
  order: {
    type: 'number',
    description: 'Position of the task within the sequence (1-indexed)',
  },
  name: { type: 'string', description: 'Display name of the task', nullable: true },
  type: {
    type: 'string',
    description:
      'Type of task: generic, auto_email, manual_email, auto_linkedin_connection, manual_linkedin_connection, auto_linkedin_message, manual_linkedin_message, auto_linkedin_inmail, manual_linkedin_inmail, auto_phone, manual_phone, internal_email, gifting_via_email, gifting_via_address, or complete_sequence',
  },
  status: {
    type: 'string',
    description:
      'Current status of the task: unknown, scheduled, pending, in_progress, paused, completed, failed, cancelled, or skipped',
  },
  scheduled_at: { type: 'string', description: 'When the task is scheduled for (ISO 8601)' },
  completed_at: {
    type: 'string',
    description: 'When the task was completed (ISO 8601)',
    nullable: true,
  },
  task_body: { type: 'string', description: 'Task message body', nullable: true },
  subject: {
    type: 'string',
    description: 'Subject line, for subject-bearing channels (email, InMail, gifting email)',
    nullable: true,
  },
  outcome: {
    type: 'string',
    description:
      'Observed outcome of the task, such as positive_reply, negative_reply, email_bounced, accepted, meeting_scheduled, or do_not_contact',
    nullable: true,
  },
  hold_reason: {
    type: 'string',
    description:
      "Why this open task can't be sent right now: not_connected, inmail_not_in_plan, rate_limited, or out_of_inmail_credits. Null when nothing is holding it, including normal waits like a step delay or a pending connection request",
    nullable: true,
  },
  hold_until: {
    type: 'string',
    description: 'When the engine will try the task again, if the hold clears on its own',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const MONACO_SEQUENCE_DETAIL_OUTPUT_PROPERTIES = {
  ...MONACO_SEQUENCE_OUTPUT_PROPERTIES,
  tasks: {
    type: 'array',
    description: 'Ordered list of tasks in the sequence',
    items: { type: 'object', properties: MONACO_SEQUENCE_TASK_OUTPUT_PROPERTIES },
  },
} as const satisfies Record<string, OutputProperty>

export const MONACO_AUDIENCE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the audience' },
  name: { type: 'string', description: 'Name of the audience' },
  type: { type: 'string', description: 'Audience type' },
  status: { type: 'string', description: 'Audience status' },
  contact_count: {
    type: 'number',
    description: 'Number of contacts currently in the audience',
  },
  created_at: { type: 'string', description: 'When the audience was created (ISO 8601)' },
  updated_at: { type: 'string', description: 'When the audience was last updated (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>

/** Monaco's `AudienceContactFailureGroup` list returned by audience contact mutations. */
export const MONACO_AUDIENCE_CONTACT_FAILURES_OUTPUT = {
  type: 'array',
  description: 'Contacts that exist but could not be added or removed, grouped by reason',
  items: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Reason code for the failure' },
      contact_ids: {
        type: 'array',
        description: 'Contact IDs that failed for this reason',
        items: { type: 'string', description: 'Contact ID' },
      },
    },
  },
} as const satisfies OutputProperty

const MONACO_TOGGLE_RULE_PROPERTIES = {
  enabled: { type: 'boolean', description: 'Whether this rule is enforced for the campaign' },
} as const satisfies Record<string, OutputProperty>

const MONACO_COOLDOWN_RULE_PROPERTIES = {
  enabled: { type: 'boolean', description: 'Whether the cooldown is enforced' },
  days: {
    type: 'number',
    description: 'Length of the cooldown window in days (Monaco defaults to 90)',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

const MONACO_STOP_AND_DISMISS_RULE_PROPERTIES = {
  enabled: {
    type: 'boolean',
    description: 'Whether the rule is enforced for the trigger statuses',
  },
  statuses: {
    type: 'array',
    description:
      "Account statuses that trigger the rule (NEW, PROSPECTING, OPPORTUNITY, CUSTOMER, DISQUALIFIED, NURTURE, INBOUND, CHURNED); null inherits the org's default set",
    nullable: true,
    items: { type: 'string', description: 'Account status' },
  },
} as const satisfies Record<string, OutputProperty>

export const MONACO_CAMPAIGN_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Unique identifier for the campaign' },
  name: { type: 'string', description: 'Name of the campaign' },
  status: {
    type: 'string',
    description:
      'Current lifecycle status of the campaign: active, paused, completed, draft, or archived',
  },
  prioritized: {
    type: 'boolean',
    description: 'Whether this campaign takes priority over non-prioritized campaigns',
  },
  end_date: {
    type: 'string',
    description: 'Date the campaign stops enrolling (YYYY-MM-DD)',
    nullable: true,
  },
  template_id: {
    type: 'string',
    description: 'ID of the template enrolled contacts are placed on',
  },
  template_name: { type: 'string', description: 'Title of the template', nullable: true },
  audiences: {
    type: 'array',
    description: 'Audiences enrolled in this campaign',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the audience' },
        name: { type: 'string', description: 'Name of the audience' },
      },
    },
  },
  enrollment_status: {
    type: 'string',
    description:
      "Progress of the async task enrolling this campaign's audiences: pending, running, enriching, completed, or failed",
  },
  created_at: { type: 'string', description: 'When the campaign was created (ISO 8601)' },
  updated_at: { type: 'string', description: 'When the campaign was last updated (ISO 8601)' },
} as const satisfies Record<string, OutputProperty>

export const MONACO_CAMPAIGN_DETAIL_OUTPUT_PROPERTIES = {
  ...MONACO_CAMPAIGN_OUTPUT_PROPERTIES,
  distribution: {
    type: 'object',
    description: 'How sends are routed across senders (percentage or account_owner)',
    nullable: true,
    properties: {
      mode: { type: 'string', description: 'Distribution mode: percentage or account_owner' },
      sender_ids: {
        type: 'array',
        description: 'IDs of the users eligible to send on this campaign',
        items: { type: 'string', description: 'Sender user ID' },
      },
      percentages: {
        type: 'array',
        description: 'Per-sender percentages summing to 100; set only in percentage mode',
        nullable: true,
        items: {
          type: 'object',
          properties: {
            sender_id: { type: 'string', description: 'ID of the sending user' },
            percentage: { type: 'number', description: 'Share of sends routed to this sender' },
          },
        },
      },
      fallback_sender_id: {
        type: 'string',
        description:
          "Sender used whenever a contact's account is unassigned or its owner is not in sender_ids; set only in account_owner mode",
        nullable: true,
      },
    },
  },
  rules_of_engagement: {
    type: 'object',
    description:
      "The campaign's effective rules of engagement; null when the campaign uses the org defaults with no campaign-level config",
    nullable: true,
    properties: {
      do_not_contact: {
        type: 'object',
        description: 'Skip contacts flagged do-not-contact',
        nullable: true,
        properties: MONACO_TOGGLE_RULE_PROPERTIES,
      },
      allow_sequence_stop_on_meeting_booked: {
        type: 'object',
        description: "Stop a contact's sequence once a meeting is booked",
        nullable: true,
        properties: MONACO_TOGGLE_RULE_PROPERTIES,
      },
      contact_cooldown: {
        type: 'object',
        description: 'Cooldown before re-contacting the same contact',
        nullable: true,
        properties: MONACO_COOLDOWN_RULE_PROPERTIES,
      },
      account_cooldown: {
        type: 'object',
        description: 'Cooldown before re-contacting any contact at the same account',
        nullable: true,
        properties: MONACO_COOLDOWN_RULE_PROPERTIES,
      },
      max_contacts_in_sequence: {
        type: 'object',
        description: 'Cap on simultaneously-active contacts per account',
        nullable: true,
        properties: {
          enabled: { type: 'boolean', description: 'Whether the cap is enforced' },
          max_contacts: {
            type: 'number',
            description:
              'Maximum contacts per account allowed in sequences simultaneously (Monaco defaults to 5)',
            nullable: true,
          },
        },
      },
      allow_non_account_owner_campaigns: {
        type: 'object',
        description: 'Allow enrolling contacts whose account owner is not a campaign sender',
        nullable: true,
        properties: MONACO_TOGGLE_RULE_PROPERTIES,
      },
      allow_stop_and_dismiss_on_account_status: {
        type: 'object',
        description: 'Stop and dismiss sequences when an account changes to certain statuses',
        nullable: true,
        properties: MONACO_STOP_AND_DISMISS_RULE_PROPERTIES,
      },
      exclude_sequences_on_account_status: {
        type: 'object',
        description:
          'Exclude not-yet-started sequences when an account is in (or transitions into) certain statuses; already-active sequences are unaffected',
        nullable: true,
        properties: MONACO_STOP_AND_DISMISS_RULE_PROPERTIES,
      },
    },
  },
  autopilot_mode: {
    type: 'string',
    description:
      '`autopilot` when every sender auto-sends, `supervised` when none do, `hybrid` when it is a mix',
  },
  autopilot_settings: {
    type: 'object',
    description: 'Senders currently on autopilot and their daily send-release cap',
    properties: {
      sender_rates: {
        type: 'array',
        description:
          'Senders on autopilot; senders not listed need manual approval before each send',
        items: {
          type: 'object',
          properties: {
            sender_id: { type: 'string', description: 'ID of the sending user' },
            daily_rate_target: {
              type: 'number',
              description: 'Daily cap on auto-released sends for this sender',
            },
          },
        },
      },
    },
  },
  contact_readiness_settings: {
    type: 'object',
    description: 'Checks run on each contact before its sequence starts',
    properties: {
      email: {
        type: 'object',
        description: 'Email lookup and verification before the sequence starts',
        nullable: true,
        properties: {
          check_on_enroll: {
            type: 'boolean',
            description:
              "Whether to find and verify each contact's email on enrollment, before the sequence starts",
          },
          on_failure: {
            type: 'string',
            description:
              "What happens when a contact's email can't be found or verified: `exclude` (the sequence is excluded) or `skip_channel_steps` (its email steps are skipped)",
            nullable: true,
          },
        },
      },
    },
  },
} as const satisfies Record<string, OutputProperty>

export interface MonacoListSequencesResponse extends ToolResponse {
  output: {
    sequences: MonacoSequence[]
    pagination: MonacoPagination
  }
}

export interface MonacoGetSequenceParams extends MonacoBaseParams {
  sequenceId: string
}

export interface MonacoUpdateSequenceParams extends MonacoBaseParams {
  sequenceId: string
  action: string
}

export interface MonacoSequenceDetailResponse extends ToolResponse {
  output: {
    sequence: MonacoSequenceDetail
  }
}

export interface MonacoListAudiencesResponse extends ToolResponse {
  output: {
    audiences: MonacoAudience[]
    pagination: MonacoPagination
  }
}

export interface MonacoGetAudienceParams extends MonacoBaseParams {
  audienceId: string
}

export interface MonacoAudienceResponse extends ToolResponse {
  output: {
    audience: MonacoAudience
  }
}

export interface MonacoListAudienceContactsParams extends MonacoPageParams {
  audienceId: string
}

export interface MonacoListAudienceContactsResponse extends ToolResponse {
  output: {
    contacts: MonacoContact[]
    pagination: MonacoPagination
  }
}

export interface MonacoCreateAudienceParams extends MonacoBaseParams {
  name: string
  contactIds?: unknown
  filters?: unknown
  excludedIds?: unknown
  sourceAudienceId?: string
}

export interface MonacoAudienceContactsParams extends MonacoBaseParams {
  audienceId: string
  contactIds: unknown
}

export interface MonacoAddAudienceContactsResponse extends ToolResponse {
  output: {
    audienceId: string
    addedCount: number
    failures: MonacoAudienceContactFailure[]
    unknownContactIds: string[]
  }
}

export interface MonacoRemoveAudienceContactsResponse extends ToolResponse {
  output: {
    audienceId: string
    failures: MonacoAudienceContactFailure[]
  }
}

export interface MonacoListCampaignsResponse extends ToolResponse {
  output: {
    campaigns: MonacoCampaign[]
    pagination: MonacoPagination
  }
}

export interface MonacoGetCampaignParams extends MonacoBaseParams {
  campaignId: string
}

export interface MonacoCampaignDetailResponse extends ToolResponse {
  output: {
    campaign: MonacoCampaignDetail
  }
}

export interface MonacoEnrollCampaignContactsParams extends MonacoBaseParams {
  campaignId: string
  audienceName: string
  contactIds: unknown
}

export interface MonacoEnrollCampaignContactsResponse extends ToolResponse {
  output: {
    successCount: number
    failureCount: number
    failureReasons: MonacoEnrollFailureReason[]
  }
}

export interface MonacoAddCampaignAudiencesParams extends MonacoBaseParams {
  campaignId: string
  audienceIds: unknown
}
