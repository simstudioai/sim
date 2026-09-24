import { ComputerUseSchema } from '@sim/desktop-bridge/computer-use'
import { z } from 'zod'
import { desktopToolCallIdSchema } from '@/lib/api/contracts/desktop-tool-authorization'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const computerUseAvailabilityResponseSchema = z.object({ enabled: z.boolean() }).strict()
export type ComputerUseAvailabilityResponse = z.output<typeof computerUseAvailabilityResponseSchema>
export const computerUseAvailabilityContract = defineRouteContract({
  method: 'GET',
  path: '/api/desktop/computer/availability',
  response: { mode: 'json', schema: computerUseAvailabilityResponseSchema },
})

export const authorizeComputerUseBodySchema = z
  .object({ toolCallId: desktopToolCallIdSchema })
  .strict()
export type AuthorizeComputerUseBody = z.input<typeof authorizeComputerUseBodySchema>
export const authorizeComputerUseResponseSchema = z
  .object({
    toolName: z.literal('computer'),
    args: ComputerUseSchema,
    chatId: z.string().min(1),
  })
  .strict()
export type AuthorizeComputerUseResponse = z.output<typeof authorizeComputerUseResponseSchema>
export const authorizeComputerUseContract = defineRouteContract({
  method: 'POST',
  path: '/api/desktop/computer/authorize',
  body: authorizeComputerUseBodySchema,
  response: { mode: 'json', schema: authorizeComputerUseResponseSchema },
})
