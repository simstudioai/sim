import { z } from 'zod'

const handoffId = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
export const freebuffHandoffBodySchema = z.object({
  request: handoffId,
  challenge: handoffId,
  conversionToken: z.string().min(1).max(600),
})
export type FreebuffHandoffBody = z.infer<typeof freebuffHandoffBodySchema>
export const freebuffLandingQuerySchema = z.object({
  bfcid: z.string().min(1).max(600).optional(),
  request: handoffId.optional(),
  challenge: handoffId.optional(),
  pairing: z
    .string()
    .regex(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    .optional(),
  workspace: z.string().max(128).optional(),
})
export type FreebuffLandingQuery = z.infer<typeof freebuffLandingQuerySchema>
