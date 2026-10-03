import {
  OCI_LOGGING_LOG_PROPERTIES,
  OCI_LOGGING_PAGE_METADATA,
  type OciLoggingParams,
  type OciLoggingResponse,
  ociLoggingConnectionParams,
} from '@/tools/oci_logging/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociLoggingListLogsTool: InternalToolConfig<
  OciLoggingParams<'list_logs'>,
  OciLoggingResponse<'list_logs'>
> = {
  id: 'oci_logging_list_logs',
  name: 'OCI Logging List Logs',
  description:
    'List one page of logs in an OCI Logging log group, optionally filtered by CUSTOM or SERVICE.',
  version: '1.0.0',
  params: {
    ...ociLoggingConnectionParams,
    logGroupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Log group OCID.',
    },
    logType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'CUSTOM or SERVICE.',
    },
    sourceService: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by emitting OCI service.',
    },
    sourceResource: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by emitting resource identifier.',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name, 1–255 characters.',
    },
    lifecycleState: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'CREATING, ACTIVE, UPDATING, INACTIVE, DELETING, or FAILED.',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum items for this page, 1–1000; default 100.',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Opaque nextPage token from the preceding response. Preserve the same filters and time window.',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort by timeCreated or displayName.',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ASC or DESC.',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...OCI_LOGGING_PAGE_METADATA,
    logs: {
      type: 'array',
      description: 'Resources on this page.',
      items: {
        type: 'object',
        properties: OCI_LOGGING_LOG_PROPERTIES,
      },
    },
  },
}
