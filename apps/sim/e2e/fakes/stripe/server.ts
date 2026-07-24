import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export const STRIPE_FAKE_ENDPOINTS = {
  health: '/health',
  requestLog: '/__control/requests',
  reset: '/__control/reset',
  // Co-locate the only other server-side external boundary so the E2E stack needs one loopback fake.
  telemetry: '/v1/traces',
} as const

const DEFAULT_MAX_BODY_BYTES = 64 * 1024
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded'

export interface StripeFakeRequestRecord {
  sequence: number
  method: string
  path: string
  unexpected: boolean
}

export interface StripeFakeServerOptions {
  apiKey: string
  hostname?: '127.0.0.1'
  maxBodyBytes?: number
  port?: number
}

export interface StripeFakeServer {
  readonly baseUrl: string | null
  readonly requestLog: readonly StripeFakeRequestRecord[]
  start(): Promise<string>
  stop(): Promise<void>
  reset(): void
}

interface FakeCustomer {
  id: string
  object: 'customer'
  created: number
  email: string | null
  livemode: false
  metadata: Record<string, string>
  name: string | null
}

interface StripeError {
  type: 'api_error' | 'invalid_request_error'
  code: string
  message: string
}

class RequestBodyError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

function isExpectedStripeRequest(method: string, path: string): boolean {
  return (
    ((method === 'GET' || method === 'POST') && path === '/v1/customers/search') ||
    (method === 'GET' && path === '/v1/customers') ||
    (method === 'POST' && path === '/v1/customers') ||
    (method === 'GET' && path === '/v1/invoices') ||
    (method === 'POST' && path === STRIPE_FAKE_ENDPOINTS.telemetry) ||
    (method === 'GET' && /^\/v1\/customers\/cus_e2e_[a-f0-9]+$/.test(path))
  )
}

function secureEqual(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false

  const actualBuffer = Buffer.from(actual)
  const expectedBuffer = Buffer.from(expected)
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  )
}

function cloneRequestLog(records: StripeFakeRequestRecord[]): StripeFakeRequestRecord[] {
  return structuredClone(records)
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  requestId?: string
): void {
  const serialized = JSON.stringify(body)
  response.writeHead(status, {
    'content-length': Buffer.byteLength(serialized),
    'content-type': 'application/json; charset=utf-8',
    ...(requestId ? { 'request-id': requestId } : {}),
  })
  response.end(serialized)
}

function sendStripeError(
  response: ServerResponse,
  status: number,
  error: StripeError,
  requestId: string
): void {
  sendJson(response, status, { error }, requestId)
}

async function readRequestBody(request: IncomingMessage, maxBodyBytes: number): Promise<string> {
  const chunks: Buffer[] = []
  let totalBytes = 0

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.length
    if (totalBytes > maxBodyBytes) {
      throw new RequestBodyError('Request body exceeds the Stripe fake limit', 413)
    }
    chunks.push(buffer)
  }

  return Buffer.concat(chunks).toString('utf8')
}

function parseFormBody(request: IncomingMessage, rawBody: string): URLSearchParams {
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== FORM_CONTENT_TYPE) {
    throw new RequestBodyError(`Stripe fake requires ${FORM_CONTENT_TYPE}`, 400)
  }
  return new URLSearchParams(rawBody)
}

function metadataFrom(parameters: URLSearchParams): Record<string, string> {
  const metadata: Record<string, string> = {}
  for (const [key, value] of parameters) {
    const match = /^metadata\[([^\]]+)\]$/.exec(key)
    if (match) metadata[match[1]] = value
  }
  return metadata
}

function stableCustomerIdentity(parameters: URLSearchParams): string {
  const metadata = metadataFrom(parameters)
  const preferredIdentity =
    metadata.userId || metadata.organizationId || parameters.get('email') || undefined
  if (preferredIdentity) return preferredIdentity

  return [...parameters.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      `${leftKey}\u0000${leftValue}`.localeCompare(`${rightKey}\u0000${rightValue}`)
    )
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
}

