import dns from 'node:dns/promises'
import type NodeHTTP from 'node:http'
import type NodeHTTPS from 'node:https'
import { syncBuiltinESMExports } from 'node:module'
import type NodeNet from 'node:net'

// This pin must pass the real public-address egress policy. TEST-NET is reserved and rejected;
// the active socket fence below confines Node TCP dialing to loopback.
const SYNTHETIC_PUBLIC_PIN = '8.8.8.8'

export const POWERBI_FIXTURE_TOKEN = 'powerbi-synthetic-access-token'
export const POWERBI_FIXTURE_REFRESH_TOKEN = 'powerbi-synthetic-refresh-token'
export const POWERBI_FIXTURE_ROTATED_REFRESH_TOKEN = 'powerbi-rotated-refresh-token'
export const POWERBI_FIXTURE_IDS = {
  groupId: '11111111-1111-4111-8111-111111111111',
  datasetId: '22222222-2222-4222-8222-222222222222',
  reportId: '33333333-3333-4333-8333-333333333333',
} as const

export type PowerBIFixtureScenario =
  | 'normal'
  | 'readonly'
  | 'partial-query'
  | 'malformed'
  | 'oversized'
  | 'rate-limited'
  | 'forbidden'
  | 'slow'
  | 'paged-workspaces'
  | 'oversized-workspaces'
  | 'missing-identity'
  | 'missing-query'

interface PowerBIFixtureRequest {
  method: string
  path: string
  body: unknown
  authorized: boolean
  status: number
}

const WORKSPACE = {
  id: POWERBI_FIXTURE_IDS.groupId,
  name: 'Fixture Analytics',
  isReadOnly: false,
  isOnDedicatedCapacity: true,
  rawProviderSecret: POWERBI_FIXTURE_TOKEN,
}
const DATASET = {
  id: POWERBI_FIXTURE_IDS.datasetId,
  name: 'Fixture Sales',
  isRefreshable: true,
  configuredBy: 'analyst@example.test',
  rawProviderSecret: POWERBI_FIXTURE_TOKEN,
}
const REPORT = {
  id: POWERBI_FIXTURE_IDS.reportId,
  name: 'Fixture Revenue',
  datasetId: POWERBI_FIXTURE_IDS.datasetId,
  reportType: 'PowerBIReport',
  webUrl: 'https://app.powerbi.com/reports/fixture',
  rawProviderSecret: POWERBI_FIXTURE_TOKEN,
}

