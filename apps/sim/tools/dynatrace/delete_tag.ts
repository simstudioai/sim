import type { DynatraceDeleteTagParams, DynatraceDeleteTagResponse } from '@/tools/dynatrace/types'
import { buildDynatraceUrl, dynatraceHeaders, readJsonBody } from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const deleteTagTool: ToolConfig<DynatraceDeleteTagParams, DynatraceDeleteTagResponse> = {
  id: 'dynatrace_delete_tag',
  name: 'Dynatrace Delete Tag',
  description:
    'Remove a custom tag from every monitored entity an entity selector matches. Deletes one key-value pair, or every tag with the key.',
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
      description: 'Dynatrace access token (dt0c01...) with the entities.write scope',
    },
    entitySelector: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Entity selector for the entities to untag, e.g. type("HOST"),tag("owner:old")',
    },
    key: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Key of the tag to delete',
    },
    value: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Value of the tag to delete. Omit it and set Delete All With Key to remove every value of the key',
    },
    deleteAllWithKey: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Delete every tag carrying the key, regardless of value',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Start of the timeframe as UTC milliseconds, ISO 8601, or a relative expression. Defaults to now-24h',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End of the timeframe in the same formats as From. Defaults to now',
    },
  },

  request: {
    url: (params) =>
      buildDynatraceUrl(params.environmentUrl, '/tags', {
        entitySelector: params.entitySelector,
        key: params.key,
        value: params.value,
        deleteAllWithKey: params.deleteAllWithKey,
        from: params.from,
        to: params.to,
      }),
    method: 'DELETE',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)

    return {
      success: true,
      output: {
        matchedEntitiesCount: (data.matchedEntitiesCount as number) ?? null,
      },
    }
  },

  outputs: {
    matchedEntitiesCount: {
      type: 'number',
      description: 'How many entities the selector matched and had the tag removed from',
      nullable: true,
    },
  },
}
