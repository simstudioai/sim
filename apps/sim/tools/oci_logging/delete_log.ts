import {
  OCI_LOGGING_ACCEPTANCE_OUTPUTS,
  type OciLoggingParams,
  type OciLoggingResponse,
  ociLoggingConnectionParams,
} from '@/tools/oci_logging/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociLoggingDeleteLogTool: InternalToolConfig<
  OciLoggingParams<'delete_log'>,
  OciLoggingResponse<'delete_log'>
> = {
  id: 'oci_logging_delete_log',
  name: 'OCI Logging Delete Log',
  description: 'Delete an OCI log asynchronously and return the tracking work request.',
  version: '1.0.0',
  params: {
    ...ociLoggingConnectionParams,
    logGroupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Log group OCID.',
    },
    logId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Log OCID. Put Logs requires a CUSTOM log.',
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
