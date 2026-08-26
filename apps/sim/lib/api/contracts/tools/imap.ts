import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const imapMailboxSchema = z.object({
  path: z.string(),
  name: z.string(),
  delimiter: z
    .union([z.string(), z.literal(false)])
    .nullable()
    .optional(),
})

export const imapMailboxesResponseSchema = z.object({
  success: z.literal(true),
  mailboxes: z.array(imapMailboxSchema),
})

export const imapMailboxesBodySchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required'),
  host: z.string().min(1),
  port: z.union([z.string(), z.number()]).optional(),
  secure: z.union([z.string(), z.boolean()]).optional(),
  username: z.string().min(1),
  password: z.string().min(1),
})

export const resolvedImapMailboxesBodySchema = imapMailboxesBodySchema
  .omit({ workflowId: true })
  .extend({
    port: z.preprocess((value) => value || 993, z.coerce.number().int().positive()),
    secure: z.preprocess((value) => {
      if (value === undefined || value === null || value === '') return true
      if (value === 'true') return true
      if (value === 'false') return false
      return value
    }, z.boolean()),
  })

export const imapMailboxesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/imap/mailboxes',
  body: imapMailboxesBodySchema,
  response: { mode: 'json', schema: imapMailboxesResponseSchema },
})

export type ImapMailboxesBody = ContractBody<typeof imapMailboxesContract>
export type ImapMailboxesBodyInput = ContractBodyInput<typeof imapMailboxesContract>
export type ImapMailbox = z.output<typeof imapMailboxSchema>
export type ImapMailboxesResponse = ContractJsonResponse<typeof imapMailboxesContract>
