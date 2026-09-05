import type {
  OciFunctionsGetApplicationParams,
  OciFunctionsResponse,
} from '@/tools/oci_functions/types'
import {
  OCI_FUNCTIONS_APPLICATION_OUTPUTS,
  OCI_FUNCTIONS_ETAG_OUTPUT,
  OCI_FUNCTIONS_METADATA_OUTPUTS,
} from '@/tools/oci_functions/types'
import { ociFunctionsAuthParams } from '@/tools/oci_functions/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociFunctionsGetApplicationTool: InternalToolConfig<
  OciFunctionsGetApplicationParams,
  OciFunctionsResponse
> = {
  id: 'oci_functions_get_application',
  name: 'OCI Functions Get Application',
  description:
    'Read an OCI Functions application, including configuration, networking, tags, tracing, logging, and image policy.',
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
