import { ZoomInfoIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { ZoomInfoResponse } from '@/tools/zoominfo/types'

export const ZoomInfoBlock: BlockConfig<ZoomInfoResponse> = {
  type: 'zoominfo',
  name: 'ZoomInfo',
  description: 'Search and enrich B2B company and contact data with ZoomInfo.',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrates ZoomInfo into the workflow. Search companies and contacts, enrich firmographic and contact data, find intent signals, and pull news — all using the ZoomInfo GTM API.',
  docsLink: 'https://docs.sim.ai/tools/zoominfo',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  tags: ['enrichment', 'sales-engagement'],
  bgColor: '#EA1B15',
  icon: ZoomInfoIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search Companies', id: 'search_companies' },
        { label: 'Search Contacts', id: 'search_contacts' },
        { label: 'Enrich Companies', id: 'enrich_companies' },
        { label: 'Enrich Contacts', id: 'enrich_contacts' },
        { label: 'Search Intent', id: 'search_intent' },
        { label: 'Search News', id: 'search_news' },
      ],
      value: () => 'search_companies',
    },
    {
      id: 'clientId',
      title: 'ZoomInfo Client ID',
      type: 'short-input',
      placeholder: 'Enter your ZoomInfo OAuth client ID',
      required: true,
    },
    {
      id: 'clientSecret',
      title: 'ZoomInfo Client Secret',
      type: 'short-input',
      placeholder: 'Enter your ZoomInfo OAuth client secret',
      password: true,
      required: true,
    },

    // Search Companies
    {
      id: 'companyName',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Acme Corp',
      condition: { field: 'operation', value: ['search_companies', 'search_contacts'] },
    },
    {
      id: 'companyWebsite',
      title: 'Company Website',
      type: 'short-input',
      placeholder: 'acme.com (comma-separated for multiple)',
      condition: { field: 'operation', value: 'search_companies' },
    },
    {
      id: 'companyTicker',
      title: 'Ticker Symbol',
      type: 'short-input',
      placeholder: 'ACME',
      condition: { field: 'operation', value: 'search_companies' },
      mode: 'advanced',
    },
    {
      id: 'industryCodes',
      title: 'Industry Codes',
      type: 'code',
      placeholder: '["software","saas"]',
      condition: { field: 'operation', value: ['search_companies', 'search_intent'] },
      mode: 'advanced',
    },
    {
      id: 'country',
      title: 'Country',
      type: 'short-input',
      placeholder: 'United States',
      condition: { field: 'operation', value: ['search_companies', 'search_intent'] },
      mode: 'advanced',
    },
    {
      id: 'state',
      title: 'State / Province',
      type: 'short-input',
      placeholder: 'California',
      condition: { field: 'operation', value: ['search_companies', 'search_intent'] },
      mode: 'advanced',
    },
    {
      id: 'metroRegion',
      title: 'Metro Region',
      type: 'short-input',
      placeholder: 'San Francisco Bay Area',
      condition: { field: 'operation', value: 'search_companies' },
      mode: 'advanced',
    },
    {
      id: 'revenueMin',
      title: 'Min Revenue (thousands USD)',
      type: 'short-input',
      placeholder: '1000',
      condition: { field: 'operation', value: 'search_companies' },
      mode: 'advanced',
    },
    {
      id: 'revenueMax',
      title: 'Max Revenue (thousands USD)',
      type: 'short-input',
      placeholder: '100000',
      condition: { field: 'operation', value: 'search_companies' },
      mode: 'advanced',
    },
    {
      id: 'employeeRangeMin',
      title: 'Min Employees',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'search_companies' },
      mode: 'advanced',
    },
    {
      id: 'employeeRangeMax',
      title: 'Max Employees',
      type: 'short-input',
      placeholder: '5000',
      condition: { field: 'operation', value: 'search_companies' },
      mode: 'advanced',
    },
    {
      id: 'excludeDefunctCompanies',
      title: 'Exclude Defunct Companies',
      type: 'switch',
      condition: { field: 'operation', value: 'search_companies' },
      mode: 'advanced',
    },

    // Search Contacts
    {
      id: 'firstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'Jane',
      condition: { field: 'operation', value: 'search_contacts' },
    },
    {
      id: 'lastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Doe',
      condition: { field: 'operation', value: 'search_contacts' },
    },
    {
      id: 'fullName',
      title: 'Full Name',
      type: 'short-input',
      placeholder: 'Jane Doe',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
    },
    {
      id: 'emailAddress',
      title: 'Email Address',
      type: 'short-input',
      placeholder: 'jane@acme.com',
      condition: { field: 'operation', value: 'search_contacts' },
    },
    {
      id: 'jobTitle',
      title: 'Job Title',
      type: 'short-input',
      placeholder: 'VP of Marketing',
      condition: { field: 'operation', value: 'search_contacts' },
    },
    {
      id: 'managementLevel',
      title: 'Management Level',
      type: 'code',
      placeholder: '["vp","director","manager"]',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
    },
    {
      id: 'department',
      title: 'Department',
      type: 'code',
      placeholder: '["sales","marketing"]',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
    },
    {
      id: 'companyId',
      title: 'Company ID',
      type: 'short-input',
      placeholder: 'ZoomInfo company ID',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
    },
    {
      id: 'contactAccuracyScoreMin',
      title: 'Min Accuracy Score',
      type: 'short-input',
      placeholder: '70-99',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
    },
    {
      id: 'requiredFields',
      title: 'Required Fields',
      type: 'code',
      placeholder: '["email","phone"]',
      condition: { field: 'operation', value: ['search_contacts', 'enrich_contacts'] },
      mode: 'advanced',
    },
    {
      id: 'excludePartialProfiles',
      title: 'Exclude Partial Profiles',
      type: 'switch',
      condition: { field: 'operation', value: 'search_contacts' },
      mode: 'advanced',
    },

    // Enrich Companies / Contacts
    {
      id: 'matchCompanyInput',
      title: 'Companies to Enrich (JSON Array)',
      type: 'code',
      placeholder: '[{"companyName":"Acme","companyWebsite":"acme.com"}]',
      condition: { field: 'operation', value: 'enrich_companies' },
      required: { field: 'operation', value: 'enrich_companies' },
    },
    {
      id: 'matchPersonInput',
      title: 'Contacts to Enrich (JSON Array)',
      type: 'code',
      placeholder: '[{"firstName":"Jane","lastName":"Doe","companyName":"Acme"}]',
      condition: { field: 'operation', value: 'enrich_contacts' },
      required: { field: 'operation', value: 'enrich_contacts' },
    },
    {
      id: 'outputFields',
      title: 'Output Fields',
      type: 'code',
      placeholder: '["id","name","website","revenue","employeeCount"]',
      condition: { field: 'operation', value: ['enrich_companies', 'enrich_contacts'] },
      mode: 'advanced',
    },

    // Search Intent
    {
      id: 'topics',
      title: 'Intent Topics',
      type: 'code',
      placeholder: '["CRM Software","Marketing Automation"]',
      condition: { field: 'operation', value: 'search_intent' },
      required: { field: 'operation', value: 'search_intent' },
    },
    {
      id: 'signalStartDate',
      title: 'Signal Start Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'search_intent' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYY-MM-DD format. Return ONLY the date string, no quotes or explanation.',
        placeholder: 'Describe the date (e.g., "30 days ago")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'signalEndDate',
      title: 'Signal End Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'search_intent' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYY-MM-DD format. Return ONLY the date string, no quotes or explanation.',
        placeholder: 'Describe the date (e.g., "today")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'signalScoreMin',
      title: 'Min Signal Score (60-100)',
      type: 'short-input',
      placeholder: '60',
      condition: { field: 'operation', value: 'search_intent' },
      mode: 'advanced',
    },
    {
      id: 'signalScoreMax',
      title: 'Max Signal Score (60-100)',
      type: 'short-input',
      placeholder: '100',
      condition: { field: 'operation', value: 'search_intent' },
      mode: 'advanced',
    },
    {
      id: 'audienceStrengthMin',
      title: 'Min Audience Strength (A-E)',
      type: 'dropdown',
      options: [
        { label: 'A (largest)', id: 'A' },
        { label: 'B', id: 'B' },
        { label: 'C', id: 'C' },
        { label: 'D', id: 'D' },
        { label: 'E', id: 'E' },
      ],
      condition: { field: 'operation', value: 'search_intent' },
      mode: 'advanced',
    },
    {
      id: 'audienceStrengthMax',
      title: 'Max Audience Strength (A-E)',
      type: 'dropdown',
      options: [
        { label: 'A (largest)', id: 'A' },
        { label: 'B', id: 'B' },
        { label: 'C', id: 'C' },
        { label: 'D', id: 'D' },
        { label: 'E', id: 'E' },
      ],
      condition: { field: 'operation', value: 'search_intent' },
      mode: 'advanced',
    },
    {
      id: 'findRecommendedContacts',
      title: 'Include Recommended Contacts',
      type: 'switch',
      condition: { field: 'operation', value: 'search_intent' },
      mode: 'advanced',
    },

    // Search News
    {
      id: 'categories',
      title: 'Categories',
      type: 'code',
      placeholder: '["funding","acquisition"]',
      condition: { field: 'operation', value: 'search_news' },
    },
    {
      id: 'url',
      title: 'Source URLs',
      type: 'code',
      placeholder: '["https://techcrunch.com"]',
      condition: { field: 'operation', value: 'search_news' },
      mode: 'advanced',
    },
    {
      id: 'pageDateMin',
      title: 'Earliest Publish Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'search_news' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYY-MM-DD format. Return ONLY the date string, no quotes or explanation.',
        placeholder: 'Describe the date (e.g., "last week")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'pageDateMax',
      title: 'Latest Publish Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: 'search_news' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a date in YYYY-MM-DD format. Return ONLY the date string, no quotes or explanation.',
        placeholder: 'Describe the date (e.g., "today")...',
        generationType: 'timestamp',
      },
    },

    // Sort + Pagination
    {
      id: 'sortBy',
      title: 'Sort By Field',
      type: 'short-input',
      placeholder: 'Field name',
      condition: { field: 'operation', value: ['search_companies', 'search_contacts'] },
      mode: 'advanced',
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'Ascending', id: 'asc' },
        { label: 'Descending', id: 'desc' },
      ],
      condition: { field: 'operation', value: ['search_companies', 'search_contacts'] },
      mode: 'advanced',
    },
    {
      id: 'page',
      title: 'Page Number',
      type: 'short-input',
      placeholder: '1',
      condition: {
        field: 'operation',
        value: ['search_companies', 'search_contacts', 'search_intent', 'search_news'],
      },
      mode: 'advanced',
    },
    {
      id: 'rpp',
      title: 'Results Per Page',
      type: 'short-input',
      placeholder: '25 (max 100)',
      condition: {
        field: 'operation',
        value: ['search_companies', 'search_contacts', 'search_intent', 'search_news'],
      },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'zoominfo_search_companies',
      'zoominfo_search_contacts',
      'zoominfo_enrich_companies',
      'zoominfo_enrich_contacts',
      'zoominfo_search_intent',
      'zoominfo_search_news',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'search_companies':
            return 'zoominfo_search_companies'
          case 'search_contacts':
            return 'zoominfo_search_contacts'
          case 'enrich_companies':
            return 'zoominfo_enrich_companies'
          case 'enrich_contacts':
            return 'zoominfo_enrich_contacts'
          case 'search_intent':
            return 'zoominfo_search_intent'
          case 'search_news':
            return 'zoominfo_search_news'
          default:
            throw new Error(`Invalid ZoomInfo operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { operation: _operation, ...rest } = params as Record<string, unknown>
        const parsed: Record<string, unknown> = { ...rest }

        const toNumber = (key: string) => {
          const v = parsed[key]
          if (v === undefined || v === null || v === '') return
          const n = Number(v)
          if (Number.isFinite(n)) parsed[key] = n
        }

        for (const key of [
          'revenueMin',
          'revenueMax',
          'employeeRangeMin',
          'employeeRangeMax',
          'contactAccuracyScoreMin',
          'signalScoreMin',
          'signalScoreMax',
          'page',
          'rpp',
        ]) {
          toNumber(key)
        }

        return parsed
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'ZoomInfo operation to perform' },
    clientId: { type: 'string', description: 'ZoomInfo OAuth client ID' },
    clientSecret: { type: 'string', description: 'ZoomInfo OAuth client secret' },
    companyName: { type: 'string', description: 'Company name' },
    companyWebsite: { type: 'string', description: 'Company website' },
    companyTicker: { type: 'string', description: 'Stock ticker' },
    industryCodes: { type: 'string', description: 'Industry codes' },
    country: { type: 'string', description: 'Country' },
    state: { type: 'string', description: 'State' },
    metroRegion: { type: 'string', description: 'Metro region' },
    revenueMin: { type: 'number', description: 'Min revenue (thousands USD)' },
    revenueMax: { type: 'number', description: 'Max revenue (thousands USD)' },
    employeeRangeMin: { type: 'number', description: 'Min employees' },
    employeeRangeMax: { type: 'number', description: 'Max employees' },
    excludeDefunctCompanies: { type: 'boolean', description: 'Exclude defunct companies' },
    firstName: { type: 'string', description: 'First name' },
    lastName: { type: 'string', description: 'Last name' },
    fullName: { type: 'string', description: 'Full name' },
    emailAddress: { type: 'string', description: 'Email address' },
    jobTitle: { type: 'string', description: 'Job title' },
    managementLevel: { type: 'string', description: 'Management level' },
    department: { type: 'string', description: 'Department' },
    companyId: { type: 'string', description: 'Company ID' },
    contactAccuracyScoreMin: { type: 'number', description: 'Min accuracy score' },
    requiredFields: { type: 'string', description: 'Required fields' },
    excludePartialProfiles: { type: 'boolean', description: 'Exclude partial profiles' },
    matchCompanyInput: { type: 'string', description: 'Companies to enrich (JSON array)' },
    matchPersonInput: { type: 'string', description: 'Contacts to enrich (JSON array)' },
    outputFields: { type: 'string', description: 'Output fields' },
    topics: { type: 'string', description: 'Intent topics' },
    signalStartDate: { type: 'string', description: 'Signal start date' },
    signalEndDate: { type: 'string', description: 'Signal end date' },
    signalScoreMin: { type: 'number', description: 'Min signal score' },
    signalScoreMax: { type: 'number', description: 'Max signal score' },
    audienceStrengthMin: { type: 'string', description: 'Min audience strength (A-E)' },
    audienceStrengthMax: { type: 'string', description: 'Max audience strength (A-E)' },
    findRecommendedContacts: { type: 'boolean', description: 'Include recommended contacts' },
    categories: { type: 'string', description: 'News categories' },
    url: { type: 'string', description: 'News source URLs' },
    pageDateMin: { type: 'string', description: 'Earliest publish date' },
    pageDateMax: { type: 'string', description: 'Latest publish date' },
    sortBy: { type: 'string', description: 'Sort field' },
    sortOrder: { type: 'string', description: 'Sort order' },
    page: { type: 'number', description: 'Page number' },
    rpp: { type: 'number', description: 'Results per page' },
  },
  outputs: {
    companies: { type: 'json', description: 'Matching companies (search_companies)' },
    contacts: { type: 'json', description: 'Matching contacts (search_contacts)' },
    results: {
      type: 'json',
      description: 'Enrichment results (enrich_companies / enrich_contacts)',
    },
    signals: { type: 'json', description: 'Intent signals (search_intent)' },
    articles: { type: 'json', description: 'News articles (search_news)' },
    totalResults: { type: 'number', description: 'Total matching results across all pages' },
    currentPage: { type: 'number', description: 'Current page number' },
    totalPages: { type: 'number', description: 'Total number of pages available' },
  },
}
