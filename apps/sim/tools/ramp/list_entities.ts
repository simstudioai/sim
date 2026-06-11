import type { RampListEntitiesParams, RampListEntitiesResponse } from '@/tools/ramp/types'
import {
  buildRampHeaders,
  buildRampUrl,
  extractNextStart,
  extractRampError,
} from '@/tools/ramp/utils'
import type { ToolConfig } from '@/tools/types'

export const rampListEntitiesTool: ToolConfig<RampListEntitiesParams, RampListEntitiesResponse> = {
  id: 'ramp_list_entities',
  name: 'Ramp List Entities',
  description: 'List business entities in Ramp with optional filters',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'ramp',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for the Ramp API',
    },
    entityName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter entities by name',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (between 2 and 100, default 20)',
    },
    start: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor: the ID of the last entity from the previous page',
    },
  },

  request: {
    url: (params) =>
      buildRampUrl('/entities', {
        entity_name: params.entityName,
        page_size: params.pageSize,
        start: params.start,
      }),
    method: 'GET',
    headers: (params) => buildRampHeaders(params),
  },

  transformResponse: async (response): Promise<RampListEntitiesResponse> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: extractRampError(data, 'Failed to list Ramp entities'),
        output: {},
      }
    }

    return {
      success: true,
      output: {
        entities: data.data ?? [],
        nextStart: extractNextStart(data.page?.next),
      },
    }
  },

  outputs: {
    entities: {
      type: 'array',
      description: 'List of business entities in Ramp',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique identifier for the entity' },
          entity_name: { type: 'string', description: 'Name of the entity' },
          currency: { type: 'string', description: 'Primary currency of the entity' },
          is_primary: {
            type: 'boolean',
            description: 'Whether this is the primary entity of the business',
          },
        },
      },
    },
    nextStart: {
      type: 'string',
      description: 'Cursor for the next page of results (null when there are no more pages)',
      optional: true,
    },
  },
}
