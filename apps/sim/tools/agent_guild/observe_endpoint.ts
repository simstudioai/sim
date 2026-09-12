import { isIpLiteral, isPrivateIp, unwrapIpv6Brackets } from '@sim/security/ssrf'
import { z } from 'zod'
import { isPayloadSizeLimitError, readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import {
  AGENT_GUILD_CHECK_NAMES,
  type AgentGuildObserveEndpointParams,
  type AgentGuildObserveEndpointResponse,
} from '@/tools/agent_guild/types'
import type { ToolConfig } from '@/tools/types'

const MAX_OBSERVATION_BYTES = 64 * 1024
const observationSchema = z.object({
  target: z.string().max(2048),
  checks: z
    .array(
      z.object({
        check: z.enum(AGENT_GUILD_CHECK_NAMES),
        status: z.enum(['proven', 'failed', 'unknown']),
      })
    )
    .max(AGENT_GUILD_CHECK_NAMES.length),
})

/** Only public endpoint locators are accepted; DNS reachability remains an observation. */
function validateTargetUrl(targetUrl: string): void {
  if (typeof targetUrl !== 'string' || targetUrl.length > 2048 || /[\s\\]/.test(targetUrl)) {
    throw new Error('Enter a public HTTPS endpoint URL without whitespace or backslashes')
  }
  let url: URL
  try {
    url = new URL(targetUrl)
  } catch {
    throw new Error('Enter a valid public HTTPS endpoint URL')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(
      'Use HTTPS without credentials, query parameters, or fragments; the entire URL is shared with Agent Guild'
    )
  }
  const host = unwrapIpv6Brackets(url.hostname).toLowerCase().replace(/\.$/, '')
  if (
    (isIpLiteral(host) && isPrivateIp(host)) ||
    (!isIpLiteral(host) &&
      (!host.includes('.') || /\.(localhost|local|internal|test|invalid)$/.test(host)))
  ) {
    throw new Error('Use a public endpoint, not a local hostname or private IP address')
  }
}

export const agentGuildObserveEndpointTool: ToolConfig<
  AgentGuildObserveEndpointParams,
  AgentGuildObserveEndpointResponse
> = {
  id: 'agent_guild_observe_endpoint',
  name: 'Agent Guild Observe Endpoint',
  description:
    'Send a public HTTPS endpoint URL to Agent Guild for a one-time observation of reachability, protocol and card signals. Shares the complete URL with Agent Guild, which may probe the endpoint. Returns check statuses and explicit unknowns, not authorization, a safety guarantee, or evidence of successful task execution. Hostname checks are syntactic; this block does not verify public DNS resolution. No account or API key required.',
  version: '1.0.0',
  params: {
    targetUrl: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Exact public HTTPS endpoint URL to disclose to Agent Guild. No credentials, query parameters, fragments, or private endpoint URLs.',
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Native request socket timeout in milliseconds, from 1 to 300000. If omitted, Sim uses its native 300000 ms default. This is not a total deadline.',
    },
  },
  request: {
    url: (params) => {
      validateTargetUrl(params.targetUrl)
      if (
        params.timeout !== undefined &&
        (!Number.isInteger(params.timeout) || params.timeout < 1 || params.timeout > 300000)
      ) {
        throw new Error('Socket timeout must be an integer from 1 to 300000 milliseconds')
      }
      if ('proxyUrl' in params && params.proxyUrl) {
        throw new Error('Agent Guild observations do not support a custom proxy URL')
      }
      return `https://agent-guild-5d5r.onrender.com/preflight?${new URLSearchParams({ url: params.targetUrl })}`
    },
    method: () => 'GET',
    headers: () => ({ Accept: 'application/json' }),
    retry: { enabled: false },
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response, params, context) => {
    let text: string
    try {
      text = await readResponseTextWithLimit(response, {
        maxBytes: MAX_OBSERVATION_BYTES,
        label: 'Agent Guild observation',
        signal: context?.signal,
      })
    } catch (error) {
      if (isPayloadSizeLimitError(error)) {
        throw new Error('Agent Guild observation exceeds the 64 KiB projection limit')
      }
      throw error
    }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      throw new Error('Agent Guild returned an invalid JSON observation')
    }
    const parsed = observationSchema.safeParse(raw)
    if (!parsed.success) throw new Error('Agent Guild returned an unsupported observation shape')
    const observed = parsed.data
    if (!params || observed.target !== params.targetUrl) {
      throw new Error('Agent Guild observation target did not match the requested URL')
    }
    const received = new Map(observed.checks.map((check) => [check.check, check.status]))
    if (received.size !== observed.checks.length) {
      throw new Error('Agent Guild returned duplicate observation checks')
    }
    const checks = AGENT_GUILD_CHECK_NAMES.map((check) => ({
      check,
      status: received.get(check) ?? 'unknown',
    }))
    return {
      success: true,
      output: {
        targetUrl: params.targetUrl,
        checks,
        failed: checks.filter((check) => check.status === 'failed').map((check) => check.check),
        unknowns: checks.filter((check) => check.status === 'unknown').map((check) => check.check),
        limitations: [
          'A one-time observation can become stale and does not authorize delegation or establish endpoint safety.',
          'Check statuses are Agent Guild reports, not independently verified facts. Missing checks remain unknown.',
          'A protocol handshake does not prove successful task execution.',
          'Card signature presence does not prove signature validity or counterparty identity.',
          'No paid task is executed; payment outcomes and the endpoint’s use of your data remain unverified.',
          'Sim sends the URL to the initial Guild service URL using its native redirect behavior; it does not separately invoke a target task.',
        ],
      },
    }
  },
  outputs: {
    targetUrl: {
      type: 'string',
      description: 'Exact requested endpoint URL, matched against the service response',
    },
    checks: {
      type: 'array',
      description: 'Six recognized checks; missing observations have status unknown',
      items: {
        type: 'object',
        properties: {
          check: { type: 'string', description: 'Recognized observation check name' },
          status: {
            type: 'string',
            description: 'Service-reported proven, failed, or unknown status',
          },
        },
      },
    },
    failed: {
      type: 'array',
      description: 'Recognized checks reported as failed',
      items: { type: 'string' },
    },
    unknowns: {
      type: 'array',
      description: 'Recognized checks reported as unknown or absent',
      items: { type: 'string' },
    },
    limitations: {
      type: 'array',
      description: 'Fixed interpretation and transport limitations',
      items: { type: 'string' },
    },
  },
}
