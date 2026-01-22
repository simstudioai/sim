import { batchUpdateTool } from '@/tools/google_forms/batch_update'
import { createFormTool } from '@/tools/google_forms/create_form'
import { createWatchTool } from '@/tools/google_forms/create_watch'
import { deleteWatchTool } from '@/tools/google_forms/delete_watch'
import { getFormTool } from '@/tools/google_forms/get_form'
import { getResponsesTool } from '@/tools/google_forms/get_responses'
import { listWatchesTool } from '@/tools/google_forms/list_watches'
import { renewWatchTool } from '@/tools/google_forms/renew_watch'
import { setPublishSettingsTool } from '@/tools/google_forms/set_publish_settings'

export const googleFormsGetResponsesTool = getResponsesTool
export const googleFormsGetFormTool = getFormTool
export const googleFormsCreateFormTool = createFormTool
export const googleFormsBatchUpdateTool = batchUpdateTool
export const googleFormsSetPublishSettingsTool = setPublishSettingsTool
export const googleFormsCreateWatchTool = createWatchTool
export const googleFormsListWatchesTool = listWatchesTool
export const googleFormsDeleteWatchTool = deleteWatchTool
export const googleFormsRenewWatchTool = renewWatchTool

export * from './types'
