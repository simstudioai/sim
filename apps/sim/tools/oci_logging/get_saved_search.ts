import {
  OCI_LOGGING_RESOURCE_METADATA,
  OCI_LOGGING_SAVED_SEARCH_PROPERTIES,
  type OciLoggingParams,
  type OciLoggingResponse,
  ociLoggingConnectionParams,
} from '@/tools/oci_logging/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociLoggingGetSavedSearchTool: InternalToolConfig<
  OciLoggingParams<'get_saved_search'>,
  OciLoggingResponse<'get_saved_search'>
> = {
  id: 'oci_logging_get_saved_search',
  name: 'OCI Logging Get Saved Search',
  description:
    'Get a Logging saved search and its stored query. Execute the query using Search Logs with explicit timestamps.',
  version: '1.0.0',
  params: {
    ...ociLoggingConnectionParams,
    logSavedSearchId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Logging saved search OCID.',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...OCI_LOGGING_RESOURCE_METADATA,
    savedSearch: {
      type: 'json',
      description: 'Resource details.',
      properties: {
        ...OCI_LOGGING_SAVED_SEARCH_PROPERTIES,
        query: {
          type: 'string',
          description: 'Stored native OCI Logging query.',
        },
      },
    },
  },
}
