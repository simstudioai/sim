import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'
import {
  isEnvironmentProxyConfigured,
  resolveEnvironmentProxy,
} from '@sim/security/environment-proxy'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import { Agent, type AgentConnectOpts } from 'agent-base'
import { HttpProxyAgent } from 'http-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'

/** Matches the AWS SDK's own default agent, so swapping it in changes routing and nothing else. */
const AGENT_OPTIONS: http.AgentOptions = { keepAlive: true, maxSockets: 50 }

/**
 * A Node agent for SDKs that bring their own HTTP stack (the AWS SDK, the OTLP exporters) and so
 * bypass Bun's proxy-aware `fetch`. Each connection takes the `HTTPS_PROXY` / `HTTP_PROXY` that
 * applies to its destination, or a direct keep-alive connection when `NO_PROXY` excludes it.
 */
class EnvironmentProxyAgent extends Agent {
  private readonly direct = {
    http: new http.Agent(AGENT_OPTIONS),
    https: new https.Agent(AGENT_OPTIONS),
  }
  private readonly proxies = new Map<string, http.Agent>()

  connect(_req: http.ClientRequest, options: AgentConnectOpts): http.Agent {
    const secure = options.secureEndpoint
    const host = options.host ?? 'localhost'
    const authority = isIP(host) === 6 ? `[${host}]` : host
    const target = new URL(`${secure ? 'https' : 'http'}://${authority}:${options.port}`)
    const proxyUrl = resolveEnvironmentProxy(target)
    if (!proxyUrl) return secure ? this.direct.https : this.direct.http
    const key = `${target.protocol}${proxyUrl}`
    let agent = this.proxies.get(key)
    if (!agent) {
      agent = secure
        ? new HttpsProxyAgent(proxyUrl, AGENT_OPTIONS)
        : new HttpProxyAgent(proxyUrl, AGENT_OPTIONS)
      this.proxies.set(key, agent)
    }
    return agent
  }
}

let sharedAgent: EnvironmentProxyAgent | null = null

/** The process-wide {@link EnvironmentProxyAgent}; only meaningful while a proxy is configured. */
function environmentProxyAgent(): EnvironmentProxyAgent {
  sharedAgent ??= new EnvironmentProxyAgent(AGENT_OPTIONS)
  return sharedAgent
}

interface AwsRequestHandlerOptions {
  connectionTimeout?: number
  requestTimeout?: number
  throwOnRequestTimeout?: boolean
}

/**
 * `requestHandler` for an AWS SDK v3 client. The SDK's Node handlers ignore `HTTPS_PROXY`, so while
 * a proxy is configured this returns an HTTP/1.1 handler on {@link environmentProxyAgent} — which
 * also replaces the HTTP/2 handler some clients default to, since HTTP/2 cannot use an agent.
 * Without a proxy it returns `options` unchanged and the SDK keeps its own defaults.
 */
export function awsRequestHandler(
  options?: AwsRequestHandlerOptions
): NodeHttpHandler | AwsRequestHandlerOptions | undefined {
  if (!isEnvironmentProxyConfigured()) return options
  const agent = environmentProxyAgent()
  return new NodeHttpHandler({ ...options, httpAgent: agent, httpsAgent: agent })
}

/**
 * Agent settings for an OTLP HTTP exporter, which sends through `node:http` and so ignores
 * `HTTPS_PROXY`. Empty without a proxy, leaving the exporter's own agent in place.
 */
export function otlpExporterProxyOptions(): { httpAgentOptions?: () => http.Agent } {
  if (!isEnvironmentProxyConfigured()) return {}
  return { httpAgentOptions: environmentProxyAgent }
}
