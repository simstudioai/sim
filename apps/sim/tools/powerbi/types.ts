import type { OutputProperty, ToolResponse } from '@/tools/types'

interface PowerBIAuthParams {
  accessToken: string
}

export interface PowerBIGroupParams extends PowerBIAuthParams {
  groupId: string
}

export interface PowerBIDatasetParams extends PowerBIGroupParams {
  datasetId: string
}

export interface PowerBIListWorkspacesParams extends PowerBIAuthParams {
  top?: number
  skip?: number
  filter?: string
}

export interface PowerBIGetReportParams extends PowerBIGroupParams {
  reportId: string
}

export interface PowerBIExecuteQueryParams extends PowerBIDatasetParams {
  query: string
  includeNulls?: boolean
}

type PowerBINotifyOption = 'NoNotification' | 'MailOnFailure' | 'MailOnCompletion'

export interface PowerBIRefreshDatasetParams extends PowerBIDatasetParams {
  notifyOption?: PowerBINotifyOption
}

export interface PowerBIGetRefreshHistoryParams extends PowerBIDatasetParams {
  top?: number
}

export interface PowerBIWorkspace {
  id: string
  name: string
  isReadOnly: boolean | null
  isOnDedicatedCapacity: boolean | null
  capacityId: string | null
  defaultDatasetStorageFormat: string | null
}

export interface PowerBIReport {
  id: string
  name: string
  datasetId: string | null
  reportType: string | null
  webUrl: string | null
  embedUrl: string | null
  description: string | null
}

export interface PowerBIDataset {
  id: string
  name: string
  createdDate: string | null
  description: string | null
  targetStorageMode: string | null
  configuredBy: string | null
  isRefreshable: boolean | null
  isEffectiveIdentityRequired: boolean | null
  isEffectiveIdentityRolesRequired: boolean | null
  isOnPremGatewayRequired: boolean | null
  addRowsAPIEnabled: boolean | null
  webUrl: string | null
}

interface PowerBIRefreshAttempt {
  attemptId: number | null
  type: string | null
  startTime: string | null
  endTime: string | null
  serviceExceptionJson: string | null
}

export interface PowerBIRefresh {
  requestId: string | null
  refreshType: string | null
  status: string | null
  startTime: string | null
  endTime: string | null
  serviceExceptionJson: string | null
  refreshAttempts: PowerBIRefreshAttempt[]
}

export interface PowerBIQueryError {
  scope: 'response' | 'query' | 'table'
  code: string | null
  message: string | null
  details: unknown | null
}

interface PowerBIInformationProtectionLabel {
  id: string | null
  name: string | null
}

export interface PowerBIListWorkspacesResponse extends ToolResponse {
  output: { workspaces: PowerBIWorkspace[]; workspaceCount: number }
}

export interface PowerBIListReportsResponse extends ToolResponse {
  output: { reports: PowerBIReport[]; reportCount: number }
}

export interface PowerBIGetReportResponse extends ToolResponse {
  output: { report: PowerBIReport }
}

export interface PowerBIListDatasetsResponse extends ToolResponse {
  output: { datasets: PowerBIDataset[]; datasetCount: number }
}

export interface PowerBIGetDatasetResponse extends ToolResponse {
  output: { dataset: PowerBIDataset }
}

export interface PowerBIExecuteQueryResponse extends ToolResponse {
  output: {
    rows: Record<string, unknown>[]
    rowCount: number
    errors: PowerBIQueryError[]
    incomplete: boolean
    informationProtectionLabel: PowerBIInformationProtectionLabel | null
  }
}

export interface PowerBIRefreshDatasetResponse extends ToolResponse {
  output: { accepted: boolean; requestId: string | null; location: string | null }
}

export interface PowerBIGetRefreshHistoryResponse extends ToolResponse {
  output: { refreshes: PowerBIRefresh[]; refreshCount: number }
}

const nullableString = { type: 'string', nullable: true } as const
const nullableBoolean = { type: 'boolean', nullable: true } as const

