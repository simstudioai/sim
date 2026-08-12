import type { ToolConfig } from '@/tools/types'
import {
  WINDCHILL_UPLOAD_OUTPUTS,
  type WindchillParams,
  type WindchillResponse,
} from '@/tools/windchill/types'
import {
  buildWindchillInternalBody,
  transformWindchillInternalResponse,
} from '@/tools/windchill/utils'

export const windchillUploadPrimaryContentTool: ToolConfig<WindchillParams, WindchillResponse> = {
  id: 'windchill_upload_primary_content',
  name: 'Windchill Upload Primary Content',
  description: 'Upload a primary-content file to a document that has none',
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
    primaryFile: {
      type: 'file',
      required: true,
      visibility: 'user-only',
      description: 'Primary content file to upload',
    },
  },
  request: {
    url: '/api/tools/windchill',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => buildWindchillInternalBody('windchill_upload_primary_content', params),
    internalAuth: 'executor_delegation',
  },
  transformResponse: (response) =>
    transformWindchillInternalResponse('windchill_upload_primary_content', response),
  outputs: WINDCHILL_UPLOAD_OUTPUTS,
}
