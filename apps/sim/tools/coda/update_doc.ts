import type { CodaDocIdResponse, CodaUpdateDocParams } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_FIELD_UPDATE_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  optionalTrimmed,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaUpdateDocTool: ToolConfig<CodaUpdateDocParams, CodaDocIdResponse> = {
  id: 'coda_update_doc',
  name: 'Coda Update Doc',
  description:
    'Rename a Coda doc or change its icon. Renaming requires Doc Maker access in the workspace.',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New title of the doc',
    },
    iconName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name of the icon to use (e.g., "rocket")',
    },
  },

  request: {
    url: (params) => buildCodaUrl(codaDocPath(params.docId)),
    method: 'PATCH',
    retry: CODA_FIELD_UPDATE_RETRY,
    headers: (params) => codaHeaders(params.accessToken, true),
    body: (params) => {
      const title = optionalTrimmed(params.title)
      const iconName = optionalTrimmed(params.iconName)
      if (!title && !iconName) throw new Error('Provide a title or iconName to update')
      return { ...(title ? { title } : {}), ...(iconName ? { iconName } : {}) }
    },
  },

  transformResponse: async (_response, params) => ({
    success: true,
    output: { docId: String(params?.docId ?? '').trim() },
  }),

  outputs: {
    docId: { type: 'string', description: 'ID of the updated doc' },
  },
}
