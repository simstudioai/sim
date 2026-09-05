import {
  OCI_LOGGING_ACCEPTANCE_OUTPUTS,
  type OciLoggingParams,
  type OciLoggingResponse,
  ociLoggingConnectionParams,
} from '@/tools/oci_logging/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociLoggingUpdateLogTool: InternalToolConfig<
  OciLoggingParams<'update_log'>,
  OciLoggingResponse<'update_log'>
> = {
  id: 'oci_logging_update_log',
  name: 'OCI Logging Update Log',
  description:
    'Update a log asynchronously. Explicit false disables it; omission preserves settings. Source updates accept parameters only.',
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
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name, 1–255 characters.',
    },
    isEnabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the log is enabled. Omit to preserve the existing setting on update.',
    },
    retentionDuration: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Retention in days: 30, 60, 90, 120, 150, or 180.',
    },
    configuration: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Update configuration with required source: {parameters?: string map} and optional deprecated archiving: {isEnabled?: boolean}. Source service, resource, category and sourceType cannot be updated.',
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
