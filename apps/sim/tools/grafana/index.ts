import { createAlertRuleTool } from '@/tools/grafana/create_alert_rule'
import { createAnnotationTool } from '@/tools/grafana/create_annotation'
import { createDashboardTool } from '@/tools/grafana/create_dashboard'
import { createFolderTool } from '@/tools/grafana/create_folder'
import { deleteAlertRuleTool } from '@/tools/grafana/delete_alert_rule'
import { deleteAnnotationTool } from '@/tools/grafana/delete_annotation'
import { deleteDashboardTool } from '@/tools/grafana/delete_dashboard'
import { getAlertRuleTool } from '@/tools/grafana/get_alert_rule'
import { getDashboardTool } from '@/tools/grafana/get_dashboard'
import { getDataSourceTool } from '@/tools/grafana/get_data_source'
import { listAlertRulesTool } from '@/tools/grafana/list_alert_rules'
import { listAnnotationsTool } from '@/tools/grafana/list_annotations'
import { listContactPointsTool } from '@/tools/grafana/list_contact_points'
import { listDashboardsTool } from '@/tools/grafana/list_dashboards'
import { listDataSourcesTool } from '@/tools/grafana/list_data_sources'
import { listFoldersTool } from '@/tools/grafana/list_folders'
import { updateAlertRuleTool } from '@/tools/grafana/update_alert_rule'
import { updateAnnotationTool } from '@/tools/grafana/update_annotation'
import { updateDashboardTool } from '@/tools/grafana/update_dashboard'

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
