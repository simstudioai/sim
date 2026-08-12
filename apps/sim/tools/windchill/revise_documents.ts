import type { ToolConfig } from '@/tools/types'
import {
  WINDCHILL_BULK_MUTATION_OUTPUTS,
  type WindchillParams,
  type WindchillResponse,
} from '@/tools/windchill/types'
import {
  buildWindchillInternalBody,
  transformWindchillInternalResponse,
} from '@/tools/windchill/utils'

export const windchillReviseDocumentsTool: ToolConfig<WindchillParams, WindchillResponse> = {
  id: 'windchill_revise_documents',
  name: 'Windchill Revise Documents',
  description: 'Create new revisions of multiple documents atomically',
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
  request: {
    url: '/api/tools/windchill',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => buildWindchillInternalBody('windchill_revise_documents', params),
    internalAuth: 'executor_delegation',
  },
  transformResponse: (response) =>
    transformWindchillInternalResponse('windchill_revise_documents', response),
  outputs: WINDCHILL_BULK_MUTATION_OUTPUTS,
}
