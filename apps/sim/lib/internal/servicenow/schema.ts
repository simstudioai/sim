import { z } from 'zod'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'
import { SERVICENOW_BEARER_AUTH_STYLE } from '@/tools/servicenow/utils'

/**
 * A Basic login needs a username; a saved OAuth client credential instead sends the token it
 * minted (`accessToken`, with `authStyle: 'bearer'`) and has no username.
 */
export const serviceNowUploadAttachmentInputSchema = z
  .object({
    instanceUrl: z.string().min(1, 'Instance URL is required'),
    username: z.string().optional(),
    password: z.string().min(1, 'Password is required'),
    accessToken: z.string().optional(),
    authStyle: z.literal(SERVICENOW_BEARER_AUTH_STYLE).optional(),
    tableName: z.string().min(1, 'Table name is required'),
    recordSysId: z.string().min(1, 'Record sys_id is required'),
    fileName: z.string().min(1, 'File name is required'),
    file: RawFileInputSchema.optional().nullable(),
  })
  .superRefine((input, context) => {
    if (input.authStyle === SERVICENOW_BEARER_AUTH_STYLE) {
      if (!input.accessToken) {
        context.addIssue({
          code: 'custom',
          path: ['accessToken'],
          message: 'Access token is required',
        })
      }
    } else if (!input.username) {
      context.addIssue({ code: 'custom', path: ['username'], message: 'Username is required' })
    }
  })

export type ServiceNowUploadAttachmentInput = z.output<typeof serviceNowUploadAttachmentInputSchema>
