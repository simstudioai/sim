import type {
  OciFunctionsListApplicationsParams,
  OciFunctionsResponse,
} from '@/tools/oci_functions/types'
import {
  OCI_FUNCTIONS_APPLICATION_SUMMARY_OUTPUTS,
  OCI_FUNCTIONS_METADATA_OUTPUTS,
  OCI_FUNCTIONS_NEXT_PAGE_OUTPUT,
} from '@/tools/oci_functions/types'
import { ociFunctionsAuthParams, ociFunctionsListParams } from '@/tools/oci_functions/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociFunctionsListApplicationsTool: InternalToolConfig<
  OciFunctionsListApplicationsParams,
  OciFunctionsResponse
> = {
  id: 'oci_functions_list_applications',
  name: 'OCI Functions List Applications',
  description:
    'List one page of OCI Functions applications in a compartment, with exact filters and continuation-token pagination.',
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
    ...ociFunctionsListParams,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...OCI_FUNCTIONS_METADATA_OUTPUTS,
    ...OCI_FUNCTIONS_NEXT_PAGE_OUTPUT,
    applications: {
      type: 'array',
      description: 'One page of applications',
      items: { type: 'object', properties: OCI_FUNCTIONS_APPLICATION_SUMMARY_OUTPUTS },
    },
  },
}
