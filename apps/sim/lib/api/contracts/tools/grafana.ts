import { z } from 'zod'
import type { ContractBody, ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const grafanaUpdateDashboardBodySchema = z.object({
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

const grafanaUpdateDashboardOutputSchema = z.object({
  id: z.number().optional(),
  uid: z.string().optional(),
  url: z.string().optional(),
  status: z.string().optional(),
  version: z.number().optional(),
  slug: z.string().optional(),
})

export const grafanaUpdateDashboardResponseSchema = z.object({
  success: z.boolean(),
  output: grafanaUpdateDashboardOutputSchema,
  error: z.string().optional(),
})

const grafanaUpdateAlertRuleBodySchema = z.object({
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

const grafanaUpdateAlertRuleOutputSchema = z.object({
  id: z.number().nullable(),
  uid: z.string().nullable(),
  title: z.string().nullable(),
  condition: z.string().nullable(),
  data: z.array(z.unknown()),
  updated: z.string().nullable(),
  noDataState: z.string().nullable(),
  execErrState: z.string().nullable(),
  for: z.string().nullable(),
  keepFiringFor: z.string().nullable(),
  missingSeriesEvalsToResolve: z.number().nullable(),
  annotations: z.record(z.string(), z.string()),
  labels: z.record(z.string(), z.string()),
  isPaused: z.boolean(),
  folderUID: z.string().nullable(),
  ruleGroup: z.string().nullable(),
  orgID: z.number().nullable(),
  provenance: z.string(),
  notification_settings: z.record(z.string(), z.unknown()).nullable(),
  record: z.record(z.string(), z.unknown()).nullable(),
})

export const grafanaUpdateAlertRuleResponseSchema = z.object({
  success: z.boolean(),
  output: z.union([grafanaUpdateAlertRuleOutputSchema, z.object({})]),
  error: z.string().optional(),
})

const grafanaUpdateFolderBodySchema = z.object({
  apiKey: z.string().min(1, 'Grafana Service Account Token is required'),
  baseUrl: z.string().min(1, 'Grafana instance URL is required'),
  organizationId: z.string().optional(),
  folderUid: z.string().min(1, 'Folder UID is required'),
  title: z.string().min(1, 'Folder title is required'),
})

const grafanaUpdateFolderOutputSchema = z.object({
  id: z.number().nullable(),
  uid: z.string().nullable(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  parentUid: z.string().nullable(),
  parents: z.array(z.object({ uid: z.string(), title: z.string(), url: z.string() })),
  hasAcl: z.boolean().nullable(),
  canSave: z.boolean().nullable(),
  canEdit: z.boolean().nullable(),
  canAdmin: z.boolean().nullable(),
  createdBy: z.string().nullable(),
  created: z.string().nullable(),
  updatedBy: z.string().nullable(),
  updated: z.string().nullable(),
  version: z.number().nullable(),
})

export const grafanaUpdateFolderResponseSchema = z.object({
  success: z.boolean(),
  output: z.union([grafanaUpdateFolderOutputSchema, z.object({})]),
  error: z.string().optional(),
})

export const grafanaUpdateDashboardContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/grafana/update_dashboard',
  body: grafanaUpdateDashboardBodySchema,
  response: { mode: 'json', schema: grafanaUpdateDashboardResponseSchema },
})

export const grafanaUpdateAlertRuleContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/grafana/update_alert_rule',
  body: grafanaUpdateAlertRuleBodySchema,
  response: { mode: 'json', schema: grafanaUpdateAlertRuleResponseSchema },
})

export const grafanaUpdateFolderContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/grafana/update_folder',
  body: grafanaUpdateFolderBodySchema,
  response: { mode: 'json', schema: grafanaUpdateFolderResponseSchema },
})

export {
  grafanaUpdateDashboardBodySchema,
  grafanaUpdateDashboardOutputSchema,
  grafanaUpdateAlertRuleBodySchema,
  grafanaUpdateAlertRuleOutputSchema,
  grafanaUpdateFolderBodySchema,
  grafanaUpdateFolderOutputSchema,
}

export type GrafanaUpdateDashboardBody = ContractBody<typeof grafanaUpdateDashboardContract>
export type GrafanaUpdateDashboardResponse = ContractJsonResponse<
  typeof grafanaUpdateDashboardContract
>
export type GrafanaUpdateAlertRuleBody = ContractBody<typeof grafanaUpdateAlertRuleContract>
export type GrafanaUpdateAlertRuleResponse = ContractJsonResponse<
  typeof grafanaUpdateAlertRuleContract
>
export type GrafanaUpdateFolderBody = ContractBody<typeof grafanaUpdateFolderContract>
export type GrafanaUpdateFolderResponse = ContractJsonResponse<typeof grafanaUpdateFolderContract>
