import type { CrunchbaseEntityParams, CrunchbaseEntityResponse } from '@/tools/crunchbase/types'
import {
  buildEntityUrl,
  crunchbaseHeaders,
  DEFAULT_ACQUISITION_FIELD_IDS,
  transformEntityResponse,
} from '@/tools/crunchbase/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const crunchbaseGetAcquisitionTool: ToolConfig<
  CrunchbaseEntityParams,
  CrunchbaseEntityResponse
> = {
  id: 'crunchbase_get_acquisition',
  name: 'Crunchbase Get Acquisition',
  description:
    'Look up a single Crunchbase acquisition by permalink or UUID, returning the requested fields and related cards.',
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
      description: 'Acquisition permalink or UUID',
    },
    fieldIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Acquisition fields to return, e.g. ["identifier","acquiree_identifier","acquirer_identifier","price"]. Defaults to identifier, acquiree_identifier, acquirer_identifier, announced_on, completed_on, price, acquisition_type, status, terms, short_description, permalink.',
    },
    cardIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Related-entity cards to include, e.g. ["acquiree_organization","acquirer_organization"]. Available: acquiree_organization, acquirer_organization, fields, press_references. A card returns at most 100 items.',
    },
  },

  request: {
    url: (params) => buildEntityUrl('acquisitions', params, DEFAULT_ACQUISITION_FIELD_IDS),
    method: 'GET',
    headers: (params) => crunchbaseHeaders(params.apiKey),
  },

  transformResponse: transformEntityResponse,

  outputs: {
    uuid: { type: 'string', nullable: true, description: 'Crunchbase UUID of the acquisition' },
    name: { type: 'string', nullable: true, description: 'Acquisition name' },
    permalink: {
      type: 'string',
      nullable: true,
      description: 'Crunchbase permalink of the acquisition',
    },
    properties: {
      type: 'json',
      description: 'Requested acquisition fields, keyed by field_id',
    },
    cards: {
      type: 'json',
      nullable: true,
      description: 'Requested related-entity cards, keyed by card_id',
    },
  },
}
