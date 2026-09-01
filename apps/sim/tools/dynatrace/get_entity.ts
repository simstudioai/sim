import { entityProperties } from '@/tools/dynatrace/outputs'
import type { DynatraceGetEntityParams, DynatraceGetEntityResponse } from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  encodeDynatraceId,
  mapEntity,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const getEntityTool: ToolConfig<DynatraceGetEntityParams, DynatraceGetEntityResponse> = {
  id: 'dynatrace_get_entity',
  name: 'Dynatrace Get Entity',
  description:
    'Get the properties, tags, management zones, and relationships of a single monitored entity.',
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
    entityId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the entity (e.g., HOST-06F288EE2A930951)',
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
        'Comma-separated additional entity properties to include (e.g. +lastSeenTms,+properties.BITNESS)',
    },
  },

  request: {
    url: (params) =>
      buildDynatraceUrl(params.environmentUrl, `/entities/${encodeDynatraceId(params.entityId)}`, {
        from: params.from,
        to: params.to,
        fields: params.fields,
      }),
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)

    return {
      success: true,
      output: {
        entity: mapEntity(data),
      },
    }
  },

  outputs: {
    entity: {
      type: 'object',
      description: 'The requested monitored entity',
      properties: entityProperties,
    },
  },
}
