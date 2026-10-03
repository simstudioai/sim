import type {
  OciFunctionsDeleteApplicationParams,
  OciFunctionsResponse,
} from '@/tools/oci_functions/types'
import { OCI_FUNCTIONS_METADATA_OUTPUTS } from '@/tools/oci_functions/types'
import { ociFunctionsAuthParams, ociFunctionsIfMatchParam } from '@/tools/oci_functions/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociFunctionsDeleteApplicationTool: InternalToolConfig<
  OciFunctionsDeleteApplicationParams,
  OciFunctionsResponse
> = {
  id: 'oci_functions_delete_application',
  name: 'OCI Functions Delete Application',
  description:
    'Delete an OCI Functions application with one API request. Delete contained functions explicitly first; this tool does not perform cascading function deletion.',
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
    ...ociFunctionsIfMatchParam,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...OCI_FUNCTIONS_METADATA_OUTPUTS,
    applicationId: {
      type: 'string',
      description: 'Application OCID supplied to the successful operation',
    },
  },
}
