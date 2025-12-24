// Common types for Grafana API tools
import type { ToolResponse } from '@/tools/types'

// Common parameters for all Grafana tools
export interface GrafanaBaseParams {
  apiKey: string
  baseUrl: string
  organizationId?: string
}

// Health Check types
export interface GrafanaHealthCheckParams extends GrafanaBaseParams {}

export interface GrafanaHealthCheckResponse extends ToolResponse {
  output: {
    commit: string
    database: string
    version: string
  }
}

export interface GrafanaDataSourceHealthParams extends GrafanaBaseParams {
  dataSourceId: string
}

export interface GrafanaDataSourceHealthResponse extends ToolResponse {
  output: {
    status: string
    message: string
  }
}

// Dashboard types
export interface GrafanaGetDashboardParams extends GrafanaBaseParams {
  dashboardUid: string
}

export interface GrafanaDashboardMeta {
  type: string
  canSave: boolean
  canEdit: boolean
  canAdmin: boolean
  canStar: boolean
  canDelete: boolean
  slug: string
  url: string
  expires: string
  created: string
  updated: string
  updatedBy: string
  createdBy: string
  version: number
  hasAcl: boolean
  isFolder: boolean
  folderId: number
  folderUid: string
  folderTitle: string
  folderUrl: string
  provisioned: boolean
  provisionedExternalId: string
}

export interface GrafanaDashboard {
  id: number
  uid: string
  title: string
  tags: string[]
  timezone: string
  schemaVersion: number
  version: number
  refresh: string
  panels: any[]
  templating: any
  annotations: any
  time: {
    from: string
    to: string
  }
}

export interface GrafanaGetDashboardResponse extends ToolResponse {
  output: {
    dashboard: GrafanaDashboard
    meta: GrafanaDashboardMeta
  }
}

export interface GrafanaListDashboardsParams extends GrafanaBaseParams {
  query?: string
  tag?: string
  folderIds?: string
  starred?: boolean
  limit?: number
}

export interface GrafanaDashboardSearchResult {
  id: number
  uid: string
  title: string
  uri: string
  url: string
  slug: string
  type: string
  tags: string[]
  isStarred: boolean
  folderId: number
  folderUid: string
  folderTitle: string
  folderUrl: string
  sortMeta: number
}

export interface GrafanaListDashboardsResponse extends ToolResponse {
  output: {
    dashboards: GrafanaDashboardSearchResult[]
  }
}

export interface GrafanaCreateDashboardParams extends GrafanaBaseParams {
  title: string
  folderUid?: string
  tags?: string
  timezone?: string
  refresh?: string
  panels?: string // JSON string of panels array
  overwrite?: boolean
  message?: string
}

export interface GrafanaCreateDashboardResponse extends ToolResponse {
  output: {
    id: number
    uid: string
    url: string
    status: string
    version: number
    slug: string
  }
}

export interface GrafanaUpdateDashboardParams extends GrafanaBaseParams {
  dashboardUid: string
  title?: string
  folderUid?: string
  tags?: string
  timezone?: string
  refresh?: string
  panels?: string // JSON string of panels array
  overwrite?: boolean
  message?: string
}

export interface GrafanaUpdateDashboardResponse extends ToolResponse {
  output: {
    id: number
    uid: string
    url: string
    status: string
    version: number
    slug: string
  }
}

export interface GrafanaDeleteDashboardParams extends GrafanaBaseParams {
  dashboardUid: string
}

export interface GrafanaDeleteDashboardResponse extends ToolResponse {
  output: {
    title: string
    message: string
    id: number
  }
}

// Alert Rule types
export interface GrafanaListAlertRulesParams extends GrafanaBaseParams {}

export interface GrafanaAlertRule {
  uid: string
  title: string
  condition: string
  data: any[]
  updated: string
  noDataState: string
  execErrState: string
  for: string
  annotations: Record<string, string>
  labels: Record<string, string>
  isPaused: boolean
  folderUID: string
  ruleGroup: string
  orgId: number
  namespace_uid: string
  namespace_id: number
  provenance: string
}

export interface GrafanaListAlertRulesResponse extends ToolResponse {
  output: {
    rules: GrafanaAlertRule[]
  }
}

export interface GrafanaGetAlertRuleParams extends GrafanaBaseParams {
  alertRuleUid: string
}

export interface GrafanaGetAlertRuleResponse extends ToolResponse {
  output: GrafanaAlertRule
}

export interface GrafanaCreateAlertRuleParams extends GrafanaBaseParams {
  title: string
  folderUid: string
  ruleGroup: string
  condition: string
  data: string // JSON string of data array
  forDuration?: string
  noDataState?: string
  execErrState?: string
  annotations?: string // JSON string
  labels?: string // JSON string
}

export interface GrafanaCreateAlertRuleResponse extends ToolResponse {
  output: GrafanaAlertRule
}

export interface GrafanaUpdateAlertRuleParams extends GrafanaBaseParams {
  alertRuleUid: string
  title?: string
  folderUid?: string
  ruleGroup?: string
  condition?: string
  data?: string // JSON string of data array
  forDuration?: string
  noDataState?: string
  execErrState?: string
  annotations?: string // JSON string
  labels?: string // JSON string
}

