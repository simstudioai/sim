import { SixtyfourIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, IntegrationType } from '@/blocks/types'

export const SixtyfourBlock: BlockConfig = {
  type: 'sixtyfour',
  name: 'Sixtyfour AI',
  description: 'Enrich leads and companies with AI-powered research',
  longDescription:
    'Find emails, phone numbers, and enrich lead or company data with contact information, social profiles, and detailed research using Sixtyfour AI.',
  docsLink: 'https://docs.sim.ai/tools/sixtyfour',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  tags: ['enrichment', 'sales-engagement'],
  bgColor: '#000000',
  icon: SixtyfourIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Find Phone', id: 'find_phone' },
        { label: 'Find Email', id: 'find_email' },
        { label: 'Enrich Lead', id: 'enrich_lead' },
        { label: 'Enrich Company', id: 'enrich_company' },
      ],
      value: () => 'find_phone',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Sixtyfour API key',
      password: true,
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Full name of the person',
      required: { field: 'operation', value: ['find_phone', 'find_email'] },
      condition: { field: 'operation', value: ['find_phone', 'find_email'] },
    },
    {
      id: 'company',
      title: 'Company',
      type: 'short-input',
      placeholder: 'Company name',
      condition: { field: 'operation', value: ['find_phone', 'find_email'] },
    },
    {
      id: 'linkedinUrl',
      title: 'LinkedIn URL',
      type: 'short-input',
      placeholder: 'https://linkedin.com/in/johndoe',
      condition: { field: 'operation', value: ['find_phone', 'find_email'] },
      mode: 'advanced',
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'example.com',
      condition: { field: 'operation', value: ['find_phone', 'find_email'] },
      mode: 'advanced',
    },
    {
      id: 'emailInput',
      title: 'Email',
      type: 'short-input',
      placeholder: 'Email address',
      condition: { field: 'operation', value: 'find_phone' },
      mode: 'advanced',
    },
    {
      id: 'phoneInput',
      title: 'Phone',
      type: 'short-input',
      placeholder: 'Phone number',
      condition: { field: 'operation', value: 'find_email' },
      mode: 'advanced',
    },
    {
      id: 'title',
      title: 'Job Title',
      type: 'short-input',
      placeholder: 'Job title',
      condition: { field: 'operation', value: 'find_email' },
      mode: 'advanced',
    },
    {
      id: 'mode',
      title: 'Mode',
      type: 'dropdown',
      options: [
        { label: 'Professional', id: 'PROFESSIONAL' },
        { label: 'Personal', id: 'PERSONAL' },
      ],
      value: () => 'PROFESSIONAL',
      condition: { field: 'operation', value: 'find_email' },
    },
    {
      id: 'leadInfo',
      title: 'Lead Info',
      type: 'long-input',
      placeholder:
        '{"name": "John Doe", "company": "Acme Inc", "title": "CEO", "linkedin": "https://linkedin.com/in/johndoe"}',
      required: { field: 'operation', value: 'enrich_lead' },
      condition: { field: 'operation', value: 'enrich_lead' },
    },
    {
      id: 'leadStruct',
      title: 'Fields to Collect',
      type: 'long-input',
      placeholder:
        '{"email": "Email address", "phone": "Phone number", "company": "Company name", "title": "Job title"}',
      required: { field: 'operation', value: 'enrich_lead' },
      condition: { field: 'operation', value: 'enrich_lead' },
    },
    {
      id: 'leadResearchPlan',
      title: 'Research Plan',
      type: 'long-input',
      placeholder: 'Optional guidance for the enrichment agent',
      condition: { field: 'operation', value: 'enrich_lead' },
      mode: 'advanced',
    },
    {
      id: 'targetCompany',
      title: 'Company Info',
      type: 'long-input',
      placeholder: '{"name": "Acme Inc", "domain": "acme.com", "industry": "Technology"}',
      required: { field: 'operation', value: 'enrich_company' },
      condition: { field: 'operation', value: 'enrich_company' },
    },
    {
      id: 'companyStruct',
      title: 'Fields to Collect',
      type: 'long-input',
      placeholder:
        '{"website": "Company website URL", "num_employees": "Employee count", "address": "Company address"}',
      required: { field: 'operation', value: 'enrich_company' },
      condition: { field: 'operation', value: 'enrich_company' },
    },
    {
      id: 'findPeople',
      title: 'Find People',
      type: 'switch',
      condition: { field: 'operation', value: 'enrich_company' },
    },
    {
      id: 'peopleFocusPrompt',
      title: 'People Focus',
      type: 'short-input',
      placeholder: 'e.g. Find the VP of Marketing and the CTO',
      condition: { field: 'operation', value: 'enrich_company' },
      mode: 'advanced',
    },
    {
      id: 'fullOrgChart',
      title: 'Full Org Chart',
      type: 'switch',
      condition: { field: 'operation', value: 'enrich_company' },
      mode: 'advanced',
    },
    {
      id: 'companyLeadStruct',
      title: 'Lead Schema',
      type: 'long-input',
      placeholder: '{"name": "Full name", "email": "Email", "title": "Job title"}',
      condition: { field: 'operation', value: 'enrich_company' },
      mode: 'advanced',
    },
    {
      id: 'companyResearchPlan',
      title: 'Research Plan',
      type: 'long-input',
      placeholder: 'Optional guidance for the enrichment agent',
      condition: { field: 'operation', value: 'enrich_company' },
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'sixtyfour_find_phone',
      'sixtyfour_find_email',
      'sixtyfour_enrich_lead',
      'sixtyfour_enrich_company',
    ],
    config: {
      tool: (params) => `sixtyfour_${params.operation}`,
      params: (params) => {
        const result: Record<string, unknown> = {}

        if (params.operation === 'find_phone') {
          if (params.emailInput) result.email = params.emailInput
        } else if (params.operation === 'find_email') {
          if (params.phoneInput) result.phone = params.phoneInput
        } else if (params.operation === 'enrich_lead') {
          result.leadInfo = params.leadInfo
          result.struct = params.leadStruct
          if (params.leadResearchPlan) result.researchPlan = params.leadResearchPlan
        } else if (params.operation === 'enrich_company') {
          result.targetCompany = params.targetCompany
          result.struct = params.companyStruct
          if (params.findPeople !== undefined) result.findPeople = Boolean(params.findPeople)
          if (params.fullOrgChart !== undefined) result.fullOrgChart = Boolean(params.fullOrgChart)
          if (params.peopleFocusPrompt) result.peopleFocusPrompt = params.peopleFocusPrompt
          if (params.companyLeadStruct) result.leadStruct = params.companyLeadStruct
          if (params.companyResearchPlan) result.researchPlan = params.companyResearchPlan
        }

        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Sixtyfour API key' },
    name: { type: 'string', description: 'Person name' },
    company: { type: 'string', description: 'Company name' },
    linkedinUrl: { type: 'string', description: 'LinkedIn URL' },
    domain: { type: 'string', description: 'Company domain' },
    emailInput: { type: 'string', description: 'Email address (find phone)' },
    phoneInput: { type: 'string', description: 'Phone number (find email)' },
    title: { type: 'string', description: 'Job title' },
    mode: { type: 'string', description: 'Email mode (PROFESSIONAL or PERSONAL)' },
    leadInfo: { type: 'string', description: 'Lead information JSON' },
    leadStruct: { type: 'string', description: 'Fields to collect for lead' },
    leadResearchPlan: { type: 'string', description: 'Research plan for lead enrichment' },
    targetCompany: { type: 'string', description: 'Company information JSON' },
    companyStruct: { type: 'string', description: 'Fields to collect for company' },
    findPeople: { type: 'boolean', description: 'Find associated people' },
    fullOrgChart: { type: 'boolean', description: 'Retrieve full org chart' },
    peopleFocusPrompt: { type: 'string', description: 'People focus description' },
    companyLeadStruct: { type: 'string', description: 'Lead schema for company enrichment' },
    companyResearchPlan: { type: 'string', description: 'Research plan for company enrichment' },
  },

  outputs: {
    name: {
      type: 'string',
      description: 'Name of the person (find_phone, find_email)',
    },
    company: {
      type: 'string',
      description: 'Company name (find_phone, find_email)',
    },
    phone: {
      type: 'string',
      description: 'Phone number(s) found (find_phone)',
    },
    linkedinUrl: {
      type: 'string',
      description: 'LinkedIn profile URL (find_phone, find_email)',
    },
    title: {
      type: 'string',
      description: 'Job title (find_email)',
    },
    emails: {
      type: 'json',
      description: 'Email addresses found with validation status and type (find_email)',
    },
    personalEmails: {
      type: 'json',
      description: 'Personal email addresses found in PERSONAL mode (find_email)',
    },
    notes: {
      type: 'string',
      description: 'Research notes (enrich_lead, enrich_company)',
    },
    structuredData: {
      type: 'json',
      description:
        'Enriched data matching the requested struct fields (enrich_lead, enrich_company)',
    },
    references: {
      type: 'json',
      description: 'Source URLs and descriptions used for enrichment (enrich_lead, enrich_company)',
    },
    confidenceScore: {
      type: 'number',
      description: 'Quality score for the returned data, 0-10 (enrich_lead, enrich_company)',
    },
  },
}
