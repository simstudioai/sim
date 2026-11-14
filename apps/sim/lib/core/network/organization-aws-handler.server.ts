import type http from 'node:http'
import type { Duplex } from 'node:stream'
import { NodeHttp2Handler, NodeHttpHandler } from '@smithy/node-http-handler'
import { Agent, type AgentConnectOpts } from 'agent-base'
import { LRUCache } from 'lru-cache'
import { isOutboundRoutingEnabled, type OutboundGateway } from '@/lib/core/network/config.server'
import { connectThroughGateway } from '@/lib/core/network/gateway.server'
import { resolveOrganizationRoute } from '@/lib/core/network/outbound-fetch.server'
import { AGENT_OPTIONS, awsRequestHandler } from '@/lib/core/network/proxy-agent.server'

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

interface GatewayHandler {
  gatewayId: string
  agent: GatewayAgent
  handler: NodeHttpHandler
}

/**
 * Stops keeping a retired gateway's sockets alive, so Node closes each one as its in-flight
 * request finishes and none is handed to a later request.
 */
function retireGatewayHandler({ agent }: GatewayHandler): void {
  agent.keepAlive = false
  for (const sockets of Object.values(agent.freeSockets)) {
    for (const socket of sockets ?? []) socket.destroy()
  }
}

/** One handler per organization with a gateway; bounded like the routing config itself. */
const gatewayHandlers = new LRUCache<string, GatewayHandler>({
  max: 1_000,
  dispose: retireGatewayHandler,
})

function gatewayHandlerFor(gateway: OutboundGateway): NodeHttpHandler {
  const current = gatewayHandlers.get(gateway.organizationId)
  if (current?.gatewayId === gateway.id) return current.handler
  const agent = new GatewayAgent(gateway)
  const handler = new NodeHttpHandler({ httpAgent: agent, httpsAgent: agent })
  gatewayHandlers.set(gateway.organizationId, { gatewayId: gateway.id, agent, handler })
  return handler
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
    const route = await resolveOrganizationRoute(request.hostname)
    const handler = route.kind === 'gateway' ? gatewayHandlerFor(route.gateway) : this.direct
    return handler.handle(request, options)
  }

  /** The SDK only tunes the direct handler's own options; the gateway handler keeps its own. */
  updateHttpClientConfig(key: never, value: never): void {
    this.direct.updateHttpClientConfig(key, value)
  }

  httpHandlerConfigs(): ReturnType<AwsHttpHandler['httpHandlerConfigs']> {
    return this.direct.httpHandlerConfigs()
  }

  destroy(): void {
    this.direct.destroy()
  }
}

/**
 * `requestHandler` for an AWS SDK v3 client that signs with a customer's credentials. In the
 * outbound scope of an organization with a dedicated egress gateway each request reaches AWS from
 * the organization's static IPs (passing `aws:SourceIp` conditions); every other request uses
 * the handler {@link awsRequestHandler} gives the client, and routing disabled is exactly that.
 * Pass `http2` for a client whose SDK default is HTTP/2 (Bedrock Runtime) so direct requests keep
 * it. Never use it for Sim's own AWS usage, which must not leave through a customer's gateway.
 */
export function organizationAwsRequestHandler(options?: {
  http2?: boolean
}): ReturnType<typeof awsRequestHandler> | OrganizationRoutedHandler {
  // `undefined` without an environment proxy, so the client keeps its SDK default handler.
  const configured = awsRequestHandler()
  if (!isOutboundRoutingEnabled()) return configured
  const direct =
    configured instanceof NodeHttpHandler
      ? configured
      : options?.http2
        ? new NodeHttp2Handler({ disableConcurrentStreams: true })
        : new NodeHttpHandler()
  return new OrganizationRoutedHandler(direct)
}
