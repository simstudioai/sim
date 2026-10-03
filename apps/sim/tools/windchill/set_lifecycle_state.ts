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

export const windchillSetLifecycleStateTool: InternalToolConfig<
  WindchillParams,
  WindchillResponse
> = {
  id: 'windchill_set_lifecycle_state',
  name: 'Windchill Set Lifecycle State',
  description: 'Transition a document to a valid lifecycle state',
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
    stateValue: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Internal value of the target lifecycle state',
    },
    stateDisplay: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Display value of the target lifecycle state',
    },
  },
  operation: {
    input: (params) => buildWindchillInternalBody('windchill_set_lifecycle_state', params),
  },
  transformResponse: (response) =>
    transformWindchillInternalResponse('windchill_set_lifecycle_state', response),
  outputs: WINDCHILL_SINGLE_MUTATION_OUTPUTS,
}
