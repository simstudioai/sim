import {
  OCI_LOGGING_ACCEPTANCE_OUTPUTS,
  type OciLoggingParams,
  type OciLoggingResponse,
  ociLoggingConnectionParams,
} from '@/tools/oci_logging/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociLoggingUpdateLogGroupTool: InternalToolConfig<
  OciLoggingParams<'update_log_group'>,
  OciLoggingResponse<'update_log_group'>
> = {
  id: 'oci_logging_update_log_group',
  name: 'OCI Logging Update Log Group',
  description:
    'Update an OCI Logging log group. Omitted fields are preserved; completion is tracked by work request.',
  version: '1.0.0',
  params: {
    ...ociLoggingConnectionParams,
    logGroupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Log group OCID.',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name, 1–255 characters.',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description, 1–400 characters.',
    },
    freeformTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'String tag map, for example {"Department":"Finance"}.',
    },
    definedTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'String tags grouped by namespace, for example {"Operations":{"CostCenter":"42"}}.',
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
