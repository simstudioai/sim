import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
import { DEALPORT_ACCESS_TOKEN_PARAM, DEALPORT_OAUTH } from '@/tools/dealport/params'
import {
  DEALPORT_MATCHED_COMPANY_OUTPUT_PROPERTIES,
  type DealportMatchCompaniesParams,
  type DealportMatchCompaniesResponse,
} from '@/tools/dealport/types'
import {
  buildMatchCompaniesBody,
  DEALPORT_API_BASE,
  dealportJsonHeaders,
  mapMatchedCompanyRow,
} from '@/tools/dealport/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const dealportMatchCompaniesTool: ToolConfig<
  DealportMatchCompaniesParams,
  DealportMatchCompaniesResponse
> = {
  id: 'dealport_match_companies',
  name: 'Dealport Match Companies',
  description:
    'Match 1 to 250 external company names and domains against 28M+ US private companies via domain and fuzzy entity resolution ($0.00).',
  version: '1.0.0',
  effect: 'write',
  oauth: DEALPORT_OAUTH,
  errorExtractor: ErrorExtractorId.STANDARD_MESSAGE,

  params: {
    ...DEALPORT_ACCESS_TOKEN_PARAM,
    items: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of 1 to 250 company objects with {name, domain, city, state, external_id}. Provide either items or csv.',
    },
    csv: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Raw CSV text with a header row (name, domain, city, state, id). Provide either items or csv.',
    },
    watch: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'When true, adds matched companies to weekly Project monitoring ($0.05 per company per month)',
    },
    project_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Target Dealport Project UUID when saving or watching matched companies',
    },
    project_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Target Dealport Project name when creating or targeting a Project by name',
    },
  },

  request: {
    url: `${DEALPORT_API_BASE}/companies/match`,
    method: 'POST',
    headers: (params) => dealportJsonHeaders(params.accessToken),
    body: (params) => buildMatchCompaniesBody(params),
  },

  transformResponse: async (response) => {
    const payload = toRecord(await response.json())
    const data = toRecord(payload.data)
    const matchedIds = toArray(data.matched_company_ids).flatMap((entry) => {
      const id = toStringOrNull(entry)
      return id !== null ? [id] : []
    })
    return {
      success: true,
      output: {
        total_input: toNumberOrNull(data.total_input) ?? 0,
        matched_count: toNumberOrNull(data.matched_count) ?? 0,
        unmatched_count: toNumberOrNull(data.unmatched_count) ?? 0,
        domain_matched_count: toNumberOrNull(data.domain_matched_count) ?? 0,
        fuzzy_matched_count: toNumberOrNull(data.fuzzy_matched_count) ?? 0,
        cached_owners_count: toNumberOrNull(data.cached_owners_count) ?? 0,
        matched_company_ids: matchedIds,
        results: toArray(data.results).map(mapMatchedCompanyRow),
        board_url: toStringOrNull(data.board_url),
        cost_usd: toNumberOrNull(payload.cost_usd) ?? toNumberOrNull(data.cost_usd) ?? 0,
        remaining_balance_usd:
          toNumberOrNull(payload.remaining_balance_usd) ??
          toNumberOrNull(data.remaining_balance_usd) ??
          0,
      },
    }
  },

  outputs: {
    total_input: {
      type: 'number',
      description: 'Total number of submitted company rows',
    },
    matched_count: {
      type: 'number',
      description: 'Number of rows matched to Dealport company Records',
    },
    unmatched_count: {
      type: 'number',
      description: 'Number of rows that did not match',
    },
    domain_matched_count: {
      type: 'number',
      description: 'Number of rows matched via exact registrable domain',
    },
    fuzzy_matched_count: {
      type: 'number',
      description: 'Number of rows matched via fuzzy entity and geography resolution',
    },
    cached_owners_count: {
      type: 'number',
      description: 'Number of matched companies with an already-cached human owner',
    },
    matched_company_ids: {
      type: 'array',
      description: 'Dealport company UUIDs for all matched rows',
      items: { type: 'string' },
    },
    results: {
      type: 'array',
      description: 'Per-row match outcomes and matched company details',
      items: {
        type: 'object',
        properties: DEALPORT_MATCHED_COMPANY_OUTPUT_PROPERTIES,
      },
    },
    board_url: {
      type: 'string',
      nullable: true,
      optional: true,
      description: 'Dealport Project URL when matched companies were attached to a Project',
    },
    cost_usd: {
      type: 'number',
      description: 'USD charge for this match request ($0.00 when watch is false)',
    },
    remaining_balance_usd: {
      type: 'number',
      description: 'Remaining workspace USD balance after the call',
    },
  },
}
