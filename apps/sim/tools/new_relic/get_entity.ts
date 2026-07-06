import type { NewRelicGetEntityParams, NewRelicGetEntityResponse } from '@/tools/new_relic/types'
import {
  getNerdGraphEndpoint,
  gqlString,
  type NewRelicRawEntity,
  newRelicHeaders,
  normalizeNewRelicEntity,
  parseNerdGraphResponse,
} from '@/tools/new_relic/utils'
import type { ToolConfig } from '@/tools/types'

interface GetEntityData {
  actor?: {
    entity?: NewRelicRawEntity | null
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
      domain
      reporting
      alertSeverity
      tags {
        key
        values
      }
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
            ? { ...normalizeNewRelicEntity(entity), guid: params?.guid ?? null }
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
          domain: { type: 'string', description: 'Entity domain, e.g. APM, INFRA', nullable: true },
          reporting: {
            type: 'boolean',
            description: 'Whether the entity is currently reporting data',
            nullable: true,
          },
          alertSeverity: {
            type: 'string',
            description: 'Current alert severity for the entity',
            nullable: true,
          },
          tags: {
            type: 'array',
            description: 'Entity tags',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string', description: 'Tag key', nullable: true },
                values: { type: 'array', description: 'Tag values', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  }
