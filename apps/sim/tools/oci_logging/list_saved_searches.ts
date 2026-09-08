import {
  OCI_LOGGING_PAGE_METADATA,
  OCI_LOGGING_SAVED_SEARCH_PROPERTIES,
  type OciLoggingParams,
  type OciLoggingResponse,
  ociLoggingConnectionParams,
} from '@/tools/oci_logging/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociLoggingListSavedSearchesTool: InternalToolConfig<
  OciLoggingParams<'list_saved_searches'>,
  OciLoggingResponse<'list_saved_searches'>
> = {
  id: 'oci_logging_list_saved_searches',
  name: 'OCI Logging List Saved Searches',
  description:
    'List one page of Logging saved searches. Use Get Saved Search to retrieve a query for Search Logs.',
  version: '1.0.0',
  params: {
    ...ociLoggingConnectionParams,
    compartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Compartment OCID.',
    },
    logSavedSearchId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Logging saved search OCID.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by saved search name.',
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
    savedSearches: {
      type: 'array',
      description: 'Resources on this page.',
      items: {
        type: 'object',
        properties: OCI_LOGGING_SAVED_SEARCH_PROPERTIES,
      },
    },
  },
}
