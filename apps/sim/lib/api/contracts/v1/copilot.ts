import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { COPILOT_REQUEST_MODES } from '@/lib/copilot/constants'

export const v1CopilotChatBodySchema = z.object({
  message: z.string().min(1, 'message is required'),
  workflowId: z.string().optional(),
  workflowName: z.string().optional(),
  chatId: z.string().optional(),
  mode: z.enum(COPILOT_REQUEST_MODES).optional().default('agent'),
  model: z.string().optional(),
  autoExecuteTools: z.boolean().optional().default(true),
  timeout: z.number().optional().default(3_600_000),
})

export type V1CopilotChatBody = z.output<typeof v1CopilotChatBodySchema>

const v1CopilotChatToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
  // untyped-response: copilot tool result is the user-defined output of an arbitrary tool invocation
  result: z.unknown().optional(),
  error: z.string().optional(),
  durationMs: z.number().optional(),
})

export const v1CopilotChatContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/copilot/chat',
  body: v1CopilotChatBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.boolean(),
      content: z.string().optional(),
      toolCalls: z.array(v1CopilotChatToolCallSchema).optional(),
      chatId: z.string().optional(),
      error: z.string().optional(),
    }),
  },
})
