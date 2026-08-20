import type { CrunchbaseSearchParams, CrunchbaseSearchResponse } from '@/tools/crunchbase/types'
import {
  buildSearchBody,
  CRUNCHBASE_API_BASE,
  crunchbaseJsonHeaders,
  DEFAULT_PERSON_FIELD_IDS,
  transformSearchResponse,
} from '@/tools/crunchbase/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const crunchbaseSearchPeopleTool: ToolConfig<
  CrunchbaseSearchParams,
  CrunchbaseSearchResponse
> = {
  id: 'crunchbase_search_people',
  name: 'Crunchbase Search People',
  description:
    'Search Crunchbase people — founders, executives, and investors — with filter predicates on job title, organization, location, and rank.',
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
        'Filter predicates, combined with AND. Array of {type:"predicate", field_id, operator_id, values}. Operators: blank, eq, not_eq, gt, gte, lt, lte, starts, contains, not_contains, between, includes, not_includes, includes_all, not_includes_all, domain_eq, not_domain_eq, domain_blank, domain_includes, not_domain_includes. Max 25 predicates. Example: [{"type":"predicate","field_id":"primary_job_title","operator_id":"contains","values":["Founder"]}]',
    },
    fieldIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Person fields to return as columns, e.g. ["identifier","name","primary_job_title","primary_organization"]. Defaults to identifier, name, first_name, last_name, primary_job_title, primary_organization, short_description, location_identifiers, linkedin, rank_person, permalink.',
    },
    order: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Sort clauses, e.g. [{"field_id":"rank_person","sort":"asc","nulls":"last"}]. Sort is "asc" or "desc".',
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
    url: `${CRUNCHBASE_API_BASE}/searches/people`,
    method: 'POST',
    headers: (params) => crunchbaseJsonHeaders(params.apiKey),
    body: (params) => buildSearchBody(params, DEFAULT_PERSON_FIELD_IDS),
  },

  transformResponse: transformSearchResponse,

  outputs: {
    count: {
      type: 'number',
      nullable: true,
      description: 'Total number of people matching the query',
    },
    entities: {
      type: 'json',
      description:
        'Matching people as [{uuid, properties}], where properties holds the requested field_ids',
    },
    nextAfterId: {
      type: 'string',
      nullable: true,
      description: 'UUID of the last row, to pass as afterId for the next page',
    },
  },
}
