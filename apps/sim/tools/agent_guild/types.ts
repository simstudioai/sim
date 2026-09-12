import type { ToolResponse } from '@/tools/types'

export const AGENT_GUILD_CHECK_NAMES = [
  'endpoint_reachable',
  'protocol_handshake',
  'agent_card_resolves',
  'agent_card_signed',
  'payment_claim_holds',
  'independent_evidence',
] as const

export type AgentGuildCheckName = (typeof AGENT_GUILD_CHECK_NAMES)[number]
export type AgentGuildCheckStatus = 'proven' | 'failed' | 'unknown'

export interface AgentGuildObserveEndpointParams {
  targetUrl: string
  timeout?: number
}

export interface AgentGuildObserveEndpointResponse extends ToolResponse {
  output: {
    targetUrl: string
    checks: { check: AgentGuildCheckName; status: AgentGuildCheckStatus }[]
    failed: AgentGuildCheckName[]
    unknowns: AgentGuildCheckName[]
    limitations: string[]
  }
}
