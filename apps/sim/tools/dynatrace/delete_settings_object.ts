import type {
  DynatraceDeleteSettingsObjectParams,
  DynatraceDeleteSettingsObjectResponse,
} from '@/tools/dynatrace/types'
import { buildDynatraceUrl, dynatraceHeaders, encodeDynatraceId } from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const deleteSettingsObjectTool: ToolConfig<
  DynatraceDeleteSettingsObjectParams,
  DynatraceDeleteSettingsObjectResponse
> = {
  id: 'dynatrace_delete_settings_object',
  name: 'Dynatrace Delete Settings Object',
  description: 'Delete a settings object. Dynatrace cannot undo this.',
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
      description: 'Dynatrace access token (dt0c01...) with the settings.write scope',
    },
    objectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the settings object to delete',
    },
    updateToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Token from Get Settings Object. When set, the delete fails if the object changed in the meantime',
    },
  },

  request: {
    url: (params) =>
      buildDynatraceUrl(
        params.environmentUrl,
        `/settings/objects/${encodeDynatraceId(params.objectId)}`,
        { updateToken: params.updateToken }
      ),
    method: 'DELETE',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  /** The endpoint answers 204 with no body, so the deleted ID is echoed back. */
  transformResponse: async (_response: Response, params?: DynatraceDeleteSettingsObjectParams) => ({
    success: true,
    output: {
      objectId: params?.objectId ?? '',
      deleted: true,
    },
  }),

  outputs: {
    objectId: { type: 'string', description: 'ID of the deleted settings object' },
    deleted: { type: 'boolean', description: 'Always true — a failed delete raises instead' },
  },
}
