import type { CrunchbaseEntityParams, CrunchbaseEntityResponse } from '@/tools/crunchbase/types'
import {
  buildEntityUrl,
  crunchbaseHeaders,
  DEFAULT_ORGANIZATION_FIELD_IDS,
  transformEntityResponse,
} from '@/tools/crunchbase/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const crunchbaseGetOrganizationTool: ToolConfig<
  CrunchbaseEntityParams,
  CrunchbaseEntityResponse
> = {
  id: 'crunchbase_get_organization',
  name: 'Crunchbase Get Organization',
  description:
    'Look up a single Crunchbase organization by permalink or UUID, returning the requested fields and related cards.',
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
      description: 'Organization permalink (e.g. "tesla-motors") or UUID',
    },
    fieldIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Organization fields to return, e.g. ["identifier","name","founded_on","categories"]. Defaults to identifier, name, short_description, website_url, linkedin, location_identifiers, categories, founded_on, num_employees_enum, operating_status, rank_org, permalink.',
    },
    cardIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Related-entity cards to include, e.g. ["founders","headquarters_address"]. Available on every license tier: child_organizations, child_ownerships, event_appearances, fields, founders, headquarters_address, parent_organization, parent_ownership. Richer packages add acquiree_acquisitions, acquirer_acquisitions, investors, ipos, jobs, participated_funding_rounds, participated_funds, participated_investments, press_references, raised_funding_rounds, raised_funds, raised_investments. A card returns at most 100 items.',
    },
  },

  request: {
    url: (params) => buildEntityUrl('organizations', params, DEFAULT_ORGANIZATION_FIELD_IDS),
    method: 'GET',
    headers: (params) => crunchbaseHeaders(params.apiKey),
  },

  transformResponse: transformEntityResponse,

  outputs: {
    uuid: { type: 'string', nullable: true, description: 'Crunchbase UUID of the organization' },
    name: { type: 'string', nullable: true, description: 'Organization name' },
    permalink: {
      type: 'string',
      nullable: true,
      description: 'Crunchbase permalink of the organization',
    },
    properties: {
      type: 'json',
      description: 'Requested organization fields, keyed by field_id',
    },
    cards: {
      type: 'json',
      nullable: true,
      description: 'Requested related-entity cards, keyed by card_id',
    },
  },
}
