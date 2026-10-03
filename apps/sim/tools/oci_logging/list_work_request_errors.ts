import {
  OCI_LOGGING_PAGE_METADATA,
  type OciLoggingParams,
  type OciLoggingResponse,
  ociLoggingConnectionParams,
} from '@/tools/oci_logging/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociLoggingListWorkRequestErrorsTool: InternalToolConfig<
  OciLoggingParams<'list_work_request_errors'>,
  OciLoggingResponse<'list_work_request_errors'>
> = {
  id: 'oci_logging_list_work_request_errors',
  name: 'OCI Logging List Work Request Errors',
  description: 'List one page of documented error entries for a Logging work request.',
  version: '1.0.0',
  params: {
    ...ociLoggingConnectionParams,
    workRequestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Logging work request OCID returned by a management mutation.',
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
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...OCI_LOGGING_PAGE_METADATA,
    errors: {
      type: 'array',
      description: 'Work request errors on this page.',
      items: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'Error code.',
          },
          message: {
            type: 'string',
            description: 'Work request error message.',
          },
          timestamp: {
            type: 'string',
            description: 'Error timestamp in RFC3339 format.',
          },
        },
      },
    },
  },
}
