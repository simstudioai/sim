import { tagProperties, totalCountOutput } from '@/tools/dynatrace/outputs'
import type { DynatraceListTagsParams, DynatraceListTagsResponse } from '@/tools/dynatrace/types'
import { buildDynatraceUrl, dynatraceHeaders, mapTags, readJsonBody } from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const listTagsTool: ToolConfig<DynatraceListTagsParams, DynatraceListTagsResponse> = {
  id: 'dynatrace_list_tags',
  name: 'Dynatrace List Tags',
  description: 'List the custom tags applied to the monitored entities an entity selector matches.',
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
      description: 'Entity selector for the entities to read tags from, e.g. type("HOST")',
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
        from: params.from,
        to: params.to,
      }),
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)

    return {
      success: true,
      output: {
        tags: mapTags(data.tags),
        totalCount: (data.totalCount as number) ?? null,
      },
    }
  },

  outputs: {
    tags: {
      type: 'array',
      description: 'Custom tags on the matched entities',
      items: { type: 'object', properties: tagProperties },
    },
    totalCount: totalCountOutput,
  },
}
