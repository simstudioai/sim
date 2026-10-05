import { ComputerUseSchema } from '@sim/desktop-bridge/computer-use'
import { z } from 'zod'
import { desktopToolCallIdSchema } from '@/lib/api/contracts/desktop-tool-authorization'
import { defineRouteContract } from '@/lib/api/contracts/types'

const computerUseAvailabilityResponseSchema = z.object({ enabled: z.boolean() }).strict()
export const computerUseAvailabilityContract = defineRouteContract({
  method: 'GET',
  path: '/api/desktop/computer/availability',
  response: { mode: 'json', schema: computerUseAvailabilityResponseSchema },
})

const authorizeComputerUseBodySchema = z.object({ toolCallId: desktopToolCallIdSchema }).strict()
const authorizeComputerUseResponseSchema = z
  .object({
    toolName: z.literal('computer'),
    args: ComputerUseSchema,
    chatId: z.string().min(1),
  })
  .strict()
export const authorizeComputerUseContract = defineRouteContract({
  method: 'POST',
  path: '/api/desktop/computer/authorize',
  body: authorizeComputerUseBodySchema,
  response: { mode: 'json', schema: authorizeComputerUseResponseSchema },
})
