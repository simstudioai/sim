import type { UserFile } from '@/executor/types'
import type { ToolOutputProperty, ToolResponse } from '@/tools/types'

export interface OciResourceManagerParams {
  oauthCredential: string
  region?: string
  compartmentId?: string
  stackId?: string
  jobId?: string
  workRequestId?: string
  displayName?: string
  description?: string
  id?: string
  lifecycleState?: string
  limit?: number
  page?: string
  sortBy?: string
  sortOrder?: string
  configSource?: Record<string, unknown>
  file?: unknown
  variables?: Record<string, string>
  freeformTags?: Record<string, string>
  definedTags?: Record<string, Record<string, string>>
  terraformVersion?: string
  customTerraformProvider?: Record<string, unknown>
  isThirdPartyProviderExperienceEnabled?: boolean
  ifMatch?: string
  retryToken?: string
  confirmDelete?: boolean
  confirmApply?: boolean
  confirmDestroy?: boolean
  confirmStateReplacement?: boolean
  confirmForce?: boolean
  isForced?: boolean
  isProviderUpgradeRequired?: boolean
  terraformAdvancedOptions?: Record<string, unknown>
  executionPlanStrategy?: string
  executionPlanJobId?: string
  targetRollbackJobId?: string
  executionPlanRollbackJobId?: string
  includeVariables?: boolean
  variableNames?: string[]
  includeSource?: boolean
  includeValues?: boolean
  outputNames?: string[]
  includeSensitive?: boolean
  includeMessages?: boolean
  includeAttributes?: boolean
  includeProperties?: boolean
  scope?: string
  kind?: string
  outputMode?: string
  tfPlanFormat?: string
  type?: string[]
  levelGreaterThanOrEqualTo?: string
  timestampGreaterThanOrEqualTo?: string
  timestampLessThanOrEqualTo?: string
  resourceAddresses?: string[]
  resourceDriftStatus?: string[]
  resourceId?: string
  terraformResourceType?: string
  configurationSourceProviderId?: string
  configSourceProviderType?: string
  templateId?: string
  templateCategoryId?: string
}
export interface OciResourceManagerListStacksParams extends OciResourceManagerParams {
  compartmentId: NonNullable<OciResourceManagerParams['compartmentId']>
}
export interface OciResourceManagerGetStackParams extends OciResourceManagerParams {
  stackId: NonNullable<OciResourceManagerParams['stackId']>
}
export interface OciResourceManagerCreateStackParams extends OciResourceManagerParams {
  compartmentId: NonNullable<OciResourceManagerParams['compartmentId']>
  configSource: NonNullable<OciResourceManagerParams['configSource']>
}
export interface OciResourceManagerUpdateStackParams extends OciResourceManagerParams {
  stackId: NonNullable<OciResourceManagerParams['stackId']>
}
export interface OciResourceManagerDeleteStackParams extends OciResourceManagerParams {
  stackId: NonNullable<OciResourceManagerParams['stackId']>
  confirmDelete: NonNullable<OciResourceManagerParams['confirmDelete']>
}
export interface OciResourceManagerChangeStackCompartmentParams extends OciResourceManagerParams {
  stackId: NonNullable<OciResourceManagerParams['stackId']>
  compartmentId: NonNullable<OciResourceManagerParams['compartmentId']>
}
export interface OciResourceManagerListJobsParams extends OciResourceManagerParams {
  stackId: NonNullable<OciResourceManagerParams['stackId']>
}
export interface OciResourceManagerGetJobParams extends OciResourceManagerParams {
  jobId: NonNullable<OciResourceManagerParams['jobId']>
}
export interface OciResourceManagerUpdateJobParams extends OciResourceManagerParams {
  jobId: NonNullable<OciResourceManagerParams['jobId']>
}
export interface OciResourceManagerPlanParams extends OciResourceManagerParams {
  stackId: NonNullable<OciResourceManagerParams['stackId']>
}
export interface OciResourceManagerApplyParams extends OciResourceManagerParams {
  stackId: NonNullable<OciResourceManagerParams['stackId']>
  executionPlanStrategy: NonNullable<OciResourceManagerParams['executionPlanStrategy']>
  confirmApply: NonNullable<OciResourceManagerParams['confirmApply']>
}
export interface OciResourceManagerDestroyParams extends OciResourceManagerParams {
  stackId: NonNullable<OciResourceManagerParams['stackId']>
  confirmDestroy: NonNullable<OciResourceManagerParams['confirmDestroy']>
}
export interface OciResourceManagerImportStateParams extends OciResourceManagerParams {
  stackId: NonNullable<OciResourceManagerParams['stackId']>
  file: NonNullable<OciResourceManagerParams['file']>
  confirmStateReplacement: NonNullable<OciResourceManagerParams['confirmStateReplacement']>
}
export interface OciResourceManagerPlanRollbackParams extends OciResourceManagerParams {
  stackId: NonNullable<OciResourceManagerParams['stackId']>
  targetRollbackJobId: NonNullable<OciResourceManagerParams['targetRollbackJobId']>
}
export interface OciResourceManagerApplyRollbackParams extends OciResourceManagerParams {
  stackId: NonNullable<OciResourceManagerParams['stackId']>
  executionPlanRollbackJobId: NonNullable<OciResourceManagerParams['executionPlanRollbackJobId']>
  confirmApply: NonNullable<OciResourceManagerParams['confirmApply']>
}
export interface OciResourceManagerCancelJobParams extends OciResourceManagerParams {
  jobId: NonNullable<OciResourceManagerParams['jobId']>
}
export interface OciResourceManagerGetJobLogsParams extends OciResourceManagerParams {
  jobId: NonNullable<OciResourceManagerParams['jobId']>
}
export interface OciResourceManagerDownloadJobLogsParams extends OciResourceManagerParams {
  jobId: NonNullable<OciResourceManagerParams['jobId']>
  kind: NonNullable<OciResourceManagerParams['kind']>
}
export interface OciResourceManagerDownloadConfigurationParams extends OciResourceManagerParams {
  scope: NonNullable<OciResourceManagerParams['scope']>
}
export interface OciResourceManagerDownloadStateParams extends OciResourceManagerParams {
  scope: NonNullable<OciResourceManagerParams['scope']>
}
export interface OciResourceManagerDownloadPlanParams extends OciResourceManagerParams {
  jobId: NonNullable<OciResourceManagerParams['jobId']>
}
export interface OciResourceManagerListJobOutputsParams extends OciResourceManagerParams {
  jobId: NonNullable<OciResourceManagerParams['jobId']>
}
export interface OciResourceManagerListAssociatedResourcesParams extends OciResourceManagerParams {
  scope: NonNullable<OciResourceManagerParams['scope']>
}
export interface OciResourceManagerDetectDriftParams extends OciResourceManagerParams {
  stackId: NonNullable<OciResourceManagerParams['stackId']>
}
export interface OciResourceManagerListDriftDetailsParams extends OciResourceManagerParams {
  stackId: NonNullable<OciResourceManagerParams['stackId']>
}
export interface OciResourceManagerListWorkRequestsParams extends OciResourceManagerParams {
  compartmentId: NonNullable<OciResourceManagerParams['compartmentId']>
}
export interface OciResourceManagerGetWorkRequestParams extends OciResourceManagerParams {
  workRequestId: NonNullable<OciResourceManagerParams['workRequestId']>
}
export interface OciResourceManagerListWorkRequestErrorsParams extends OciResourceManagerParams {
  workRequestId: NonNullable<OciResourceManagerParams['workRequestId']>
}
export interface OciResourceManagerGetWorkRequestLogsParams extends OciResourceManagerParams {
  workRequestId: NonNullable<OciResourceManagerParams['workRequestId']>
  kind: NonNullable<OciResourceManagerParams['kind']>
}
export type OciResourceManagerListTerraformVersionsParams = OciResourceManagerParams
export interface OciResourceManagerListConfigurationSourceProvidersParams
  extends OciResourceManagerParams {
  compartmentId: NonNullable<OciResourceManagerParams['compartmentId']>
}
export type OciResourceManagerListTemplatesParams = OciResourceManagerParams
export type OciResourceManagerListResourceDiscoveryServicesParams = OciResourceManagerParams
export interface OciResourceManagerResponse extends ToolResponse {
  output: {
    status: number
    opcRequestId?: string
    etag?: string
    nextPage?: string
    workRequestId?: string
    file?: UserFile
    [key: string]: unknown
  }
}

