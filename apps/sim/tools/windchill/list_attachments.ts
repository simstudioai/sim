import type { ToolConfig } from '@/tools/types'
import {
  WINDCHILL_ATTACHMENTS_OUTPUTS,
  type WindchillParams,
  type WindchillResponse,
} from '@/tools/windchill/types'
import {
  buildWindchillReadUrl,
  transformWindchillDirectRead,
  windchillReadHeaders,
} from '@/tools/windchill/utils'

export const windchillListAttachmentsTool: ToolConfig<WindchillParams, WindchillResponse> = {
  id: 'windchill_list_attachments',
  name: 'Windchill List Attachments',
  description: 'List attachment metadata for a document',
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
    nextLink: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Verified @odata.nextLink from a previous attachment response',
    },
  },
  request: {
    url: (params) => buildWindchillReadUrl('windchill_list_attachments', params),
    method: 'GET',
    headers: windchillReadHeaders,
    stripAuthOnRedirect: true,
    retry: { enabled: true, maxRetries: 2, retryIdempotentOnly: true },
  },
  transformResponse: (response) =>
    transformWindchillDirectRead('windchill_list_attachments', response),
  outputs: WINDCHILL_ATTACHMENTS_OUTPUTS,
}
