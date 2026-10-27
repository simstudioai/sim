import assert from 'node:assert/strict'
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { createServer as createHttpServer, request } from 'node:http'
import { connect, createServer, type Server, type Socket } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateRandomBytes, generateRandomHex } from '@sim/utils/random'

/**
 * Runs the isolated-vm pool against a real `isolated-vm-host.cjs` over real
 * WebSockets, the topology used when `IVM_REMOTE_WORKER_URL` is set. This process plays the app; the
 * hosts are separate Node processes, reached through a TCP balancer that behaves like the internal
 * ALB in front of them.
 *
 * Usage: bun run apps/sim/scripts/test-isolated-vm-remote-e2e.ts
 * Writes a JSON report to IVM_REMOTE_E2E_REPORT_PATH when set.
 */
const logger = createLogger('IsolatedVMRemoteE2E')
const HOST_SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'lib',
  'execution',
  'isolated-vm-host.cjs'
)
/** Stands in for anything else a host container's environment holds. */
const HOST_ONLY_VALUE = `host-only-${generateRandomHex(8)}`
/** Set on the app only; a remote worker that honors it got its limits from the app. */
const STDOUT_LIMIT_CHARS = 1000
/** The app's remote worker max age (`IVM_REMOTE_WORKER_MAX_AGE_MS`), short so a drain fits a check. */
const WORKER_MAX_AGE_MS = 1000
/** The longest execution the drain check protects. */
const LONG_EXECUTION_MS = 1500
/** Sized the way infra sizes the host's target group: max age + longest execution + margin. */
const DEREGISTRATION_DELAY_MS = WORKER_MAX_AGE_MS + LONG_EXECUTION_MS + 1500
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const startedAt = new Date().toISOString()

const hosts: Host[] = []
let closeBalancer = () => {}
let closeSlowServer = () => {}

interface Host {
  process: ChildProcess
  port: number
  token: string
  exited: Promise<number | null>
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('No port assigned'))
      })
    })
  })
}

/**
 * `bun run` puts a `node` shim for Bun first on PATH, and isolated-vm only
 * loads in real Node — the binary the production image runs the host with.
 */
function resolveNodeBinary(): string {
  const candidates = execFileSync('which', ['-a', 'node'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
  const node = candidates.find(
    (candidate) =>
      execFileSync(candidate, ['-p', 'Boolean(process.versions.bun)'], {
        encoding: 'utf8',
      }).trim() === 'false'
  )
  assert(node, 'Real Node.js is required to run the worker host')
  return node
}

const NODE_BINARY = resolveNodeBinary()

async function startHost(maxWorkers: number, token = generateRandomHex(32)): Promise<Host> {
  const port = await freePort()
  const child = spawn(NODE_BINARY, [HOST_SCRIPT], {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'test',
      IVM_HOST_TOKEN: token,
      IVM_HOST_PORT: String(port),
      IVM_HOST_MAX_WORKERS: String(maxWorkers),
      IVM_HOST_DRAIN_TIMEOUT_MS: '20000',
      SIM_HOST_ONLY_SETTING: HOST_ONLY_VALUE,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group, so cleanup can stop the host and its worker children together.
    detached: true,
  })
  const relay = (data: Buffer) => logger.info(`host:${port} ${data.toString().trim()}`)
  child.stdout?.on('data', relay)
  child.stderr?.on('data', relay)
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)))
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      if (response.ok) {
        const host = { process: child, port, token, exited }
        hosts.push(host)
        return host
      }
    } catch {}
    await sleep(100)
  }
  child.kill('SIGKILL')
  throw new Error('Worker host did not become healthy')
}

/**
 * Stands in for the ALB: each new connection goes to the current target, and repointing the target
 * is deregistration, which leaves open connections where they are. Destroying what is still open
 * on a host is the deregistration delay expiring.
 */
interface Balancer {
  port: number
  target: Host
  open(host: Host): number
  routed(host: Host): number
  cut(host: Host): void
  close(): void
}

