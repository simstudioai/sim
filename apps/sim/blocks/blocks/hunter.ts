import { HunterIOIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { HunterResponse } from '@/tools/hunter/types'

export const HunterBlock: BlockConfig<HunterResponse> = {
  type: 'hunter',
  name: 'Hunter io',
  description: 'Find and verify professional email addresses',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Hunter into the workflow. Can search domains, find email addresses, verify email addresses, discover companies, find companies, and count email addresses.',
  docsLink: 'https://docs.sim.ai/tools/hunter',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: HunterIOIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
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
      required: true,
      placeholder: 'Enter domain name (e.g., stripe.com)',
      condition: { field: 'operation', value: 'hunter_domain_search' },
    },
    {
      id: 'limit',
      title: 'Number of Results',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'hunter_domain_search' },
    },
    {
      id: 'type',
      title: 'Email Type',
      type: 'dropdown',
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
      placeholder: 'e.g., sales, marketing, engineering',
      condition: { field: 'operation', value: 'hunter_domain_search' },
    },
    // Email Finder operation inputs
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      required: true,
      placeholder: 'Enter domain name (e.g., stripe.com)',
      condition: { field: 'operation', value: 'hunter_email_finder' },
    },
    {
      id: 'first_name',
      title: 'First Name',
      type: 'short-input',
      required: true,
      placeholder: 'Enter first name',
      condition: { field: 'operation', value: 'hunter_email_finder' },
    },
    {
      id: 'last_name',
      title: 'Last Name',
      type: 'short-input',
      required: true,
      placeholder: 'Enter last name',
      condition: { field: 'operation', value: 'hunter_email_finder' },
    },
    {
      id: 'company',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Enter company name',
      condition: { field: 'operation', value: 'hunter_email_finder' },
    },
    // Email Verifier operation inputs
    {
      id: 'email',
      title: 'Email Address',
      type: 'short-input',
      required: true,
      placeholder: 'Enter email address to verify',
      condition: { field: 'operation', value: 'hunter_email_verifier' },
    },
    // Discover operation inputs
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      placeholder: 'Enter search query (e.g., "software companies in San Francisco")',
      condition: { field: 'operation', value: 'hunter_discover' },
      required: true,
    },
    {
      id: 'domain',
      title: 'Domain Filter',
      type: 'short-input',
      placeholder: 'Filter by domain',
      condition: { field: 'operation', value: 'hunter_discover' },
    },

    // Find Company operation inputs
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      required: true,
      placeholder: 'Enter company domain',
      condition: { field: 'operation', value: 'hunter_companies_find' },
    },
    // Email Count operation inputs
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'Enter domain name',
      condition: { field: 'operation', value: 'hunter_email_count' },
      required: true,
    },
    {
      id: 'company',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Enter company name',
      condition: { field: 'operation', value: 'hunter_email_count' },
    },
    {
      id: 'type',
      title: 'Email Type',
      type: 'dropdown',
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
      required: true,
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
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Hunter.io API key' },
    // Domain Search & Email Count
    domain: { type: 'string', description: 'Company domain name' },
    limit: { type: 'number', description: 'Result limit' },
    offset: { type: 'number', description: 'Result offset' },
    type: { type: 'string', description: 'Email type filter' },
    seniority: { type: 'string', description: 'Seniority level filter' },
    department: { type: 'string', description: 'Department filter' },
    // Email Finder
    first_name: { type: 'string', description: 'First name' },
    last_name: { type: 'string', description: 'Last name' },
    company: { type: 'string', description: 'Company name' },
    // Email Verifier & Enrichment
    email: { type: 'string', description: 'Email address' },
    // Discover
    query: { type: 'string', description: 'Search query' },
    headcount: { type: 'string', description: 'Company headcount filter' },
    company_type: { type: 'string', description: 'Company type filter' },
    technology: { type: 'string', description: 'Technology filter' },
  },
  outputs: {
    results: { type: 'json', description: 'Search results' },
    emails: { type: 'json', description: 'Email addresses found' },
    email: { type: 'string', description: 'Found email address' },
    score: { type: 'number', description: 'Confidence score' },
    result: { type: 'string', description: 'Verification result' },
    status: { type: 'string', description: 'Status message' },
    total: { type: 'number', description: 'Total results count' },
    personal_emails: { type: 'number', description: 'Personal emails count' },
    generic_emails: { type: 'number', description: 'Generic emails count' },
  },
}
