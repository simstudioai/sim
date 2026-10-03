import type {
  OciFunctionsListFunctionsParams,
  OciFunctionsResponse,
} from '@/tools/oci_functions/types'
import {
  OCI_FUNCTIONS_FUNCTION_SUMMARY_OUTPUTS,
  OCI_FUNCTIONS_METADATA_OUTPUTS,
  OCI_FUNCTIONS_NEXT_PAGE_OUTPUT,
} from '@/tools/oci_functions/types'
import { ociFunctionsAuthParams, ociFunctionsListParams } from '@/tools/oci_functions/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociFunctionsListFunctionsTool: InternalToolConfig<
  OciFunctionsListFunctionsParams,
  OciFunctionsResponse
> = {
  id: 'oci_functions_list_functions',
  name: 'OCI Functions List Functions',
  description:
    'List one page of OCI functions in an application, with exact filters and continuation-token pagination.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-functions', credentialKind: 'service-account' },
  params: {
    ...ociFunctionsAuthParams,
    applicationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Application OCID',
    },
    ...ociFunctionsListParams,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...OCI_FUNCTIONS_METADATA_OUTPUTS,
    ...OCI_FUNCTIONS_NEXT_PAGE_OUTPUT,
    functions: {
      type: 'array',
      description: 'One page of functions',
      items: { type: 'object', properties: OCI_FUNCTIONS_FUNCTION_SUMMARY_OUTPUTS },
    },
  },
}
