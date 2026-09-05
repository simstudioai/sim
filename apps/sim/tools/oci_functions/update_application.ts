import type {
  OciFunctionsResponse,
  OciFunctionsUpdateApplicationParams,
} from '@/tools/oci_functions/types'
import {
  OCI_FUNCTIONS_APPLICATION_OUTPUTS,
  OCI_FUNCTIONS_ETAG_OUTPUT,
  OCI_FUNCTIONS_METADATA_OUTPUTS,
} from '@/tools/oci_functions/types'
import {
  OCI_FUNCTIONS_APPLICATION_CONFIGURATION_DESCRIPTION,
  ociFunctionsAuthParams,
  ociFunctionsIfMatchParam,
} from '@/tools/oci_functions/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociFunctionsUpdateApplicationTool: InternalToolConfig<
  OciFunctionsUpdateApplicationParams,
  OciFunctionsResponse
> = {
  id: 'oci_functions_update_application',
  name: 'OCI Functions Update Application',
  description:
    'Update documented OCI Functions application settings. Supplied configuration maps replace existing values; omitted fields are unchanged. Does not rename the application or change its subnets.',
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
    configuration: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: OCI_FUNCTIONS_APPLICATION_CONFIGURATION_DESCRIPTION,
    },
    ...ociFunctionsIfMatchParam,
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
