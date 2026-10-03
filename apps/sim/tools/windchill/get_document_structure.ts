import type { ToolConfig } from '@/tools/types'
import {
  WINDCHILL_STRUCTURE_OUTPUTS,
  type WindchillParams,
  type WindchillResponse,
} from '@/tools/windchill/types'
import {
  buildWindchillReadUrl,
  transformWindchillDirectRead,
  windchillReadHeaders,
} from '@/tools/windchill/utils'

export const windchillGetDocumentStructureTool: ToolConfig<WindchillParams, WindchillResponse> = {
  id: 'windchill_get_document_structure',
  name: 'Windchill Get Document Structure',
  description: 'Retrieve recursive document usage links and their parent and child documents',
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
    structureDepth: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Document structure expansion depth, from 1 to 3',
    },
    nextLink: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Verified @odata.nextLink from a previous structure response',
    },
  },
  request: {
    url: (params) => buildWindchillReadUrl('windchill_get_document_structure', params),
    method: 'GET',
    headers: windchillReadHeaders,
    stripAuthOnRedirect: true,
    retry: { enabled: true, maxRetries: 2, retryIdempotentOnly: true },
  },
  transformResponse: (response) =>
    transformWindchillDirectRead('windchill_get_document_structure', response),
  outputs: WINDCHILL_STRUCTURE_OUTPUTS,
}
