import type { InternalToolConfig } from '@/tools/types'
import {
  WINDCHILL_SINGLE_MUTATION_OUTPUTS,
  type WindchillParams,
  type WindchillResponse,
} from '@/tools/windchill/types'
import {
  buildWindchillInternalBody,
  transformWindchillInternalResponse,
} from '@/tools/windchill/utils'

export const windchillCheckInDocumentTool: InternalToolConfig<WindchillParams, WindchillResponse> =
  {
    id: 'windchill_check_in_document',
    name: 'Windchill Check In Document',
    description: 'Check in one document',
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
      checkInNote: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Check-in note',
      },
      keepCheckedOut: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Keep the document checked out after checking it in',
      },
      checkOutNote: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Checkout note',
      },
    },
    operation: {
      input: (params) => buildWindchillInternalBody('windchill_check_in_document', params),
    },
    transformResponse: (response) =>
      transformWindchillInternalResponse('windchill_check_in_document', response),
    outputs: WINDCHILL_SINGLE_MUTATION_OUTPUTS,
  }