async function startBalancer(target: Host): Promise<Balancer> {
  const connections = new Map<Host, Set<Socket>>()
  const routedCounts = new Map<Host, number>()
  const server: Server = createServer((client) => {
    const host = balancer.target
    routedCounts.set(host, (routedCounts.get(host) ?? 0) + 1)
    const upstream = connect(host.port, '127.0.0.1')
    const open = connections.get(host) ?? new Set<Socket>()
    connections.set(host, open)
    open.add(upstream)
    const teardown = () => {
      open.delete(upstream)
      client.destroy()
      upstream.destroy()
    }
    client.on('error', teardown)
    client.on('close', teardown)
    upstream.on('error', teardown)
    upstream.on('close', teardown)
    client.pipe(upstream)
    upstream.pipe(client)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address === 'object')
  const balancer: Balancer = {
    port: address.port,
    target,
    open: (host) => connections.get(host)?.size ?? 0,
    routed: (host) => routedCounts.get(host) ?? 0,
    cut: (host) => {
      for (const socket of connections.get(host) ?? []) socket.destroy()
    },
    close: () => server.close(),
  }
  return balancer
}

/** Sends a bare WebSocket upgrade and returns the HTTP status the host answers with. */
function upgradeStatus(host: Host, options: { path?: string } = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port: host.port,
      path: options.path ?? '/v1/worker',
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': Buffer.from(generateRandomHex(8)).toString('base64'),
      },
    })
    req.on('upgrade', (res, socket) => {
      socket.destroy()
      resolve(res.statusCode ?? 0)
    })
    req.on('response', (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', reject)
    req.end()
  })
}

/** A client-to-server text frame header, masked with a zero key so the payload goes as is. */
function maskedTextFrameHeader(payloadBytes: number): Buffer {
  if (payloadBytes < 126) return Buffer.from([0x81, 0x80 | payloadBytes, 0, 0, 0, 0])
  const header = Buffer.alloc(14)
  header[0] = 0x81
  header[1] = 0x80 | 127
  header.writeBigUInt64BE(BigInt(payloadBytes), 2)
  return header
}

/**
 * Upgrades a raw socket, optionally sends `firstFrame`, then declares a 32 MiB frame (under the
 * host's message limit) and streams 1 MiB of it without ever authenticating. Resolves with
 * whether the host closed the connection within a second.
 */
async function streamUnauthenticated(host: Host, firstFrame?: string): Promise<'closed' | 'open'> {
  const socket = connect(host.port, '127.0.0.1')
  socket.on('error', () => {})
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
  await new Promise<void>((resolve) => socket.once('connect', () => resolve()))
  const handshake = new Promise<string>((resolve) =>
    socket.once('data', (data: Buffer) => resolve(data.toString()))
  )
  socket.write(
    [
      'GET /v1/worker HTTP/1.1',
      `Host: 127.0.0.1:${host.port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Version: 13',
      `Sec-WebSocket-Key: ${Buffer.from(generateRandomBytes(16)).toString('base64')}`,
      '',
      '',
    ].join('\r\n')
  )
  const response = await handshake
  assert.match(response, /^HTTP\/1\.1 101/, `Expected the upgrade to be accepted: ${response}`)
  if (firstFrame) {
    const payload = Buffer.from(firstFrame)
    socket.write(Buffer.concat([maskedTextFrameHeader(payload.length), payload]))
  }
  socket.write(maskedTextFrameHeader(32 * 1024 * 1024))
  const chunk = Buffer.alloc(64 * 1024)
  for (let sent = 0; sent < 1024 * 1024 && !socket.destroyed; sent += chunk.length) {
    socket.write(chunk)
  }
  const outcome = await Promise.race([
    closed.then(() => 'closed' as const),
    sleep(1000).then(() => 'open' as const),
  ])
  socket.destroy()
  return outcome
}

/** Opens a connection and sends `firstFrame`; resolves with the socket once it opens. */
function openSocket(host: Host, firstFrame: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${host.port}/v1/worker`)
    ws.addEventListener('open', () => {
      ws.send(firstFrame)
      resolve(ws)
    })
    ws.addEventListener('error', () => reject(new Error('WebSocket connection failed')))
  })
}

function authFrame(token: string): string {
  return JSON.stringify({ type: 'auth', token, env: {} })
}

/** Opens an authenticated worker connection; resolves once the worker is ready. */
async function openWorker(host: Host): Promise<WebSocket> {
  const ws = await openSocket(host, authFrame(host.token))
  return new Promise((resolve) => {
    ws.addEventListener('message', (event) => {
      if (JSON.parse(String(event.data)).type === 'ready') resolve(ws)
    })
  })
}

function closeCode(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.addEventListener('close', (event) => resolve(event.code)))
}

function childProcessesOf(pid: number): { pid: number; command: string }[] {
  const output = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' })
  return output.split('\n').flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)
    if (!match || Number(match[2]) !== pid) return []
    return [{ pid: Number(match[1]), command: match[3] }]
  })
}

function workerPidsOf(pid: number): number[] {
  return childProcessesOf(pid)
    .filter((child) => child.command.includes('isolated-vm-worker.cjs'))
    .map((child) => child.pid)
}

