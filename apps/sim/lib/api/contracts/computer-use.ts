import { ComputerUseWithAppCommandsSchema } from '@sim/desktop-bridge/computer-use'
import { z } from 'zod'
import { desktopToolCallIdSchema } from '@/lib/api/contracts/desktop-tool-authorization'
import { organizationIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

const authorizeComputerUseBodySchema = z.object({ toolCallId: desktopToolCallIdSchema }).strict()
const authorizeComputerUseResponseSchema = z
  .object({
    toolName: z.literal('computer'),
    args: ComputerUseWithAppCommandsSchema,
    chatId: z.string().min(1),
  })
  .strict()
export const authorizeComputerUseContract = defineRouteContract({
  method: 'POST',
  path: '/api/desktop/computer/authorize',
  body: authorizeComputerUseBodySchema,
  response: { mode: 'json', schema: authorizeComputerUseResponseSchema },
})

const computerUseAvailabilityResponseSchema = z.object({ available: z.boolean() }).strict()

/** Whether the permission group governing this workspace lets its chats use computer use. */
export const workspaceComputerUseAvailabilityContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/computer-use/availability',
  params: z.object({ id: workspaceIdSchema }).strict(),
  response: { mode: 'json', schema: computerUseAvailabilityResponseSchema },
})

/** Whether this organization's default permission group lets its chats use computer use. */
export const organizationComputerUseAvailabilityContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/computer-use/availability',
  params: z.object({ id: organizationIdSchema }).strict(),
  response: { mode: 'json', schema: computerUseAvailabilityResponseSchema },
})
