import type { InternalToolConfig } from '@/tools/types'
import {
  WINDCHILL_BULK_MUTATION_OUTPUTS,
  type WindchillParams,
  type WindchillResponse,
} from '@/tools/windchill/types'
import {
  buildWindchillInternalBody,
  transformWindchillInternalResponse,
} from '@/tools/windchill/utils'

export const windchillCreateDocumentsTool: InternalToolConfig<WindchillParams, WindchillResponse> =
  {
    id: 'windchill_create_documents',
    name: 'Windchill Create Documents',
    description: 'Create several documents in one atomic Windchill request',
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
      documents: {
        type: 'array',
        required: true,
        visibility: 'user-or-llm',
        description: 'Document inputs as a JSON array; each item requires name and containerOid',
      },
    },
    operation: {
      input: (params) => buildWindchillInternalBody('windchill_create_documents', params),
    },
    transformResponse: (response) =>
      transformWindchillInternalResponse('windchill_create_documents', response),
    outputs: WINDCHILL_BULK_MUTATION_OUTPUTS,
  }
