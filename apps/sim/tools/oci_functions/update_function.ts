import type {
  OciFunctionsResponse,
  OciFunctionsUpdateFunctionParams,
} from '@/tools/oci_functions/types'
import {
  OCI_FUNCTIONS_ETAG_OUTPUT,
  OCI_FUNCTIONS_FUNCTION_OUTPUTS,
  OCI_FUNCTIONS_METADATA_OUTPUTS,
} from '@/tools/oci_functions/types'
import {
  OCI_FUNCTIONS_FUNCTION_CONFIGURATION_DESCRIPTION,
  ociFunctionsAuthParams,
  ociFunctionsIfMatchParam,
} from '@/tools/oci_functions/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociFunctionsUpdateFunctionTool: InternalToolConfig<
  OciFunctionsUpdateFunctionParams,
  OciFunctionsResponse
> = {
  id: 'oci_functions_update_function',
  name: 'OCI Functions Update Function',
  description:
    'Update an OCI function image, memory, or documented configuration. Supplied maps and nested settings replace existing values; omitted fields are unchanged. Does not build or publish images.',
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
    image: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Existing image reference in OCI Registry in the function region',
    },
    memoryInMBs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Function memory: 128, 256, 512, 1024, 2048, or 3072 MB',
    },
    configuration: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: OCI_FUNCTIONS_FUNCTION_CONFIGURATION_DESCRIPTION,
    },
    ...ociFunctionsIfMatchParam,
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
