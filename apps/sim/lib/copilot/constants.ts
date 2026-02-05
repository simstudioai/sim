import { env } from '@/lib/core/config/env'

export const SIM_AGENT_API_URL_DEFAULT = 'https://copilot.sim.ai'
export const SIM_AGENT_VERSION = '1.0.3'

/** Resolved copilot backend URL — reads from env with fallback to default. */
const rawAgentUrl = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT
export const SIM_AGENT_API_URL =
  rawAgentUrl.startsWith('http://') || rawAgentUrl.startsWith('https://')
    ? rawAgentUrl
    : SIM_AGENT_API_URL_DEFAULT
