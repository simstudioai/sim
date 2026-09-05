import type { UserFile } from '@/executor/types'
import type { ToolOutputProperty, ToolResponse } from '@/tools/types'

export type OciFunctionsJson =
  | null
  | boolean
  | number
  | string
  | OciFunctionsJson[]
  | { [key: string]: OciFunctionsJson }
export type OciFunctionsTags = Record<string, Record<string, OciFunctionsJson>>
export type OciFunctionsShape = 'GENERIC_X86' | 'GENERIC_ARM' | 'GENERIC_X86_ARM'
export type OciFunctionsDestination =
  | { destinationType: 'NONE' }
  | { destinationType: 'STREAM'; streamId: string }
  | { destinationType: 'QUEUE'; queueId: string; channelId?: string }
  | { destinationType: 'NOTIFICATION'; topicId: string }
export type OciFunctionsConcurrency = { strategy: 'NONE' } | { strategy: 'CONSTANT'; count: number }

export interface OciFunctionsApplicationSettings {
  config?: Record<string, string>
  networkSecurityGroupIds?: string[]
  syslogUrl?: string
  traceConfig?: { domainId?: string; isEnabled?: boolean }
  logging?: { lineFormat?: 'JSON' | 'PLAIN_TEXT' }
  freeformTags?: Record<string, string>
  definedTags?: OciFunctionsTags
  imagePolicyConfig?: { isPolicyEnabled: boolean; keyDetails?: { kmsKeyId: string }[] }
  securityAttributes?: Record<string, Record<string, { value: string; mode: 'enforce' }>>
}
export interface OciFunctionsFunctionSettings {
  config?: Record<string, string>
  imageDigest?: string
  timeoutInSeconds?: number
  detachedModeTimeoutInSeconds?: number
  provisionedConcurrencyConfig?: OciFunctionsConcurrency
  failureDestination?: OciFunctionsDestination
  successDestination?: OciFunctionsDestination
  traceConfig?: { isEnabled?: boolean }
  freeformTags?: Record<string, string>
  definedTags?: OciFunctionsTags
}
export interface OciFunctionsAuthParams {
  oauthCredential: string
  region?: string
}
export interface OciFunctionsListParams {
  page?: string
  limit?: number
  displayName?: string
  id?: string
  lifecycleState?: string
  sortBy?: 'timeCreated' | 'id' | 'displayName'
  sortOrder?: 'ASC' | 'DESC'
}
export interface OciFunctionsInvokeParams extends OciFunctionsAuthParams {
  functionId: string
  invocationType?: 'sync' | 'detached'
  dryRun?: boolean
  intent?: 'httprequest' | 'cloudevent'
  payloadType?: 'json' | 'text' | 'file'
  payload?: OciFunctionsJson
  file?: UserFile | string
  contentType?: string
  outputFormat?: 'auto' | 'file'
  timeoutMs?: number
}
export interface OciFunctionsListApplicationsParams
  extends OciFunctionsAuthParams,
    OciFunctionsListParams {
  compartmentId: string
}
export interface OciFunctionsGetApplicationParams extends OciFunctionsAuthParams {
  applicationId: string
}
export interface OciFunctionsCreateApplicationParams extends OciFunctionsAuthParams {
  compartmentId: string
  displayName: string
  subnetIds: string[]
  shape?: OciFunctionsShape
  configuration?: OciFunctionsApplicationSettings
}
export interface OciFunctionsUpdateApplicationParams extends OciFunctionsGetApplicationParams {
  configuration: OciFunctionsApplicationSettings
  ifMatch?: string
}
export interface OciFunctionsDeleteApplicationParams extends OciFunctionsGetApplicationParams {
  ifMatch?: string
}
export interface OciFunctionsChangeApplicationCompartmentParams
  extends OciFunctionsDeleteApplicationParams {
  compartmentId: string
}
export interface OciFunctionsListFunctionsParams
  extends OciFunctionsAuthParams,
    OciFunctionsListParams {
  applicationId: string
}
export interface OciFunctionsGetFunctionParams extends OciFunctionsAuthParams {
  functionId: string
}
export interface OciFunctionsCreateFunctionParams extends OciFunctionsAuthParams {
  applicationId: string
  displayName: string
  image: string
  memoryInMBs: number
  configuration?: OciFunctionsFunctionSettings
}
export interface OciFunctionsUpdateFunctionParams extends OciFunctionsGetFunctionParams {
  image?: string
  memoryInMBs?: number
  configuration?: OciFunctionsFunctionSettings
  ifMatch?: string
}
export interface OciFunctionsDeleteFunctionParams extends OciFunctionsGetFunctionParams {
  ifMatch?: string
}

