import dns from 'node:dns/promises'
import type NodeHTTP from 'node:http'
import type NodeHTTPS from 'node:https'
import { syncBuiltinESMExports } from 'node:module'
import type NodeNet from 'node:net'

// Test-only public pin accepted by production egress validation. Sockets stay loopback.
const SYNTHETIC_PUBLIC_PIN = '8.8.8.8'
export const FIGMA_FIXTURE_TOKEN = 'figma-synthetic-access-token'
export const FIGMA_FIXTURE_REFRESH_TOKEN = 'figma-synthetic-refresh-token'
export const FIGMA_FIXTURE_IDS = {
  fileKey: 'fixture-file',
  nodeId: '12:34',
  commentId: '12345678901234567890',
  userId: '123456789012345678901',
  versionId: '98765432109876543210',
} as const
export type FigmaFixtureScenario =
  | 'normal'
  | 'empty'
  | 'forbidden'
  | 'in-band-error'
  | 'malformed'
  | 'oversized'
  | 'rate-limited'
  | 'slow'
interface FigmaFixtureRequest {
  method: string
  path: string
  body: unknown
  authorized: boolean
  status: number
}
const USER = {
  id: FIGMA_FIXTURE_IDS.userId,
  handle: 'Fixture Designer',
  img_url: 'https://example.test/avatar.png',
}
const DATE = '2026-01-01T00:00:00Z'
const NODE = {
  id: '12:34',
  name: 'Card',
  type: 'FRAME',
  visible: false,
  children: [{ id: '12:35', name: 'Title', type: 'TEXT', characters: 'Fixture title' }],
}
const NODE_DATA = {
  document: NODE,
  components: {},
  componentSets: {},
  styles: {},
  schemaVersion: 0,
}
const FILE_INFO = {
  name: 'Fixture Design',
  role: 'owner',
  lastModified: DATE,
  editorType: 'figma',
  version: FIGMA_FIXTURE_IDS.versionId,
}
const COMMENT = {
  id: FIGMA_FIXTURE_IDS.commentId,
  file_key: FIGMA_FIXTURE_IDS.fileKey,
  user: USER,
  created_at: DATE,
  message: 'Fixture feedback',
  client_meta: { node_id: '12:34', node_offset: { x: 0, y: 0 } },
}
const PUBLISHED = {
  key: 'published-resource',
  file_key: FIGMA_FIXTURE_IDS.fileKey,
  node_id: '12:34',
  name: 'Primary',
  description: '',
  created_at: DATE,
  updated_at: DATE,
  user: USER,
}

