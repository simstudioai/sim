import type http from 'node:http'
import type { Duplex } from 'node:stream'
import { createLogger } from '@sim/logger'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import { Agent, type AgentConnectOpts } from 'agent-base'
import { isOutboundRoutingEnabled, type OutboundGateway } from '@/lib/core/network/config.server'
import { resolveCurrentOutboundRoute } from '@/lib/core/network/context.server'
import { connectThroughGateway } from '@/lib/core/network/gateway.server'
import {
  AGENT_OPTIONS,
  type AwsRequestHandlerOptions,
  awsRequestHandler,
  environmentProxyAgent,
} from '@/lib/core/network/proxy-agent.server'
import { OutboundRoutingError } from '@/lib/core/network/routing'

const logger = createLogger('OrganizationAwsRequestHandler')

/**
 * Pools connections tunnelled through one organization's gateway. Its sockets carry only that
 * organization's requests, so a keep-alive socket is never reused across organizations or
 * for a direct request.
 */
class GatewayAgent extends Agent {
  constructor(private readonly gateway: OutboundGateway) {
    super(AGENT_OPTIONS)
  }

  connect(_req: http.ClientRequest, options: AgentConnectOpts): Promise<Duplex> {
    return connectThroughGateway(
      this.gateway,
      {
        protocol: options.secureEndpoint ? 'https:' : 'http:',
        hostname: options.host ?? '',
        port: Number(options.port),
      },
      { profile: 'configuredEndpoint' }
    )
  }

  /** A replaced gateway finishes its in-flight requests and keeps no idle sockets. */
  retire(): void {
    this.on('free', (socket: Duplex) => socket.destroy())
    for (const sockets of Object.values(this.freeSockets)) {
      for (const socket of sockets ?? []) socket.destroy()
    }
  }
}

const gatewayAgents = new Map<string, { gatewayId: string; agent: GatewayAgent }>()

function gatewayAgentFor(gateway: OutboundGateway): GatewayAgent {
  const current = gatewayAgents.get(gateway.organizationId)
  if (current?.gatewayId === gateway.id) return current.agent
  current?.agent.retire()
  const agent = new GatewayAgent(gateway)
  gatewayAgents.set(gateway.organizationId, { gatewayId: gateway.id, agent })
  return agent
}

/**
 * Chooses each connection's agent from the current outbound scope: the organization's
 * {@link GatewayAgent} on a gateway route, otherwise the environment proxy agent (a direct
 * keep-alive connection when no proxy applies). It never pools a socket itself, and its own
 * socket limit is unbounded so a request is never queued here behind another organization's;
 * the agent it delegates to applies the SDK's limit.
 */
class OrganizationRoutingAgent extends Agent {
  async connect(req: http.ClientRequest, options: AgentConnectOpts): Promise<http.Agent> {
    const route = await currentRouteOrDirect(options.host)
    if (route.kind === 'gateway') return gatewayAgentFor(route.gateway)
    return environmentProxyAgent().connect(req, options)
  }
}

/** A request outside any outbound scope goes direct with a warning, as `outboundFetch` does. */
async function currentRouteOrDirect(host: string | undefined) {
  try {
    return await resolveCurrentOutboundRoute()
  } catch (error) {
    if (!(error instanceof OutboundRoutingError) || error.code !== 'MISSING_SCOPE') throw error
    logger.warn('AWS request made without an organization scope', { host })
    return { kind: 'direct' } as const
  }
}

let routingAgent: OrganizationRoutingAgent | undefined

/**
 * `requestHandler` for an AWS SDK v3 client that signs with a customer's credentials. When
 * outbound routing is enabled, every request is routed by the outbound scope it is sent in,
 * like `outboundFetch`: an organization with a dedicated egress gateway reaches AWS from its
 * static IPs (passing `aws:SourceIp` conditions), any other route connects as
 * {@link awsRequestHandler} would, and a call outside any scope goes direct with a warning. A
 * blocked route or an unavailable gateway fails the request with an `OutboundRoutingError`.
 * When routing is disabled this is exactly {@link awsRequestHandler}.
 *
 * Never use it for Sim's own AWS usage (its buckets, queues, email, secrets, metrics, or
 * Bedrock on Sim's keys), which must not leave through a customer's gateway.
 */
export function organizationAwsRequestHandler(
  options?: AwsRequestHandlerOptions
): ReturnType<typeof awsRequestHandler> {
  if (!isOutboundRoutingEnabled()) return awsRequestHandler(options)
  routingAgent ??= new OrganizationRoutingAgent({
    keepAlive: true,
    maxSockets: Number.POSITIVE_INFINITY,
  })
  return new NodeHttpHandler({ ...options, httpAgent: routingAgent, httpsAgent: routingAgent })
}
