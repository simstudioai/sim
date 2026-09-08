import type {
  OciFunctionsDeleteFunctionParams,
  OciFunctionsResponse,
} from '@/tools/oci_functions/types'
import { OCI_FUNCTIONS_METADATA_OUTPUTS } from '@/tools/oci_functions/types'
import { ociFunctionsAuthParams, ociFunctionsIfMatchParam } from '@/tools/oci_functions/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociFunctionsDeleteFunctionTool: InternalToolConfig<
  OciFunctionsDeleteFunctionParams,
  OciFunctionsResponse
> = {
  id: 'oci_functions_delete_function',
  name: 'OCI Functions Delete Function',
  description:
    'Delete an OCI function, optionally requiring an ETag match. Returns successful HTTP 204 acknowledgement without parsing an empty response body.',
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
    ...ociFunctionsIfMatchParam,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...OCI_FUNCTIONS_METADATA_OUTPUTS,
    functionId: {
      type: 'string',
      description: 'Function OCID supplied to the successful operation',
    },
  },
}
