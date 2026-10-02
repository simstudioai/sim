import { once } from 'node:events'
import type * as NodeHTTP from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ProviderConfig } from '@earendil-works/pi-coding-agent'

export const FIXTURE_KEY = 'pi-offline-fixture-key'

export async function startPiProviderFixture(http: typeof NodeHTTP) {
  const requests: Array<{ path: string; body: Record<string, unknown>; authorization?: string }> =
    []
  let onRequest: (() => void) | undefined
  const requested = new Promise<void>((resolve) => {
    onRequest = resolve
  })
  const server = http.createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw || '{}') as Record<string, unknown>
    requests.push({ path: request.url ?? '', body, authorization: request.headers.authorization })
    onRequest?.()
    if (request.url === '/exa') {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          results: [
            {
              title: 'Fixture result',
              url: 'https://example.com/fixture',
              text: 'Offline search evidence',
            },
          ],
        })
      )
      return
    }
    const messages = Array.isArray(body.messages) ? body.messages : []
    const prompt = JSON.stringify(messages)
    if (prompt.includes('provider-error')) {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          error: { message: `provider failed ${FIXTURE_KEY}`, type: 'invalid_request_error' },
        })
      )
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const chunk = (delta: Record<string, unknown>, finish: string | null = null) => {
      response.write(
        `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture-model', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
      )
    }
    chunk({ role: 'assistant' })
    if (prompt.includes('cancel-fixture')) return
    const hasToolResult = messages.some((message: { role?: string }) => message.role === 'tool')
    if (!hasToolResult) {
      chunk({ reasoning_content: 'checking fixture' })
      const search = prompt.includes('search-fixture')
      chunk({
        tool_calls: [
          {
            index: 0,
            id: 'call-fixture',
            type: 'function',
            function: {
              name: search ? 'web_search' : 'fixture_tool',
              arguments: JSON.stringify(
                search ? { query: 'fixture query' } : { value: 'fixture input' }
              ),
            },
          },
        ],
      })
      chunk({}, 'tool_calls')
    } else {
      chunk({ content: 'fixture complete' })
      chunk({}, 'stop')
    }
    response.write(
      `data: ${JSON.stringify({ id: 'fixture', choices: [], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } })}\n\ndata: [DONE]\n\n`
    )
    response.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const provider: ProviderConfig = {
    baseUrl: `${baseUrl}/v1`,
    api: 'openai-completions',
    models: [
      {
        id: 'fixture-model',
        name: 'Offline fixture',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 100_000,
        maxTokens: 1000,
        compat: {
          supportsDeveloperRole: false,
          supportsStore: false,
          supportsReasoningEffort: false,
        },
      },
    ],
  }
  return {
    baseUrl,
    provider,
    requests,
    requested,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    },
  }
}
