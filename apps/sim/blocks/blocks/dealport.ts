import { toBooleanFromInput } from '@sim/utils/coerce'
import { DealportIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { mapperOperation } from '@/blocks/utils'

type FieldKind = 'string' | 'number' | 'boolean' | 'value'

/** Maps a tool parameter to its block subBlock ID and execution-time coercion kind. */
type FieldBinding = readonly [param: string, field: string, kind: FieldKind]

const COMPANY_FILTER_BINDINGS: readonly FieldBinding[] = [
  ['q', 'q', 'string'],
  ['state', 'state', 'string'],
  ['counties', 'counties', 'string'],
  ['cities', 'cities', 'string'],
  ['domain', 'domain', 'string'],
  ['naics', 'naics', 'string'],
  ['min_revenue', 'min_revenue', 'number'],
  ['max_revenue', 'max_revenue', 'number'],
  ['filed_revenue_only', 'filed_revenue_only', 'boolean'],
  ['min_employees', 'min_employees', 'number'],
  ['max_employees', 'max_employees', 'number'],
  ['size_unknown', 'size_unknown', 'boolean'],
  ['independent', 'independent', 'boolean'],
  ['owner_businesses', 'owner_businesses', 'number'],
  ['medicare', 'medicare', 'boolean'],
  ['owner_operated', 'owner_operated', 'boolean'],
  ['owner_contact', 'owner_contact', 'boolean'],
  ['licensed', 'licensed', 'boolean'],
  ['care_types', 'care_types', 'string'],
  ['adviser', 'adviser', 'boolean'],
  ['wealth_adviser', 'wealth_adviser', 'boolean'],
  ['online_store', 'online_store', 'boolean'],
  ['sells', 'sells', 'string'],
  ['store_words', 'store_words', 'string'],
  ['min_reviews', 'min_reviews', 'number'],
  ['order', 'order', 'string'],
]

const OPERATION_FIELDS = {
  dealport_preview_companies: [...COMPANY_FILTER_BINDINGS, ['markets', 'previewMarkets', 'value']],
  dealport_search_companies: [
    ...COMPANY_FILTER_BINDINGS,
    ['markets', 'searchMarkets', 'string'],
    ['limit', 'limit', 'number'],
    ['cursor', 'cursor', 'string'],
  ],
  dealport_search_buildings: [
    ['borough', 'borough', 'string'],
    ['min_units', 'min_units', 'number'],
    ['q', 'buildingQuery', 'string'],
    ['loan_due_by', 'loan_due_by', 'number'],
    ['loan_holder', 'loan_holder', 'string'],
    ['signal', 'signal', 'string'],
    ['limit', 'limit', 'number'],
    ['cursor', 'cursor', 'string'],
  ],
  dealport_get_record: [['recordId', 'recordId', 'string']],
  dealport_match_companies: [
    ['items', 'items', 'value'],
    ['csv', 'csv', 'string'],
    ['project_name', 'project_name', 'string'],
    ['project_id', 'project_id', 'string'],
    ['watch', 'watch', 'boolean'],
  ],
  dealport_find_owner: [
    ['company_id', 'company_id', 'string'],
    ['llc_name', 'llc_name', 'string'],
    ['property_address', 'property_address', 'string'],
    ['person', 'person', 'string'],
    ['state', 'ownerState', 'string'],
    ['city', 'ownerCity', 'string'],
    ['mailing_address', 'mailing_address', 'string'],
    ['care_of', 'care_of', 'string'],
  ],
} as const satisfies Record<string, readonly FieldBinding[]>

type DealportOperation = keyof typeof OPERATION_FIELDS

const ALL_FIELD_KEYS = [
  ...new Set(
    Object.values(OPERATION_FIELDS).flatMap((bindings: readonly FieldBinding[]) =>
      bindings.flatMap((binding) => [binding[0], binding[1]])
    )
  ),
]

function isDealportOperation(value: unknown): value is DealportOperation {
  return typeof value === 'string' && Object.hasOwn(OPERATION_FIELDS, value)
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && !value.trim())
}

function coerceField(value: unknown, kind: FieldKind, param: string): unknown {
  if (isBlank(value)) return undefined
  if (kind === 'boolean') return toBooleanFromInput(value)
  if (kind === 'number') {
    const parsed = typeof value === 'number' ? value : Number(String(value).trim())
    if (!Number.isFinite(parsed)) throw new Error(`${param} must be a number`)
    return parsed
  }
  return value
}

const ops = (...values: DealportOperation[]) => ({ field: 'operation', value: values })

const COMPANY_SEARCH_AND_PREVIEW: DealportOperation[] = [
  'dealport_preview_companies',
  'dealport_search_companies',
]