function environmentOf(pid: number): string {
  return execFileSync('ps', ['eww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8' })
}

/** Waits until the host reports no live workers from earlier checks. */
async function waitForNoWorkers(host: Host) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const health = (await (await fetch(`http://127.0.0.1:${host.port}/health`)).json()) as {
      workers: number
    }
    if (health.workers === 0) return
    await sleep(100)
  }
  throw new Error('Host still reports live workers')
}

/** A check that never settles is a failure, reported rather than left hanging. */
const CHECK_DEADLINE_MS = 30_000

async function check(name: string, run: () => Promise<void>) {
  const started = performance.now()
  let deadline: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  try {
    await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => {
          timedOut = true
          reject(new Error(`Did not settle within ${CHECK_DEADLINE_MS}ms`))
        }, CHECK_DEADLINE_MS)
      }),
    ])
    checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) })
    logger.info(`PASS ${name}`)
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      error: getErrorMessage(error),
    })
    logger.error(`FAIL ${name}`, { error: getErrorMessage(error) })
    process.exitCode = 1
    // A check that never settled may still be running against the shared hosts and pool, so
    // later checks would not be independent of it.
    if (timedOut) throw new Error(`Aborting: "${name}" did not settle`)
  } finally {
    clearTimeout(deadline)
  }
}

