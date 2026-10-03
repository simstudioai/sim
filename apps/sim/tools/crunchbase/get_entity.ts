import type { CrunchbaseEntityParams, CrunchbaseEntityResponse } from '@/tools/crunchbase/types'
import {
  assertCollection,
  buildEntityUrl,
  CRUNCHBASE_COLLECTIONS,
  crunchbaseHeaders,
  transformEntityResponse,
} from '@/tools/crunchbase/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

interface CrunchbaseGetEntityParams extends CrunchbaseEntityParams {
  collection: string
}

export const crunchbaseGetEntityTool: ToolConfig<
  CrunchbaseGetEntityParams,
  CrunchbaseEntityResponse
> = {
  id: 'crunchbase_get_entity',
  name: 'Crunchbase Get Entity',
  description:
    'Look up a single entity in any Crunchbase collection — events, jobs, ipos, funds, investments, press references, insights, predictions, and more — by permalink or UUID.',
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
        'Collection the entity belongs to. One of: acquisition_predictions, acquisitions, addresses, awards, categories, category_groups, closure_predictions, current_valuation_estimates, degrees, diversity_spotlights, event_appearances, events, funding_predictions, funding_rounds, funds, growth_insights, growth_predictions, investments, investor_insights, investor_matches, ipo_predictions, ipos, jobs, key_employee_changes, layoff_predictions, layoffs, legal_proceedings, locations, market_insight_reasons, market_insights, micro_categories, org_similarities, organizations, ownerships, partnership_announcements, people, press_references, principals, product_launches, product_similarities, products, remain_private_predictions, research_insights.',
    },
    entityId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Entity permalink or UUID',
    },
    fieldIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Fields to return for the chosen collection, e.g. ["identifier","short_description"]. Leave empty to accept the default projection the API returns; list the valid ids with the Get Fields Metadata operation.',
    },
    cardIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Related-entity cards to include. The valid ids differ per collection, and a card returns at most 100 items — use the Get Entity Card operation to page past that.',
    },
  },

  request: {
    url: (params) =>
      buildEntityUrl(
        assertCollection(params.collection, CRUNCHBASE_COLLECTIONS, 'collection'),
        params
      ),
    method: 'GET',
    headers: (params) => crunchbaseHeaders(params.apiKey),
  },

  transformResponse: transformEntityResponse,

  outputs: {
    uuid: { type: 'string', nullable: true, description: 'Crunchbase UUID of the entity' },
    name: { type: 'string', nullable: true, description: 'Name of the entity' },
    permalink: {
      type: 'string',
      nullable: true,
      description: 'Crunchbase permalink of the entity',
    },
    properties: {
      type: 'json',
      description: 'Requested entity fields, keyed by field_id',
    },
    cards: {
      type: 'json',
      nullable: true,
      description: 'Requested related-entity cards, keyed by card_id',
    },
  },
}
