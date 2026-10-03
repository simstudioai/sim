import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookResponse, PitchbookSandboxEntitiesParams } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * PitchBook returns the sandbox list under a key named after the requested
 * entity type (`companies` for COMPANIES, and so on for the other six types).
 * Only the COMPANIES shape is recorded in the published docs, so rather than
 * guessing the other six key names this picks whichever array the payload
 * carries alongside the `entityTypeCounts` summary.
 */
function pickEntityList(data: Record<string, unknown>): unknown[] {
  for (const [key, value] of Object.entries(data)) {
    if (key !== 'entityTypeCounts' && Array.isArray(value)) return value
  }
  return []
}

export const pitchbookSandboxEntitiesTool: ToolConfig<
  PitchbookSandboxEntitiesParams,
  PitchbookResponse
> = {
  id: 'pitchbook_sandbox_entities',
  name: 'PitchBook Sandbox Entities',
  description:
    'List the entities a sandbox API key is allowed to query, so test workflows have real IDs to run against',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PitchBook API key',
    },
    entityType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Entity type to list: COMPANIES, INVESTORS, LIMITED_PARTNERS, SERVICE_PROVIDERS, PEOPLE, DEALS, or FUNDS. The matching array on the response is named after it, so COMPANIES returns a companies array.',
    },
    currency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ISO currency code to convert monetary values into, sent as the X-Currency header (e.g. USD, EUR, JPY). Defaults to the currency on the account preferences.',
    },
  },

  request: {
    url: (params) => {
      const qs = new URLSearchParams()
      qs.set('entityType', params.entityType.trim())
      const query = qs.toString()
      return `${PITCHBOOK_API_BASE}/sandbox-entities${query ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch sandbox entities')
    const data = await response.json()

    return {
      success: true,
      output: {
        entityTypeCounts: data.entityTypeCounts ?? null,
        entities: pickEntityList(data),
      },
    }
  },

  outputs: {
    entities: {
      type: 'array',
      description:
        'Entities the sandbox key may query. PitchBook names this array after the requested entity type, so it is surfaced under a stable `entities` key rather than the type-specific one.',
      items: {
        type: 'object',
        properties: {
          companyId: {
            type: 'string',
            description: 'PitchBook ID of the entity, keyed by its own entity type',
            optional: true,
          },
          companyName: {
            type: 'string',
            description: 'Name of the entity, keyed by its own entity type',
            optional: true,
          },
        },
      },
    },
    entityTypeCounts: {
      type: 'json',
      description: 'Count of available sandbox entities, keyed by entity type',
      nullable: true,
    },
  },
}
