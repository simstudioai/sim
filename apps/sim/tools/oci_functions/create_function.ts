import type {
  OciFunctionsCreateFunctionParams,
  OciFunctionsResponse,
} from '@/tools/oci_functions/types'
import {
  OCI_FUNCTIONS_ETAG_OUTPUT,
  OCI_FUNCTIONS_FUNCTION_OUTPUTS,
  OCI_FUNCTIONS_METADATA_OUTPUTS,
} from '@/tools/oci_functions/types'
import {
  OCI_FUNCTIONS_FUNCTION_CONFIGURATION_DESCRIPTION,
  ociFunctionsAuthParams,
} from '@/tools/oci_functions/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociFunctionsCreateFunctionTool: InternalToolConfig<
  OciFunctionsCreateFunctionParams,
  OciFunctionsResponse
> = {
  id: 'oci_functions_create_function',
  name: 'OCI Functions Create Function',
  description:
    'Create an OCI function from an existing container image. Does not build containers, upload images, or deploy source code.',
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
    displayName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New function display name',
    },
    image: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Existing image reference in OCI Registry in the function region',
    },
    memoryInMBs: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Function memory: 128, 256, 512, 1024, 2048, or 3072 MB',
    },
    configuration: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: OCI_FUNCTIONS_FUNCTION_CONFIGURATION_DESCRIPTION,
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
