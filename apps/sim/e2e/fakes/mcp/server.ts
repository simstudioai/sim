import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { generateId } from '@sim/utils/id'
import { z } from 'zod'

export const E2E_MCP_TOOL = {
  name: 'e2e_lookup',
  description: 'Looks up a deterministic E2E fixture by query.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Fixture query to look up.',
      },
    },
    required: ['query'],
  },
} as const

const MCP_PATH = '/mcp'
const JSON_CONTENT_TYPE = 'application/json'
const DEFAULT_MAX_BODY_BYTES = 64 * 1024
const MAX_SESSION_HEADER_BYTES = 256
const MAX_RECORDED_PATH_LENGTH = 256
const MAX_RECORDED_RPC_METHOD_LENGTH = 128
const EXPECTED_RPC_METHODS = new Set([
  'initialize',
  'notifications/initialized',
  'tools/list',
  'ping',
])

export interface McpFakeRequestRecord {
  sequence: number
  method: string
  path: string
  rpcMethod?: string
  status: number
  session: string | null
  unexpected: boolean
}

export interface McpFakeServerOptions {
  hostname?: '127.0.0.1'
  maxBodyBytes?: number
  port?: number
}

export interface McpFakeServer {
  readonly baseUrl: string | null
  readonly requestLog: readonly McpFakeRequestRecord[]
  start(): Promise<string>
  stop(): Promise<void>
}

interface SessionContext {
  label: string
  server: McpServer
  transport: StreamableHTTPServerTransport
}

interface JsonRpcEnvelope {
  jsonrpc?: unknown
  method?: unknown
}

class RequestBodyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number
  ) {
    super(message)
  }
}

function validateOptions(options: McpFakeServerOptions): void {
  if (
    options.port !== undefined &&
    (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)
  ) {
    throw new Error('MCP fake port must be an integer from 0 to 65535')
  }
  if (
    options.maxBodyBytes !== undefined &&
    (!Number.isInteger(options.maxBodyBytes) || options.maxBodyBytes < 1)
  ) {
    throw new Error('MCP fake maxBodyBytes must be a positive integer')
  }
}

function cloneRequestLog(records: McpFakeRequestRecord[]): McpFakeRequestRecord[] {
  return structuredClone(records)
}

function sendJsonRpcError(
  response: ServerResponse,
  status: number,
  code: number,
  message: string
): void {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  })
  response.writeHead(status, {
    'content-length': Buffer.byteLength(body),
    'content-type': `${JSON_CONTENT_TYPE}; charset=utf-8`,
  })
  response.end(body)
}

function getSingleHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name]
  return Array.isArray(value) ? value[0] : value
}

function getRpcMethod(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const method = (body as JsonRpcEnvelope).method
  return typeof method === 'string' ? method : undefined
}

function boundedRecordValue(value: string, maxLength: number, overflowLabel: string): string {
  return value.length <= maxLength ? value : overflowLabel
}

