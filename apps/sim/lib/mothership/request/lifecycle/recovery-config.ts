import { z } from 'zod'
import { ChatPayloadSchema } from '@/lib/mothership/generated/protocol'
import type { CopilotLifecycleOptions } from './run'

/** Start intent excludes transport credentials and receipts; takeover resolves those afresh. */
export const DurableChatRequestSchema = ChatPayloadSchema.omit({
  byokApiKey: true,
  delegationToken: true,
  receivedTextChars: true,
  receivedActivity: true,
}).extend({ messageId: z.uuid(), chatId: z.uuid() })
export const StreamRecoveryConfigSchema = z
  .object({
    kind: z.literal('interactive_stream'),
    request: DurableChatRequestSchema,
    goRoute: z.enum(['/api/mothership', '/api/copilot']),
    clientToolPickupExpected: z.boolean(),
    userTimezone: z.string().optional(),
    requestMode: z.string().optional(),
  })
  .strict()

export function streamRecoveryConfig(
  options: CopilotLifecycleOptions,
  request: Record<string, unknown>
) {
  if (options.interactive !== true) return undefined
  return StreamRecoveryConfigSchema.parse({
    kind: 'interactive_stream',
    request,
    goRoute: options.goRoute ?? '/api/copilot',
    clientToolPickupExpected: options.clientToolPickupExpected ?? true,
    userTimezone: options.executionContext?.userTimezone,
    requestMode: options.executionContext?.requestMode,
  })
}
