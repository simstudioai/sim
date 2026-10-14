import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { supportsFileOwnerProtocol } from '@/lib/mothership/request/lifecycle/file-owner-protocol'

const worker = createServer((request, response) => {
  switch (request.url) {
    case '/supported/healthz':
    case '/nested/worker/healthz':
      response.writeHead(200, { 'X-Mothership-File-Owner-Protocol': '1' }).end()
      return
    case '/future/healthz':
      response.writeHead(200, { 'X-Mothership-File-Owner-Protocol': '2' }).end()
      return
    case '/malformed/healthz':
      response.writeHead(200, { 'X-Mothership-File-Owner-Protocol': '01' }).end()
      return
    case '/unhealthy/healthz':
      response.writeHead(503, { 'X-Mothership-File-Owner-Protocol': '1' }).end()
      return
    case '/redirect/healthz':
      response.writeHead(302, { location: '/supported/healthz' }).end()
      return
    case '/broken/healthz':
      request.socket.destroy()
      return
    case '/unresponsive/healthz':
      return
    default:
      response.writeHead(200).end()
  }
})

let endpoint: string

beforeAll(async () => {
  await new Promise<void>((resolve) => worker.listen(0, '127.0.0.1', resolve))
  const address = worker.address()
  if (!address || typeof address === 'string') throw new Error('Worker fixture failed to bind')
  endpoint = `http://127.0.0.1:${address.port}`
})

afterAll(
  () =>
    new Promise<void>((resolve, reject) => {
      worker.close((error) => (error ? reject(error) : resolve()))
      worker.closeAllConnections()
    })
)

describe('file-owner worker negotiation over HTTP', () => {
  it.each([
    ['supported', true],
    ['nested/worker/', true],
    ['old', false],
    ['future', false],
    ['malformed', false],
    ['unhealthy', false],
    ['redirect', false],
    ['broken', false],
    ['unresponsive', false],
  ] as const)('accepts only the healthy, exact protocol at %s', async (path, supported) => {
    expect(await supportsFileOwnerProtocol(`${endpoint}/${path}`)).toBe(supported)
  })
})
