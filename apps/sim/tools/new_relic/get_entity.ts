import type { NewRelicGetEntityParams, NewRelicGetEntityResponse } from '@/tools/new_relic/types'
import {
  getNerdGraphEndpoint,
  gqlString,
  newRelicHeaders,
  parseNerdGraphResponse,
} from '@/tools/new_relic/utils'
import type { ToolConfig } from '@/tools/types'

interface GetEntityData {
  actor?: {
    entity?: {
      name?: string | null
      entityType?: string | null
    } | null
  } | null
}

export const newRelicGetEntityTool: ToolConfig<NewRelicGetEntityParams, NewRelicGetEntityResponse> =
  {
    id: 'new_relic_get_entity',
    name: 'New Relic Get Entity',
    description: 'Fetch a New Relic entity by GUID.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'New Relic user API key for NerdGraph',
      },
      region: {
        type: 'string',
        required: false,
        visibility: 'user-only',
        description: 'New Relic data center region: us or eu',
      },
      guid: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Entity GUID',
      },
    },

    request: {
      url: (params) => getNerdGraphEndpoint(params.region),
      method: 'POST',
      headers: (params) => newRelicHeaders(params.apiKey),
      body: (params) => ({
        query: `{
  actor {
    entity(guid: ${gqlString(params.guid.trim())}) {
      name
      entityType
    }
  }
}`,
      }),
    },

    transformResponse: async (response, params) => {
      const payload = await parseNerdGraphResponse<GetEntityData>(response)
      const entity = payload.data?.actor?.entity

      return {
        success: true,
        output: {
          entity: entity
            ? {
                guid: params?.guid ?? null,
                name: entity.name ?? null,
                entityType: entity.entityType ?? null,
              }
            : null,
        },
      }
    },

    outputs: {
      entity: {
        type: 'object',
        description: 'New Relic entity details',
        optional: true,
        properties: {
          guid: { type: 'string', description: 'Entity GUID', nullable: true },
          name: { type: 'string', description: 'Entity name', nullable: true },
          entityType: { type: 'string', description: 'Entity type', nullable: true },
        },
      },
    },
  }
