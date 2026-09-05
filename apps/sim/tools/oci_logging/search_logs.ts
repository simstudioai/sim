import {
  OCI_LOGGING_PAGE_METADATA,
  type OciLoggingParams,
  type OciLoggingResponse,
  ociLoggingConnectionParams,
} from '@/tools/oci_logging/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociLoggingSearchLogsTool: InternalToolConfig<
  OciLoggingParams<'search_logs'>,
  OciLoggingResponse<'search_logs'>
> = {
  id: 'oci_logging_search_logs',
  name: 'OCI Logging Search Logs',
  description:
    'Search OCI Logging using an unchanged native query and an explicit window of at most 14 days. Return one bounded page of dynamic projected records and continuation.',
  version: '1.0.0',
  params: {
    ...ociLoggingConnectionParams,
    searchQuery: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Full native OCI Logging query, for example search "<compartment>/<group>/<log>" | sort by datetime desc. Sent unchanged.',
    },
    timeStart: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Explicit RFC3339 start timestamp, including timezone.',
    },
    timeEnd: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Explicit RFC3339 end timestamp after timeStart, at most 14 days later.',
    },
    isReturnFieldInfo: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return projected field names and types.',
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
    results: {
      type: 'array',
      description: 'Projected records on this page.',
      items: {
        type: 'object',
        properties: {
          data: {
            type: 'json',
            description: 'Dynamic fields selected or aggregated by the native query.',
          },
        },
      },
    },
    fields: {
      type: 'array',
      description: 'Field schema when requested and returned.',
      items: {
        type: 'object',
        properties: {
          fieldName: {
            type: 'string',
            description: 'Projected field name.',
          },
          fieldType: {
            type: 'string',
            description: 'STRING, NUMBER, BOOLEAN, or ARRAY.',
          },
        },
      },
    },
    summary: {
      type: 'json',
      description:
        'Oracle search result summary; not a count of all matching records across pages.',
      properties: {
        resultCount: {
          type: 'number',
          optional: true,
          description: 'Provider result count.',
        },
        fieldCount: {
          type: 'number',
          optional: true,
          description: 'Provider field count.',
        },
      },
    },
  },
}
