import {
  OCI_LOGGING_ACCEPTANCE_OUTPUTS,
  type OciLoggingParams,
  type OciLoggingResponse,
  ociLoggingConnectionParams,
} from '@/tools/oci_logging/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociLoggingDeleteLogGroupTool: InternalToolConfig<
  OciLoggingParams<'delete_log_group'>,
  OciLoggingResponse<'delete_log_group'>
> = {
  id: 'oci_logging_delete_log_group',
  name: 'OCI Logging Delete Log Group',
  description: 'Delete an OCI Logging log group asynchronously. Track the returned work request.',
  version: '1.0.0',
  params: {
    ...ociLoggingConnectionParams,
    logGroupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Log group OCID.',
    },
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional ETag from Get for optimistic concurrency.',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...OCI_LOGGING_ACCEPTANCE_OUTPUTS,
  },
}
