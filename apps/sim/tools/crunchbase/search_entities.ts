import type { CrunchbaseSearchParams, CrunchbaseSearchResponse } from '@/tools/crunchbase/types'
import {
  assertCollection,
  buildSearchBody,
  CRUNCHBASE_API_BASE,
  CRUNCHBASE_COLLECTIONS,
  crunchbaseJsonHeaders,
  transformSearchResponse,
} from '@/tools/crunchbase/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

interface CrunchbaseSearchEntitiesParams extends CrunchbaseSearchParams {
  collection: string
}

export const crunchbaseSearchEntitiesTool: ToolConfig<
  CrunchbaseSearchEntitiesParams,
  CrunchbaseSearchResponse
> = {
  id: 'crunchbase_search_entities',
  name: 'Crunchbase Search Entities',
  description:
    'Search any Crunchbase collection — events, jobs, ipos, funds, investments, press references, layoffs, insights, predictions, and more — with filter predicates.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.CRUNCHBASE_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Crunchbase API key, sent as the X-cb-user-key header',
    },
    collection: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Collection to search. One of: acquisition_predictions, acquisitions, addresses, awards, categories, category_groups, closure_predictions, current_valuation_estimates, degrees, diversity_spotlights, event_appearances, events, funding_predictions, funding_rounds, funds, growth_insights, growth_predictions, investments, investor_insights, investor_matches, ipo_predictions, ipos, jobs, key_employee_changes, layoff_predictions, layoffs, legal_proceedings, locations, market_insight_reasons, market_insights, micro_categories, org_similarities, organizations, ownerships, partnership_announcements, people, press_references, principals, product_launches, product_similarities, products, remain_private_predictions, research_insights.',
    },
    query: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Filter predicates, combined with AND. Array of {type:"predicate", field_id, operator_id, values}. Operators: blank, eq, not_eq, gt, gte, lt, lte, starts, contains, not_contains, between, includes, not_includes, includes_all, not_includes_all, domain_eq, not_domain_eq, domain_blank, domain_includes, not_domain_includes. Max 25 predicates.',
    },
    fieldIds: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Fields to return as columns for the chosen collection, e.g. ["identifier","short_description"]. Required — the valid ids differ per collection; list them with the Get Fields Metadata operation.',
    },
    order: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort clauses, e.g. [{"field_id":"updated_at","sort":"desc","nulls":"last"}]. Sort is "asc" or "desc".',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Rows to return, 1-1000 (default 100)',
    },
    afterId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'UUID of the last entity on the current page, to fetch the next page. Cannot be combined with beforeId.',
    },
    beforeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'UUID of the first entity on the current page, to fetch the previous page. Cannot be combined with afterId.',
    },
  },

  request: {
    url: (params) =>
      `${CRUNCHBASE_API_BASE}/searches/${assertCollection(params.collection, CRUNCHBASE_COLLECTIONS, 'collection')}`,
    method: 'POST',
    headers: (params) => crunchbaseJsonHeaders(params.apiKey),
    body: (params) => buildSearchBody(params),
  },

  transformResponse: transformSearchResponse,

  outputs: {
    count: {
      type: 'number',
      nullable: true,
      description: 'Total number of entities matching the query',
    },
    entities: {
      type: 'json',
      description:
        'Matching entities as [{uuid, properties}], where properties holds the requested field_ids',
    },
    nextAfterId: {
      type: 'string',
      nullable: true,
      description: 'UUID of the last row, to pass as afterId for the next page',
    },
  },
}
