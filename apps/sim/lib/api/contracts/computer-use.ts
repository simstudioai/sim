import { ComputerUseSchema } from '@sim/desktop-bridge/computer-use'
import { z } from 'zod'
import { desktopToolCallIdSchema } from '@/lib/api/contracts/desktop-tool-authorization'
import { organizationIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { type ContractQuery, defineRouteContract } from '@/lib/api/contracts/types'

/** The chat owner whose rollout applies: exactly one of a workspace or an organization. */
const computerUseAvailabilityQuerySchema = z.union([
  z.object({ workspaceId: workspaceIdSchema }).strict(),
  z.object({ organizationId: organizationIdSchema }).strict(),
])
const computerUseAvailabilityResponseSchema = z.object({ enabled: z.boolean() }).strict()
export const computerUseAvailabilityContract = defineRouteContract({
  method: 'GET',
  path: '/api/desktop/computer/availability',
  query: computerUseAvailabilityQuerySchema,
  response: { mode: 'json', schema: computerUseAvailabilityResponseSchema },
})
export type ComputerUseOwner = ContractQuery<typeof computerUseAvailabilityContract>

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