export const STACK_OUTPUTS = {
  id: { type: 'string', optional: true, nullable: true, description: 'id' },
  compartmentId: { type: 'string', optional: true, nullable: true, description: 'compartmentId' },
  displayName: { type: 'string', optional: true, nullable: true, description: 'displayName' },
  lifecycleState: { type: 'string', optional: true, nullable: true, description: 'lifecycleState' },
  timeCreated: { type: 'string', optional: true, nullable: true, description: 'timeCreated' },
  terraformVersion: {
    type: 'string',
    optional: true,
    nullable: true,
    description: 'terraformVersion',
  },
  stackDriftStatus: {
    type: 'string',
    optional: true,
    nullable: true,
    description: 'stackDriftStatus',
  },
  timeDriftLastChecked: {
    type: 'string',
    optional: true,
    nullable: true,
    description: 'timeDriftLastChecked',
  },
  variables: {
    type: 'json',
    optional: true,
    nullable: true,
    description: 'Explicitly selected variable values; omitted by default',
  },
  configSource: {
    type: 'json',
    optional: true,
    nullable: true,
    description: 'configSource',
    properties: {
      configSourceType: {
        type: 'string',
        optional: true,
        nullable: true,
        description: 'configSourceType',
      },
      workingDirectory: {
        type: 'string',
        optional: true,
        nullable: true,
        description: 'workingDirectory',
      },
      configurationSourceProviderId: {
        type: 'string',
        optional: true,
        nullable: true,
        description: 'configurationSourceProviderId',
      },
      repositoryUrl: {
        type: 'string',
        optional: true,
        nullable: true,
        description: 'repositoryUrl',
      },
      branchName: { type: 'string', optional: true, nullable: true, description: 'branchName' },
      region: { type: 'string', optional: true, nullable: true, description: 'region' },
      namespace: { type: 'string', optional: true, nullable: true, description: 'namespace' },
      bucketName: { type: 'string', optional: true, nullable: true, description: 'bucketName' },
      projectId: { type: 'string', optional: true, nullable: true, description: 'projectId' },
      repositoryId: { type: 'string', optional: true, nullable: true, description: 'repositoryId' },
      workspaceId: { type: 'string', optional: true, nullable: true, description: 'workspaceId' },
      compartmentId: {
        type: 'string',
        optional: true,
        nullable: true,
        description: 'compartmentId',
      },
      servicesToDiscover: {
        type: 'array',
        optional: true,
        nullable: true,
        description: 'servicesToDiscover',
        items: { type: 'string' },
      },
    },
  },
} satisfies Record<string, ToolOutputProperty>
export const JOB_OUTPUTS = {
  id: { type: 'string', optional: true, nullable: true, description: 'id' },
  compartmentId: { type: 'string', optional: true, nullable: true, description: 'compartmentId' },
  stackId: { type: 'string', optional: true, nullable: true, description: 'stackId' },
  displayName: { type: 'string', optional: true, nullable: true, description: 'displayName' },
  lifecycleState: { type: 'string', optional: true, nullable: true, description: 'lifecycleState' },
  operation: { type: 'string', optional: true, nullable: true, description: 'operation' },
  timeCreated: { type: 'string', optional: true, nullable: true, description: 'timeCreated' },
  timeFinished: { type: 'string', optional: true, nullable: true, description: 'timeFinished' },
  variables: {
    type: 'json',
    optional: true,
    nullable: true,
    description: 'Explicitly selected variable values; omitted by default',
  },
  configSource: {
    type: 'json',
    optional: true,
    nullable: true,
    description: 'configSource',
    properties: {
      configSourceRecordType: {
        type: 'string',
        optional: true,
        nullable: true,
        description: 'configSourceRecordType',
      },
      commitId: { type: 'string', optional: true, nullable: true, description: 'commitId' },
    },
  },
  jobOperationDetails: {
    type: 'json',
    optional: true,
    nullable: true,
    description: 'jobOperationDetails',
    properties: {
      operation: { type: 'string', optional: true, nullable: true, description: 'operation' },
      executionPlanStrategy: {
        type: 'string',
        optional: true,
        nullable: true,
        description: 'executionPlanStrategy',
      },
      executionPlanJobId: {
        type: 'string',
        optional: true,
        nullable: true,
        description: 'executionPlanJobId',
      },
      executionPlanRollbackStrategy: {
        type: 'string',
        optional: true,
        nullable: true,
        description: 'executionPlanRollbackStrategy',
      },
      executionPlanRollbackJobId: {
        type: 'string',
        optional: true,
        nullable: true,
        description: 'executionPlanRollbackJobId',
      },
      targetRollbackJobId: {
        type: 'string',
        optional: true,
        nullable: true,
        description: 'targetRollbackJobId',
      },
    },
  },
  cancellationDetails: {
    type: 'json',
    optional: true,
    nullable: true,
    description: 'cancellationDetails',
    properties: {
      isForced: { type: 'boolean', optional: true, nullable: true, description: 'isForced' },
    },
  },
  failureDetails: {
    type: 'json',
    optional: true,
    nullable: true,
    description: 'failureDetails',
    properties: { code: { type: 'string', optional: true, nullable: true, description: 'code' } },
  },
} satisfies Record<string, ToolOutputProperty>
export const WORKREQUEST_OUTPUTS = {
  id: { type: 'string', optional: true, nullable: true, description: 'id' },
  compartmentId: { type: 'string', optional: true, nullable: true, description: 'compartmentId' },
  operationType: { type: 'string', optional: true, nullable: true, description: 'operationType' },
  status: { type: 'string', optional: true, nullable: true, description: 'status' },
  percentComplete: {
    type: 'number',
    optional: true,
    nullable: true,
    description: 'percentComplete',
  },
  timeAccepted: { type: 'string', optional: true, nullable: true, description: 'timeAccepted' },
  timeStarted: { type: 'string', optional: true, nullable: true, description: 'timeStarted' },
  timeFinished: { type: 'string', optional: true, nullable: true, description: 'timeFinished' },
  resources: {
    type: 'array',
    optional: true,
    nullable: true,
    description: 'resources',
    items: {
      type: 'object',
      properties: {
        actionType: { type: 'string', optional: true, nullable: true, description: 'actionType' },
        entityType: { type: 'string', optional: true, nullable: true, description: 'entityType' },
        identifier: { type: 'string', optional: true, nullable: true, description: 'identifier' },
        entityUri: { type: 'string', optional: true, nullable: true, description: 'entityUri' },
      },
    },
  },
} satisfies Record<string, ToolOutputProperty>
export const LOGS_OUTPUTS = {
  type: { type: 'string', optional: true, nullable: true, description: 'type' },
  level: { type: 'string', optional: true, nullable: true, description: 'level' },
  timestamp: { type: 'string', optional: true, nullable: true, description: 'timestamp' },
  message: { type: 'string', optional: true, nullable: true, description: 'message' },
} satisfies Record<string, ToolOutputProperty>
export const OUTPUTS_OUTPUTS = {
  outputName: { type: 'string', optional: true, nullable: true, description: 'outputName' },
  outputType: { type: 'string', optional: true, nullable: true, description: 'outputType' },
  isSensitive: { type: 'boolean', optional: true, nullable: true, description: 'isSensitive' },
  outputValue: {
    type: 'string',
    optional: true,
    nullable: true,
    description: 'Explicitly selected output value, preserved as a string',
  },
} satisfies Record<string, ToolOutputProperty>
export const RESOURCES_OUTPUTS = {
  resourceId: { type: 'string', optional: true, nullable: true, description: 'resourceId' },
  resourceName: { type: 'string', optional: true, nullable: true, description: 'resourceName' },
  resourceType: { type: 'string', optional: true, nullable: true, description: 'resourceType' },
  resourceAddress: {
    type: 'string',
    optional: true,
    nullable: true,
    description: 'resourceAddress',
  },
  region: { type: 'string', optional: true, nullable: true, description: 'region' },
  timeCreated: { type: 'string', optional: true, nullable: true, description: 'timeCreated' },
  attributes: {
    type: 'json',
    optional: true,
    nullable: true,
    description: 'Resource attribute string map; omitted by default',
  },
} satisfies Record<string, ToolOutputProperty>
export const DRIFTDETAILS_OUTPUTS = {
  stackId: { type: 'string', optional: true, nullable: true, description: 'stackId' },
  compartmentId: { type: 'string', optional: true, nullable: true, description: 'compartmentId' },
  resourceId: { type: 'string', optional: true, nullable: true, description: 'resourceId' },
  resourceName: { type: 'string', optional: true, nullable: true, description: 'resourceName' },
  resourceType: { type: 'string', optional: true, nullable: true, description: 'resourceType' },
  resourceDriftStatus: {
    type: 'string',
    optional: true,
    nullable: true,
    description: 'resourceDriftStatus',
  },
  timeDriftChecked: {
    type: 'string',
    optional: true,
    nullable: true,
    description: 'timeDriftChecked',
  },
  actualProperties: {
    type: 'json',
    optional: true,
    nullable: true,
    description: 'Actual property string map; omitted by default',
  },
  expectedProperties: {
    type: 'json',
    optional: true,
    nullable: true,
    description: 'Expected property string map; omitted by default',
  },
} satisfies Record<string, ToolOutputProperty>
export const PROVIDERS_OUTPUTS = {
  id: { type: 'string', optional: true, nullable: true, description: 'id' },
  compartmentId: { type: 'string', optional: true, nullable: true, description: 'compartmentId' },
  displayName: { type: 'string', optional: true, nullable: true, description: 'displayName' },
  lifecycleState: { type: 'string', optional: true, nullable: true, description: 'lifecycleState' },
  timeCreated: { type: 'string', optional: true, nullable: true, description: 'timeCreated' },
  configSourceProviderType: {
    type: 'string',
    optional: true,
    nullable: true,
    description: 'configSourceProviderType',
  },
} satisfies Record<string, ToolOutputProperty>
export const TEMPLATES_OUTPUTS = {
  id: { type: 'string', optional: true, nullable: true, description: 'id' },
  compartmentId: { type: 'string', optional: true, nullable: true, description: 'compartmentId' },
  displayName: { type: 'string', optional: true, nullable: true, description: 'displayName' },
  lifecycleState: { type: 'string', optional: true, nullable: true, description: 'lifecycleState' },
  timeCreated: { type: 'string', optional: true, nullable: true, description: 'timeCreated' },
  isFreeTier: { type: 'boolean', optional: true, nullable: true, description: 'isFreeTier' },
} satisfies Record<string, ToolOutputProperty>
export const VERSIONS_OUTPUTS = {
  name: { type: 'string', optional: true, nullable: true, description: 'name' },
  isDefault: { type: 'boolean', optional: true, nullable: true, description: 'isDefault' },
} satisfies Record<string, ToolOutputProperty>
export const SERVICES_OUTPUTS = {
  name: { type: 'string', optional: true, nullable: true, description: 'name' },
  discoveryScope: { type: 'string', optional: true, nullable: true, description: 'discoveryScope' },
} satisfies Record<string, ToolOutputProperty>
export const METADATA_OUTPUTS = {
  status: { type: 'number', description: 'Oracle HTTP status' },
  opcRequestId: { type: 'string', optional: true, description: 'Oracle request ID' },
  etag: { type: 'string', optional: true, description: 'Resource ETag' },
  nextPage: { type: 'string', optional: true, description: 'Next page token, absent at the end' },
  workRequestId: {
    type: 'string',
    optional: true,
    description: 'Asynchronous work-request ID when returned',
  },
} satisfies Record<string, ToolOutputProperty>

export const ERROR_OUTPUTS = {
  timestamp: { type: 'string', optional: true, nullable: true, description: 'timestamp' },
  message: { type: 'string', optional: true, nullable: true, description: 'message' },
  code: { type: 'string', optional: true, nullable: true, description: 'code' },
} satisfies Record<string, ToolOutputProperty>
