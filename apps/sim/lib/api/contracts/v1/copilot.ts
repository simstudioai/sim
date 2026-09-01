import { z } from 'zod'
import { COPILOT_REQUEST_MODES } from '@/lib/copilot/constants'

export const v1CopilotChatBodySchema = z.object({
  message: z.string().min(1, 'message is required'),
  workflowId: z.string().optional(),
  workflowName: z.string().optional(),
  chatId: z.string().optional(),
  mode: z.enum(COPILOT_REQUEST_MODES).optional().default('agent'),
  model: z.string().optional(),
  autoExecuteTools: z.boolean().optional().default(true),
  timeout: z.number().int().min(1000).max(3_600_000).optional().default(3_600_000),
})

export type V1CopilotChatBody = z.output<typeof v1CopilotChatBodySchema>
