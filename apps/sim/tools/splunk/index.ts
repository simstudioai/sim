import { cancelSearchJobTool } from '@/tools/splunk/cancel_search_job'
import { createSearchJobTool } from '@/tools/splunk/create_search_job'
import { dispatchSavedSearchTool } from '@/tools/splunk/dispatch_saved_search'
import { getFiredAlertsTool } from '@/tools/splunk/get_fired_alerts'
import { getSavedSearchTool } from '@/tools/splunk/get_saved_search'
import { getSearchJobTool } from '@/tools/splunk/get_search_job'
import { getSearchResultsTool } from '@/tools/splunk/get_search_results'
import { listAppsTool } from '@/tools/splunk/list_apps'
import { listFiredAlertsTool } from '@/tools/splunk/list_fired_alerts'
import { listIndexesTool } from '@/tools/splunk/list_indexes'
import { listSavedSearchesTool } from '@/tools/splunk/list_saved_searches'
import { runSearchTool } from '@/tools/splunk/run_search'

export const splunkRunSearchTool = runSearchTool
export const splunkCreateSearchJobTool = createSearchJobTool
export const splunkGetSearchJobTool = getSearchJobTool
export const splunkGetSearchResultsTool = getSearchResultsTool
export const splunkCancelSearchJobTool = cancelSearchJobTool

export const splunkListSavedSearchesTool = listSavedSearchesTool
export const splunkGetSavedSearchTool = getSavedSearchTool
export const splunkDispatchSavedSearchTool = dispatchSavedSearchTool

export const splunkListFiredAlertsTool = listFiredAlertsTool
export const splunkGetFiredAlertsTool = getFiredAlertsTool
export const splunkListIndexesTool = listIndexesTool
export const splunkListAppsTool = listAppsTool
