import { HarmonicIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

const HARMONIC_OPERATIONS = [
  'harmonic_search_people_scout',
  'harmonic_list_people_saved_searches',
  'harmonic_get_people_saved_search_results',
  'harmonic_batch_get_people',
] as const

const PAGED_OPERATIONS = ['harmonic_get_people_saved_search_results'] as const

const CONTACT_OPERATIONS = [
  'harmonic_search_people_scout',
  'harmonic_get_people_saved_search_results',
  'harmonic_batch_get_people',
] as const

type HarmonicOperation = (typeof HARMONIC_OPERATIONS)[number]

function isHarmonicOperation(value: unknown): value is HarmonicOperation {
  return (HARMONIC_OPERATIONS as readonly unknown[]).includes(value)
}

function optionalValue(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined
  return value
}

export const HarmonicBlock: BlockConfig = {
  type: 'harmonic',
  name: 'Harmonic',
  description: 'Search and enrich private-market contacts',
  longDescription:
    'Connect a reusable Harmonic team API key, use Scout to find people with natural-language criteria, select team-visible people saved searches, and hydrate person identifiers into normalized contacts for downstream tables, CRM, scoring, and outreach workflows.',
  docsLink: 'https://docs.sim.ai/integrations/harmonic',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#FFFFFF',
  icon: HarmonicIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'Harmonic',
    sentences: {
      byOperation: {
        harmonic_search_people_scout: [{ text: 'Search people for', field: 'query', core: true }],
        harmonic_list_people_saved_searches: ['List people saved searches'],
        harmonic_get_people_saved_search_results: [
          {
            text: 'Read contacts from saved search',
            field: ['savedSearchSelector', 'savedSearchIdManual'],
            core: true,
          },
        ],
        harmonic_batch_get_people: [
          'Get people in batch',
          { text: 'by URNs', field: 'personUrns' },
          { text: 'or IDs', field: 'personIds' },
        ],
      },
    },
  },

  subBlocks: [
    {
      id: 'credential',
      title: 'Harmonic Account',
      type: 'oauth-input',
      serviceId: 'harmonic',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      placeholder: 'Select Harmonic credential',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Harmonic Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search People with Scout', id: 'harmonic_search_people_scout' },
        {
          label: 'List People Saved Searches',
          id: 'harmonic_list_people_saved_searches',
        },
        {
          label: 'Get People Saved Search Results',
          id: 'harmonic_get_people_saved_search_results',
        },
        { label: 'Batch Get People', id: 'harmonic_batch_get_people' },
      ],
      value: () => 'harmonic_search_people_scout',
    },
    {
      id: 'query',
      title: 'Search Query',
      canvasNoun: 'a search query',
      type: 'long-input',
      rows: 4,
      placeholder: 'Find forward-deployed engineers at enterprise software companies',
      condition: { field: 'operation', value: 'harmonic_search_people_scout' },
      required: { field: 'operation', value: 'harmonic_search_people_scout' },
      paramVisibility: 'user-or-llm',
    },
    {
      id: 'savedSearchSelector',
      title: 'Saved Search',
      canvasNoun: 'a saved search',
      type: 'project-selector',
      serviceId: 'harmonic',
      selectorKey: 'harmonic.savedSearches',
      canonicalParamId: 'savedSearchId',
      placeholder: 'Select a people saved search',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: { field: 'operation', value: 'harmonic_get_people_saved_search_results' },
      required: { field: 'operation', value: 'harmonic_get_people_saved_search_results' },
      paramVisibility: 'user-or-llm',
    },
    {
      id: 'savedSearchIdManual',
      title: 'Saved Search ID or URN',
      canvasNoun: 'a saved search',
      type: 'short-input',
      canonicalParamId: 'savedSearchId',
      placeholder: 'Saved search ID or urn:harmonic:saved_search:...',
      mode: 'advanced',
      condition: { field: 'operation', value: 'harmonic_get_people_saved_search_results' },
      required: { field: 'operation', value: 'harmonic_get_people_saved_search_results' },
      paramVisibility: 'user-or-llm',
    },
    {
      id: 'personUrns',
      title: 'Person URNs',
      type: 'code',
      language: 'json',
      placeholder: '["urn:harmonic:person:22", "urn:harmonic:person:1690"]',
      description: 'Batch Get requires at least one Person URN or Person ID',
      condition: { field: 'operation', value: 'harmonic_batch_get_people' },
      paramVisibility: 'user-or-llm',
      wandConfig: {
        enabled: true,
        prompt:
          'Return ONLY a JSON array of Harmonic person URNs from the provided input. Preserve each URN exactly and omit duplicates.',
        generationType: 'json-array',
      },
    },
    {
      id: 'personIds',
      title: 'Person IDs',
      type: 'code',
      language: 'json',
      placeholder: '[22, 1690]',
      description:
        'Numeric IDs for Batch Get People; IDs and URNs combined may contain 1-500 people',
      condition: { field: 'operation', value: 'harmonic_batch_get_people' },
      mode: 'advanced',
      paramVisibility: 'user-or-llm',
      wandConfig: {
        enabled: true,
        prompt:
          'Return ONLY a JSON array of numeric Harmonic person IDs from the provided input. Omit duplicates.',
        generationType: 'json-array',
      },
    },
    {
      id: 'size',
      title: 'Page Size',
      type: 'short-input',
      placeholder: '1-100',
      description: 'Number of records to return; defaults to 50 and is capped to the 1-100 range',
      value: () => '50',
      condition: { field: 'operation', value: [...PAGED_OPERATIONS] },
      mode: 'advanced',
      paramVisibility: 'user-or-llm',
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Next cursor from a previous response',
      condition: { field: 'operation', value: [...PAGED_OPERATIONS] },
      mode: 'advanced',
      paramVisibility: 'user-or-llm',
    },
  ],

  tools: {
    access: [
      'harmonic_search_people_scout',
      'harmonic_list_people_saved_searches',
      'harmonic_get_people_saved_search_results',
      'harmonic_batch_get_people',
    ],
    config: {
      tool: (params) => {
        if (!isHarmonicOperation(params.operation)) {
          throw new Error(`Invalid Harmonic operation: ${String(params.operation)}`)
        }
        return params.operation
      },
      /**
       * The generic executor merges raw subblock state under this object. Every
       * operation-specific key is therefore assigned explicitly; `undefined`
       * is what removes a stale value after the operation changes.
       */
      params: (params) => {
        const operation = String(params.operation ?? '')
        const isPaged = (PAGED_OPERATIONS as readonly string[]).includes(operation)
        const isBatchGet = operation === 'harmonic_batch_get_people'

        return {
          operation: undefined,
          apiKey: undefined,
          credential: undefined,
          manualCredential: undefined,
          savedSearchSelector: undefined,
          savedSearchIdManual: undefined,
          oauthCredential: params.oauthCredential,
          query: operation === 'harmonic_search_people_scout' ? params.query : undefined,
          savedSearchId:
            operation === 'harmonic_get_people_saved_search_results'
              ? params.savedSearchId
              : undefined,
          size: isPaged ? optionalValue(params.size) : undefined,
          cursor: isPaged ? optionalValue(params.cursor) : undefined,
          personIds: isBatchGet ? optionalValue(params.personIds) : undefined,
          personUrns: isBatchGet ? optionalValue(params.personUrns) : undefined,
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Harmonic operation to perform' },
    oauthCredential: {
      type: 'string',
      description: 'Reusable Harmonic team API-key credential',
    },
    query: { type: 'string', description: 'Natural-language Harmonic Scout people query' },
    savedSearchId: { type: 'string', description: 'People saved-search ID or full URN' },
    personIds: { type: 'array', description: 'Numeric Harmonic person IDs to retrieve' },
    personUrns: { type: 'array', description: 'Harmonic person URNs to retrieve' },
    size: { type: 'number', description: 'Saved-search page size, clamped to 1-100' },
    cursor: { type: 'string', description: 'Opaque saved-search pagination cursor' },
  },

  outputs: {
    contacts: {
      type: 'array',
      description:
        'Normalized contacts with personUrn, personId, fullName, firstName, lastName, headline, currentTitles, currentCompanyNames, currentCompanyUrns, primaryEmail, emails, phoneNumbers, linkedinUrl, formattedLocation, city, state, country, profilePictureUrl, summary, and isRedacted; unavailable array fields are null',
      condition: { field: 'operation', value: [...CONTACT_OPERATIONS] },
    },
    taskId: {
      type: 'string',
      description: 'Harmonic Scout task identifier',
      condition: { field: 'operation', value: 'harmonic_search_people_scout' },
    },
    status: {
      type: 'string',
      description: 'Terminal Harmonic Scout task status',
      condition: { field: 'operation', value: 'harmonic_search_people_scout' },
    },
    count: {
      type: 'number',
      description: 'Number of contacts or saved searches returned',
      condition: {
        field: 'operation',
        value: [
          'harmonic_search_people_scout',
          'harmonic_list_people_saved_searches',
          'harmonic_batch_get_people',
        ],
      },
    },
    savedSearches: {
      type: 'array',
      description:
        'People saved searches with savedSearchId, savedSearchUrn, name, isPrivate, savedSearchType, userSavedSearchType, creatorUrn, createdAt, and updatedAt',
      condition: { field: 'operation', value: 'harmonic_list_people_saved_searches' },
    },
    personUrns: {
      type: 'array',
      description: 'Harmonic person URNs returned by the saved search',
      condition: { field: 'operation', value: 'harmonic_get_people_saved_search_results' },
    },
    totalCount: {
      type: 'number',
      description: 'Total number of matching saved-search results',
      condition: { field: 'operation', value: 'harmonic_get_people_saved_search_results' },
    },
    pageInfo: {
      type: 'json',
      description: 'Pagination metadata with currentCursor, nextCursor, and hasNext',
      condition: { field: 'operation', value: 'harmonic_get_people_saved_search_results' },
    },
  },
}

export const HarmonicBlockMeta = {
  tags: ['enrichment', 'automation', 'agentic'],
  url: 'https://harmonic.ai',
  skills: [
    {
      name: 'search-people-with-scout',
      description:
        'Turn natural-language sourcing criteria into a normalized contact table with Harmonic Scout.',
      content:
        '# Search People with Scout\n\nUse Harmonic Scout when the request describes the people to find rather than supplying identifiers.\n\n## Steps\n1. Translate the request into a precise query that states role, company profile, geography, and any exclusions.\n2. Run Search People with Scout once; do not retry a timed-out task automatically.\n3. Review the returned contacts and keep the structured fields needed downstream.\n4. Preserve personUrn whenever Harmonic supplies it so Batch Get People can hydrate the record later.\n\n## Output\nReturn a contact table and the Scout task ID and status. Call out missing email or LinkedIn values instead of guessing them.',
    },
    {
      name: 'export-people-saved-search',
      description:
        'Resolve a team-visible people saved search and page its contacts into a downstream dataset.',
      content:
        '# Export People Saved Search\n\nRead a Harmonic people saved search into a workflow.\n\n## Steps\n1. Run List People Saved Searches and match the requested name to one search.\n2. Run Get People Saved Search Results with that ID or URN.\n3. Follow pageInfo.nextCursor while pageInfo.hasNext is true, using a page size no greater than 100.\n4. Deduplicate rows by personUrn and retain any URN-only results for hydration.\n\n## Output\nReturn the saved-search identity, total count, normalized contacts, unresolved person URNs, and whether pagination completed.',
    },
    {
      name: 'hydrate-person-urns',
      description:
        'Expand Harmonic person IDs or URNs into consistent contact records for scoring and routing.',
      content:
        '# Hydrate Person URNs\n\nUse Batch Get People when an upstream Harmonic result contains identifiers without complete contact fields.\n\n## Steps\n1. Collect the person IDs and URNs from the upstream rows.\n2. Deduplicate identifiers and split requests so each batch contains at most 500 identifiers.\n3. Run Batch Get People for each batch.\n4. Join normalized contacts back to the source rows by personUrn, falling back to personId only when necessary.\n\n## Output\nReturn the hydrated contacts and list any input identifiers that produced no contact.',
    },
    {
      name: 'rank-scout-shortlist',
      description:
        'Score Harmonic Scout contacts against explicit sourcing criteria and produce a review-ready shortlist.',
      content:
        '# Rank Scout Shortlist\n\nTurn a broad people search into a transparent shortlist.\n\n## Steps\n1. Run Search People with Scout using the requested role, company, industry, geography, and exclusion criteria.\n2. Score each normalized contact only on fields present in the result, such as title, company, location, and summary.\n3. Keep personUrn on every scored row and separate missing evidence from a negative match.\n4. Sort the qualifying contacts by score and retain the rejected rows with their reasons.\n\n## Output\nReturn a ranked contact table with score, evidence, and rejection reason. Do not infer missing contact attributes.',
    },
    {
      name: 'monitor-saved-search-snapshot',
      description:
        'Compare a team-visible people saved search with a stored snapshot to identify newly seen contacts.',
      content:
        '# Monitor Saved Search Snapshot\n\nDetect changes in a Harmonic people saved search without relying on provider triggers.\n\n## Steps\n1. Run List People Saved Searches and resolve the requested team-visible search.\n2. Page Get People Saved Search Results until pageInfo.hasNext is false.\n3. Deduplicate by personUrn and compare the complete set with the previously stored snapshot.\n4. Store the new snapshot only after every page succeeds.\n\n## Output\nReturn newly seen and no-longer-seen person URNs, the current total, and whether the pagination run completed.',
    },
    {
      name: 'audit-contact-coverage',
      description:
        'Audit a Harmonic people cohort for missing email, LinkedIn, company, and role data before outreach.',
      content:
        '# Audit Contact Coverage\n\nCheck whether a saved-search cohort is ready for scoring or outreach.\n\n## Steps\n1. Resolve the search with List People Saved Searches and page Get People Saved Search Results.\n2. Send any URN-only results through Batch Get People in batches of at most 500.\n3. Deduplicate by personUrn and flag contacts missing email, LinkedIn URL, current company, or current title.\n4. Calculate coverage rates per field without filling missing values from assumptions.\n\n## Output\nReturn the normalized contact table, field coverage rates, duplicate count, and rows requiring manual review.',
    },
  ],
  templates: [
    {
      icon: HarmonicIcon,
      title: 'Harmonic contact finder',
      prompt:
        'Build a chat-driven workflow that turns a sourcing request such as "find FDEs in enterprise software" into a Harmonic Scout search and writes the normalized contacts to a table for review.',
      modules: ['agent', 'tables', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'enrichment'],
      featured: true,
    },
    {
      icon: HarmonicIcon,
      title: 'Harmonic saved search sync',
      prompt:
        'Create a scheduled workflow that resolves a team-visible Harmonic people saved search, pages every result, compares person URNs with the prior table snapshot, and posts newly seen contacts to Slack.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'sales',
      tags: ['sales', 'monitoring', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: HarmonicIcon,
      title: 'Harmonic contact hydrator',
      prompt:
        'Build a workflow that accepts Harmonic person URNs from an earlier search, batches them in groups of 500, retrieves normalized contact records, and writes names, roles, companies, emails, and LinkedIn URLs to a table.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['data', 'enrichment', 'automation'],
    },
    {
      icon: HarmonicIcon,
      title: 'Harmonic sourcing shortlist',
      prompt:
        'Create an agent that searches Harmonic Scout for a sourcing thesis, scores the normalized contacts against explicit role, company, and location criteria, and writes the ranked shortlist with evidence to a review table.',
      modules: ['agent', 'tables', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'automation'],
    },
    {
      icon: HarmonicIcon,
      title: 'Harmonic CRM prospect route',
      prompt:
        'Build a workflow that searches Harmonic Scout for technical buyers at target accounts, filters contacts with a usable email or LinkedIn URL, deduplicates them by person URN, and writes qualified prospects to Salesforce.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'enrichment'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: HarmonicIcon,
      title: 'Harmonic contact coverage audit',
      prompt:
        'Create a workflow that resolves a team-visible Harmonic people saved search, pages all results, hydrates URN-only records in batches, flags duplicates and missing contact fields, and writes the review queue to Google Sheets.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['data', 'quality', 'automation'],
      alsoIntegrations: ['google_sheets'],
    },
    {
      icon: HarmonicIcon,
      title: 'Harmonic talent scout',
      prompt:
        'Build an agent that uses Harmonic Scout to find candidates with a requested title, industry background, and geography, ranks the normalized contacts, and sends the shortlist to a Slack hiring channel.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hiring', 'research', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: HarmonicIcon,
      title: 'Harmonic batch enrichment',
      prompt:
        'Create a workflow that accepts Harmonic person IDs and URNs from a table, deduplicates and splits them into batches of at most 500, retrieves normalized contacts with Batch Get People, and writes hydrated and unmatched rows separately.',
      modules: ['tables', 'workflows'],
      category: 'sales',
      tags: ['sales', 'data', 'automation'],
    },
  ],
} as const satisfies BlockMeta
