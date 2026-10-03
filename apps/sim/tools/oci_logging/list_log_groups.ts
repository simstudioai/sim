import {
  OCI_LOGGING_LOG_GROUP_PROPERTIES,
  OCI_LOGGING_PAGE_METADATA,
  type OciLoggingParams,
  type OciLoggingResponse,
  ociLoggingConnectionParams,
} from '@/tools/oci_logging/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociLoggingListLogGroupsTool: InternalToolConfig<
  OciLoggingParams<'list_log_groups'>,
  OciLoggingResponse<'list_log_groups'>
> = {
  id: 'oci_logging_list_log_groups',
  name: 'OCI Logging List Log Groups',
  description:
    'List one page of OCI Logging log groups. Filtered empty pages can still have continuation.',
  version: '1.0.0',
  params: {
    ...ociLoggingConnectionParams,
    compartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Compartment OCID.',
    },
    isCompartmentIdInSubtree: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include descendant compartments; Oracle defaults to false.',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name, 1–255 characters.',
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
    logGroups: {
      type: 'array',
      description: 'Resources on this page.',
      items: {
        type: 'object',
        properties: OCI_LOGGING_LOG_GROUP_PROPERTIES,
      },
    },
  },
}
