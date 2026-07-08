import { createConfigurationSetTool } from './create_configuration_set'
import { createEmailIdentityTool } from './create_email_identity'
import { createTemplateTool } from './create_template'
import { deleteEmailIdentityTool } from './delete_email_identity'
import { deleteSuppressedDestinationTool } from './delete_suppressed_destination'
import { deleteTemplateTool } from './delete_template'
import { getAccountTool } from './get_account'
import { getEmailIdentityTool } from './get_email_identity'
import { getSuppressedDestinationTool } from './get_suppressed_destination'
import { getTemplateTool } from './get_template'
import { listIdentitiesTool } from './list_identities'
import { listSuppressedDestinationsTool } from './list_suppressed_destinations'
import { listTemplatesTool } from './list_templates'
import { putSuppressedDestinationTool } from './put_suppressed_destination'
import { sendBulkEmailTool } from './send_bulk_email'
import { sendCustomVerificationEmailTool } from './send_custom_verification_email'
import { sendEmailTool } from './send_email'
import { sendTemplatedEmailTool } from './send_templated_email'
import { updateTemplateTool } from './update_template'

export const sesSendEmailTool = sendEmailTool
export const sesSendTemplatedEmailTool = sendTemplatedEmailTool
export const sesSendBulkEmailTool = sendBulkEmailTool
export const sesListIdentitiesTool = listIdentitiesTool
export const sesGetAccountTool = getAccountTool
export const sesCreateTemplateTool = createTemplateTool
export const sesGetTemplateTool = getTemplateTool
export const sesListTemplatesTool = listTemplatesTool
export const sesDeleteTemplateTool = deleteTemplateTool
export const sesUpdateTemplateTool = updateTemplateTool
export const sesPutSuppressedDestinationTool = putSuppressedDestinationTool
export const sesDeleteSuppressedDestinationTool = deleteSuppressedDestinationTool
export const sesGetSuppressedDestinationTool = getSuppressedDestinationTool
export const sesListSuppressedDestinationsTool = listSuppressedDestinationsTool
export const sesCreateEmailIdentityTool = createEmailIdentityTool
export const sesDeleteEmailIdentityTool = deleteEmailIdentityTool
export const sesGetEmailIdentityTool = getEmailIdentityTool
export const sesCreateConfigurationSetTool = createConfigurationSetTool
export const sesSendCustomVerificationEmailTool = sendCustomVerificationEmailTool

export * from './types'