function createDeterministicCustomer(parameters: URLSearchParams): FakeCustomer {
  const digest = createHash('sha256').update(stableCustomerIdentity(parameters)).digest('hex')
  return {
    id: `cus_e2e_${digest.slice(0, 24)}`,
    object: 'customer',
    created: 1_700_000_000 + (Number.parseInt(digest.slice(0, 6), 16) % 1_000_000),
    email: parameters.get('email'),
    livemode: false,
    metadata: metadataFrom(parameters),
    name: parameters.get('name'),
  }
}

function unescapeSearchValue(value: string): string {
  return value.replace(/\\(["\\])/g, '$1')
}

function parseSupportedCustomerSearchEmail(query: string): string {
  const match = /^email:"((?:\\.|[^"])*)" AND -metadata\["customerType"\]:"organization"$/.exec(
    query
  )
  if (!match) {
    throw new RequestBodyError(
      `Stripe fake does not implement customer search query: ${query}`,
      501
    )
  }
  return unescapeSearchValue(match[1])
}

function parseLimit(parameters: URLSearchParams): number {
  const rawLimit = parameters.get('limit')
  if (rawLimit === null) return 10

  const limit = Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RequestBodyError('Stripe fake requires limit to be an integer from 1 to 100', 400)
  }
  return limit
}

function assertSupportedInvoiceList(
  parameters: URLSearchParams,
  customers: ReadonlyMap<string, FakeCustomer>
): void {
  const allowedKeys = new Set(['customer', 'limit', 'expand[0]', 'starting_after'])
  for (const key of new Set(parameters.keys())) {
    if (!allowedKeys.has(key)) {
      throw new RequestBodyError(`Stripe fake does not implement invoice parameter: ${key}`, 501)
    }
  }

  const customerValues = parameters.getAll('customer')
  const limitValues = parameters.getAll('limit')
  const expandValues = parameters.getAll('expand[0]')
  const cursorValues = parameters.getAll('starting_after')
  if (
    customerValues.length !== 1 ||
    limitValues.length !== 1 ||
    expandValues.length !== 1 ||
    cursorValues.length > 1
  ) {
    throw new RequestBodyError('Stripe fake requires one value for each invoice parameter', 501)
  }

  const customerId = customerValues[0]
  if (!customerId || !customers.has(customerId)) {
    throw new RequestBodyError(`Stripe fake does not know invoice customer: ${customerId}`, 501)
  }
  if (limitValues[0] !== '20' || expandValues[0] !== 'data.lines') {
    throw new RequestBodyError('Stripe fake received an unsupported invoice list shape', 501)
  }
  if (cursorValues.length === 1 && !cursorValues[0]) {
    throw new RequestBodyError('Stripe fake requires a non-empty invoice cursor', 501)
  }
}

function validateTestApiKey(apiKey: string): void {
  if (!apiKey.startsWith('sk_test_') || apiKey.length === 'sk_test_'.length) {
    throw new Error('Stripe fake apiKey must be a non-empty sk_test_ secret key')
  }
}

function validateServerOptions(options: StripeFakeServerOptions): void {
  validateTestApiKey(options.apiKey)
  if (
    options.port !== undefined &&
    (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)
  ) {
    throw new Error('Stripe fake port must be an integer from 0 to 65535')
  }
  if (
    options.maxBodyBytes !== undefined &&
    (!Number.isInteger(options.maxBodyBytes) || options.maxBodyBytes < 1)
  ) {
    throw new Error('Stripe fake maxBodyBytes must be a positive integer')
  }
}

/**
 * Creates a loopback-only Stripe fake. The returned server is inert until start()
 * is called, allowing an orchestrator to own lifecycle and failure handling.
 */