export interface GrafanaUpdateAlertRuleResponse extends ToolResponse {
  output: GrafanaAlertRule
}

export interface GrafanaDeleteAlertRuleParams extends GrafanaBaseParams {
  alertRuleUid: string
}

export interface GrafanaDeleteAlertRuleResponse extends ToolResponse {
  output: {
    message: string
  }
}

// Annotation types
export interface GrafanaCreateAnnotationParams extends GrafanaBaseParams {
  text: string
  tags?: string // comma-separated
  dashboardUid?: string
  panelId?: number
  time?: number // epoch ms
  timeEnd?: number // epoch ms
}

export interface GrafanaAnnotation {
  id: number
  dashboardId: number
  dashboardUID: string
  created: number
  updated: number
  time: number
  timeEnd: number
  text: string
  tags: string[]
  login: string
  email: string
  avatarUrl: string
  data: any
}

export interface GrafanaCreateAnnotationResponse extends ToolResponse {
  output: {
    id: number
    message: string
  }
}

export interface GrafanaListAnnotationsParams extends GrafanaBaseParams {
  from?: number
  to?: number
  dashboardUid?: string
  panelId?: number
  tags?: string // comma-separated
  type?: string
  limit?: number
}

export interface GrafanaListAnnotationsResponse extends ToolResponse {
  output: {
    annotations: GrafanaAnnotation[]
  }
}

export interface GrafanaUpdateAnnotationParams extends GrafanaBaseParams {
  annotationId: number
  text: string
  tags?: string // comma-separated
  time?: number
  timeEnd?: number
}

export interface GrafanaUpdateAnnotationResponse extends ToolResponse {
  output: {
    id: number
    message: string
  }
}

export interface GrafanaDeleteAnnotationParams extends GrafanaBaseParams {
  annotationId: number
}

export interface GrafanaDeleteAnnotationResponse extends ToolResponse {
  output: {
    message: string
  }
}

// Data Source types
export interface GrafanaListDataSourcesParams extends GrafanaBaseParams {}

export interface GrafanaDataSource {
  id: number
  uid: string
  orgId: number
  name: string
  type: string
  typeName: string
  typeLogoUrl: string
  access: string
  url: string
  user: string
  database: string
  basicAuth: boolean
  isDefault: boolean
  jsonData: any
  readOnly: boolean
}

export interface GrafanaListDataSourcesResponse extends ToolResponse {
  output: {
    dataSources: GrafanaDataSource[]
  }
}

export interface GrafanaGetDataSourceParams extends GrafanaBaseParams {
  dataSourceId: string
}

export interface GrafanaGetDataSourceResponse extends ToolResponse {
  output: GrafanaDataSource
}

// Folder types
export interface GrafanaListFoldersParams extends GrafanaBaseParams {
  limit?: number
  page?: number
}

export interface GrafanaFolder {
  id: number
  uid: string
  title: string
  hasAcl: boolean
  canSave: boolean
  canEdit: boolean
  canAdmin: boolean
  canDelete: boolean
  createdBy: string
  created: string
  updatedBy: string
  updated: string
  version: number
}

export interface GrafanaListFoldersResponse extends ToolResponse {
  output: {
    folders: GrafanaFolder[]
  }
}

export interface GrafanaCreateFolderParams extends GrafanaBaseParams {
  title: string
  uid?: string
}

export interface GrafanaCreateFolderResponse extends ToolResponse {
  output: GrafanaFolder
}

// Contact Points types
export interface GrafanaListContactPointsParams extends GrafanaBaseParams {}

export interface GrafanaContactPoint {
  uid: string
  name: string
  type: string
  settings: Record<string, any>
  disableResolveMessage: boolean
  provenance: string
}

export interface GrafanaListContactPointsResponse extends ToolResponse {
  output: {
    contactPoints: GrafanaContactPoint[]
  }
}

// Union type for all Grafana responses
export type GrafanaResponse =
  | GrafanaHealthCheckResponse
  | GrafanaDataSourceHealthResponse
  | GrafanaGetDashboardResponse
  | GrafanaListDashboardsResponse
  | GrafanaCreateDashboardResponse
  | GrafanaUpdateDashboardResponse
  | GrafanaDeleteDashboardResponse
  | GrafanaListAlertRulesResponse
  | GrafanaGetAlertRuleResponse
  | GrafanaCreateAlertRuleResponse
  | GrafanaUpdateAlertRuleResponse
  | GrafanaDeleteAlertRuleResponse
  | GrafanaCreateAnnotationResponse
  | GrafanaListAnnotationsResponse
  | GrafanaUpdateAnnotationResponse
  | GrafanaDeleteAnnotationResponse
  | GrafanaListDataSourcesResponse
  | GrafanaGetDataSourceResponse
  | GrafanaListFoldersResponse
  | GrafanaCreateFolderResponse
  | GrafanaListContactPointsResponse
