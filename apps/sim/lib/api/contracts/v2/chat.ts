import { z } from 'zod'
import { noInputSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'

/**
 * v2 chat contract — the `sim chat` surface.
 *
 * One turn against the same headless execution path the Sim Chat block uses:
 * the caller sends a message (optionally continuing an existing conversation)
 * and receives the reply plus the conversation id that reinvokes the same
 * conversation on the next turn.
 */

export const v2ChatBodySchema = z.object({
  workspaceId: z
    .string()
    .min(1, 'workspaceId is required')
    .describe('Workspace the conversation runs in.'),
  message: z
    .string()
    .min(1, 'message cannot be empty')
    .max(200_000, 'message cannot exceed 200000 characters')
    .describe('The message to send to Sim.'),
  conversationId: z
    .string()
    .uuid('conversationId must be a valid conversation id')
    .optional()
    .describe('Conversation to continue; a new one starts when omitted.'),
  effort: z
    .enum(['low', 'medium', 'high', 'xhigh', 'max'])
    .optional()
    .describe('Model effort for this turn; defaults to the deployment default (high).'),
})

const v2ChatTokensSchema = z.object({
  prompt: z.number().optional(),
  completion: z.number().optional(),
  total: z.number().optional(),
})

export const v2ChatResultSchema = z.object({
  content: z.string(),
  conversationId: z.string(),
  model: z.string().describe('Identifier of the agent that produced the reply.'),
  tokens: v2ChatTokensSchema.optional(),
  // untyped-response: cost is a billing passthrough whose shape is owned by the copilot backend, not this contract
  cost: z.unknown().optional(),
  // untyped-response: each tool call's arguments and result shapes are owned by the tool that produced them
  toolCalls: z.array(z.record(z.string(), z.unknown())).optional(),
})

export const v2ChatContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/chat',
  query: noInputSchema,
  body: v2ChatBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2ChatResultSchema),
  },
})

export type V2ChatBody = z.input<typeof v2ChatBodySchema>
export type V2ChatResult = z.output<typeof v2ChatResultSchema>
