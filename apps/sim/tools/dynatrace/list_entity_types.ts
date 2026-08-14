import { nextPageKeyOutput, pageSizeOutput, totalCountOutput } from '@/tools/dynatrace/outputs'
import type {
  DynatraceListEntityTypesParams,
  DynatraceListEntityTypesResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  mapEntityType,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const listEntityTypesTool: ToolConfig<
  DynatraceListEntityTypesParams,
  DynatraceListEntityTypesResponse
> = {
  id: 'dynatrace_list_entity_types',
  name: 'Dynatrace List Entity Types',
  description:
    'List the monitored entity types available in the environment, with the properties and relationships each supports. Use it to build valid entity selectors.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.DYNATRACE_ERRORS,

  params: {
    environmentUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Dynatrace environment URL (e.g., https://abc12345.live.dynatrace.com, or https://your-activegate:9999/e/abc12345 for Managed)',
    },
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dynatrace access token (dt0c01...) with the entities.read scope',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Entity types per page (max 500, default 50)',
    },
    nextPageKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for the next page. Page size is ignored when it is set',
    },
  },

  request: {
    url: (params) =>
      buildDynatraceUrl(
        params.environmentUrl,
        '/entityTypes',
        params.nextPageKey ? { nextPageKey: params.nextPageKey } : { pageSize: params.pageSize }
      ),
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)
    const types = Array.isArray(data.types) ? (data.types as Array<Record<string, unknown>>) : []

    return {
      success: true,
      output: {
        types: types.map(mapEntityType),
        totalCount: (data.totalCount as number) ?? null,
        pageSize: (data.pageSize as number) ?? null,
        nextPageKey: (data.nextPageKey as string) ?? null,
      },
    }
  },

  outputs: {
    types: {
      type: 'array',
      description: 'Available entity types',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Entity type (e.g., HOST, SERVICE)' },
          displayName: { type: 'string', description: 'Display name of the type', nullable: true },
          dimensionKey: {
            type: 'string',
            description: 'Metric dimension key of the type',
            nullable: true,
          },
          entityLimitExceeded: {
            type: 'boolean',
            description: 'Whether the environment exceeded the entity limit for this type',
            nullable: true,
          },
          properties: {
            type: 'array',
            description: 'Properties available on the type',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Property ID' },
                displayName: { type: 'string', description: 'Property display name' },
                type: { type: 'string', description: 'Property value type' },
              },
            },
          },
          fromRelationships: {
            type: 'array',
            description: 'Relationships originating at this type',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Relationship ID' },
                toTypes: {
                  type: 'array',
                  description: 'Entity types the relationship points to',
                  items: { type: 'string' },
                },
              },
            },
          },
          toRelationships: {
            type: 'array',
            description: 'Relationships pointing at this type',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Relationship ID' },
                fromTypes: {
                  type: 'array',
                  description: 'Entity types the relationship originates from',
                  items: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    totalCount: totalCountOutput,
    pageSize: pageSizeOutput,
    nextPageKey: nextPageKeyOutput,
  },
}
