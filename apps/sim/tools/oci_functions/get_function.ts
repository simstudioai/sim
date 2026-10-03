import type {
  OciFunctionsGetFunctionParams,
  OciFunctionsResponse,
} from '@/tools/oci_functions/types'
import {
  OCI_FUNCTIONS_ETAG_OUTPUT,
  OCI_FUNCTIONS_FUNCTION_OUTPUTS,
  OCI_FUNCTIONS_METADATA_OUTPUTS,
} from '@/tools/oci_functions/types'
import { ociFunctionsAuthParams } from '@/tools/oci_functions/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociFunctionsGetFunctionTool: InternalToolConfig<
  OciFunctionsGetFunctionParams,
  OciFunctionsResponse
> = {
  id: 'oci_functions_get_function',
  name: 'OCI Functions Get Function',
  description:
    'Read an OCI function, including its image, configuration, execution timeouts, concurrency, destinations, and invocation endpoint.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-functions', credentialKind: 'service-account' },
  params: {
    ...ociFunctionsAuthParams,
    functionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Function OCID',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...OCI_FUNCTIONS_METADATA_OUTPUTS,
    ...OCI_FUNCTIONS_ETAG_OUTPUT,
    function: {
      type: 'object',
      description: 'Documented OCI function metadata',
      properties: OCI_FUNCTIONS_FUNCTION_OUTPUTS,
    },
  },
}
