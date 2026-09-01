import { settingsObjectProperties } from '@/tools/dynatrace/outputs'
import type {
  DynatraceGetSettingsObjectParams,
  DynatraceGetSettingsObjectResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  encodeDynatraceId,
  mapSettingsObject,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const getSettingsObjectTool: ToolConfig<
  DynatraceGetSettingsObjectParams,
  DynatraceGetSettingsObjectResponse
> = {
  id: 'dynatrace_get_settings_object',
  name: 'Dynatrace Get Settings Object',
  description:
    'Get a single settings object with its value and its update token. Read it before updating so the token can guard against a concurrent change.',
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
    objectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the settings object',
    },
  },

  request: {
    url: (params) =>
      buildDynatraceUrl(
        params.environmentUrl,
        `/settings/objects/${encodeDynatraceId(params.objectId)}`
      ),
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)

    return {
      success: true,
      output: {
        object: mapSettingsObject(data),
      },
    }
  },

  outputs: {
    object: {
      type: 'object',
      description: 'The requested settings object',
      properties: settingsObjectProperties,
    },
  },
}
