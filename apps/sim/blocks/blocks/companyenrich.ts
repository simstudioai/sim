import { CompanyEnrichIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const CompanyEnrichBlock: BlockConfig = {
  type: 'companyenrich',
  name: 'CompanyEnrich',
  description: 'Enrich and discover companies and people',
  longDescription:
    'Enrich companies, search companies and people, look up profiles, retrieve workforce data, and count matches. Advanced Request exposes 42 documented data and job operations. Data requests can consume credits; each execution makes one request.',
  docsLink: 'https://docs.sim.ai/integrations/companyenrich',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  authMode: AuthMode.ApiKey,
  bgColor: '#1488CC',
  icon: CompanyEnrichIcon,
  canvasPresentation: {
    defaultTitle: 'CompanyEnrich',
    sentences: {
      byOperation: {
        enrich: ['Enrich Company'],
        search: ['Search Companies'],
        similar: ['Find Similar Companies'],
        search_people: ['Search People'],
        lookup_person: ['Lookup Person'],
        workforce: ['Get Company Workforce'],
        enrich_properties: ['Enrich by Properties'],
        enrich_batch: ['Batch Enrich Companies'],
        get_company: ['Get Company'],
        get_person: ['Get Person'],
        count: ['Count Companies'],
        similar_count: ['Count Similar Companies'],
        advanced: ['Advanced Request'],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      value: () => 'enrich',
      options: [
        { label: 'Enrich Company', id: 'enrich' },
        { label: 'Search Companies', id: 'search' },
        { label: 'Find Similar Companies', id: 'similar' },
        { label: 'Search People', id: 'search_people' },
        { label: 'Lookup Person', id: 'lookup_person' },
        { label: 'Get Company Workforce', id: 'workforce' },
        { label: 'Enrich by Properties', id: 'enrich_properties' },
        { label: 'Batch Enrich Companies', id: 'enrich_batch' },
        { label: 'Get Company', id: 'get_company' },
        { label: 'Get Person', id: 'get_person' },
        { label: 'Count Companies', id: 'count' },
        { label: 'Count Similar Companies', id: 'similar_count' },
        { label: 'Advanced Request', id: 'advanced' },
      ],
    },
    {
      id: 'domain',
      title: 'Company Domain',
      type: 'short-input',
      condition: { field: 'operation', value: ['enrich', 'similar', 'workforce', 'similar_count'] },
      required: { field: 'operation', value: 'enrich' },
    },
    {
      id: 'domains',
      title: 'Domains (JSON Array)',
      type: 'code',
      condition: { field: 'operation', value: ['similar', 'enrich_batch', 'similar_count'] },
      language: 'json',
      required: { field: 'operation', value: 'enrich_batch' },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      condition: { field: 'operation', value: ['search', 'count'] },
    },
    {
      id: 'semanticQuery',
      title: 'Semantic Query',
      type: 'short-input',
      condition: { field: 'operation', value: ['search', 'count'] },
    },
    {
      id: 'filters',
      title: 'Filters (JSON)',
      type: 'code',
      condition: {
        field: 'operation',
        value: ['search', 'similar', 'search_people', 'count', 'similar_count'],
      },
      language: 'json',
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      condition: { field: 'operation', value: ['search', 'similar', 'search_people'] },
      mode: 'advanced',
      placeholder: 'Defaults to 1',
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      condition: { field: 'operation', value: ['search', 'similar', 'search_people'] },
      mode: 'advanced',
      placeholder: 'Defaults to 10',
    },
    {
      id: 'expand',
      title: 'Expand (JSON Array)',
      type: 'code',
      condition: {
        field: 'operation',
        value: [
          'enrich',
          'search',
          'similar',
          'search_people',
          'lookup_person',
          'enrich_properties',
          'enrich_batch',
          'get_company',
          'get_person',
        ],
      },
      language: 'json',
      mode: 'advanced',
    },
    {
      id: 'waitForEnrichment',
      title: 'Wait for Enrichment',
      type: 'switch',
      condition: { field: 'operation', value: ['enrich', 'similar', 'similar_count'] },
      mode: 'advanced',
    },
    {
      id: 'properties',
      title: 'Company Properties (JSON)',
      type: 'code',
      condition: { field: 'operation', value: ['enrich_properties'] },
      language: 'json',
      required: true,
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      condition: { field: 'operation', value: ['lookup_person'] },
      required: true,
    },
    {
      id: 'id',
      title: 'ID',
      type: 'short-input',
      condition: { field: 'operation', value: ['workforce', 'get_company', 'get_person'] },
      required: { field: 'operation', value: ['get_company', 'get_person'] },
    },
    {
      id: 'apiOperation',
      title: 'API Operation',
      type: 'dropdown',
      condition: { field: 'operation', value: ['advanced'] },
      required: true,
      options: [
        { id: 'get_companies_enrich', label: 'GET /companies/enrich' },
        { id: 'post_companies_enrich', label: 'POST /companies/enrich' },
        { id: 'post_companies_enrich_batch', label: 'POST /companies/enrich/batch' },
        { id: 'get_companies_workforce', label: 'GET /companies/workforce' },
        { id: 'get_companies_autocomplete', label: 'GET /companies/autocomplete' },
        { id: 'post_companies_enrich_bulk', label: 'POST /companies/enrich/bulk' },
        { id: 'get_companies_enrich_bulk_jobid', label: 'GET /companies/enrich/bulk/{jobId}' },
        { id: 'get_companies_enrich_bulk_jobs', label: 'GET /companies/enrich/bulk/jobs' },
        { id: 'post_companies_search', label: 'POST /companies/search' },
        { id: 'post_companies_search_preview', label: 'POST /companies/search/preview' },
        { id: 'post_companies_search_count', label: 'POST /companies/search/count' },
        { id: 'post_companies_search_scroll', label: 'POST /companies/search/scroll' },
        { id: 'get_companies', label: 'GET /companies' },
        { id: 'post_companies_search_async', label: 'POST /companies/search/async' },
        { id: 'get_companies_search_async_jobid', label: 'GET /companies/search/async/{jobId}' },
        { id: 'get_companies_search_async_jobs', label: 'GET /companies/search/async/jobs' },
        { id: 'post_companies_similar', label: 'POST /companies/similar' },
        { id: 'post_companies_similar_preview', label: 'POST /companies/similar/preview' },
        { id: 'post_companies_similar_count', label: 'POST /companies/similar/count' },
        { id: 'post_companies_similar_scroll', label: 'POST /companies/similar/scroll' },
        { id: 'post_people_lookup', label: 'POST /people/lookup' },
        { id: 'get_people', label: 'GET /people' },
        { id: 'post_people_search', label: 'POST /people/search' },
        { id: 'post_people_search_scroll', label: 'POST /people/search/scroll' },
        { id: 'get_people_email', label: 'GET /people/email (beta)' },
        { id: 'post_people_email_bulk', label: 'POST /people/email/bulk (beta)' },
        { id: 'get_people_email_bulk_jobid', label: 'GET /people/email/bulk/{jobId} (beta)' },
        { id: 'get_people_education', label: 'GET /people/education' },
        { id: 'post_people_search_async', label: 'POST /people/search/async' },
        { id: 'get_people_search_async_jobid', label: 'GET /people/search/async/{jobId}' },
        { id: 'get_people_search_async_jobs', label: 'GET /people/search/async/jobs' },
        { id: 'get_jobs', label: 'GET /jobs' },
        { id: 'get_jobs_jobid', label: 'GET /jobs/{jobId}' },
        { id: 'get_geo_regions', label: 'GET /geo/regions' },
        { id: 'get_geo_countries_countrycode', label: 'GET /geo/countries/{countryCode}' },
        { id: 'post_geo_countries', label: 'POST /geo/countries' },
        { id: 'post_geo_states', label: 'POST /geo/states' },
        { id: 'post_geo_cities', label: 'POST /geo/cities' },
        { id: 'get_industries', label: 'GET /industries' },
        { id: 'get_keywords_autocomplete', label: 'GET /keywords/autocomplete' },
        { id: 'get_technologies_autocomplete', label: 'GET /technologies/autocomplete' },
        { id: 'get_positions_autocomplete', label: 'GET /positions/autocomplete' },
      ],
    },
    {
      id: 'body',
      title: 'Body (JSON)',
      type: 'code',
      condition: { field: 'operation', value: ['advanced'] },
      language: 'json',
    },
    {
      id: 'queryParameters',
      title: 'Query Parameters (JSON)',
      type: 'code',
      condition: { field: 'operation', value: ['advanced'] },
      language: 'json',
    },
    {
      id: 'pathParameters',
      title: 'Path Parameters (JSON)',
      type: 'code',
      condition: { field: 'operation', value: ['advanced'] },
      language: 'json',
    },
    {
      id: 'allow_beta',
      title: 'Allow Beta Email Operations',
      type: 'switch',
      condition: { field: 'operation', value: ['advanced'] },
    },
    { id: 'apiKey', title: 'API Key', type: 'short-input', password: true, required: true },
  ],
  tools: {
    access: [
      'companyenrich_enrich',
      'companyenrich_search',
      'companyenrich_similar',
      'companyenrich_search_people',
      'companyenrich_lookup_person',
      'companyenrich_workforce',
      'companyenrich_enrich_properties',
      'companyenrich_enrich_batch',
      'companyenrich_get_company',
      'companyenrich_get_person',
      'companyenrich_count',
      'companyenrich_similar_count',
      'companyenrich_advanced',
    ],
    config: {
      tool: (params) => `companyenrich_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = { ...params }
        for (const key of [
          'filters',
          'properties',
          'domains',
          'expand',
          'body',
          'queryParameters',
          'pathParameters',
        ]) {
          const value = result[key]
          if (value === '' || value === undefined || value === null) delete result[key]
          else if (typeof value === 'string') {
            try {
              result[key] = JSON.parse(value)
            } catch {
              throw new Error(`${key} must contain valid JSON`)
            }
          }
        }
        for (const key of ['page', 'pageSize']) {
          const value = result[key]
          if (value === '' || value === undefined || value === null) delete result[key]
          else if (typeof value === 'string') result[key] = Number(value)
        }
        for (const key of ['domain', 'query', 'semanticQuery', 'id', 'email']) {
          if (result[key] === '' || result[key] === null) delete result[key]
        }
        for (const key of ['allow_beta', 'waitForEnrichment']) {
          if (result[key] === null) delete result[key]
        }
        return result
      },
    },
  },
  inputs: {
    apiKey: { type: 'string', description: 'CompanyEnrich API key without the Bearer prefix' },
    domain: {
      type: 'string',
      description:
        'Company domain. For lookalikes, domains takes precedence over this legacy single seed.',
    },
    domains: {
      type: 'json',
      description:
        'Array of 1\u201310 seed domains for lookalikes or 1\u201350 domains for batch enrichment.',
    },
    query: {
      type: 'string',
      description: 'Literal company name/domain query, up to 250 characters.',
    },
    semanticQuery: {
      type: 'string',
      description: 'Natural-language company description, up to 500 characters.',
    },
    filters: {
      type: 'json',
      description:
        'Documented request-body filters, including nested fields. Explicit inputs take precedence; unknown fields are forwarded to the API.',
    },
    page: {
      type: 'number',
      description: 'One-based page number (default 1). One page per execution.',
    },
    pageSize: {
      type: 'number',
      description:
        'Results per page, 1\u2013100 (default 10). Additional pages can consume credits.',
    },
    expand: {
      type: 'json',
      description:
        'Expansion array: ["workforce"] for companies (can spend extra credits) or ["education"] for people.',
    },
    waitForEnrichment: {
      type: 'boolean',
      description: 'Wait for enrichment on supported company endpoints.',
    },
    properties: {
      type: 'json',
      description:
        'At least one company name or social property: name, linkedinUrl, linkedinId, twitterUrl, facebookUrl, instagramUrl or youTubeUrl.',
    },
    email: { type: 'string', description: 'Email address to look up.' },
    id: {
      type: 'string',
      description:
        'Company UUID or positive person ID; use a decimal string for person IDs to avoid precision loss.',
    },
    apiOperation: {
      type: 'string',
      description:
        'Documented operation ID from the advanced selector; exactly one request, without polling or downloads.',
    },
    body: {
      type: 'json',
      description: 'Full documented JSON body; export count must be explicit and at most 50,000.',
    },
    queryParameters: { type: 'json', description: 'Documented query parameters as an object.' },
    pathParameters: {
      type: 'json',
      description: 'Documented path parameters such as jobId or countryCode.',
    },
    allow_beta: {
      type: 'boolean',
      description: 'Explicitly allow beta email operations and their credit costs (default false).',
    },
  },
  outputs: {
    company: {
      type: 'json',
      description: 'Company profile, including id, name, domain and all other provider fields.',
    },
    items: {
      type: 'json',
      description: 'Company profiles from legacy search and similar actions.',
    },
    page: { type: 'number', description: 'Current page' },
    totalPages: { type: 'number', description: 'Total pages' },
    totalItems: { type: 'number', description: 'Total matching companies' },
    scores: { type: 'json', description: 'Similarity scores keyed by company UUID' },
    data: {
      type: 'json',
      description:
        'Complete API response: object, array or count. Preserves all metadata and future fields.',
    },
  },
}

export const CompanyEnrichBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://companyenrich.com',
  templates: [
    {
      icon: CompanyEnrichIcon,
      title: 'CompanyEnrich lead qualification',
      prompt:
        'When a company domain arrives, enrich it and return a qualification summary using industry and employee range.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['enrichment'],
    },
    {
      icon: CompanyEnrichIcon,
      title: 'CompanyEnrich CRM field audit',
      prompt:
        'For each supplied CRM company domain, enrich the profile and return suggested values for missing name, industry, and website fields. Do not overwrite CRM records.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['enrichment'],
    },
    {
      icon: CompanyEnrichIcon,
      title: 'CompanyEnrich account research',
      prompt:
        'When given a target company domain, enrich the company and produce a research brief with its description and technology stack.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['enrichment'],
    },
    {
      icon: CompanyEnrichIcon,
      title: 'CompanyEnrich lookalike shortlist',
      prompt:
        'Given a best-customer domain, find ten similar companies and rank the shortlist using returned similarity scores.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['enrichment'],
    },
    {
      icon: CompanyEnrichIcon,
      title: 'CompanyEnrich competitor discovery',
      prompt:
        'Given a competitor domain, find similar companies and summarize their industries and descriptions for review.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['enrichment'],
    },
    {
      icon: CompanyEnrichIcon,
      title: 'CompanyEnrich company discovery',
      prompt:
        'When a user provides a company-name query, search the first page and return a table of matching names, domains, and industries.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['enrichment'],
    },
    {
      icon: CompanyEnrichIcon,
      title: 'CompanyEnrich technology qualification',
      prompt:
        'Given a list of company domains and a target technology, enrich each company and flag records whose returned technologies include that technology.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['enrichment'],
    },
  ],
  skills: [
    {
      name: 'research-company',
      description: 'Research an account from its domain',
      content:
        '# Research an account from its domain\n\nUse companyenrich_enrich on the supplied domain. Summarize its company name, industry, employee range, description, and technologies. Keep unavailable fields unknown.\n\nCheck the credit cost before requesting additional records or pages.\n\nSources: https://companyenrich.com/ and https://docs.companyenrich.com/docs/getting-started.',
    },
    {
      name: 'fill-company-gaps',
      description: 'Suggest missing company fields for CRM records',
      content:
        '# Suggest missing company fields for CRM records\n\nFor each supplied domain, use companyenrich_enrich. Compare its fields to the supplied CRM record and return suggested missing values without editing the CRM.\n\nCheck the credit cost before requesting additional records or pages.\n\nSources: https://companyenrich.com/ and https://docs.companyenrich.com/docs/getting-started.',
    },
    {
      name: 'find-lookalike-accounts',
      description: 'Build a lookalike account shortlist',
      content:
        '# Build a lookalike account shortlist\n\nUse companyenrich_similar with a customer domain and a bounded page size. Rank results by scores and return company names and domains.\n\nCheck the credit cost before requesting additional records or pages.\n\nSources: https://companyenrich.com/ and https://docs.companyenrich.com/docs/getting-started.',
    },
    {
      name: 'discover-competitors',
      description: 'Explore companies similar to a competitor',
      content:
        '# Explore companies similar to a competitor\n\nUse companyenrich_similar with the supplied competitor domain. Compare descriptions and industries; describe results as candidates, not proven competitors.\n\nCheck the credit cost before requesting additional records or pages.\n\nSources: https://companyenrich.com/ and https://docs.companyenrich.com/docs/getting-started.',
    },
    {
      name: 'qualify-company-technology',
      description: 'Check the reported technology stack of target accounts',
      content:
        '# Check the reported technology stack of target accounts\n\nUse companyenrich_enrich for each supplied company domain. Compare technologies with the user-provided target and flag matches and unknowns.\n\nCheck the credit cost before requesting additional records or pages.\n\nSources: https://companyenrich.com/ and https://docs.companyenrich.com/docs/getting-started.',
    },
  ],
} as const satisfies BlockMeta
