/**
 * Network host for the isolated-vm worker.
 *
 * Runs the unchanged `isolated-vm-worker.cjs` in a separate service that holds
 * no platform credentials. Each authenticated WebSocket connection owns
 * exactly one worker child process: messages are relayed verbatim between the
 * socket and the child's IPC channel, closing the socket kills the child, and
 * the child exiting closes the socket. The app's pool in `isolated-vm.ts`
 * therefore treats a connection exactly like a locally spawned worker.
 *
 * Wire contract (`/v1/worker`): one JSON object per text frame. The first
 * client frame is `{ type: 'auth', token, env }`, where `env` carries the
 * worker settings the app owns (limits, timezone, locale); after it, frames
 * are the objects the worker
 * exchanges over IPC. Host-originated frames are `{ type: 'host:heartbeat' }`
 * every 30s and `{ type: 'host:draining' }` on SIGTERM, after which the app
 * retires the connection once its executions finish. A load balancer that
 * deregisters this host sends nothing until SIGTERM, so the app also retires
 * each connection at a maximum age, and a deregistered host drains as its
 * connections age out. A breaking change to the
 * contract gets a new path served alongside this one until every client has
 * rolled.
 *
 * Environment:
 * - `IVM_HOST_TOKEN` (required, >= 32 chars): token clients present.
 * - `IVM_HOST_PORT` (default 3100)
 * - `IVM_HOST_MAX_WORKERS` (default 16): concurrent worker processes.
 * - `IVM_HOST_MAX_MESSAGE_BYTES` (default 64 MiB): largest accepted frame.
 * - `IVM_HOST_DRAIN_TIMEOUT_MS` (default 110000): SIGTERM grace before exit.
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { WebSocketServer } = require('ws')

const WORKER_PATH = '/v1/worker'
const HEARTBEAT_INTERVAL_MS = 30000
const AUTH_TIMEOUT_MS = 5000
/**
 * Raw bytes a connection may send before it authenticates: the auth frame is
 * well under 1 KiB. Without this, `maxPayload` lets every unauthenticated
 * connection make the host buffer a full-size frame.
 */
const MAX_PRE_AUTH_BYTES = 16 * 1024
const WORKER_START_TIMEOUT_MS = 10000
const MAX_STARTUP_STDERR_CHARS = 64 * 1024
const MIN_TOKEN_LENGTH = 32
const UNAUTHORIZED_CLOSE_CODE = 4401
const ALLOWED_INBOUND_TYPES = new Set(['execute', 'cancel', 'fetchResponse', 'brokerResponse'])
/** Worker settings a client may set, each with the only shape it accepts. */
const CLIENT_WORKER_ENV = {
  IVM_MAX_STDOUT_CHARS: /^\d{1,12}$/,
  IVM_MAX_FETCH_OPTIONS_JSON_CHARS: /^\d{1,12}$/,
  TZ: /^:?[A-Za-z0-9_+\-/]{1,64}$/,
  LANG: /^[A-Za-z0-9_.@-]{1,64}$/,
  LC_ALL: /^[A-Za-z0-9_.@-]{1,64}$/,
}

