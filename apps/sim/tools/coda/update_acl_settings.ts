import type { CodaAclSettingsParams, CodaAclSettingsResponse } from '@/tools/coda/types'
import {
  ACL_SETTINGS_OUTPUTS,
  buildCodaUrl,
  CODA_FIELD_UPDATE_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

const SETTING_KEYS = [
  'allowEditorsToChangePermissions',
  'allowCopying',
  'allowViewersToRequestEditing',
] as const

export const codaUpdateAclSettingsTool: ToolConfig<CodaAclSettingsParams, CodaAclSettingsResponse> =
  {
    id: 'coda_update_acl_settings',
    name: 'Coda Update Sharing Settings',
    description:
      'Update who can change permissions, copy, or request edit access on a Coda doc; unset settings are left unchanged',
    version: '1.0.0',
    oauth: codaOAuth,
    errorExtractor: ErrorExtractorId.CODA_ERRORS,

    params: {
      ...codaAuthParams,
      docId: DOC_ID_PARAM,
      allowEditorsToChangePermissions: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Allow editors to change doc permissions',
      },
      allowCopying: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Allow viewers to copy the doc',
      },
      allowViewersToRequestEditing: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Allow viewers to request edit access',
      },
    },

    request: {
      url: (params) => buildCodaUrl(codaDocPath(params.docId, 'acl', 'settings')),
      method: 'PATCH',
      retry: CODA_FIELD_UPDATE_RETRY,
      headers: (params) => codaHeaders(params.accessToken, true),
      body: (params) => {
        const body: Record<string, boolean> = {}
        for (const key of SETTING_KEYS) {
          if (typeof params[key] === 'boolean') body[key] = params[key]
        }
        if (Object.keys(body).length === 0) {
          throw new Error('Provide at least one sharing setting to update')
        }
        return body
      },
    },

    transformResponse: async (response) => {
      const data = (await response.json()) as CodaAclSettingsResponse['output']
      return {
        success: true,
        output: {
          allowEditorsToChangePermissions: data.allowEditorsToChangePermissions,
          allowCopying: data.allowCopying,
          allowViewersToRequestEditing: data.allowViewersToRequestEditing,
        },
      }
    },

    outputs: ACL_SETTINGS_OUTPUTS,
  }
