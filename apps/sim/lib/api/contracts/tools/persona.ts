import { z } from 'zod'
import type { ContractBody, ContractJsonResponse } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

const personaImporterSchema = z.object({
  id: z.string(),
  status: z.string().nullable(),
  successfulCount: z.number(),
  errorCount: z.number(),
  duplicateCount: z.number(),
  createdAt: z.string().nullable(),
  completedAt: z.string().nullable(),
})

const personaImportAccountsResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    importer: personaImporterSchema,
  }),
})

export const personaImportAccountsBodySchema = z.object({
  apiKey: z.string().min(1, 'Persona API key is required'),
  file: RawFileInputSchema,
})

export const personaImportAccountsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/persona/import-accounts',
  body: personaImportAccountsBodySchema,
  response: { mode: 'json', schema: personaImportAccountsResponseSchema },
})

export type PersonaImportAccountsBody = ContractBody<typeof personaImportAccountsContract>
export type PersonaImportAccountsRouteResponse = ContractJsonResponse<
  typeof personaImportAccountsContract
>