/** Output fields vary by operation; detached invocation has no completed result. */
export interface OciFunctionsResponse extends ToolResponse {
  output: {
    status: number
    opcRequestId?: string
    etag?: string
    nextPage?: string
    application?: Record<string, unknown>
    applications?: Record<string, unknown>[]
    function?: Record<string, unknown>
    functions?: Record<string, unknown>[]
    applicationId?: string
    functionId?: string
    compartmentId?: string
    invocationType?: 'sync' | 'detached'
    dryRun?: boolean
    accepted?: boolean
    contentType?: string
    result?: OciFunctionsJson
    file?: UserFile | { name: string; mimeType: string; data: string; size: number }
  }
}

export const OCI_FUNCTIONS_METADATA_OUTPUTS = {
  status: { type: 'number', description: 'HTTP status returned by Oracle' },
  opcRequestId: {
    type: 'string',
    optional: true,
    description: 'Oracle request identifier, when returned',
  },
} satisfies Record<string, ToolOutputProperty>
export const OCI_FUNCTIONS_ETAG_OUTPUT = {
  etag: {
    type: 'string',
    optional: true,
    description: 'Oracle resource ETag for conditional updates or deletion',
  },
} satisfies Record<string, ToolOutputProperty>
export const OCI_FUNCTIONS_NEXT_PAGE_OUTPUT = {
  nextPage: {
    type: 'string',
    optional: true,
    description: 'Continuation token; absent on the last page',
  },
} satisfies Record<string, ToolOutputProperty>
export const OCI_FUNCTIONS_COMMON_OUTPUTS = {
  id: { type: 'string', description: 'Resource OCID' },
  compartmentId: {
    type: 'string',
    optional: true,
    nullable: true,
    description: 'Compartment OCID',
  },
  displayName: {
    type: 'string',
    optional: true,
    nullable: true,
    description: 'Resource display name',
  },
  lifecycleState: {
    type: 'string',
    optional: true,
    nullable: true,
    description: 'Current lifecycle state',
  },
  timeCreated: {
    type: 'string',
    optional: true,
    nullable: true,
    description: 'Creation time in RFC 3339 format',
  },
  timeUpdated: {
    type: 'string',
    optional: true,
    nullable: true,
    description: 'Last update time in RFC 3339 format',
  },
  freeformTags: {
    type: 'json',
    optional: true,
    nullable: true,
    description: 'Free-form tag key/value map',
  },
  definedTags: {
    type: 'json',
    optional: true,
    nullable: true,
    description: 'Defined tags grouped by namespace',
  },
} satisfies Record<string, ToolOutputProperty>
export const OCI_FUNCTIONS_DESTINATION_OUTPUT = {
  type: 'object',
  optional: true,
  nullable: true,
  description: 'Invocation result destination; fields depend on destinationType',
  properties: {
    destinationType: { type: 'string', description: 'NONE, STREAM, QUEUE, or NOTIFICATION' },
    streamId: {
      type: 'string',
      optional: true,
      nullable: true,
      description: 'Stream OCID for STREAM',
    },
    queueId: {
      type: 'string',
      optional: true,
      nullable: true,
      description: 'Queue OCID for QUEUE',
    },
    channelId: {
      type: 'string',
      optional: true,
      nullable: true,
      description: 'Optional queue channel',
    },
    topicId: {
      type: 'string',
      optional: true,
      nullable: true,
      description: 'Topic OCID for NOTIFICATION',
    },
  },
} satisfies ToolOutputProperty

