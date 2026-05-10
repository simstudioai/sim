import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const imapMailboxSchema = z.object({
  path: z.string(),
  name: z.string(),
  delimiter: z
    .union([z.string(), z.literal(false)])
    .nullable()
    .optional(),
})

const imapMailboxesResponseSchema = z.object({
  success: z.literal(true),
  mailboxes: z.array(imapMailboxSchema),
})

const imapMailboxesBodySchema = z.object({
  host: z.string().min(1),
  port: z.preprocess((value) => value || 993, z.coerce.number().int().positive()),
  secure: z.preprocess((value) => value ?? true, z.boolean()),
  username: z.string().min(1),
  password: z.string().min(1),
})

export const imapMailboxesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/imap/mailboxes',
  body: imapMailboxesBodySchema,
  response: { mode: 'json', schema: imapMailboxesResponseSchema },
})

type ImapMailboxesBody = ContractBody<typeof imapMailboxesContract>
type ImapMailboxesBodyInput = ContractBodyInput<typeof imapMailboxesContract>
type ImapMailbox = z.output<typeof imapMailboxSchema>
type ImapMailboxesResponse = ContractJsonResponse<typeof imapMailboxesContract>