function readPositiveInt(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function log(level, message, fields) {
  const line = JSON.stringify({ level, message, ...fields, timestamp: new Date().toISOString() })
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`)
  else process.stdout.write(`${line}\n`)
}

// The worker is spawned with this binary, and isolated-vm only loads in Node.
if (process.versions.bun) {
  log('error', 'The isolated-vm worker host must run under Node.js, not Bun')
  process.exit(1)
}

const PORT = readPositiveInt('IVM_HOST_PORT', 3100)
const MAX_WORKERS = readPositiveInt('IVM_HOST_MAX_WORKERS', 16)
/** Unauthenticated connections are bounded on their own, so they never hold a worker slot. */
const MAX_PENDING_AUTH = MAX_WORKERS * 4
const MAX_MESSAGE_BYTES = readPositiveInt('IVM_HOST_MAX_MESSAGE_BYTES', 64 * 1024 * 1024)
const DRAIN_TIMEOUT_MS = readPositiveInt('IVM_HOST_DRAIN_TIMEOUT_MS', 110000)

const token = process.env.IVM_HOST_TOKEN || ''
if (token.length < MIN_TOKEN_LENGTH) {
  log('error', `IVM_HOST_TOKEN must be set to at least ${MIN_TOKEN_LENGTH} characters`)
  process.exit(1)
}
const tokenDigest = crypto.createHash('sha256').update(token).digest()

const workerScript = path.join(__dirname, 'isolated-vm-worker.cjs')
if (!fs.existsSync(workerScript)) {
  log('error', 'Worker script not found', { workerScript })
  process.exit(1)
}

function isAuthorized(presented) {
  if (typeof presented !== 'string') return false
  const digest = crypto.createHash('sha256').update(presented).digest()
  return crypto.timingSafeEqual(digest, tokenDigest)
}

/**
 * Mirrors `buildWorkerEnv()` in `isolated-vm.ts`: the worker runs untrusted
 * code and receives an explicit allowlist, never this process's environment.
 * Settings the app owns come from the client, so a remote worker behaves like
 * a local one.
 */
function buildWorkerEnv(clientEnv) {
  const workerEnv = {}
  for (const key of ['PATH', 'NODE_ENV']) {
    if (process.env[key] !== undefined) workerEnv[key] = process.env[key]
  }
  if (clientEnv && typeof clientEnv === 'object') {
    for (const [key, pattern] of Object.entries(CLIENT_WORKER_ENV)) {
      const value = clientEnv[key]
      if (typeof value === 'string' && pattern.test(value)) workerEnv[key] = value
    }
  }
  return workerEnv
}

function rejectUpgrade(socket, status, reason) {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () =>
    socket.destroy()
  )
}

const workers = new Set()
let pendingConnections = 0
let draining = false
let nextConnectionId = 0

const server = http.createServer((req, res) => {
  // Liveness: the process is up. Stays 200 while draining so an orchestrator
  // never kills a task that is finishing in-flight executions.
  if (req.method === 'GET' && req.url === '/livez') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"status":"ok"}')
    return
  }
  // Readiness: 503 while draining, so load balancers stop routing new workers here.
  if (req.method === 'GET' && req.url === '/health') {
    const status = draining ? 503 : 200
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        status: draining ? 'draining' : 'ok',
        workers: workers.size,
        maxWorkers: MAX_WORKERS,
      })
    )
    return
  }
  res.writeHead(404)
  res.end()
})
server.headersTimeout = 10000
server.requestTimeout = 10000

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_MESSAGE_BYTES,
  perMessageDeflate: false,
})

server.on('upgrade', (req, socket, head) => {
  socket.on('error', () => socket.destroy())
  let pathname
  try {
    pathname = new URL(req.url || '/', 'http://host').pathname
  } catch {
    rejectUpgrade(socket, 400, 'Bad Request')
    return
  }
  if (pathname !== WORKER_PATH) {
    rejectUpgrade(socket, 404, 'Not Found')
    return
  }
  if (draining) {
    rejectUpgrade(socket, 503, 'Service Unavailable')
    return
  }
  if (workers.size >= MAX_WORKERS || pendingConnections >= MAX_PENDING_AUTH) {
    log('warn', 'Rejected worker connection at capacity', { maxWorkers: MAX_WORKERS })
    rejectUpgrade(socket, 503, 'Service Unavailable')
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => authenticate(ws, socket))
})

/** Admits the connection to a worker slot only once its first frame proves it holds the token. */
function authenticate(ws, socket) {
  pendingConnections++
  let settled = false
  let authenticated = false
  let preAuthBytes = 0
  // Counts what arrives on the TCP socket, so an oversized frame is cut off as it streams in
  // rather than after ws has buffered all of it.
  const onPreAuthData = (chunk) => {
    // ws parses each chunk before this listener runs, so the chunk that authenticated still arrives.
    // A refused connection stays counted: its peer may ignore the close and keep sending.
    if (authenticated) return
    preAuthBytes += chunk.length
    if (preAuthBytes <= MAX_PRE_AUTH_BYTES) return
    if (settle()) {
      log('warn', 'Rejected worker connection', { reason: 'too much data before authentication' })
    }
    socket.destroy()
  }
  const settle = () => {
    if (settled) return false
    settled = true
    pendingConnections--
    clearTimeout(authTimeout)
    return true
  }
  const refuse = (reason) => {
    if (!settle()) return
    log('warn', 'Rejected worker connection', { reason })
    ws.close(UNAUTHORIZED_CLOSE_CODE, 'unauthorized')
  }
  const authTimeout = setTimeout(() => refuse('authentication timed out'), AUTH_TIMEOUT_MS)
  socket.on('data', onPreAuthData)
  const onPreAuthError = (error) => {
    log('warn', 'Worker connection error before authentication', { error: error.message })
  }
  ws.on('error', onPreAuthError)

  ws.once('message', (data, isBinary) => {
    let message
    try {
      message = isBinary ? undefined : JSON.parse(data.toString())
    } catch {}
    if (!message || message.type !== 'auth' || !isAuthorized(message.token)) {
      refuse('invalid credentials')
      return
    }
    if (!settle()) return
    authenticated = true
    socket.off('data', onPreAuthData)
    if (draining) {
      ws.close(1012, 'draining')
      return
    }
    if (workers.size >= MAX_WORKERS) {
      log('warn', 'Rejected worker connection at capacity', { maxWorkers: MAX_WORKERS })
      ws.close(1013, 'at capacity')
      return
    }
    ws.off('error', onPreAuthError)
    attachWorker(ws, buildWorkerEnv(message.env))
  })
  ws.on('close', () => settle())
}

function attachWorker(ws, workerEnv) {
  const connectionId = ++nextConnectionId
  // Required for isolated-vm on Node.js 20+ (issue #377).
  const child = spawn(process.execPath, ['--no-node-snapshot', workerScript], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    serialization: 'json',
    env: workerEnv,
  })
  workers.add(child)

  let ready = false
  let alive = true
  let startupStderr = ''
  child.stderr.on('data', (data) => {
    if (ready || startupStderr.length >= MAX_STARTUP_STDERR_CHARS) return
    startupStderr = `${startupStderr}${data.toString()}`.slice(0, MAX_STARTUP_STDERR_CHARS)
  })

  const startTimeout = setTimeout(() => {
    log('error', 'Worker failed to start within timeout', { connectionId })
    child.kill('SIGKILL')
  }, WORKER_START_TIMEOUT_MS)

  // Protocol pings find a dead client; the heartbeat frame lets a client find a
  // dead host, since standard WebSocket clients cannot observe pings.
  const heartbeat = setInterval(() => {
    if (!alive) {
      log('warn', 'Worker connection missed heartbeat', { connectionId })
      ws.terminate()
      return
    }
    alive = false
    ws.ping()
    ws.send('{"type":"host:heartbeat"}')
  }, HEARTBEAT_INTERVAL_MS)
  ws.on('pong', () => {
    alive = true
  })

  child.on('message', (message) => {
    const becameReady = Boolean(message && message.type === 'ready')
    if (becameReady) {
      ready = true
      clearTimeout(startTimeout)
    }
    if (ws.readyState !== ws.OPEN) return
    ws.send(JSON.stringify(message))
    // The app registers a worker only once it is ready, so a drain notice that
    // reached this connection earlier was dropped; repeat it now.
    if (becameReady && draining) ws.send('{"type":"host:draining"}')
  })

  ws.on('message', (data, isBinary) => {
    let message
    try {
      message = isBinary ? undefined : JSON.parse(data.toString())
    } catch {}
    if (!message || typeof message !== 'object' || !ALLOWED_INBOUND_TYPES.has(message.type)) {
      log('warn', 'Closing worker connection after an invalid frame', { connectionId })
      ws.close(1007, 'invalid frame')
      return
    }
    if (!child.connected) return
    try {
      child.send(message)
    } catch (error) {
      log('error', 'Failed to deliver a frame to the worker', {
        connectionId,
        // utils-lint-allow: this standalone host is copied into the image without workspace packages
        error: error instanceof Error ? error.message : String(error),
      })
      ws.close(1011, 'worker unavailable')
    }
  })

  ws.on('close', () => {
    clearInterval(heartbeat)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  })
  ws.on('error', (error) => {
    log('warn', 'Worker connection error', { connectionId, error: error.message })
  })

  child.on('exit', (code, signal) => {
    clearTimeout(startTimeout)
    clearInterval(heartbeat)
    workers.delete(child)
    if (!ready) {
      log('error', 'Worker exited before becoming ready', {
        connectionId,
        code,
        signal,
        stderr: startupStderr,
      })
    }
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
      ws.close(1011, 'worker exited')
    }
    if (draining && workers.size === 0) shutdown()
  })
  child.on('error', (error) => {
    log('error', 'Worker process error', { connectionId, error: error.message })
    // A child that never started may not emit 'exit'; release its slot here.
    if (child.pid !== undefined) return
    clearTimeout(startTimeout)
    clearInterval(heartbeat)
    workers.delete(child)
    if (ws.readyState === ws.OPEN) ws.close(1011, 'worker unavailable')
    if (draining && workers.size === 0) shutdown()
  })
}

let shuttingDown = false
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of workers) child.kill('SIGKILL')
  wss.close()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1000).unref()
}

function startDraining(signal) {
  if (draining) return
  draining = true
  log('info', 'Draining worker host', { signal, workers: workers.size })
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send('{"type":"host:draining"}')
  }
  if (workers.size === 0) {
    shutdown()
    return
  }
  setTimeout(() => {
    log('warn', 'Drain timeout elapsed; terminating remaining workers', { workers: workers.size })
    shutdown()
  }, DRAIN_TIMEOUT_MS).unref()
}

process.on('SIGTERM', () => startDraining('SIGTERM'))
process.on('SIGINT', () => startDraining('SIGINT'))

server.listen(PORT, () => {
  log('info', 'isolated-vm worker host listening', { port: PORT, maxWorkers: MAX_WORKERS })
})
