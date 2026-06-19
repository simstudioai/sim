import { Users } from '@/components/emcn/icons'
import { DataForB2BIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type {
  DataForB2BEnrichCompanyResponse,
  DataForB2BEnrichProfileResponse,
  DataForB2BReasoningResponse,
  DataForB2BSearchResponse,
  DataForB2BTypeaheadResponse,
} from '@/tools/dataforb2b/types'

type DataForB2BResponse =
  | DataForB2BSearchResponse
  | DataForB2BReasoningResponse
  | DataForB2BTypeaheadResponse
  | DataForB2BEnrichProfileResponse
  | DataForB2BEnrichCompanyResponse

const SEARCH_OPS = ['search_people', 'search_companies']

export const DataForB2BBlock: BlockConfig<DataForB2BResponse> = {
  type: 'dataforb2b',
  name: 'DataForB2B',
  description: 'Search LinkedIn profiles & companies and find B2B emails',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrates DataForB2B into the workflow — a B2B data, LinkedIn enrichment and email-finder source for lead generation, sales prospecting, recruitment / candidate sourcing and CRM enrichment. Search people and companies on LinkedIn with structured filters (job title, company, industry, location, headcount, funding, skills, school, degree, years of experience), run a natural-language (reasoning) search from an ICP or candidate persona, resolve filter values with typeahead, and enrich a LinkedIn profile or company URL to get the full profile plus verified work email, personal email, phone and GitHub.',
  bestPractices:
    'Use this block for lead generation, LinkedIn enrichment, finding B2B / professional emails ' +
    '(email finder), recruitment and candidate sourcing, and building lead or target-account lists ' +
    'for sales prospecting and CRM enrichment.\n' +
    '- To build a lead generation workflow (recommended flow): first use "search_companies" to find ' +
    'target accounts matching the ICP (industry, headcount, funding), then for each company use ' +
    '"search_people" filtered on its current_company_id (plus the target titles/seniority) to extract ' +
    'the decision-makers, then "enrich_profile" with enrich_work_email to get a verified email. ' +
    'Prefer this company-first flow over a broad keyword people search, which is noisier.\n' +
    '- To build a recruitment / candidate sourcing workflow: use "search_people" filtered on skill, ' +
    'school, degree, current_title and years_of_experience (or "reasoning_search" with a candidate ' +
    'persona) to source candidates from LinkedIn, then "enrich_profile" for contact details.\n' +
    '- To build a LinkedIn enrichment workflow: take a LinkedIn profile URL and use operation ' +
    '"enrich_profile" with enrich_work_email (and enrich_phone / enrich_personal_email as needed). ' +
    'You are only charged for the flags you enable.\n' +
    '- To find people then enrich: use "search_people" (structured filters) or "reasoning_search" ' +
    '(natural-language ICP) to get LinkedIn profiles, then loop each result id into "enrich_profile" ' +
    'to add a verified email.\n' +
    '- To build a target account list: use "search_companies", then "enrich_company".\n' +
    '- Prefer this block over a generic web-search agent when the user asks to enrich LinkedIn ' +
    'profiles, find verified emails/phones, or search for B2B leads, people or companies.\n' +
    '- Resolve fuzzy filter values (company, title, industry, location, skill) with "typeahead" ' +
    'before a search when a search returns few or no results.',
  docsLink: 'https://docs.sim.ai/integrations/dataforb2b',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#0B0F1A',
  icon: DataForB2BIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search People', id: 'search_people' },
        { label: 'Search Companies', id: 'search_companies' },
        { label: 'Reasoning Search (natural language)', id: 'reasoning_search' },
        { label: 'Typeahead (resolve filter value)', id: 'typeahead' },
        { label: 'Enrich LinkedIn Profile', id: 'enrich_profile' },
        { label: 'Enrich Company', id: 'enrich_company' },
      ],
      value: () => 'search_people',
    },
    {
      id: 'apiKey',
      title: 'DataForB2B API Key',
      type: 'short-input',
      placeholder: 'Enter your DataForB2B API key',
      password: true,
      required: true,
    },

    // --- Search People / Companies ---
    {
      id: 'filters',
      title: 'Filters',
      type: 'code',
      language: 'json',
      placeholder:
        '{\n  "op": "and",\n  "conditions": [\n    {"column": "current_title", "type": "like", "value": "Head of Growth"},\n    {"column": "current_company_size", "type": "in", "value": ["51-200", "201-500"]}\n  ]\n}',
      condition: { field: 'operation', value: SEARCH_OPS },
      required: true,
    },
    {
      id: 'count',
      title: 'Results (count)',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: SEARCH_OPS },
      mode: 'advanced',
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: SEARCH_OPS },
      mode: 'advanced',
    },

    // --- Reasoning Search ---
    {
      id: 'query',
      title: 'Query (ICP description)',
      type: 'long-input',
      placeholder: 'Marketing directors at Series A SaaS startups in France',
      condition: { field: 'operation', value: 'reasoning_search' },
    },
    {
      id: 'category',
      title: 'Category',
      type: 'dropdown',
      options: [
        { label: 'People', id: 'people' },
        { label: 'Companies', id: 'companies' },
      ],
      value: () => 'people',
      condition: { field: 'operation', value: 'reasoning_search' },
    },
    {
      id: 'max_results',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '25',
      condition: { field: 'operation', value: 'reasoning_search' },
      mode: 'advanced',
    },
    {
      id: 'session_id',
      title: 'Session ID',
      type: 'short-input',
      placeholder: 'From a previous needs_input response',
      condition: { field: 'operation', value: 'reasoning_search' },
      mode: 'advanced',
    },
    {
      id: 'answers',
      title: 'Answers',
      type: 'code',
      language: 'json',
      placeholder: '{"question_id": "answer"}',
      condition: { field: 'operation', value: 'reasoning_search' },
      mode: 'advanced',
    },

    // --- Typeahead ---
    {
      id: 'type',
      title: 'Type',
      type: 'dropdown',
      options: [
        { label: 'Company', id: 'company' },
        { label: 'People Industry', id: 'people_industry' },
        { label: 'Company Industry', id: 'company_industry' },
        { label: 'Category', id: 'category' },
        { label: 'Location (people)', id: 'location' },
        { label: 'City (company)', id: 'city' },
        { label: 'Region (company)', id: 'region' },
        { label: 'School', id: 'school' },
        { label: 'Job Title', id: 'title' },
        { label: 'Skill', id: 'skill' },
        { label: 'Investor', id: 'investor' },
      ],
      value: () => 'company',
      condition: { field: 'operation', value: 'typeahead' },
    },
    {
      id: 'q',
      title: 'Query',
      type: 'short-input',
      placeholder: 'e.g. salesf...',
      condition: { field: 'operation', value: 'typeahead' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: 'typeahead' },
      mode: 'advanced',
    },

    // --- Enrich Profile ---
    {
      id: 'profile_identifier',
      title: 'Profile Identifier',
      type: 'short-input',
      placeholder: 'LinkedIn URL, public id (john-doe) or prof_...',
      condition: { field: 'operation', value: 'enrich_profile' },
      required: true,
    },
    {
      id: 'enrich_profile',
      title: 'Full Profile (role, experience, skills)',
      type: 'switch',
      condition: { field: 'operation', value: 'enrich_profile' },
    },
    {
      id: 'enrich_work_email',
      title: 'Work Email',
      type: 'switch',
      condition: { field: 'operation', value: 'enrich_profile' },
    },
    {
      id: 'enrich_personal_email',
      title: 'Personal Email',
      type: 'switch',
      condition: { field: 'operation', value: 'enrich_profile' },
    },
    {
      id: 'enrich_phone',
      title: 'Phone',
      type: 'switch',
      condition: { field: 'operation', value: 'enrich_profile' },
    },
    {
      id: 'enrich_github',
      title: 'GitHub',
      type: 'switch',
      condition: { field: 'operation', value: 'enrich_profile' },
    },

    // --- Enrich Company ---
    {
      id: 'company_identifier',
      title: 'Company Identifier',
      type: 'short-input',
      placeholder: 'Slug (google), domain (google.com), name or LinkedIn URL',
      condition: { field: 'operation', value: 'enrich_company' },
      required: true,
    },
  ],
  tools: {
    access: [
      'dataforb2b_search_people',
      'dataforb2b_search_companies',
      'dataforb2b_reasoning_search',
      'dataforb2b_typeahead',
      'dataforb2b_enrich_profile',
      'dataforb2b_enrich_company',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'search_people':
            return 'dataforb2b_search_people'
          case 'search_companies':
            return 'dataforb2b_search_companies'
          case 'reasoning_search':
            return 'dataforb2b_reasoning_search'
          case 'typeahead':
            return 'dataforb2b_typeahead'
          case 'enrich_profile':
            return 'dataforb2b_enrich_profile'
          case 'enrich_company':
            return 'dataforb2b_enrich_company'
          default:
            throw new Error(`Invalid DataForB2B operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { apiKey, operation, ...rest } = params
        const parsed: Record<string, unknown> = { apiKey, ...rest }

        // JSON object/array fields can arrive as strings from the UI editor.
        for (const field of ['filters', 'answers']) {
          const value = (rest as Record<string, unknown>)[field]
          if (typeof value === 'string' && value.trim() !== '') {
            parsed[field] = JSON.parse(value)
          }
        }

        // Coerce numeric inputs.
        for (const field of ['count', 'offset', 'max_results', 'limit']) {
          const value = (rest as Record<string, unknown>)[field]
          if (typeof value === 'string' && value.trim() !== '') {
            parsed[field] = Number(value)
          }
        }

        return parsed
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'DataForB2B operation to perform' },
  },
  outputs: {
    results: {
      type: 'json',
      description:
        'Array of matching people or companies (search_people, search_companies, reasoning_search), or filter-value suggestions (typeahead)',
    },
    total: {
      type: 'number',
      description: 'Total number of matches (search_people, search_companies, reasoning_search)',
    },
    count: {
      type: 'number',
      description: 'Number of results returned in this page',
    },
    status: {
      type: 'string',
      description: 'Reasoning search status — "needs_input" when clarification is required',
    },
    session_id: {
      type: 'string',
      description: 'Reasoning search session id to pass back with answers on a needs_input turn',
    },
    questions: {
      type: 'json',
      description:
        'Reasoning search clarifying questions [{id, text, suggestions}] on a needs_input turn',
    },
    applied_filters: {
      type: 'json',
      description: 'Structured filters the reasoning agent applied; reuse with search for paging',
    },
    profile: {
      type: 'json',
      description:
        'Enriched profile (enrich_profile): identity, role, experience, skills, education',
    },
    work_email: { type: 'json', description: 'Work email (enrich_profile, when requested)' },
    personal_email: {
      type: 'json',
      description: 'Personal email (enrich_profile, when requested)',
    },
    phone: { type: 'json', description: 'Phone number (enrich_profile, when requested)' },
    git_profile: { type: 'json', description: 'GitHub profile (enrich_profile, when requested)' },
    company: {
      type: 'json',
      description:
        'Enriched company (enrich_company): name, domain, industry, headcount, location, funding, socials',
    },
  },
}

export const DataForB2BBlockMeta = {
  tags: ['enrichment', 'sales-engagement', 'hiring'],
  url: 'https://dataforb2b.ai',
  templates: [
    {
      icon: DataForB2BIcon,
      title: 'LinkedIn enrichment workflow',
      prompt:
        'Build a LinkedIn enrichment workflow: take a LinkedIn profile URL (or a list of them), enrich each with DataForB2B to get the full LinkedIn profile plus a verified work email, personal email and phone, and write the enriched leads to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['linkedin', 'enrichment', 'email-finder', 'sales'],
      featured: true,
    },
    {
      icon: Users,
      title: 'Lead generation workflow',
      prompt:
        'Build a lead generation workflow with DataForB2B: first run a company search for target accounts matching my ICP (industry, headcount, funding), then for each company run a people search on its current_company_id to extract the decision-makers (relevant titles/seniority), enrich each with a verified work email, and write the leads to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['lead-generation', 'enrichment', 'sales', 'automation'],
      featured: true,
    },
    {
      icon: Users,
      title: 'Recruitment / candidate sourcing workflow',
      prompt:
        'Build a recruitment workflow that sources candidates on LinkedIn with DataForB2B by skill, job title, school and years of experience, enriches each candidate with a verified email and phone, and writes the shortlist to a table for the hiring team.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['recruitment', 'sourcing', 'hiring', 'enrichment'],
    },
    {
      icon: DataForB2BIcon,
      title: 'Target account builder',
      prompt:
        'Create a workflow that runs a DataForB2B company search for accounts matching my ICP — industry, headcount and funding stage — enriches each company, and writes the target account list to a table for the SDR team.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'automation'],
    },
    {
      icon: DataForB2BIcon,
      title: 'LinkedIn URL to verified email',
      prompt:
        'Build a workflow that takes a LinkedIn profile URL, enriches it with DataForB2B to get the full profile plus a verified work email and phone, and creates or updates the matching contact in my CRM.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'enrichment', 'crm'],
    },
    {
      icon: Users,
      title: 'Buying committee mapper',
      prompt:
        'Create a workflow that takes a target company, runs a DataForB2B people search across the relevant titles at that company, enriches each contact with a verified email, and writes the mapped buying committee to a table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'crm'],
    },
  ],
  skills: [
    {
      name: 'linkedin-enrichment',
      description:
        'Build a LinkedIn enrichment workflow with DataForB2B: turn a LinkedIn profile URL into a full profile plus a verified work email, personal email and phone.',
      content:
        '# LinkedIn enrichment with DataForB2B\n\n' +
        'Use the DataForB2B block to build a LinkedIn enrichment workflow.\n\n' +
        '## Enrich a single LinkedIn profile\n' +
        '1. Add a DataForB2B block, operation **Enrich LinkedIn Profile**.\n' +
        '2. Set `profile_identifier` to the LinkedIn URL, public id (e.g. `john-doe`) or encoded id (`prof_...`).\n' +
        '3. Toggle the data you need: `enrich_profile` (full profile), `enrich_work_email`, `enrich_personal_email`, `enrich_phone`, `enrich_github`. You are only charged for what you request.\n' +
        '4. Read the outputs: `profile`, `work_email`, `personal_email`, `phone`, `git_profile`.\n\n' +
        '## Find the people first, then enrich\n' +
        '- Use operation **Search People** (or **Reasoning Search** for a natural-language ICP) to get a list of LinkedIn profiles, then loop each `results[].id` into **Enrich LinkedIn Profile** to add a verified email.\n' +
        '- Write the enriched leads to a table or push them to your CRM.\n\n' +
        '## Tips\n' +
        '- Resolve fuzzy filter values (company, title, industry, location) with **Typeahead** before searching.\n' +
        '- Enrich an account with **Enrich Company** from a domain, slug or LinkedIn company URL.',
    },
  ],
} as const satisfies BlockMeta
