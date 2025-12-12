import { createFormTool } from '@/tools/typeform/create_form'
import { deleteFormTool } from '@/tools/typeform/delete_form'
import { filesTool } from '@/tools/typeform/files'
import { getFormTool } from '@/tools/typeform/get_form'
import { insightsTool } from '@/tools/typeform/insights'
import { listFormsTool } from '@/tools/typeform/list_forms'
import { responsesTool } from '@/tools/typeform/responses'
import { updateFormTool } from '@/tools/typeform/update_form'

export const typeformResponsesTool = responsesTool
export const typeformFilesTool = filesTool
export const typeformInsightsTool = insightsTool
export const typeformListFormsTool = listFormsTool
export const typeformGetFormTool = getFormTool
export const typeformCreateFormTool = createFormTool
export const typeformUpdateFormTool = updateFormTool
export const typeformDeleteFormTool = deleteFormTool
