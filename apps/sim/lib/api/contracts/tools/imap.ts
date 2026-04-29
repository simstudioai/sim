import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const imapToolResponseSchema = z.object({}).passthrough()

export const imapMailboxesBodySchema = z.object({
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
  response: { mode: 'json', schema: imapToolResponseSchema },
})

export type ImapMailboxesBody = ContractBody<typeof imapMailboxesContract>
export type ImapMailboxesBodyInput = ContractBodyInput<typeof imapMailboxesContract>
export type ImapMailboxesResponse = ContractJsonResponse<typeof imapMailboxesContract>
