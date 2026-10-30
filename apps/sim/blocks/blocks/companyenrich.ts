import { CompanyEnrichIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const CompanyEnrichBlock: BlockConfig = {
  type: 'companyenrich',
  name: 'CompanyEnrich',
  description: 'Enrich, search, and discover similar companies',
  longDescription:
    'Look up company profiles by domain, search company names and domains, and discover lookalike accounts. Enrichment costs 1 credit per call; search costs 1 credit per result (1 minimum); similar-company discovery costs 5 per result (5 minimum).',
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
        enrich: [{ text: 'Enrich company', field: 'domain', core: true }],
        search: [{ text: 'Search companies for', field: 'query', core: true }],
        similar: [{ text: 'Find companies similar to', field: 'domain', core: true }],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Enrich Company', id: 'enrich' },
        { label: 'Search Companies', id: 'search' },
        { label: 'Find Similar Companies', id: 'similar' },
      ],
      value: () => 'enrich',
    },
    {
      id: 'domain',
      title: 'Company Domain',
      type: 'short-input',
      placeholder: 'example.com',
      required: true,
      condition: { field: 'operation', value: ['enrich', 'similar'] },
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: 'Enter a company name or domain',
      required: true,
      condition: { field: 'operation', value: 'search' },
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: 'Defaults to 1',
      mode: 'advanced',
      condition: { field: 'operation', value: ['search', 'similar'] },
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '1 to 100 (defaults to 10)',
      mode: 'advanced',
      condition: { field: 'operation', value: ['search', 'similar'] },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your CompanyEnrich API key',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['companyenrich_enrich', 'companyenrich_search', 'companyenrich_similar'],
    config: {
      tool: (params) => `companyenrich_${params.operation}`,
      params: (params) => ({
        ...params,
        page: params.page === undefined || params.page === '' ? undefined : Number(params.page),
        pageSize:
          params.pageSize === undefined || params.pageSize === ''
            ? undefined
            : Number(params.pageSize),
      }),
    },
  },
  inputs: {
    apiKey: { type: 'string', description: 'CompanyEnrich API key' },
    domain: { type: 'string', description: 'Company domain' },
    query: { type: 'string', description: 'Company name or domain search' },
    page: { type: 'number', description: 'One-based page number' },
    pageSize: { type: 'number', description: 'Companies per page (1–100)' },
  },
  outputs: {
    company: { type: 'json', description: 'Enriched company profile' },
    items: { type: 'json', description: 'Matching company profiles' },
    page: { type: 'number', description: 'Current page number' },
    totalPages: { type: 'number', description: 'Total available pages' },
    totalItems: { type: 'number', description: 'Total matching companies' },
    scores: { type: 'json', description: 'Similarity scores keyed by company UUID' },
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
