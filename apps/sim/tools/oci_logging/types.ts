import type { z } from 'zod'
import type {
  logGroupSchema,
  logSchema,
  ociLoggingInputSchemas,
  savedSearchSchema,
  savedSearchSummarySchema,
  searchResponseSchema,
  workRequestErrorSchema,
  workRequestSchema,
} from '@/lib/internal/oci-logging/schema'
import type { OutputProperty, ToolConfig, ToolResponse } from '@/tools/types'

export type OciLoggingOperation = keyof typeof ociLoggingInputSchemas
export type OciLoggingParams<T extends OciLoggingOperation> = z.input<
  (typeof ociLoggingInputSchemas)[T]
> & {
  ociCredential: string
  region?: string
}
export type OciLogGroup = z.output<typeof logGroupSchema>
export type OciLog = z.output<typeof logSchema>
interface ResponseMetadata {
  opcRequestId?: string
}
interface PageMetadata extends ResponseMetadata {
  nextPage?: string
}
interface ResourceMetadata extends ResponseMetadata {
  etag?: string
}
export interface OciLoggingAcceptance extends ResponseMetadata {
  accepted: true
  workRequestId: string
}
export interface OciLoggingOutputs {
  list_log_groups: PageMetadata & { logGroups: OciLogGroup[] }
  get_log_group: ResourceMetadata & { logGroup: OciLogGroup }
  create_log_group: OciLoggingAcceptance
  update_log_group: OciLoggingAcceptance
  delete_log_group: OciLoggingAcceptance
  list_logs: PageMetadata & { logs: OciLog[] }
  get_log: ResourceMetadata & { log: OciLog }
  create_log: OciLoggingAcceptance
  update_log: OciLoggingAcceptance
  delete_log: OciLoggingAcceptance
  search_logs: PageMetadata & z.output<typeof searchResponseSchema>
  put_logs: ResponseMetadata & { accepted: true }
  get_work_request: ResourceMetadata & {
    workRequest: z.output<typeof workRequestSchema>
    retryAfter?: number
  }
  list_work_request_errors: PageMetadata & { errors: z.output<typeof workRequestErrorSchema>[] }
  list_saved_searches: PageMetadata & { savedSearches: z.output<typeof savedSearchSummarySchema>[] }
  get_saved_search: ResourceMetadata & { savedSearch: z.output<typeof savedSearchSchema> }
}
export interface OciLoggingResponse<T extends OciLoggingOperation> extends ToolResponse {
  output: OciLoggingOutputs[T]
}

export const ociLoggingConnectionParams = {
  ociCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Stored OCI API signing-key service account credential ID.',
  },
  region: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Optional OCI region override within the credential tenancy realm. Defaults to the credential region.',
  },
} satisfies ToolConfig['params']

export const OCI_LOGGING_RESPONSE_METADATA = {
  opcRequestId: {
    type: 'string',
    optional: true,
    description: 'Oracle request ID.',
  },
} satisfies Record<string, OutputProperty>

export const OCI_LOGGING_PAGE_METADATA = {
  ...OCI_LOGGING_RESPONSE_METADATA,
  nextPage: {
    type: 'string',
    optional: true,
    description:
      'Opaque continuation token. Repeat the same filters and time window with this token; an empty page can still have a continuation.',
  },
} satisfies Record<string, OutputProperty>

export const OCI_LOGGING_RESOURCE_METADATA = {
  ...OCI_LOGGING_RESPONSE_METADATA,
  etag: {
    type: 'string',
    optional: true,
    description: 'Resource version for optimistic concurrency with ifMatch.',
  },
} satisfies Record<string, OutputProperty>

export const OCI_LOGGING_ACCEPTANCE_OUTPUTS = {
  ...OCI_LOGGING_RESPONSE_METADATA,
  accepted: {
    type: 'boolean',
    description: 'Oracle accepted the asynchronous operation. This does not indicate completion.',
  },
  workRequestId: {
    type: 'string',
    description: 'Work request OCID for tracking completion and errors.',
  },
} satisfies Record<string, OutputProperty>

