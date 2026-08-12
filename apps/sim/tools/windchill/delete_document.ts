import type { ToolConfig } from '@/tools/types'
import {
  WINDCHILL_AFFECTED_OUTPUTS,
  type WindchillParams,
  type WindchillResponse,
} from '@/tools/windchill/types'
import {
  buildWindchillInternalBody,
  transformWindchillInternalResponse,
} from '@/tools/windchill/utils'

export const windchillDeleteDocumentTool: ToolConfig<WindchillParams, WindchillResponse> = {
  id: 'windchill_delete_document',
  name: 'Windchill Delete Document',
  description: 'Delete one document',
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
  },
  request: {
    url: '/api/tools/windchill',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => buildWindchillInternalBody('windchill_delete_document', params),
    internalAuth: 'executor_delegation',
  },
  transformResponse: (response) =>
    transformWindchillInternalResponse('windchill_delete_document', response),
  outputs: WINDCHILL_AFFECTED_OUTPUTS,
}
