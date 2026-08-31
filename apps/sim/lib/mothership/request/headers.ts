import type { AttributedBillingRequestEnvelope } from '@/lib/billing/core/billing-attribution'
import { env } from '@/lib/core/config/env'
import { SIM_AGENT_VERSION } from '@/lib/mothership/constants'
import { getMothershipSourceEnvHeaders } from '@/lib/mothership/server/agent-url'

/**
 * The one assembly for sim -> mothership request headers (chat, title, steer, resume).
 * Three hand-rolled copies drifted on X-Client-Version and the request-id header.
 */
export function mothershipRequestHeaders(
  hostedBillingRequest?: AttributedBillingRequestEnvelope,
  simRequestId?: string
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(simRequestId ? { 'X-Sim-Request-ID': simRequestId } : {}),
    ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
    ...getMothershipSourceEnvHeaders(),
    'X-Client-Version': SIM_AGENT_VERSION,
    ...(hostedBillingRequest ? hostedBillingRequest.headers : {}),
  }
}
