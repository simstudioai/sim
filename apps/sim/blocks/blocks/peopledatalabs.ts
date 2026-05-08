import { PeopleDataLabsIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { PdlPersonEnrichResponse } from '@/tools/peopledatalabs/types'

export const PeopleDataLabsBlock: BlockConfig<PdlPersonEnrichResponse> = {
  type: 'peopledatalabs',
  name: 'People Data Labs',
  description: 'Enrich and search people and companies',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Enrich a single person or company with People Data Labs, or search the global person and company datasets with SQL or Elasticsearch DSL. Useful for sales enrichment, contact lookup, and CRM hygiene.',
  docsLink: 'https://docs.sim.ai/tools/peopledatalabs',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  tags: ['enrichment'],
  bgColor: '#4831C3',
  icon: PeopleDataLabsIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Person Enrich', id: 'pdl_person_enrich' },
        { label: 'Person Identify', id: 'pdl_person_identify' },
        { label: 'Person Search', id: 'pdl_person_search' },
        { label: 'Bulk Person Enrich', id: 'pdl_bulk_person_enrich' },
        { label: 'Company Enrich', id: 'pdl_company_enrich' },
        { label: 'Company Search', id: 'pdl_company_search' },
        { label: 'Bulk Company Enrich', id: 'pdl_bulk_company_enrich' },
        { label: 'Company Cleaner', id: 'pdl_clean_company' },
        { label: 'Location Cleaner', id: 'pdl_clean_location' },
        { label: 'School Cleaner', id: 'pdl_clean_school' },
        { label: 'Autocomplete', id: 'pdl_autocomplete' },
      ],
      value: () => 'pdl_person_enrich',
    },

    // Person Enrich fields
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'jane@example.com',
      condition: { field: 'operation', value: ['pdl_person_enrich', 'pdl_person_identify'] },
    },
    {
      id: 'profile',
      title: 'LinkedIn URL',
      type: 'short-input',
      placeholder: 'https://linkedin.com/in/janedoe',
      condition: { field: 'operation', value: ['pdl_person_enrich', 'pdl_person_identify'] },
    },
    {
      id: 'phone',
      title: 'Phone',
      type: 'short-input',
      placeholder: '+15551234567',
      condition: { field: 'operation', value: ['pdl_person_enrich', 'pdl_person_identify'] },
      mode: 'advanced',
    },
    {
      id: 'first_name',
      title: 'First Name',
      type: 'short-input',
      condition: { field: 'operation', value: ['pdl_person_enrich', 'pdl_person_identify'] },
      mode: 'advanced',
    },
    {
      id: 'last_name',
      title: 'Last Name',
      type: 'short-input',
      condition: { field: 'operation', value: ['pdl_person_enrich', 'pdl_person_identify'] },
      mode: 'advanced',
    },
    {
      id: 'company',
      title: 'Company',
      type: 'short-input',
      placeholder: 'Acme Inc or acme.com',
      condition: { field: 'operation', value: ['pdl_person_enrich', 'pdl_person_identify'] },
      mode: 'advanced',
    },
    {
      id: 'location',
      title: 'Location',
      type: 'short-input',
      placeholder: 'San Francisco, CA',
      condition: { field: 'operation', value: ['pdl_person_enrich', 'pdl_person_identify'] },
      mode: 'advanced',
    },
    {
      id: 'min_likelihood',
      title: 'Min Likelihood',
      type: 'short-input',
      placeholder: '6',
      condition: { field: 'operation', value: ['pdl_person_enrich', 'pdl_company_enrich'] },
      mode: 'advanced',
    },

    // Person Search fields
    {
      id: 'sql',
      title: 'SQL Query',
      type: 'long-input',
      placeholder:
        "SELECT * FROM person WHERE job_title='engineer' AND location_country='united states'",
      condition: { field: 'operation', value: ['pdl_person_search', 'pdl_company_search'] },
    },
    {
      id: 'query',
      title: 'Elasticsearch Query (JSON)',
      type: 'long-input',
      placeholder: '{"bool": {"must": [{"term": {"job_title": "engineer"}}]}}',
      condition: { field: 'operation', value: ['pdl_person_search', 'pdl_company_search'] },
      mode: 'advanced',
    },
    {
      id: 'size',
      title: 'Result Size',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: ['pdl_person_search', 'pdl_company_search'] },
      mode: 'advanced',
    },
    {
      id: 'scroll_token',
      title: 'Scroll Token',
      type: 'short-input',
      placeholder: 'Token from a prior response',
      condition: { field: 'operation', value: ['pdl_person_search', 'pdl_company_search'] },
      mode: 'advanced',
    },
    {
      id: 'dataset',
      title: 'Dataset',
      type: 'dropdown',
      options: [
        { label: 'all', id: 'all' },
        { label: 'resume', id: 'resume' },
        { label: 'email', id: 'email' },
        { label: 'phone', id: 'phone' },
        { label: 'mobile_phone', id: 'mobile_phone' },
        { label: 'street_address', id: 'street_address' },
        { label: 'consumer_social', id: 'consumer_social' },
        { label: 'developer', id: 'developer' },
      ],
      condition: { field: 'operation', value: 'pdl_person_search' },
      mode: 'advanced',
    },

    // Company Enrich fields
    {
      id: 'company_name',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Acme Inc',
      condition: { field: 'operation', value: ['pdl_company_enrich', 'pdl_clean_company'] },
    },
    {
      id: 'website',
      title: 'Website',
      type: 'short-input',
      placeholder: 'acme.com',
      condition: { field: 'operation', value: ['pdl_company_enrich', 'pdl_clean_company'] },
    },
    {
      id: 'company_profile',
      title: 'LinkedIn URL',
      type: 'short-input',
      placeholder: 'https://linkedin.com/company/acme',
      condition: { field: 'operation', value: ['pdl_company_enrich', 'pdl_clean_company'] },
      mode: 'advanced',
    },
    {
      id: 'ticker',
      title: 'Ticker',
      type: 'short-input',
      placeholder: 'AAPL',
      condition: { field: 'operation', value: 'pdl_company_enrich' },
      mode: 'advanced',
    },
    {
      id: 'pdl_id',
      title: 'PDL Company ID',
      type: 'short-input',
      condition: { field: 'operation', value: 'pdl_company_enrich' },
      mode: 'advanced',
    },
    {
      id: 'company_location',
      title: 'Location',
      type: 'short-input',
      placeholder: 'San Francisco, CA',
      condition: { field: 'operation', value: 'pdl_company_enrich' },
      mode: 'advanced',
    },

    // Autocomplete fields
    {
      id: 'field',
      title: 'Field',
      type: 'dropdown',
      options: [
        { label: 'title', id: 'title' },
        { label: 'skill', id: 'skill' },
        { label: 'company', id: 'company' },
        { label: 'industry', id: 'industry' },
        { label: 'location_name', id: 'location_name' },
        { label: 'all_location', id: 'all_location' },
        { label: 'country', id: 'country' },
        { label: 'region', id: 'region' },
        { label: 'school', id: 'school' },
        { label: 'major', id: 'major' },
        { label: 'class', id: 'class' },
        { label: 'role', id: 'role' },
        { label: 'sub_role', id: 'sub_role' },
        { label: 'website', id: 'website' },
      ],
      value: () => 'title',
      condition: { field: 'operation', value: 'pdl_autocomplete' },
      required: { field: 'operation', value: 'pdl_autocomplete' },
    },
    {
      id: 'text',
      title: 'Search Text',
      type: 'short-input',
      placeholder: 'engin',
      condition: { field: 'operation', value: 'pdl_autocomplete' },
      required: { field: 'operation', value: 'pdl_autocomplete' },
    },
    {
      id: 'autocomplete_size',
      title: 'Number of Suggestions',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'pdl_autocomplete' },
      mode: 'advanced',
    },

    // Person Identify-only fields
    {
      id: 'identify_locality',
      title: 'Locality (City)',
      type: 'short-input',
      placeholder: 'San Francisco',
      condition: { field: 'operation', value: 'pdl_person_identify' },
      mode: 'advanced',
    },
    {
      id: 'identify_region',
      title: 'Region (State)',
      type: 'short-input',
      placeholder: 'CA',
      condition: { field: 'operation', value: 'pdl_person_identify' },
      mode: 'advanced',
    },
    {
      id: 'identify_country',
      title: 'Country',
      type: 'short-input',
      placeholder: 'United States',
      condition: { field: 'operation', value: 'pdl_person_identify' },
      mode: 'advanced',
    },
    {
      id: 'identify_postal_code',
      title: 'Postal Code',
      type: 'short-input',
      condition: { field: 'operation', value: 'pdl_person_identify' },
      mode: 'advanced',
    },
    {
      id: 'identify_birth_date',
      title: 'Birth Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'pdl_person_identify' },
      mode: 'advanced',
    },
    {
      id: 'data_include',
      title: 'Data Include',
      type: 'short-input',
      placeholder: 'work_email,personal_emails,phone_numbers',
      condition: { field: 'operation', value: 'pdl_person_identify' },
      mode: 'advanced',
    },
    {
      id: 'include_if_matched',
      title: 'Include `matched_on`',
      type: 'switch',
      condition: { field: 'operation', value: 'pdl_person_identify' },
      mode: 'advanced',
    },

    // Bulk Person Enrich
    {
      id: 'bulk_person_requests',
      title: 'Requests (JSON Array)',
      type: 'long-input',
      placeholder:
        '[{ "params": { "profile": "https://linkedin.com/in/janedoe" } }, { "params": { "email": "john@example.com" } }]',
      condition: { field: 'operation', value: 'pdl_bulk_person_enrich' },
      required: { field: 'operation', value: 'pdl_bulk_person_enrich' },
    },
    {
      id: 'bulk_person_required',
      title: 'Required Fields',
      type: 'short-input',
      placeholder: 'emails AND job_title',
      condition: { field: 'operation', value: 'pdl_bulk_person_enrich' },
      mode: 'advanced',
    },

    // Bulk Company Enrich
    {
      id: 'bulk_company_requests',
      title: 'Requests (JSON Array)',
      type: 'long-input',
      placeholder: '[{ "params": { "website": "acme.com" } }, { "params": { "name": "Globex" } }]',
      condition: { field: 'operation', value: 'pdl_bulk_company_enrich' },
      required: { field: 'operation', value: 'pdl_bulk_company_enrich' },
    },
    {
      id: 'bulk_company_required',
      title: 'Required Fields',
      type: 'short-input',
      placeholder: 'name AND website',
      condition: { field: 'operation', value: 'pdl_bulk_company_enrich' },
      mode: 'advanced',
    },

    // Location Cleaner
    {
      id: 'clean_location_input',
      title: 'Location',
      type: 'short-input',
      placeholder: 'SF, CA',
      condition: { field: 'operation', value: 'pdl_clean_location' },
      required: { field: 'operation', value: 'pdl_clean_location' },
    },

    // School Cleaner
    {
      id: 'school_name',
      title: 'School Name',
      type: 'short-input',
      placeholder: 'Stanford University',
      condition: { field: 'operation', value: 'pdl_clean_school' },
    },
    {
      id: 'school_website',
      title: 'School Website',
      type: 'short-input',
      placeholder: 'stanford.edu',
      condition: { field: 'operation', value: 'pdl_clean_school' },
    },
    {
      id: 'school_profile',
      title: 'School LinkedIn URL',
      type: 'short-input',
      placeholder: 'https://linkedin.com/school/stanford-university',
      condition: { field: 'operation', value: 'pdl_clean_school' },
      mode: 'advanced',
    },

    // API Key
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your People Data Labs API key',
      password: true,
      required: true,
    },
  ],

  tools: {
    access: [
      'pdl_person_enrich',
      'pdl_person_identify',
      'pdl_person_search',
      'pdl_bulk_person_enrich',
      'pdl_company_enrich',
      'pdl_company_search',
      'pdl_bulk_company_enrich',
      'pdl_clean_company',
      'pdl_clean_location',
      'pdl_clean_school',
      'pdl_autocomplete',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'pdl_person_enrich':
          case 'pdl_person_identify':
          case 'pdl_person_search':
          case 'pdl_bulk_person_enrich':
          case 'pdl_company_enrich':
          case 'pdl_company_search':
          case 'pdl_bulk_company_enrich':
          case 'pdl_clean_company':
          case 'pdl_clean_location':
          case 'pdl_clean_school':
          case 'pdl_autocomplete':
            return params.operation
          default:
            return 'pdl_person_enrich'
        }
      },
      params: (params) => {
        const result: Record<string, unknown> = { ...params }
        const op = params.operation

        // Strip alternate-operation aliases so stale values from prior operations
        // can't leak into the current request.
        result.company_profile = undefined
        result.company_location = undefined
        result.autocomplete_size = undefined
        result.identify_locality = undefined
        result.identify_region = undefined
        result.identify_country = undefined
        result.identify_postal_code = undefined
        result.identify_birth_date = undefined
        result.bulk_person_requests = undefined
        result.bulk_person_required = undefined
        result.bulk_company_requests = undefined
        result.bulk_company_required = undefined
        result.clean_location_input = undefined
        result.school_name = undefined
        result.school_website = undefined
        result.school_profile = undefined

        // Clear shared target fields and repopulate them per-operation. The raw
        // `profile`/`location`/`website` subBlocks are scoped to specific
        // operations in the UI, but their values persist when the user switches
        // operations — without this reset, e.g. a person LinkedIn URL would
        // leak into a Company Enrich request as the company profile.
        result.profile = undefined
        result.location = undefined
        result.name = undefined
        result.website = undefined
        result.company_name = undefined

        if (op === 'pdl_person_enrich' || op === 'pdl_person_identify') {
          if (params.profile !== undefined) result.profile = params.profile
          if (params.location !== undefined) result.location = params.location
          if (params.name !== undefined) result.name = params.name
        }
        if (op === 'pdl_company_enrich') {
          if (params.company_name !== undefined) result.name = params.company_name
          else if (params.name !== undefined) result.name = params.name
          if (params.website !== undefined) result.website = params.website
          if (params.company_profile !== undefined) result.profile = params.company_profile
          else if (params.profile !== undefined) result.profile = params.profile
          if (params.company_location !== undefined) result.location = params.company_location
          else if (params.location !== undefined) result.location = params.location
        }
        if (op === 'pdl_clean_company') {
          if (params.company_name !== undefined) result.name = params.company_name
          else if (params.name !== undefined) result.name = params.name
          if (params.website !== undefined) result.website = params.website
          if (params.company_profile !== undefined) result.profile = params.company_profile
          else if (params.profile !== undefined) result.profile = params.profile
        }

        // `size` is shared by search and autocomplete subBlocks; reset and
        // repopulate per-operation so a stale search size can't bleed into an
        // autocomplete request (or vice versa) or into operations that don't
        // accept `size` at all.
        result.size = undefined
        if (op === 'pdl_autocomplete') {
          if (params.autocomplete_size !== undefined) {
            result.size = Number(params.autocomplete_size)
          }
        } else if (op === 'pdl_person_search' || op === 'pdl_company_search') {
          if (params.size !== undefined) result.size = Number(params.size)
        }

        // min_likelihood is only honored by enrich endpoints
        if (op === 'pdl_person_enrich' || op === 'pdl_company_enrich') {
          if (params.min_likelihood !== undefined) {
            result.min_likelihood = Number(params.min_likelihood)
          }
        } else {
          result.min_likelihood = undefined
        }

        if (op === 'pdl_person_identify') {
          if (params.identify_locality !== undefined) result.locality = params.identify_locality
          if (params.identify_region !== undefined) result.region = params.identify_region
          if (params.identify_country !== undefined) result.country = params.identify_country
          if (params.identify_postal_code !== undefined) {
            result.postal_code = params.identify_postal_code
          }
          if (params.identify_birth_date !== undefined) {
            result.birth_date = params.identify_birth_date
          }
        }

        if (op === 'pdl_bulk_person_enrich') {
          if (params.bulk_person_requests !== undefined) {
            result.requests = params.bulk_person_requests
          }
          if (params.bulk_person_required !== undefined) {
            result.required = params.bulk_person_required
          }
        } else if (op === 'pdl_bulk_company_enrich') {
          if (params.bulk_company_requests !== undefined) {
            result.requests = params.bulk_company_requests
          }
          if (params.bulk_company_required !== undefined) {
            result.required = params.bulk_company_required
          }
        }

        if (op === 'pdl_clean_location') {
          if (params.clean_location_input !== undefined) {
            result.location = params.clean_location_input
          } else if (params.location !== undefined) {
            result.location = params.location
          }
        }

        if (op === 'pdl_clean_school') {
          if (params.school_name !== undefined) result.name = params.school_name
          else if (params.name !== undefined) result.name = params.name
          if (params.school_website !== undefined) result.website = params.school_website
          else if (params.website !== undefined) result.website = params.website
          if (params.school_profile !== undefined) result.profile = params.school_profile
          else if (params.profile !== undefined) result.profile = params.profile
        }

        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'People Data Labs API key' },
    // Person enrich
    email: { type: 'string', description: 'Email address' },
    profile: { type: 'string', description: 'LinkedIn URL' },
    phone: { type: 'string', description: 'Phone number' },
    first_name: { type: 'string', description: 'First name' },
    last_name: { type: 'string', description: 'Last name' },
    company: { type: 'string', description: 'Company name or domain' },
    location: { type: 'string', description: 'Location' },
    min_likelihood: { type: 'number', description: 'Minimum match likelihood (1-10)' },
    // Search
    sql: { type: 'string', description: 'PDL SQL query' },
    query: { type: 'string', description: 'Elasticsearch DSL query as JSON string' },
    size: { type: 'number', description: 'Result size' },
    scroll_token: { type: 'string', description: 'Pagination token from a prior response' },
    dataset: { type: 'string', description: 'Person dataset filter' },
    // Company enrich
    name: { type: 'string', description: 'Company name' },
    website: { type: 'string', description: 'Company website' },
    ticker: { type: 'string', description: 'Stock ticker' },
    pdl_id: { type: 'string', description: 'PDL company ID' },
    // Autocomplete
    field: { type: 'string', description: 'Autocomplete field' },
    text: { type: 'string', description: 'Search text' },
    // Identify
    locality: { type: 'string', description: 'City (identify)' },
    region: { type: 'string', description: 'State/region (identify)' },
    country: { type: 'string', description: 'Country (identify)' },
    postal_code: { type: 'string', description: 'Postal code (identify)' },
    birth_date: { type: 'string', description: 'Birth date YYYY-MM-DD (identify)' },
    data_include: { type: 'string', description: 'Fields to include in identify match' },
    include_if_matched: { type: 'boolean', description: 'Include `matched_on` array per match' },
    // Bulk
    requests: { type: 'string', description: 'JSON array of bulk request objects' },
    required: { type: 'string', description: 'Required-fields expression for bulk' },
  },

  outputs: {
    matched: { type: 'boolean', description: 'Whether a record was matched (enrich/clean)' },
    likelihood: { type: 'number', description: 'Match likelihood (person enrich)' },
    person: { type: 'json', description: 'Matched person record' },
    company: { type: 'json', description: 'Matched company record' },
    location: { type: 'json', description: 'Cleaned location record' },
    school: { type: 'json', description: 'Cleaned school record' },
    matches: { type: 'json', description: 'Identify match candidates with scores' },
    total: { type: 'number', description: 'Total matches in dataset (search)' },
    scroll_token: { type: 'string', description: 'Pagination token to fetch the next page' },
    results: { type: 'json', description: 'Search or bulk result records' },
    suggestions: { type: 'json', description: 'Autocomplete suggestions' },
  },
}
