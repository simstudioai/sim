import { z } from 'zod'
import type { CopilotLifecycleOptions } from './run'

/** Only routing metadata is saved. Credentials and authorization are resolved on takeover. */
export const StreamRecoveryConfigSchema = z
  .object({
    kind: z.literal('interactive_stream'),
    goRoute: z.enum(['/api/mothership', '/api/copilot']),
    clientToolPickupExpected: z.boolean(),
    userTimezone: z.string().optional(),
    requestMode: z.string().optional(),
  })
  .strict()

export function streamRecoveryConfig(options: CopilotLifecycleOptions) {
  if (options.interactive !== true) return undefined
  return StreamRecoveryConfigSchema.parse({
    kind: 'interactive_stream',
    goRoute: options.goRoute ?? '/api/copilot',
    clientToolPickupExpected: options.clientToolPickupExpected ?? true,
    userTimezone: options.executionContext?.userTimezone,
    requestMode: options.executionContext?.requestMode,
  })
}
