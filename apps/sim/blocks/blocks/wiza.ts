import { WizaIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { WizaResponse } from '@/tools/wiza/types'

export const WizaBlock: BlockConfig<WizaResponse> = {
  type: 'wiza',
  name: 'Wiza',
  description: 'Find, enrich, and verify B2B contact data with Wiza',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrates Wiza into the workflow. Search prospects, enrich companies, reveal verified emails and phone numbers for individuals, and check your account credit balance.',
  docsLink: 'https://docs.sim.ai/tools/wiza',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  tags: ['enrichment', 'sales-engagement'],
  bgColor: '#9284BC',
  icon: WizaIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Prospect Search', id: 'prospect_search' },
        { label: 'Company Enrichment', id: 'company_enrichment' },
        { label: 'Start Individual Reveal', id: 'start_individual_reveal' },
        { label: 'Get Individual Reveal', id: 'get_individual_reveal' },
        { label: 'Get Credits', id: 'get_credits' },
      ],
      value: () => 'prospect_search',
    },
    {
      id: 'apiKey',
      title: 'Wiza API Key',
      type: 'short-input',
      placeholder: 'Enter your Wiza API key',
      password: true,
      required: true,
    },

    // Prospect Search
    {
      id: 'size',
      title: 'Sample Size',
      type: 'short-input',
      placeholder: '0-30 (default 0, returns total only)',
      condition: { field: 'operation', value: 'prospect_search' },
    },
    {
      id: 'job_title',
      title: 'Job Titles',
      type: 'code',
      placeholder: '[{"v":"CEO","s":"i"},{"v":"Founder","s":"i"}]',
      condition: { field: 'operation', value: 'prospect_search' },
      mode: 'advanced',
    },
    {
      id: 'job_title_level',
      title: 'Job Title Levels',
      type: 'code',
      placeholder: '["cxo", "director", "manager"]',
      condition: { field: 'operation', value: 'prospect_search' },
      mode: 'advanced',
    },
    {
      id: 'job_role',
      title: 'Job Roles',
      type: 'code',
      placeholder: '["sales", "engineering", "marketing"]',
      condition: { field: 'operation', value: 'prospect_search' },
      mode: 'advanced',
    },
    {
      id: 'job_sub_role',
      title: 'Job Sub-Roles',
      type: 'code',
      placeholder: '["software", "product"]',
      condition: { field: 'operation', value: 'prospect_search' },
      mode: 'advanced',
    },
    {
      id: 'first_name',
      title: 'First Names',
      type: 'code',
      placeholder: '["John", "Jane"]',
      condition: { field: 'operation', value: 'prospect_search' },
      mode: 'advanced',
    },
    {
      id: 'last_name',
      title: 'Last Names',
      type: 'code',
      placeholder: '["Smith", "Doe"]',
      condition: { field: 'operation', value: 'prospect_search' },
      mode: 'advanced',
    },
    {
      id: 'location',
      title: 'Person Locations',
      type: 'code',
      placeholder: '[{"v":{"country":"united states"},"b":"city","s":"i"}]',
      condition: { field: 'operation', value: 'prospect_search' },
      mode: 'advanced',
    },
    {
      id: 'skill',
      title: 'Skills',
      type: 'code',
      placeholder: '["python", "marketing"]',
      condition: { field: 'operation', value: 'prospect_search' },
      mode: 'advanced',
    },
    {
      id: 'school',
      title: 'Schools',
      type: 'code',
      placeholder: '["stanford university"]',
      condition: { field: 'operation', value: 'prospect_search' },
      mode: 'advanced',
    },
    {
      id: 'major',
      title: 'Majors',
      type: 'code',
      placeholder: '["computer science"]',
      condition: { field: 'operation', value: 'prospect_search' },
      mode: 'advanced',
    },
    {
      id: 'linkedin_slug',
      title: 'LinkedIn Slugs',
      type: 'code',
      placeholder: '["john-doe-123"]',
      condition: { field: 'operation', value: 'prospect_search' },
      mode: 'advanced',
    },
    {
      id: 'job_company',
      title: 'Current Companies',
      type: 'code',
      placeholder: '[{"v":"wiza","s":"i"}]',
      condition: { field: 'operation', value: 'prospect_search' },
      mode: 'advanced',
    },
    {
      id: 'past_company',
      title: 'Past Companies',
      type: 'code',
      placeholder: '[{"v":"google","s":"i"}]',
      condition: { field: 'operation', value: 'prospect_search' },
      mode: 'advanced',
    },
    {
      id: 'company_location',
      title: 'Company Locations',
      type: 'code',
      placeholder: '[{"v":{"country":"canada"},"b":"country","s":"i"}]',
      condition: { field: 'operation', value: 'prospect_search' },
      mode: 'advanced',
    },
    {
      id: 'company_industry',
      title: 'Company Industries',
      type: 'code',
      placeholder: '[{"v":"computer software","s":"i"}]',
      condition: { field: 'operation', value: 'prospect_search' },
      mode: 'advanced',
    },
    {
      id: 'company_size',
      title: 'Company Sizes',
      type: 'code',
      placeholder: '["11-50", "51-200"]',
      condition: { field: 'operation', value: 'prospect_search' },
      mode: 'advanced',
    },
    {
      id: 'company_type',
      title: 'Company Types',
      type: 'code',
      placeholder: '["private", "public"]',
      condition: { field: 'operation', value: 'prospect_search' },
      mode: 'advanced',
    },
    {
      id: 'filters',
      title: 'Full Filters Object (overrides above)',
      type: 'code',
      placeholder: '{"job_title":[{"v":"CEO","s":"i"}], "company_size":["11-50"]}',
      condition: { field: 'operation', value: 'prospect_search' },
      mode: 'advanced',
    },

    // Company Enrichment
    {
      id: 'company_name',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Wiza',
      condition: { field: 'operation', value: 'company_enrichment' },
    },
    {
      id: 'company_domain',
      title: 'Company Domain',
      type: 'short-input',
      placeholder: 'wiza.co',
      condition: { field: 'operation', value: 'company_enrichment' },
    },
    {
      id: 'company_linkedin_id',
      title: 'Company LinkedIn ID',
      type: 'short-input',
      placeholder: '11272782',
      condition: { field: 'operation', value: 'company_enrichment' },
      mode: 'advanced',
    },
    {
      id: 'company_linkedin_slug',
      title: 'Company LinkedIn Slug',
      type: 'short-input',
      placeholder: 'wizaco',
      condition: { field: 'operation', value: 'company_enrichment' },
      mode: 'advanced',
    },

    // Start Individual Reveal
    {
      id: 'enrichment_level',
      title: 'Enrichment Level',
      type: 'dropdown',
      options: [
        { label: 'None', id: 'none' },
        { label: 'Partial', id: 'partial' },
        { label: 'Phone', id: 'phone' },
        { label: 'Full', id: 'full' },
      ],
      value: () => 'partial',
      condition: { field: 'operation', value: 'start_individual_reveal' },
      required: { field: 'operation', value: 'start_individual_reveal' },
    },
    {
      id: 'profile_url',
      title: 'LinkedIn Profile URL',
      type: 'short-input',
      placeholder: 'https://linkedin.com/in/johndoe',
      condition: { field: 'operation', value: 'start_individual_reveal' },
    },
    {
      id: 'full_name',
      title: 'Full Name',
      type: 'short-input',
      placeholder: 'John Doe',
      condition: { field: 'operation', value: 'start_individual_reveal' },
    },
    {
      id: 'company',
      title: 'Company',
      type: 'short-input',
      placeholder: 'Wiza',
      condition: { field: 'operation', value: 'start_individual_reveal' },
    },
    {
      id: 'domain',
      title: 'Company Domain',
      type: 'short-input',
      placeholder: 'wiza.co',
      condition: { field: 'operation', value: 'start_individual_reveal' },
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'john@wiza.co',
      condition: { field: 'operation', value: 'start_individual_reveal' },
    },
    {
      id: 'accept_work',
      title: 'Accept Work Emails',
      type: 'switch',
      condition: { field: 'operation', value: 'start_individual_reveal' },
      mode: 'advanced',
    },
    {
      id: 'accept_personal',
      title: 'Accept Personal Emails',
      type: 'switch',
      condition: { field: 'operation', value: 'start_individual_reveal' },
      mode: 'advanced',
    },
    {
      id: 'callback_url',
      title: 'Callback URL',
      type: 'short-input',
      placeholder: 'https://example.com/wiza-callback',
      condition: { field: 'operation', value: 'start_individual_reveal' },
      mode: 'advanced',
    },

    // Get Individual Reveal
    {
      id: 'id',
      title: 'Reveal ID',
      type: 'short-input',
      placeholder: 'Reveal ID returned from Start Individual Reveal',
      condition: { field: 'operation', value: 'get_individual_reveal' },
      required: { field: 'operation', value: 'get_individual_reveal' },
    },
  ],

  tools: {
    access: [
      'wiza_prospect_search',
      'wiza_company_enrichment',
      'wiza_start_individual_reveal',
      'wiza_get_individual_reveal',
      'wiza_get_credits',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'prospect_search':
            return 'wiza_prospect_search'
          case 'company_enrichment':
            return 'wiza_company_enrichment'
          case 'start_individual_reveal':
            return 'wiza_start_individual_reveal'
          case 'get_individual_reveal':
            return 'wiza_get_individual_reveal'
          case 'get_credits':
            return 'wiza_get_credits'
          default:
            throw new Error(`Invalid Wiza operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const parsed: Record<string, unknown> = { ...params }

        const parseJsonField = (field: string) => {
          const value = parsed[field]
          if (typeof value === 'string' && value.trim() !== '') {
            try {
              parsed[field] = JSON.parse(value)
            } catch (err) {
              throw new Error(
                `Invalid JSON in Wiza "${field}" filter: ${err instanceof Error ? err.message : String(err)}`
              )
            }
          }
        }

        for (const field of [
          'filters',
          'first_name',
          'last_name',
          'job_title',
          'job_title_level',
          'job_role',
          'job_sub_role',
          'location',
          'skill',
          'school',
          'major',
          'linkedin_slug',
          'job_company',
          'past_company',
          'company_location',
          'company_industry',
          'company_size',
          'company_type',
        ]) {
          parseJsonField(field)
        }

        if (typeof parsed.size === 'string' && parsed.size.trim() !== '') {
          const n = Number(parsed.size)
          if (!Number.isNaN(n)) parsed.size = n
        }

        return parsed
      },
    },
  },

  inputs: {
    apiKey: { type: 'string', description: 'Wiza API key' },
    operation: { type: 'string', description: 'Operation to perform' },
    size: { type: 'number', description: 'Sample size for prospect search (0-30)' },
    filters: { type: 'json', description: 'Full filters object for prospect search' },
    first_name: { type: 'json', description: 'First name filter array' },
    last_name: { type: 'json', description: 'Last name filter array' },
    job_title: { type: 'json', description: 'Job title filter array' },
    job_title_level: { type: 'json', description: 'Job title level filter' },
    job_role: { type: 'json', description: 'Job role filter' },
    job_sub_role: { type: 'json', description: 'Job sub-role filter' },
    location: { type: 'json', description: 'Person location filter' },
    skill: { type: 'json', description: 'Skill filter' },
    school: { type: 'json', description: 'School filter' },
    major: { type: 'json', description: 'Major filter' },
    linkedin_slug: { type: 'json', description: 'LinkedIn slug filter' },
    job_company: { type: 'json', description: 'Current company filter' },
    past_company: { type: 'json', description: 'Past company filter' },
    company_location: { type: 'json', description: 'Company location filter' },
    company_industry: { type: 'json', description: 'Company industry filter' },
    company_size: { type: 'json', description: 'Company size filter' },
    company_type: { type: 'json', description: 'Company type filter' },
    company_name: { type: 'string', description: 'Company name' },
    company_domain: { type: 'string', description: 'Company domain' },
    company_linkedin_id: { type: 'string', description: 'Company LinkedIn ID' },
    company_linkedin_slug: { type: 'string', description: 'Company LinkedIn slug' },
    enrichment_level: { type: 'string', description: 'Enrichment level for individual reveal' },
    profile_url: { type: 'string', description: 'LinkedIn profile URL' },
    full_name: { type: 'string', description: 'Full name' },
    company: { type: 'string', description: 'Company' },
    domain: { type: 'string', description: 'Domain' },
    email: { type: 'string', description: 'Email address' },
    accept_work: { type: 'boolean', description: 'Whether to accept work emails' },
    accept_personal: { type: 'boolean', description: 'Whether to accept personal emails' },
    callback_url: { type: 'string', description: 'Callback URL' },
    id: { type: 'string', description: 'Individual reveal ID' },
  },

  outputs: {
    total: {
      type: 'number',
      description: 'Total prospects matching filters (prospect_search)',
    },
    profiles: {
      type: 'json',
      description:
        'Sample prospect profiles (prospect_search): [{full_name, linkedin_url, industry, job_title, job_title_role, job_title_sub_role, job_company_name, job_company_website, location_name}]',
    },
    id: {
      type: 'number',
      description: 'Reveal ID (start_individual_reveal, get_individual_reveal)',
    },
    status: {
      type: 'string',
      description:
        'Reveal status (start_individual_reveal, get_individual_reveal): queued | resolving | finished | failed',
    },
    is_complete: {
      type: 'boolean',
      description:
        'Whether the reveal has completed (start_individual_reveal, get_individual_reveal)',
    },
    name: { type: 'string', description: 'Full name (get_individual_reveal)' },
    company: { type: 'string', description: 'Company name (get_individual_reveal)' },
    enrichment_level: {
      type: 'string',
      description: 'Enrichment level used (get_individual_reveal)',
    },
    linkedin_profile_url: { type: 'string', description: 'LinkedIn URL (get_individual_reveal)' },
    title: { type: 'string', description: 'Job title (get_individual_reveal)' },
    location: { type: 'string', description: 'Location (get_individual_reveal)' },
    email: { type: 'string', description: 'Primary email (get_individual_reveal)' },
    email_type: { type: 'string', description: 'Primary email type (get_individual_reveal)' },
    email_status: {
      type: 'string',
      description: 'Primary email status: valid | risky | unfound (get_individual_reveal)',
    },
    emails: {
      type: 'json',
      description: 'All emails found (get_individual_reveal): [{email, email_type, email_status}]',
    },
    mobile_phone: { type: 'string', description: 'Mobile phone (get_individual_reveal)' },
    phone_number: { type: 'string', description: 'Direct/office phone (get_individual_reveal)' },
    phone_status: {
      type: 'string',
      description: 'Phone status: found | unfound (get_individual_reveal)',
    },
    phones: {
      type: 'json',
      description: 'All phones found (get_individual_reveal): [{number, pretty_number, type}]',
    },
    company_name: {
      type: 'string',
      description: 'Company name (company_enrichment)',
    },
    company_domain: {
      type: 'string',
      description: 'Company domain (company_enrichment, get_individual_reveal)',
    },
    domain: { type: 'string', description: 'Domain (company_enrichment)' },
    company_industry: {
      type: 'string',
      description: 'Industry (company_enrichment, get_individual_reveal)',
    },
    company_size: {
      type: 'number',
      description: 'Employee count (company_enrichment, get_individual_reveal)',
    },
    company_size_range: {
      type: 'string',
      description: 'Headcount range (company_enrichment, get_individual_reveal)',
    },
    company_founded: {
      type: 'number',
      description: 'Year founded (company_enrichment, get_individual_reveal)',
    },
    company_revenue_range: {
      type: 'string',
      description: 'Revenue range (company_enrichment)',
    },
    company_revenue: { type: 'string', description: 'Revenue (get_individual_reveal)' },
    company_funding: {
      type: 'string',
      description: 'Total funding (company_enrichment, get_individual_reveal)',
    },
    company_type: {
      type: 'string',
      description: 'Company type (company_enrichment, get_individual_reveal)',
    },
    company_description: {
      type: 'string',
      description: 'Company description (company_enrichment, get_individual_reveal)',
    },
    company_ticker: { type: 'string', description: 'Stock ticker (company_enrichment)' },
    company_last_funding_round: {
      type: 'string',
      description: 'Last funding round (company_enrichment)',
    },
    company_last_funding_amount: {
      type: 'string',
      description: 'Last funding amount (company_enrichment)',
    },
    company_last_funding_at: {
      type: 'string',
      description: 'Last funding date (company_enrichment)',
    },
    company_location: {
      type: 'string',
      description: 'Full location string (company_enrichment, get_individual_reveal)',
    },
    company_twitter: { type: 'string', description: 'Twitter URL (company_enrichment)' },
    company_facebook: { type: 'string', description: 'Facebook URL (company_enrichment)' },
    company_linkedin: {
      type: 'string',
      description: 'LinkedIn URL (company_enrichment, get_individual_reveal)',
    },
    company_linkedin_id: { type: 'string', description: 'LinkedIn ID (company_enrichment)' },
    company_street: {
      type: 'string',
      description: 'Street address (company_enrichment, get_individual_reveal)',
    },
    company_locality: {
      type: 'string',
      description: 'City (company_enrichment, get_individual_reveal)',
    },
    company_region: {
      type: 'string',
      description: 'State/region (company_enrichment, get_individual_reveal)',
    },
    company_postal_code: {
      type: 'string',
      description: 'Postal code (company_enrichment, get_individual_reveal)',
    },
    company_country: {
      type: 'string',
      description: 'Country (company_enrichment, get_individual_reveal)',
    },
    company_subindustry: { type: 'string', description: 'Subindustry (get_individual_reveal)' },
    credits: {
      type: 'json',
      description:
        'Credits deducted (company_enrichment, get_individual_reveal): { api_credits: { total, email_credits, phone_credits, scrape_credits } }',
    },
    email_credits: {
      type: 'json',
      description: 'Remaining email credits — number or "unlimited" (get_credits)',
    },
    phone_credits: {
      type: 'json',
      description: 'Remaining phone credits — number or "unlimited" (get_credits)',
    },
    export_credits: { type: 'number', description: 'Remaining export credits (get_credits)' },
    api_credits: { type: 'number', description: 'Remaining API credits (get_credits)' },
  },
}