export const DealportBlock: BlockConfig = {
  type: 'dealport',
  name: 'Dealport',
  description: 'Search cited US private company and building Records and verified human owners',
  longDescription:
    'Size US private company markets at $0.00, search 28M+ US private companies and NYC commercial or multifamily buildings, open cited Records backed by primary public filings, match external company rows into Projects, and resolve verified human principals with direct phones, emails, and profiles.',
  docsLink: 'https://docs.sim.ai/integrations/dealport',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#0E1524',
  icon: DealportIcon,
  authMode: AuthMode.ApiKey,

  canvasPresentation: {
    defaultTitle: 'Dealport',
    sentences: {
      byOperation: {
        dealport_preview_companies: [
          'Preview US private company count',
          { text: 'in', field: 'state' },
          { text: ', for NAICS', field: 'naics' },
        ],
        dealport_search_companies: [
          'Search US private companies',
          { text: 'in', field: 'state' },
          { text: ', matching', field: ['q', 'domain', 'naics'] },
        ],
        dealport_search_buildings: [
          { text: 'Search NYC buildings in', field: 'borough', core: true },
          { text: ', with at least', field: 'min_units', after: 'units' },
          { text: ', matching', field: 'buildingQuery' },
        ],
        dealport_get_record: [{ text: 'Open', field: 'recordId', core: true }],
        dealport_match_companies: [
          {
            text: 'Match',
            field: ['items', 'csv'],
            after: 'against US private companies',
            core: true,
          },
          { text: ', into Project', field: 'project_name' },
        ],
        dealport_find_owner: [
          {
            text: 'Resolve verified human owner for',
            field: ['company_id', 'llc_name', 'property_address'],
            core: true,
          },
          { text: ', targeting', field: 'person' },
        ],
      },
    },
  },

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Preview Companies', id: 'dealport_preview_companies' },
        { label: 'Search Companies', id: 'dealport_search_companies' },
        { label: 'Search Buildings', id: 'dealport_search_buildings' },
        { label: 'Get Record', id: 'dealport_get_record' },
        { label: 'Match Companies', id: 'dealport_match_companies' },
        { label: 'Find Owner', id: 'dealport_find_owner' },
      ],
      value: () => 'dealport_preview_companies',
    },
    {
      id: 'credential',
      title: 'Dealport Account',
      type: 'oauth-input',
      serviceId: 'dealport',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      placeholder: 'Select Dealport credential',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Dealport Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'q',
      title: 'Company Name Prefix',
      type: 'short-input',
      placeholder: 'e.g. Buckeye Mechanical',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
    },
    {
      id: 'state',
      title: 'State',
      type: 'short-input',
      placeholder: 'Two-letter US state code (e.g. OH, TX, FL)',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
    },
    {
      id: 'naics',
      title: 'NAICS Codes',
      type: 'short-input',
      placeholder: 'e.g. 238220, 332710',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the target industries (e.g. commercial HVAC and plumbing)...',
        prompt:
          'Convert the industry description into comma-separated 2-to-6 digit US NAICS codes (e.g. 238220,332710). Return ONLY the comma-separated NAICS code string.',
      },
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'e.g. acmemechanical.com',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
    },
    {
      id: 'min_employees',
      title: 'Min Employees',
      type: 'short-input',
      placeholder: 'e.g. 15',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
    },
    {
      id: 'max_employees',
      title: 'Max Employees',
      type: 'short-input',
      placeholder: 'e.g. 150',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
    },
    {
      id: 'min_revenue',
      title: 'Min Annual Revenue (USD)',
      type: 'short-input',
      placeholder: 'e.g. 2000000',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
    },
    {
      id: 'max_revenue',
      title: 'Max Annual Revenue (USD)',
      type: 'short-input',
      placeholder: 'e.g. 25000000',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
    },
    {
      id: 'independent',
      title: 'Independent Businesses Only',
      type: 'switch',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
    },
    {
      id: 'cities',
      title: 'Cities',
      type: 'short-input',
      placeholder: 'Comma-separated cities within state (e.g. Columbus, Cleveland)',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
      mode: 'advanced',
    },
    {
      id: 'counties',
      title: 'Counties',
      type: 'short-input',
      placeholder: 'Comma-separated counties within state (e.g. Franklin, Cuyahoga)',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
      mode: 'advanced',
    },
    {
      id: 'previewMarkets',
      title: 'Additional Markets (JSON)',
      type: 'code',
      language: 'json',
      placeholder: '[{"state": "IN"}, {"state": "MI", "counties": ["Wayne", "Oakland"]}]',
      condition: { field: 'operation', value: 'dealport_preview_companies' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe additional US states and counties to include...',
        prompt:
          'Generate a JSON array of Dealport market objects where each entry has a two-letter uppercase "state" code and an optional "counties" array of county names. Return ONLY the JSON array.',
        generationType: 'json-array',
      },
    },
    {
      id: 'searchMarkets',
      title: 'Additional Markets',
      type: 'short-input',
      placeholder: 'e.g. IN|MI:Wayne,Oakland',
      condition: { field: 'operation', value: 'dealport_search_companies' },
      mode: 'advanced',
    },
    {
      id: 'filed_revenue_only',
      title: 'Filed Revenue Only',
      type: 'switch',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
      mode: 'advanced',
    },
    {
      id: 'size_unknown',
      title: 'Include Unreported Size',
      type: 'switch',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
      mode: 'advanced',
    },
    {
      id: 'owner_businesses',
      title: 'Min Owner Businesses',
      type: 'short-input',
      placeholder: '2 to 25',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
      mode: 'advanced',
    },
    {
      id: 'owner_contact',
      title: 'Owner Contact on File',
      type: 'switch',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
      mode: 'advanced',
    },
    {
      id: 'owner_operated',
      title: 'Owner Operated (CMS)',
      type: 'switch',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
      mode: 'advanced',
    },
    {
      id: 'medicare',
      title: 'Medicare Enrolled',
      type: 'switch',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
      mode: 'advanced',
    },
    {
      id: 'licensed',
      title: 'Active Health License',
      type: 'switch',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
      mode: 'advanced',
    },
    {
      id: 'care_types',
      title: 'Healthcare Care Types',
      type: 'short-input',
      placeholder: 'Comma-separated NPI organization care types',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
      mode: 'advanced',
    },
    {
      id: 'adviser',
      title: 'SEC Form ADV Adviser',
      type: 'switch',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
      mode: 'advanced',
    },
    {
      id: 'wealth_adviser',
      title: 'Individual Wealth Adviser',
      type: 'switch',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
      mode: 'advanced',
    },
    {
      id: 'online_store',
      title: 'Has Online Storefront',
      type: 'switch',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
      mode: 'advanced',
    },
    {
      id: 'sells',
      title: 'Store Product Categories',
      type: 'short-input',
      placeholder: 'Comma-separated storefront product categories',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
      mode: 'advanced',
    },
    {
      id: 'store_words',
      title: 'Storefront Keywords',
      type: 'short-input',
      placeholder: 'Comma-separated storefront search terms',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
      mode: 'advanced',
    },
    {
      id: 'min_reviews',
      title: 'Min Store Reviews',
      type: 'short-input',
      placeholder: 'e.g. 25',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
      mode: 'advanced',
    },
    {
      id: 'order',
      title: 'Storefront Sort Order',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Match', id: 'match' },
        { label: 'Reviews', id: 'reviews' },
        { label: 'Products', id: 'products' },
      ],
      value: () => '',
      condition: { field: 'operation', value: COMPANY_SEARCH_AND_PREVIEW },
      mode: 'advanced',
    },
    {
      id: 'borough',
      title: 'NYC Borough',
      canvasNoun: 'an NYC borough',
      type: 'dropdown',
      options: [
        { label: 'Manhattan (MN)', id: 'MN' },
        { label: 'Brooklyn (BK)', id: 'BK' },
        { label: 'Queens (QN)', id: 'QN' },
        { label: 'Bronx (BX)', id: 'BX' },
        { label: 'Staten Island (SI)', id: 'SI' },
      ],
      value: () => 'BK',
      condition: { field: 'operation', value: 'dealport_search_buildings' },
      required: { field: 'operation', value: 'dealport_search_buildings' },
    },
    {
      id: 'min_units',
      title: 'Min Residential Units',
      type: 'short-input',
      placeholder: 'Defaults to 10',
      condition: { field: 'operation', value: 'dealport_search_buildings' },
    },
    {
      id: 'buildingQuery',
      title: 'Address or Owner Filter',
      canvasNoun: 'an address or owner',
      type: 'short-input',
      placeholder: 'e.g. Atlantic Ave or Holding LLC',
      condition: { field: 'operation', value: 'dealport_search_buildings' },
    },
    {
      id: 'loan_due_by',
      title: 'Loan Maturity Year Ceiling',
      type: 'short-input',
      placeholder: 'e.g. 2027',
      condition: { field: 'operation', value: 'dealport_search_buildings' },
      mode: 'advanced',
    },
    {
      id: 'loan_holder',
      title: 'Mortgage Holder Type',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Bank', id: 'bank' },
        { label: 'Agency', id: 'agency' },
        { label: 'CMBS', id: 'cmbs' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'dealport_search_buildings' },
      mode: 'advanced',
    },
    {
      id: 'signal',
      title: 'Building Signal',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Rent Stabilized', id: 'rent_stabilized' },
        { label: 'DOB Penalties', id: 'dob_penalties' },
        { label: 'Housing Court', id: 'housing_court' },
        { label: 'Tax Lien', id: 'tax_lien' },
        { label: 'Local Law 97 (LL97)', id: 'll97' },
        { label: 'Section 8 Expiring', id: 'section8_expiring' },
        { label: 'Tax Credit Ending', id: 'tax_credit_ending' },
        { label: 'Failing Inspection', id: 'failing_inspection' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'dealport_search_buildings' },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '1 to 50 (defaults to 25)',
      condition: {
        field: 'operation',
        value: ['dealport_search_companies', 'dealport_search_buildings'],
      },
      mode: 'advanced',
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor from next_cursor',
      condition: {
        field: 'operation',
        value: ['dealport_search_companies', 'dealport_search_buildings'],
      },
      mode: 'advanced',
    },
    {
      id: 'recordId',
      title: 'Record ID',
      canvasNoun: 'a Record',
      type: 'short-input',
      placeholder: 'Company UUID or 10-digit NYC BBL (e.g. 1008350041)',
      condition: { field: 'operation', value: 'dealport_get_record' },
      required: { field: 'operation', value: 'dealport_get_record' },
    },
    {
      id: 'items',
      title: 'Company Rows (JSON)',
      canvasNoun: 'company rows',
      type: 'code',
      language: 'json',
      placeholder:
        '[{"name": "Buckeye Mechanical", "domain": "buckeyemechanical.example", "city": "Columbus", "state": "OH"}]',
      description: 'Provide either Company Rows (JSON) or CSV Text (1 to 250 rows)',
      condition: { field: 'operation', value: 'dealport_match_companies' },
      wandConfig: {
        enabled: true,
        placeholder: 'Paste raw company names, websites, and locations to structure as JSON...',
        prompt:
          'Convert the provided companies into a JSON array of objects (1 to 250 items), each using optional keys "name", "domain", "city", "state", and "external_id". Return ONLY the JSON array.',
        generationType: 'json-array',
      },
    },
    {
      id: 'csv',
      title: 'CSV Text',
      canvasNoun: 'CSV rows',
      type: 'long-input',
      rows: 5,
      placeholder:
        'name,domain,city,state\nBuckeye Mechanical,buckeyemechanical.example,Columbus,OH',
      description: 'Provide either Company Rows (JSON) or CSV Text (1 to 250 rows)',
      condition: { field: 'operation', value: 'dealport_match_companies' },
    },
    {
      id: 'project_name',
      title: 'Project Name',
      type: 'short-input',
      placeholder: 'e.g. Ohio Commercial HVAC Targets',
      condition: { field: 'operation', value: 'dealport_match_companies' },
      mode: 'advanced',
    },
    {
      id: 'project_id',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Target Project UUID',
      condition: { field: 'operation', value: 'dealport_match_companies' },
      mode: 'advanced',
    },
    {
      id: 'watch',
      title: 'Watch Matched Companies Weekly',
      type: 'switch',
      description:
        'Monitor matched companies weekly for ownership, leadership, headcount, filing, and news changes ($0.05 per newly watched company per month).',
      condition: { field: 'operation', value: 'dealport_match_companies' },
      mode: 'advanced',
    },
    {
      id: 'company_id',
      title: 'Company ID',
      canvasNoun: 'a company',
      type: 'short-input',
      placeholder: 'Dealport company UUID',
      description: 'Provide Company ID, LLC or Entity Name, or Property Address',
      condition: { field: 'operation', value: 'dealport_find_owner' },
    },
    {
      id: 'llc_name',
      title: 'LLC or Entity Name',
      canvasNoun: 'an LLC',
      type: 'short-input',
      placeholder: 'e.g. Tanforan Crossing Holdings LLC',
      description: 'Provide Company ID, LLC or Entity Name, or Property Address',
      condition: { field: 'operation', value: 'dealport_find_owner' },
    },
    {
      id: 'property_address',
      title: 'Property Address',
      canvasNoun: 'a property address',
      type: 'short-input',
      placeholder: 'e.g. 853 Commodore Dr, San Bruno, CA 94066',
      description: 'Provide Company ID, LLC or Entity Name, or Property Address',
      condition: { field: 'operation', value: 'dealport_find_owner' },
    },
    {
      id: 'person',
      title: 'Principal Name',
      type: 'short-input',
      placeholder: 'Optional full name of a specific principal on the Record',
      condition: { field: 'operation', value: 'dealport_find_owner' },
      mode: 'advanced',
    },
    {
      id: 'ownerState',
      title: 'Entity State',
      type: 'short-input',
      placeholder: 'Two-letter US state code (e.g. CA, DE)',
      condition: { field: 'operation', value: 'dealport_find_owner' },
      mode: 'advanced',
    },
    {
      id: 'ownerCity',
      title: 'Entity City',
      type: 'short-input',
      placeholder: 'e.g. San Bruno',
      condition: { field: 'operation', value: 'dealport_find_owner' },
      mode: 'advanced',
    },
    {
      id: 'mailing_address',
      title: 'Mailing Address',
      type: 'short-input',
      placeholder: 'Optional tax or corporate filing mailing address',
      condition: { field: 'operation', value: 'dealport_find_owner' },
      mode: 'advanced',
    },
    {
      id: 'care_of',
      title: 'Care Of',
      type: 'short-input',
      placeholder: 'Optional care-of name from a deed or tax roll',
      condition: { field: 'operation', value: 'dealport_find_owner' },
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'dealport_preview_companies',
      'dealport_search_companies',
      'dealport_search_buildings',
      'dealport_get_record',
      'dealport_match_companies',
      'dealport_find_owner',
    ],
    config: {
      tool: (params) =>
        isDealportOperation(params.operation) ? params.operation : 'dealport_preview_companies',
      params: (params, context) => {
        const operation = mapperOperation(params, context)
        const result: Record<string, unknown> = {
          operation: undefined,
          credential: undefined,
          manualCredential: undefined,
          oauthCredential: params.oauthCredential,
        }
        for (const key of ALL_FIELD_KEYS) result[key] = undefined
        if (!isDealportOperation(operation)) return result
        const bindings: readonly FieldBinding[] = OPERATION_FIELDS[operation]
        for (const [param, field, kind] of bindings) {
          const value = isBlank(params[field]) && context?.operation ? params[param] : params[field]
          result[param] = coerceField(value, kind, param)
        }
        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Dealport operation to perform' },
    oauthCredential: { type: 'string', description: 'Saved Dealport API key credential' },
    q: { type: 'string', description: 'Company name prefix filter' },
    state: { type: 'string', description: 'Two-letter US state code' },
    naics: { type: 'string', description: 'Comma-separated 2-to-6 digit NAICS codes' },
    domain: { type: 'string', description: 'Company website host or registrable domain' },
    min_employees: { type: 'number', description: 'Minimum employee headcount' },
    max_employees: { type: 'number', description: 'Maximum employee headcount' },
    min_revenue: { type: 'number', description: 'Minimum annual revenue in USD' },
    max_revenue: { type: 'number', description: 'Maximum annual revenue in USD' },
    independent: { type: 'boolean', description: 'Restrict to independent private businesses' },
    cities: { type: 'string', description: 'Comma-separated city names within state' },
    counties: { type: 'string', description: 'Comma-separated county names within state' },
    previewMarkets: {
      type: 'json',
      description: 'Additional markets as a JSON array of {state, counties} objects',
    },
    searchMarkets: {
      type: 'string',
      description: 'Additional markets query expression (e.g. IN|MI:Wayne,Oakland)',
    },
    filed_revenue_only: { type: 'boolean', description: 'Require primary filed revenue' },
    size_unknown: { type: 'boolean', description: 'Include companies without reported size' },
    owner_businesses: {
      type: 'number',
      description: 'Minimum number of businesses associated with the same owner',
    },
    owner_contact: { type: 'boolean', description: 'Require an owner phone or email on file' },
    owner_operated: {
      type: 'boolean',
      description: 'Require owner-operated status in CMS filings',
    },
    medicare: { type: 'boolean', description: 'Require Medicare enrollment' },
    licensed: { type: 'boolean', description: 'Require an active state health license' },
    care_types: { type: 'string', description: 'Comma-separated NPI healthcare care types' },
    adviser: { type: 'boolean', description: 'Require SEC Form ADV investment adviser status' },
    wealth_adviser: { type: 'boolean', description: 'Require individual wealth adviser profile' },
    online_store: { type: 'boolean', description: 'Require an indexed online storefront' },
    sells: { type: 'string', description: 'Comma-separated online store product categories' },
    store_words: { type: 'string', description: 'Comma-separated storefront search terms' },
    min_reviews: { type: 'number', description: 'Minimum online store review count' },
    order: { type: 'string', description: 'Storefront sort order (match, reviews, or products)' },
    borough: { type: 'string', description: 'NYC borough code (MN, BK, QN, BX, or SI)' },
    min_units: { type: 'number', description: 'Minimum residential unit count' },
    buildingQuery: { type: 'string', description: 'Building street address or owner substring' },
    loan_due_by: { type: 'number', description: 'Estimated loan maturity year ceiling' },
    loan_holder: {
      type: 'string',
      description: 'Mortgage holder category (agency, cmbs, or bank)',
    },
    signal: { type: 'string', description: 'Building regulatory or distress signal filter' },
    limit: { type: 'number', description: 'Page size (1 to 50)' },
    cursor: { type: 'string', description: 'Pagination cursor from next_cursor' },
    recordId: { type: 'string', description: 'Dealport company UUID or 10-digit NYC BBL' },
    items: {
      type: 'json',
      description: 'JSON array of 1 to 250 company objects to match ({name, domain, city, state})',
    },
    csv: { type: 'string', description: 'Raw CSV rows with header row to match' },
    project_name: { type: 'string', description: 'Target Dealport Project name' },
    project_id: { type: 'string', description: 'Target Dealport Project UUID' },
    watch: {
      type: 'boolean',
      description: 'Enable weekly Project monitoring on matched companies',
    },
    company_id: { type: 'string', description: 'Dealport company UUID for owner lookup' },
    llc_name: { type: 'string', description: 'US LLC or holding entity name for owner lookup' },
    property_address: {
      type: 'string',
      description: 'US property street address for owner lookup',
    },
    person: { type: 'string', description: 'Specific principal full name on the Record' },
    ownerState: { type: 'string', description: 'Two-letter US state code for entity resolution' },
    ownerCity: { type: 'string', description: 'City for entity or property resolution' },
    mailing_address: { type: 'string', description: 'Tax or filing mailing address' },
    care_of: { type: 'string', description: 'Care-of name from a deed or tax roll' },
  },

  outputs: {
    matching_count: {
      type: 'number',
      description: 'Total US private companies matching the buy-box filters',
      condition: ops('dealport_preview_companies'),
    },
    matching_count_more: {
      type: 'boolean',
      description: 'Whether additional matches exist beyond matching_count',
      condition: ops('dealport_preview_companies'),
    },
    sample: {
      type: 'json',
      description:
        'Sample companies [{id, name, city, state, industry, employee_band, revenue_band, independent}]',
      condition: ops('dealport_preview_companies'),
    },
    companies: {
      type: 'json',
      description:
        'Matching company Records [{id, name, city, state, zip, naics, industry, industryLabel, phone, website, revenue, employees, owner, sources, foundedYear}]',
      condition: ops('dealport_search_companies'),
    },
    buildings: {
      type: 'json',
      description:
        'Matching NYC building Records [{bbl, borough, address, owner_of_record, residential_units, building_class, year_built, zoning, rent_stabilized_units, loan}]',
      condition: ops('dealport_search_buildings'),
    },
    next_cursor: {
      type: 'string',
      description: 'Pagination cursor for the next page, or null on the final page',
      condition: ops('dealport_search_companies', 'dealport_search_buildings'),
    },
    record: {
      type: 'json',
      description:
        'Cited Dealport Record {id, kind, name, summary, website, phone, facts, people, identifiers, sources, capsule_freshness}',
      condition: ops('dealport_get_record'),
    },
    total_input: {
      type: 'number',
      description: 'Total submitted company rows',
      condition: ops('dealport_match_companies'),
    },
    matched_count: {
      type: 'number',
      description: 'Number of rows matched to Dealport company Records',
      condition: ops('dealport_match_companies'),
    },
    unmatched_count: {
      type: 'number',
      description: 'Number of unmatched rows',
      condition: ops('dealport_match_companies'),
    },
    domain_matched_count: {
      type: 'number',
      description: 'Rows matched by exact registrable domain',
      condition: ops('dealport_match_companies'),
    },
    fuzzy_matched_count: {
      type: 'number',
      description: 'Rows matched by fuzzy entity and geography resolution',
      condition: ops('dealport_match_companies'),
    },
    cached_owners_count: {
      type: 'number',
      description: 'Matched companies with an already-cached human owner',
      condition: ops('dealport_match_companies'),
    },
    matched_company_ids: {
      type: 'json',
      description: 'Dealport company UUIDs for matched rows [string]',
      condition: ops('dealport_match_companies'),
    },
    results: {
      type: 'json',
      description:
        'Per-row match outcomes [{index, external_id, input, matched, match_method, company_id, company_name, domain, city, state, naics, industry, cached_owner, record_url}]',
      condition: ops('dealport_match_companies'),
    },
    company: {
      type: 'json',
      description: 'Resolved company or entity {id, name}',
      condition: ops('dealport_find_owner'),
    },
    person: {
      type: 'json',
      description:
        'Verified human principal {name, role, headline, summary, linkedin_url, photo_url, location, seniority, department, decision_role}',
      condition: ops('dealport_find_owner'),
    },
    phone: {
      type: 'string',
      description: 'Primary verified direct or mobile phone number',
      condition: ops('dealport_find_owner'),
    },
    email: {
      type: 'string',
      description: 'Primary verified work or personal email address',
      condition: ops('dealport_find_owner'),
    },
    phones: {
      type: 'json',
      description: 'Verified direct and mobile phones [{number, kind, label, dnc}]',
      condition: ops('dealport_find_owner'),
    },
    emails: {
      type: 'json',
      description:
        'Verified work and personal emails [{address, kind, verified, status, checked_at}]',
      condition: ops('dealport_find_owner'),
    },
    profile: {
      type: 'json',
      description:
        'Professional profile {headline, summary, linkedin_url, photo_url, location, seniority, department, decision_role, company, roles, education, skills, certifications, languages, organizations}',
      condition: ops('dealport_find_owner'),
    },
    sources: {
      type: 'json',
      description: 'Filing and verification sources [{url, title}]',
      condition: ops('dealport_find_owner'),
    },
    note: {
      type: 'string',
      description: 'Diagnostic resolution note when returned',
      condition: ops('dealport_find_owner'),
    },
    board_url: {
      type: 'string',
      description: 'Dealport URL for inspecting the market query or Project',
      condition: ops('dealport_preview_companies', 'dealport_match_companies'),
    },
    record_url: {
      type: 'string',
      description: 'Dealport URL for the Record',
      condition: ops('dealport_get_record', 'dealport_find_owner'),
    },
    cost_usd: {
      type: 'number',
      description: 'USD charge for the request',
      condition: ops(
        'dealport_preview_companies',
        'dealport_get_record',
        'dealport_match_companies',
        'dealport_find_owner'
      ),
    },
    remaining_balance_usd: {
      type: 'number',
      description: 'Remaining workspace USD balance after the request',
      condition: ops(
        'dealport_preview_companies',
        'dealport_get_record',
        'dealport_match_companies',
        'dealport_find_owner'
      ),
    },
  },
}