export const POWERBI_WORKSPACE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Workspace ID' },
  name: { type: 'string', description: 'Workspace name' },
  isReadOnly: { ...nullableBoolean, description: 'Whether the workspace is read-only' },
  isOnDedicatedCapacity: {
    ...nullableBoolean,
    description: 'Whether dedicated capacity is assigned',
  },
  capacityId: { ...nullableString, description: 'Assigned capacity ID, when available' },
  defaultDatasetStorageFormat: {
    ...nullableString,
    description: 'Default semantic model storage format',
  },
} satisfies Record<string, OutputProperty>

export const POWERBI_REPORT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Report ID' },
  name: { type: 'string', description: 'Report name' },
  datasetId: {
    ...nullableString,
    description: 'Semantic model ID; unavailable for paginated reports',
  },
  reportType: { ...nullableString, description: 'Provider report type' },
  webUrl: { ...nullableString, description: 'Report URL in Power BI' },
  embedUrl: { ...nullableString, description: 'Report embed URL' },
  description: { ...nullableString, description: 'Report description, when available' },
} satisfies Record<string, OutputProperty>

export const POWERBI_DATASET_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Semantic model ID' },
  name: { type: 'string', description: 'Semantic model name' },
  createdDate: {
    ...nullableString,
    description: 'Semantic model creation timestamp, when available',
  },
  description: { ...nullableString, description: 'Semantic model description, when available' },
  targetStorageMode: {
    ...nullableString,
    description: 'Semantic model storage mode, when available',
  },
  configuredBy: { ...nullableString, description: 'Semantic model owner, when available' },
  isRefreshable: {
    ...nullableBoolean,
    description: 'Provider Import-mode refresh indicator, when available',
  },
  isEffectiveIdentityRequired: {
    ...nullableBoolean,
    description: 'Whether an effective identity is required for embedding',
  },
  isEffectiveIdentityRolesRequired: {
    ...nullableBoolean,
    description: 'Whether effective identity roles are required',
  },
  isOnPremGatewayRequired: {
    ...nullableBoolean,
    description: 'Whether an on-premises gateway is required',
  },
  addRowsAPIEnabled: {
    ...nullableBoolean,
    description: 'Whether adding rows through the API is enabled',
  },
  webUrl: { ...nullableString, description: 'Semantic model URL in Power BI, when available' },
} satisfies Record<string, OutputProperty>

export const POWERBI_REFRESH_OUTPUT_PROPERTIES = {
  requestId: { ...nullableString, description: 'Provider refresh request ID' },
  refreshType: { ...nullableString, description: 'Provider refresh trigger type' },
  status: {
    ...nullableString,
    description: 'Provider status; Unknown can mean unknown or in progress',
  },
  startTime: { ...nullableString, description: 'Refresh start timestamp in UTC' },
  endTime: { ...nullableString, description: 'Refresh end timestamp in UTC, when available' },
  serviceExceptionJson: {
    ...nullableString,
    description: 'Serialized provider failure details, when available',
  },
  refreshAttempts: {
    type: 'array',
    description: 'Refresh attempts supplied by the provider',
    items: {
      type: 'object',
      properties: {
        attemptId: {
          type: 'number',
          nullable: true,
          description: 'Refresh attempt index',
        },
        type: { ...nullableString, description: 'Provider refresh attempt type' },
        startTime: { ...nullableString, description: 'Attempt start timestamp' },
        endTime: { ...nullableString, description: 'Attempt end timestamp, when available' },
        serviceExceptionJson: {
          ...nullableString,
          description: 'Serialized provider failure details, when available',
        },
      },
    },
  },
} satisfies Record<string, OutputProperty>

export const POWERBI_QUERY_ERROR_OUTPUT_PROPERTIES = {
  scope: { type: 'string', description: 'Error scope: response, query, or table' },
  code: { ...nullableString, description: 'Provider error code' },
  message: { ...nullableString, description: 'Direct provider error message, when supplied' },
  details: {
    type: 'json',
    nullable: true,
    description: 'Dynamic nested provider error details, when supplied',
  },
} satisfies Record<string, OutputProperty>

export const POWERBI_INFORMATION_PROTECTION_LABEL_OUTPUT_PROPERTIES = {
  id: { ...nullableString, description: 'Information protection label ID' },
  name: { ...nullableString, description: 'Information protection label name' },
} satisfies Record<string, OutputProperty>
