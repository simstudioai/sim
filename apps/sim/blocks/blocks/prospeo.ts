import { ProspeoIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, IntegrationType } from '@/blocks/types'
import type { ProspeoResponse } from '@/tools/prospeo/types'

export const ProspeoBlock: BlockConfig<ProspeoResponse> = {
  type: 'prospeo',
  name: 'Prospeo',
  description: 'Enrich and search B2B contacts and companies',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Find verified work emails and mobile numbers, enrich person and company profiles, and search a B2B database of leads and companies using 20+ filters.',
  docsLink: 'https://docs.sim.ai/tools/prospeo',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  tags: ['enrichment', 'sales-engagement'],
  bgColor: '#FF1A26',
  icon: ProspeoIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Enrich Person', id: 'prospeo_enrich_person' },
        { label: 'Enrich Company', id: 'prospeo_enrich_company' },
        { label: 'Bulk Enrich Person', id: 'prospeo_bulk_enrich_person' },
        { label: 'Bulk Enrich Company', id: 'prospeo_bulk_enrich_company' },
        { label: 'Search Person', id: 'prospeo_search_person' },
        { label: 'Search Company', id: 'prospeo_search_company' },
        { label: 'Search Suggestions', id: 'prospeo_search_suggestions' },
        { label: 'Account Information', id: 'prospeo_account_information' },
      ],
      value: () => 'prospeo_enrich_person',
    },

    // Enrich Person
    {
      id: 'first_name',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'e.g., Eva',
      condition: { field: 'operation', value: 'prospeo_enrich_person' },
    },
    {
      id: 'last_name',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'e.g., Kiegler',
      condition: { field: 'operation', value: 'prospeo_enrich_person' },
    },
    {
      id: 'full_name',
      title: 'Full Name',
      type: 'short-input',
      placeholder: 'e.g., Eva Kiegler (alternative to first/last name)',
      condition: { field: 'operation', value: 'prospeo_enrich_person' },
    },
    {
      id: 'linkedin_url',
      title: 'LinkedIn URL',
      type: 'short-input',
      placeholder: 'https://www.linkedin.com/in/eva-kiegler',
      condition: { field: 'operation', value: 'prospeo_enrich_person' },
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'eva@intercom.com',
      condition: { field: 'operation', value: 'prospeo_enrich_person' },
    },
    {
      id: 'company_name',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Intercom',
      condition: { field: 'operation', value: 'prospeo_enrich_person' },
    },
    {
      id: 'company_website',
      title: 'Company Website',
      type: 'short-input',
      placeholder: 'intercom.com',
      condition: { field: 'operation', value: 'prospeo_enrich_person' },
    },
    {
      id: 'company_linkedin_url',
      title: 'Company LinkedIn URL',
      type: 'short-input',
      placeholder: 'https://www.linkedin.com/company/intercom',
      condition: { field: 'operation', value: 'prospeo_enrich_person' },
      mode: 'advanced',
    },
    {
      id: 'person_id',
      title: 'Person ID',
      type: 'short-input',
      placeholder: 'Prospeo person_id from a previous Search Person',
      condition: { field: 'operation', value: 'prospeo_enrich_person' },
      mode: 'advanced',
    },
    {
      id: 'only_verified_email',
      title: 'Only Verified Email',
      type: 'switch',
      condition: { field: 'operation', value: 'prospeo_enrich_person' },
      mode: 'advanced',
    },
    {
      id: 'enrich_mobile',
      title: 'Enrich Mobile',
      type: 'switch',
      condition: { field: 'operation', value: 'prospeo_enrich_person' },
      mode: 'advanced',
    },
    {
      id: 'only_verified_mobile',
      title: 'Only Verified Mobile',
      type: 'switch',
      condition: { field: 'operation', value: 'prospeo_enrich_person' },
      mode: 'advanced',
    },

    // Enrich Company
    {
      id: 'company_website',
      title: 'Company Website',
      type: 'short-input',
      placeholder: 'intercom.com',
      condition: { field: 'operation', value: 'prospeo_enrich_company' },
    },
    {
      id: 'company_linkedin_url',
      title: 'Company LinkedIn URL',
      type: 'short-input',
      placeholder: 'https://www.linkedin.com/company/intercom',
      condition: { field: 'operation', value: 'prospeo_enrich_company' },
    },
    {
      id: 'company_name',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Intercom',
      condition: { field: 'operation', value: 'prospeo_enrich_company' },
      mode: 'advanced',
    },
    {
      id: 'company_id',
      title: 'Company ID',
      type: 'short-input',
      placeholder: 'Prospeo company_id from a previous enrichment',
      condition: { field: 'operation', value: 'prospeo_enrich_company' },
      mode: 'advanced',
    },

    // Bulk Enrich Person
    {
      id: 'data',
      title: 'Records',
      type: 'code',
      language: 'json',
      required: { field: 'operation', value: 'prospeo_bulk_enrich_person' },
      placeholder:
        '[{"identifier":"1","linkedin_url":"https://www.linkedin.com/in/eva-kiegler"},{"identifier":"2","full_name":"Jane Doe","company_website":"acme.com"}]',
      condition: { field: 'operation', value: 'prospeo_bulk_enrich_person' },
      wandConfig: {
        enabled: true,
        prompt:
          'Build a JSON array of up to 50 person records to enrich via Prospeo. Each item must include an "identifier" plus one valid match key set: linkedin_url, email, person_id, or (first_name + last_name + company_*), or (full_name + company_*). Return ONLY the JSON array.',
        generationType: 'json-object',
      },
    },
    {
      id: 'only_verified_email',
      title: 'Only Verified Email',
      type: 'switch',
      condition: { field: 'operation', value: 'prospeo_bulk_enrich_person' },
      mode: 'advanced',
    },
    {
      id: 'enrich_mobile',
      title: 'Enrich Mobile',
      type: 'switch',
      condition: { field: 'operation', value: 'prospeo_bulk_enrich_person' },
      mode: 'advanced',
    },
    {
      id: 'only_verified_mobile',
      title: 'Only Verified Mobile',
      type: 'switch',
      condition: { field: 'operation', value: 'prospeo_bulk_enrich_person' },
      mode: 'advanced',
    },

    // Bulk Enrich Company
    {
      id: 'data',
      title: 'Records',
      type: 'code',
      language: 'json',
      required: { field: 'operation', value: 'prospeo_bulk_enrich_company' },
      placeholder:
        '[{"identifier":"1","company_website":"intercom.com"},{"identifier":"2","company_linkedin_url":"https://www.linkedin.com/company/deloitte"}]',
      condition: { field: 'operation', value: 'prospeo_bulk_enrich_company' },
      wandConfig: {
        enabled: true,
        prompt:
          'Build a JSON array of up to 50 company records to enrich via Prospeo. Each item must include an "identifier" plus one of: company_website, company_linkedin_url, company_name, or company_id. Return ONLY the JSON array.',
        generationType: 'json-object',
      },
    },

    // Search Person
    {
      id: 'filters',
      title: 'Filters',
      type: 'code',
      language: 'json',
      required: { field: 'operation', value: 'prospeo_search_person' },
      placeholder:
        '{"person_seniority":{"include":["Founder/Owner"]},"company_industry":{"exclude":["Semiconductors"]}}',
      condition: { field: 'operation', value: 'prospeo_search_person' },
      wandConfig: {
        enabled: true,
        prompt:
          'Build a Prospeo Search Person filters JSON object based on the user description. Use the documented filters (person_seniority, person_departments, person_year_of_experience, person_location, person_job_title, company_industry, company_headcount_range, company_funding, company_technology, etc.) with include/exclude or min/max keys as appropriate. Do not use only exclude filters. Return ONLY the JSON object for the filters value.',
        generationType: 'json-object',
      },
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'prospeo_search_person' },
      mode: 'advanced',
    },

    // Search Company
    {
      id: 'filters',
      title: 'Filters',
      type: 'code',
      language: 'json',
      required: { field: 'operation', value: 'prospeo_search_company' },
      placeholder:
        '{"company_funding":{"stage":["Series B","Series C"]},"company_industry":{"exclude":["Semiconductors"]}}',
      condition: { field: 'operation', value: 'prospeo_search_company' },
      wandConfig: {
        enabled: true,
        prompt:
          'Build a Prospeo Search Company filters JSON object based on the user description. Use the documented filters (company_industry, company_headcount_range, company_funding, company_technology, company_email_provider, company_naics, company_sics, company_location, etc.) with include/exclude or min/max keys as appropriate. Do not use only exclude filters. Return ONLY the JSON object for the filters value.',
        generationType: 'json-object',
      },
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'prospeo_search_company' },
      mode: 'advanced',
    },

    // Search Suggestions
    {
      id: 'location_search',
      title: 'Location Query',
      type: 'short-input',
      placeholder: 'e.g., united states (min 2 characters)',
      condition: { field: 'operation', value: 'prospeo_search_suggestions' },
    },
    {
      id: 'job_title_search',
      title: 'Job Title Query',
      type: 'short-input',
      placeholder: 'e.g., software engineer (min 2 characters)',
      condition: { field: 'operation', value: 'prospeo_search_suggestions' },
    },

    // API Key (always last)
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Prospeo API key',
      password: true,
    },
  ],
  tools: {
    access: [
      'prospeo_account_information',
      'prospeo_enrich_person',
      'prospeo_enrich_company',
      'prospeo_bulk_enrich_person',
      'prospeo_bulk_enrich_company',
      'prospeo_search_person',
      'prospeo_search_company',
      'prospeo_search_suggestions',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'prospeo_account_information':
            return 'prospeo_account_information'
          case 'prospeo_enrich_person':
            return 'prospeo_enrich_person'
          case 'prospeo_enrich_company':
            return 'prospeo_enrich_company'
          case 'prospeo_bulk_enrich_person':
            return 'prospeo_bulk_enrich_person'
          case 'prospeo_bulk_enrich_company':
            return 'prospeo_bulk_enrich_company'
          case 'prospeo_search_person':
            return 'prospeo_search_person'
          case 'prospeo_search_company':
            return 'prospeo_search_company'
          case 'prospeo_search_suggestions':
            return 'prospeo_search_suggestions'
          default:
            return 'prospeo_enrich_person'
        }
      },
      params: (params) => {
        const result: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(params)) {
          if (value === undefined || value === null || value === '') continue
          if (key === 'page') {
            const n = Number(value)
            if (Number.isFinite(n)) result[key] = n
            continue
          }
          if (
            key === 'only_verified_email' ||
            key === 'enrich_mobile' ||
            key === 'only_verified_mobile'
          ) {
            result[key] = typeof value === 'string' ? value === 'true' : Boolean(value)
            continue
          }
          result[key] = value
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Prospeo API key' },
    // Enrich Person / Company match keys
    first_name: { type: 'string', description: 'First name' },
    last_name: { type: 'string', description: 'Last name' },
    full_name: { type: 'string', description: 'Full name' },
    linkedin_url: { type: 'string', description: 'Person LinkedIn URL' },
    email: { type: 'string', description: 'Work email' },
    company_name: { type: 'string', description: 'Company name' },
    company_website: { type: 'string', description: 'Company website' },
    company_linkedin_url: { type: 'string', description: 'Company LinkedIn URL' },
    company_id: { type: 'string', description: 'Prospeo company_id' },
    person_id: { type: 'string', description: 'Prospeo person_id' },
    only_verified_email: { type: 'boolean', description: 'Only verified emails' },
    enrich_mobile: { type: 'boolean', description: 'Reveal mobile numbers' },
    only_verified_mobile: { type: 'boolean', description: 'Only records with a mobile' },
    // Bulk
    data: { type: 'json', description: 'Array of records to enrich' },
    // Search
    filters: { type: 'json', description: 'Search filters configuration' },
    page: { type: 'number', description: 'Page number (defaults to 1)' },
    // Suggestions
    location_search: { type: 'string', description: 'Location search query' },
    job_title_search: { type: 'string', description: 'Job title search query' },
  },
  outputs: {
    // Account information
    current_plan: { type: 'string', description: 'Current plan name' },
    current_team_members: {
      type: 'number',
      description: 'Number of team members',
    },
    remaining_credits: { type: 'number', description: 'Credits remaining' },
    used_credits: { type: 'number', description: 'Credits already used' },
    next_quota_renewal_days: {
      type: 'number',
      description: 'Days until the next quota renewal',
    },
    next_quota_renewal_date: {
      type: 'string',
      description: 'Date of the next quota renewal',
    },
    // Enrichment
    free_enrichment: {
      type: 'boolean',
      description: 'True if this enrichment was free',
    },
    person: {
      type: 'json',
      description: 'Enriched person object (enrich_person)',
    },
    company: {
      type: 'json',
      description: 'Enriched / current company object (enrich_person, enrich_company)',
    },
    // Bulk enrichment
    total_cost: { type: 'number', description: 'Total credits spent (bulk)' },
    matched: {
      type: 'array',
      description: 'Matched records (bulk enrich)',
    },
    not_matched: {
      type: 'array',
      description: 'Identifiers that did not match (bulk enrich)',
    },
    invalid_datapoints: {
      type: 'array',
      description: 'Identifiers that failed minimum match requirements (bulk enrich)',
    },
    // Search
    free: {
      type: 'boolean',
      description: 'True if the search was free due to 30-day deduplication',
    },
    results: {
      type: 'array',
      description: 'Search results (search_person, search_company)',
    },
    pagination: {
      type: 'json',
      description: 'Pagination details (current_page, per_page, total_page, total_count)',
    },
    // Suggestions
    location_suggestions: {
      type: 'array',
      description: 'Location suggestions (search_suggestions)',
    },
    job_title_suggestions: {
      type: 'array',
      description: 'Job title suggestions (search_suggestions)',
    },
  },
}
