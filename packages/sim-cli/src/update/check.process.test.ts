/**
 * @vitest-environment node
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type RequestListener } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, expect, it } from 'vitest'

interface ChildResult {
  code: number | null
  elapsedMs: number
  signal: NodeJS.Signals | null
  stderr: string
  stdout: string
}

interface CheckOutput {
  elapsedMs: number
  notices: string[]
}

interface RunChildOptions {
  env?: NodeJS.ProcessEnv
  nodeArgs?: string[]
  useProcessEnv?: boolean
}

let entrypoint: string
let temporaryDir: string

const [NODE_MAJOR, NODE_MINOR] = process.versions.node.split('.').map(Number)
const SUPPORTS_ENV_PROXY = NODE_MAJOR >= 24 || (NODE_MAJOR === 22 && NODE_MINOR >= 21)
const SUPPORTS_PROXY_FLAG =
  NODE_MAJOR > 24 ||
  (NODE_MAJOR === 24 && NODE_MINOR >= 5) ||
  (NODE_MAJOR === 22 && NODE_MINOR >= 21)

function buildUpdateCheck(temporaryDir: string): string {
  const entrypoint = join(temporaryDir, 'dist', 'check.mjs')
  const sourcePath = fileURLToPath(new URL('./check.ts', import.meta.url))
  mkdirSync(join(temporaryDir, 'dist'))
  writeFileSync(join(temporaryDir, 'package.json'), JSON.stringify({ version: '2.1.2' }))
  execFileSync(
    'bun',
    ['build', sourcePath, '--target=node', '--format=esm', '--outfile', entrypoint],
    { stdio: 'pipe' }
  )
  return entrypoint
}

function runChild(
  entrypoint: string,
  registry: string,
  configDir: string,
  options: RunChildOptions = {}
): Promise<ChildResult> {
  const requestEnvironment = options.useProcessEnv
    ? 'process.env'
    : `{ npm_config_registry: ${JSON.stringify(registry)} }`
  const source = `
    import { announceUpdateIfAvailable } from ${JSON.stringify(pathToFileURL(entrypoint).href)}
    const started = Date.now()
    const notices = []
    await announceUpdateIfAvailable({
      currentVersion: '2.1.2',
      env: ${requestEnvironment},
      isTty: true,
      modulePath: '/usr/local/lib/node_modules/sim/dist/index.js',
      write: (message) => notices.push(message),
    })
    process.stdout.write(JSON.stringify({ elapsedMs: Date.now() - started, notices }))
  `
  const started = performance.now()
  const child = spawn(
    process.execPath,
    [...(options.nodeArgs ?? []), '--input-type=module', '--eval', source],
    {
      env: {
        ...process.env,
        BUILDKITE: '0',
        CI: '0',
        GITHUB_ACTIONS: '0',
        JENKINS_URL: '0',
        NODE_USE_ENV_PROXY: '0',
        NO_PROXY: '127.0.0.1,localhost',
        TEAMCITY_VERSION: '0',
        ...options.env,
        SIM_CONFIG_DIR: configDir,
        ...(options.useProcessEnv ? { npm_config_registry: registry } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk
  })

  return new Promise((resolve, reject) => {
    let timedOut = false
    const deadline = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, 3500)
    child.once('error', reject)
    child.once('close', (code, signal) => {
      clearTimeout(deadline)
      if (timedOut) {
        reject(new Error('Update-check child did not exit promptly'))
        return
      }
      resolve({ code, elapsedMs: performance.now() - started, signal, stderr, stdout })
    })
  })
}

async function withServer(
  listener: RequestListener,
  run: (origin: string) => Promise<void>
): Promise<void> {
  const server = createServer(listener)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  try {
    await run(`http://127.0.0.1:${port}`)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function withProxyServer<T>(
  run: (origin: string) => Promise<T>
): Promise<{ requests: string[]; result: T }> {
  const requests: string[] = []
  const body = JSON.stringify({ latest: '2.1.5' })
  const server = createServer((request, response) => {
    requests.push(request.url ?? '')
    response.setHeader('content-type', 'application/json')
    response.end(body)
  })
  server.on('connect', (request, socket, head) => {
    requests.push(`CONNECT ${request.url ?? ''}`)
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    const respond = () => {
      socket.end(
        `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`
      )
    }
    if (head.length > 0) respond()
    else socket.once('data', respond)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    const result = await run(`http://127.0.0.1:${port}`)
    return { requests, result }
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

beforeAll(() => {
  temporaryDir = mkdtempSync(join(tmpdir(), 'sim-cli-update-process-'))
  entrypoint = buildUpdateCheck(temporaryDir)
})

afterAll(() => {
  rmSync(temporaryDir, { recursive: true, force: true })
})

it('destroys a timed-out request so its socket cannot hold the process open', async () => {
  await withServer(
    () => {},
    async (origin) => {
      const result = await runChild(entrypoint, origin, join(temporaryDir, 'config'))

      expect(result).toMatchObject({ code: 0, signal: null, stderr: '' })
      const output = JSON.parse(result.stdout) as CheckOutput
      expect(output.elapsedMs).toBeGreaterThanOrEqual(750)
      expect(result.elapsedMs).toBeLessThan(3500)
    }
  )
}, 10_000)

it('destroys a response whose body stalls after the headers arrive', async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.write('{"latest":')
    },
    async (origin) => {
      const result = await runChild(entrypoint, origin, join(temporaryDir, 'config-stalled-body'))

      expect(result).toMatchObject({ code: 0, signal: null, stderr: '' })
      const output = JSON.parse(result.stdout) as CheckOutput
      expect(output.elapsedMs).toBeGreaterThanOrEqual(750)
      expect(result.elapsedMs).toBeLessThan(3500)
    }
  )
}, 10_000)

it('gives the request process its own deadline if the CLI process disappears', async () => {
  const server = createServer(() => {})
  let outer: ReturnType<typeof spawn> | undefined

  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const source = `
      import { announceUpdateIfAvailable } from ${JSON.stringify(pathToFileURL(entrypoint).href)}
      await announceUpdateIfAvailable({
        currentVersion: '2.1.2',
        env: { npm_config_registry: 'http://127.0.0.1:${port}' },
        isTty: true,
        modulePath: '/usr/local/lib/node_modules/sim/dist/index.js',
      })
    `
    const connection = new Promise<Socket>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Registry probe did not connect')), 2500)
      server.once('connection', (socket) => {
        clearTimeout(deadline)
        resolve(socket)
      })
    })

    outer = spawn(process.execPath, ['--input-type=module', '--eval', source], {
      env: {
        ...process.env,
        NODE_USE_ENV_PROXY: '0',
        NO_PROXY: '127.0.0.1,localhost',
        SIM_CONFIG_DIR: join(temporaryDir, 'config-orphan'),
      },
      stdio: 'ignore',
    })
    const socket = await connection
    const killedAt = performance.now()
    outer.kill('SIGKILL')
    await new Promise<void>((resolve) => outer?.once('close', () => resolve()))
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error('Orphaned registry probe outlived its own deadline')),
        2500
      )
      socket.once('close', () => {
        clearTimeout(deadline)
        resolve()
      })
    })

    expect(performance.now() - killedAt).toBeLessThan(2500)
  } finally {
    outer?.kill('SIGKILL')
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}, 10_000)

it('caps a chunked response even when it omits Content-Length', async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.write(JSON.stringify({ latest: '2.1.5' }))
      response.end(' '.repeat(64 * 1024))
    },
    async (origin) => {
      const result = await runChild(entrypoint, origin, join(temporaryDir, 'config-chunked'))

      expect(result).toMatchObject({ code: 0, signal: null, stderr: '' })
      const output = JSON.parse(result.stdout) as CheckOutput
      expect(output.notices).toEqual([])
    }
  )
}, 10_000)

it('preserves a mirror path, query, and reduced request headers', async () => {
  let requestHeaders: Record<string, string | string[] | undefined> = {}
  let requestPath: string | undefined
  await withServer(
    (request, response) => {
      requestHeaders = request.headers
      requestPath = request.url
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ latest: '2.1.5' }))
    },
    async (origin) => {
      const result = await runChild(
        entrypoint,
        `${origin}/api/npm/repo?token=abc`,
        join(temporaryDir, 'config-mirror')
      )

      expect(result).toMatchObject({ code: 0, signal: null, stderr: '' })
      const output = JSON.parse(result.stdout) as CheckOutput
      expect(output.notices).toEqual([
        'Update available: sim 2.1.2 → 2.1.5. Run: npm install -g sim@latest\n',
      ])
      expect(requestPath).toBe('/api/npm/repo/-/package/sim/dist-tags?token=abc')
      expect(requestHeaders).toMatchObject({
        accept: 'application/json',
        'user-agent': 'sim-cli/2.1.2',
      })
      expect(requestHeaders.authorization).toBeUndefined()
    }
  )
}, 10_000)

it.skipIf(!SUPPORTS_ENV_PROXY)(
  'preserves built-in environment proxy support inside the request process',
  async () => {
    const { requests, result } = await withProxyServer((origin) =>
      runChild(entrypoint, 'http://sim-update.invalid', join(temporaryDir, 'config-proxy'), {
        env: {
          HTTP_PROXY: origin,
          NODE_USE_ENV_PROXY: '1',
          NO_PROXY: '',
          http_proxy: origin,
          no_proxy: '',
        },
      })
    )

    expect(result).toMatchObject({ code: 0, signal: null, stderr: '' })
    expect(requests).not.toEqual([])
    const output = JSON.parse(result.stdout) as CheckOutput
    expect(output.notices).toHaveLength(1)
  },
  10_000
)

it.skipIf(!SUPPORTS_PROXY_FLAG)(
  'preserves a parent use-env-proxy flag and its command-line precedence',
  async () => {
    const { requests, result } = await withProxyServer((origin) =>
      runChild(entrypoint, 'http://sim-update.invalid', join(temporaryDir, 'config-proxy-flag'), {
        env: {
          HTTP_PROXY: origin,
          NODE_OPTIONS: '--no-use-env-proxy',
          NODE_USE_ENV_PROXY: '0',
          NO_PROXY: '',
          http_proxy: origin,
          no_proxy: '',
        },
        nodeArgs: ['--use-env-proxy'],
      })
    )

    expect(result).toMatchObject({ code: 0, signal: null, stderr: '' })
    expect(requests).not.toEqual([])
    const output = JSON.parse(result.stdout) as CheckOutput
    expect(output.notices).toHaveLength(1)
  },
  10_000
)

it('keeps a configured registry credential out of probe argv and environment', async () => {
  const inspectionPath = join(temporaryDir, 'probe-inspection.json')
  const preloadDir = join(temporaryDir, 'probe preload')
  const preloadPath = join(preloadDir, 'inspect-probe.cjs')
  const sentinel = 'registry-secret-sentinel'
  let requestPath: string | undefined
  mkdirSync(preloadDir)
  writeFileSync(
    preloadPath,
    `
      const { writeFileSync } = require('node:fs')
      if (process.execArgv.some((value) => value.includes('maxResponseBytes'))) {
        writeFileSync(
          process.env.PROBE_INSPECTION_PATH,
          JSON.stringify({
            argv: process.argv,
            environmentValues: Object.values(process.env),
            execArgv: process.execArgv,
          })
        )
      }
    `
  )

  await withServer(
    (request, response) => {
      requestPath = request.url
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ latest: '2.1.5' }))
    },
    async (origin) => {
      const registry = `${origin}?token=${sentinel}`
      const result = await runChild(entrypoint, registry, join(temporaryDir, 'config-credential'), {
        env: {
          NODE_OPTIONS: `--require="${preloadPath}"`,
          NPM_CONFIG_REGISTRY: registry,
          PROBE_INSPECTION_PATH: inspectionPath,
        },
        useProcessEnv: true,
      })

      expect(result).toMatchObject({ code: 0, signal: null, stderr: '' })
      expect(requestPath).toBe(`/-/package/sim/dist-tags?token=${sentinel}`)
      const inspection = JSON.parse(readFileSync(inspectionPath, 'utf8')) as {
        argv: string[]
        environmentValues: string[]
        execArgv: string[]
      }
      expect(JSON.stringify(inspection)).not.toContain(sentinel)
    }
  )
}, 10_000)

it('refuses redirects without contacting their destination', async () => {
  const paths: string[] = []
  await withServer(
    (request, response) => {
      paths.push(request.url ?? '')
      if (request.url === '/redirected') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ latest: '2.1.5' }))
        return
      }
      response.writeHead(302, { location: '/redirected' })
      response.end()
    },
    async (origin) => {
      const result = await runChild(entrypoint, origin, join(temporaryDir, 'config-redirect'))

      expect(result).toMatchObject({ code: 0, signal: null, stderr: '' })
      const output = JSON.parse(result.stdout) as CheckOutput
      expect(output.notices).toEqual([])
      expect(paths).toEqual(['/-/package/sim/dist-tags'])
    }
  )
}, 10_000)
