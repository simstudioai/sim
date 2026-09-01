import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const speechTokenBodySchema = z
  .object({
    /** Workspace the session user is recording in. */
    workspaceId: z.string().optional(),
  })
  .passthrough()

export const speechTokenResponseSchema = z.object({
  token: z.string(),
})

export const speechTokenContract = defineRouteContract({
  method: 'POST',
  path: '/api/speech/token',
  body: speechTokenBodySchema,
  response: { mode: 'json', schema: speechTokenResponseSchema },
})
