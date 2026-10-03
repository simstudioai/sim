import {
  OCI_LOGGING_LOG_PROPERTIES,
  OCI_LOGGING_RESOURCE_METADATA,
  type OciLoggingParams,
  type OciLoggingResponse,
  ociLoggingConnectionParams,
} from '@/tools/oci_logging/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociLoggingGetLogTool: InternalToolConfig<
  OciLoggingParams<'get_log'>,
  OciLoggingResponse<'get_log'>
> = {
  id: 'oci_logging_get_log',
  name: 'OCI Logging Get Log',
  description: 'Get an OCI log, its source configuration, retention, enablement, and ETag.',
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
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...OCI_LOGGING_RESOURCE_METADATA,
    log: {
      type: 'json',
      description: 'Resource details.',
      properties: OCI_LOGGING_LOG_PROPERTIES,
    },
  },
}
