import { FindymailIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, IntegrationType } from '@/blocks/types'
import type { FindymailResponse } from '@/tools/findymail/types'

export const FindymailBlock: BlockConfig<FindymailResponse> = {
  type: 'findymail',
  name: 'Findymail',
  description: 'Find and verify B2B emails, phones, employees, and company data',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Findymail to find verified work emails by name, domain, or LinkedIn URL, verify deliverability, reverse-lookup profiles from emails, enrich company data, find employees by job title, look up phone numbers, search technology stacks, and check credit usage.',
  docsLink: 'https://docs.sim.ai/tools/findymail',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  tags: ['enrichment', 'sales-engagement'],
  bgColor: '#FFFFFF',
  icon: FindymailIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Find Email From Name', id: 'findymail_find_email_from_name' },
        { label: 'Find Email From LinkedIn', id: 'findymail_find_email_from_linkedin' },
        { label: 'Find Emails By Domain', id: 'findymail_find_emails_by_domain' },
        { label: 'Verify Email', id: 'findymail_verify_email' },
        { label: 'Reverse Email Lookup', id: 'findymail_reverse_email_lookup' },
        { label: 'Get Company Info', id: 'findymail_get_company' },
        { label: 'Find Employees', id: 'findymail_find_employees' },
        { label: 'Find Phone', id: 'findymail_find_phone' },
        { label: 'Search Technologies', id: 'findymail_search_technologies' },
        { label: 'Lookup Technologies By Domain', id: 'findymail_lookup_technologies' },
        { label: 'Get Remaining Credits', id: 'findymail_get_credits' },
      ],
      value: () => 'findymail_find_email_from_name',
    },
    // Find Email From Name
    {
      id: 'name',
      title: 'Full Name',
      type: 'short-input',
      required: true,
      placeholder: 'John Doe',
      condition: { field: 'operation', value: 'findymail_find_email_from_name' },
    },
    {
      id: 'domain',
      title: 'Company Domain or Name',
      type: 'short-input',
      required: true,
      placeholder: 'stripe.com',
      condition: { field: 'operation', value: 'findymail_find_email_from_name' },
    },
    // Find Email From LinkedIn
    {
      id: 'linkedin_url',
      title: 'LinkedIn URL',
      type: 'short-input',
      required: true,
      placeholder: 'https://linkedin.com/in/johndoe',
      condition: { field: 'operation', value: 'findymail_find_email_from_linkedin' },
    },
    // Find Emails By Domain
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      required: true,
      placeholder: 'stripe.com',
      condition: { field: 'operation', value: 'findymail_find_emails_by_domain' },
    },
    {
      id: 'roles',
      title: 'Target Roles',
      type: 'long-input',
      required: true,
      placeholder: '["CEO", "Founder"]',
      condition: { field: 'operation', value: 'findymail_find_emails_by_domain' },
    },
    // Verify Email
    {
      id: 'email',
      title: 'Email Address',
      type: 'short-input',
      required: true,
      placeholder: 'john@example.com',
      condition: { field: 'operation', value: 'findymail_verify_email' },
    },
    // Reverse Email Lookup
    {
      id: 'email',
      title: 'Email Address',
      type: 'short-input',
      required: true,
      placeholder: 'john@example.com',
      condition: { field: 'operation', value: 'findymail_reverse_email_lookup' },
    },
    {
      id: 'with_profile',
      title: 'Return Full Profile',
      type: 'switch',
      condition: { field: 'operation', value: 'findymail_reverse_email_lookup' },
      mode: 'advanced',
    },
    // Get Company Info — provide at least one of LinkedIn URL, domain, or name
    {
      id: 'linkedin_url',
      title: 'Company LinkedIn URL',
      type: 'short-input',
      placeholder: 'LinkedIn URL (at least one of URL/domain/name required)',
      condition: { field: 'operation', value: 'findymail_get_company' },
    },
    {
      id: 'domain',
      title: 'Company Domain',
      type: 'short-input',
      placeholder: 'stripe.com (at least one of URL/domain/name required)',
      condition: { field: 'operation', value: 'findymail_get_company' },
    },
    {
      id: 'name',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Stripe (at least one of URL/domain/name required)',
      condition: { field: 'operation', value: 'findymail_get_company' },
    },
    // Find Employees
    {
      id: 'website',
      title: 'Company Website',
      type: 'short-input',
      required: true,
      placeholder: 'google.com',
      condition: { field: 'operation', value: 'findymail_find_employees' },
    },
    {
      id: 'job_titles',
      title: 'Job Titles',
      type: 'long-input',
      required: true,
      placeholder: '["Software Engineer", "CEO"]',
      condition: { field: 'operation', value: 'findymail_find_employees' },
    },
    {
      id: 'count',
      title: 'Number of Contacts',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'findymail_find_employees' },
      mode: 'advanced',
    },
    // Find Phone
    {
      id: 'linkedin_url',
      title: 'LinkedIn URL',
      type: 'short-input',
      required: true,
      placeholder: 'https://linkedin.com/in/johndoe',
      condition: { field: 'operation', value: 'findymail_find_phone' },
    },
    // Search Technologies
    {
      id: 'q',
      title: 'Search Term',
      type: 'short-input',
      required: true,
      placeholder: 'React',
      condition: { field: 'operation', value: 'findymail_search_technologies' },
    },
    // Lookup Technologies By Domain
    {
      id: 'domain',
      title: 'Company Domain',
      type: 'short-input',
      required: true,
      placeholder: 'stripe.com',
      condition: { field: 'operation', value: 'findymail_lookup_technologies' },
    },
    {
      id: 'technologies',
      title: 'Filter Technologies',
      type: 'long-input',
      placeholder: '["React", "TypeScript"]',
      condition: { field: 'operation', value: 'findymail_lookup_technologies' },
      mode: 'advanced',
    },
    // API Key
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Findymail API key',
      password: true,
    },
  ],
  tools: {
    access: [
      'findymail_verify_email',
      'findymail_find_email_from_name',
      'findymail_find_emails_by_domain',
      'findymail_find_email_from_linkedin',
      'findymail_reverse_email_lookup',
      'findymail_get_company',
      'findymail_find_employees',
      'findymail_find_phone',
      'findymail_search_technologies',
      'findymail_lookup_technologies',
      'findymail_get_credits',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'findymail_verify_email':
          case 'findymail_find_email_from_name':
          case 'findymail_find_emails_by_domain':
          case 'findymail_find_email_from_linkedin':
          case 'findymail_reverse_email_lookup':
          case 'findymail_get_company':
          case 'findymail_find_employees':
          case 'findymail_find_phone':
          case 'findymail_search_technologies':
          case 'findymail_lookup_technologies':
          case 'findymail_get_credits':
            return params.operation
          default:
            return 'findymail_find_email_from_name'
        }
      },
      params: (params) => {
        const result: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(params)) {
          if (value === undefined || value === null || value === '') continue
          if (key === 'count') {
            const n = Number(value)
            if (!Number.isNaN(n)) result[key] = n
          } else if (key === 'roles' || key === 'job_titles' || key === 'technologies') {
            if (Array.isArray(value)) {
              result[key] = value
            } else if (typeof value === 'string') {
              const trimmed = value.trim()
              if (trimmed.startsWith('[')) {
                try {
                  const parsed = JSON.parse(trimmed)
                  if (Array.isArray(parsed)) {
                    result[key] = parsed
                    continue
                  }
                } catch {
                  // fall through to comma-split
                }
              }
              result[key] = trimmed
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            }
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
    apiKey: { type: 'string', description: 'Findymail API key' },
    email: { type: 'string', description: 'Email address' },
    name: { type: 'string', description: 'Full name or company name' },
    domain: { type: 'string', description: 'Company domain' },
    linkedin_url: { type: 'string', description: 'LinkedIn profile or company URL' },
    roles: { type: 'array', description: 'Target roles (max 3)' },
    with_profile: { type: 'boolean', description: 'Return full profile data on reverse lookup' },
    website: { type: 'string', description: 'Company website for employee search' },
    job_titles: { type: 'array', description: 'Target job titles (max 10)' },
    count: { type: 'number', description: 'Number of contacts to return (max 5)' },
    q: { type: 'string', description: 'Technology search query' },
    technologies: { type: 'array', description: 'Technology names to filter by' },
  },
  outputs: {
    // Verify Email
    verified: { type: 'boolean', description: 'Whether the email is deliverable' },
    provider: { type: 'string', description: 'Email service provider' },
    // Find / Reverse / Company
    contact: {
      type: 'json',
      description: 'Contact found (name, email, domain)',
    },
    contacts: {
      type: 'array',
      description: 'Contacts found at the domain (name, email, domain)',
    },
    linkedin_url: { type: 'string', description: 'LinkedIn URL' },
    fullName: { type: 'string', description: 'Full name from LinkedIn profile' },
    username: { type: 'string', description: 'LinkedIn username' },
    headline: { type: 'string', description: 'Profile headline' },
    jobTitle: { type: 'string', description: 'Job title' },
    summary: { type: 'string', description: 'Profile summary' },
    city: { type: 'string', description: 'City' },
    region: { type: 'string', description: 'Region/state' },
    country: { type: 'string', description: 'Country' },
    companyLinkedinUrl: { type: 'string', description: 'Current company LinkedIn URL' },
    companyName: { type: 'string', description: 'Current company name' },
    companyWebsite: { type: 'string', description: 'Current company website' },
    isPremium: { type: 'boolean', description: 'Whether the profile has LinkedIn Premium' },
    isOpenProfile: { type: 'boolean', description: 'Whether the profile is open' },
    skills: { type: 'array', description: 'Profile skills' },
    jobs: { type: 'array', description: 'Job history entries' },
    educations: {
      type: 'array',
      description: 'Education history (school, degree, fieldOfStudy, startDate, endDate)',
    },
    certificates: {
      type: 'array',
      description: 'Certifications (name, issuingOrganization, issueDate, expirationDate)',
    },
    // Get Company
    name: { type: 'string', description: 'Company name (get-company)' },
    domain: { type: 'string', description: 'Company domain' },
    company_size: { type: 'string', description: 'Headcount range (e.g., 1001-5000)' },
    industry: { type: 'string', description: 'Industry classification' },
    description: { type: 'string', description: 'Company description' },
    // Find Employees
    employees: {
      type: 'array',
      description: 'Employees found (name, linkedinUrl, companyWebsite, companyName, jobTitle)',
    },
    // Find Phone
    phone: { type: 'string', description: 'Phone number in E.164 format (US only)' },
    line_type: { type: 'string', description: 'Phone line type (Mobile, Landline)' },
    // Technologies
    technologies: {
      type: 'array',
      description: 'Technologies (name, category, subcategory, last_detected_at)',
    },
    // Get Credits
    credits: { type: 'number', description: 'Remaining finder credits' },
    verifier_credits: { type: 'number', description: 'Remaining verifier credits' },
    // Reverse / Verify shared
    email: { type: 'string', description: 'Email address' },
  },
}
