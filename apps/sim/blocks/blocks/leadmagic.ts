import { LeadMagicIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { LeadMagicResponse } from '@/tools/leadmagic/types'

export const LeadMagicBlock: BlockConfig<LeadMagicResponse> = {
  type: 'leadmagic',
  name: 'LeadMagic',
  description: 'Find and enrich B2B contacts, emails, mobile numbers, and company data',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate LeadMagic to find verified work emails by name or company, validate email deliverability, find direct mobile numbers, enrich LinkedIn profiles, reverse-lookup profiles from emails, search companies by domain, identify role holders at accounts, and check account credit balance.',
  docsLink: 'https://docs.sim.ai/tools/leadmagic',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#FFFFFF',
  icon: LeadMagicIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Find Email', id: 'leadmagic_find_email' },
        { label: 'Validate Email', id: 'leadmagic_validate_email' },
        { label: 'Find Mobile', id: 'leadmagic_find_mobile' },
        { label: 'Profile Search', id: 'leadmagic_profile_search' },
        { label: 'Profile to Email', id: 'leadmagic_profile_to_email' },
        { label: 'Email to Profile', id: 'leadmagic_email_to_profile' },
        { label: 'Company Search', id: 'leadmagic_company_search' },
        { label: 'Role Finder', id: 'leadmagic_role_finder' },
        { label: 'Get Credits', id: 'leadmagic_get_credits' },
      ],
      value: () => 'leadmagic_find_email',
    },

    // --- Find Email ---
    {
      id: 'fe_full_name',
      title: 'Full Name',
      type: 'short-input',
      placeholder: 'John Doe',
      condition: { field: 'operation', value: 'leadmagic_find_email' },
    },
    {
      id: 'fe_domain',
      title: 'Company Domain',
      type: 'short-input',
      placeholder: 'stripe.com',
      condition: { field: 'operation', value: 'leadmagic_find_email' },
    },
    {
      id: 'fe_company_name',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Stripe (if domain unavailable)',
      condition: { field: 'operation', value: 'leadmagic_find_email' },
      mode: 'advanced',
    },

    // --- Validate Email ---
    {
      id: 've_email',
      title: 'Email Address',
      type: 'short-input',
      required: true,
      placeholder: 'john@example.com',
      condition: { field: 'operation', value: 'leadmagic_validate_email' },
    },

    // --- Find Mobile ---
    {
      id: 'fm_profile_url',
      title: 'LinkedIn Profile URL',
      type: 'short-input',
      placeholder: 'https://linkedin.com/in/johndoe',
      condition: { field: 'operation', value: 'leadmagic_find_mobile' },
    },
    {
      id: 'fm_work_email',
      title: 'Work Email',
      type: 'short-input',
      placeholder: 'john@company.com (alternative to profile URL)',
      condition: { field: 'operation', value: 'leadmagic_find_mobile' },
      mode: 'advanced',
    },

    // --- Profile Search ---
    {
      id: 'ps_profile_url',
      title: 'LinkedIn Profile URL',
      type: 'short-input',
      required: true,
      placeholder: 'https://linkedin.com/in/johndoe',
      condition: { field: 'operation', value: 'leadmagic_profile_search' },
    },
    {
      id: 'extended_response',
      title: 'Include Profile Image',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'leadmagic_profile_search' },
      mode: 'advanced',
    },

    // --- Profile to Email ---
    {
      id: 'pte_profile_url',
      title: 'LinkedIn Profile URL',
      type: 'short-input',
      required: true,
      placeholder: 'https://linkedin.com/in/johndoe',
      condition: { field: 'operation', value: 'leadmagic_profile_to_email' },
    },

    // --- Email to Profile ---
    {
      id: 'etp_work_email',
      title: 'Work Email',
      type: 'short-input',
      placeholder: 'john@company.com',
      condition: { field: 'operation', value: 'leadmagic_email_to_profile' },
    },
    {
      id: 'etp_personal_email',
      title: 'Personal Email',
      type: 'short-input',
      placeholder: 'john@gmail.com (alternative to work email)',
      condition: { field: 'operation', value: 'leadmagic_email_to_profile' },
      mode: 'advanced',
    },

    // --- Company Search ---
    {
      id: 'cs_company_domain',
      title: 'Company Domain',
      type: 'short-input',
      placeholder: 'stripe.com',
      condition: { field: 'operation', value: 'leadmagic_company_search' },
    },
    {
      id: 'cs_profile_url',
      title: 'LinkedIn Company URL',
      type: 'short-input',
      placeholder: 'https://linkedin.com/company/stripe',
      condition: { field: 'operation', value: 'leadmagic_company_search' },
      mode: 'advanced',
    },
    {
      id: 'cs_company_name',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Stripe',
      condition: { field: 'operation', value: 'leadmagic_company_search' },
      mode: 'advanced',
    },

    // --- Role Finder ---
    {
      id: 'rf_job_title',
      title: 'Job Title',
      type: 'short-input',
      required: true,
      placeholder: 'Head of Sales',
      condition: { field: 'operation', value: 'leadmagic_role_finder' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a specific job title to search for at the company. Return ONLY the job title — no explanations or extra text.',
        placeholder: 'e.g. Head of Sales, CTO, VP Engineering',
      },
    },
    {
      id: 'rf_company_domain',
      title: 'Company Domain',
      type: 'short-input',
      placeholder: 'stripe.com',
      condition: { field: 'operation', value: 'leadmagic_role_finder' },
    },
    {
      id: 'rf_company_name',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Stripe (if domain unavailable)',
      condition: { field: 'operation', value: 'leadmagic_role_finder' },
      mode: 'advanced',
    },

    // API Key — hidden on hosted Sim for operations with hosted-key support
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your LeadMagic API key',
      password: true,
      hideWhenHosted: true,
      condition: { field: 'operation', value: 'leadmagic_get_credits', not: true },
    },
    // API Key — always required for the credit-balance lookup (no hosted key)
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your LeadMagic API key',
      password: true,
      condition: { field: 'operation', value: 'leadmagic_get_credits' },
    },
  ],

  tools: {
    access: [
      'leadmagic_validate_email',
      'leadmagic_find_email',
      'leadmagic_find_mobile',
      'leadmagic_profile_search',
      'leadmagic_profile_to_email',
      'leadmagic_email_to_profile',
      'leadmagic_company_search',
      'leadmagic_role_finder',
      'leadmagic_get_credits',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'leadmagic_validate_email':
          case 'leadmagic_find_email':
          case 'leadmagic_find_mobile':
          case 'leadmagic_profile_search':
          case 'leadmagic_profile_to_email':
          case 'leadmagic_email_to_profile':
          case 'leadmagic_company_search':
          case 'leadmagic_role_finder':
          case 'leadmagic_get_credits':
            return params.operation
          default:
            return 'leadmagic_find_email'
        }
      },
      params: (params) => {
        const { operation: _operation, ...rest } = params

        const idToParam: Record<string, string> = {
          // Find Email
          fe_full_name: 'full_name',
          fe_domain: 'domain',
          fe_company_name: 'company_name',
          // Validate Email
          ve_email: 'email',
          // Find Mobile
          fm_profile_url: 'profile_url',
          fm_work_email: 'work_email',
          // Profile Search
          ps_profile_url: 'profile_url',
          // Profile to Email
          pte_profile_url: 'profile_url',
          // Email to Profile
          etp_work_email: 'work_email',
          etp_personal_email: 'personal_email',
          // Company Search
          cs_company_domain: 'company_domain',
          cs_profile_url: 'profile_url',
          cs_company_name: 'company_name',
          // Role Finder
          rf_job_title: 'job_title',
          rf_company_domain: 'company_domain',
          rf_company_name: 'company_name',
        }

        const result: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(rest)) {
          if (value === undefined || value === null || value === '') continue
          const mappedKey = idToParam[key] ?? key
          if (mappedKey === 'extended_response') {
            result[mappedKey] = value === true || value === 'true'
          } else {
            result[mappedKey] = value
          }
        }
        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'LeadMagic API key' },
    // Find Email
    fe_full_name: { type: 'string', description: 'Full name (find email)' },
    fe_domain: { type: 'string', description: 'Company domain (find email)' },
    fe_company_name: { type: 'string', description: 'Company name (find email)' },
    // Validate Email
    ve_email: { type: 'string', description: 'Email address to validate' },
    // Find Mobile
    fm_profile_url: { type: 'string', description: 'LinkedIn profile URL (find mobile)' },
    fm_work_email: { type: 'string', description: 'Work email (find mobile)' },
    // Profile Search
    ps_profile_url: { type: 'string', description: 'LinkedIn profile URL (profile search)' },
    extended_response: { type: 'boolean', description: 'Include profile image URL' },
    // Profile to Email
    pte_profile_url: { type: 'string', description: 'LinkedIn profile URL (profile to email)' },
    // Email to Profile
    etp_work_email: { type: 'string', description: 'Work email (email to profile)' },
    etp_personal_email: { type: 'string', description: 'Personal email (email to profile)' },
    // Company Search
    cs_company_domain: { type: 'string', description: 'Company domain (company search)' },
    cs_profile_url: { type: 'string', description: 'LinkedIn company URL (company search)' },
    cs_company_name: { type: 'string', description: 'Company name (company search)' },
    // Role Finder
    rf_job_title: { type: 'string', description: 'Job title to find (role finder)' },
    rf_company_domain: { type: 'string', description: 'Company domain (role finder)' },
    rf_company_name: { type: 'string', description: 'Company name (role finder)' },
  },

  outputs: {
    // Shared
    credits_consumed: { type: 'number', description: 'Credits charged for this request' },
    message: { type: 'string', description: 'Human-readable status message' },
    // Validate Email
    email_status: {
      type: 'string',
      description: 'Validation result: valid, invalid, or unknown',
    },
    is_domain_catch_all: { type: 'boolean', description: 'Whether the domain is a catch-all' },
    mx_record: { type: 'string', description: 'MX record for the domain' },
    mx_provider: { type: 'string', description: 'Email provider (Google, Microsoft, etc.)' },
    mx_gateway: { type: 'string', description: 'MX gateway for the domain' },
    mx_security_gateway: {
      type: 'boolean',
      description: 'Whether the domain uses a security gateway',
    },
    // Find Email / Profile To Email / Validate
    email: { type: 'string', description: 'Email address' },
    employment_verified: { type: 'boolean', description: 'Whether employment was verified' },
    has_mx: { type: 'boolean', description: 'Whether the domain has a valid MX record' },
    company_profile_url: { type: 'string', description: 'Company B2B profile URL' },
    // Find Mobile
    mobile_number: { type: 'string', description: 'Direct mobile phone number' },
    // Profile Search
    first_name: { type: 'string', description: 'First name' },
    last_name: { type: 'string', description: 'Last name' },
    full_name: { type: 'string', description: 'Full name' },
    professional_title: { type: 'string', description: 'Current job title' },
    bio: { type: 'string', description: 'Profile bio / summary' },
    location: { type: 'string', description: 'Location' },
    country: { type: 'string', description: 'Country' },
    followers_range: { type: 'string', description: 'LinkedIn follower range' },
    company_name: { type: 'string', description: 'Current employer name' },
    company_industry: { type: 'string', description: 'Company industry' },
    company_website: { type: 'string', description: 'Company website' },
    total_tenure_years: { type: 'string', description: 'Total career tenure in years' },
    total_tenure_months: { type: 'string', description: 'Total career tenure in months' },
    work_experience: { type: 'array', description: 'Work history entries' },
    education: { type: 'array', description: 'Education history entries' },
    certifications: { type: 'array', description: 'Professional certifications' },
    // Email to Profile
    profile_url: { type: 'string', description: 'LinkedIn profile URL' },
    // Company Search
    companyName: { type: 'string', description: 'Company name' },
    companyId: { type: 'number', description: 'Internal company ID' },
    industry: { type: 'string', description: 'Industry classification' },
    employeeCount: { type: 'number', description: 'Number of employees' },
    employeeRange: { type: 'string', description: 'Headcount range' },
    founded: { type: 'number', description: 'Year founded' },
    headquarters: { type: 'json', description: 'Headquarters location' },
    revenue: { type: 'string', description: 'Revenue range' },
    funding: { type: 'string', description: 'Total funding' },
    description: { type: 'string', description: 'Company description' },
    specialties: { type: 'array', description: 'Company specialties' },
    competitors: { type: 'array', description: 'Competitor companies' },
    followerCount: { type: 'number', description: 'LinkedIn follower count' },
    twitter_url: { type: 'string', description: 'Twitter/X profile URL' },
    facebook_url: { type: 'string', description: 'Facebook page URL' },
    b2b_profile_url: { type: 'string', description: 'LinkedIn company profile URL' },
    logo_url: { type: 'string', description: 'Company logo URL' },
    // Role Finder
    job_title: { type: 'string', description: 'Verified job title at the company' },
    // Get Credits
    credits: { type: 'number', description: 'Remaining credit balance' },
  },
}

export const LeadMagicBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://leadmagic.io',
} as const satisfies BlockMeta
