import type {
  DynatraceUpdateSettingsObjectParams,
  DynatraceUpdateSettingsObjectResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  encodeDynatraceId,
  parseJsonParam,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const updateSettingsObjectTool: ToolConfig<
  DynatraceUpdateSettingsObjectParams,
  DynatraceUpdateSettingsObjectResponse
> = {
  id: 'dynatrace_update_settings_object',
  name: 'Dynatrace Update Settings Object',
  description:
    'Update an existing settings object. Pass the update token from Get Settings Object to fail rather than overwrite a concurrent change.',
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
      description: 'ID of the settings object to update',
    },
    value: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The full replacement configuration. Its shape is defined by the object schema — this replaces the value rather than merging into it',
    },
    schemaVersion: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Schema version to validate against',
    },
    updateToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Token from Get Settings Object. When set, the update fails if the object changed in the meantime. Omit it to overwrite unconditionally',
    },
    validateOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Validate the payload without saving anything',
    },
  },

  request: {
    url: (params) =>
      buildDynatraceUrl(
        params.environmentUrl,
        `/settings/objects/${encodeDynatraceId(params.objectId)}`,
        { validateOnly: params.validateOnly }
      ),
    method: 'PUT',
    headers: (params) => dynatraceHeaders(params.apiToken),
    body: (params) => {
      const value = parseJsonParam(params.value)
      if (value === undefined) throw new Error('value is required')
      const body: Record<string, unknown> = { value }
      if (params.schemaVersion) body.schemaVersion = params.schemaVersion
      if (params.updateToken) body.updateToken = params.updateToken
      return body
    },
  },

  transformResponse: async (response: Response, params?: DynatraceUpdateSettingsObjectParams) => {
    const data = await readJsonBody(response)
    const code = (data.code as number) ?? response.status

    // The endpoint answers 207 with a per-object status, so a rejected update
    // would otherwise be reported as a success.
    if (code >= 400) {
      const error = data.error as Record<string, unknown> | undefined
      throw new Error(
        `Dynatrace rejected the settings object: ${(error?.message as string) ?? `HTTP ${code}`}`
      )
    }

    return {
      success: true,
      output: {
        objectId: (data.objectId as string) ?? params?.objectId ?? null,
        code,
      },
    }
  },

  outputs: {
    objectId: { type: 'string', description: 'ID of the updated object', nullable: true },
    code: { type: 'number', description: 'Status Dynatrace reported for the update' },
  },
}
