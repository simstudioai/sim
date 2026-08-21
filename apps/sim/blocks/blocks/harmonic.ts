import { HarmonicIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

const HARMONIC_OPERATIONS = [
  'harmonic_search_people_scout',
  'harmonic_enrich_person',
  'harmonic_get_person',
  'harmonic_batch_get_people',
  'harmonic_get_company_employees',
  'harmonic_list_people_saved_searches',
  'harmonic_get_people_saved_search_results',
  'harmonic_get_people_saved_search_net_new_results',
  'harmonic_clear_people_saved_search_net_new_results',
  'harmonic_submit_email_enrichment_job',
  'harmonic_get_email_enrichment_job',
  'harmonic_get_email_enrichment_usage',
  'harmonic_get_enrichment_status',
] as const

/** Operations that accept Harmonic's shared `size` + `cursor` pagination. */
const PAGED_OPERATIONS = [
  'harmonic_get_people_saved_search_results',
  'harmonic_get_people_saved_search_net_new_results',
  'harmonic_get_company_employees',
] as const

/** Operations addressed by a people saved-search ID or URN. */
const SAVED_SEARCH_OPERATIONS = [
  'harmonic_get_people_saved_search_results',
  'harmonic_get_people_saved_search_net_new_results',
  'harmonic_clear_people_saved_search_net_new_results',
] as const

/** Operations that take a list of person URNs. */
const PERSON_URN_OPERATIONS = [
  'harmonic_batch_get_people',
  'harmonic_clear_people_saved_search_net_new_results',
  'harmonic_submit_email_enrichment_job',
] as const

/** Operations returning the shared `contacts` collection. */
const CONTACT_OPERATIONS = [
  'harmonic_search_people_scout',
  'harmonic_get_people_saved_search_results',
  'harmonic_get_people_saved_search_net_new_results',
  'harmonic_batch_get_people',
] as const

/** Operations returning a single `contact`. */
const SINGLE_CONTACT_OPERATIONS = ['harmonic_enrich_person', 'harmonic_get_person'] as const

/** Operations returning `personUrns`. */
const PERSON_URN_OUTPUT_OPERATIONS = [
  'harmonic_get_people_saved_search_results',
  'harmonic_get_people_saved_search_net_new_results',
  'harmonic_get_company_employees',
] as const

type HarmonicOperation = (typeof HARMONIC_OPERATIONS)[number]

function isHarmonicOperation(value: unknown): value is HarmonicOperation {
  return (HARMONIC_OPERATIONS as readonly unknown[]).includes(value)
}

function optionalValue(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined
  return value
}

export const HarmonicBlock: BlockConfig = {
  type: 'harmonic',
  name: 'Harmonic',
  description: 'Search and enrich private-market contacts',
  longDescription:
    'Connect a reusable Harmonic team API key, use Scout to find people with natural-language criteria, select team-visible people saved searches, and hydrate person identifiers into normalized contacts for downstream tables, CRM, scoring, and outreach workflows.',
  docsLink: 'https://docs.sim.ai/integrations/harmonic',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#FFFFFF',
  icon: HarmonicIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'Harmonic',
    sentences: {
      byOperation: {
        harmonic_search_people_scout: [{ text: 'Search people for', field: 'query', core: true }],
        harmonic_enrich_person: [
          'Enrich person',
          { text: 'from', field: 'linkedinUrl' },
          { text: 'or', field: 'email' },
        ],
        harmonic_get_person: [{ text: 'Get person', field: 'personId', core: true }],
        harmonic_batch_get_people: [
          'Get people in batch',
          { text: 'by URNs', field: 'personUrns' },
          { text: 'or IDs', field: 'personIds' },
        ],
        harmonic_get_company_employees: [
          { text: 'List employees of', field: 'companyId', core: true },
        ],
        harmonic_list_people_saved_searches: ['List people saved searches'],
        harmonic_get_people_saved_search_results: [
          {
            text: 'Read contacts from saved search',
            field: ['savedSearchSelector', 'savedSearchIdManual'],
            core: true,
          },
        ],
        harmonic_get_people_saved_search_net_new_results: [
          {
            text: 'Read net-new contacts from saved search',
            field: ['savedSearchSelector', 'savedSearchIdManual'],
            core: true,
          },
        ],
        harmonic_clear_people_saved_search_net_new_results: [
          {
            text: 'Clear net-new results on saved search',
            field: ['savedSearchSelector', 'savedSearchIdManual'],
            core: true,
          },
        ],
        harmonic_submit_email_enrichment_job: [
          'Enrich emails',
          { text: 'for', field: 'personUrns' },
          { text: 'or', field: 'personLinkedinUrls' },
        ],
        harmonic_get_email_enrichment_job: [
          { text: 'Check email enrichment job', field: 'jobId', core: true },
        ],
        harmonic_get_email_enrichment_usage: ['Check email enrichment usage'],
        harmonic_get_enrichment_status: [
          { text: 'Check enrichment status for', field: 'enrichmentUrns', core: true },
        ],
      },
    },
  },

  subBlocks: [
    {
      id: 'credential',
      title: 'Harmonic Account',
      type: 'oauth-input',
      serviceId: 'harmonic',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      placeholder: 'Select Harmonic credential',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Harmonic Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search People with Scout', id: 'harmonic_search_people_scout' },
        { label: 'Enrich Person', id: 'harmonic_enrich_person' },
        { label: 'Get Person', id: 'harmonic_get_person' },
        { label: 'Batch Get People', id: 'harmonic_batch_get_people' },
        { label: 'Get Company Employees', id: 'harmonic_get_company_employees' },
        { label: 'List People Saved Searches', id: 'harmonic_list_people_saved_searches' },
        {
          label: 'Get People Saved Search Results',
          id: 'harmonic_get_people_saved_search_results',
        },
        {
          label: 'Get People Saved Search Net-New Results',
          id: 'harmonic_get_people_saved_search_net_new_results',
        },
        {
          label: 'Clear People Saved Search Net-New Results',
          id: 'harmonic_clear_people_saved_search_net_new_results',
        },
        { label: 'Submit Email Enrichment Job', id: 'harmonic_submit_email_enrichment_job' },
        { label: 'Get Email Enrichment Job', id: 'harmonic_get_email_enrichment_job' },
        { label: 'Get Email Enrichment Usage', id: 'harmonic_get_email_enrichment_usage' },
        { label: 'Get Enrichment Status', id: 'harmonic_get_enrichment_status' },
      ],
      value: () => 'harmonic_search_people_scout',
    },
    {
      id: 'query',
      title: 'Search Query',
      canvasNoun: 'a search query',
      type: 'long-input',
      rows: 4,
      placeholder: 'Find forward-deployed engineers at enterprise software companies',
      condition: { field: 'operation', value: 'harmonic_search_people_scout' },
      required: { field: 'operation', value: 'harmonic_search_people_scout' },
      paramVisibility: 'user-or-llm',
    },
    {
      id: 'linkedinUrl',
      title: 'LinkedIn Profile URL',
      canvasNoun: 'a LinkedIn profile',
      type: 'short-input',
      placeholder: 'https://www.linkedin.com/in/example',
      description: 'Enrich Person requires a LinkedIn profile URL or an email address',
      condition: { field: 'operation', value: 'harmonic_enrich_person' },
      paramVisibility: 'user-or-llm',
    },
    {
      id: 'email',
      title: 'Email',
      canvasNoun: 'an email address',
      type: 'short-input',
      placeholder: 'person@example.com',
      description: 'Used as a fallback when the LinkedIn URL is absent or does not match',
      condition: { field: 'operation', value: 'harmonic_enrich_person' },
      paramVisibility: 'user-or-llm',
    },
    {
      id: 'personId',
      title: 'Person ID or URN',
      canvasNoun: 'a person',
      type: 'short-input',
      placeholder: '22 or urn:harmonic:person:22',
      condition: { field: 'operation', value: 'harmonic_get_person' },
      required: { field: 'operation', value: 'harmonic_get_person' },
      paramVisibility: 'user-or-llm',
    },
    {
      id: 'companyContextUrns',
      title: 'Company Context URNs',
      type: 'code',
      language: 'json',
      placeholder: '["urn:harmonic:company:1"]',
      description: 'Scopes the returned experience context to these companies',
      condition: { field: 'operation', value: 'harmonic_get_person' },
      mode: 'advanced',
      paramVisibility: 'user-or-llm',
      wandConfig: {
        enabled: true,
        prompt:
          'Return ONLY a JSON array of Harmonic company URNs from the provided input. Preserve each URN exactly and omit duplicates.',
        generationType: 'json-array',
      },
    },
    {
      id: 'companyId',
      title: 'Company ID or URN',
      canvasNoun: 'a company',
      type: 'short-input',
      placeholder: '1 or urn:harmonic:company:1',
      condition: { field: 'operation', value: 'harmonic_get_company_employees' },
      required: { field: 'operation', value: 'harmonic_get_company_employees' },
      paramVisibility: 'user-or-llm',
    },
    {
      id: 'employeeGroupType',
      title: 'Employee Group',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'ALL' },
        { label: 'Founders', id: 'FOUNDERS' },
        { label: 'Founders and CEO', id: 'FOUNDERS_AND_CEO' },
        { label: 'CEO', id: 'CEO' },
        { label: 'Executives', id: 'EXECUTIVES' },
        { label: 'Leadership', id: 'LEADERSHIP' },
        { label: 'Non-leadership', id: 'NON_LEADERSHIP' },
        { label: 'Advisors', id: 'ADVISORS' },
        { label: 'Non-partners', id: 'NON_PARTNERS' },
      ],
      value: () => 'ALL',
      condition: { field: 'operation', value: 'harmonic_get_company_employees' },
      mode: 'advanced',
      paramVisibility: 'user-or-llm',
    },
    {
      id: 'employeeStatus',
      title: 'Employment Status',
      type: 'dropdown',
      options: [
        { label: 'Active', id: 'ACTIVE' },
        { label: 'Not active', id: 'NOT_ACTIVE' },
        { label: 'Active and not active', id: 'ACTIVE_AND_NOT_ACTIVE' },
      ],
      value: () => 'ACTIVE',
      condition: { field: 'operation', value: 'harmonic_get_company_employees' },
      mode: 'advanced',
      paramVisibility: 'user-or-llm',
    },
    {
      id: 'userConnectionStatus',
      title: 'Connection Status',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Connected to the team', id: 'TEAM_CONNECTION' },
        { label: 'Not connected', id: 'NO_CONNECTION' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'harmonic_get_company_employees' },
      mode: 'advanced',
      paramVisibility: 'user-or-llm',
    },
    {
      id: 'savedSearchSelector',
      title: 'Saved Search',
      canvasNoun: 'a saved search',
      type: 'project-selector',
      serviceId: 'harmonic',
      selectorKey: 'harmonic.savedSearches',
      canonicalParamId: 'savedSearchId',
      placeholder: 'Select a people saved search',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: [...SAVED_SEARCH_OPERATIONS] },
      required: { field: 'operation', value: [...SAVED_SEARCH_OPERATIONS] },
      paramVisibility: 'user-or-llm',
    },
    {
      id: 'savedSearchIdManual',
      title: 'Saved Search ID or URN',
      canvasNoun: 'a saved search',
      type: 'short-input',
      canonicalParamId: 'savedSearchId',
      placeholder: 'Saved search ID or urn:harmonic:saved_search:...',
      mode: 'advanced',
      condition: { field: 'operation', value: [...SAVED_SEARCH_OPERATIONS] },
      required: { field: 'operation', value: [...SAVED_SEARCH_OPERATIONS] },
      paramVisibility: 'user-or-llm',
    },
    {
      id: 'newResultsSince',
      title: 'New Results Since',
      type: 'short-input',
      placeholder: '2026-01-31 or 2026-01-31T00:00:00Z',
      description: 'Only return people matched after this UTC point',
      condition: {
        field: 'operation',
        value: 'harmonic_get_people_saved_search_net_new_results',
      },
      mode: 'advanced',
      paramVisibility: 'user-or-llm',
      wandConfig: {
        enabled: true,
        prompt:
          'Convert the described moment into a UTC timestamp formatted as YYYY-MM-DDTHH:00:00Z. Return ONLY the timestamp - no explanations, no extra text.',
        generationType: 'timestamp',
        placeholder: 'Describe the cutoff, e.g. "the start of last week"',
      },
    },
    {
      id: 'personUrns',
      title: 'Person URNs',
      type: 'code',
      language: 'json',
      placeholder: '["urn:harmonic:person:22", "urn:harmonic:person:1690"]',
      description:
        'Batch Get requires at least one Person URN or Person ID. Clear Net-New Results requires at least one URN unless Clear Scope is set to every net-new result',
      condition: { field: 'operation', value: [...PERSON_URN_OPERATIONS] },
      paramVisibility: 'user-or-llm',
      wandConfig: {
        enabled: true,
        prompt:
          'Return ONLY a JSON array of Harmonic person URNs from the provided input. Preserve each URN exactly and omit duplicates.',
        generationType: 'json-array',
      },
    },
    {
      id: 'clearScope',
      title: 'Clear Scope',
      type: 'dropdown',
      options: [
        { label: 'Only the person URNs below', id: 'selected' },
        { label: 'Every net-new result', id: 'all' },
      ],
      value: () => 'selected',
      description: 'Clearing every net-new result discards the whole backlog for this saved search',
      condition: {
        field: 'operation',
        value: 'harmonic_clear_people_saved_search_net_new_results',
      },
      paramVisibility: 'user-or-llm',
    },
    {
      id: 'personIds',
      title: 'Person IDs',
      type: 'code',
      language: 'json',
      placeholder: '[22, 1690]',
      description:
        'Numeric IDs for Batch Get People; IDs and URNs combined may contain 1-500 people',
      condition: { field: 'operation', value: 'harmonic_batch_get_people' },
      mode: 'advanced',
      paramVisibility: 'user-or-llm',
      wandConfig: {
        enabled: true,
        prompt:
          'Return ONLY a JSON array of numeric Harmonic person IDs from the provided input. Omit duplicates.',
        generationType: 'json-array',
      },
    },
    {
      id: 'personLinkedinUrls',
      title: 'LinkedIn Profile URLs',
      type: 'code',
      language: 'json',
      placeholder: '["https://www.linkedin.com/in/example"]',
      description:
        'Alternative to Person URNs for email enrichment; supply one list or the other, 1-5000 entries',
      condition: { field: 'operation', value: 'harmonic_submit_email_enrichment_job' },
      mode: 'advanced',
      paramVisibility: 'user-or-llm',
      wandConfig: {
        enabled: true,
        prompt:
          'Return ONLY a JSON array of LinkedIn profile URLs from the provided input. Omit duplicates.',
        generationType: 'json-array',
      },
    },
    {
      id: 'jobId',
      title: 'Job ID',
      canvasNoun: 'a job',
      type: 'short-input',
      placeholder: 'Job ID from Submit Email Enrichment Job',
      condition: { field: 'operation', value: 'harmonic_get_email_enrichment_job' },
      required: { field: 'operation', value: 'harmonic_get_email_enrichment_job' },
      paramVisibility: 'user-or-llm',
    },
    {
      id: 'enrichmentUrns',
      title: 'Enrichment URNs',
      type: 'code',
      language: 'json',
      placeholder: '["urn:harmonic:enrichment:1"]',
      description: 'Enrichment URNs returned by Enrich Person',
      condition: { field: 'operation', value: 'harmonic_get_enrichment_status' },
      required: { field: 'operation', value: 'harmonic_get_enrichment_status' },
      paramVisibility: 'user-or-llm',
      wandConfig: {
        enabled: true,
        prompt:
          'Return ONLY a JSON array of Harmonic enrichment URNs from the provided input. Preserve each URN exactly and omit duplicates.',
        generationType: 'json-array',
      },
    },
    {
      id: 'size',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '1-100',
      description: 'Number of records to return; defaults to 50 and Sim caps each page at 100',
      value: () => '50',
      condition: { field: 'operation', value: [...PAGED_OPERATIONS] },
      mode: 'advanced',
      paramVisibility: 'user-or-llm',
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Next cursor from a previous response',
      condition: { field: 'operation', value: [...PAGED_OPERATIONS] },
      mode: 'advanced',
      paramVisibility: 'user-or-llm',
    },
  ],

  tools: {
    access: [
      'harmonic_search_people_scout',
      'harmonic_enrich_person',
      'harmonic_get_person',
      'harmonic_batch_get_people',
      'harmonic_get_company_employees',
      'harmonic_list_people_saved_searches',
      'harmonic_get_people_saved_search_results',
      'harmonic_get_people_saved_search_net_new_results',
      'harmonic_clear_people_saved_search_net_new_results',
      'harmonic_submit_email_enrichment_job',
      'harmonic_get_email_enrichment_job',
      'harmonic_get_email_enrichment_usage',
      'harmonic_get_enrichment_status',
    ],
    config: {
      tool: (params) => {
        if (!isHarmonicOperation(params.operation)) {
          throw new Error(`Invalid Harmonic operation: ${String(params.operation)}`)
        }
        return params.operation
      },
      /**
       * The generic executor merges raw subblock state under this object. Every
       * operation-specific key is therefore assigned explicitly; `undefined`
       * is what removes a stale value after the operation changes.
       */
      params: (params) => {
        const operation = String(params.operation ?? '')
        const isPaged = (PAGED_OPERATIONS as readonly string[]).includes(operation)
        const usesSavedSearch = (SAVED_SEARCH_OPERATIONS as readonly string[]).includes(operation)
        const usesPersonUrns = (PERSON_URN_OPERATIONS as readonly string[]).includes(operation)
        const isEmployees = operation === 'harmonic_get_company_employees'

        return {
          operation: undefined,
          apiKey: undefined,
          credential: undefined,
          manualCredential: undefined,
          savedSearchSelector: undefined,
          savedSearchIdManual: undefined,
          oauthCredential: params.oauthCredential,
          query: operation === 'harmonic_search_people_scout' ? params.query : undefined,
          linkedinUrl: operation === 'harmonic_enrich_person' ? params.linkedinUrl : undefined,
          email: operation === 'harmonic_enrich_person' ? params.email : undefined,
          personId: operation === 'harmonic_get_person' ? params.personId : undefined,
          companyContextUrns:
            operation === 'harmonic_get_person'
              ? optionalValue(params.companyContextUrns)
              : undefined,
          companyId: isEmployees ? params.companyId : undefined,
          employeeGroupType: isEmployees ? optionalValue(params.employeeGroupType) : undefined,
          employeeStatus: isEmployees ? optionalValue(params.employeeStatus) : undefined,
          userConnectionStatus: isEmployees
            ? optionalValue(params.userConnectionStatus)
            : undefined,
          savedSearchId: usesSavedSearch ? params.savedSearchId : undefined,
          newResultsSince:
            operation === 'harmonic_get_people_saved_search_net_new_results'
              ? optionalValue(params.newResultsSince)
              : undefined,
          size: isPaged ? optionalValue(params.size) : undefined,
          cursor: isPaged ? optionalValue(params.cursor) : undefined,
          personIds:
            operation === 'harmonic_batch_get_people' ? optionalValue(params.personIds) : undefined,
          personUrns: usesPersonUrns ? optionalValue(params.personUrns) : undefined,
          clearScope:
            operation === 'harmonic_clear_people_saved_search_net_new_results'
              ? (optionalValue(params.clearScope) ?? 'selected')
              : undefined,
          personLinkedinUrls:
            operation === 'harmonic_submit_email_enrichment_job'
              ? optionalValue(params.personLinkedinUrls)
              : undefined,
          jobId: operation === 'harmonic_get_email_enrichment_job' ? params.jobId : undefined,
          enrichmentUrns:
            operation === 'harmonic_get_enrichment_status'
              ? optionalValue(params.enrichmentUrns)
              : undefined,
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Harmonic operation to perform' },
    oauthCredential: {
      type: 'string',
      description: 'Reusable Harmonic team API-key credential',
    },
    query: { type: 'string', description: 'Natural-language Harmonic Scout people query' },
    linkedinUrl: { type: 'string', description: 'LinkedIn profile URL to enrich' },
    email: { type: 'string', description: 'Email address used as an enrichment fallback' },
    personId: { type: 'string', description: 'Harmonic person ID or full person URN' },
    companyContextUrns: {
      type: 'array',
      description: 'Company URNs scoping the returned experience context',
    },
    companyId: { type: 'string', description: 'Harmonic company ID or full company URN' },
    employeeGroupType: { type: 'string', description: 'Employee role group filter' },
    employeeStatus: { type: 'string', description: 'Employment status filter' },
    userConnectionStatus: { type: 'string', description: 'Team or user connection filter' },
    savedSearchId: { type: 'string', description: 'People saved-search ID or full URN' },
    newResultsSince: {
      type: 'string',
      description: 'UTC cutoff for net-new saved-search matches',
    },
    personIds: { type: 'array', description: 'Numeric Harmonic person IDs to retrieve' },
    personUrns: { type: 'array', description: 'Harmonic person URNs to retrieve or acknowledge' },
    personLinkedinUrls: {
      type: 'array',
      description: 'LinkedIn profile URLs to submit for email enrichment',
    },
    clearScope: {
      type: 'string',
      description: 'Whether to clear only the listed person URNs or every net-new result',
    },
    jobId: { type: 'string', description: 'Harmonic email enrichment job ID' },
    enrichmentUrns: { type: 'array', description: 'Harmonic enrichment URNs to check' },
    size: { type: 'number', description: 'Page size, clamped to 1-100' },
    cursor: { type: 'string', description: 'Opaque pagination cursor' },
  },

  outputs: {
    contacts: {
      type: 'array',
      description:
        'Normalized contacts with personUrn, personId, fullName, firstName, lastName, headline, currentTitles, currentCompanyNames, currentCompanyUrns, primaryEmail, emails, phoneNumbers, linkedinUrl, formattedLocation, city, state, country, profilePictureUrl, summary, and isRedacted; unavailable array fields are null',
      condition: { field: 'operation', value: [...CONTACT_OPERATIONS] },
    },
    contact: {
      type: 'json',
      description:
        'A single normalized contact with the same fields as contacts, or null when Harmonic has no such person',
      condition: { field: 'operation', value: [...SINGLE_CONTACT_OPERATIONS] },
    },
    found: {
      type: 'boolean',
      description: 'Whether Harmonic returned a person profile',
      condition: { field: 'operation', value: [...SINGLE_CONTACT_OPERATIONS] },
    },
    enrichmentUrn: {
      type: 'string',
      description: 'Enrichment URN to poll with Get Enrichment Status',
      condition: { field: 'operation', value: 'harmonic_enrich_person' },
    },
    mergedPersonUrn: {
      type: 'string',
      description: 'URN this person was merged into, when Harmonic deduplicated the record',
      condition: { field: 'operation', value: 'harmonic_enrich_person' },
    },
    requestedEntityUrn: {
      type: 'string',
      description: 'Person URN Harmonic matched the request to',
      condition: { field: 'operation', value: 'harmonic_enrich_person' },
    },
    enrichmentQueued: {
      type: 'boolean',
      description: 'Whether Harmonic queued a background refresh for this person',
      condition: { field: 'operation', value: 'harmonic_enrich_person' },
    },
    taskId: {
      type: 'string',
      description: 'Harmonic Scout task identifier',
      condition: { field: 'operation', value: 'harmonic_search_people_scout' },
    },
    status: {
      type: 'string',
      description: 'Terminal Harmonic Scout task status, or an email enrichment job status',
      condition: {
        field: 'operation',
        value: [
          'harmonic_search_people_scout',
          'harmonic_submit_email_enrichment_job',
          'harmonic_get_email_enrichment_job',
        ],
      },
    },
    count: {
      type: 'number',
      description: 'Number of contacts, saved searches, or enrichment statuses returned',
      condition: {
        field: 'operation',
        value: [
          'harmonic_search_people_scout',
          'harmonic_list_people_saved_searches',
          'harmonic_batch_get_people',
          'harmonic_get_enrichment_status',
        ],
      },
    },
    savedSearches: {
      type: 'array',
      description:
        'People saved searches with savedSearchId, savedSearchUrn, name, isPrivate, savedSearchType, userSavedSearchType, creatorUrn, createdAt, and updatedAt',
      condition: { field: 'operation', value: 'harmonic_list_people_saved_searches' },
    },
    personUrns: {
      type: 'array',
      description: 'Harmonic person URNs returned by the saved search or company employee list',
      condition: { field: 'operation', value: [...PERSON_URN_OUTPUT_OPERATIONS] },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of matching results',
      condition: {
        field: 'operation',
        value: ['harmonic_get_people_saved_search_results', 'harmonic_get_company_employees'],
      },
    },
    pageInfo: {
      type: 'json',
      description: 'Pagination metadata with currentCursor, nextCursor, and hasNext',
      condition: { field: 'operation', value: [...PAGED_OPERATIONS] },
    },
    cursor: {
      type: 'string',
      description: 'Cursor echoed by the net-new results endpoint',
      condition: {
        field: 'operation',
        value: 'harmonic_get_people_saved_search_net_new_results',
      },
    },
    cleared: {
      type: 'boolean',
      description: 'Whether Harmonic accepted the net-new acknowledgement',
      condition: {
        field: 'operation',
        value: 'harmonic_clear_people_saved_search_net_new_results',
      },
    },
    clearedPersonUrns: {
      type: 'array',
      description: 'Person URNs acknowledged, or null when every net-new result was cleared',
      condition: {
        field: 'operation',
        value: 'harmonic_clear_people_saved_search_net_new_results',
      },
    },
    jobId: {
      type: 'string',
      description: 'Harmonic email enrichment job identifier',
      condition: {
        field: 'operation',
        value: ['harmonic_submit_email_enrichment_job', 'harmonic_get_email_enrichment_job'],
      },
    },
    acceptedCount: {
      type: 'number',
      description: 'People accepted into the email enrichment job',
      condition: { field: 'operation', value: 'harmonic_submit_email_enrichment_job' },
    },
    dropped: {
      type: 'array',
      description: 'Dropped identifiers with submittedIdentifier and reason',
      condition: { field: 'operation', value: 'harmonic_submit_email_enrichment_job' },
    },
    createdAt: {
      type: 'string',
      description: 'Email enrichment job creation timestamp',
      condition: {
        field: 'operation',
        value: ['harmonic_submit_email_enrichment_job', 'harmonic_get_email_enrichment_job'],
      },
    },
    completedAt: {
      type: 'string',
      description: 'Email enrichment job completion timestamp',
      condition: { field: 'operation', value: 'harmonic_get_email_enrichment_job' },
    },
    isTerminal: {
      type: 'boolean',
      description: 'Whether the email enrichment job finished',
      condition: { field: 'operation', value: 'harmonic_get_email_enrichment_job' },
    },
    counts: {
      type: 'json',
      description:
        'Email enrichment tallies with totalProcessed, totalSucceeded, totalFailed, totalSkipped, and totalNotFound',
      condition: { field: 'operation', value: 'harmonic_get_email_enrichment_job' },
    },
    results: {
      type: 'array',
      description: 'Per-person email enrichment outcomes with personUrn and status',
      condition: { field: 'operation', value: 'harmonic_get_email_enrichment_job' },
    },
    succeededPersonUrns: {
      type: 'array',
      description: 'Person URNs whose email was found; pass these to Batch Get People',
      condition: { field: 'operation', value: 'harmonic_get_email_enrichment_job' },
    },
    monthlyUsage: {
      type: 'number',
      description: 'Emails enriched so far this month',
      condition: { field: 'operation', value: 'harmonic_get_email_enrichment_usage' },
    },
    monthlyLimit: {
      type: 'number',
      description: 'Monthly email enrichment allowance',
      condition: { field: 'operation', value: 'harmonic_get_email_enrichment_usage' },
    },
    monthlyRemaining: {
      type: 'number',
      description: 'Enrichments left this month',
      condition: {
        field: 'operation',
        value: ['harmonic_submit_email_enrichment_job', 'harmonic_get_email_enrichment_usage'],
      },
    },
    enrichments: {
      type: 'array',
      description: 'Enrichment statuses with enrichmentUrn, status, message, and enrichedEntityUrn',
      condition: { field: 'operation', value: 'harmonic_get_enrichment_status' },
    },
  },
}

export const HarmonicBlockMeta = {
  tags: ['enrichment', 'automation', 'agentic'],
  url: 'https://harmonic.ai',
  skills: [
    {
      name: 'search-people-with-scout',
      description:
        'Turn natural-language sourcing criteria into a normalized contact table with Harmonic Scout.',
      content:
        '# Search People with Scout\n\nUse Harmonic Scout when the request describes the people to find rather than supplying identifiers.\n\n## Steps\n1. Translate the request into a precise query that states role, company profile, geography, and any exclusions.\n2. Run Search People with Scout once; do not retry a timed-out task automatically.\n3. Review the returned contacts and keep the structured fields needed downstream.\n4. Preserve personUrn whenever Harmonic supplies it so Batch Get People can hydrate the record later.\n\n## Output\nReturn a contact table and the Scout task ID and status. Call out missing email or LinkedIn values instead of guessing them.',
    },
    {
      name: 'export-people-saved-search',
      description:
        'Resolve a team-visible people saved search and page its contacts into a downstream dataset.',
      content:
        '# Export People Saved Search\n\nRead a Harmonic people saved search into a workflow.\n\n## Steps\n1. Run List People Saved Searches and match the requested name to one search.\n2. Run Get People Saved Search Results with that ID or URN.\n3. Follow pageInfo.nextCursor while pageInfo.hasNext is true, using a page size no greater than 100.\n4. Deduplicate rows by personUrn and retain any URN-only results for hydration.\n\n## Output\nReturn the saved-search identity, total count, normalized contacts, unresolved person URNs, and whether pagination completed.',
    },
    {
      name: 'hydrate-person-urns',
      description:
        'Expand Harmonic person IDs or URNs into consistent contact records for scoring and routing.',
      content:
        '# Hydrate Person URNs\n\nUse Batch Get People when an upstream Harmonic result contains identifiers without complete contact fields.\n\n## Steps\n1. Collect the person IDs and URNs from the upstream rows.\n2. Deduplicate identifiers and split requests so each batch contains at most 500 identifiers.\n3. Run Batch Get People for each batch.\n4. Join normalized contacts back to the source rows by personUrn, falling back to personId only when necessary.\n\n## Output\nReturn the hydrated contacts and list any input identifiers that produced no contact.',
    },
    {
      name: 'rank-scout-shortlist',
      description:
        'Score Harmonic Scout contacts against explicit sourcing criteria and produce a review-ready shortlist.',
      content:
        '# Rank Scout Shortlist\n\nTurn a broad people search into a transparent shortlist.\n\n## Steps\n1. Run Search People with Scout using the requested role, company, industry, geography, and exclusion criteria.\n2. Score each normalized contact only on fields present in the result, such as title, company, location, and summary.\n3. Keep personUrn on every scored row and separate missing evidence from a negative match.\n4. Sort the qualifying contacts by score and retain the rejected rows with their reasons.\n\n## Output\nReturn a ranked contact table with score, evidence, and rejection reason. Do not infer missing contact attributes.',
    },
    {
      name: 'monitor-saved-search-snapshot',
      description:
        'Compare a team-visible people saved search with a stored snapshot to identify newly seen contacts.',
      content:
        '# Monitor Saved Search Snapshot\n\nDetect changes in a Harmonic people saved search without relying on provider triggers.\n\n## Steps\n1. Run List People Saved Searches and resolve the requested team-visible search.\n2. Page Get People Saved Search Results until pageInfo.hasNext is false.\n3. Deduplicate by personUrn and compare the complete set with the previously stored snapshot.\n4. Store the new snapshot only after every page succeeds.\n\n## Output\nReturn newly seen and no-longer-seen person URNs, the current total, and whether the pagination run completed.',
    },
    {
      name: 'audit-contact-coverage',
      description:
        'Audit a Harmonic people cohort for missing email, LinkedIn, company, and role data before outreach.',
      content:
        '# Audit Contact Coverage\n\nCheck whether a saved-search cohort is ready for scoring or outreach.\n\n## Steps\n1. Resolve the search with List People Saved Searches and page Get People Saved Search Results.\n2. Send any URN-only results through Batch Get People in batches of at most 500.\n3. Deduplicate by personUrn and flag contacts missing email, LinkedIn URL, current company, or current title.\n4. Calculate coverage rates per field without filling missing values from assumptions.\n\n## Output\nReturn the normalized contact table, field coverage rates, duplicate count, and rows requiring manual review.',
    },
    {
      name: 'enrich-known-identifiers',
      description:
        'Turn LinkedIn URLs or email addresses a workflow already holds into Harmonic contacts.',
      content:
        '# Enrich Known Identifiers\n\nUse Enrich Person when the workflow already has an identifier rather than a description of who to find.\n\n## Steps\n1. Prefer the LinkedIn profile URL; supply the email only as a fallback identifier.\n2. Run Enrich Person once per identifier and keep personUrn from every match.\n3. A person Harmonic does not have yet fails the block rather than returning a row: the error names the enrichment that was scheduled and carries its URN. Handle that error instead of treating it as a match, and poll Get Enrichment Status with the URN until it is COMPLETE or FAILED.\n4. Read the resulting person with Get Person or Batch Get People once enrichment completes.\n\n## Output\nReturn the hydrated contacts, the identifiers still pending enrichment, and the identifiers Harmonic could not resolve. Do not invent contact fields for unresolved rows.',
    },
    {
      name: 'source-company-employees',
      description:
        'Build an account-based contact list from a company by role group and employment status.',
      content:
        '# Source Company Employees\n\nUse Get Company Employees when the request names an account rather than a person.\n\n## Steps\n1. Resolve the company ID or URN, then run Get Company Employees with the requested role group, such as FOUNDERS or EXECUTIVES.\n2. Follow pageInfo.nextCursor while pageInfo.hasNext is true, using a page size no greater than 100.\n3. Harmonic returns person URNs only, so hydrate them with Batch Get People in batches of at most 500.\n4. Deduplicate by personUrn before scoring or outreach.\n\n## Output\nReturn the company, the role group used, the hydrated contacts, and the total employee count Harmonic reported.',
    },
    {
      name: 'monitor-saved-search-net-new',
      description:
        'Poll only the newly matching people on a subscribed saved search and acknowledge them.',
      content:
        '# Monitor Saved Search Net-New\n\nUse the net-new feed instead of re-reading a whole saved search on every run.\n\n## Steps\n1. Confirm the saved search is subscribed in the Harmonic console; net-new results are unavailable otherwise and there is no API to subscribe.\n2. Run Get People Saved Search Net-New Results, optionally bounding the window with newResultsSince.\n3. Page with pageInfo.nextCursor until pageInfo.hasNext is false, collecting contacts and URN-only rows.\n4. Only after every page and every downstream write succeeds, run Clear People Saved Search Net-New Results for the person URNs you processed.\n\n## Output\nReturn the newly matching contacts, the URNs acknowledged, and whether the run completed before anything was cleared.',
    },
    {
      name: 'enrich-contact-emails',
      description:
        'Run Harmonic bulk email enrichment and read the resolved addresses back onto contacts.',
      content:
        '# Enrich Contact Emails\n\nUse bulk email enrichment when a cohort lacks addresses.\n\n## Steps\n1. Run Get Email Enrichment Usage and stop if monthlyRemaining is below the batch size.\n2. Submit person URNs or LinkedIn URLs, never both in one job, at most 5000 per job.\n3. Record the dropped identifiers and their reasons; RECENTLY_ATTEMPTED and ALREADY_HAS_EMAIL are not failures.\n4. Poll Get Email Enrichment Job until isTerminal is true, then pass succeededPersonUrns to Batch Get People, because the job rows never contain the address itself.\n\n## Output\nReturn the hydrated contacts with their emails, the per-status counts, the dropped identifiers, and the remaining monthly quota.',
    },
  ],
  templates: [
    {
      icon: HarmonicIcon,
      title: 'Harmonic contact finder',
      prompt:
        'Build a chat-driven workflow that turns a sourcing request such as "find FDEs in enterprise software" into a Harmonic Scout search and writes the normalized contacts to a table for review.',
      modules: ['agent', 'tables', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
      featured: true,
    },
    {
      icon: HarmonicIcon,
      title: 'Harmonic saved search sync',
      prompt:
        'Create a scheduled workflow that resolves a team-visible Harmonic people saved search, pages every result, compares person URNs with the prior table snapshot, and posts newly seen contacts to Slack.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'sales',
      tags: ['sales', 'monitoring', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: HarmonicIcon,
      title: 'Harmonic contact hydrator',
      prompt:
        'Build a workflow that accepts Harmonic person URNs from an earlier search, batches them in groups of 500, retrieves normalized contact records, and writes names, roles, companies, emails, and LinkedIn URLs to a table.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['data', 'enrichment', 'automation'],
    },
    {
      icon: HarmonicIcon,
      title: 'Harmonic sourcing shortlist',
      prompt:
        'Create an agent that searches Harmonic Scout for a sourcing thesis, scores the normalized contacts against explicit role, company, and location criteria, and writes the ranked shortlist with evidence to a review table.',
      modules: ['agent', 'tables', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'automation'],
    },
    {
      icon: HarmonicIcon,
      title: 'Harmonic CRM prospect route',
      prompt:
        'Build a workflow that searches Harmonic Scout for technical buyers at target accounts, filters contacts with a usable email or LinkedIn URL, deduplicates them by person URN, and writes qualified prospects to Salesforce.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'enrichment'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: HarmonicIcon,
      title: 'Harmonic contact coverage audit',
      prompt:
        'Create a workflow that resolves a team-visible Harmonic people saved search, pages all results, hydrates URN-only records in batches, flags duplicates and missing contact fields, and writes the review queue to Google Sheets.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['data', 'quality', 'automation'],
      alsoIntegrations: ['google_sheets'],
    },
    {
      icon: HarmonicIcon,
      title: 'Harmonic talent scout',
      prompt:
        'Build an agent that uses Harmonic Scout to find candidates with a requested title, industry background, and geography, ranks the normalized contacts, and sends the shortlist to a Slack hiring channel.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hiring', 'research', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: HarmonicIcon,
      title: 'Harmonic batch enrichment',
      prompt:
        'Create a workflow that accepts Harmonic person IDs and URNs from a table, deduplicates and splits them into batches of at most 500, retrieves normalized contacts with Batch Get People, and writes hydrated and unmatched rows separately.',
      modules: ['tables', 'workflows'],
      category: 'sales',
      tags: ['sales', 'data', 'automation'],
    },
  ],
} as const satisfies BlockMeta
