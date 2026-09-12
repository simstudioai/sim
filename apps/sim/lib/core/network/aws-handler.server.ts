import { isIP } from 'node:net'
import { buildQueryString, HttpResponse } from '@smithy/core/protocols'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import type { Dispatcher } from 'undici/index.js'
import { OutboundRoutingError } from '@/lib/core/network/routing'
import {
  createOutboundTransport,
  requestWithOutboundDispatcher,
} from '@/lib/core/network/transport.server'

/** Cached AWS clients resolve organization routing per request, using the same transport on both runtimes. */
export function createOutboundAwsHttpHandler() {
  const direct = new NodeHttpHandler()
  const transport = createOutboundTransport({ profile: 'configuredEndpoint' })
  return {
    metadata: direct.metadata,
    async handle(...[request, options]: Parameters<NodeHttpHandler['handle']>) {
      const dispatcher = await transport.selectDispatcher()
      if (!dispatcher) return direct.handle(request, options)
      const hostname = isIP(request.hostname) === 6 ? `[${request.hostname}]` : request.hostname
      const port = request.port ? `:${request.port}` : ''
      const target = `${request.protocol}//${hostname}${port}`
      try {
        const query = buildQueryString(request.query ?? {})
        const result = await requestWithOutboundDispatcher(
          `${target}${request.path}${query ? `?${query}` : ''}`,
          {
            dispatcher,
            method: request.method as Dispatcher.HttpMethod,
            headers: request.headers,
            body: request.body,
            signal: options?.abortSignal as AbortSignal | undefined,
          }
        )
        const responseHeaders: Record<string, string> = {}
        for (const [name, value] of Object.entries(result.headers)) {
          if (value !== undefined)
            responseHeaders[name] = Array.isArray(value) ? value.join(',') : value
        }
        return {
          response: new HttpResponse({
            statusCode: result.statusCode,
            headers: responseHeaders,
            body: result.body,
          }),
        }
      } catch {
        if (options?.abortSignal?.aborted) throw new DOMException('Request aborted', 'AbortError')
        throw new OutboundRoutingError('GATEWAY_UNAVAILABLE')
      }
    },
    destroy() {
      direct.destroy()
      void transport.destroy()
    },
    updateHttpClientConfig(...args: Parameters<NodeHttpHandler['updateHttpClientConfig']>) {
      direct.updateHttpClientConfig(...args)
    },
    httpHandlerConfigs: () => direct.httpHandlerConfigs(),
  }
}
