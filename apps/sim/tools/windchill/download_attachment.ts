import type { InternalToolConfig } from '@/tools/types'
import {
  WINDCHILL_FILE_OUTPUTS,
  type WindchillParams,
  type WindchillResponse,
} from '@/tools/windchill/types'
import {
  buildWindchillInternalBody,
  transformWindchillInternalResponse,
} from '@/tools/windchill/utils'

export const windchillDownloadAttachmentTool: InternalToolConfig<
  WindchillParams,
  WindchillResponse
> = {
  id: 'windchill_download_attachment',
  name: 'Windchill Download Attachment',
  description: 'Download a document attachment into a canonical UserFile',
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
    attachmentOid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Windchill attachment content OID',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional downloaded file name override',
    },
  },
  operation: {
    input: (params) => buildWindchillInternalBody('windchill_download_attachment', params),
  },
  transformResponse: (response) =>
    transformWindchillInternalResponse('windchill_download_attachment', response),
  outputs: WINDCHILL_FILE_OUTPUTS,
}