export const DealportBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://dealport.com',
  templates: [
    {
      icon: DealportIcon,
      title: 'Dealport market sizing brief',
      prompt:
        'Build an agent that takes a US state, NAICS code, and employee band, runs Dealport Preview Companies at $0.00 to size the independent SMB universe, pulls the top cited Records, and writes a market sizing brief.',
      modules: ['agent', 'files', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      featured: true,
    },
    {
      icon: DealportIcon,
      title: 'Dealport SMB origination table',
      prompt:
        'Create a workflow that searches Dealport for independent US private companies in a target state and NAICS industry, opens each cited Record to inspect primary filing facts, and writes qualified targets into a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'enrichment'],
    },
    {
      icon: DealportIcon,
      title: 'Dealport inbound company matcher',
      prompt:
        'Build a workflow that reads new company rows from a table, runs Dealport Match Companies at $0.00 to resolve exact domains and fuzzy legal names against 28M+ US SMBs, and writes the matched Dealport UUIDs and industries back.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'enrichment'],
    },
    {
      icon: DealportIcon,
      title: 'Dealport owner contact resolver',
      prompt:
        'Build a workflow that takes qualified company UUIDs from a table, calls Dealport Find Owner to resolve each verified human principal with direct mobile phone and email, and syncs the contact into HubSpot.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'enrichment'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: DealportIcon,
      title: 'Dealport NYC loan maturity digest',
      prompt:
        'Create a scheduled weekly workflow that searches Dealport NYC multifamily buildings with bank mortgages maturing soon, opens cited building Records, and posts a summary with Record links to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['research', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DealportIcon,
      title: 'Dealport filing diligence memo',
      prompt:
        'Build an agent that takes a Dealport company UUID or 10-digit NYC BBL, opens the full cited Record, separates filed facts from observed or estimated figures, and saves a source-cited diligence memo.',
      modules: ['agent', 'files', 'workflows'],
      category: 'productivity',
      tags: ['research', 'finance'],
    },
    {
      icon: DealportIcon,
      title: 'Dealport LLC principal lookup',
      prompt:
        'Create a workflow that reads holding LLC names and property street addresses from a table, runs Dealport Find Owner to unmask the human principal behind corporate registered agents, and writes verified phones and emails back.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['research', 'enrichment'],
    },
  ],
  skills: [
    {
      name: 'size-us-smb-market-with-dealport',
      description:
        'Size any US private company buy-box at $0.00 with Dealport Preview Companies before opening paid Records.',
      content:
        '# Size a US Private Company Market with Dealport\n\nMeasure the addressable universe of US private businesses for a buy-box before spending workspace balance.\n\n## Steps\n1. Run `dealport_preview_companies` (`$0.00`) with geography (`state`, `cities`, `counties`, or `markets`), `naics` codes, headcount or revenue bounds, and `independent: true` when excluding public companies, nonprofits, and government entities.\n2. Report `matching_count` (noting `matching_count_more` if capped), the up to 5 sample companies, and `board_url`.\n3. Tighten or widen the filters at `$0.00` until the market count matches the target mandate.\n4. Once the scope is confirmed, run `dealport_search_companies` with a bounded `limit` to pull cited company Records (`$0.01` per fresh Record, `$0.00` on 30-day workspace repeats).\n\n## Output\nReturn the total matching count, the 5 sample companies, the `board_url`, and `remaining_balance_usd`, clearly distinguishing `filed`, `observed`, and `estimate` figures when company Records are fetched.',
    },
    {
      name: 'open-cited-dealport-record',
      description:
        'Open a cited Dealport company or NYC building Record and summarize primary public-filing facts and principals.',
      content:
        "# Open a Cited Dealport Record\n\nInspect primary public-filing evidence, principals, and registry identifiers for a US private company or NYC building.\n\n## Steps\n1. If you only have a company name or domain, run `dealport_search_companies` or `dealport_match_companies` first to obtain the Dealport company UUID.\n2. Call `dealport_get_record` with `recordId` set to the Dealport company UUID or 10-digit NYC BBL (`$0.01` fresh, `$0.00` on 30-day repeats).\n3. Inspect `record.facts`, preserving each fact's `basis` (`filed`, `observed`, or `estimate`), `as_of` date, and primary `source`.\n4. Review `record.people`, `record.identifiers`, and `record.sources`.\n\n## Output\nPresent a structured summary of the entity, its principals, registry identifiers, and primary filing citations, always linking `record_url` and stating each metric's `basis`.",
    },
    {
      name: 'match-external-companies-to-dealport',
      description:
        'Match up to 250 external company names and domains against 28M+ US private companies at $0.00.',
      content:
        "# Match External Companies to Dealport Records\n\nResolve external CRM exports, event rosters, or territory CSVs against Dealport's 28M+ US private company Records.\n\n## Steps\n1. Pass 1 to 250 rows to `dealport_match_companies` via `items` (JSON array of `{name, domain, city, state, external_id}`) or `csv` (`$0.00` when `watch` is `false`).\n2. Optionally set `project_name` or `project_id` to organize matched companies inside a Dealport Project.\n3. Separate exact `domain_exact` matches from `name_fuzzy` matches and inspect any `cached_owner` already returned on matched rows.\n4. Call `dealport_get_record` on priority `matched_company_ids` when full primary-filing facts are needed.\n\n## Output\nReturn `matched_count`, `unmatched_count`, `domain_matched_count`, `fuzzy_matched_count`, and the matched rows with their `company_id` and `record_url`.",
    },
    {
      name: 'resolve-verified-company-or-llc-owner',
      description:
        'Resolve the verified human principal, direct phones, emails, and profile behind a private company, US LLC, or property.',
      content:
        "# Resolve a Verified Company or LLC Owner\n\nIdentify the human principal behind a private operating business, holding LLC, or property address, filtering out corporate registered agents, law firms, and accounting firms.\n\n## Steps\n1. Call `dealport_find_owner` with `company_id` (from `dealport_search_companies` or `dealport_match_companies`), `llc_name` (plus optional `state` and `mailing_address`), or `property_address`.\n2. Optionally pass `person` when targeting a specific officer or owner named on `dealport_get_record`.\n3. Inspect `person`, `phones` (`mobile`, `direct`, `landline`, and `dnc`), `emails` (`work` or `personal` and `verified`), `profile`, and `sources`. Dealport charges `$0.09` only when a verified phone or email is returned (`$0.00` on a miss or 30-day repeat).\n\n## Output\nReturn the resolved human principal's name, role, verified phones and emails, LinkedIn profile URL, citing `sources`, `record_url`, and `cost_usd`.",
    },
    {
      name: 'screen-nyc-buildings-by-loan-maturity',
      description:
        'Search NYC multifamily and commercial buildings by ACRIS loan maturity and regulatory signals, then inspect cited Records.',
      content:
        "# Screen NYC Buildings by Loan Maturity and Signals\n\nFind NYC multifamily and mixed-use buildings with upcoming mortgage maturities or regulatory signals.\n\n## Steps\n1. Call `dealport_search_buildings` with `borough` (`MN`, `BK`, `QN`, `BX`, or `SI`), `min_units`, optional `loan_holder` (`bank`, `agency`, or `cmbs`), `loan_due_by`, and optional `signal` (`rent_stabilized`, `dob_penalties`, `housing_court`, `tax_lien`, `ll97`, `section8_expiring`, `tax_credit_ending`, or `failing_inspection`).\n2. Call `dealport_get_record` with each priority building's 10-digit `bbl` to inspect deed filings, mortgage details, and recorded entities.\n3. Call `dealport_find_owner` with the recorded `llc_name` or `property_address` when verified direct principal contact details are needed.\n\n## Output\nReturn each building's `bbl`, `address`, `residential_units`, `owner_of_record`, mortgage holder and due year, and `record_url`.",
    },
  ],
} as const satisfies BlockMeta
