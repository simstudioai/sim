import { tagProperties } from '@/tools/dynatrace/outputs'
import type { DynatraceAddTagsParams, DynatraceAddTagsResponse } from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  mapTags,
  parseJsonParam,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const addTagsTool: ToolConfig<DynatraceAddTagsParams, DynatraceAddTagsResponse> = {
  id: 'dynatrace_add_tags',
  name: 'Dynatrace Add Tags',
  description:
    'Add custom tags to every monitored entity an entity selector matches. Tags drive selectors, management zones, and alerting.',
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
      description: 'Entity selector for the entities to tag, e.g. type("HOST"),tag("env:staging")',
    },
    tags: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Tags to add, as an array of objects with a key and an optional value (e.g. [{"key":"owner","value":"platform"},{"key":"reviewed"}])',
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
    method: 'POST',
    headers: (params) => dynatraceHeaders(params.apiToken),
    body: (params) => {
      const tags = parseJsonParam(params.tags)
      if (!Array.isArray(tags) || tags.length === 0) {
        throw new Error('tags must be a non-empty array of objects with a key')
      }
      return { tags }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)

    return {
      success: true,
      output: {
        appliedTags: mapTags(data.appliedTags),
        matchedEntitiesCount: (data.matchedEntitiesCount as number) ?? null,
      },
    }
  },

  outputs: {
    appliedTags: {
      type: 'array',
      description: 'Tags that were applied',
      items: { type: 'object', properties: tagProperties },
    },
    matchedEntitiesCount: {
      type: 'number',
      description: 'How many entities the selector matched and were tagged',
      nullable: true,
    },
  },
}
