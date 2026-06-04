import { createTemplateTool } from './create_template'
import { deleteTemplateTool } from './delete_template'
import { getAccountTool } from './get_account'
import { getTemplateTool } from './get_template'
import { listIdentitiesTool } from './list_identities'
import { listTemplatesTool } from './list_templates'
import { sendBulkEmailTool } from './send_bulk_email'
import { sendEmailTool } from './send_email'
import { sendTemplatedEmailTool } from './send_templated_email'

export const sesSendEmailTool = sendEmailTool
export const sesSendTemplatedEmailTool = sendTemplatedEmailTool
export const sesSendBulkEmailTool = sendBulkEmailTool
export const sesListIdentitiesTool = listIdentitiesTool
export const sesGetAccountTool = getAccountTool
export const sesCreateTemplateTool = createTemplateTool
export const sesGetTemplateTool = getTemplateTool
export const sesListTemplatesTool = listTemplatesTool
export const sesDeleteTemplateTool = deleteTemplateTool

export * from './types'