export function createStripeFakeServer(options: StripeFakeServerOptions): StripeFakeServer {
  validateServerOptions(options)

  const hostname = options.hostname ?? '127.0.0.1'
  const port = options.port ?? 0
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const expectedAuthorization = `Bearer ${options.apiKey}`
  const records: StripeFakeRequestRecord[] = []
  const customers = new Map<string, FakeCustomer>()
  let sequence = 0
  let baseUrl: string | null = null

  const reset = (): void => {
    records.length = 0
    customers.clear()
    sequence = 0
  }

  const handleControlRequest = (
    request: IncomingMessage,
    response: ServerResponse,
    method: string,
    path: string
  ): boolean => {
    if (method === 'GET' && path === STRIPE_FAKE_ENDPOINTS.health) {
      sendJson(response, 200, { status: 'ok', service: 'stripe-fake' })
      return true
    }

    const isRequestLog = method === 'GET' && path === STRIPE_FAKE_ENDPOINTS.requestLog
    const isReset = method === 'POST' && path === STRIPE_FAKE_ENDPOINTS.reset
    if (!isRequestLog && !isReset) return false

    if (!secureEqual(request.headers.authorization, expectedAuthorization)) {
      sendStripeError(
        response,
        401,
        {
          type: 'invalid_request_error',
          code: 'api_key_invalid',
          message: 'Invalid test Bearer authorization for Stripe fake control endpoint.',
        },
        'req_e2e_control'
      )
      return true
    }

    if (isRequestLog) {
      sendJson(response, 200, { requests: cloneRequestLog(records) })
    } else {
      reset()
      sendJson(response, 200, { reset: true })
    }
    return true
  }

  const handleStripeRequest = async (
    request: IncomingMessage,
    response: ServerResponse,
    method: string,
    url: URL
  ): Promise<void> => {
    sequence += 1
    const requestId = `req_e2e_${String(sequence).padStart(6, '0')}`
    const expected = isExpectedStripeRequest(method, url.pathname)
    let formBody: URLSearchParams | null = null

    try {
      if (method !== 'GET' && method !== 'HEAD') {
        const rawBody = await readRequestBody(request, maxBodyBytes)
        if (rawBody) {
          if (request.headers['content-type']?.startsWith(FORM_CONTENT_TYPE)) {
            formBody = new URLSearchParams(rawBody)
          }
        }
      }
    } catch (error) {
      records.push({
        sequence,
        method,
        path: url.pathname,
        unexpected: !expected,
      })
      const bodyError =
        error instanceof RequestBodyError
          ? error
          : new RequestBodyError('Unable to read Stripe fake request body', 400)
      sendStripeError(
        response,
        bodyError.status,
        {
          type: 'invalid_request_error',
          code: 'invalid_request_body',
          message: bodyError.message,
        },
        requestId
      )
      return
    }

    records.push({
      sequence,
      method,
      path: url.pathname,
      unexpected: !expected,
    })

    if (method === 'POST' && url.pathname === STRIPE_FAKE_ENDPOINTS.telemetry) {
      sendJson(response, 200, { partialSuccess: {} }, requestId)
      return
    }

    if (!secureEqual(request.headers.authorization, expectedAuthorization)) {
      sendStripeError(
        response,
        401,
        {
          type: 'invalid_request_error',
          code: 'api_key_invalid',
          message: 'Invalid test Bearer authorization for Stripe fake.',
        },
        requestId
      )
      return
    }

    if (!expected) {
      sendStripeError(
        response,
        501,
        {
          type: 'api_error',
          code: 'stripe_fake_unimplemented',
          message: `Stripe fake does not implement ${method} ${url.pathname}.`,
        },
        requestId
      )
      return
    }

    try {
      if ((method === 'GET' || method === 'POST') && url.pathname === '/v1/customers/search') {
        const parameters =
          method === 'GET' ? url.searchParams : (formBody ?? parseFormBody(request, ''))
        const query = parameters.get('query')
        if (!query) throw new RequestBodyError('Stripe fake customer search requires query', 400)
        const email = parseSupportedCustomerSearchEmail(query)

        const data = [...customers.values()]
          .filter(
            (customer) =>
              customer.email === email && customer.metadata.customerType !== 'organization'
          )
          .slice(0, parseLimit(parameters))
        sendJson(
          response,
          200,
          {
            object: 'search_result',
            data,
            has_more: false,
            next_page: null,
            url: '/v1/customers/search',
          },
          requestId
        )
        return
      }

      if (method === 'GET' && url.pathname === '/v1/customers') {
        const email = url.searchParams.get('email')
        const data = [...customers.values()]
          .filter((customer) => email === null || customer.email === email)
          .slice(0, parseLimit(url.searchParams))
        sendJson(
          response,
          200,
          {
            object: 'list',
            data,
            has_more: false,
            url: '/v1/customers',
          },
          requestId
        )
        return
      }

      if (method === 'GET' && url.pathname === '/v1/invoices') {
        assertSupportedInvoiceList(url.searchParams, customers)
        sendJson(
          response,
          200,
          {
            object: 'list',
            data: [],
            has_more: false,
            url: '/v1/invoices',
          },
          requestId
        )
        return
      }

      if (method === 'GET' && url.pathname.startsWith('/v1/customers/')) {
        const customerId = decodeURIComponent(url.pathname.slice('/v1/customers/'.length))
        const customer = customers.get(customerId)
        if (!customer) {
          sendStripeError(
            response,
            404,
            {
              type: 'invalid_request_error',
              code: 'resource_missing',
              message: `No such customer: ${customerId}`,
            },
            requestId
          )
          return
        }
        sendJson(response, 200, customer, requestId)
        return
      }

      const parameters = formBody ?? parseFormBody(request, '')
      const candidate = createDeterministicCustomer(parameters)
      const customer = customers.get(candidate.id) ?? candidate
      customers.set(customer.id, customer)
      sendJson(response, 200, customer, requestId)
    } catch (error) {
      const bodyError =
        error instanceof RequestBodyError
          ? error
          : new RequestBodyError('Stripe fake rejected malformed request parameters', 400)
      if (bodyError.status === 501) {
        const recorded = records.at(-1)
        if (recorded) recorded.unexpected = true
      }
      sendStripeError(
        response,
        bodyError.status,
        {
          type: 'invalid_request_error',
          code: 'invalid_request',
          message: bodyError.message,
        },
        requestId
      )
    }
  }

  const server: Server = createServer((request, response) => {
    const method = request.method?.toUpperCase() ?? 'UNKNOWN'
    const url = new URL(request.url ?? '/', 'http://stripe-fake.invalid')
    if (handleControlRequest(request, response, method, url.pathname)) return

    void handleStripeRequest(request, response, method, url).catch(() => {
      if (!response.headersSent) {
        sendStripeError(
          response,
          500,
          {
            type: 'api_error',
            code: 'stripe_fake_internal_error',
            message: 'Stripe fake encountered an internal error.',
          },
          'req_e2e_internal'
        )
      } else {
        response.destroy()
      }
    })
  })

  return {
    get baseUrl() {
      return baseUrl
    },
    get requestLog() {
      return cloneRequestLog(records)
    },
    async start() {
      if (baseUrl) return baseUrl

      await new Promise<void>((resolve, reject) => {
        const handleError = (error: Error) => {
          server.off('listening', handleListening)
          reject(error)
        }
        const handleListening = () => {
          server.off('error', handleError)
          resolve()
        }
        server.once('error', handleError)
        server.once('listening', handleListening)
        server.listen(port, hostname)
      })

      const address = server.address() as AddressInfo
      const urlHostname = address.family === 'IPv6' ? `[${address.address}]` : address.address
      baseUrl = `http://${urlHostname}:${address.port}`
      return baseUrl
    },
    async stop() {
      if (!server.listening) {
        baseUrl = null
        return
      }

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
        server.closeIdleConnections()
      })
      baseUrl = null
    },
    reset,
  }
}

/** Starts a Stripe fake in one call for orchestration code. */
export async function startStripeFakeServer(
  options: StripeFakeServerOptions
): Promise<StripeFakeServer> {
  const server = createStripeFakeServer(options)
  await server.start()
  return server
}
