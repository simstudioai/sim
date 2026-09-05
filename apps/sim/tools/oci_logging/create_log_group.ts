import {
  OCI_LOGGING_ACCEPTANCE_OUTPUTS,
  type OciLoggingParams,
  type OciLoggingResponse,
  ociLoggingConnectionParams,
} from '@/tools/oci_logging/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociLoggingCreateLogGroupTool: InternalToolConfig<
  OciLoggingParams<'create_log_group'>,
  OciLoggingResponse<'create_log_group'>
> = {
  id: 'oci_logging_create_log_group',
  name: 'OCI Logging Create Log Group',
  description:
    'Create an OCI Logging log group and return asynchronous acceptance with a work request OCID.',
  version: '1.0.0',
  params: {
    ...ociLoggingConnectionParams,
    compartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Compartment OCID.',
    },
    displayName: {
      type: 'string',
      required: true,
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
    retryToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional stable retry token, 1–64 characters. Oracle retains tokens for up to 24 hours, subject to invalidation. Reuse for the same create request.',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...OCI_LOGGING_ACCEPTANCE_OUTPUTS,
  },
}
