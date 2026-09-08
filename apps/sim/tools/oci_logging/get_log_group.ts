import {
  OCI_LOGGING_LOG_GROUP_PROPERTIES,
  OCI_LOGGING_RESOURCE_METADATA,
  type OciLoggingParams,
  type OciLoggingResponse,
  ociLoggingConnectionParams,
} from '@/tools/oci_logging/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociLoggingGetLogGroupTool: InternalToolConfig<
  OciLoggingParams<'get_log_group'>,
  OciLoggingResponse<'get_log_group'>
> = {
  id: 'oci_logging_get_log_group',
  name: 'OCI Logging Get Log Group',
  description: 'Get OCI Logging log group details and its ETag.',
  version: '1.0.0',
  params: {
    ...ociLoggingConnectionParams,
    logGroupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Log group OCID.',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...OCI_LOGGING_RESOURCE_METADATA,
    logGroup: {
      type: 'json',
      description: 'Resource details.',
      properties: OCI_LOGGING_LOG_GROUP_PROPERTIES,
    },
  },
}
