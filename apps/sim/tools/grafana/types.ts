// Common types for Grafana API tools
import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Canonical output schema fields shared across alert rule tools.
 */
export const ALERT_RULE_OUTPUT_FIELDS: Record<string, OutputProperty> = {
  id: { type: 'number', description: 'Alert rule numeric ID', optional: true },
  uid: { type: 'string', description: 'Alert rule UID' },
  title: { type: 'string', description: 'Alert rule title' },
  condition: { type: 'string', description: 'RefId of the query used as the alert condition' },
  data: { type: 'json', description: 'Alert rule query/expression data array' },
  updated: { type: 'string', description: 'Last update timestamp', optional: true },
  noDataState: { type: 'string', description: 'State when no data is returned' },
  execErrState: { type: 'string', description: 'State on execution error' },
  for: { type: 'string', description: 'Duration the condition must hold before firing' },
  keepFiringFor: {
    type: 'string',
    description: 'Duration to keep firing after condition stops',
    optional: true,
  },
  missingSeriesEvalsToResolve: {
    type: 'number',
    description: 'Number of missing series evaluations before resolving',
    optional: true,
  },
  annotations: { type: 'json', description: 'Alert annotations' },
  labels: { type: 'json', description: 'Alert labels' },
  isPaused: { type: 'boolean', description: 'Whether the rule is paused' },
  folderUID: { type: 'string', description: 'Parent folder UID' },
  ruleGroup: { type: 'string', description: 'Rule group name' },
  orgID: { type: 'number', description: 'Organization ID' },
  provenance: { type: 'string', description: 'Provisioning source (empty if API-managed)' },
  notification_settings: {
    type: 'json',
    description: 'Per-rule notification settings (overrides)',
    optional: true,
  },
  record: {
    type: 'json',
    description: 'Recording rule configuration (recording rules only)',
    optional: true,
  },
}

// Common parameters for all Grafana tools
interface GrafanaBaseParams {
  apiKey: string
  baseUrl: string
  organizationId?: string
}

// Health Check types
interface GrafanaHealthCheckParams extends GrafanaBaseParams {}

interface GrafanaHealthCheckResponse extends ToolResponse {
  output: {
    commit: string
    database: string
    version: string
  }
}

interface GrafanaDataSourceHealthParams extends GrafanaBaseParams {
  dataSourceId: string
}

interface GrafanaDataSourceHealthResponse extends ToolResponse {
  output: {
    status: string
    message: string
  }
}

// Dashboard types
export interface GrafanaGetDashboardParams extends GrafanaBaseParams {
  dashboardUid: string
}

interface GrafanaDashboardMeta {
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

interface GrafanaDashboard {
  id: number
  uid: string
  title: string
  tags: string[]
  timezone: string
  schemaVersion: number
  version: number
  refresh: string
  panels: Record<string, unknown>[]
  templating: Record<string, unknown>
  annotations: Record<string, unknown>
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
  folderUIDs?: string
  dashboardUIDs?: string
  starred?: boolean
  limit?: number
  page?: number
}

interface GrafanaDashboardSearchResult {
  id: number | null
  uid: string | null
  title: string | null
  uri: string | null
  url: string | null
  type: string | null
  tags: string[]
  isStarred: boolean
  folderId: number | null
  folderUid: string | null
  folderTitle: string | null
  folderUrl: string | null
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

interface GrafanaUpdateDashboardResponse extends ToolResponse {
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

interface GrafanaAlertRule {
  id: number | null
  uid: string | null
  title: string | null
  condition: string | null
  data: unknown[]
  updated: string | null
  noDataState: string | null
  execErrState: string | null
  for: string | null
  keepFiringFor: string | null
  missingSeriesEvalsToResolve: number | null
  annotations: Record<string, string>
  labels: Record<string, string>
  isPaused: boolean
  folderUID: string | null
  ruleGroup: string | null
  orgID: number | null
  provenance: string
  notification_settings: Record<string, unknown> | null
  record: Record<string, unknown> | null
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
  condition?: string
  data: string // JSON string of data array
  forDuration?: string
  noDataState?: string
  execErrState?: string
  annotations?: string // JSON string
  labels?: string // JSON string
  uid?: string
  isPaused?: boolean
  keepFiringFor?: string
  missingSeriesEvalsToResolve?: number
  notificationSettings?: string // JSON string
  record?: string // JSON string
  disableProvenance?: boolean
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
  isPaused?: boolean
  keepFiringFor?: string
  missingSeriesEvalsToResolve?: number
  notificationSettings?: string // JSON string
  record?: string // JSON string
  disableProvenance?: boolean
}

interface GrafanaUpdateAlertRuleResponse extends ToolResponse {
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

interface GrafanaAnnotation {
  id: number | null
  alertId: number | null
  dashboardId: number | null
  dashboardUID: string | null
  panelId: number | null
  userId: number | null
  userName: string | null
  newState: string | null
  prevState: string | null
  time: number | null
  timeEnd: number | null
  text: string | null
  metric: string | null
  tags: string[]
  data: Record<string, unknown>
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
  dashboardId?: number
  dashboardUid?: string
  panelId?: number
  alertId?: number
  userId?: number
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
  text?: string
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

interface GrafanaDataSource {
  id: number
  uid: string
  orgId: number
  name: string
  type: string
  typeLogoUrl: string
  access: string
  url: string
  user: string
  database: string
  basicAuth: boolean
  basicAuthUser?: string
  withCredentials?: boolean
  isDefault: boolean
  jsonData: Record<string, unknown>
  secureJsonFields?: Record<string, boolean>
  version?: number
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
  parentUid?: string
}

interface GrafanaFolderParent {
  uid: string
  title: string
  url: string
}

interface GrafanaFolder {
  id: number
  uid: string
  title: string
  url?: string
  hasAcl?: boolean
  canSave?: boolean
  canEdit?: boolean
  canAdmin?: boolean
  createdBy?: string
  created?: string
  updatedBy?: string
  updated?: string
  version?: number
  parentUid?: string | null
  parents?: GrafanaFolderParent[]
}

export interface GrafanaListFoldersResponse extends ToolResponse {
  output: {
    folders: GrafanaFolder[]
  }
}

export interface GrafanaCreateFolderParams extends GrafanaBaseParams {
  title: string
  uid?: string
  parentUid?: string
}

export interface GrafanaCreateFolderResponse extends ToolResponse {
  output: GrafanaFolder
}

// Contact Points types
export interface GrafanaListContactPointsParams extends GrafanaBaseParams {
  name?: string
}

interface GrafanaContactPoint {
  uid: string
  name: string
  type: string
  settings: Record<string, unknown>
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
