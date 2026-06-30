import { getCompanyTool } from '@/tools/downdetector/get_company'
import { getCompanyAttributionTool } from '@/tools/downdetector/get_company_attribution'
import { getCompanyBaselineTool } from '@/tools/downdetector/get_company_baseline'
import { getCompanyEventsTool } from '@/tools/downdetector/get_company_events'
import { getCompanyIncidentsTool } from '@/tools/downdetector/get_company_incidents'
import { getCompanyIndicatorsTool } from '@/tools/downdetector/get_company_indicators'
import { getCompanyLast15Tool } from '@/tools/downdetector/get_company_last_15'
import { getCompanyStatusTool } from '@/tools/downdetector/get_company_status'
import { getProviderTool } from '@/tools/downdetector/get_provider'
import { getReportsTool } from '@/tools/downdetector/get_reports'
import { getSiteCompaniesTool } from '@/tools/downdetector/get_site_companies'
import { listCategoriesTool } from '@/tools/downdetector/list_categories'
import { listIncidentsTool } from '@/tools/downdetector/list_incidents'
import { listSitesTool } from '@/tools/downdetector/list_sites'
import { searchCompaniesTool } from '@/tools/downdetector/search_companies'

export const downdetectorSearchCompaniesTool = searchCompaniesTool
export const downdetectorGetCompanyTool = getCompanyTool
export const downdetectorGetCompanyStatusTool = getCompanyStatusTool
export const downdetectorGetCompanyBaselineTool = getCompanyBaselineTool
export const downdetectorGetCompanyLast15Tool = getCompanyLast15Tool
export const downdetectorGetCompanyIndicatorsTool = getCompanyIndicatorsTool
export const downdetectorGetReportsTool = getReportsTool
export const downdetectorGetCompanyIncidentsTool = getCompanyIncidentsTool
export const downdetectorGetCompanyAttributionTool = getCompanyAttributionTool
export const downdetectorGetCompanyEventsTool = getCompanyEventsTool
export const downdetectorGetSiteCompaniesTool = getSiteCompaniesTool
export const downdetectorGetProviderTool = getProviderTool
export const downdetectorListIncidentsTool = listIncidentsTool
export const downdetectorListCategoriesTool = listCategoriesTool
export const downdetectorListSitesTool = listSitesTool
