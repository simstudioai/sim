import { SmarteIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { SmarteResponse } from '@/tools/smarte/types'

const PERSON_LOOKUP_FIELD = ['e_linkedinUrl', 'e_fullName', 'e_email'] as const
const MOBILE_LOOKUP_FIELD = ['m_linkedinUrl', 'm_fullName', 'm_email'] as const
const FUNDING_COMPANY_FIELD = ['f_companyName', 'f_companyWebsite', 'f_companyLinkedinUrl'] as const
const TECHNOLOGY_COMPANY_FIELD = [
  't_companyName',
  't_companyWebsite',
  't_companyLinkedinUrl',
] as const

const OPERATION_INPUT_PREFIX: Record<string, string> = {
  smarte_enrich_person: 'p_',
  smarte_enrich_company: 'c_',
  smarte_enrich_email: 'e_',
  smarte_enrich_mobile: 'm_',
  smarte_enrich_funding: 'f_',
  smarte_enrich_technographics: 't_',
}

const INPUT_PARAM_MAP: Record<string, string> = {
  apiKey: 'apiKey',
  p_recordId: 'recordId',
  p_experienceId: 'experienceId',
  p_firstName: 'firstName',
  p_lastName: 'lastName',
  p_fullName: 'fullName',
  p_email: 'email',
  p_jobTitle: 'jobTitle',
  p_linkedinUrl: 'linkedinUrl',
  p_companyId: 'companyId',
  p_companyName: 'companyName',
  p_companyWebsite: 'companyWebsite',
  p_companyLinkedinUrl: 'companyLinkedinUrl',
  c_recordId: 'recordId',
  c_companyId: 'companyId',
  c_companyName: 'companyName',
  c_companyWebsite: 'companyWebsite',
  c_companyLinkedinUrl: 'companyLinkedinUrl',
  e_recordId: 'recordId',
  e_experienceId: 'experienceId',
  e_firstName: 'firstName',
  e_lastName: 'lastName',
  e_fullName: 'fullName',
  e_email: 'email',
  e_jobTitle: 'jobTitle',
  e_linkedinUrl: 'linkedinUrl',
  e_companyId: 'companyId',
  e_companyName: 'companyName',
  e_companyWebsite: 'companyWebsite',
  e_companyLinkedinUrl: 'companyLinkedinUrl',
  m_recordId: 'recordId',
  m_experienceId: 'experienceId',
  m_firstName: 'firstName',
  m_lastName: 'lastName',
  m_fullName: 'fullName',
  m_email: 'email',
  m_jobTitle: 'jobTitle',
  m_linkedinUrl: 'linkedinUrl',
  m_companyId: 'companyId',
  m_companyName: 'companyName',
  m_companyWebsite: 'companyWebsite',
  m_companyLinkedinUrl: 'companyLinkedinUrl',
  f_companyId: 'companyId',
  f_companyName: 'companyName',
  f_companyWebsite: 'companyWebsite',
  f_companyLinkedinUrl: 'companyLinkedinUrl',
  t_companyId: 'companyId',
  t_companyName: 'companyName',
  t_companyWebsite: 'companyWebsite',
  t_companyLinkedinUrl: 'companyLinkedinUrl',
  t_product: 'product',
  t_vendor: 'vendor',
  t_category: 'category',
}

export const SmarteBlock: BlockConfig<SmarteResponse> = {
  type: 'smarte',
  name: 'SMARTe',
  description: 'Enrich people and companies with contact, funding, and technology data',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Use SMARTe to enrich person and company profiles, retrieve work emails and mobile numbers, research company funding, and identify technologies used by a company.',
  docsLink: 'https://docs.sim.ai/integrations/smarte',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#4622FF',
  iconColor: '#6D55FF',
  icon: SmarteIcon,
  canvasPresentation: {
    defaultTitle: 'SMARTe',
    operationSubBlockId: 'operation',
    sentences: {
      byOperation: {
        smarte_enrich_person: [
          { text: 'Enrich person', field: 'p_fullName', core: true },
          { text: 'at', field: 'p_companyName' },
        ],
        smarte_enrich_company: [{ text: 'Enrich company', field: 'c_companyName', core: true }],
        smarte_enrich_email: ['Find a work email', { text: 'for', field: PERSON_LOOKUP_FIELD }],
        smarte_enrich_mobile: ['Find a mobile number', { text: 'for', field: MOBILE_LOOKUP_FIELD }],
        smarte_enrich_funding: [
          'Research company funding',
          { text: 'for', field: FUNDING_COMPANY_FIELD },
        ],
        smarte_enrich_technographics: [
          'Identify technologies',
          { text: 'used by', field: TECHNOLOGY_COMPANY_FIELD },
          { text: ', in category', field: 't_category' },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Enrich Person', id: 'smarte_enrich_person' },
        { label: 'Enrich Company', id: 'smarte_enrich_company' },
        { label: 'Enrich Email', id: 'smarte_enrich_email' },
        { label: 'Enrich Mobile', id: 'smarte_enrich_mobile' },
        { label: 'Enrich Funding', id: 'smarte_enrich_funding' },
        { label: 'Enrich Technographics', id: 'smarte_enrich_technographics' },
      ],
      value: () => 'smarte_enrich_person',
    },
    {
      id: 'p_firstName',
      title: 'First Name',
      type: 'short-input',
      required: true,
      placeholder: 'Ada',
      condition: { field: 'operation', value: 'smarte_enrich_person' },
    },
    {
      id: 'p_lastName',
      title: 'Last Name',
      type: 'short-input',
      required: true,
      placeholder: 'Lovelace',
      condition: { field: 'operation', value: 'smarte_enrich_person' },
    },
    {
      id: 'p_fullName',
      title: 'Full Name',
      type: 'short-input',
      required: true,
      placeholder: 'Ada Lovelace',
      condition: { field: 'operation', value: 'smarte_enrich_person' },
    },
    {
      id: 'p_email',
      title: 'Email',
      type: 'short-input',
      required: true,
      placeholder: 'ada@example.com',
      condition: { field: 'operation', value: 'smarte_enrich_person' },
    },
    {
      id: 'p_jobTitle',
      title: 'Job Title',
      type: 'short-input',
      required: true,
      placeholder: 'Chief Technology Officer',
      condition: { field: 'operation', value: 'smarte_enrich_person' },
    },
    {
      id: 'p_linkedinUrl',
      title: 'LinkedIn URL',
      type: 'short-input',
      required: true,
      placeholder: 'https://www.linkedin.com/in/ada-lovelace',
      condition: { field: 'operation', value: 'smarte_enrich_person' },
    },
    {
      id: 'p_recordId',
      title: 'Record ID',
      type: 'short-input',
      placeholder: 'Your reference identifier',
      condition: { field: 'operation', value: 'smarte_enrich_person' },
      mode: 'advanced',
    },
    {
      id: 'p_experienceId',
      title: 'Experience ID',
      type: 'short-input',
      placeholder: 'SMARTe experience identifier',
      condition: { field: 'operation', value: 'smarte_enrich_person' },
      mode: 'advanced',
    },
    {
      id: 'p_companyId',
      title: 'Company ID',
      type: 'short-input',
      placeholder: 'SMARTe company identifier',
      condition: { field: 'operation', value: 'smarte_enrich_person' },
      mode: 'advanced',
    },
    {
      id: 'p_companyName',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Analytical Engines',
      condition: { field: 'operation', value: 'smarte_enrich_person' },
      mode: 'advanced',
    },
    {
      id: 'p_companyWebsite',
      title: 'Company Website',
      type: 'short-input',
      placeholder: 'example.com',
      condition: { field: 'operation', value: 'smarte_enrich_person' },
      mode: 'advanced',
    },
    {
      id: 'p_companyLinkedinUrl',
      title: 'Company LinkedIn URL',
      type: 'short-input',
      placeholder: 'https://www.linkedin.com/company/example',
      condition: { field: 'operation', value: 'smarte_enrich_person' },
      mode: 'advanced',
    },
    {
      id: 'c_companyId',
      title: 'Company ID',
      type: 'short-input',
      required: true,
      placeholder: 'SMARTe company identifier',
      condition: { field: 'operation', value: 'smarte_enrich_company' },
    },
    {
      id: 'c_companyName',
      title: 'Company Name',
      type: 'short-input',
      required: true,
      placeholder: 'Acme',
      condition: { field: 'operation', value: 'smarte_enrich_company' },
    },
    {
      id: 'c_companyWebsite',
      title: 'Company Website',
      type: 'short-input',
      required: true,
      placeholder: 'acme.com',
      condition: { field: 'operation', value: 'smarte_enrich_company' },
    },
    {
      id: 'c_companyLinkedinUrl',
      title: 'Company LinkedIn URL',
      type: 'short-input',
      required: true,
      placeholder: 'https://www.linkedin.com/company/acme',
      condition: { field: 'operation', value: 'smarte_enrich_company' },
    },
    {
      id: 'c_recordId',
      title: 'Record ID',
      type: 'short-input',
      placeholder: 'Your reference identifier',
      condition: { field: 'operation', value: 'smarte_enrich_company' },
      mode: 'advanced',
    },
    {
      id: 'e_linkedinUrl',
      title: 'LinkedIn URL',
      type: 'short-input',
      placeholder: 'https://www.linkedin.com/in/ada-lovelace',
      condition: { field: 'operation', value: 'smarte_enrich_email' },
    },
    {
      id: 'e_fullName',
      title: 'Full Name',
      type: 'short-input',
      placeholder: 'Ada Lovelace',
      condition: { field: 'operation', value: 'smarte_enrich_email' },
    },
    {
      id: 'e_email',
      title: 'Known Email',
      type: 'short-input',
      placeholder: 'ada@example.com',
      condition: { field: 'operation', value: 'smarte_enrich_email' },
    },
    {
      id: 'e_companyName',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Acme',
      condition: { field: 'operation', value: 'smarte_enrich_email' },
    },
    {
      id: 'e_companyWebsite',
      title: 'Company Website',
      type: 'short-input',
      placeholder: 'acme.com',
      condition: { field: 'operation', value: 'smarte_enrich_email' },
    },
    {
      id: 'e_recordId',
      title: 'Record ID',
      type: 'short-input',
      placeholder: 'Your reference identifier',
      condition: { field: 'operation', value: 'smarte_enrich_email' },
      mode: 'advanced',
    },
    {
      id: 'e_experienceId',
      title: 'Experience ID',
      type: 'short-input',
      placeholder: 'SMARTe experience identifier',
      condition: { field: 'operation', value: 'smarte_enrich_email' },
      mode: 'advanced',
    },
    {
      id: 'e_firstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'Ada',
      condition: { field: 'operation', value: 'smarte_enrich_email' },
      mode: 'advanced',
    },
    {
      id: 'e_lastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Lovelace',
      condition: { field: 'operation', value: 'smarte_enrich_email' },
      mode: 'advanced',
    },
    {
      id: 'e_jobTitle',
      title: 'Job Title',
      type: 'short-input',
      placeholder: 'Chief Technology Officer',
      condition: { field: 'operation', value: 'smarte_enrich_email' },
      mode: 'advanced',
    },
    {
      id: 'e_companyId',
      title: 'Company ID',
      type: 'short-input',
      placeholder: 'SMARTe company identifier',
      condition: { field: 'operation', value: 'smarte_enrich_email' },
      mode: 'advanced',
    },
    {
      id: 'e_companyLinkedinUrl',
      title: 'Company LinkedIn URL',
      type: 'short-input',
      placeholder: 'https://www.linkedin.com/company/acme',
      condition: { field: 'operation', value: 'smarte_enrich_email' },
      mode: 'advanced',
    },
    {
      id: 'm_linkedinUrl',
      title: 'LinkedIn URL',
      type: 'short-input',
      placeholder: 'https://www.linkedin.com/in/ada-lovelace',
      condition: { field: 'operation', value: 'smarte_enrich_mobile' },
    },
    {
      id: 'm_fullName',
      title: 'Full Name',
      type: 'short-input',
      placeholder: 'Ada Lovelace',
      condition: { field: 'operation', value: 'smarte_enrich_mobile' },
    },
    {
      id: 'm_email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'ada@example.com',
      condition: { field: 'operation', value: 'smarte_enrich_mobile' },
    },
    {
      id: 'm_companyName',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Acme',
      condition: { field: 'operation', value: 'smarte_enrich_mobile' },
    },
    {
      id: 'm_companyWebsite',
      title: 'Company Website',
      type: 'short-input',
      placeholder: 'acme.com',
      condition: { field: 'operation', value: 'smarte_enrich_mobile' },
    },
    {
      id: 'm_recordId',
      title: 'Record ID',
      type: 'short-input',
      placeholder: 'Your reference identifier',
      condition: { field: 'operation', value: 'smarte_enrich_mobile' },
      mode: 'advanced',
    },
    {
      id: 'm_experienceId',
      title: 'Experience ID',
      type: 'short-input',
      placeholder: 'SMARTe experience identifier',
      condition: { field: 'operation', value: 'smarte_enrich_mobile' },
      mode: 'advanced',
    },
    {
      id: 'm_firstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'Ada',
      condition: { field: 'operation', value: 'smarte_enrich_mobile' },
      mode: 'advanced',
    },
    {
      id: 'm_lastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Lovelace',
      condition: { field: 'operation', value: 'smarte_enrich_mobile' },
      mode: 'advanced',
    },
    {
      id: 'm_jobTitle',
      title: 'Job Title',
      type: 'short-input',
      placeholder: 'Chief Technology Officer',
      condition: { field: 'operation', value: 'smarte_enrich_mobile' },
      mode: 'advanced',
    },
    {
      id: 'm_companyId',
      title: 'Company ID',
      type: 'short-input',
      placeholder: 'SMARTe company identifier',
      condition: { field: 'operation', value: 'smarte_enrich_mobile' },
      mode: 'advanced',
    },
    {
      id: 'm_companyLinkedinUrl',
      title: 'Company LinkedIn URL',
      type: 'short-input',
      placeholder: 'https://www.linkedin.com/company/acme',
      condition: { field: 'operation', value: 'smarte_enrich_mobile' },
      mode: 'advanced',
    },
    {
      id: 'f_companyName',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Acme',
      condition: { field: 'operation', value: 'smarte_enrich_funding' },
    },
    {
      id: 'f_companyWebsite',
      title: 'Company Website',
      type: 'short-input',
      placeholder: 'acme.com',
      condition: { field: 'operation', value: 'smarte_enrich_funding' },
    },
    {
      id: 'f_companyLinkedinUrl',
      title: 'Company LinkedIn URL',
      type: 'short-input',
      placeholder: 'https://www.linkedin.com/company/acme',
      condition: { field: 'operation', value: 'smarte_enrich_funding' },
    },
    {
      id: 'f_companyId',
      title: 'Company ID',
      type: 'short-input',
      placeholder: 'SMARTe company identifier',
      condition: { field: 'operation', value: 'smarte_enrich_funding' },
      mode: 'advanced',
    },
    {
      id: 't_companyName',
      title: 'Company Name',
      type: 'short-input',
      placeholder: 'Acme',
      condition: { field: 'operation', value: 'smarte_enrich_technographics' },
    },
    {
      id: 't_companyWebsite',
      title: 'Company Website',
      type: 'short-input',
      placeholder: 'acme.com',
      condition: { field: 'operation', value: 'smarte_enrich_technographics' },
    },
    {
      id: 't_product',
      title: 'Product',
      type: 'short-input',
      placeholder: 'Salesforce',
      condition: { field: 'operation', value: 'smarte_enrich_technographics' },
    },
    {
      id: 't_vendor',
      title: 'Vendor',
      type: 'short-input',
      placeholder: 'Salesforce',
      condition: { field: 'operation', value: 'smarte_enrich_technographics' },
    },
    {
      id: 't_category',
      title: 'Category',
      type: 'short-input',
      placeholder: 'CRM',
      condition: { field: 'operation', value: 'smarte_enrich_technographics' },
    },
    {
      id: 't_companyId',
      title: 'Company ID',
      type: 'short-input',
      placeholder: 'SMARTe company identifier',
      condition: { field: 'operation', value: 'smarte_enrich_technographics' },
      mode: 'advanced',
    },
    {
      id: 't_companyLinkedinUrl',
      title: 'Company LinkedIn URL',
      type: 'short-input',
      placeholder: 'https://www.linkedin.com/company/acme',
      condition: { field: 'operation', value: 'smarte_enrich_technographics' },
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your SMARTe API key',
      password: true,
      hideWhenHosted: true,
    },
  ],
  tools: {
    access: [
      'smarte_enrich_company',
      'smarte_enrich_email',
      'smarte_enrich_funding',
      'smarte_enrich_mobile',
      'smarte_enrich_person',
      'smarte_enrich_technographics',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'smarte_enrich_company':
          case 'smarte_enrich_email':
          case 'smarte_enrich_funding':
          case 'smarte_enrich_mobile':
          case 'smarte_enrich_person':
          case 'smarte_enrich_technographics':
            return params.operation
          default:
            throw new Error(`Invalid SMARTe operation: ${String(params.operation)}`)
        }
      },
      params: (params) => {
        const operation = params.operation
        if (typeof operation !== 'string') {
          throw new Error('SMARTe operation must be a string')
        }
        const inputPrefix = OPERATION_INPUT_PREFIX[operation]
        if (!inputPrefix) {
          throw new Error(`Invalid SMARTe operation: ${operation}`)
        }

        const result: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(params)) {
          if (key === 'operation' || value === undefined || value === null || value === '') {
            continue
          }
          if (key !== 'apiKey' && !key.startsWith(inputPrefix)) {
            continue
          }
          const mappedKey = INPUT_PARAM_MAP[key]
          if (!mappedKey) {
            throw new Error(`Unknown SMARTe input: ${key}`)
          }
          result[mappedKey] = value
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'SMARTe enrichment operation' },
    apiKey: { type: 'string', description: 'SMARTe API key' },
    p_recordId: {
      type: 'string',
      description: 'Client reference identifier for person enrichment',
    },
    p_experienceId: { type: 'string', description: 'Experience identifier for person enrichment' },
    p_firstName: { type: 'string', description: 'First name for person enrichment' },
    p_lastName: { type: 'string', description: 'Last name for person enrichment' },
    p_fullName: { type: 'string', description: 'Full name for person enrichment' },
    p_email: { type: 'string', description: 'Email for person enrichment' },
    p_jobTitle: { type: 'string', description: 'Job title for person enrichment' },
    p_linkedinUrl: { type: 'string', description: 'LinkedIn URL for person enrichment' },
    p_companyId: { type: 'string', description: 'Company identifier for person enrichment' },
    p_companyName: { type: 'string', description: 'Company name for person enrichment' },
    p_companyWebsite: { type: 'string', description: 'Company website for person enrichment' },
    p_companyLinkedinUrl: {
      type: 'string',
      description: 'Company LinkedIn URL for person enrichment',
    },
    c_recordId: {
      type: 'string',
      description: 'Client reference identifier for company enrichment',
    },
    c_companyId: {
      type: 'string',
      description: 'SMARTe company identifier for company enrichment',
    },
    c_companyName: { type: 'string', description: 'Company name for company enrichment' },
    c_companyWebsite: { type: 'string', description: 'Company website for company enrichment' },
    c_companyLinkedinUrl: {
      type: 'string',
      description: 'Company LinkedIn URL for company enrichment',
    },
    e_recordId: { type: 'string', description: 'Client reference identifier for email enrichment' },
    e_experienceId: { type: 'string', description: 'Experience identifier for email enrichment' },
    e_firstName: { type: 'string', description: 'First name for email enrichment' },
    e_lastName: { type: 'string', description: 'Last name for email enrichment' },
    e_fullName: { type: 'string', description: 'Full name for email enrichment' },
    e_email: { type: 'string', description: 'Known email for email enrichment' },
    e_jobTitle: { type: 'string', description: 'Job title for email enrichment' },
    e_linkedinUrl: { type: 'string', description: 'LinkedIn URL for email enrichment' },
    e_companyId: { type: 'string', description: 'Company identifier for email enrichment' },
    e_companyName: { type: 'string', description: 'Company name for email enrichment' },
    e_companyWebsite: { type: 'string', description: 'Company website for email enrichment' },
    e_companyLinkedinUrl: {
      type: 'string',
      description: 'Company LinkedIn URL for email enrichment',
    },
    m_recordId: {
      type: 'string',
      description: 'Client reference identifier for mobile enrichment',
    },
    m_experienceId: { type: 'string', description: 'Experience identifier for mobile enrichment' },
    m_firstName: { type: 'string', description: 'First name for mobile enrichment' },
    m_lastName: { type: 'string', description: 'Last name for mobile enrichment' },
    m_fullName: { type: 'string', description: 'Full name for mobile enrichment' },
    m_email: { type: 'string', description: 'Email for mobile enrichment' },
    m_jobTitle: { type: 'string', description: 'Job title for mobile enrichment' },
    m_linkedinUrl: { type: 'string', description: 'LinkedIn URL for mobile enrichment' },
    m_companyId: { type: 'string', description: 'Company identifier for mobile enrichment' },
    m_companyName: { type: 'string', description: 'Company name for mobile enrichment' },
    m_companyWebsite: { type: 'string', description: 'Company website for mobile enrichment' },
    m_companyLinkedinUrl: {
      type: 'string',
      description: 'Company LinkedIn URL for mobile enrichment',
    },
    f_companyId: {
      type: 'string',
      description: 'SMARTe company identifier for funding enrichment',
    },
    f_companyName: { type: 'string', description: 'Company name for funding enrichment' },
    f_companyWebsite: { type: 'string', description: 'Company website for funding enrichment' },
    f_companyLinkedinUrl: {
      type: 'string',
      description: 'Company LinkedIn URL for funding enrichment',
    },
    t_companyId: {
      type: 'string',
      description: 'SMARTe company identifier for technographic enrichment',
    },
    t_companyName: { type: 'string', description: 'Company name for technographic enrichment' },
    t_companyWebsite: {
      type: 'string',
      description: 'Company website for technographic enrichment',
    },
    t_companyLinkedinUrl: {
      type: 'string',
      description: 'Company LinkedIn URL for technographic enrichment',
    },
    t_product: { type: 'string', description: 'Product filter for technographic enrichment' },
    t_vendor: { type: 'string', description: 'Vendor filter for technographic enrichment' },
    t_category: { type: 'string', description: 'Category filter for technographic enrichment' },
  },
  outputs: {
    records: {
      type: 'array',
      description: 'Enriched records using the selected operation documented response schema',
    },
    creditsDeducted: {
      type: 'number',
      description: 'Credits charged by SMARTe for the request',
    },
  },
}

export const SmarteBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://www.smarte.pro',
  templates: [
    {
      icon: SmarteIcon,
      title: 'SMARTe inbound lead enricher',
      prompt:
        'Build a workflow that receives an inbound lead, enriches the person and company with SMARTe, and writes the completed profile to a table for sales review.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
    },
    {
      icon: SmarteIcon,
      title: 'SMARTe work email finder',
      prompt:
        'Create a workflow that reads prospects from a table, uses SMARTe to retrieve each work email, and writes the enrichment status and email back to the row.',
      modules: ['tables', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: SmarteIcon,
      title: 'SMARTe mobile number finder',
      prompt:
        'Build a workflow that enriches target contacts with SMARTe mobile numbers and direct dials, then saves matched phone data for sales calling.',
      modules: ['tables', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
    },
    {
      icon: SmarteIcon,
      title: 'SMARTe target account researcher',
      prompt:
        'Create a workflow that enriches a list of target companies with SMARTe firmographic, financial, hierarchy, and location data for account planning.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: SmarteIcon,
      title: 'SMARTe funded-company prioritizer',
      prompt:
        'Build a scheduled workflow that enriches target companies with SMARTe funding data and flags recently funded accounts for sales follow-up.',
      modules: ['tables', 'scheduled', 'workflows'],
      category: 'sales',
      tags: ['sales', 'automation'],
    },
    {
      icon: SmarteIcon,
      title: 'SMARTe technology-stack segmenter',
      prompt:
        'Create a workflow that checks target companies with SMARTe technographic enrichment, groups accounts by product, vendor, or category, and writes the segments to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'research'],
    },
    {
      icon: SmarteIcon,
      title: 'SMARTe CRM contact gap filler',
      prompt:
        'Build a scheduled workflow that finds incomplete CRM contact records, uses SMARTe person, email, or mobile enrichment to fill documented fields, and updates matched records.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
    },
    {
      icon: SmarteIcon,
      title: 'SMARTe account qualification agent',
      prompt:
        'Create an agent workflow that enriches a company with SMARTe company, funding, and technographic data, summarizes the documented evidence, and routes qualified accounts to sales.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
  ],
  skills: [
    {
      name: 'enrich-inbound-lead',
      description: 'Complete an inbound lead profile with SMARTe person and company enrichment.',
      content:
        '# Enrich an Inbound Lead\n\nUse SMARTe to complete an inbound lead before routing it to sales.\n\n## Steps\n1. Collect every required person field from the inbound record.\n2. Run SMARTe person enrichment.\n3. Run company enrichment with all required company identifiers when company-level detail is needed.\n4. Keep the returned enrichment status and transaction identifier with each result.\n\n## Output\nReturn the documented person and company records, the enrichment status for each, and the credits deducted.',
    },
    {
      name: 'research-target-account',
      description: 'Build a documented firmographic and financial profile for a target company.',
      content:
        '# Research a Target Account\n\nUse SMARTe company enrichment to prepare an account profile.\n\n## Steps\n1. Gather the company ID, name, website, and LinkedIn URL required by the operation.\n2. Run company enrichment.\n3. Organize the returned firmographic, financial, hierarchy, location, and funding fields without inferring missing values.\n\n## Output\nReturn the company record, enrichment status, transaction identifier, and credits deducted.',
    },
    {
      name: 'prioritize-funded-accounts',
      description: 'Use SMARTe funding data to identify accounts with relevant financing activity.',
      content:
        '# Prioritize Funded Accounts\n\nUse SMARTe funding enrichment to review financing signals for target companies.\n\n## Steps\n1. Submit the available documented company identifiers.\n2. Run funding enrichment.\n3. Compare only the returned IPO, funding-round, and last-funding fields.\n4. Preserve no-match statuses instead of inventing missing financial data.\n\n## Output\nReturn each documented funding record, its enrichment status, transaction identifier, and credits deducted.',
    },
    {
      name: 'segment-by-technology',
      description: 'Segment target companies using SMARTe technographic records.',
      content:
        '# Segment by Technology\n\nUse SMARTe technographic enrichment to identify technology products, vendors, and categories associated with a company.\n\n## Steps\n1. Submit the available documented company identifiers.\n2. Add product, vendor, or category filters when the task calls for a specific technology segment.\n3. Run technographic enrichment.\n4. Group matches using only returned product, vendor, and category names.\n\n## Output\nReturn the documented technographic records, enrichment status, transaction identifier, and credits deducted.',
    },
  ],
} as const satisfies BlockMeta
