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

export const windchillUpdateDocumentSecurityLabelsTool: InternalToolConfig<
  WindchillParams,
  WindchillResponse
> = {
  id: 'windchill_update_document_security_labels',
  name: 'Windchill Update Document Security Labels',
  description: 'Update installed security-label attributes for one or more documents',
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
    securityLabelUpdates: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of document IDs and installed security-label values',
    },
  },
  operation: {
    input: (params) =>
      buildWindchillInternalBody('windchill_update_document_security_labels', params),
  },
  transformResponse: (response) =>
    transformWindchillInternalResponse('windchill_update_document_security_labels', response),
  outputs: WINDCHILL_BULK_MUTATION_OUTPUTS,
}