/** A loopback provider wire fixture; authentication, authorization, and tools stay real. */
export async function startPowerBIProviderFixture(http: typeof NodeHTTP) {
  const requests: PowerBIFixtureRequest[] = []
  let scenario: PowerBIFixtureScenario = 'normal'
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const text = Buffer.concat(chunks).toString('utf8')
    let body: unknown = null
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }
    const url = new URL(request.url ?? '/', 'https://api.powerbi.com')
    const entry: PowerBIFixtureRequest = {
      method: request.method ?? 'GET',
      path: `${url.pathname}${url.search}`,
      body,
      authorized: request.headers.authorization === `Bearer ${POWERBI_FIXTURE_TOKEN}`,
      status: 200,
    }
    requests.push(entry)
    const send = (status: number, data: unknown) => {
      entry.status = status
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(data))
    }
    if (url.pathname === '/common/oauth2/v2.0/token') {
      const parameters = new URLSearchParams(text)
      entry.body = Object.fromEntries(parameters)
      entry.authorized =
        parameters.get('grant_type') === 'refresh_token' &&
        (parameters.get('refresh_token') === POWERBI_FIXTURE_REFRESH_TOKEN ||
          parameters.get('refresh_token') === POWERBI_FIXTURE_ROTATED_REFRESH_TOKEN) &&
        parameters.get('client_id') === 'powerbi-fixture-client' &&
        parameters.get('client_secret') === 'powerbi-fixture-secret'
      if (!entry.authorized) return send(400, { error: 'invalid_grant' })
      return send(200, {
        access_token: POWERBI_FIXTURE_TOKEN,
        refresh_token: POWERBI_FIXTURE_ROTATED_REFRESH_TOKEN,
        expires_in: 3600,
        token_type: 'Bearer',
      })
    }
    if (!entry.authorized) return send(401, { error: { code: 'InvalidToken' } })
    if (scenario === 'forbidden') return send(403, { error: { code: 'Forbidden' } })
    if (scenario === 'rate-limited') {
      entry.status = 429
      response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' })
      response.end(JSON.stringify({ error: { code: 'TooManyRequests' } }))
      return
    }
    if (scenario === 'slow') return
    if (scenario === 'malformed') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"value":')
      return
    }
    if (scenario === 'missing-query') return send(200, {})
    if (scenario === 'missing-identity') {
      return send(200, /\/(groups|datasets|reports)$/.test(url.pathname) ? { value: [{}] } : {})
    }
    if (scenario === 'oversized') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(`{"value":[],"padding":"${'x'.repeat(21 * 1024 * 1024)}"}`)
      return
    }
    const root = '/v1.0/myorg'
    if (
      entry.method === 'GET' &&
      url.pathname === `${root}/groups/${POWERBI_FIXTURE_IDS.groupId}`
    ) {
      return send(200, WORKSPACE)
    }
    if (url.pathname === `${root}/groups`) {
      const skip = Number(url.searchParams.get('$skip') ?? 0)
      if (scenario === 'paged-workspaces' || scenario === 'oversized-workspaces') {
        return send(200, {
          value:
            skip === 0
              ? Array.from({ length: scenario === 'paged-workspaces' ? 100 : 101 }, (_, index) => ({
                  id: `fixture-workspace-${index}`,
                  name: `Fixture workspace ${index}`,
                }))
              : [WORKSPACE],
        })
      }
      return send(200, { value: skip === 0 ? [WORKSPACE] : [] })
    }
    const resourcePath = url.pathname.replace(`${root}/groups/${POWERBI_FIXTURE_IDS.groupId}`, root)
    if (entry.method === 'GET' && resourcePath === `${root}/datasets`) {
      return send(200, {
        value: scenario === 'readonly' ? [{ id: DATASET.id, name: DATASET.name }] : [DATASET],
      })
    }
    if (entry.method === 'GET' && resourcePath === `${root}/reports`) {
      return send(200, { value: [REPORT] })
    }
    if (entry.method === 'GET' && resourcePath === `${root}/datasets/${DATASET.id}`) {
      return send(200, scenario === 'readonly' ? { id: DATASET.id, name: DATASET.name } : DATASET)
    }
    if (entry.method === 'GET' && resourcePath === `${root}/reports/${REPORT.id}`) {
      return send(200, REPORT)
    }
    if (
      entry.method === 'POST' &&
      resourcePath === `${root}/datasets/${DATASET.id}/executeQueries`
    ) {
      return send(200, {
        results: [
          {
            tables: [
              {
                rows: [{ '[Revenue]': 125, 'Sales[Region]': 'West', '[Missing]': null }],
                ...(scenario === 'partial-query'
                  ? { error: { code: 'MoreRowsThanAllowed', message: 'Result was truncated.' } }
                  : {}),
              },
            ],
          },
        ],
        informationProtectionLabel: { id: 'fixture-label', name: 'Public' },
      })
    }
    if (resourcePath === `${root}/datasets/${DATASET.id}/refreshes`) {
      if (entry.method === 'POST') {
        entry.status = 202
        response.writeHead(202, {
          'x-ms-request-id': 'fixture-refresh-receipt',
          location: `https://api.powerbi.com${url.pathname}/fixture-refresh-receipt`,
        })
        response.end()
        return
      }
      return send(200, {
        value: [
          {
            requestId: 'fixture-refresh-receipt',
            refreshType: 'ViaApi',
            status: 'Completed',
            startTime: '2026-01-01T00:00:00Z',
            endTime: '2026-01-01T00:01:00Z',
          },
        ],
      })
    }
    return send(404, { error: { code: 'FixtureRouteMissing', message: entry.path } })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Provider fixture failed to bind')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    setScenario(value: PowerBIFixtureScenario) {
      scenario = value
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      })
    },
  }
}

