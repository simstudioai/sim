import { DatagmaBlockDisplay } from '@/blocks/blocks/datagma.display'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { DatagmaResponse } from '@/tools/datagma/types'

export const DatagmaBlock: BlockConfig<DatagmaResponse> = {
  ...DatagmaBlockDisplay,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Find Email', id: 'datagma_find_email' },
        { label: 'Enrich Person', id: 'datagma_enrich_person' },
        { label: 'Enrich Company', id: 'datagma_enrich_company' },
        { label: 'Find Phone', id: 'datagma_find_phone' },
        { label: 'Get Remaining Credits', id: 'datagma_get_credits' },
      ],
      value: () => 'datagma_find_email',
    },

    // -------------------------------------------------------------------------
    // Find Email
    // -------------------------------------------------------------------------
    {
      id: 'fe_fullName',
      title: 'Full Name',
      type: 'short-input',
      required: true,
      placeholder: 'John Doe',
      condition: { field: 'operation', value: 'datagma_find_email' },
    },
    {
      id: 'fe_company',
      title: 'Company Name or Domain',
      type: 'short-input',
      required: true,
      placeholder: 'stripe.com',
      condition: { field: 'operation', value: 'datagma_find_email' },
    },
    {
      id: 'fe_linkedInSlug',
      title: 'LinkedIn Company Slug',
      type: 'short-input',
      placeholder: 'https://linkedin.com/company/stripe',
      condition: { field: 'operation', value: 'datagma_find_email' },
      mode: 'advanced',
    },

    // -------------------------------------------------------------------------
    // Enrich Person
    // -------------------------------------------------------------------------
    {
      id: 'ep_data',
      title: 'Email, LinkedIn URL, or Full Name',
      type: 'short-input',
      required: true,
      placeholder: 'john@stripe.com or https://linkedin.com/in/johndoe or John Doe',
      condition: { field: 'operation', value: 'datagma_enrich_person' },
    },
    {
      id: 'ep_companyKeyword',
      title: 'Company (when using full name)',
      type: 'short-input',
      placeholder: 'Stripe',
      condition: { field: 'operation', value: 'datagma_enrich_person' },
    },
    {
      id: 'ep_phoneFull',
      title: 'Find Phone Number',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes (costs 30 extra credits if found)', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'datagma_enrich_person' },
    },
    {
      id: 'ep_countryCode',
      title: 'Country Code',
      type: 'short-input',
      placeholder: 'US',
      condition: { field: 'operation', value: 'datagma_enrich_person' },
      mode: 'advanced',
    },
    {
      id: 'ep_personFull',
      title: 'Include Full Profile',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes (education + work history)', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'datagma_enrich_person' },
      mode: 'advanced',
    },

    // -------------------------------------------------------------------------
    // Enrich Company
    // -------------------------------------------------------------------------
    {
      id: 'ec_data',
      title: 'Company Domain, Name, or SIREN',
      type: 'short-input',
      required: true,
      placeholder: 'stripe.com',
      condition: { field: 'operation', value: 'datagma_enrich_company' },
    },
    {
      id: 'ec_companyPremium',
      title: 'Include LinkedIn Data',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'datagma_enrich_company' },
      mode: 'advanced',
    },
    {
      id: 'ec_companyFull',
      title: 'Include Financial Data',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'datagma_enrich_company' },
      mode: 'advanced',
    },

    // -------------------------------------------------------------------------
    // Find Phone
    // -------------------------------------------------------------------------
    {
      id: 'fp_username',
      title: 'LinkedIn URL',
      type: 'short-input',
      required: true,
      placeholder: 'https://linkedin.com/in/johndoe',
      condition: { field: 'operation', value: 'datagma_find_phone' },
    },
    {
      id: 'fp_email',
      title: 'Email (improves accuracy)',
      type: 'short-input',
      placeholder: 'john@stripe.com',
      condition: { field: 'operation', value: 'datagma_find_phone' },
    },

    // -------------------------------------------------------------------------
    // API Key — hidden on hosted Sim for operations with hosted-key support
    // -------------------------------------------------------------------------
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Datagma API key',
      password: true,
      hideWhenHosted: true,
      condition: { field: 'operation', value: 'datagma_get_credits', not: true },
    },
    // API Key — always required for the credit-balance lookup (no hosted key)
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Datagma API key',
      password: true,
      condition: { field: 'operation', value: 'datagma_get_credits' },
    },
  ],

  tools: {
    access: [
      'datagma_find_email',
      'datagma_enrich_person',
      'datagma_enrich_company',
      'datagma_find_phone',
      'datagma_get_credits',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'datagma_find_email':
          case 'datagma_enrich_person':
          case 'datagma_enrich_company':
          case 'datagma_find_phone':
          case 'datagma_get_credits':
            return params.operation
          default:
            return 'datagma_find_email'
        }
      },
      params: (params) => {
        const { operation: _operation, ...rest } = params

        // Map unique subBlock IDs back to tool param names
        const idToParam: Record<string, string> = {
          fe_fullName: 'fullName',
          fe_company: 'company',
          fe_linkedInSlug: 'linkedInSlug',
          ep_data: 'data',
          ep_companyKeyword: 'companyKeyword',
          ep_phoneFull: 'phoneFull',
          ep_countryCode: 'countryCode',
          ep_personFull: 'personFull',
          ec_data: 'data',
          ec_companyPremium: 'companyPremium',
          ec_companyFull: 'companyFull',
          fp_username: 'username',
          fp_email: 'email',
        }

        const result: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(rest)) {
          if (value === undefined || value === null || value === '') continue
          const mappedKey = idToParam[key] ?? key

          // Coerce boolean-like dropdown values at execution time
          if (
            mappedKey === 'phoneFull' ||
            mappedKey === 'personFull' ||
            mappedKey === 'companyPremium' ||
            mappedKey === 'companyFull'
          ) {
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
    apiKey: { type: 'string', description: 'Datagma API key' },
    // Find Email
    fe_fullName: { type: 'string', description: "Person's full name (find email)" },
    fe_company: { type: 'string', description: 'Company name or domain (find email)' },
    fe_linkedInSlug: { type: 'string', description: 'LinkedIn company slug (find email)' },
    // Enrich Person
    ep_data: {
      type: 'string',
      description: 'Email, LinkedIn URL, or full name (enrich person)',
    },
    ep_companyKeyword: { type: 'string', description: 'Company keyword (enrich person)' },
    ep_phoneFull: { type: 'boolean', description: 'Find phone number (enrich person)' },
    ep_countryCode: { type: 'string', description: 'Country code (enrich person)' },
    ep_personFull: { type: 'boolean', description: 'Include full profile (enrich person)' },
    // Enrich Company
    ec_data: { type: 'string', description: 'Company domain, name, or SIREN (enrich company)' },
    ec_companyPremium: { type: 'boolean', description: 'Include LinkedIn data (enrich company)' },
    ec_companyFull: { type: 'boolean', description: 'Include financial data (enrich company)' },
    // Find Phone
    fp_username: { type: 'string', description: 'LinkedIn URL (find phone)' },
    fp_email: { type: 'string', description: 'Email address (find phone)' },
  },

  outputs: {
    // Find Email
    email: { type: 'string', description: 'Verified work email address' },
    emailStatus: { type: 'string', description: 'Email verification status' },
    emailDomain: { type: 'string', description: 'Email domain' },
    mxfound: { type: 'boolean', description: 'Whether MX records were found' },
    smtpCheck: { type: 'boolean', description: 'Whether SMTP validation succeeded' },
    catchAll: { type: 'boolean', description: 'Whether the domain is catch-all' },
    // Enrich Person
    name: { type: 'string', description: 'Full name' },
    firstName: { type: 'string', description: 'First name' },
    lastName: { type: 'string', description: 'Last name' },
    jobTitle: { type: 'string', description: 'Current job title' },
    company: { type: 'string', description: 'Current company name' },
    linkedInUrl: { type: 'string', description: 'LinkedIn profile URL' },
    location: { type: 'string', description: 'Location string' },
    country: { type: 'string', description: 'Country' },
    region: { type: 'string', description: 'Region/state' },
    city: { type: 'string', description: 'City' },
    extractedRole: { type: 'string', description: 'Extracted role category' },
    extractedSeniority: { type: 'string', description: 'Extracted seniority level' },
    twitter: { type: 'string', description: 'Twitter handle' },
    personConfidenceScore: {
      type: 'number',
      description: 'Confidence score for the person match',
    },
    // Enrich Company
    website: { type: 'string', description: 'Company website' },
    industries: { type: 'string', description: 'Industry classification' },
    companySize: { type: 'string', description: 'Employee headcount range' },
    type: { type: 'string', description: 'Company type (e.g., Private, Public)' },
    founded: { type: 'string', description: 'Year founded' },
    shortDescription: { type: 'string', description: 'Short company description' },
    revenueRange: { type: 'string', description: 'Estimated annual revenue range' },
    headquarters: { type: 'string', description: 'Headquarters location' },
    // Find Phone
    phone: { type: 'string', description: 'Mobile phone number' },
    countryCode: { type: 'string', description: 'Country code prefix' },
    isWhatsapp: { type: 'boolean', description: 'Whether the number is linked to WhatsApp' },
    // Get Credits
    credits: { type: 'number', description: 'Remaining Datagma credits' },
  },
}
