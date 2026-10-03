import type { InternalToolConfig } from '@/tools/types'
import {
  WINDCHILL_AFFECTED_OUTPUTS,
  type WindchillParams,
  type WindchillResponse,
} from '@/tools/windchill/types'
import {
  buildWindchillInternalBody,
  transformWindchillInternalResponse,
} from '@/tools/windchill/utils'

export const windchillDeleteDocumentsTool: InternalToolConfig<WindchillParams, WindchillResponse> =
  {
    id: 'windchill_delete_documents',
    name: 'Windchill Delete Documents',
    description: 'Delete multiple documents atomically',
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
      documentOids: {
        type: 'array',
        required: true,
        visibility: 'user-or-llm',
        description: 'WT.Document OIDs to process atomically',
      },
    },
    operation: {
      input: (params) => buildWindchillInternalBody('windchill_delete_documents', params),
    },
    transformResponse: (response) =>
      transformWindchillInternalResponse('windchill_delete_documents', response),
    outputs: WINDCHILL_AFFECTED_OUTPUTS,
  }
