import { z } from 'zod'
import { hasCopilotResourceAdmission } from '@/lib/mothership/auth/application-delegation'
import { COPILOT_REQUEST_MODES } from '@/lib/mothership/constants'
import { ChatPayloadSchema } from '@/lib/mothership/generated/protocol'
import type { CopilotLifecycleOptions } from '@/lib/mothership/request/lifecycle/run'
import { isProjectsEnabled } from '@/lib/projects/rollout.server'

export const BillingAdmissionSchema = z
  .object({
    billingRequestId: z.uuid(),
    serializedAttribution: z.string().min(1).max(32768),
  })
  .strict()

export type BillingAdmission = z.infer<typeof BillingAdmissionSchema>

/** Start intent excludes transport credentials and receipts; takeover resolves those afresh. */
export const DurableChatRequestSchema = ChatPayloadSchema.safeExtend({
  messageId: z.uuid(),
  chatId: z.uuid(),
}).transform(
  ({ byokApiKey, delegationToken, receivedTextChars, receivedActivity, ...request }) => request
)
/**
 * Marks a durable turn admitted to author resources, so recovery restores the admission. Every
 * writer and the recovery reader share this one value.
 */
export const RESOURCE_AUTHORING_VERSION = 1

/**
 * The marker an admitted turn stores for recovery. Builds before it parse recovery strictly and
 * would refuse to recover the run, and only Project authoring reads it, so it is written only
 * while Projects are on.
 */
export async function durableResourceAuthoringVersion(
  admitted: boolean
): Promise<typeof RESOURCE_AUTHORING_VERSION | undefined> {
  return admitted && (await isProjectsEnabled()) ? RESOURCE_AUTHORING_VERSION : undefined
}

export const StreamRecoveryConfigSchema = z
  .object({
    kind: z.literal('interactive_stream'),
    resourceAuthoringVersion: z.literal(RESOURCE_AUTHORING_VERSION).optional(),
    billingAdmission: BillingAdmissionSchema.optional(),
    request: DurableChatRequestSchema,
    goRoute: z.enum(['/api/mothership', '/api/copilot']),
    clientToolPickupExpected: z.boolean(),
    userTimezone: z.string().optional(),
    requestMode: z.enum(COPILOT_REQUEST_MODES).optional(),
  })
  .strict()
  .refine(
    (config) =>
      !config.requestMode ||
      (!config.request.mode && config.requestMode !== 'assistant') ||
      (config.requestMode === 'build' ? 'agent' : config.requestMode) ===
        (config.request.mode ?? 'agent'),
    {
      message: 'Recovery mode must match the admitted request',
    }
  )

export async function streamRecoveryConfig(
  options: CopilotLifecycleOptions,
  request: Record<string, unknown>
) {
  if (options.interactive !== true) return undefined
  const resourceAuthoringVersion = await durableResourceAuthoringVersion(
    hasCopilotResourceAdmission({
      ...options,
      ...options.executionContext,
      copilotToolExecution: true,
      copilotResourceAdmission:
        options.executionContext?.copilotResourceAdmission ?? options.copilotResourceAdmission,
    })
  )
  return StreamRecoveryConfigSchema.parse({
    kind: 'interactive_stream',
    request,
    goRoute: options.goRoute ?? '/api/copilot',
    clientToolPickupExpected: options.clientToolPickupExpected ?? true,
    userTimezone: options.executionContext?.userTimezone,
    requestMode: options.executionContext?.requestMode,
    ...(resourceAuthoringVersion ? { resourceAuthoringVersion } : {}),
  })
}