export const OCI_FUNCTIONS_APPLICATION_SUMMARY_OUTPUTS = {
  ...OCI_FUNCTIONS_COMMON_OUTPUTS,
  subnetIds: {
    type: 'array',
    items: { type: 'string' },
    optional: true,
    nullable: true,
    description: 'Application subnet OCIDs',
  },
  networkSecurityGroupIds: {
    type: 'array',
    items: { type: 'string' },
    optional: true,
    nullable: true,
    description: 'Network security group OCIDs',
  },
  shape: {
    type: 'string',
    optional: true,
    nullable: true,
    description: 'Application processor architecture',
  },
  traceConfig: {
    type: 'object',
    optional: true,
    nullable: true,
    description: 'Application tracing configuration',
    properties: {
      domainId: { type: 'string', optional: true, nullable: true, description: 'APM domain OCID' },
      isEnabled: {
        type: 'boolean',
        optional: true,
        nullable: true,
        description: 'Whether tracing is enabled',
      },
    },
  },
  logging: {
    type: 'object',
    optional: true,
    nullable: true,
    description: 'Application logging configuration',
    properties: {
      lineFormat: {
        type: 'string',
        optional: true,
        nullable: true,
        description: 'JSON or PLAIN_TEXT',
      },
    },
  },
  imagePolicyConfig: {
    type: 'object',
    optional: true,
    nullable: true,
    description: 'Image signature policy',
    properties: {
      isPolicyEnabled: {
        type: 'boolean',
        optional: true,
        nullable: true,
        description: 'Whether signature verification is enabled',
      },
      keyDetails: {
        type: 'array',
        optional: true,
        nullable: true,
        description: 'Trusted signing keys',
        items: {
          type: 'object',
          properties: {
            kmsKeyId: {
              type: 'string',
              optional: true,
              nullable: true,
              description: 'KMS key OCID',
            },
          },
        },
      },
    },
  },
  securityAttributes: {
    type: 'json',
    optional: true,
    nullable: true,
    description: 'Security attributes grouped by namespace, with value and mode',
  },
} satisfies Record<string, ToolOutputProperty>
export const OCI_FUNCTIONS_APPLICATION_OUTPUTS = {
  ...OCI_FUNCTIONS_APPLICATION_SUMMARY_OUTPUTS,
  config: {
    type: 'json',
    optional: true,
    nullable: true,
    description: 'Application environment variables; functions can override values',
  },
  syslogUrl: {
    type: 'string',
    optional: true,
    nullable: true,
    description: 'Application syslog URL',
  },
} satisfies Record<string, ToolOutputProperty>
export const OCI_FUNCTIONS_FUNCTION_SUMMARY_OUTPUTS = {
  ...OCI_FUNCTIONS_COMMON_OUTPUTS,
  applicationId: {
    type: 'string',
    optional: true,
    nullable: true,
    description: 'Application OCID',
  },
  image: {
    type: 'string',
    optional: true,
    nullable: true,
    description: 'Container image reference',
  },
  imageDigest: {
    type: 'string',
    optional: true,
    nullable: true,
    description: 'Container image digest',
  },
  invokeEndpoint: {
    type: 'string',
    optional: true,
    nullable: true,
    description:
      'Oracle invocation endpoint; the invoke tool discovers and validates it automatically',
  },
  memoryInMBs: {
    type: 'number',
    optional: true,
    nullable: true,
    description: 'Allocated memory in MB',
  },
  timeoutInSeconds: {
    type: 'number',
    optional: true,
    nullable: true,
    description: 'Synchronous execution timeout in seconds',
  },
  detachedModeTimeoutInSeconds: {
    type: 'number',
    optional: true,
    nullable: true,
    description: 'Detached execution timeout in seconds',
  },
  shape: {
    type: 'string',
    optional: true,
    nullable: true,
    description: 'Function processor architecture',
  },
  provisionedConcurrencyConfig: {
    type: 'object',
    optional: true,
    nullable: true,
    description: 'Provisioned concurrency settings',
    properties: {
      strategy: { type: 'string', description: 'NONE or CONSTANT' },
      count: {
        type: 'number',
        optional: true,
        nullable: true,
        description: 'Provisioned concurrency count for CONSTANT',
      },
    },
  },
  failureDestination: OCI_FUNCTIONS_DESTINATION_OUTPUT,
  successDestination: OCI_FUNCTIONS_DESTINATION_OUTPUT,
  traceConfig: {
    type: 'object',
    optional: true,
    nullable: true,
    description: 'Function tracing configuration',
    properties: {
      isEnabled: {
        type: 'boolean',
        optional: true,
        nullable: true,
        description: 'Whether tracing is enabled',
      },
    },
  },
  sourceDetails: {
    type: 'object',
    optional: true,
    nullable: true,
    description: 'Pre-built function source metadata, when present',
    properties: {
      sourceType: { type: 'string', description: 'PRE_BUILT_FUNCTIONS' },
      pbfListingId: {
        type: 'string',
        optional: true,
        nullable: true,
        description: 'Pre-built function listing OCID',
      },
    },
  },
} satisfies Record<string, ToolOutputProperty>
export const OCI_FUNCTIONS_FUNCTION_OUTPUTS = {
  ...OCI_FUNCTIONS_FUNCTION_SUMMARY_OUTPUTS,
  config: {
    type: 'json',
    optional: true,
    nullable: true,
    description: 'Function environment variables, overriding application values',
  },
} satisfies Record<string, ToolOutputProperty>
