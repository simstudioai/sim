import type { CrunchbaseSearchParams, CrunchbaseSearchResponse } from '@/tools/crunchbase/types'
import {
  buildSearchBody,
  CRUNCHBASE_API_BASE,
  crunchbaseJsonHeaders,
  DEFAULT_ORGANIZATION_FIELD_IDS,
  transformSearchResponse,
} from '@/tools/crunchbase/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const crunchbaseSearchOrganizationsTool: ToolConfig<
  CrunchbaseSearchParams,
  CrunchbaseSearchResponse
> = {
  id: 'crunchbase_search_organizations',
  name: 'Crunchbase Search Organizations',
  description:
    'Search Crunchbase companies, investors, and schools with filter predicates on funding, headcount, location, category, and rank.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.CRUNCHBASE_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Crunchbase API key, sent as the X-cb-user-key header',
    },
    query: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Filter predicates, combined with AND. Array of {type:"predicate", field_id, operator_id, values}. Operators: blank, eq, not_eq, gt, gte, lt, lte, starts, contains, not_contains, between, includes, not_includes, includes_all, not_includes_all, domain_eq, not_domain_eq, domain_blank, domain_includes, not_domain_includes. Max 25 predicates. Example: [{"type":"predicate","field_id":"categories","operator_id":"includes","values":["biotechnology"]}]',
    },
    fieldIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Organization fields to return as columns, e.g. ["identifier","name","founded_on","categories"]. Defaults to identifier, name, short_description, website_url, linkedin, location_identifiers, categories, founded_on, num_employees_enum, operating_status, rank_org, permalink.',
    },
    order: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort clauses, e.g. [{"field_id":"rank_org","sort":"asc","nulls":"last"}]. Sort is "asc" or "desc".',
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
    url: `${CRUNCHBASE_API_BASE}/searches/organizations`,
    method: 'POST',
    headers: (params) => crunchbaseJsonHeaders(params.apiKey),
    body: (params) => buildSearchBody(params, DEFAULT_ORGANIZATION_FIELD_IDS),
  },

  transformResponse: transformSearchResponse,

  outputs: {
    count: {
      type: 'number',
      nullable: true,
      description: 'Total number of organizations matching the query',
    },
    entities: {
      type: 'json',
      description:
        'Matching organizations as [{uuid, properties}], where properties holds the requested field_ids',
    },
    nextAfterId: {
      type: 'string',
      nullable: true,
      description: 'UUID of the last row, to pass as afterId for the next page',
    },
  },
}
