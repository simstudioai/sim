import { settingsSchemaProperties, totalCountOutput } from '@/tools/dynatrace/outputs'
import type {
  DynatraceListSettingsSchemasParams,
  DynatraceListSettingsSchemasResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  mapSettingsSchema,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const listSettingsSchemasTool: ToolConfig<
  DynatraceListSettingsSchemasParams,
  DynatraceListSettingsSchemasResponse
> = {
  id: 'dynatrace_list_settings_schemas',
  name: 'Dynatrace List Settings Schemas',
  description:
    'List the settings schemas available in the environment. Use it to find the schema ID for a configuration type such as builtin:alerting.profile.',
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
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated fields to include: schemaId, displayName, maturity, latestSchemaVersion, multiObject, ordered, ownerBasedAccessControl',
    },
  },

  request: {
    url: (params) =>
      buildDynatraceUrl(params.environmentUrl, '/settings/schemas', { fields: params.fields }),
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)
    const items = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : []

    return {
      success: true,
      output: {
        schemas: items.map(mapSettingsSchema),
        totalCount: (data.totalCount as number) ?? null,
      },
    }
  },

  outputs: {
    schemas: {
      type: 'array',
      description: 'Available settings schemas',
      items: { type: 'object', properties: settingsSchemaProperties },
    },
    totalCount: totalCountOutput,
  },
}
