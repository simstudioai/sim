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

export const windchillUpdateCommonPropertiesTool: InternalToolConfig<
  WindchillParams,
  WindchillResponse
> = {
  id: 'windchill_update_common_properties',
  name: 'Windchill Update Common Properties',
  description: "Update a document's Name, Number, and other common properties",
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
      description:
        'WT.Document OID, for example OR:wt.doc.WTDocument:48796581. The document must not be checked out.',
    },
    commonProperties: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Common properties as a JSON object, for example {"Name":"New name","Number":"NEW-001"}. Enumerated properties take a value/display pair.',
    },
  },
  operation: {
    input: (params) => buildWindchillInternalBody('windchill_update_common_properties', params),
  },
  transformResponse: (response) =>
    transformWindchillInternalResponse('windchill_update_common_properties', response),
  outputs: WINDCHILL_SINGLE_MUTATION_OUTPUTS,
}
