import { batchUpdateTool } from '@/tools/google_form/batch_update'
import { createFormTool } from '@/tools/google_form/create_form'
import { createWatchTool } from '@/tools/google_form/create_watch'
import { deleteWatchTool } from '@/tools/google_form/delete_watch'
import { getFormTool } from '@/tools/google_form/get_form'
import { getResponsesTool } from '@/tools/google_form/get_responses'
import { listWatchesTool } from '@/tools/google_form/list_watches'
import { renewWatchTool } from '@/tools/google_form/renew_watch'
import { setPublishSettingsTool } from '@/tools/google_form/set_publish_settings'

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
