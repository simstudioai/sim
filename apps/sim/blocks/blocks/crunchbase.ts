import { Building, ListChecks, Search, Sprout, Trash, Users } from '@sim/emcn/icons'
import { CrunchbaseIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { CrunchbaseResponse } from '@/tools/crunchbase/types'
import {
  CRUNCHBASE_CARD_COLLECTIONS,
  CRUNCHBASE_COLLECTIONS,
  CRUNCHBASE_DELETED_COLLECTIONS,
} from '@/tools/crunchbase/utils'

/** Operations that POST to `/data/searches/{collection}`. */
const SEARCH_OPERATIONS = [
  'search_organizations',
  'search_people',
  'search_funding_rounds',
  'search_acquisitions',
  'search_entities',
] as const

/** Operations that GET `/data/entities/{collection}/{entity_id}`. */
const LOOKUP_OPERATIONS = [
  'get_organization',
  'get_person',
  'get_funding_round',
  'get_acquisition',
  'get_entity',
] as const

/** Operations that take a collection dropdown rather than an implied collection. */
const COLLECTION_OPERATIONS = ['search_entities', 'get_entity'] as const

/** Operations whose field list falls back to a verified per-collection default. */
const DEFAULTED_FIELD_ID_OPERATIONS = [...SEARCH_OPERATIONS, ...LOOKUP_OPERATIONS].filter(
  (operation) => operation !== 'search_entities'
)

/** Operations whose endpoint accepts a `limit`. */
const LIMITED_OPERATIONS = [
  ...SEARCH_OPERATIONS,
  'autocomplete',
  'get_entity_card',
  'list_deleted_entities',
]

/** Operations paged with the keyset `after_id` / `before_id` cursors. */
const CURSOR_OPERATIONS = [...SEARCH_OPERATIONS, 'get_entity_card', 'list_deleted_entities']

/** Turns a collection id into the dropdown label a reader expects. */
function toCollectionOption(id: string) {
  return {
    label: id
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' '),
    id,
  }
}

const COLLECTION_OPTIONS = CRUNCHBASE_COLLECTIONS.map(toCollectionOption)
const CARD_COLLECTION_OPTIONS = CRUNCHBASE_CARD_COLLECTIONS.map(toCollectionOption)
/**
 * The empty id is what returns the picker to the cross-collection feed — without
 * it a chosen collection can be swapped but never cleared.
 */
const DELETED_COLLECTION_OPTIONS = [
  { label: 'All collections', id: '' },
  ...CRUNCHBASE_DELETED_COLLECTIONS.map(toCollectionOption),
]

const QUERY_WAND_PROMPT = `Generate a Crunchbase Search API "query" array.

Each element is a predicate object: {"type":"predicate","field_id":"...","operator_id":"...","values":[...]}.
Predicates are combined with AND only; at most 25 are allowed, each with at most 200 values.
Valid operator_id values: blank, eq, not_eq, gt, gte, lt, lte, starts, contains, not_contains, between, includes, not_includes, includes_all, not_includes_all, domain_eq, not_domain_eq, domain_blank, domain_includes, not_domain_includes.
"between" takes exactly two values. "blank" takes "true" or "false".
Use field_ids belonging to the collection being searched — organizations support categories, location_identifiers, founded_on, num_employees_enum, operating_status and rank_org; people support primary_job_title and primary_organization; funding rounds support announced_on, investment_type and money_raised; acquisitions support announced_on, price and acquisition_type.

Return ONLY the JSON array.`

