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

export const windchillCreateDocumentTool: InternalToolConfig<WindchillParams, WindchillResponse> = {
  id: 'windchill_create_document',
  name: 'Windchill Create Document',
  description: 'Create one WT.Document',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Document name',
    },
    containerOid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Container OID in which to create the document',
    },
    number: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional document number when manual numbering is enabled',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Document title',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Document description',
    },
    folderOid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional folder OID for the new document',
    },
    attributes: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional installed Windchill document attributes as a JSON object',
    },
  },
  operation: {
    input: (params) => buildWindchillInternalBody('windchill_create_document', params),
  },
  transformResponse: (response) =>
    transformWindchillInternalResponse('windchill_create_document', response),
  outputs: WINDCHILL_SINGLE_MUTATION_OUTPUTS,
}
