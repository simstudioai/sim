import { HunterIOIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, IntegrationType } from '@/blocks/types'
import type { HunterResponse } from '@/tools/hunter/types'

export const HunterBlock: BlockConfig<HunterResponse> = {
  type: 'hunter',
  name: 'Hunter.io',
  description: 'Find and verify professional email addresses',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Hunter into the workflow. Can search domains, find email addresses, verify email addresses, discover companies, find companies, and count email addresses.',
  docsLink: 'https://docs.sim.ai/tools/hunter',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  tags: ['enrichment', 'sales-engagement'],
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
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'hunter_domain_search' },
      mode: 'advanced',
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
      mode: 'advanced',
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
      mode: 'advanced',
    },
    {
      id: 'department',
      title: 'Department',
      type: 'short-input',
      placeholder: 'e.g., sales, marketing, engineering',
      condition: { field: 'operation', value: 'hunter_domain_search' },
      mode: 'advanced',
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
      mode: 'advanced',
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
      wandConfig: {
        enabled: true,
        prompt: `Generate a company discovery search query for Hunter.io based on the user's description.
The query should be optimized for finding companies and should include:
- Industry or business type
- Location if relevant
- Company size or other relevant criteria

Return ONLY the search query text - no explanations.`,
        placeholder:
          'Describe the companies you want to find (e.g., "fintech startups in NYC", "healthcare companies in Europe")...',
      },
    },
    {
      id: 'domain',
      title: 'Domain Filter',
      type: 'short-input',
      placeholder: 'Filter by domain',
      condition: { field: 'operation', value: 'hunter_discover' },
      mode: 'advanced',
    },
    {
      id: 'headcount',
      title: 'Headcount',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: '1-10', id: '1-10' },
        { label: '11-50', id: '11-50' },
        { label: '51-200', id: '51-200' },
        { label: '201-500', id: '201-500' },
        { label: '501-1000', id: '501-1000' },
        { label: '1001-5000', id: '1001-5000' },
        { label: '5001-10000', id: '5001-10000' },
        { label: '10001+', id: '10001+' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'hunter_discover' },
      mode: 'advanced',
    },
    {
      id: 'company_type',
      title: 'Company Type',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Educational', id: 'educational' },
        { label: 'Government Agency', id: 'government agency' },
        { label: 'Non Profit', id: 'non profit' },
        { label: 'Partnership', id: 'partnership' },
        { label: 'Privately Held', id: 'privately held' },
        { label: 'Public Company', id: 'public company' },
        { label: 'Self Employed', id: 'self employed' },
        { label: 'Self Owned', id: 'self owned' },
        { label: 'Sole Proprietorship', id: 'sole proprietorship' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'hunter_discover' },
      mode: 'advanced',
    },
    {
      id: 'technology',
      title: 'Technology',
      type: 'short-input',
      placeholder: 'e.g., react, salesforce',
      condition: { field: 'operation', value: 'hunter_discover' },
      mode: 'advanced',
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
      mode: 'advanced',
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
      mode: 'advanced',
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
      params: (params) => {
        const result: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(params)) {
          if (value === undefined || value === null || value === '') continue
          if (key === 'limit' || key === 'offset') {
            result[key] = Number(value)
          } else {
            result[key] = value
          }
        }
        return result
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
    // Domain Search
    domain: { type: 'string', description: 'Domain name' },
    organization: { type: 'string', description: 'Organization name (domain search)' },
    pattern: { type: 'string', description: 'Email pattern (e.g., {first}.{last})' },
    disposable: { type: 'boolean', description: 'Whether the domain is disposable' },
    webmail: { type: 'boolean', description: 'Whether the domain is a webmail provider' },
    accept_all: { type: 'boolean', description: 'Whether the server accepts all emails' },
    linked_domains: { type: 'array', description: 'Linked domains' },
    emails: {
      type: 'array',
      description:
        'List of emails found for the domain (value, type, confidence, first_name, last_name, position, seniority, department, linkedin, twitter, phone_number, sources, verification)',
    },
    // Email Finder
    email: { type: 'string', description: 'Found email address' },
    score: { type: 'number', description: 'Confidence score (0-100)' },
    first_name: { type: 'string', description: 'Person first name' },
    last_name: { type: 'string', description: 'Person last name' },
    position: { type: 'string', description: 'Job position' },
    linkedin_url: { type: 'string', description: 'LinkedIn profile URL (email-finder, discover)' },
    phone_number: { type: 'string', description: 'Phone number' },
    company: { type: 'string', description: 'Company name (email-finder)' },
    sources: {
      type: 'array',
      description:
        'Source pages where the email was found (domain, uri, extracted_on, last_seen_on, still_on_page)',
    },
    verification: {
      type: 'json',
      description: 'Email verification information (date, status)',
    },
    // Email Verifier
    result: {
      type: 'string',
      description: 'Deliverability result (deliverable, undeliverable, risky)',
    },
    status: {
      type: 'string',
      description: 'Verification status (valid, invalid, accept_all, webmail, disposable, unknown)',
    },
    regexp: { type: 'boolean', description: 'Email passes regex validation' },
    gibberish: { type: 'boolean', description: 'Whether email looks auto-generated' },
    mx_records: { type: 'boolean', description: 'MX records exist for the domain' },
    smtp_server: { type: 'boolean', description: 'SMTP server reachable' },
    smtp_check: { type: 'boolean', description: 'Email does not bounce' },
    block: { type: 'boolean', description: 'Whether the domain blocks verification' },
    // Discover
    results: {
      type: 'array',
      description:
        'Companies matching the search (domain, organization, personal_emails, generic_emails, total_emails)',
    },
    // Companies Find (flattened)
    name: { type: 'string', description: 'Company name (companies-find, discover)' },
    description: { type: 'string', description: 'Company description' },
    industry: { type: 'string', description: 'Industry classification' },
    sector: { type: 'string', description: 'Business sector' },
    size: { type: 'string', description: 'Employee headcount range (e.g., "11-50")' },
    founded_year: { type: 'number', description: 'Year founded' },
    location: { type: 'string', description: 'Headquarters location (formatted)' },
    country: { type: 'string', description: 'Country (full name)' },
    country_code: { type: 'string', description: 'ISO 3166-1 alpha-2 country code' },
    state: { type: 'string', description: 'State/province' },
    city: { type: 'string', description: 'City' },
    linkedin: { type: 'string', description: 'LinkedIn handle (companies-find)' },
    twitter: { type: 'string', description: 'Twitter handle' },
    facebook: { type: 'string', description: 'Facebook handle' },
    logo: { type: 'string', description: 'Company logo URL' },
    phone: { type: 'string', description: 'Company phone number' },
    tech: { type: 'array', description: 'Technologies used by the company' },
    // Email Count
    total: { type: 'number', description: 'Total email count' },
    personal_emails: { type: 'number', description: 'Personal emails count' },
    generic_emails: { type: 'number', description: 'Generic emails count' },
    department: {
      type: 'json',
      description:
        'Email count by department (executive, it, finance, management, sales, legal, support, hr, marketing, communication, education, design, health, operations)',
    },
    seniority: {
      type: 'json',
      description: 'Email count by seniority level (junior, senior, executive)',
    },
  },
}