export const CrunchbaseBlock: BlockConfig<CrunchbaseResponse> = {
  type: 'crunchbase',
  name: 'Crunchbase',
  description: 'Search and look up companies, people, funding rounds, and acquisitions',
  longDescription:
    'Integrates the Crunchbase Data API into the workflow. Search organizations, people, funding rounds, and acquisitions with filter predicates, reach the other 39 collections through the generic search and lookup operations, page a single related-entity card past its 100-item cap, autocomplete names into identifiers, follow the deleted-entity feed, and list the fields each collection publishes. Which collections and fields resolve depends on your Crunchbase license.',
  docsLink: 'https://docs.sim.ai/integrations/crunchbase',
  category: 'tools',
  integrationType: IntegrationType.Sales,
  bgColor: '#0287D1',
  icon: CrunchbaseIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'Crunchbase',
    sentences: {
      byOperation: {
        search_organizations: [
          'Search organizations',
          { text: 'matching', field: 'searchQuery', core: true },
        ],
        search_people: ['Search people', { text: 'matching', field: 'searchQuery', core: true }],
        search_funding_rounds: [
          'Search funding rounds',
          { text: 'matching', field: 'searchQuery', core: true },
        ],
        search_acquisitions: [
          'Search acquisitions',
          { text: 'matching', field: 'searchQuery', core: true },
        ],
        search_entities: [
          { text: 'Search', field: 'collection', core: true },
          { text: 'matching', field: 'searchQuery', core: true },
        ],
        get_organization: [{ text: 'Look up organization', field: 'entityId', core: true }],
        get_person: [{ text: 'Look up person', field: 'entityId', core: true }],
        get_funding_round: [{ text: 'Look up funding round', field: 'entityId', core: true }],
        get_acquisition: [{ text: 'Look up acquisition', field: 'entityId', core: true }],
        get_entity: [
          { text: 'Look up', field: 'entityId', core: true },
          { text: 'in', field: 'collection', core: true },
        ],
        get_entity_card: [
          { text: 'Read', field: 'cardId', core: true },
          { text: 'of', field: 'entityId', core: true },
        ],
        autocomplete: [
          { text: 'Suggest entities matching', field: 'autocompleteQuery', core: true },
        ],
        list_deleted_entities: [
          'List deleted entities',
          { text: 'from', field: 'deletedCollection' },
        ],
        get_fields_metadata: ['List the fields each collection publishes'],
      },
    },
  },

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Search Organizations', id: 'search_organizations' },
        { label: 'Get Organization', id: 'get_organization' },
        { label: 'Search People', id: 'search_people' },
        { label: 'Get Person', id: 'get_person' },
        { label: 'Search Funding Rounds', id: 'search_funding_rounds' },
        { label: 'Get Funding Round', id: 'get_funding_round' },
        { label: 'Search Acquisitions', id: 'search_acquisitions' },
        { label: 'Get Acquisition', id: 'get_acquisition' },
        { label: 'Search Any Collection', id: 'search_entities' },
        { label: 'Get Any Entity', id: 'get_entity' },
        { label: 'Get Entity Card', id: 'get_entity_card' },
        { label: 'Autocomplete', id: 'autocomplete' },
        { label: 'List Deleted Entities', id: 'list_deleted_entities' },
        { label: 'Get Fields Metadata', id: 'get_fields_metadata' },
      ],
      value: () => 'search_organizations',
    },
    {
      id: 'apiKey',
      title: 'Crunchbase API Key',
      type: 'short-input',
      placeholder: 'Enter your Crunchbase API key',
      password: true,
      required: true,
    },
    {
      id: 'collection',
      title: 'Collection',
      type: 'dropdown',
      options: COLLECTION_OPTIONS,
      condition: { field: 'operation', value: [...COLLECTION_OPERATIONS] },
      required: { field: 'operation', value: [...COLLECTION_OPERATIONS] },
    },
    {
      id: 'searchQuery',
      title: 'Query',
      type: 'code',
      language: 'json',
      placeholder:
        '[{"type":"predicate","field_id":"categories","operator_id":"includes","values":["biotechnology"]}]',
      condition: { field: 'operation', value: [...SEARCH_OPERATIONS] },
      required: { field: 'operation', value: [...SEARCH_OPERATIONS] },
      wandConfig: {
        enabled: true,
        prompt: QUERY_WAND_PROMPT,
        generationType: 'json-array',
      },
    },
    {
      id: 'entityId',
      title: 'Entity ID',
      type: 'short-input',
      placeholder: 'Permalink or UUID (e.g. tesla-motors)',
      condition: { field: 'operation', value: [...LOOKUP_OPERATIONS, 'get_entity_card'] },
      required: { field: 'operation', value: [...LOOKUP_OPERATIONS, 'get_entity_card'] },
    },
    {
      id: 'autocompleteQuery',
      title: 'Search Text',
      type: 'short-input',
      placeholder: 'e.g. airbnb',
      condition: { field: 'operation', value: 'autocomplete' },
      required: { field: 'operation', value: 'autocomplete' },
    },
    {
      id: 'cardCollection',
      title: 'Collection',
      type: 'dropdown',
      options: CARD_COLLECTION_OPTIONS,
      condition: { field: 'operation', value: 'get_entity_card' },
      required: { field: 'operation', value: 'get_entity_card' },
    },
    {
      id: 'cardId',
      title: 'Card ID',
      type: 'short-input',
      placeholder: 'e.g. founders, investors, participated_investments',
      condition: { field: 'operation', value: 'get_entity_card' },
      required: { field: 'operation', value: 'get_entity_card' },
    },
    {
      id: 'deletedCollection',
      title: 'Collection',
      type: 'dropdown',
      options: DELETED_COLLECTION_OPTIONS,
      placeholder: 'All collections',
      condition: { field: 'operation', value: 'list_deleted_entities' },
    },
    {
      id: 'searchFieldIds',
      title: 'Field IDs',
      type: 'code',
      language: 'json',
      placeholder: '["identifier","short_description","updated_at"]',
      condition: { field: 'operation', value: 'search_entities' },
      required: { field: 'operation', value: 'search_entities' },
    },
    {
      id: 'fieldIds',
      title: 'Field IDs',
      type: 'code',
      language: 'json',
      mode: 'advanced',
      placeholder: '["identifier","name","founded_on","categories"]',
      condition: { field: 'operation', value: DEFAULTED_FIELD_ID_OPERATIONS },
    },
    {
      id: 'cardIds',
      title: 'Card IDs',
      type: 'code',
      language: 'json',
      mode: 'advanced',
      placeholder: '["founders","headquarters_address"]',
      condition: { field: 'operation', value: [...LOOKUP_OPERATIONS] },
    },
    {
      id: 'cardFieldIds',
      title: 'Card Field IDs',
      type: 'code',
      language: 'json',
      mode: 'advanced',
      placeholder: '["identifier","announced_on","money_raised"]',
      condition: { field: 'operation', value: 'get_entity_card' },
    },
    {
      id: 'order',
      title: 'Order',
      type: 'code',
      language: 'json',
      mode: 'advanced',
      placeholder: '[{"field_id":"rank_org","sort":"asc","nulls":"last"}]',
      condition: { field: 'operation', value: [...SEARCH_OPERATIONS] },
    },
    {
      id: 'cardOrder',
      title: 'Order',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. funding_round_money_raised desc',
      condition: { field: 'operation', value: 'get_entity_card' },
    },
    {
      id: 'deletedAtOrder',
      title: 'Deleted At Order',
      type: 'dropdown',
      options: [
        { label: 'Oldest first', id: 'asc' },
        { label: 'Newest first', id: 'desc' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_deleted_entities' },
    },
    {
      id: 'collectionIds',
      title: 'Collection IDs',
      type: 'code',
      language: 'json',
      mode: 'advanced',
      placeholder: '["organizations","people"]',
      condition: {
        field: 'operation',
        value: ['autocomplete', 'list_deleted_entities', 'get_fields_metadata'],
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      mode: 'advanced',
      placeholder:
        'Search: 1-1000 (default 100). Card: 1-100. Autocomplete and deleted feed: 1-25 (default 10)',
      condition: { field: 'operation', value: LIMITED_OPERATIONS },
    },
    {
      id: 'afterId',
      title: 'After ID',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'UUID of the last row on the current page',
      condition: { field: 'operation', value: CURSOR_OPERATIONS },
    },
    {
      id: 'beforeId',
      title: 'Before ID',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'UUID of the first row on the current page',
      condition: { field: 'operation', value: CURSOR_OPERATIONS },
    },
  ],

  tools: {
    access: [
      'crunchbase_search_organizations',
      'crunchbase_get_organization',
      'crunchbase_search_people',
      'crunchbase_get_person',
      'crunchbase_search_funding_rounds',
      'crunchbase_get_funding_round',
      'crunchbase_search_acquisitions',
      'crunchbase_get_acquisition',
      'crunchbase_search_entities',
      'crunchbase_get_entity',
      'crunchbase_get_entity_card',
      'crunchbase_autocomplete',
      'crunchbase_list_deleted_entities',
      'crunchbase_get_fields_metadata',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'search_organizations':
            return 'crunchbase_search_organizations'
          case 'get_organization':
            return 'crunchbase_get_organization'
          case 'search_people':
            return 'crunchbase_search_people'
          case 'get_person':
            return 'crunchbase_get_person'
          case 'search_funding_rounds':
            return 'crunchbase_search_funding_rounds'
          case 'get_funding_round':
            return 'crunchbase_get_funding_round'
          case 'search_acquisitions':
            return 'crunchbase_search_acquisitions'
          case 'get_acquisition':
            return 'crunchbase_get_acquisition'
          case 'search_entities':
            return 'crunchbase_search_entities'
          case 'get_entity':
            return 'crunchbase_get_entity'
          case 'get_entity_card':
            return 'crunchbase_get_entity_card'
          case 'autocomplete':
            return 'crunchbase_autocomplete'
          case 'list_deleted_entities':
            return 'crunchbase_list_deleted_entities'
          case 'get_fields_metadata':
            return 'crunchbase_get_fields_metadata'
          default:
            throw new Error(`Invalid Crunchbase operation: ${params.operation}`)
        }
      },
      /**
       * Every key the block can send is assigned unconditionally.
       *
       * The executor merges the raw subblock state underneath this result, so
       * omitting a key leaves the previous operation's value on the wire — an
       * advanced field is serialized on non-emptiness alone, even while the UI
       * hides it. `undefined` is what actually drops one.
       */
      params: (params) => {
        const operation = String(params.operation ?? '')
        const isSearch = (SEARCH_OPERATIONS as readonly string[]).includes(operation)
        const isLookup = (LOOKUP_OPERATIONS as readonly string[]).includes(operation)
        const isCollectionScoped = (COLLECTION_OPERATIONS as readonly string[]).includes(operation)
        const isCard = operation === 'get_entity_card'
        const isAutocomplete = operation === 'autocomplete'
        const isDeleted = operation === 'list_deleted_entities'
        const isMetadata = operation === 'get_fields_metadata'
        const paginates = isSearch || isCard || isDeleted

        let query: unknown
        if (isSearch) query = params.searchQuery
        else if (isAutocomplete) query = params.autocompleteQuery

        let collection: unknown
        if (isCollectionScoped) collection = params.collection
        else if (isCard) collection = params.cardCollection
        else if (isDeleted) collection = params.deletedCollection

        return {
          apiKey: params.apiKey,
          query,
          collection,
          entityId: isLookup || isCard ? params.entityId : undefined,
          cardId: isCard ? params.cardId : undefined,
          fieldIds:
            operation === 'search_entities'
              ? params.searchFieldIds
              : isSearch || isLookup
                ? params.fieldIds
                : undefined,
          cardIds: isLookup ? params.cardIds : undefined,
          cardFieldIds: isCard ? params.cardFieldIds : undefined,
          order: isSearch ? params.order : undefined,
          cardOrder: isCard ? params.cardOrder : undefined,
          deletedAtOrder: isDeleted ? params.deletedAtOrder : undefined,
          collectionIds:
            isAutocomplete || isDeleted || isMetadata ? params.collectionIds : undefined,
          limit: isSearch || isAutocomplete || isCard || isDeleted ? params.limit : undefined,
          afterId: paginates ? params.afterId : undefined,
          beforeId: paginates ? params.beforeId : undefined,
          searchQuery: undefined,
          searchFieldIds: undefined,
          autocompleteQuery: undefined,
          cardCollection: undefined,
          deletedCollection: undefined,
        }
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Crunchbase operation to perform' },
  },

  outputs: {
    count: {
      type: 'number',
      description: 'Total matches for a search operation',
    },
    entities: {
      type: 'json',
      description:
        'Search rows as [{uuid, properties}], autocomplete suggestions as [{identifier, facet_ids, short_description}], or deleted rows as [{deleted_at, identifier}]',
    },
    items: {
      type: 'json',
      description: 'Card items returned by Get Entity Card',
    },
    nextAfterId: {
      type: 'string',
      description: 'UUID of the last row, to pass as After ID for the next page',
    },
    uuid: {
      type: 'string',
      description: 'Crunchbase UUID of a looked-up entity',
    },
    name: {
      type: 'string',
      description: 'Name of a looked-up entity',
    },
    permalink: {
      type: 'string',
      description: 'Crunchbase permalink of a looked-up entity',
    },
    properties: {
      type: 'json',
      description: 'Requested fields of a looked-up entity, keyed by field_id',
    },
    cards: {
      type: 'json',
      description: 'Requested related-entity cards of a looked-up entity, keyed by card_id',
    },
    csv: {
      type: 'string',
      description: 'Field metadata as CSV, returned by Get Fields Metadata',
    },
  },
}

export const CrunchbaseBlockMeta = {
  tags: ['enrichment', 'data-analytics'],
  url: 'https://www.crunchbase.com',
  skills: [
    {
      name: 'enrich-company-record',
      description:
        'Resolve a company name or domain to its Crunchbase organization and pull firmographics onto the record. Use to fill in accounts before scoring or routing.',
      content:
        '# Enrich Company Record\n\nTurn a company name into a complete Crunchbase organization record.\n\n## Steps\n1. Run Autocomplete on the company name, constrained to the organizations collection, and take the permalink of the best match.\n2. Look up the organization with the fields the record needs — short_description, website_url, location_identifiers, categories, founded_on, num_employees_enum, operating_status.\n3. When the record needs the leadership team, add the founders card.\n4. Merge the returned fields onto the record, keeping existing values where Crunchbase returned nothing.\n\n## Output\nReport the matched permalink and the fields filled. Flag a name that autocompleted to nothing or matched more than one plausible company.',
    },
    {
      name: 'build-target-account-list',
      description:
        'Search Crunchbase organizations against an ideal customer profile and page the full result set into a list. Use for territory and campaign planning.',
      content:
        '# Build Target Account List\n\nTurn an ICP description into a paged list of matching companies.\n\n## Steps\n1. Translate the ICP into search predicates — categories with `includes`, location_identifiers with `includes`, num_employees_enum with `includes`, founded_on with `between`.\n2. Run Search Organizations with the columns the list needs and an order clause on rank_org.\n3. Page forward by passing the returned nextAfterId as After ID until a page comes back short.\n4. Write the deduplicated companies to a table.\n\n## Output\nReport the total match count, how many rows were retrieved, and the predicates used. Note when paging stopped early.',
    },
    {
      name: 'track-funding-rounds',
      description:
        'Find funding rounds announced in a window and report the company, stage, amount, and investors. Use for daily or weekly funding alerts.',
      content:
        '# Track Funding Rounds\n\nSurface new funding in a market and summarize each round.\n\n## Steps\n1. Search Funding Rounds with an `announced_on` `gte` predicate for the window, plus any category or amount filters.\n2. Request announced_on, investment_type, money_raised, funded_organization_identifier, investor_identifiers, and lead_investor_identifiers.\n3. Order by announced_on descending so the newest rounds lead.\n4. Summarize each round as company, stage, amount raised, and lead investors.\n\n## Output\nReport the rounds found in the window. State the window explicitly, and say so plainly when nothing was announced.',
    },
    {
      name: 'map-investor-portfolio',
      description:
        "Page an investor's participated investments and summarize their stage, sector, and check-size focus. Use for diligence and investor research.",
      content:
        '# Map Investor Portfolio\n\nAssemble what an investor actually backs from their investment card.\n\n## Steps\n1. Autocomplete the investor name against the organizations or people collection to get a permalink.\n2. Read the participated_investments card with Get Entity Card, requesting the announced date, amount, and funded organization.\n3. Page forward with the returned nextAfterId until the card is exhausted — an inline card request stops at 100 items.\n4. Group the investments by stage, sector, and year to describe the pattern.\n\n## Output\nReport the number of investments read, the stage and sector concentration, and the typical check size. Say when the portfolio was truncated by a license limit.',
    },
    {
      name: 'monitor-acquisitions',
      description:
        'Search acquisitions announced in a window and summarize acquirer, target, price, and terms. Use for competitive and market monitoring.',
      content:
        '# Monitor Acquisitions\n\nWatch consolidation in a market.\n\n## Steps\n1. Search Acquisitions with an `announced_on` `gte` predicate for the window.\n2. Request acquiree_identifier, acquirer_identifier, announced_on, price, acquisition_type, status, and terms.\n3. Order by announced_on descending.\n4. Summarize each deal, calling out an undisclosed price rather than reporting it as zero.\n\n## Output\nReport each deal as acquirer, target, price, and status. Note deals whose price Crunchbase does not publish.',
    },
    {
      name: 'discover-collection-fields',
      description:
        'List the fields a Crunchbase collection publishes before writing a search. Use when a predicate or column name is uncertain.',
      content:
        '# Discover Collection Fields\n\nGround a search in the fields the license actually exposes.\n\n## Steps\n1. Run Get Fields Metadata for the collections in question.\n2. Read the returned CSV for the field ids, their types, and their descriptions.\n3. Pick the columns for `field_ids` and the filterable fields for the query predicates.\n4. Run the search with those exact ids.\n\n## Output\nReport the fields chosen and why. Say explicitly when a field the request assumed does not exist on that collection or under this license.',
    },
    {
      name: 'prune-deleted-entities',
      description:
        'Read the Crunchbase deleted-entity feed and remove the matching rows from a mirrored copy. Use to keep a local mirror in step with the source.',
      content:
        '# Prune Deleted Entities\n\nKeep a mirrored copy from drifting away from Crunchbase.\n\n## Steps\n1. Run List Deleted Entities for the collections being mirrored, ordering by deletion time ascending.\n2. Page forward with the returned nextAfterId, keeping the last cursor as the watermark for the next run.\n3. Match each deleted uuid against the mirrored rows.\n4. Delete or tombstone the matches, leaving unmatched deletions alone.\n\n## Output\nReport how many deletions were read, how many matched local rows, and the cursor to resume from.',
    },
  ],
  templates: [
    {
      icon: CrunchbaseIcon,
      title: 'Crunchbase funding round watcher',
      prompt:
        'Build a workflow that runs every morning, searches Crunchbase for funding rounds announced in the last day in my target categories, and posts each round — company, stage, amount raised, and lead investors — to a Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: Building,
      title: 'Crunchbase account enrichment',
      prompt:
        'Create a workflow that watches my accounts table for new company names, autocompletes each one against Crunchbase to resolve its permalink, looks up the organization, and writes headcount, headquarters, categories, and founding date back to the row.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'enrichment'],
    },
    {
      icon: CrunchbaseIcon,
      title: 'Crunchbase ICP company list',
      prompt:
        'Build a workflow that searches Crunchbase organizations matching my ideal customer profile — category, headcount band, and headquarters region — pages through every result, and writes the company list to a table for the SDR team.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'automation'],
    },
    {
      icon: Sprout,
      title: 'Crunchbase investor portfolio brief',
      prompt:
        'Create an agent that takes an investor name, looks them up in Crunchbase, pages through their participated investments card, and writes a brief covering stage focus, check size, and the sectors they back most.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['research', 'finance'],
    },
    {
      icon: Users,
      title: 'Crunchbase founder finder',
      prompt:
        'Build a workflow that takes a list of target companies, looks each one up in Crunchbase with the founders card, and writes every founder with their title and LinkedIn to a table so I can start outreach.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'research', 'crm'],
    },
    {
      icon: CrunchbaseIcon,
      title: 'Crunchbase acquisition digest',
      prompt:
        'Create a scheduled workflow that searches Crunchbase for acquisitions announced this week in my industry, summarizes each deal — acquirer, target, price, and terms — and emails the digest to the strategy team every Friday.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['research', 'reporting', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: Search,
      title: 'Crunchbase competitor tracker',
      prompt:
        'Build a workflow that takes my competitor list, looks each company up in Crunchbase, compares headcount, operating status, and latest funding against what I stored last month, and alerts me in Slack when anything changed.',
      modules: ['tables', 'scheduled', 'workflows'],
      category: 'marketing',
      tags: ['research', 'monitoring', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: CrunchbaseIcon,
      title: 'Crunchbase inbound lead qualifier',
      prompt:
        'Create a workflow that runs when a demo request comes in, resolves the submitted company against Crunchbase, looks up its headcount, funding stage, and category, and routes the lead to the enterprise or self-serve queue based on what it finds.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm', 'automation'],
    },
    {
      icon: Trash,
      title: 'Crunchbase mirror pruner',
      prompt:
        'Build a nightly workflow that reads the Crunchbase deleted-entity feed for organizations and people, matches each deletion against my mirrored companies table, and removes or tombstones the rows that no longer exist upstream.',
      modules: ['tables', 'scheduled', 'workflows'],
      category: 'operations',
      tags: ['data', 'automation', 'maintenance'],
    },
    {
      icon: ListChecks,
      title: 'Crunchbase query builder',
      prompt:
        'Create an agent that lists the fields a Crunchbase collection publishes, turns a plain-English request like "European fintechs that raised a Series B last quarter" into the matching search predicates, runs the search, and returns the results.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'data'],
    },
  ],
} as const satisfies BlockMeta
