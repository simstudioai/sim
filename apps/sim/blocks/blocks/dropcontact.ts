import { DropcontactIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { DropcontactResponse } from '@/tools/dropcontact/types'

export const DropcontactBlock: BlockConfig<DropcontactResponse> = {
  type: 'dropcontact',
  name: 'Dropcontact',
  description: 'Enrich B2B contacts with verified email, phone, and company data',
  longDescription:
    'Use Dropcontact to verify and enrich B2B contacts. Submit a contact with their name, company, website, or LinkedIn URL and receive a verified professional email, phone number, company firmographics, and LinkedIn profile. Enrichment is async: Dropcontact processes the request, then Sim polls until the result is ready. Credits are only charged when a verified email is returned.',
  docsLink: 'https://docs.sim.ai/tools/dropcontact',
  category: 'tools',
  bgColor: '#0066FF',
  icon: DropcontactIcon,
  authMode: AuthMode.ApiKey,
  integrationType: IntegrationType.Sales,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [{ label: 'Enrich Contact', id: 'dropcontact_enrich_contact' }],
      value: () => 'dropcontact_enrich_contact',
    },

    // Enrich Contact fields
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'john.doe@acme.com',
      condition: { field: 'operation', value: 'dropcontact_enrich_contact' },
    },
    {
      id: 'first_name',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'John',
      condition: { field: 'operation', value: 'dropcontact_enrich_contact' },
    },
    {
      id: 'last_name',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Doe',
      condition: { field: 'operation', value: 'dropcontact_enrich_contact' },
    },
    {
      id: 'full_name',
      title: 'Full Name',
      type: 'short-input',
      placeholder: 'John Doe (alternative to first + last name)',
      condition: { field: 'operation', value: 'dropcontact_enrich_contact' },
      mode: 'advanced',
    },
    {
      id: 'company',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Acme Corp',
      condition: { field: 'operation', value: 'dropcontact_enrich_contact' },
    },
    {
      id: 'website',
      title: 'Company Website',
      type: 'short-input',
      placeholder: 'acme.com',
      condition: { field: 'operation', value: 'dropcontact_enrich_contact' },
    },
    {
      id: 'linkedin',
      title: 'LinkedIn URL',
      type: 'short-input',
      placeholder: 'https://linkedin.com/in/johndoe',
      condition: { field: 'operation', value: 'dropcontact_enrich_contact' },
      mode: 'advanced',
    },
    {
      id: 'num_siren',
      title: 'SIREN Number',
      type: 'short-input',
      placeholder: 'French company SIREN (optional)',
      condition: { field: 'operation', value: 'dropcontact_enrich_contact' },
      mode: 'advanced',
    },
    {
      id: 'phone',
      title: 'Phone',
      type: 'short-input',
      placeholder: '+1 555 555 5555',
      condition: { field: 'operation', value: 'dropcontact_enrich_contact' },
      mode: 'advanced',
    },
    {
      id: 'country',
      title: 'Country Code',
      type: 'short-input',
      placeholder: 'US',
      condition: { field: 'operation', value: 'dropcontact_enrich_contact' },
      mode: 'advanced',
    },
    {
      id: 'siren',
      title: 'Include SIREN Enrichment',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'dropcontact_enrich_contact' },
      mode: 'advanced',
    },
    {
      id: 'language',
      title: 'Language',
      type: 'short-input',
      placeholder: 'en',
      condition: { field: 'operation', value: 'dropcontact_enrich_contact' },
      mode: 'advanced',
    },

    // API Key — hidden on hosted Sim (hosted key handles it)
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Dropcontact API key',
      password: true,
      hideWhenHosted: true,
    },
  ],
  tools: {
    access: ['dropcontact_enrich_contact'],
    config: {
      tool: (_params) => 'dropcontact_enrich_contact',
      params: (params) => {
        const { operation: _operation, ...rest } = params
        const result: Record<string, unknown> = {}

        for (const [key, value] of Object.entries(rest)) {
          if (value === undefined || value === null || value === '') continue
          if (key === 'siren') {
            result[key] = value === true || value === 'true'
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
    apiKey: { type: 'string', description: 'Dropcontact API key' },
    email: { type: 'string', description: 'Contact email address' },
    first_name: { type: 'string', description: 'Contact first name' },
    last_name: { type: 'string', description: 'Contact last name' },
    full_name: { type: 'string', description: 'Contact full name' },
    company: { type: 'string', description: 'Company name' },
    website: { type: 'string', description: 'Company website' },
    linkedin: { type: 'string', description: 'LinkedIn profile URL' },
    num_siren: { type: 'string', description: 'French company SIREN number' },
    phone: { type: 'string', description: 'Phone number' },
    country: { type: 'string', description: 'Country code (ISO 3166-1 alpha-2)' },
    siren: { type: 'boolean', description: 'Include SIREN/SIRET enrichment (France only)' },
    language: { type: 'string', description: 'Language for returned data' },
  },
  outputs: {
    request_id: { type: 'string', description: 'Dropcontact async request ID' },
    email_found: { type: 'boolean', description: 'Whether a verified email was found' },
    email: { type: 'string', description: 'Primary verified email address' },
    emails: {
      type: 'array',
      description: 'All email addresses returned (each with email and qualification)',
    },
    qualification: {
      type: 'string',
      description: 'Email qualification (e.g. nominative@pro)',
    },
    first_name: { type: 'string', description: 'First name' },
    last_name: { type: 'string', description: 'Last name' },
    full_name: { type: 'string', description: 'Full name' },
    civility: { type: 'string', description: 'Civility (Mr, Mrs, etc.)' },
    phone: { type: 'string', description: 'Phone number' },
    mobile_phone: { type: 'string', description: 'Mobile phone number' },
    company: { type: 'string', description: 'Company name' },
    website: { type: 'string', description: 'Company website' },
    company_linkedin: { type: 'string', description: 'Company LinkedIn URL' },
    linkedin: { type: 'string', description: 'Personal LinkedIn URL' },
    country: { type: 'string', description: 'Country code (ISO 3166-1 alpha-2)' },
    siren: { type: 'string', description: 'French SIREN number' },
    siret: { type: 'string', description: 'French SIRET number' },
    siret_address: { type: 'string', description: 'SIRET registered address' },
    siret_zip: { type: 'string', description: 'SIRET registered postal code' },
    siret_city: { type: 'string', description: 'SIRET registered city' },
    vat: { type: 'string', description: 'VAT number' },
    nb_employees: { type: 'string', description: 'Employee count range' },
    employee_count: {
      type: 'number',
      description: 'Exact employee count (Growth plan and above)',
    },
    naf5_code: { type: 'string', description: 'NAF/APE code (France)' },
    naf5_des: {
      type: 'string',
      description: 'NAF/APE code description (France)',
    },
    industry: { type: 'string', description: 'Industry classification' },
    job: { type: 'string', description: 'Job title' },
    job_level: { type: 'string', description: 'Job seniority level' },
    job_function: { type: 'string', description: 'Job function' },
    company_turnover: {
      type: 'string',
      description: 'Company revenue/turnover range',
    },
    company_results: { type: 'string', description: 'Company net results' },
  },
}

export const DropcontactBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://www.dropcontact.com',
} as const satisfies BlockMeta
