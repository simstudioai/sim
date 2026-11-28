import type { ToolConfig } from '@/tools/types'

type DealportParamDefinitions = ToolConfig['params']

/** Saved service-account credential policy shared across every Dealport tool. */
export const DEALPORT_OAUTH = {
  required: true,
  provider: 'dealport',
  credentialKind: 'service-account',
} as const satisfies NonNullable<ToolConfig['oauth']>

/** Hidden bearer token filled by the executor from the saved Dealport credential. */
export const DEALPORT_ACCESS_TOKEN_PARAM = {
  accessToken: {
    type: 'string',
    required: true,
    visibility: 'hidden',
    description: 'Dealport API key resolved from the saved Dealport credential',
  },
} as const satisfies DealportParamDefinitions

/** Buy-box filters shared by `POST /companies/preview` and `GET /companies`. */
export const DEALPORT_COMPANY_FILTER_PARAMS = {
  q: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Company name prefix filter (e.g. "Buckeye Mechanical")',
  },
  state: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Two-letter US state code (e.g. OH, TX, FL)',
  },
  counties: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Comma-separated county names within state (e.g. "Franklin,Cuyahoga")',
  },
  cities: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Comma-separated city names within state (e.g. "Columbus,Cleveland")',
  },
  domain: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Company website host or registrable domain (e.g. "acmemechanical.com")',
  },
  naics: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Comma-separated 2-to-6 digit NAICS codes (e.g. "238220,332710")',
  },
  min_revenue: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Minimum annual revenue in USD',
  },
  max_revenue: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Maximum annual revenue in USD',
  },
  filed_revenue_only: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Restrict to primary filed revenue (CMS cost reports or PPP filings)',
  },
  min_employees: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Minimum employee headcount',
  },
  max_employees: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Maximum employee headcount',
  },
  size_unknown: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Include companies without reported size alongside sized matches',
  },
  independent: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Exclude SEC filers, nonprofits, government bodies, membership groups, and HOAs',
  },
  owner_businesses: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Minimum number of businesses associated with the same owner (2 to 25)',
  },
  medicare: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Require Medicare enrollment (CMS certification number)',
  },
  owner_operated: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Require owner-operated status in CMS filings',
  },
  owner_contact: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Require an owner phone or email already on file',
  },
  licensed: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Require an active state health license',
  },
  care_types: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Comma-separated NPI healthcare organization care types',
  },
  adviser: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Require SEC Form ADV investment adviser registration',
  },
  wealth_adviser: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Require individual wealth adviser profile (no private funds, at least 20 clients)',
  },
  online_store: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: 'Require an indexed online storefront',
  },
  sells: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Comma-separated online store product categories',
  },
  store_words: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Comma-separated storefront full-text search terms',
  },
  min_reviews: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    description: 'Minimum online store review count',
  },
  order: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Storefront sort order: reviews, products, or match',
  },
} as const satisfies DealportParamDefinitions
