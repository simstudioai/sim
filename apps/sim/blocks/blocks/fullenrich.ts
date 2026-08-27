import { FullEnrichIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
import type { FullEnrichResponse } from '@/tools/fullenrich/types'

const CONTACT_START_FIELD = ['contactData', 'contactName'] as const
const PERSON_LOOKUP_FIELD = [
  'personProfessionalNetworkUrl',
  'personName',
  'personProfessionalNetworkId',
] as const
const COMPANY_LOOKUP_FIELD = [
  'companyDomain',
  'companyProfessionalNetworkUrl',
  'companyProfessionalNetworkId',
] as const

export const FullEnrichBlock: BlockConfig<FullEnrichResponse> = {
  type: 'fullenrich',
  name: 'FullEnrich',
  description: 'Enrich contacts and search or look up people and companies',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Use FullEnrich to enrich batches of contacts with work emails, personal emails, and mobile phones; reverse email addresses; search people and companies; and retrieve standalone person or company profiles.',
  docsLink: 'https://docs.sim.ai/integrations/fullenrich',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#8164F4',
  icon: FullEnrichIcon,
  canvasPresentation: {
    defaultTitle: 'FullEnrich',
    sentences: {
      byOperation: {
        fullenrich_start_contact_enrichment: [
          { text: 'Start contact enrichment for', field: CONTACT_START_FIELD, core: true },
        ],
        fullenrich_get_contact_enrichment: [
          { text: 'Get contact enrichment', field: 'contactEnrichmentId', core: true },
        ],
        fullenrich_start_reverse_email: [
          { text: 'Start reverse email lookup for', field: 'reverseData', core: true },
        ],
        fullenrich_get_reverse_email: [
          { text: 'Get reverse email lookup', field: 'reverseEnrichmentId', core: true },
        ],
        fullenrich_search_people: [
          { text: 'Search people matching', field: 'peopleFilters', core: true },
        ],
        fullenrich_search_companies: [
          { text: 'Search companies matching', field: 'companyFilters', core: true },
        ],
        fullenrich_lookup_person: [
          { text: 'Look up person', field: PERSON_LOOKUP_FIELD, core: true },
        ],
        fullenrich_lookup_company: [
          { text: 'Look up company', field: COMPANY_LOOKUP_FIELD, core: true },
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
        { label: 'Start Contact Enrichment', id: 'fullenrich_start_contact_enrichment' },
        { label: 'Get Contact Enrichment', id: 'fullenrich_get_contact_enrichment' },
        { label: 'Start Reverse Email', id: 'fullenrich_start_reverse_email' },
        { label: 'Get Reverse Email', id: 'fullenrich_get_reverse_email' },
        { label: 'Search People', id: 'fullenrich_search_people' },
        { label: 'Search Companies', id: 'fullenrich_search_companies' },
        { label: 'Lookup Person', id: 'fullenrich_lookup_person' },
        { label: 'Lookup Company', id: 'fullenrich_lookup_company' },
      ],
      value: () => 'fullenrich_start_contact_enrichment',
    },
    {
      id: 'contactName',
      title: 'Enrichment Name',
      type: 'short-input',
      required: { field: 'operation', value: 'fullenrich_start_contact_enrichment' },
      placeholder: 'Sales operations prospects',
      condition: { field: 'operation', value: 'fullenrich_start_contact_enrichment' },
    },
    {
      id: 'contactData',
      title: 'Contacts',
      type: 'code',
      language: 'json',
      required: { field: 'operation', value: 'fullenrich_start_contact_enrichment' },
      placeholder:
        '[{"first_name":"Ada","last_name":"Lovelace","domain":"example.com","enrich_fields":["contact.work_emails","contact.phones"]}]',
      condition: { field: 'operation', value: 'fullenrich_start_contact_enrichment' },
      wandConfig: {
        enabled: true,
        prompt:
          'Build a JSON array of 1-100 FullEnrich contact inputs. Each item must use linkedin_url, or first_name and last_name plus domain or company_name, and a non-empty enrich_fields array containing only contact.work_emails, contact.personal_emails, or contact.phones. Return only the JSON array.',
        generationType: 'json-array',
      },
    },
    {
      id: 'contactWebhookUrl',
      title: 'Completion Webhook URL',
      type: 'short-input',
      placeholder: 'https://example.com/webhooks/fullenrich',
      condition: { field: 'operation', value: 'fullenrich_start_contact_enrichment' },
      mode: 'advanced',
    },
    {
      id: 'contactFinishedWebhookUrl',
      title: 'Per-contact Webhook URL',
      type: 'short-input',
      placeholder: 'https://example.com/webhooks/contact',
      condition: { field: 'operation', value: 'fullenrich_start_contact_enrichment' },
      mode: 'advanced',
    },
    {
      id: 'contactEnrichmentId',
      title: 'Enrichment ID',
      type: 'short-input',
      required: { field: 'operation', value: 'fullenrich_get_contact_enrichment' },
      placeholder: '2db5ea61-1752-42cf-8ea1-ab1da060cd0a',
      condition: { field: 'operation', value: 'fullenrich_get_contact_enrichment' },
    },
    {
      id: 'forceResults',
      title: 'Return Partial Results',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'fullenrich_get_contact_enrichment' },
      mode: 'advanced',
    },
    {
      id: 'reverseName',
      title: 'Lookup Name',
      type: 'short-input',
      required: { field: 'operation', value: 'fullenrich_start_reverse_email' },
      placeholder: 'Inbound lead reverse lookup',
      condition: { field: 'operation', value: 'fullenrich_start_reverse_email' },
    },
    {
      id: 'reverseData',
      title: 'Emails',
      type: 'code',
      language: 'json',
      required: { field: 'operation', value: 'fullenrich_start_reverse_email' },
      placeholder: '[{"email":"ada@example.com","custom":{"lead_id":"123"}}]',
      condition: { field: 'operation', value: 'fullenrich_start_reverse_email' },
      wandConfig: {
        enabled: true,
        prompt:
          'Build a JSON array of 1-100 FullEnrich reverse-email inputs. Each item must contain a valid email and may contain up to 10 custom string fields of at most 100 characters each. Return only the JSON array.',
        generationType: 'json-array',
      },
    },
    {
      id: 'reverseWebhookUrl',
      title: 'Completion Webhook URL',
      type: 'short-input',
      placeholder: 'https://example.com/webhooks/fullenrich',
      condition: { field: 'operation', value: 'fullenrich_start_reverse_email' },
      mode: 'advanced',
    },
    {
      id: 'reverseContactFinishedWebhookUrl',
      title: 'Per-contact Webhook URL',
      type: 'short-input',
      placeholder: 'https://example.com/webhooks/contact',
      condition: { field: 'operation', value: 'fullenrich_start_reverse_email' },
      mode: 'advanced',
    },
    {
      id: 'reverseEnrichmentId',
      title: 'Reverse Lookup ID',
      type: 'short-input',
      required: { field: 'operation', value: 'fullenrich_get_reverse_email' },
      placeholder: '2db5ea61-1752-42cf-8ea1-ab1da060cd0a',
      condition: { field: 'operation', value: 'fullenrich_get_reverse_email' },
    },
    {
      id: 'peopleFilters',
      title: 'People Filters',
      type: 'code',
      language: 'json',
      placeholder:
        '{"current_position_titles":[{"value":"VP of Sales"}],"person_locations":[{"value":"United States"}]}',
      condition: { field: 'operation', value: 'fullenrich_search_people' },
      wandConfig: {
        enabled: true,
        prompt:
          'Build a FullEnrich v2 People Search filter object using only documented fields and value/exclude/exact_match or min/max/exclude filter items. Return only the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'peopleOffset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'fullenrich_search_people' },
      mode: 'advanced',
    },
    {
      id: 'peopleLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'fullenrich_search_people' },
      mode: 'advanced',
    },
    {
      id: 'peopleSearchAfter',
      title: 'Search After',
      type: 'short-input',
      placeholder: 'Cursor from the previous response',
      condition: { field: 'operation', value: 'fullenrich_search_people' },
      mode: 'advanced',
    },
    {
      id: 'companyFilters',
      title: 'Company Filters',
      type: 'code',
      language: 'json',
      placeholder:
        '{"industries":[{"value":"Software Development"}],"headcounts":[{"min":50,"max":500}]}',
      condition: { field: 'operation', value: 'fullenrich_search_companies' },
      wandConfig: {
        enabled: true,
        prompt:
          'Build a FullEnrich v2 Company Search filter object using only documented fields and value/exclude/exact_match or min/max/exclude filter items. Return only the JSON object.',
        generationType: 'json-object',
      },
    },
    {
      id: 'companyOffset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'fullenrich_search_companies' },
      mode: 'advanced',
    },
    {
      id: 'companyLimit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '10',
      condition: { field: 'operation', value: 'fullenrich_search_companies' },
      mode: 'advanced',
    },
    {
      id: 'companySearchAfter',
      title: 'Search After',
      type: 'short-input',
      placeholder: 'Cursor from the previous response',
      condition: { field: 'operation', value: 'fullenrich_search_companies' },
      mode: 'advanced',
    },
    {
      id: 'personName',
      title: 'Person Name',
      type: 'short-input',
      placeholder: 'Enzo Romera',
      condition: { field: 'operation', value: 'fullenrich_lookup_person' },
    },
    {
      id: 'personProfessionalNetworkUrl',
      title: 'Person LinkedIn URL',
      type: 'short-input',
      placeholder: 'https://www.linkedin.com/in/enzo-romera',
      condition: { field: 'operation', value: 'fullenrich_lookup_person' },
    },
    {
      id: 'personProfessionalNetworkId',
      title: 'Person LinkedIn ID',
      type: 'short-input',
      placeholder: '530992355',
      condition: { field: 'operation', value: 'fullenrich_lookup_person' },
      mode: 'advanced',
    },
    {
      id: 'personCompanyProfessionalNetworkUrl',
      title: 'Company LinkedIn URL',
      type: 'short-input',
      placeholder: 'https://www.linkedin.com/company/anthropic',
      condition: { field: 'operation', value: 'fullenrich_lookup_person' },
      mode: 'advanced',
    },
    {
      id: 'personCompanyProfessionalNetworkId',
      title: 'Company LinkedIn ID',
      type: 'short-input',
      placeholder: '1883877',
      condition: { field: 'operation', value: 'fullenrich_lookup_person' },
      mode: 'advanced',
    },
    {
      id: 'personCompanyDomain',
      title: 'Company Domain',
      type: 'short-input',
      placeholder: 'anthropic.com',
      condition: { field: 'operation', value: 'fullenrich_lookup_person' },
    },
    {
      id: 'companyDomain',
      title: 'Company Domain',
      type: 'short-input',
      placeholder: 'anthropic.com',
      condition: { field: 'operation', value: 'fullenrich_lookup_company' },
    },
    {
      id: 'companyProfessionalNetworkUrl',
      title: 'Company LinkedIn URL',
      type: 'short-input',
      placeholder: 'https://www.linkedin.com/company/anthropic',
      condition: { field: 'operation', value: 'fullenrich_lookup_company' },
    },
    {
      id: 'companyProfessionalNetworkId',
      title: 'Company LinkedIn ID',
      type: 'short-input',
      placeholder: '1883877',
      condition: { field: 'operation', value: 'fullenrich_lookup_company' },
      mode: 'advanced',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      required: true,
      placeholder: 'Enter your FullEnrich API key',
      password: true,
      hideWhenHosted: true,
    },
  ],
  tools: {
    access: [
      'fullenrich_get_contact_enrichment',
      'fullenrich_get_reverse_email',
      'fullenrich_lookup_company',
      'fullenrich_lookup_person',
      'fullenrich_search_companies',
      'fullenrich_search_people',
      'fullenrich_start_contact_enrichment',
      'fullenrich_start_reverse_email',
    ],
    config: {
      tool: (params) => {
        const operation = params.operation
        if (
          operation === 'fullenrich_get_contact_enrichment' ||
          operation === 'fullenrich_get_reverse_email' ||
          operation === 'fullenrich_lookup_company' ||
          operation === 'fullenrich_lookup_person' ||
          operation === 'fullenrich_search_companies' ||
          operation === 'fullenrich_search_people' ||
          operation === 'fullenrich_start_contact_enrichment' ||
          operation === 'fullenrich_start_reverse_email'
        ) {
          return operation
        }
        throw new Error(`Unsupported FullEnrich operation: ${String(operation)}`)
      },
      params: (params) => {
        const renames: Record<string, string> = {
          contactName: 'name',
          contactData: 'data',
          contactWebhookUrl: 'webhookUrl',
          contactFinishedWebhookUrl: 'contactFinishedWebhookUrl',
          contactEnrichmentId: 'enrichmentId',
          reverseName: 'name',
          reverseData: 'data',
          reverseWebhookUrl: 'webhookUrl',
          reverseContactFinishedWebhookUrl: 'contactFinishedWebhookUrl',
          reverseEnrichmentId: 'enrichmentId',
          peopleFilters: 'filters',
          peopleOffset: 'offset',
          peopleLimit: 'limit',
          peopleSearchAfter: 'searchAfter',
          companyFilters: 'filters',
          companyOffset: 'offset',
          companyLimit: 'limit',
          companySearchAfter: 'searchAfter',
          personCompanyProfessionalNetworkUrl: 'companyProfessionalNetworkUrl',
          personCompanyProfessionalNetworkId: 'companyProfessionalNetworkId',
          personCompanyDomain: 'companyDomain',
          companyDomain: 'domain',
          companyProfessionalNetworkUrl: 'professionalNetworkUrl',
          companyProfessionalNetworkId: 'professionalNetworkId',
        }
        const numericFields = new Set([
          'offset',
          'limit',
          'personProfessionalNetworkId',
          'companyProfessionalNetworkId',
          'professionalNetworkId',
        ])
        const result: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(params)) {
          if (key === 'operation' || value === undefined || value === null || value === '') continue
          const target = renames[key] ?? key
          if (numericFields.has(target)) {
            const numericValue = Number(value)
            if (!Number.isFinite(numericValue)) {
              throw new Error(`${target} must be a finite number`)
            }
            result[target] = numericValue
          } else if (target === 'forceResults') {
            if (value !== true && value !== false && value !== 'true' && value !== 'false') {
              throw new Error('forceResults must be a boolean')
            }
            result[target] = value === true || value === 'true'
          } else {
            result[target] = value
          }
        }
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'FullEnrich operation' },
    apiKey: { type: 'string', description: 'FullEnrich API key' },
    contactName: { type: 'string', description: 'Contact enrichment name' },
    contactData: { type: 'json', description: 'Contacts to enrich' },
    contactWebhookUrl: { type: 'string', description: 'Batch completion webhook URL' },
    contactFinishedWebhookUrl: { type: 'string', description: 'Per-contact webhook URL' },
    contactEnrichmentId: { type: 'string', description: 'Contact enrichment ID' },
    forceResults: { type: 'string', description: 'Whether to return partial results' },
    reverseName: { type: 'string', description: 'Reverse lookup name' },
    reverseData: { type: 'json', description: 'Emails to reverse look up' },
    reverseWebhookUrl: { type: 'string', description: 'Reverse batch completion webhook URL' },
    reverseContactFinishedWebhookUrl: {
      type: 'string',
      description: 'Reverse per-contact webhook URL',
    },
    reverseEnrichmentId: { type: 'string', description: 'Reverse lookup ID' },
    peopleFilters: { type: 'json', description: 'People search filters' },
    peopleOffset: { type: 'string', description: 'People search offset' },
    peopleLimit: { type: 'string', description: 'People search page size' },
    peopleSearchAfter: { type: 'string', description: 'People search cursor' },
    companyFilters: { type: 'json', description: 'Company search filters' },
    companyOffset: { type: 'string', description: 'Company search offset' },
    companyLimit: { type: 'string', description: 'Company search page size' },
    companySearchAfter: { type: 'string', description: 'Company search cursor' },
    personName: { type: 'string', description: 'Person name' },
    personProfessionalNetworkUrl: { type: 'string', description: 'Person LinkedIn URL' },
    personProfessionalNetworkId: { type: 'string', description: 'Person LinkedIn ID' },
    personCompanyProfessionalNetworkUrl: { type: 'string', description: 'Company LinkedIn URL' },
    personCompanyProfessionalNetworkId: { type: 'string', description: 'Company LinkedIn ID' },
    personCompanyDomain: { type: 'string', description: 'Company domain for person lookup' },
    companyDomain: { type: 'string', description: 'Company domain' },
    companyProfessionalNetworkUrl: { type: 'string', description: 'Company LinkedIn URL' },
    companyProfessionalNetworkId: { type: 'string', description: 'Company LinkedIn ID' },
  },
  outputs: {
    enrichmentId: { type: 'string', description: 'Started enrichment ID' },
    id: { type: 'string', description: 'Retrieved enrichment ID' },
    name: { type: 'string', description: 'Enrichment name' },
    status: { type: 'string', description: 'Enrichment status' },
    records: { type: 'array', description: 'Enrichment or reverse-email records' },
    costCredits: { type: 'number', description: 'Historical enrichment credits' },
    people: { type: 'array', description: 'FullEnrich people' },
    companies: { type: 'array', description: 'FullEnrich companies' },
    total: { type: 'number', description: 'Total matches' },
    credits: { type: 'number', description: 'Credits reported for a synchronous request' },
    offset: { type: 'number', description: 'Result offset' },
    searchAfter: { type: 'string', description: 'Next-page cursor' },
  },
}

export const FullEnrichBlockMeta = {
  tags: ['enrichment', 'sales-engagement'],
  url: 'https://fullenrich.com',
  templates: [
    {
      icon: FullEnrichIcon,
      title: 'FullEnrich contact waterfall',
      prompt:
        'Build a workflow that reads contacts from a table, starts a FullEnrich batch for work emails and mobile phones, retrieves the finished records, and writes the verified contact details back to each row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
    {
      icon: FullEnrichIcon,
      title: 'FullEnrich inbound lead qualifier',
      prompt:
        'Create a workflow that reverse looks up inbound lead email addresses with FullEnrich, retrieves their professional profiles, and routes high-fit leads for sales follow-up.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: FullEnrichIcon,
      title: 'FullEnrich ICP people search',
      prompt:
        'Build a workflow that searches FullEnrich for people matching target job titles, seniority, company attributes, and locations, then saves the paginated prospect list to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
    {
      icon: FullEnrichIcon,
      title: 'FullEnrich account discovery',
      prompt:
        'Build a workflow that searches FullEnrich for companies matching target industries, headquarters, founding years, and headcount ranges, then writes the account profiles to a territory-planning table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
    {
      icon: FullEnrichIcon,
      title: 'FullEnrich LinkedIn profile lookup',
      prompt:
        'Create a workflow that receives a LinkedIn profile URL, uses FullEnrich to look up the person, and returns their current role, employment history, location, education, languages, and skills.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['research', 'enrichment'],
    },
    {
      icon: FullEnrichIcon,
      title: 'FullEnrich company domain lookup',
      prompt:
        'Create a workflow that takes company domains, uses FullEnrich company lookup, and returns firmographics including industry, headcount, headquarters, specialties, and professional-network profile.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
    },
    {
      icon: FullEnrichIcon,
      title: 'FullEnrich work-email backfill',
      prompt:
        'Build a scheduled workflow that finds table rows missing work email addresses, batches the contacts through FullEnrich work-email enrichment, retrieves completed results, and updates the matching rows.',
      modules: ['tables', 'scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['sales', 'operations', 'enrichment'],
    },
    {
      icon: FullEnrichIcon,
      title: 'FullEnrich new-job prospecting',
      prompt:
        'Build a workflow that searches FullEnrich for people who recently changed jobs at target companies, pages through the results, and saves the prospects with their current employment details.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research'],
    },
  ],
  skills: [
    {
      name: 'enrich-contact-batch',
      description: 'Start and retrieve a FullEnrich contact batch for emails and mobile phones.',
      content:
        '# Enrich Contact Batch\n\nEnrich contacts with FullEnrich.\n\n## Steps\n1. Use Start Contact Enrichment with 1-100 contacts and request only the needed enrich_fields.\n2. Save the returned enrichmentId.\n3. After FullEnrich finishes, use Get Contact Enrichment with that ID.\n4. Match records back to inputs using custom fields.\n\n## Output\nReturn each input contact with found work emails, personal emails, phones, profile data, status, and historical credit usage.',
    },
    {
      name: 'reverse-email-profile',
      description: 'Resolve email addresses to professional profiles with FullEnrich.',
      content:
        '# Reverse Email Profile\n\nResolve email addresses to people.\n\n## Steps\n1. Use Start Reverse Email with 1-100 valid email objects and optional custom identifiers.\n2. Save the enrichmentId.\n3. Retrieve the completed batch with Get Reverse Email.\n4. Preserve unmatched records rather than inferring a profile.\n\n## Output\nReturn each email, its matched professional profile when available, and the batch status.',
    },
    {
      name: 'search-people',
      description: 'Search FullEnrich for people matching a precise ideal-customer profile.',
      content:
        '# Search People\n\nFind people matching an ICP.\n\n## Steps\n1. Build documented FullEnrich filter arrays for company, title, seniority, location, skills, tenure, or education.\n2. Use Search People with a limit up to 100.\n3. Continue with searchAfter when another page is needed.\n\n## Output\nReturn the matching people, total count, credits, offset, and next-page cursor.',
    },
    {
      name: 'search-companies',
      description: 'Find companies by firmographic filters in FullEnrich.',
      content:
        '# Search Companies\n\nBuild a target-account list.\n\n## Steps\n1. Build documented filters for names, domains, keywords, specialties, industries, types, headquarters, founding years, or headcounts.\n2. Use Search Companies with a limit up to 100.\n3. Continue with searchAfter when another page is needed.\n\n## Output\nReturn company profiles, total count, credits, offset, and next-page cursor.',
    },
    {
      name: 'lookup-profile',
      description:
        'Look up one documented person or company profile using its strongest identifier.',
      content:
        '# Lookup Profile\n\nRetrieve one FullEnrich profile.\n\n## Steps\n1. For a person, prefer the professional-network URL or ID; otherwise combine a full name with a company identifier.\n2. For a company, provide its domain or professional-network URL or ID.\n3. Use Lookup Person or Lookup Company and do not infer fields when the returned array is empty.\n\n## Output\nReturn the documented person or company profile and provider-reported credits.',
    },
    {
      name: 'find-recent-job-changers',
      description: 'Find prospects who recently changed jobs using FullEnrich tenure filters.',
      content:
        '# Find Recent Job Changers\n\nFind people whose current role changed recently.\n\n## Steps\n1. Use Search People with current_company_days_since_last_job_change and a documented min/max day range.\n2. Add current company, title, seniority, industry, or location filters to keep the audience relevant.\n3. Continue with searchAfter when another page is needed.\n\n## Output\nReturn each person with current employment, the result total, and the next-page cursor.',
    },
    {
      name: 'disambiguate-person-name',
      description:
        'Resolve an ambiguous person name by combining it with a FullEnrich company identifier.',
      content:
        '# Disambiguate Person Name\n\nResolve a person when no profile URL is available.\n\n## Steps\n1. Use Lookup Person with the complete person name.\n2. Add the employer domain, professional-network URL, or professional-network ID to disambiguate the match.\n3. Treat an empty people array as no match and do not infer a profile.\n\n## Output\nReturn the matched professional profile and provider-reported credits, or a clear no-match result.',
    },
  ],
} as const satisfies BlockMeta
