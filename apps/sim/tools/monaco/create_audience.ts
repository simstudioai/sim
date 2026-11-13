import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import { MONACO_ACCESS_TOKEN_PARAM } from '@/tools/monaco/params'
import {
  MONACO_AUDIENCE_OUTPUT_PROPERTIES,
  type MonacoAudienceResponse,
  type MonacoCreateAudienceParams,
} from '@/tools/monaco/types'
import {
  MONACO_API_BASE,
  mapMonacoAudience,
  monacoHeaders,
  parseMonacoFilters,
  parseMonacoOptionalIdList,
} from '@/tools/monaco/utils'
import type { ToolConfig } from '@/tools/types'

export const monacoCreateAudienceTool: ToolConfig<
  MonacoCreateAudienceParams,
  MonacoAudienceResponse
> = {
  id: 'monaco_create_audience',
  name: 'Monaco Create Audience',
  description:
    'Create a Monaco audience, optionally seeded with contacts: either an explicit list of contact IDs, or a filters query over the contact field schemas (optionally narrowed by excluded IDs or a source audience). Audiences can be shared across campaigns.',
  version: '1.0.0',
  oauth: { required: true, provider: 'monaco', credentialKind: 'service-account' },
  errorExtractor: ErrorExtractorId.NESTED_ERROR_OBJECT,

  params: {
    ...MONACO_ACCESS_TOKEN_PARAM,
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the audience to create',
    },
    contactIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Contact IDs to add to the audience on creation (up to 10,000), as an array or comma-separated list. Provide either contactIds or filters, not both.',
      items: { type: 'string' },
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Selects the contacts to seed the audience with by query instead of listing every ID: an array of {"field", "condition", "value"} rules (ANDed), or an {"operator": "and"|"or", "filters": [...]} expression. Valid fields, conditions, and values come from the contacts field schemas; a rule on "account_id" selects that account\'s contacts. At most 10,000 matching contacts (before exclusions). Provide either filters or contactIds, not both. An empty list is rejected because Monaco would match every contact.',
    },
    excludedIds: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Contact IDs to exclude from the filtered set (up to 10,000). Only valid together with filters.',
      items: { type: 'string' },
    },
    sourceAudienceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Restricts the contacts selected by filters to current members of this audience. Only valid together with filters.',
    },
  },

  request: {
    url: `${MONACO_API_BASE}/v1/audiences`,
    method: 'POST',
    headers: (params) => monacoHeaders(params.accessToken),
    body: (params) => {
      const name = params.name.trim()
      if (!name) throw new Error('name is required')
      const contactIds = parseMonacoOptionalIdList(params.contactIds, 'contactIds')
      const filters = parseMonacoFilters(params.filters)
      const excludedIds = parseMonacoOptionalIdList(params.excludedIds, 'excludedIds')
      const sourceAudienceId = params.sourceAudienceId?.trim()

      if (Array.isArray(filters) && filters.length === 0) {
        throw new Error(
          'filters must contain at least one rule; an empty list matches every contact'
        )
      }
      if (contactIds && filters) {
        throw new Error('Provide either contactIds or filters, not both')
      }
      if ((excludedIds || sourceAudienceId) && !filters) {
        throw new Error('excludedIds and sourceAudienceId can only be used with filters')
      }

      const body: Record<string, unknown> = { name }
      if (contactIds) body.contact_ids = contactIds
      if (filters) body.filters = filters
      if (excludedIds) body.excluded_ids = excludedIds
      if (sourceAudienceId) body.source_audience_id = sourceAudienceId
      return body
    },
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return { success: true, output: { audience: mapMonacoAudience(data.data) } }
  },

  outputs: {
    audience: {
      type: 'object',
      description: 'The created audience',
      properties: MONACO_AUDIENCE_OUTPUT_PROPERTIES,
    },
  },
}
