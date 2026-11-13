import type { ToolConfig } from '@/tools/types'

type MonacoParamDefinitions = ToolConfig['params']

/** Hidden bearer token the executor fills from the saved Monaco credential. */
export const MONACO_ACCESS_TOKEN_PARAM = {
  accessToken: {
    type: 'string',
    required: true,
    visibility: 'hidden',
    description: 'Monaco API key resolved from the saved Monaco credential',
  },
} as const satisfies MonacoParamDefinitions

/** `filters`, `sort`, `page`, and `page_size` accepted by every `POST /v1/{entity}/list` endpoint. */
export const MONACO_LIST_PARAMS = {
  filters: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Filters as an array of {"field", "condition", "value"} rules (ANDed), or an {"operator": "and"|"or", "filters": [...]} expression for nested logic. Conditions include is, is_not, equals, contains, not_contains, is_empty, is_not_empty, is_before, and is_after. Use Get Field Schemas to find filterable fields.',
  },
  sort: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Field to sort by; prefix with "-" for descending (e.g. "-created_at"). Defaults to "-created_at".',
  },
  page: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Page number, starting at 1. Defaults to 1.',
  },
  pageSize: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Results per page, from 1 to 500. Defaults to 50.',
  },
} as const satisfies MonacoParamDefinitions

/**
 * `page` and `page_size` query parameters on a Monaco GET list endpoint, which each document
 * their own default and maximum page size.
 */
export function monacoPageParams(defaultPageSize: number, maxPageSize: number) {
  return {
    page: MONACO_LIST_PARAMS.page,
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: `Results per page, from 1 to ${maxPageSize}. Defaults to ${defaultPageSize}.`,
    },
  } as const satisfies MonacoParamDefinitions
}

/**
 * Writable fields shared by Monaco's `ContactCreateRequest` (POST /v1/contacts/) and
 * `ContactUpsertRequest` (PUT /v1/contacts/).
 */
export const MONACO_CONTACT_WRITE_PARAMS = {
  email: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Email address of the contact (max 255 characters). Either email or LinkedIn URL is required.',
  },
  linkedinUrl: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'LinkedIn profile URL (a linkedin.com/in/... URL). Either email or LinkedIn URL is required; with only a LinkedIn URL, also pass an account ID or domain.',
  },
  firstName: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'First name of the contact (max 256 characters)',
  },
  lastName: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Last name of the contact (max 256 characters)',
  },
  title: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Job title of the contact',
  },
  phoneNumber: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Phone number of the contact',
  },
  location: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Location of the contact (max 256 characters)',
  },
  accountId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'ID of the account to associate the contact with. Takes priority over domain, then the domain parsed from email, when resolving the account.',
  },
  domain: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: "Domain of the contact's company, used to resolve its account",
  },
  doNotContact: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Whether the contact has opted out of outreach',
  },
  notes: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Notes about the contact (max 1,125,000 characters)',
  },
  tags: {
    type: 'array',
    items: { type: 'string' },
    required: false,
    visibility: 'user-or-llm',
    description:
      'Tag IDs for the contact, as an array or comma-separated list. When the request matches an existing contact, replaces its existing tags.',
  },
  isInbound: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Whether the contact is an inbound lead. When true and the request creates a new contact, Monaco records it as a captured inbound lead. Ignored when the request matches an existing contact. Defaults to false.',
  },
  customFields: {
    type: 'json',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Custom field values as a JSON object keyed by `custom_field_<id>` (e.g. {"custom_field_1a2b...": "economic_buyer"}). Use Get Field Schemas to find the keys.',
  },
} as const satisfies MonacoParamDefinitions

/**
 * Company and account fields shared by Monaco's `AccountUpdateRequest`
 * (PATCH /v1/accounts/{account_id}) and `AccountUpsertRequest` (PUT /v1/accounts/).
 */
export const MONACO_ACCOUNT_WRITE_PARAMS = {
  name: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Display name for the account (max 256 characters)',
  },
  status: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Account status (max 64 characters). Suggested values: NEW, PROSPECTING, OPPORTUNITY, CUSTOMER, DISQUALIFIED, NURTURE, INBOUND, CHURNED; any string is accepted.',
  },
  notes: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Notes about the account (max 1,125,000 characters)',
  },
  owner: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'User ID to assign as account owner',
  },
  parentAccount: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      "Account ID to set as this account's parent. The parent must be a top-level account in the same workspace.",
  },
  companyId: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'ID of the company to link to the account',
  },
  replaceEditedFields: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Also replace fields a user has edited, including edited domains, when linking a company. Defaults to false.',
  },
  linkedinUrl: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'LinkedIn company page URL',
  },
  description: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Company description (max 8192 characters)',
  },
  employeeCount: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Number of employees (0 or more)',
  },
  foundedYear: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Year the company was founded',
  },
  estimatedAnnualRevenueUsd: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Estimated annual revenue in USD (0 or more)',
  },
  totalFundingUsd: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Total funding raised in USD (0 or more)',
  },
  lastFundingRound: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Type of the most recent funding round. One of: pre_seed, seed, angel, series_a, series_b, series_c, series_d, series_e, series_f, series_g, series_h, series_i, series_j, series_unknown, private_equity, debt_financing, convertible_note, grant, non_equity_assistance, corporate_round, equity_crowdfunding, product_crowdfunding, initial_coin_offering, secondary_market, post_ipo_equity, post_ipo_debt, post_ipo_secondary, undisclosed.',
  },
  lastFundingDate: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Date of the most recent funding round (YYYY-MM-DD)',
  },
  industries: {
    type: 'array',
    items: { type: 'string' },
    required: false,
    visibility: 'user-or-llm',
    description:
      "Industries from Monaco's standard list (each max 128 characters), as an array or comma-separated list. Replaces the current list.",
  },
  businessModel: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Business model. One of: B2B, B2C.',
  },
  companyStatus: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Operating status of the company. One of: active, acquired, out_of_business, ipo, unknown.',
  },
  location: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Headquarters as "city, state, country"',
  },
} as const satisfies MonacoParamDefinitions