async function run() {
  const host = await startHost(8)
  const replacement = await startHost(8, host.token)
  const probeHost = await startHost(1)
  const balancer = await startBalancer(host)
  closeBalancer = balancer.close

  process.env.IVM_REMOTE_WORKER_URL = `ws://127.0.0.1:${balancer.port}/v1/worker`
  process.env.IVM_REMOTE_WORKER_TOKEN = host.token
  process.env.IVM_REMOTE_WORKER_MAX_AGE_MS = String(WORKER_MAX_AGE_MS)
  process.env.IVM_MAX_STDOUT_CHARS = String(STDOUT_LIMIT_CHARS)
  process.env.IVM_QUEUE_TIMEOUT_MS = '5000'
  process.env.IVM_POOL_SIZE = '2'
  const { executeInIsolatedVM } = await import('@/lib/execution/isolated-vm')

  // The isolate has no timers; a slow upstream holds an execution open the way real ones run long.
  // `/hold` answers only when the check releases it, so an inspection never races the execution.
  let onHeld: (release: () => void) => void = () => {}
  const slowServer = createHttpServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://slow')
    if (url.pathname === '/hold') {
      onHeld(() => res.end('done'))
      return
    }
    setTimeout(() => res.end('done'), Number(url.searchParams.get('ms')))
  })
  await new Promise<void>((resolve) => slowServer.listen(0, '127.0.0.1', resolve))
  const slowAddress = slowServer.address()
  assert(slowAddress && typeof slowAddress === 'object')
  closeSlowServer = () => slowServer.close()
  const slowFetch = (ms: number) =>
    `const r = await fetch('http://127.0.0.1:${slowAddress.port}/?ms=${ms}'); return await r.text()`

  const execute = (code: string, extra: { timeoutMs?: number; signal?: AbortSignal } = {}) =>
    executeInIsolatedVM(
      {
        code,
        params: {},
        envVars: {},
        contextVariables: {},
        timeoutMs: extra.timeoutMs ?? 10000,
        requestId: `e2e-${generateRandomHex(4)}`,
        ownerKey: 'e2e-owner',
      },
      { signal: extra.signal }
    )

  await check('executes code on the remote host', async () => {
    const result = await execute('return 6 * 7')
    assert.equal(result.error, undefined, result.error?.message)
    assert.equal(result.result, 42)
  })

  /** Inspects workers while an execution holds one open, since an idle worker can retire at any time. */
  const whileAWorkerRuns = async (inspect: () => void) => {
    const held = new Promise<() => void>((resolve) => {
      onHeld = resolve
    })
    const running = execute(
      `const r = await fetch('http://127.0.0.1:${slowAddress.port}/hold'); return await r.text()`
    )
    // An execution that fails before its fetch arrives reports its own error, not the deadline.
    const release = await Promise.race([
      held,
      running.then((result) => {
        throw new Error(`Execution ended before it was held: ${result.error?.message}`)
      }),
    ])
    try {
      inspect()
    } finally {
      release()
      const result = await running
      assert.equal(result.result, 'done', result.error?.message)
    }
  }

  await check('runs the worker as a child of the host, never of the app', async () => {
    await whileAWorkerRuns(() => {
      assert(workerPidsOf(host.process.pid ?? -1).length > 0, 'Expected a worker under the host')
      assert.deepEqual(workerPidsOf(process.pid), [], 'The app spawned a local worker')
    })
  })

  await check("enforces the app's limits on the remote worker", async () => {
    const result = await execute("console.log('y'.repeat(5000)); return 1")
    assert.equal(result.result, 1, result.error?.message)
    assert(result.stdout.endsWith('[stdout truncated]\n'), 'stdout was not truncated')
    assert(
      result.stdout.length <= STDOUT_LIMIT_CHARS + '\n[stdout truncated]\n'.length,
      `stdout was ${result.stdout.length} chars; the app limit is ${STDOUT_LIMIT_CHARS}`
    )
  })

  await check("gives the worker neither the host token nor the host's environment", async () => {
    await whileAWorkerRuns(() => {
      const hostWorkers = workerPidsOf(host.process.pid ?? -1)
      assert(hostWorkers.length > 0, 'Expected a worker process under the host')
      for (const pid of hostWorkers) {
        const environment = environmentOf(pid)
        assert(!environment.includes(host.token), 'Worker environment contains the host token')
        assert(!environment.includes('IVM_HOST_TOKEN'), 'Worker environment names the host token')
        assert(
          !environment.includes(HOST_ONLY_VALUE),
          "Worker environment contains the host's variables"
        )
      }
    })
  })

  await check('brokers fetch through the app, the only side with a network client', async () => {
    const marker = generateRandomHex(8)
    const server = createHttpServer((_req, res) => res.end(marker))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert(address && typeof address === 'object')
    try {
      const result = await execute(
        `const r = await fetch('http://127.0.0.1:${address.port}/'); return await r.text()`
      )
      assert.equal(result.result, marker, result.error?.message)
    } finally {
      server.close()
    }
  })

  await check('carries a multi-megabyte result intact', async () => {
    const result = await execute("return 'x'.repeat(5 * 1024 * 1024)")
    assert.equal(result.error, undefined, result.error?.message)
    assert.equal(typeof result.result, 'string')
    assert.equal((result.result as string).length, 5 * 1024 * 1024)
  })

  await check('enforces the execution timeout', async () => {
    const result = await execute('while (true) {}', { timeoutMs: 500 })
    assert.equal(result.error?.name, 'TimeoutError', result.error?.message)
  })

  await check('cancels an execution and keeps the worker usable', async () => {
    const controller = new AbortController()
    const pending = execute('while (true) {}', { timeoutMs: 30000, signal: controller.signal })
    await sleep(300)
    controller.abort()
    const cancelled = await pending
    assert.equal(cancelled.termination, 'cancelled')
    const next = await execute('return "still alive"')
    assert.equal(next.result, 'still alive', next.error?.message)
  })

  await check('rejects a connection with the wrong token', async () => {
    const ws = await openSocket(probeHost, authFrame(generateRandomHex(32)))
    assert.equal(await closeCode(ws), 4401)
  })

  await check('rejects a connection whose first frame is not authentication', async () => {
    const ws = await openSocket(probeHost, '{"type":"execute","executionId":1}')
    assert.equal(await closeCode(ws), 4401)
  })

  await check('drops a connection that streams a large frame before authenticating', async () => {
    assert.equal(await streamUnauthenticated(probeHost), 'closed', 'The host kept buffering')
    const health = await fetch(`http://127.0.0.1:${probeHost.port}/health`)
    assert.equal(health.status, 200)
  })

  await check('drops a refused connection that ignores the close and keeps sending', async () => {
    const refusedAuth = authFrame(generateRandomHex(32))
    assert.equal(await streamUnauthenticated(probeHost, refusedAuth), 'closed')
  })

  await check('rejects an unparseable request target and keeps serving', async () => {
    assert.equal(await upgradeStatus(probeHost, { path: '//[' }), 400)
    const health = await fetch(`http://127.0.0.1:${probeHost.port}/health`)
    assert.equal(health.status, 200)
  })

  await check('rejects paths other than the worker endpoint', async () => {
    assert.equal(await upgradeStatus(probeHost, { path: '/v0/worker' }), 404)
  })

  await check('closes a connection that sends a frame outside the worker protocol', async () => {
    const ws = await openWorker(probeHost)
    const closed = closeCode(ws)
    ws.send('{"type":"spawn"}')
    assert.equal(await closed, 1007)
  })

  await check('refuses connections beyond the worker capacity', async () => {
    await waitForNoWorkers(probeHost)
    const first = await openWorker(probeHost)
    assert.equal(await upgradeStatus(probeHost), 503)
    first.close()
  })

  await check('reports a worker crash as a system error, not a hang', async () => {
    const pending = execute('while (true) {}', { timeoutMs: 30000 })
    await sleep(300)
    for (const pid of workerPidsOf(host.process.pid ?? -1)) process.kill(pid, 'SIGKILL')
    const result = await pending
    assert.equal(result.error?.isSystemError, true, JSON.stringify(result.error))
  })

  // A deploy or scale-in: the balancer stops routing new connections to the host, keeps open ones
  // for the deregistration delay, cuts what is left, and only then is the host sent SIGTERM.
  await check('drains a deregistered host without failing an execution', async () => {
    const longExecution = slowFetch(LONG_EXECUTION_MS)
    const warm = await execute('return 1')
    assert.equal(warm.result, 1, warm.error?.message)
    const runs = [execute(longExecution)]
    await sleep(100)

    balancer.target = replacement
    const deregisteredAt = Date.now()
    // New executions keep arriving until the delay is nearly over, as they do on a busy app.
    while (Date.now() - deregisteredAt < DEREGISTRATION_DELAY_MS - 300) {
      runs.push(execute(longExecution))
      await sleep(200)
    }
    await sleep(Math.max(0, DEREGISTRATION_DELAY_MS - (Date.now() - deregisteredAt)))
    const openAtExpiry = balancer.open(host)
    balancer.cut(host)
    host.process.kill('SIGTERM')

    const results = await Promise.all(runs)
    const failures = results.filter((result) => result.result !== 'done')
    assert.deepEqual(
      failures.map((result) => result.error?.message),
      [],
      `${failures.length} of ${results.length} executions failed across the drain`
    )
    assert.equal(openAtExpiry, 0, 'Connections to the deregistered host outlived its delay')
    assert(balancer.routed(replacement) > 0, 'No execution moved to the replacement host')
    const code = await Promise.race([host.exited, sleep(10000).then(() => 'timeout' as const)])
    assert.notEqual(code, 'timeout', 'The drained host did not exit after SIGTERM')
  })

  await check('finishes in-flight work while draining, then exits', async () => {
    const pending = execute(
      'const end = Date.now() + 1500; while (Date.now() < end) {} return "drained"',
      { timeoutMs: 10000 }
    )
    await sleep(300)
    replacement.process.kill('SIGTERM')
    await sleep(100)
    const readiness = await fetch(`http://127.0.0.1:${replacement.port}/health`)
    assert.equal(readiness.status, 503, 'Readiness must fail while draining')
    const liveness = await fetch(`http://127.0.0.1:${replacement.port}/livez`)
    assert.equal(liveness.status, 200, 'Liveness must hold while draining')
    const result = await pending
    assert.equal(result.result, 'drained', result.error?.message)
    const code = await Promise.race([
      replacement.exited,
      sleep(10000).then(() => 'timeout' as const),
    ])
    assert.notEqual(code, 'timeout', 'Host did not exit after draining')
  })

  await check('fails closed within the queue timeout once the host is gone', async () => {
    assert.notEqual(replacement.process.exitCode, null, 'Precondition: the host has exited')
    const started = Date.now()
    const result = await execute('return 1')
    assert.notEqual(result.result, 1, 'Execution ran without a host — it fell back locally')
    assert(result.error, 'Expected an error with no host')
    assert(Date.now() - started < 15000, 'Failure took longer than the queue timeout')
  })
}

run()
  .catch((error) => {
    checks.push({ name: 'setup', status: 'failed', durationMs: 0, error: getErrorMessage(error) })
    logger.error('Remote isolated-vm E2E aborted', { error: getErrorMessage(error) })
    process.exitCode = 1
  })
  .finally(async () => {
    closeBalancer()
    closeSlowServer()
    for (const host of hosts) {
      try {
        if (host.process.pid) process.kill(-host.process.pid, 'SIGKILL')
      } catch {}
    }
    const report = {
      suite: 'isolated-vm-remote',
      startedAt,
      finishedAt: new Date().toISOString(),
      status: process.exitCode ? 'failed' : 'passed',
      checks,
    }
    if (process.env.IVM_REMOTE_E2E_REPORT_PATH) {
      await writeFile(
        process.env.IVM_REMOTE_E2E_REPORT_PATH,
        `${JSON.stringify(report, null, 2)}\n`
      )
    }
    logger.info('Remote isolated-vm E2E finished', {
      passed: checks.filter((c) => c.status === 'passed').length,
      failed: checks.filter((c) => c.status === 'failed').length,
    })
    process.exit(process.exitCode ?? 0)
  })
