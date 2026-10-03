import type {
  OciFunctionsCreateApplicationParams,
  OciFunctionsResponse,
} from '@/tools/oci_functions/types'
import {
  OCI_FUNCTIONS_APPLICATION_OUTPUTS,
  OCI_FUNCTIONS_ETAG_OUTPUT,
  OCI_FUNCTIONS_METADATA_OUTPUTS,
} from '@/tools/oci_functions/types'
import {
  OCI_FUNCTIONS_APPLICATION_CONFIGURATION_DESCRIPTION,
  ociFunctionsAuthParams,
} from '@/tools/oci_functions/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociFunctionsCreateApplicationTool: InternalToolConfig<
  OciFunctionsCreateApplicationParams,
  OciFunctionsResponse
> = {
  id: 'oci_functions_create_application',
  name: 'OCI Functions Create Application',
  description:
    'Create an OCI Functions application using existing subnets. Does not create networking or deploy functions.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-functions', credentialKind: 'service-account' },
  params: {
    ...ociFunctionsAuthParams,
    compartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Compartment OCID',
    },
    displayName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New application display name',
    },
    subnetIds: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      required: true,
      visibility: 'user-or-llm',
      description: 'At least one subnet OCID for the application',
    },
    shape: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'GENERIC_X86, GENERIC_ARM, or GENERIC_X86_ARM; defaults according to Oracle',
    },
    configuration: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: OCI_FUNCTIONS_APPLICATION_CONFIGURATION_DESCRIPTION,
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...OCI_FUNCTIONS_METADATA_OUTPUTS,
    ...OCI_FUNCTIONS_ETAG_OUTPUT,
    application: {
      type: 'object',
      description: 'Documented OCI application metadata',
      properties: OCI_FUNCTIONS_APPLICATION_OUTPUTS,
    },
  },
}