/** Redirects only the fixed Power BI destination; unexpected external traffic fails closed. */
export function installPowerBITransport(
  origin: string,
  { http, https, net }: { http: typeof NodeHTTP; https: typeof NodeHTTPS; net: typeof NodeNet }
) {
  const fixture = new URL(origin)
  if (fixture.protocol !== 'http:' || fixture.hostname !== '127.0.0.1') {
    throw new Error('Power BI fixture transport requires a loopback HTTP origin')
  }
  const realLookup = dns.lookup
  const realRequest = https.request
  const realFetch = globalThis.fetch
  const realSocketConnect = net.Socket.prototype.connect
  const loopback = (host: string) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)
  const lookup = (async (hostname: string, options?: { all?: boolean } | number) => {
    if (hostname === 'api.powerbi.com') {
      const resolved = { address: SYNTHETIC_PUBLIC_PIN, family: 4 }
      return typeof options === 'object' && options.all ? [resolved] : resolved
    }
    if (!loopback(hostname)) throw new Error(`Blocked unexpected fixture DNS: ${hostname}`)
    if (typeof options === 'number') return realLookup(hostname, options)
    return options?.all
      ? realLookup(hostname, { ...options, all: true })
      : realLookup(hostname, { ...options, all: false })
  }) as typeof dns.lookup
  const connect = function (this: NodeNet.Socket, ...args: unknown[]) {
    let options: Record<string, unknown>
    let callback: unknown
    const first = args[0]
    const reject = () => {
      throw new Error('Blocked unexpected fixture socket: explicit loopback TCP required')
    }

    if (Array.isArray(first)) {
      // net.connect/createConnection pass Node's normalized [options, callback] array.
      // Forward a fresh options object, never the original array: an unmarked array's
      // own host/port properties otherwise mean something different to Node.
      if (
        args.length !== 1 ||
        first.length !== 2 ||
        !first[0] ||
        typeof first[0] !== 'object' ||
        Array.isArray(first[0]) ||
        (first[1] !== null && typeof first[1] !== 'function') ||
        Object.getOwnPropertyNames(first).some((key) => !['0', '1', 'length'].includes(key))
      ) {
        return reject()
      }
      options = { ...first[0] }
      callback = first[1]
    } else if (first && typeof first === 'object') {
      if (args.length > 2 || (args[1] !== undefined && typeof args[1] !== 'function')) {
        return reject()
      }
      options = { ...first }
      callback = args[1]
    } else if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
      if (
        args.length < 2 ||
        args.length > 3 ||
        typeof args[1] !== 'string' ||
        (args[2] !== undefined && typeof args[2] !== 'function')
      ) {
        return reject()
      }
      options = { port: first, host: args[1] }
      callback = args[2]
    } else {
      return reject()
    }

    // Snapshot getters before validation and delegate using the same captured host.
    // Literal destinations skip DNS, including an explicit localhost rewritten below.
    const host = options.host === 'localhost' ? '127.0.0.1' : options.host
    const port = options.port
    if (
      (host !== '127.0.0.1' && host !== '::1') ||
      options.path != null ||
      options.socketPath != null ||
      !(
        (typeof port === 'number' && Number.isInteger(port)) ||
        (typeof port === 'string' && /^\d+$/.test(port))
      ) ||
      Number(port) < 1 ||
      Number(port) > 65_535
    ) {
      return reject()
    }
    options.host = host
    return Reflect.apply(realSocketConnect, this, callback ? [options, callback] : [options])
  } as typeof net.Socket.prototype.connect
  const request = ((
    options: NodeHTTPS.RequestOptions,
    callback?: (response: NodeHTTP.IncomingMessage) => void
  ) => {
    if (
      options.hostname !== 'api.powerbi.com' ||
      Number(options.port ?? 443) !== 443 ||
      (options.protocol !== undefined && options.protocol !== 'https:') ||
      options.auth ||
      options.socketPath ||
      options.createConnection
    ) {
      throw new Error(`Blocked unexpected fixture HTTPS: ${options.hostname}`)
    }
    if (!options.lookup || !(options.agent instanceof https.Agent)) {
      throw new Error('Fixture expected the production pinned HTTPS transport')
    }
    const { agent: _agent, lookup: _lookup, ...forwarded } = options
    return http.request(
      {
        ...forwarded,
        hostname: fixture.hostname,
        port: fixture.port,
        headers: { ...options.headers, host: 'api.powerbi.com' },
      },
      callback
    )
  }) as typeof https.request
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.origin === 'https://api.powerbi.com' && !url.username && !url.password) {
      const target = new URL(fixture)
      target.pathname = url.pathname
      target.search = url.search
      return realFetch(new Request(target, request))
    }
    if (
      url.origin === 'https://login.microsoftonline.com' &&
      url.pathname === '/common/oauth2/v2.0/token' &&
      !url.username &&
      !url.password
    ) {
      return realFetch(new Request(new URL(url.pathname, fixture), request))
    }
    if (!loopback(url.hostname))
      throw new Error(`Blocked unexpected fixture fetch: ${url.hostname}`)
    return realFetch(request)
  }
  const restore = () => {
    net.Socket.prototype.connect = realSocketConnect
    dns.lookup = realLookup
    https.request = realRequest
    globalThis.fetch = realFetch
    syncBuiltinESMExports()
  }
  try {
    net.Socket.prototype.connect = connect
    dns.lookup = lookup
    https.request = request
    globalThis.fetch = fetch
    syncBuiltinESMExports()
  } catch (error) {
    restore()
    throw error
  }
  return restore
}
