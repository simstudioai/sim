import { SixtyfourIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'

export const SixtyfourBlock: BlockConfig = {
  type: 'sixtyfour',
  name: 'Sixtyfour AI',
  description: 'Enrich leads and companies with AI-powered research',
  longDescription:
    'Find emails, phone numbers, and enrich lead or company data with contact information, social profiles, and detailed research using Sixtyfour AI.',
  docsLink: 'https://docs.sim.ai/integrations/sixtyfour',
  category: 'tools',
  integrationType: IntegrationType.Sales,
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
      description:
        'Email addresses found (find_email): [{address, status (OK|UNKNOWN|NOT_FOUND), type (COMPANY|PERSONAL)}]',
    },
    personalEmails: {
      type: 'json',
      description:
        'Personal email addresses found in PERSONAL mode (find_email): [{address, status, type}]',
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
    orgChart: {
      type: 'json',
      description: 'Org chart returned when fullOrgChart is enabled (enrich_company)',
    },
  },
}

export const SixtyfourBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://sixtyfour.ai',
  templates: [
    {
      icon: SixtyfourIcon,
      title: 'Sixtyfour contact researcher',
      prompt:
        'Build a workflow that runs Sixtyfour AI on inbound leads, enriches with deep research-grade signals, and writes a research brief into the CRM contact record.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['hubspot'],
    },
    {
      icon: SixtyfourIcon,
      title: 'Sixtyfour account intelligence',
      prompt:
        'Create a workflow that for tracked accounts runs Sixtyfour deep research weekly, surfaces new signals, and writes the digest into a research table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: SixtyfourIcon,
      title: 'Sixtyfour outbound briefer',
      prompt:
        'Build a workflow that runs Sixtyfour on a prospect, generates a tailored outreach brief with hooks, and queues it for the rep to send via Email Bison.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['emailbison'],
    },
    {
      icon: SixtyfourIcon,
      title: 'Sixtyfour event-attendee researcher',
      prompt:
        'Create a workflow that takes a Luma event attendee list, runs Sixtyfour deep research per attendee, and writes per-person briefs for the sales team.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['luma'],
    },
    {
      icon: SixtyfourIcon,
      title: 'Sixtyfour competitor-intel digest',
      prompt:
        'Build a scheduled weekly workflow that runs Sixtyfour deep research on competitors and writes a competitive-intel digest to a Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: SixtyfourIcon,
      title: 'Sixtyfour CRM enricher',
      prompt:
        'Create a scheduled workflow that finds CRM accounts missing deep-research signals, runs Sixtyfour, and writes the structured findings back to the account record.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: SixtyfourIcon,
      title: 'Sixtyfour deal-prep packet',
      prompt:
        'Build a workflow that runs Sixtyfour the morning of every meeting, generates a meeting-prep packet with company and attendee research, and emails the rep.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
      alsoIntegrations: ['gmail'],
    },
  ],
  skills: [
    {
      name: 'enrich-lead',
      description:
        'Enrich a single lead with Sixtyfour AI research to fill in role, company, and contact context.',
      content:
        '# Enrich Lead\n\nTurn a thin lead record into a researched profile.\n\n## Steps\n1. Run Enrich Lead with whatever you know about the person: name, company, email, or LinkedIn.\n2. Request only the fields you need to keep credit usage down.\n3. Review the returned profile: title, seniority, company, and any social or contact data.\n\n## Output\nReturn the enriched lead profile with the discovered role, company, and context, and note any fields the research could not resolve.',
    },
    {
      name: 'find-contact-details',
      description: 'Find a verified email or phone number for a prospect using Sixtyfour AI.',
      content:
        '# Find Contact Details\n\nLocate a reachable email or phone number for a prospect.\n\n## Steps\n1. Provide the person identity you have: name plus company or domain.\n2. Run Find Email to discover a work email, or Find Phone for a phone number. Choose the professional or personal type as appropriate.\n3. Validate that the result matches the intended person before using it.\n\n## Output\nReturn the discovered email or phone number with its type, and clearly state if no verified contact could be found.',
    },
    {
      name: 'enrich-company',
      description:
        'Research a company with Sixtyfour AI to build a firmographic and account-context profile.',
      content:
        '# Enrich Company\n\nBuild an account profile for a target company.\n\n## Steps\n1. Run Enrich Company with the company name or domain.\n2. Request the firmographic fields you need: industry, size, location, funding, and technologies in use.\n3. Use the result to qualify the account against your ideal customer profile.\n\n## Output\nReturn the company profile with industry, size, location, and notable signals, plus a short note on how well it fits the target profile.',
    },
  ],
} as const satisfies BlockMeta
