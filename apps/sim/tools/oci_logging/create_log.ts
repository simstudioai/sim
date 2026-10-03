import {
  OCI_LOGGING_ACCEPTANCE_OUTPUTS,
  type OciLoggingParams,
  type OciLoggingResponse,
  ociLoggingConnectionParams,
} from '@/tools/oci_logging/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociLoggingCreateLogTool: InternalToolConfig<
  OciLoggingParams<'create_log'>,
  OciLoggingResponse<'create_log'>
> = {
  id: 'oci_logging_create_log',
  name: 'OCI Logging Create Log',
  description:
    'Create a CUSTOM or SERVICE log asynchronously. Service logs use the emitting service resource configuration.',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'Display name, 1–255 characters.',
    },
    logType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'CUSTOM or SERVICE.',
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
        'Service log configuration: source with sourceType OCISERVICE, service, resource, category and optional string parameters; optional compartmentId and deprecated archiving.isEnabled.',
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
