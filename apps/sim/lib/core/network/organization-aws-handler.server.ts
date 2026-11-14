import type http from 'node:http'
import type { Duplex } from 'node:stream'
import { createLogger } from '@sim/logger'
import { NodeHttp2Handler, NodeHttpHandler } from '@smithy/node-http-handler'
import { Agent, type AgentConnectOpts } from 'agent-base'
import { isOutboundRoutingEnabled, type OutboundGateway } from '@/lib/core/network/config.server'
import { resolveCurrentOutboundRoute } from '@/lib/core/network/context.server'
import { connectThroughGateway } from '@/lib/core/network/gateway.server'
import {
  AGENT_OPTIONS,
  type AwsRequestHandlerOptions,
  awsRequestHandler,
} from '@/lib/core/network/proxy-agent.server'
import { OutboundRoutingError } from '@/lib/core/network/routing'

const logger = createLogger('OrganizationAwsRequestHandler')

type AwsHttpHandler = NodeHttpHandler | NodeHttp2Handler
type HandleArguments = Parameters<NodeHttpHandler['handle']>

/**
 * Pools connections tunnelled through one organization's gateway. Its sockets carry only that
 * organization's requests, so a keep-alive socket is never reused across organizations or
 * for a direct request.
 */
class GatewayAgent extends Agent {
  constructor(private readonly gateway: OutboundGateway) {
    super(AGENT_OPTIONS)
  }

  /**
   * The gateway only carries HTTPS. agent-base otherwise infers this from the call stack, which
   * differs between opening and freeing a socket, so the socket is never found to reuse.
   */
  isSecureEndpoint(): boolean {
    return true
  }

  connect(req: http.ClientRequest, options: AgentConnectOpts): Promise<Duplex> {
    return connectThroughGateway(
      this.gateway,
      {
        protocol: req.protocol,
        hostname: options.host ?? '',
        port: Number(options.port),
      },
      { profile: 'configuredEndpoint' }
    )
  }
}

const gatewayHandlers = new Map<
  string,
  { gatewayId: string; agent: GatewayAgent; handler: NodeHttpHandler }
>()

/**
 * The organization's shared gateway handler. A reassigned gateway's agent stops keeping
 * sockets alive, so Node closes each one as its in-flight request finishes and none is handed
 * to a request bound for the new gateway.
 */
function gatewayHandlerFor(gateway: OutboundGateway): NodeHttpHandler {
  const current = gatewayHandlers.get(gateway.organizationId)
  if (current?.gatewayId === gateway.id) return current.handler
  if (current) {
    current.agent.keepAlive = false
    for (const sockets of Object.values(current.agent.freeSockets)) {
      for (const socket of sockets ?? []) socket.destroy()
    }
  }
  const agent = new GatewayAgent(gateway)
  const handler = new NodeHttpHandler({ httpAgent: agent, httpsAgent: agent })
  gatewayHandlers.set(gateway.organizationId, { gatewayId: gateway.id, agent, handler })
  return handler
}

/** A request outside any outbound scope goes direct with a warning, as `outboundFetch` does. */
async function currentRouteOrDirect(host: string) {
  try {
    return await resolveCurrentOutboundRoute()
  } catch (error) {
    if (!(error instanceof OutboundRoutingError) || error.code !== 'MISSING_SCOPE') throw error
    logger.warn('AWS request made without an organization scope', { host })
    return { kind: 'direct' } as const
  }
}

/**
 * Picks each request's handler from the outbound scope it is sent in: an organization with a
 * gateway gets that gateway's handler, and every other request goes to `direct`, which is the
 * handler the client would use with no organization routing at all.
 */
class OrganizationRoutedHandler {
  readonly metadata: AwsHttpHandler['metadata']

  constructor(private readonly direct: AwsHttpHandler) {
    this.metadata = direct.metadata
  }

  async handle(...[request, options]: HandleArguments) {
    const route = await currentRouteOrDirect(request.hostname)
    const handler = route.kind === 'gateway' ? gatewayHandlerFor(route.gateway) : this.direct
    return handler.handle(request, options)
  }

  updateHttpClientConfig(...args: Parameters<AwsHttpHandler['updateHttpClientConfig']>): void {
    this.direct.updateHttpClientConfig(...args)
  }

  httpHandlerConfigs(): ReturnType<AwsHttpHandler['httpHandlerConfigs']> {
    return this.direct.httpHandlerConfigs()
  }

  destroy(): void {
    this.direct.destroy()
  }
}

/**
 * `requestHandler` for an AWS SDK v3 client that signs with a customer's credentials. Inside the
 * outbound scope of an organization with a dedicated egress gateway, each request reaches AWS
 * through that gateway, from the organization's static IPs (passing `aws:SourceIp` conditions).
 * Every other request, including one outside any scope (which also logs a warning), uses the
 * same handler the client gets from {@link awsRequestHandler}: the SDK's own default, or the
 * operator's `HTTPS_PROXY`. A blocked route or an unavailable gateway fails the request with an
 * `OutboundRoutingError`. With routing disabled this is exactly {@link awsRequestHandler}.
 *
 * Pass `http2` for a client whose SDK default is HTTP/2 (Bedrock Runtime), so its direct
 * requests keep it. Gateway requests always use HTTP/1.1 through the tunnel.
 *
 * Never use it for Sim's own AWS usage (its buckets, queues, email, secrets, metrics, or
 * Bedrock on Sim's keys), which must not leave through a customer's gateway.
 */
export function organizationAwsRequestHandler(
  options?: AwsRequestHandlerOptions & { http2?: boolean }
): ReturnType<typeof awsRequestHandler> | OrganizationRoutedHandler {
  const { http2, ...rest } = options ?? {}
  // No options stays `undefined`, so the client keeps its SDK default handler and settings.
  const handlerOptions = Object.keys(rest).length > 0 ? rest : undefined
  const configured = awsRequestHandler(handlerOptions)
  if (!isOutboundRoutingEnabled()) return configured
  const direct =
    configured instanceof NodeHttpHandler
      ? configured
      : http2
        ? new NodeHttp2Handler({ ...handlerOptions, disableConcurrentStreams: true })
        : new NodeHttpHandler(handlerOptions)
  return new OrganizationRoutedHandler(direct)
}
