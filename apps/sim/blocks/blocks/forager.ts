import { ForagerIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { ForagerResponse } from '@/tools/forager/types'

const FORAGER_OPERATIONS = [
  'forager_job_search',
  'forager_job_search_totals',
  'forager_organization_search',
  'forager_organization_search_totals',
  'forager_person_personal_emails',
  'forager_person_phone_numbers',
  'forager_person_work_emails',
  'forager_person_detail',
  'forager_person_reverse_email',
  'forager_person_reverse_phone',
  'forager_person_role_search',
  'forager_person_role_search_totals',
  'forager_website_detail',
] as const

const PERSON_IDENTIFIER_OPERATIONS = [
  'forager_person_personal_emails',
  'forager_person_phone_numbers',
  'forager_person_work_emails',
  'forager_person_detail',
] as const

function parseJsonObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a JSON object`)
  }
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object')
    }
    return parsed as Record<string, unknown>
  } catch {
    throw new Error(`${fieldName} must be a valid JSON object`)
  }
}

function hasLookupValue(value: unknown): boolean {
  if (value === undefined || value === null) return false
  return typeof value !== 'string' || value.trim().length > 0
}

function assertLookupRequirements(operation: unknown, params: Record<string, unknown>): void {
  if (
    typeof operation === 'string' &&
    PERSON_IDENTIFIER_OPERATIONS.includes(
      operation as (typeof PERSON_IDENTIFIER_OPERATIONS)[number]
    )
  ) {
    if (!hasLookupValue(params.personId) && !hasLookupValue(params.linkedinPublicIdentifier)) {
      throw new Error('Forager person lookup requires Person ID or LinkedIn Public Identifier')
    }
  }

  if (operation === 'forager_website_detail') {
    if (
      !hasLookupValue(params.domain) &&
      !hasLookupValue(params.organizationId) &&
      !hasLookupValue(params.organizationLinkedinPublicIdentifier)
    ) {
      throw new Error(
        'Forager website lookup requires Domain, Organization ID, or Organization LinkedIn Public Identifier'
      )
    }
  }
}

export const ForagerBlock: BlockConfig<ForagerResponse> = {
  type: 'forager',
  name: 'Forager',
  description: 'Search and enrich people, contacts, organizations, roles, jobs, and websites',
  longDescription:
    'Integrate the Forager public API to search organizations, people and roles, and job posts; count matching datasets; retrieve person profiles; find work or personal emails and phone numbers; reverse-resolve contacts; and inspect website technologies and traffic ranks.',
  docsLink: 'https://docs.sim.ai/integrations/forager',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#5A42FF',
  icon: ForagerIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'Forager',
    sentences: {
      byOperation: {
        forager_job_search: ['Search Forager job posts'],
        forager_job_search_totals: ['Count matching Forager job posts'],
        forager_organization_search: ['Search Forager organizations'],
        forager_organization_search_totals: ['Count matching Forager organizations'],
        forager_person_personal_emails: [
          {
            text: 'Find personal emails for',
            field: ['personId', 'linkedinPublicIdentifier'],
            core: true,
          },
        ],
        forager_person_phone_numbers: [
          {
            text: 'Find phone numbers for',
            field: ['personId', 'linkedinPublicIdentifier'],
            core: true,
          },
        ],
        forager_person_work_emails: [
          {
            text: 'Find work emails for',
            field: ['personId', 'linkedinPublicIdentifier'],
            core: true,
          },
        ],
        forager_person_detail: [
          { text: 'Enrich person', field: ['personId', 'linkedinPublicIdentifier'], core: true },
        ],
        forager_person_reverse_email: [
          { text: 'Reverse-resolve email', field: 'email', core: true },
        ],
        forager_person_reverse_phone: [
          { text: 'Reverse-resolve phone', field: 'phoneNumber', core: true },
        ],
        forager_person_role_search: ['Search Forager people and roles'],
        forager_person_role_search_totals: ['Count matching Forager people and roles'],
        forager_website_detail: [
          {
            text: 'Enrich website',
            field: ['domain', 'organizationId', 'organizationLinkedinPublicIdentifier'],
            core: true,
          },
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
        { label: 'Search Jobs', id: 'forager_job_search' },
        { label: 'Count Jobs', id: 'forager_job_search_totals' },
        { label: 'Search Organizations', id: 'forager_organization_search' },
        { label: 'Count Organizations', id: 'forager_organization_search_totals' },
        { label: 'Find Personal Emails', id: 'forager_person_personal_emails' },
        { label: 'Find Phone Numbers', id: 'forager_person_phone_numbers' },
        { label: 'Find Work Emails', id: 'forager_person_work_emails' },
        { label: 'Get Person Details', id: 'forager_person_detail' },
        { label: 'Reverse Lookup Email', id: 'forager_person_reverse_email' },
        { label: 'Reverse Lookup Phone', id: 'forager_person_reverse_phone' },
        { label: 'Search Person Roles', id: 'forager_person_role_search' },
        { label: 'Count Person Roles', id: 'forager_person_role_search_totals' },
        { label: 'Get Website Details', id: 'forager_website_detail' },
      ],
      value: () => 'forager_person_detail',
    },
    {
      id: 'jobFilters',
      title: 'Job Search Filters',
      type: 'code',
      language: 'json',
      placeholder:
        '{"title":"software AND engineer","is_remote":true,"is_active":true,"locations":[123]}',
      condition: {
        field: 'operation',
        value: ['forager_job_search', 'forager_job_search_totals'],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Build a Forager JobPostEventSearch JSON object. Allowed keys are page, job_source (indeed, linkedin, angellist), date_featured_start, date_featured_end, organization_ids, title, description, is_remote, is_active, locations, and locations_exclude. Dates use YYYY-MM-DD and ID fields are integer arrays. Return only the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'organizationFilters',
      title: 'Organization Search Filters',
      type: 'code',
      language: 'json',
      placeholder:
        '{"domains":["example.com"],"employees_start":50,"employees_end":500,"funding_types":["series_b"]}',
      condition: {
        field: 'operation',
        value: ['forager_organization_search', 'forager_organization_search_totals'],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Build a Forager OrganizationSearchRequest JSON object using documented firmographic, location, industry, domain, LinkedIn, technology, funding, job-post, and simple-event keys. Dates use YYYY-MM-DD and ID filters are integer arrays. Return only the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'roleFilters',
      title: 'Person Role Search Filters',
      type: 'code',
      language: 'json',
      placeholder:
        '{"role_title":"VP Sales OR Head of Sales","role_is_current":true,"organization_domains":["example.com"]}',
      condition: {
        field: 'operation',
        value: ['forager_person_role_search', 'forager_person_role_search_totals'],
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Build a Forager OrganizationPersonRoleSearch JSON object using documented role, person, organization, funding, job-post, and simple-event keys. Dates use YYYY-MM-DD and ID filters are integer arrays. Return only the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'personId',
      title: 'Person ID',
      type: 'short-input',
      placeholder: '12345',
      description: 'Required unless LinkedIn Public Identifier is provided',
      required: false,
      condition: { field: 'operation', value: [...PERSON_IDENTIFIER_OPERATIONS] },
    },
    {
      id: 'linkedinPublicIdentifier',
      title: 'LinkedIn Public Identifier',
      type: 'short-input',
      placeholder: 'jane-doe',
      description: 'Required unless Person ID is provided',
      required: false,
      condition: { field: 'operation', value: [...PERSON_IDENTIFIER_OPERATIONS] },
    },
    {
      id: 'doContactsEnrichment',
      title: 'Perform Contact Enrichment',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'forager_person_work_emails' },
      mode: 'advanced',
    },
    {
      id: 'email',
      title: 'Personal Email',
      type: 'short-input',
      required: true,
      placeholder: 'jane@example.com',
      condition: { field: 'operation', value: 'forager_person_reverse_email' },
    },
    {
      id: 'phoneNumber',
      title: 'Phone Number',
      type: 'short-input',
      required: true,
      placeholder: '+14155550123',
      condition: { field: 'operation', value: 'forager_person_reverse_phone' },
    },
    {
      id: 'domain',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'example.com',
      description:
        'Required unless Organization ID or Organization LinkedIn Public Identifier is provided',
      required: false,
      condition: { field: 'operation', value: 'forager_website_detail' },
    },
    {
      id: 'organizationId',
      title: 'Organization ID',
      type: 'short-input',
      placeholder: '12345',
      description: 'Required unless Domain or Organization LinkedIn Public Identifier is provided',
      required: false,
      condition: { field: 'operation', value: 'forager_website_detail' },
      mode: 'advanced',
    },
    {
      id: 'organizationLinkedinPublicIdentifier',
      title: 'Organization LinkedIn Public Identifier',
      type: 'short-input',
      placeholder: 'example-company',
      description: 'Required unless Domain or Organization ID is provided',
      required: false,
      condition: { field: 'operation', value: 'forager_website_detail' },
      mode: 'advanced',
    },
    {
      id: 'accountId',
      title: 'Account ID',
      type: 'short-input',
      placeholder: 'Optional for API keys with exactly one Forager account',
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your Forager API key',
      password: true,
      hideWhenHosted: true,
    },
  ],
  tools: {
    access: [...FORAGER_OPERATIONS],
    config: {
      tool: (params) => {
        if (
          typeof params.operation === 'string' &&
          FORAGER_OPERATIONS.includes(params.operation as (typeof FORAGER_OPERATIONS)[number])
        ) {
          return params.operation
        }
        throw new Error(`Unsupported Forager operation: ${String(params.operation)}`)
      },
      params: (params) => {
        const result: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(params)) {
          if (key === 'operation' || value === undefined || value === null || value === '') continue
          if (key === 'jobFilters' || key === 'organizationFilters' || key === 'roleFilters') {
            result.filters = parseJsonObject(value, key)
          } else if (key === 'personId' || key === 'organizationId' || key === 'accountId') {
            const numberValue = Number(value)
            if (!Number.isInteger(numberValue) || numberValue <= 0) {
              throw new Error(`${key} must be a positive integer`)
            }
            result[key] = numberValue
          } else if (key === 'doContactsEnrichment') {
            result[key] = value === true || value === 'true'
          } else {
            result[key] = value
          }
        }
        assertLookupRequirements(params.operation, result)
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Forager operation to perform' },
    jobFilters: { type: 'json', description: 'Documented JobPostEventSearch request body' },
    organizationFilters: {
      type: 'json',
      description: 'Documented OrganizationSearchRequest request body',
    },
    roleFilters: {
      type: 'json',
      description: 'Documented OrganizationPersonRoleSearch request body',
    },
    personId: { type: 'number', description: 'Forager person ID' },
    linkedinPublicIdentifier: {
      type: 'string',
      description: 'LinkedIn person public identifier',
    },
    doContactsEnrichment: {
      type: 'boolean',
      description: 'Perform contact enrichment before returning work emails',
    },
    email: { type: 'string', description: 'Personal email for reverse lookup' },
    phoneNumber: { type: 'string', description: 'Phone number for reverse lookup' },
    domain: { type: 'string', description: 'Website domain' },
    organizationId: { type: 'number', description: 'Forager organization ID' },
    organizationLinkedinPublicIdentifier: {
      type: 'string',
      description: 'LinkedIn organization public identifier',
    },
    accountId: { type: 'number', description: 'Forager account ID' },
    apiKey: { type: 'string', description: 'Forager API key' },
  },
  outputs: {
    results: {
      type: 'array',
      description: 'Search records validated against the operation response schema',
    },
    totalSearchResults: { type: 'number', description: 'Total matching search records' },
    totalPersons: { type: 'number', description: 'Total distinct matching people' },
    totalOrganizations: {
      type: 'number',
      description: 'Total distinct matching organizations',
    },
    emails: { type: 'array', description: 'Personal or work email records' },
    phoneNumbers: { type: 'array', description: 'Phone number records' },
    person: { type: 'json', description: 'Complete Forager person profile' },
    website: { type: 'json', description: 'Website ranks, traffic, and technologies' },
  },
}

export const ForagerBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://www.forager.ai',
  skills: [
    {
      name: 'enrich-person-profile',
      description:
        'Resolve a person and retrieve their structured Forager profile. Use before contact research, personalization, or CRM cleanup.',
      content:
        '# Enrich a Person Profile\n\n## Steps\n1. Use Person Detail with a Forager person ID or LinkedIn public identifier.\n2. Read current roles, location, skills, education, organizations, and authored work from the validated profile.\n3. Preserve missing optional values as missing rather than inferring them.\n\n## Output\nReturn the matched person ID, current role and organization, location, and the fields relevant to the requested task.',
    },
    {
      name: 'find-person-contacts',
      description:
        'Find documented work emails, personal emails, or phone numbers for a known person. Use for contact enrichment and routing.',
      content:
        '# Find Person Contacts\n\n## Steps\n1. Start with a Forager person ID or LinkedIn public identifier.\n2. Choose Work Emails, Personal Emails, or Phone Numbers based on the requested channel.\n3. For email results, retain email_type and validation_status.\n4. Treat an empty array as no documented contact, not as a workflow error.\n\n## Output\nReturn only the contact records received from Forager with their validation metadata.',
    },
    {
      name: 'build-role-target-list',
      description:
        'Search current people and roles across organization criteria. Use for recruiting, sales targeting, and market mapping.',
      content:
        '# Build a Role Target List\n\n## Steps\n1. Translate the target into documented role, person, and organization filters.\n2. Run Person Role Search Totals to size the result set.\n3. Run Person Role Search and page with the page field until the desired set is retrieved.\n4. Deduplicate by returned person and role IDs.\n\n## Output\nWrite the roles to a table with person, title, current-status, organization, and profile identifiers.',
    },
    {
      name: 'screen-organizations',
      description:
        'Search Forager organizations by firmographics, funding, hiring, and event evidence. Use for ICP and market screens.',
      content:
        '# Screen Organizations\n\n## Steps\n1. Build an Organization Search filter object from the requested firmographics and signals.\n2. Run Organization Search Totals to measure the screen.\n3. Page Organization Search results and keep the filter body unchanged across pages.\n4. Preserve the returned funding, job-post, and simple-event arrays as supporting evidence.\n\n## Output\nReturn the matching organizations, total count, filters used, and the signal fields behind each match.',
    },
    {
      name: 'map-hiring-signals',
      description:
        'Search job posts and connect hiring demand to Forager organizations. Use for talent, sales, and investment research.',
      content:
        '# Map Hiring Signals\n\n## Steps\n1. Build a Job Search filter for titles, descriptions, dates, locations, source, remote status, and active status.\n2. Run Job Search Totals to size the signal set.\n3. Page Job Search and group results by the returned organization ID.\n4. Keep job source, URL, date, title, location, and active status with each signal.\n\n## Output\nReport organizations ranked by matching active job count and include the underlying job URLs.',
    },
  ],
  templates: [
    {
      icon: ForagerIcon,
      title: 'Forager person enrichment',
      prompt:
        'Create a workflow that reads LinkedIn person identifiers from a table, retrieves each complete Forager person profile, and writes current role, company, location, skills, and education back to the row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'enrichment'],
    },
    {
      icon: ForagerIcon,
      title: 'Forager work email finder',
      prompt:
        'Build a workflow that takes Forager person IDs from a prospect table, finds work email records, keeps validation status, and writes valid contacts back without inventing an email when none is returned.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'enrichment', 'automation'],
    },
    {
      icon: ForagerIcon,
      title: 'Forager buying committee search',
      prompt:
        'Create a workflow that searches current Forager person roles at target company domains for finance, security, and operations leaders, deduplicates the people, and writes the buying committee to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'crm'],
    },
    {
      icon: ForagerIcon,
      title: 'Forager ICP company screen',
      prompt:
        'Build a workflow that turns my ICP into Forager organization filters, counts the market, pages through matching companies, and writes firmographics, funding signals, and domains to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
    {
      icon: ForagerIcon,
      title: 'Forager hiring signal tracker',
      prompt:
        'Create a scheduled workflow that searches active Forager job posts for my target roles, groups new posts by organization, and sends a Slack alert with job URLs and remote status.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'monitoring', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ForagerIcon,
      title: 'Forager recruiting sourcer',
      prompt:
        'Build a recruiting workflow that searches Forager for people currently in specified roles with target skills and locations, enriches each profile, and writes a candidate research list to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['research', 'enrichment', 'automation'],
    },
    {
      icon: ForagerIcon,
      title: 'Forager website technology audit',
      prompt:
        'Create a workflow that reads company domains from a table, uses Forager Website Detail to retrieve detected technologies and traffic ranks, and writes the normalized technology stack back to each company.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['research', 'data', 'enrichment'],
    },
    {
      icon: ForagerIcon,
      title: 'Forager reverse contact resolver',
      prompt:
        'Build a workflow that accepts a personal email or phone number, reverse-resolves the complete Forager person profile, and routes the matched contact to the correct CRM owner.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'automation'],
    },
    {
      icon: ForagerIcon,
      title: 'Forager market map',
      prompt:
        'Create an agent that combines Forager organization search totals, organization results, person-role totals, and role results to map a market by company count, employee bands, and leadership density.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['research', 'data', 'reporting'],
    },
  ],
} as const satisfies BlockMeta
