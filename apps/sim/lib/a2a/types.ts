/**
 * A2A (Agent-to-Agent) Protocol Types (v0.3)
 * @see https://a2a-protocol.org/specification
 *
 * Protocol shapes are owned by `@a2a-js/sdk`. Only Sim-specific types live here.
 */

export type { AgentCapabilities, AgentSkill } from '@a2a-js/sdk'

/**
 * Sim-specific: how an agent authenticates callers. This is mapped onto the A2A
 * card's `securitySchemes` / `security` fields when the card is built.
 */
export interface AgentAuthentication {
  schemes: Array<'bearer' | 'apiKey' | 'oauth2' | 'none'>
  credentials?: string
}
