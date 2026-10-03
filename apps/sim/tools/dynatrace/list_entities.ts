import {
  entityProperties,
  nextPageKeyOutput,
  pageSizeOutput,
  totalCountOutput,
} from '@/tools/dynatrace/outputs'
import type {
  DynatraceListEntitiesParams,
  DynatraceListEntitiesResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  mapEntity,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const listEntitiesTool: ToolConfig<
  DynatraceListEntitiesParams,
  DynatraceListEntitiesResponse
> = {
  id: 'dynatrace_list_entities',
  name: 'Dynatrace List Entities',
  description:
    'List monitored entities — hosts, services, applications, Kubernetes workloads — matching an entity selector.',
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
    entitySelector: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Entity selector defining the scope, e.g. type("HOST"),tag("env:prod") or entityId("HOST-06F288EE2A930951")',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Start of the timeframe as UTC milliseconds, ISO 8601, or a relative expression such as now-3d. Defaults to now-3d',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End of the timeframe in the same formats as From. Defaults to now',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated additional entity properties to include (e.g. +lastSeenTms,+properties.BITNESS,+tags)',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort by display name: +displayName ascending or -displayName descending',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Entities per page (default 50)',
    },
    nextPageKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for the next page. All other filters are ignored when it is set',
    },
  },

  request: {
    url: (params) =>
      params.nextPageKey
        ? buildDynatraceUrl(params.environmentUrl, '/entities', {
            nextPageKey: params.nextPageKey,
          })
        : buildDynatraceUrl(params.environmentUrl, '/entities', {
            entitySelector: params.entitySelector,
            from: params.from,
            to: params.to,
            fields: params.fields,
            sort: params.sort,
            pageSize: params.pageSize,
          }),
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)
    const entities = Array.isArray(data.entities)
      ? (data.entities as Array<Record<string, unknown>>)
      : []

    return {
      success: true,
      output: {
        entities: entities.map(mapEntity),
        totalCount: (data.totalCount as number) ?? null,
        pageSize: (data.pageSize as number) ?? null,
        nextPageKey: (data.nextPageKey as string) ?? null,
      },
    }
  },

  outputs: {
    entities: {
      type: 'array',
      description: 'Matching monitored entities',
      items: { type: 'object', properties: entityProperties },
    },
    totalCount: totalCountOutput,
    pageSize: pageSizeOutput,
    nextPageKey: nextPageKeyOutput,
  },
}