/** Only provider transport is replaced; authentication, credentials, persistence, and execution stay real. */
export async function startFigmaProviderFixture(http: typeof NodeHTTP) {
  const requests: FigmaFixtureRequest[] = []
  let scenario: FigmaFixtureScenario = 'normal'
  const server = http.createServer(async (request, response) => {
    let text = ''
    for await (const chunk of request) {
      text += chunk.toString()
      if (Buffer.byteLength(text) > 1024 * 1024) {
        response.writeHead(413).end()
        return
      }
    }
    let body: unknown = null
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }
    const url = new URL(request.url ?? '/', 'https://api.figma.com')
    const entry: FigmaFixtureRequest = {
      method: request.method ?? 'GET',
      path: `${url.pathname}${url.search}`,
      body,
      authorized: request.headers.authorization === `Bearer ${FIGMA_FIXTURE_TOKEN}`,
      status: 200,
    }
    requests.push(entry)
    const send = (status: number, data: unknown) => {
      entry.status = status
      response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data))
    }
    if (url.pathname === '/v1/oauth/refresh' || url.pathname === '/v1/oauth/token') {
      const parameters = new URLSearchParams(text)
      entry.body = Object.fromEntries(parameters)
      entry.authorized =
        request.headers.authorization ===
          `Basic ${Buffer.from('figma-fixture-client:figma-fixture-secret').toString('base64')}` &&
        (url.pathname.endsWith('/refresh')
          ? parameters.size === 1 && parameters.get('refresh_token') === FIGMA_FIXTURE_REFRESH_TOKEN
          : parameters.get('grant_type') === 'authorization_code' &&
            parameters.get('code') === 'figma-fixture-code')
      if (!entry.authorized) return send(400, { error: 'invalid_grant' })
      return send(200, {
        access_token: FIGMA_FIXTURE_TOKEN,
        expires_in: 7776000,
        ...(url.pathname.endsWith('/token') ? { refresh_token: FIGMA_FIXTURE_REFRESH_TOKEN } : {}),
      })
    }
    if (!entry.authorized) return send(401, { status: 401, err: 'Invalid access token' })
    if (url.pathname === '/v1/me') return send(200, { ...USER, email: 'designer@figma.test' })
    if (scenario === 'forbidden')
      return send(403, { status: 403, err: 'Fixture permission denied' })
    if (scenario === 'in-band-error')
      return send(200, {
        status: 200,
        error: true,
        message: 'Fixture permission denied',
        meta: { images: {} },
      })
    if (scenario === 'rate-limited') {
      entry.status = 429
      response
        .writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '0' })
        .end(JSON.stringify({ status: 429, err: 'Fixture rate limited' }))
      return
    }
    if (scenario === 'slow') return
    if (scenario === 'malformed') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"file":')
      return
    }
    if (scenario === 'oversized') {
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(`{"padding":"${'x'.repeat(11 * 1024 * 1024)}"}`)
      return
    }
    const empty = scenario === 'empty'
    const root = `/v1/files/${FIGMA_FIXTURE_IDS.fileKey}`
    if (url.pathname === `${root}/meta`)
      return send(200, {
        file: { name: FILE_INFO.name, last_touched_at: DATE, creator: USER, editorType: 'figma' },
      })
    if (url.pathname === root)
      return send(200, {
        ...FILE_INFO,
        ...NODE_DATA,
        document: { id: '0:0', name: 'Document', type: 'DOCUMENT', children: [NODE] },
      })
    if (url.pathname === `${root}/nodes`)
      return send(200, {
        ...FILE_INFO,
        nodes: Object.fromEntries(
          (url.searchParams.get('ids') ?? '')
            .split(',')
            .map((id) => [id, id === '12:34' ? NODE_DATA : null])
        ),
      })
    if (url.pathname === `/v1/images/${FIGMA_FIXTURE_IDS.fileKey}`)
      return send(200, {
        err: null,
        images: Object.fromEntries(
          (url.searchParams.get('ids') ?? '')
            .split(',')
            .map((id) => [id, id === '12:34' ? 'https://example.test/export.png' : null])
        ),
      })
    if (url.pathname === `${root}/images`)
      return send(200, {
        error: false,
        status: 200,
        meta: { images: empty ? {} : { imageRef: 'https://example.test/fill.png' } },
      })
    if (url.pathname === `${root}/comments` && entry.method === 'GET')
      return send(200, { comments: empty ? [] : [COMMENT] })
    if (url.pathname === `${root}/comments` && entry.method === 'POST')
      return send(200, { ...COMMENT, ...(typeof body === 'object' && body ? body : {}) })
    if (
      url.pathname === `${root}/comments/${FIGMA_FIXTURE_IDS.commentId}` &&
      entry.method === 'DELETE'
    ) {
      entry.status = 204
      response.writeHead(204).end()
      return
    }
    if (url.pathname === `${root}/versions`)
      return send(200, {
        versions: empty ? [] : [{ id: FIGMA_FIXTURE_IDS.versionId, created_at: DATE, user: USER }],
        pagination: empty
          ? {}
          : {
              next_page: `https://api.figma.com${root}/versions?before=${FIGMA_FIXTURE_IDS.versionId}`,
            },
      })
    if (url.pathname === `${root}/components`)
      return send(200, {
        error: false,
        status: 200,
        meta: {
          components: empty
            ? []
            : [{ ...PUBLISHED, containing_frame: { pageId: '0:1', pageName: 'Page' } }],
        },
      })
    if (url.pathname === `${root}/styles`)
      return send(200, {
        error: false,
        status: 200,
        meta: { styles: empty ? [] : [{ ...PUBLISHED, style_type: 'FILL', sort_position: '0' }] },
      })
    return send(404, { status: 404, err: 'Unknown fixture route' })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    setScenario(value: FigmaFixtureScenario) {
      scenario = value
    },
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    },
  }
}

export function installFigmaTransport(
  origin: string,
  { http, https, net }: { http: typeof NodeHTTP; https: typeof NodeHTTPS; net: typeof NodeNet }
) {
  const fixture = new URL(origin)
  if (fixture.protocol !== 'http:' || fixture.hostname !== '127.0.0.1') {
    throw new Error('Figma fixture transport requires a loopback HTTP origin')
  }
  const realLookup = dns.lookup
  const realRequest = https.request
  const realFetch = globalThis.fetch
  const realSocketConnect = net.Socket.prototype.connect
  const loopback = (host: string) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)
  const lookup = (async (hostname: string, options?: { all?: boolean } | number) => {
    if (hostname === 'api.figma.com') {
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
      options.hostname !== 'api.figma.com' ||
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
        headers: { ...options.headers, host: 'api.figma.com' },
      },
      callback
    )
  }) as typeof https.request
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.origin === 'https://api.figma.com' && !url.username && !url.password) {
      const target = new URL(fixture)
      target.pathname = url.pathname
      target.search = url.search
      return realFetch(new Request(target, request))
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
