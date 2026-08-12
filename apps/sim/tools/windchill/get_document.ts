import type { ToolConfig } from '@/tools/types'
import {
  WINDCHILL_DOCUMENT_OUTPUTS,
  type WindchillParams,
  type WindchillResponse,
} from '@/tools/windchill/types'
import {
  buildWindchillReadUrl,
  transformWindchillDirectRead,
  windchillReadHeaders,
} from '@/tools/windchill/utils'

export const windchillGetDocumentTool: ToolConfig<WindchillParams, WindchillResponse> = {
  id: 'windchill_get_document',
  name: 'Windchill Get Document',
  description: 'Get a WT.Document by OID',
  version: '1.0.0',
  params: {
    baseUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Complete WRS 2.7 versioned service root using Basic authentication, for example https://host/Windchill/servlet/odata/v6',
    },
    username: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Windchill service-account username',
    },
    password: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Windchill service-account password',
    },
    documentOid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'WT.Document OID, for example OR:wt.doc.WTDocument:48796581',
    },
    select: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated normalized document properties to return',
    },
  },
  request: {
    url: (params) => buildWindchillReadUrl('windchill_get_document', params),
    method: 'GET',
    headers: windchillReadHeaders,
    stripAuthOnRedirect: true,
    retry: { enabled: true, maxRetries: 2, retryIdempotentOnly: true },
  },
  transformResponse: (response) => transformWindchillDirectRead('windchill_get_document', response),
  outputs: WINDCHILL_DOCUMENT_OUTPUTS,
}