async function readJsonBody(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const contentType = getSingleHeader(request, 'content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase()
  if (contentType !== JSON_CONTENT_TYPE) {
    throw new RequestBodyError(`MCP fake requires ${JSON_CONTENT_TYPE}`, 415, -32000)
  }

  const declaredLength = Number(getSingleHeader(request, 'content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    request.resume()
    throw new RequestBodyError('MCP fake request body is too large', 413, -32000)
  }

  const chunks: Buffer[] = []
  let totalBytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.length
    if (totalBytes > maxBodyBytes) {
      request.resume()
      throw new RequestBodyError('MCP fake request body is too large', 413, -32000)
    }
    chunks.push(buffer)
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new RequestBodyError('MCP fake received invalid JSON', 400, -32700)
  }
}

function createSessionServer(): McpServer {
  const server = new McpServer(
    { name: 'sim-e2e-mcp-fake', version: '1.0.0' },
    { capabilities: { tools: {} } }
  )
  server.registerTool(
    E2E_MCP_TOOL.name,
    {
      description: E2E_MCP_TOOL.description,
      inputSchema: {
        query: z.string().describe(E2E_MCP_TOOL.inputSchema.properties.query.description),
      },
    },
    async ({ query }) => ({
      content: [{ type: 'text', text: `fixture:${query}` }],
    })
  )
  return server
}

/**
 * Creates an orchestrator-owned Streamable HTTP MCP fake. It listens only on
 * numeric IPv4 loopback while advertising the allowlisted E2E hostname.
 */
export function createMcpFakeServer(options: McpFakeServerOptions = {}): McpFakeServer {
  validateOptions(options)

  const hostname = options.hostname ?? '127.0.0.1'
  const port = options.port ?? 0
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const records: McpFakeRequestRecord[] = []
  const sessions = new Map<string, SessionContext>()
  let sequence = 0
  let sessionSequence = 0
  let baseUrl: string | null = null

  const labelForSession = (sessionId: string | undefined): string | null =>
    sessionId ? (sessions.get(sessionId)?.label ?? null) : null

  const createSession = async (): Promise<SessionContext> => {
    sessionSequence += 1
    const label = `session-${sessionSequence}`
    const server = createSessionServer()
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: generateId,
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, context)
      },
      onsessionclosed: (sessionId) => {
        sessions.delete(sessionId)
      },
    })
    const context = { label, server, transport } satisfies SessionContext
    await server.connect(transport)
    return context
  }

  const handleRequest = async (
    request: IncomingMessage,
    response: ServerResponse,
    observeRecord: (record: McpFakeRequestRecord) => void
  ): Promise<void> => {
    sequence += 1
    const method = request.method?.toUpperCase() ?? 'UNKNOWN'
    const url = new URL(request.url ?? '/', 'http://mcp-fake.invalid')
    const sessionId = getSingleHeader(request, 'mcp-session-id')
    const record: McpFakeRequestRecord = {
      sequence,
      method,
      path: boundedRecordValue(url.pathname, MAX_RECORDED_PATH_LENGTH, '<oversized-path>'),
      status: 500,
      session: labelForSession(sessionId),
      unexpected: false,
    }
    records.push(record)
    observeRecord(record)

    if (url.pathname !== MCP_PATH || url.search !== '') {
      record.unexpected = true
      record.status = 404
      sendJsonRpcError(response, record.status, -32001, 'MCP endpoint not found')
      return
    }

    if (sessionId && Buffer.byteLength(sessionId) > MAX_SESSION_HEADER_BYTES) {
      record.unexpected = true
      record.status = 400
      sendJsonRpcError(response, record.status, -32600, 'Invalid MCP session identifier')
      return
    }

    if (method === 'GET') {
      record.status = 405
      response.writeHead(record.status, {
        allow: 'POST, DELETE',
        'content-length': '0',
      })
      response.end()
      return
    }

    if (method === 'DELETE') {
      const context = sessionId ? sessions.get(sessionId) : undefined
      if (!context) {
        record.unexpected = true
        record.status = sessionId ? 404 : 400
        sendJsonRpcError(
          response,
          record.status,
          sessionId ? -32001 : -32000,
          sessionId ? 'MCP session not found' : 'MCP session identifier is required'
        )
        return
      }
      record.session = context.label
      await context.transport.handleRequest(request, response)
      record.status = response.statusCode
      return
    }

    if (method !== 'POST') {
      record.unexpected = true
      record.status = 405
      sendJsonRpcError(response, record.status, -32000, 'Method not allowed')
      return
    }

    let body: unknown
    try {
      body = await readJsonBody(request, maxBodyBytes)
    } catch (error) {
      const bodyError =
        error instanceof RequestBodyError
          ? error
          : new RequestBodyError('Unable to read MCP request body', 400, -32700)
      record.unexpected = true
      record.status = bodyError.status
      sendJsonRpcError(response, bodyError.status, bodyError.code, bodyError.message)
      return
    }

    const rpcMethod = getRpcMethod(body)
    record.rpcMethod = rpcMethod
      ? boundedRecordValue(rpcMethod, MAX_RECORDED_RPC_METHOD_LENGTH, '<oversized-method>')
      : undefined
    const validEnvelope =
      typeof body === 'object' &&
      body !== null &&
      !Array.isArray(body) &&
      (body as JsonRpcEnvelope).jsonrpc === '2.0' &&
      rpcMethod !== undefined
    if (!validEnvelope) {
      record.unexpected = true
      record.status = 400
      sendJsonRpcError(response, record.status, -32600, 'Invalid JSON-RPC request')
      return
    }
    if (!EXPECTED_RPC_METHODS.has(rpcMethod)) record.unexpected = true

    let context: SessionContext | undefined
    if (isInitializeRequest(body)) {
      if (sessionId) {
        context = sessions.get(sessionId)
        record.unexpected = true
      } else {
        context = await createSession()
      }
    } else {
      context = sessionId ? sessions.get(sessionId) : undefined
    }

    if (!context) {
      record.unexpected = true
      record.status = sessionId ? 404 : 400
      sendJsonRpcError(
        response,
        record.status,
        sessionId ? -32001 : -32000,
        sessionId ? 'MCP session not found' : 'MCP session identifier is required'
      )
      return
    }

    record.session = context.label
    await context.transport.handleRequest(request, response, body)
    record.status = response.statusCode
    record.session = labelForSession(context.transport.sessionId) ?? context.label
  }

  const server: Server = createServer((request, response) => {
    let requestRecord: McpFakeRequestRecord | undefined
    void handleRequest(request, response, (record) => {
      requestRecord = record
    }).catch(() => {
      const record = requestRecord
      if (record) {
        record.unexpected = true
        record.status = 500
      }
      if (!response.headersSent) {
        sendJsonRpcError(response, 500, -32603, 'MCP fake internal error')
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
      baseUrl = `http://mcp.e2e.sim.ai:${address.port}${MCP_PATH}`
      return baseUrl
    },
    async stop() {
      const failures: unknown[] = []
      for (const context of new Set(sessions.values())) {
        try {
          await context.server.close()
        } catch (error) {
          failures.push(error)
        }
      }
      sessions.clear()
      if (server.listening) {
        try {
          await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()))
            server.closeIdleConnections()
            server.closeAllConnections()
          })
        } catch (error) {
          failures.push(error)
        }
      }
      baseUrl = null
      if (failures.length > 0) {
        throw new AggregateError(failures, 'Unable to stop MCP fake server')
      }
    },
  }
}

/** Starts the MCP fake in one call for orchestration code. */
export async function startMcpFakeServer(
  options: McpFakeServerOptions = {}
): Promise<McpFakeServer> {
  const server = createMcpFakeServer(options)
  await server.start()
  return server
}