export const OCI_LOGGING_RESOURCE_PROPERTIES = {
  id: {
    type: 'string',
    description: 'Resource OCID.',
  },
  compartmentId: {
    type: 'string',
    optional: true,
    description: 'Compartment OCID.',
  },
  lifecycleState: {
    type: 'string',
    optional: true,
    description: 'Current resource lifecycle state.',
  },
  timeCreated: {
    type: 'string',
    optional: true,
    description: 'Creation time in RFC3339 format.',
  },
  timeLastModified: {
    type: 'string',
    optional: true,
    description: 'Last modification time in RFC3339 format.',
  },
  freeformTags: {
    type: 'json',
    optional: true,
    description: 'User-defined string tag map.',
  },
  definedTags: {
    type: 'json',
    optional: true,
    description: 'String tags grouped by namespace.',
  },
  systemTags: {
    type: 'json',
    optional: true,
    description: 'Oracle system tags grouped by namespace.',
  },
} satisfies Record<string, OutputProperty>

export const OCI_LOGGING_LOG_GROUP_PROPERTIES = {
  ...OCI_LOGGING_RESOURCE_PROPERTIES,
  compartmentId: {
    type: 'string',
    description: 'Compartment OCID.',
  },
  displayName: {
    type: 'string',
    description: 'Log group display name.',
  },
  description: {
    type: 'string',
    optional: true,
    description: 'Log group description.',
  },
} satisfies Record<string, OutputProperty>

export const OCI_LOGGING_LOG_PROPERTIES = {
  ...OCI_LOGGING_RESOURCE_PROPERTIES,
  lifecycleState: {
    type: 'string',
    description: 'Current log lifecycle state.',
  },
  displayName: {
    type: 'string',
    description: 'Log display name.',
  },
  logGroupId: {
    type: 'string',
    description: 'Parent log group OCID.',
  },
  logType: {
    type: 'string',
    description: 'CUSTOM or SERVICE.',
  },
  tenancyId: {
    type: 'string',
    optional: true,
    description: 'Tenancy OCID, when returned by GetLog.',
  },
  isEnabled: {
    type: 'boolean',
    optional: true,
    description: 'Whether this log is enabled.',
  },
  retentionDuration: {
    type: 'number',
    optional: true,
    description: 'Retention duration in days.',
  },
  configuration: {
    type: 'json',
    optional: true,
    description: 'OCI service log configuration.',
    properties: {
      compartmentId: {
        type: 'string',
        optional: true,
        description: 'Source resource compartment OCID.',
      },
      source: {
        type: 'object',
        description: 'OCI service source.',
        properties: {
          sourceType: {
            type: 'string',
            description: 'OCISERVICE.',
          },
          service: {
            type: 'string',
            description: 'Emitting service.',
          },
          resource: {
            type: 'string',
            description: 'Emitting resource identifier.',
          },
          category: {
            type: 'string',
            description: 'Log category.',
          },
          parameters: {
            type: 'json',
            optional: true,
            description: 'Service-specific string parameters.',
          },
        },
      },
      archiving: {
        type: 'object',
        optional: true,
        description: 'Deprecated OCI archiving configuration.',
        properties: {
          isEnabled: {
            type: 'boolean',
            optional: true,
            description: 'Deprecated archiving flag.',
          },
        },
      },
    },
  },
} satisfies Record<string, OutputProperty>

export const OCI_LOGGING_SAVED_SEARCH_PROPERTIES = {
  ...OCI_LOGGING_RESOURCE_PROPERTIES,
  compartmentId: {
    type: 'string',
    description: 'Compartment OCID.',
  },
  name: {
    type: 'string',
    description: 'Saved search name.',
  },
  description: {
    type: 'string',
    optional: true,
    description: 'Saved search description.',
  },
  query: {
    type: 'string',
    optional: true,
    description: 'Stored native query. Pass it to Search Logs with explicit start and end times.',
  },
} satisfies Record<string, OutputProperty>
