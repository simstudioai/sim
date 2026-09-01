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

export const windchillCheckOutDocumentsTool: InternalToolConfig<
  WindchillParams,
  WindchillResponse
> = {
  id: 'windchill_check_out_documents',
  name: 'Windchill Check Out Documents',
  description: 'Check out multiple documents atomically',
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
    checkOutNote: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Checkout note',
    },
  },
  operation: {
    input: (params) => buildWindchillInternalBody('windchill_check_out_documents', params),
  },
  transformResponse: (response) =>
    transformWindchillInternalResponse('windchill_check_out_documents', response),
  outputs: WINDCHILL_BULK_MUTATION_OUTPUTS,
}
