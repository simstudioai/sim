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

export const windchillUpdateDocumentsTool: ToolConfig<WindchillParams, WindchillResponse> = {
  id: 'windchill_update_documents',
  name: 'Windchill Update Documents',
  description: "Update several documents' editable attributes in one atomic request",
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
      description:
        'Document updates as a JSON array; each item requires id and the editable attributes to set. Name, Number, and Organization are not supported.',
    },
  },
  request: {
    url: '/api/tools/windchill',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => buildWindchillInternalBody('windchill_update_documents', params),
    internalAuth: 'executor_delegation',
  },
  transformResponse: (response) =>
    transformWindchillInternalResponse('windchill_update_documents', response),
  outputs: WINDCHILL_BULK_MUTATION_OUTPUTS,
}
