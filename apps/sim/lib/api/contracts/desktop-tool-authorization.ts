import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const authorizeDesktopToolBodySchema = z.object({
  toolCallId: z
    .string()
    .min(1, 'Tool call ID is required')
    .max(256, 'Tool call ID is too long')
    .regex(/^[^\x00-\x1f\x7f]+$/, 'Tool call ID contains invalid control characters'),
})

export type AuthorizeDesktopToolBody = z.input<typeof authorizeDesktopToolBodySchema>

export const authorizeDesktopToolResponseSchema = z.object({
  toolName: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
})

export type AuthorizeDesktopToolResponse = z.output<typeof authorizeDesktopToolResponseSchema>

export const authorizeDesktopToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/desktop/tool/authorize',
  body: authorizeDesktopToolBodySchema,
  response: {
    mode: 'json',
    schema: authorizeDesktopToolResponseSchema,
  },
  error: z.object({ error: z.string() }),
})
