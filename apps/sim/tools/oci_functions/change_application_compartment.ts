import type {
  OciFunctionsChangeApplicationCompartmentParams,
  OciFunctionsResponse,
} from '@/tools/oci_functions/types'
import { OCI_FUNCTIONS_METADATA_OUTPUTS } from '@/tools/oci_functions/types'
import { ociFunctionsAuthParams, ociFunctionsIfMatchParam } from '@/tools/oci_functions/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociFunctionsChangeApplicationCompartmentTool: InternalToolConfig<
  OciFunctionsChangeApplicationCompartmentParams,
  OciFunctionsResponse
> = {
  id: 'oci_functions_change_application_compartment',
  name: 'OCI Functions Change Application Compartment',
  description:
    'Move an OCI Functions application to a destination compartment. Oracle checks access for the move; verify destination policies before moving production applications.',
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
    compartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Destination compartment OCID',
    },
    ...ociFunctionsIfMatchParam,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...OCI_FUNCTIONS_METADATA_OUTPUTS,
    applicationId: {
      type: 'string',
      description: 'Application OCID supplied to the successful operation',
    },
    compartmentId: {
      type: 'string',
      description: 'Destination compartment OCID supplied to the successful move',
    },
  },
}
