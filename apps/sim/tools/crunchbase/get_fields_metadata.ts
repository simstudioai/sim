import {
  appendCsvParam,
  assertCollections,
  CRUNCHBASE_API_ROOT,
  CRUNCHBASE_METADATA_COLLECTIONS,
  crunchbaseError,
  parseIdListParam,
} from '@/tools/crunchbase/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface CrunchbaseGetFieldsMetadataParams {
  apiKey: string
  collectionIds?: string[] | string
}

interface CrunchbaseGetFieldsMetadataResponse extends ToolResponse {
  output: {
    csv: string
  }
}

export const crunchbaseGetFieldsMetadataTool: ToolConfig<
  CrunchbaseGetFieldsMetadataParams,
  CrunchbaseGetFieldsMetadataResponse
> = {
  id: 'crunchbase_get_fields_metadata',
  name: 'Crunchbase Get Fields Metadata',
  description:
    'List the field ids, types, and descriptions each Crunchbase collection publishes, which is how the field_ids and query predicates of the other operations are discovered.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.CRUNCHBASE_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Crunchbase API key, sent as the X-cb-user-key header',
    },
    collectionIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Collections to describe, e.g. ["organizations","people"]. One or more of: acquisition_predictions, acquisitions, addresses, awards, categories, category_groups, closure_predictions, current_valuation_estimates, degrees, diversity_spotlights, event_appearances, events, funding_predictions, funding_rounds, funds, growth_insights, growth_predictions, investments, investor_insights, investor_matches, ipo_predictions, ipos, jobs, key_employee_changes, layoff_predictions, layoffs, legal_proceedings, locations, market_insight_reasons, market_insights, micro_categories, org_similarities, organizations, ownerships, partnership_announcements, people, press_references, principals, product_launches, product_similarities, products, remain_private_predictions, research_insights. Which of them your key can read depends on your Crunchbase package. Defaults to every collection.',
    },
  },

  request: {
    url: (params) => {
      const search = new URLSearchParams()
      appendCsvParam(
        search,
        'collection_ids',
        assertCollections(
          parseIdListParam(params.collectionIds, 'collectionIds'),
          CRUNCHBASE_METADATA_COLLECTIONS,
          'collectionIds'
        )
      )
      const qs = search.toString()
      return `${CRUNCHBASE_API_ROOT}/md/applications/crunchbase/fields${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      'X-cb-user-key': params.apiKey,
      Accept: 'text/csv',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) throw await crunchbaseError(response)

    /* This endpoint answers in CSV rather than JSON, so the body is passed
       through verbatim for a downstream parser to read. */
    return {
      success: true,
      output: { csv: await response.text() },
    }
  },

  outputs: {
    csv: {
      type: 'string',
      description:
        'Field metadata as CSV, one row per field with its collection, id, type, and description',
    },
  },
}
