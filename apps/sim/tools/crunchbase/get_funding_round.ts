import type { CrunchbaseEntityParams, CrunchbaseEntityResponse } from '@/tools/crunchbase/types'
import {
  buildEntityUrl,
  crunchbaseHeaders,
  DEFAULT_FUNDING_ROUND_FIELD_IDS,
  transformEntityResponse,
} from '@/tools/crunchbase/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const crunchbaseGetFundingRoundTool: ToolConfig<
  CrunchbaseEntityParams,
  CrunchbaseEntityResponse
> = {
  id: 'crunchbase_get_funding_round',
  name: 'Crunchbase Get Funding Round',
  description:
    'Look up a single Crunchbase funding round by permalink or UUID, returning the requested fields and related cards.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.CRUNCHBASE_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Crunchbase API key, sent as the X-cb-user-key header',
    },
    entityId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Funding round permalink (e.g. "tesla-motors-series-c--12345678") or UUID',
    },
    fieldIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Funding round fields to return, e.g. ["identifier","announced_on","money_raised","investor_identifiers"]. Defaults to identifier, announced_on, investment_type, investment_stage, money_raised, funded_organization_identifier, investor_identifiers, lead_investor_identifiers, num_investors, short_description, permalink.',
    },
    cardIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Related-entity cards to include, e.g. ["investors","organization"]. Available: fields, investments, investors, lead_investors, organization, partners, press_references. A card returns at most 100 items.',
    },
  },

  request: {
    url: (params) => buildEntityUrl('funding_rounds', params, DEFAULT_FUNDING_ROUND_FIELD_IDS),
    method: 'GET',
    headers: (params) => crunchbaseHeaders(params.apiKey),
  },

  transformResponse: transformEntityResponse,

  outputs: {
    uuid: { type: 'string', nullable: true, description: 'Crunchbase UUID of the funding round' },
    name: { type: 'string', nullable: true, description: 'Funding round name' },
    permalink: {
      type: 'string',
      nullable: true,
      description: 'Crunchbase permalink of the funding round',
    },
    properties: {
      type: 'json',
      description: 'Requested funding round fields, keyed by field_id',
    },
    cards: {
      type: 'json',
      nullable: true,
      description: 'Requested related-entity cards, keyed by card_id',
    },
  },
}
