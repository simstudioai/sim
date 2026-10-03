import type { CodaAclSettingsResponse, CodaDocParams } from '@/tools/coda/types'
import {
  ACL_SETTINGS_OUTPUTS,
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaGetAclSettingsTool: ToolConfig<CodaDocParams, CodaAclSettingsResponse> = {
  id: 'coda_get_acl_settings',
  name: 'Coda Get Sharing Settings',
  description: 'Get the sharing settings of a Coda doc',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: { ...codaAuthParams, docId: DOC_ID_PARAM },

  request: {
    url: (params) => buildCodaUrl(codaDocPath(params.docId, 'acl', 'settings')),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
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
