import {
  nextPageKeyOutput,
  pageSizeOutput,
  settingsObjectProperties,
  totalCountOutput,
} from '@/tools/dynatrace/outputs'
import type {
  DynatraceListSettingsObjectsParams,
  DynatraceListSettingsObjectsResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  mapSettingsObject,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const listSettingsObjectsTool: ToolConfig<
  DynatraceListSettingsObjectsParams,
  DynatraceListSettingsObjectsResponse
> = {
  id: 'dynatrace_list_settings_objects',
  name: 'Dynatrace List Settings Objects',
  description:
    'List settings objects — the configuration behind maintenance windows, alerting profiles, management zones, and anomaly detection.',
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
      description: 'Dynatrace access token (dt0c01...) with the settings.read scope',
    },
    schemaIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated schema IDs, e.g. builtin:alerting.profile',
    },
    scopes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated scopes, e.g. environment or HOST-06F288EE2A930951',
    },
    externalIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated external IDs',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated fields to include: objectId, value, schemaId, schemaVersion, scope, author, modified, updateToken, created, externalId, summary, searchSummary',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter expression over created, modified, createdBy, modifiedBy, or value',
    },
    sort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort expression, e.g. -modified',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Objects per page (max 500, default 100)',
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
        ? buildDynatraceUrl(params.environmentUrl, '/settings/objects', {
            nextPageKey: params.nextPageKey,
          })
        : buildDynatraceUrl(params.environmentUrl, '/settings/objects', {
            schemaIds: params.schemaIds,
            scopes: params.scopes,
            externalIds: params.externalIds,
            fields: params.fields,
            filter: params.filter,
            sort: params.sort,
            pageSize: params.pageSize,
          }),
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)
    const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : []

    return {
      success: true,
      output: {
        items: items.map(mapSettingsObject),
        totalCount: (data.totalCount as number) ?? null,
        pageSize: (data.pageSize as number) ?? null,
        nextPageKey: (data.nextPageKey as string) ?? null,
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Matching settings objects',
      items: { type: 'object', properties: settingsObjectProperties },
    },
    totalCount: totalCountOutput,
    pageSize: pageSizeOutput,
    nextPageKey: nextPageKeyOutput,
  },
}
