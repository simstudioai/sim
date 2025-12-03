import {
  createAlertRuleTool,
  deleteAlertRuleTool,
  getAlertRuleTool,
  listAlertRulesTool,
  listContactPointsTool,
  updateAlertRuleTool,
} from '@/tools/grafana/alerts'
import {
  createAnnotationTool,
  deleteAnnotationTool,
  listAnnotationsTool,
  updateAnnotationTool,
} from '@/tools/grafana/annotations'
import {
  createDashboardTool,
  deleteDashboardTool,
  getDashboardTool,
  listDashboardsTool,
  updateDashboardTool,
} from '@/tools/grafana/dashboards'
import { getDataSourceTool, listDataSourcesTool } from '@/tools/grafana/data_sources'
import { createFolderTool, listFoldersTool } from '@/tools/grafana/folders'
import { dataSourceHealthTool, healthCheckTool } from '@/tools/grafana/health'

// Health tools
export const grafanaHealthCheckTool = healthCheckTool
export const grafanaDataSourceHealthTool = dataSourceHealthTool

// Dashboard tools
export const grafanaGetDashboardTool = getDashboardTool
export const grafanaListDashboardsTool = listDashboardsTool
export const grafanaCreateDashboardTool = createDashboardTool
export const grafanaUpdateDashboardTool = updateDashboardTool
export const grafanaDeleteDashboardTool = deleteDashboardTool

// Alert tools
export const grafanaListAlertRulesTool = listAlertRulesTool
export const grafanaGetAlertRuleTool = getAlertRuleTool
export const grafanaCreateAlertRuleTool = createAlertRuleTool
export const grafanaUpdateAlertRuleTool = updateAlertRuleTool
export const grafanaDeleteAlertRuleTool = deleteAlertRuleTool
export const grafanaListContactPointsTool = listContactPointsTool

// Annotation tools
export const grafanaCreateAnnotationTool = createAnnotationTool
export const grafanaListAnnotationsTool = listAnnotationsTool
export const grafanaUpdateAnnotationTool = updateAnnotationTool
export const grafanaDeleteAnnotationTool = deleteAnnotationTool

// Data Source tools
export const grafanaListDataSourcesTool = listDataSourcesTool
export const grafanaGetDataSourceTool = getDataSourceTool

// Folder tools
export const grafanaListFoldersTool = listFoldersTool
export const grafanaCreateFolderTool = createFolderTool
