import { z } from 'zod'

export const grafanaUpdateDashboardInputSchema = z.object({
  apiKey: z.string().min(1, 'Grafana Service Account Token is required'),
  baseUrl: z.string().min(1, 'Grafana instance URL is required'),
  organizationId: z.string().optional(),
  dashboardUid: z.string().min(1, 'Dashboard UID is required'),
  title: z.string().optional(),
  folderUid: z.string().optional(),
  tags: z.string().optional(),
  timezone: z.string().optional(),
  refresh: z.string().optional(),
  panels: z.string().optional(),
  overwrite: z.boolean().optional(),
  message: z.string().optional(),
})

export const grafanaUpdateAlertRuleInputSchema = z.object({
  apiKey: z.string().min(1, 'Grafana Service Account Token is required'),
  baseUrl: z.string().min(1, 'Grafana instance URL is required'),
  organizationId: z.string().optional(),
  alertRuleUid: z.string().min(1, 'Alert rule UID is required'),
  title: z.string().optional(),
  folderUid: z.string().optional(),
  ruleGroup: z.string().optional(),
  condition: z.string().optional(),
  data: z.string().optional(),
  forDuration: z.string().optional(),
  noDataState: z.string().optional(),
  execErrState: z.string().optional(),
  annotations: z.string().optional(),
  labels: z.string().optional(),
  isPaused: z.boolean().optional(),
  keepFiringFor: z.string().optional(),
  missingSeriesEvalsToResolve: z.number().optional(),
  notificationSettings: z.string().optional(),
  record: z.string().optional(),
  disableProvenance: z.boolean().optional(),
})

export const grafanaUpdateFolderInputSchema = z.object({
  apiKey: z.string().min(1, 'Grafana Service Account Token is required'),
  baseUrl: z.string().min(1, 'Grafana instance URL is required'),
  organizationId: z.string().optional(),
  folderUid: z.string().min(1, 'Folder UID is required'),
  title: z.string().min(1, 'Folder title is required'),
})

export const grafanaCheckDataSourceHealthInputSchema = z.object({
  apiKey: z.string().min(1, 'Grafana Service Account Token is required'),
  baseUrl: z.string().min(1, 'Grafana instance URL is required'),
  organizationId: z.string().optional(),
  dataSourceUid: z.string().min(1, 'Data source UID is required').max(40, 'UID is too long'),
})

export type GrafanaUpdateDashboardInput = z.input<typeof grafanaUpdateDashboardInputSchema>
export type GrafanaUpdateAlertRuleInput = z.input<typeof grafanaUpdateAlertRuleInputSchema>
export type GrafanaUpdateFolderInput = z.input<typeof grafanaUpdateFolderInputSchema>
export type GrafanaCheckDataSourceHealthInput = z.input<
  typeof grafanaCheckDataSourceHealthInputSchema
>
