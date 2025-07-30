import { HunterIOIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { HunterResponse } from '@/tools/hunter/types'

export const HunterBlock: BlockConfig<HunterResponse> = {
  type: 'hunter',
  name: 'Hunter io',
  description: 'Find and verify professional email addresses',
  longDescription:
    "Search for email addresses, verify their deliverability, discover companies, and enrich contact data using Hunter.io's powerful email finding capabilities.",
  docsLink: 'https://docs.sim.ai/tools/hunter',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: HunterIOIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Domain Search', id: 'hunter_domain_search' },
        { label: 'Email Finder', id: 'hunter_email_finder' },
        { label: 'Email Verifier', id: 'hunter_email_verifier' },
        { label: 'Discover Companies', id: 'hunter_discover' },
        { label: 'Find Company', id: 'hunter_companies_find' },
        { label: 'Email Count', id: 'hunter_email_count' },
      ],
      value: () => 'hunter_domain_search',
    },
    // Domain Search operation inputs
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter domain name (e.g., stripe.com)',
      condition: { field: 'operation', value: 'hunter_domain_search' },
    },
    {
      id: 'limit',
      title: 'Number of Results',
      type: 'short-input',
      layout: 'full',
      placeholder: '10',
      condition: { field: 'operation', value: 'hunter_domain_search' },
    },
    {
      id: 'type',
      title: 'Email Type',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Personal', id: 'personal' },
        { label: 'Generic', id: 'generic' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'hunter_domain_search' },
    },
    {
      id: 'seniority',
      title: 'Seniority Level',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Junior', id: 'junior' },
        { label: 'Senior', id: 'senior' },
        { label: 'Executive', id: 'executive' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'hunter_domain_search' },
    },
    {
      id: 'department',
      title: 'Department',
      type: 'short-input',
      layout: 'full',
      placeholder: 'e.g., sales, marketing, engineering',
      condition: { field: 'operation', value: 'hunter_domain_search' },
    },
    // Email Finder operation inputs
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter domain name (e.g., stripe.com)',
      condition: { field: 'operation', value: 'hunter_email_finder' },
    },
    {
      id: 'first_name',
      title: 'First Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter first name',
      condition: { field: 'operation', value: 'hunter_email_finder' },
    },
    {
      id: 'last_name',
      title: 'Last Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter last name',
      condition: { field: 'operation', value: 'hunter_email_finder' },
    },
    {
      id: 'company',
      title: 'Company Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter company name',
      condition: { field: 'operation', value: 'hunter_email_finder' },
    },
    // Email Verifier operation inputs
    {
      id: 'email',
      title: 'Email Address',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter email address to verify',
      condition: { field: 'operation', value: 'hunter_email_verifier' },
    },
    // Discover operation inputs
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter search query (e.g., "software companies in San Francisco")',
      condition: { field: 'operation', value: 'hunter_discover' },
    },
    {
      id: 'domain',
      title: 'Domain Filter',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Filter by domain',
      condition: { field: 'operation', value: 'hunter_discover' },
    },
    {
      id: 'industry',
      title: 'Industry',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Filter by industry',
      condition: { field: 'operation', value: 'hunter_discover' },
    },
    {
      id: 'headquarters_location',
      title: 'Location',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Filter by location',
      condition: { field: 'operation', value: 'hunter_discover' },
    },

    // Find Company operation inputs
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter company domain to find company data',
      condition: { field: 'operation', value: 'hunter_companies_find' },
    },
    // Email Count operation inputs
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter domain name',
      condition: { field: 'operation', value: 'hunter_email_count' },
    },
    {
      id: 'company',
      title: 'Company Name',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter company name',
      condition: { field: 'operation', value: 'hunter_email_count' },
    },
    {
      id: 'type',
      title: 'Email Type',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Personal', id: 'personal' },
        { label: 'Generic', id: 'generic' },
      ],
      value: () => 'all',
      condition: { field: 'operation', value: 'hunter_email_count' },
    },
    // API Key (common)
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Hunter.io API key',
      password: true,
    },
  ],
  tools: {
    access: [
      'hunter_discover',
      'hunter_domain_search',
      'hunter_email_finder',
      'hunter_email_verifier',
      'hunter_companies_find',
      'hunter_email_count',
    ],
    config: {
      tool: (params) => {
        // Convert numeric parameters
        if (params.limit) {
          params.limit = Number(params.limit)
        }
        if (params.max_duration) {
          params.max_duration = Number(params.max_duration)
        }

        switch (params.operation) {
          case 'hunter_discover':
            return 'hunter_discover'
          case 'hunter_domain_search':
            return 'hunter_domain_search'
          case 'hunter_email_finder':
            return 'hunter_email_finder'
          case 'hunter_email_verifier':
            return 'hunter_email_verifier'
          case 'hunter_companies_find':
            return 'hunter_companies_find'
          case 'hunter_email_count':
            return 'hunter_email_count'
          default:
            return 'hunter_domain_search'
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    apiKey: { type: 'string', required: true },
    // Domain Search & Email Count
    domain: { type: 'string', required: false },
    limit: { type: 'number', required: false },
    offset: { type: 'number', required: false },
    type: { type: 'string', required: false },
    seniority: { type: 'string', required: false },
    department: { type: 'string', required: false },
    // Email Finder
    first_name: { type: 'string', required: false },
    last_name: { type: 'string', required: false },
    company: { type: 'string', required: false },
    max_duration: { type: 'number', required: false },
    // Email Verifier & Enrichment
    email: { type: 'string', required: false },
    // Discover
    query: { type: 'string', required: false },
    headquarters_location: { type: 'string', required: false },
    industry: { type: 'string', required: false },
    headcount: { type: 'string', required: false },
    company_type: { type: 'string', required: false },
    technology: { type: 'string', required: false },
  },
  outputs: {
    results: 'json',
    emails: 'json',
    email: 'string',
    score: 'number',
    result: 'string',
    status: 'string',
    total: 'number',
    personal_emails: 'number',
    generic_emails: 'number',
  },
}
