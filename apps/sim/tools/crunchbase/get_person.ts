import type { CrunchbaseEntityParams, CrunchbaseEntityResponse } from '@/tools/crunchbase/types'
import {
  buildEntityUrl,
  crunchbaseHeaders,
  DEFAULT_PERSON_FIELD_IDS,
  transformEntityResponse,
} from '@/tools/crunchbase/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const crunchbaseGetPersonTool: ToolConfig<CrunchbaseEntityParams, CrunchbaseEntityResponse> =
  {
    id: 'crunchbase_get_person',
    name: 'Crunchbase Get Person',
    description:
      'Look up a single Crunchbase person by permalink or UUID, returning the requested fields and related cards.',
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
        description: 'Person permalink (e.g. "elon-musk") or UUID',
      },
      fieldIds: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Person fields to return, e.g. ["identifier","name","primary_job_title","primary_organization"]. Defaults to identifier, name, first_name, last_name, primary_job_title, primary_organization, short_description, location_identifiers, linkedin, rank_person, permalink.',
      },
      cardIds: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Related-entity cards to include, e.g. ["jobs","primary_organization"]. Available on every license tier: degrees, event_appearances, fields, founded_organizations, jobs, primary_job, primary_organization. Advanced Financials adds participated_funding_rounds, participated_funds, participated_investments, partner_funding_rounds, partner_investments, press_references. A card returns at most 100 items.',
      },
    },

    request: {
      url: (params) => buildEntityUrl('people', params, DEFAULT_PERSON_FIELD_IDS),
      method: 'GET',
      headers: (params) => crunchbaseHeaders(params.apiKey),
    },

    transformResponse: transformEntityResponse,

    outputs: {
      uuid: { type: 'string', nullable: true, description: 'Crunchbase UUID of the person' },
      name: { type: 'string', nullable: true, description: 'Full name of the person' },
      permalink: {
        type: 'string',
        nullable: true,
        description: 'Crunchbase permalink of the person',
      },
      properties: {
        type: 'json',
        description: 'Requested person fields, keyed by field_id',
      },
      cards: {
        type: 'json',
        nullable: true,
        description: 'Requested related-entity cards, keyed by card_id',
      },
    },
  }
