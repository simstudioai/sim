import { execFileSync, spawn } from 'node:child_process'
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cliVersion } from '#sim-cli/version'
import { announceUpdateIfAvailable, type UpdateCheckOptions } from './check'

/** A global install, which is the only shape that gets advised at all. */
const INSTALLED = '/usr/local/lib/node_modules/sim/dist/index.js'

let configDir: string
let previousConfigDir: string | undefined
let notices: string[]
let fetched: URL[]
type RegistryRequest = NonNullable<UpdateCheckOptions['registryRequest']>
let inits: Parameters<RegistryRequest>[1][]
let registryRequest: RegistryRequest

/** Answers the dist-tags request the way the registry does. */
function stubRegistry(
  tags: Record<string, unknown> | 'reject' | 'not-found' | 'html' | 'oversized'
): void {
  registryRequest = async (input, init) => {
    fetched.push(input)
    inits.push(init)
    if (tags === 'oversized') {
      return `${JSON.stringify({ latest: '2.1.5' })}${' '.repeat(64 * 1024)}`
    }
    if (tags === 'reject') throw new Error('getaddrinfo ENOTFOUND')
    if (tags === 'not-found') return null
    if (tags === 'html') return '<html>nope</html>'
    return JSON.stringify(tags)
  }
}

async function run(overrides: Parameters<typeof announceUpdateIfAvailable>[0] = {}) {
  await announceUpdateIfAvailable({
    currentVersion: '2.1.2',
    env: {},
    isTty: true,
    modulePath: INSTALLED,
    registryRequest,
    write: (message) => notices.push(message),
    ...overrides,
  })
}

function cachePath(): string {
  return join(configDir, 'update-check.json')
}

beforeEach(() => {
  previousConfigDir = process.env.SIM_CONFIG_DIR
  configDir = mkdtempSync(join(tmpdir(), 'sim-cli-update-'))
  process.env.SIM_CONFIG_DIR = configDir
  notices = []
  fetched = []
  inits = []
  stubRegistry({ latest: '2.1.5' })
})

afterEach(() => {
  if (previousConfigDir === undefined) Reflect.deleteProperty(process.env, 'SIM_CONFIG_DIR')
  else process.env.SIM_CONFIG_DIR = previousConfigDir
  rmSync(configDir, { recursive: true, force: true })
})

describe('announcing a newer release', () => {
  it('names both versions and the command that closes the gap', async () => {
    await run()
    expect(notices.join('')).toBe('Update available: sim 2.1.2 → 2.1.5. Run: sim update\n')
  })

  it('sends only its own version and gives the request a one-second deadline', async () => {
    await run()
    const headers = inits[0]?.headers
    expect(headers['user-agent']).toBe(`sim-cli/${cliVersion()}`)
    expect(headers.accept).toBe('application/json')
    expect(headers.authorization).toBeUndefined()
    expect(inits[0]?.maxResponseBytes).toBe(64 * 1024)
    expect(inits[0]?.timeoutMs).toBe(1000)
  })
})

describe('when the notice is suppressed', () => {
  it.each(['CI', 'GITHUB_ACTIONS', 'JENKINS_URL', 'TEAMCITY_VERSION', 'BUILDKITE'])(
    'says nothing when %s is set, even where CI allocates a terminal',
    async (variable) => {
      await run({ env: { [variable]: 'true' } })
      expect(fetched).toEqual([])
      expect(notices).toEqual([])
    }
  )

  it.each([
    '/Users/x/.npm/_npx/a1b2/node_modules/sim/dist/index.js',
    'C:\\Users\\x\\AppData\\Local\\npm-cache\\_npx\\a1b2\\node_modules\\sim\\dist\\index.js',
  ])('says nothing for an npx cache installation (%s)', async (modulePath) => {
    await run({ modulePath })
    expect(fetched).toEqual([])
    expect(notices).toEqual([])
  })
})

describe('the once-a-day cache', () => {
  it('re-checks rather than trusting a truncated file', async () => {
    writeFileSync(cachePath(), '{"version": 1, "checked')
    await run()
    expect(notices).toHaveLength(1)
  })

  it('replaces a hard-linked cache without modifying its other name', async () => {
    const victimPath = join(configDir, 'victim')
    writeFileSync(victimPath, 'do not overwrite')
    linkSync(victimPath, cachePath())

    await run()

    expect(readFileSync(victimPath, 'utf8')).toBe('do not overwrite')
    expect(JSON.parse(readFileSync(cachePath(), 'utf8'))).toMatchObject({
      version: 1,
      checkedAt: expect.any(String),
    })
  })

  it('re-checks rather than following a cache symlink', async () => {
    const victimPath = join(configDir, 'victim')
    writeFileSync(victimPath, JSON.stringify({ version: 1, checkedAt: new Date().toISOString() }))
    symlinkSync(victimPath, cachePath())

    await run()

    expect(fetched).toHaveLength(1)
    expect(notices).toHaveLength(1)
    expect(readFileSync(victimPath, 'utf8')).toContain('"version":1')
  })

  it('still runs the command when the cache cannot be written', async () => {
    const wall = join(configDir, 'wall')
    writeFileSync(wall, 'not a directory')
    process.env.SIM_CONFIG_DIR = join(wall, 'sim')
    await expect(run()).resolves.toBeUndefined()
    expect(notices).toHaveLength(1)
  })
})

describe('when the registry does not answer', () => {
  it('refuses a body far larger than this endpoint could legitimately return', async () => {
    stubRegistry('oversized')
    await run()
    expect(notices).toEqual([])
  })

  it('refuses registry URLs with username/password userinfo', async () => {
    await run({ env: { npm_config_registry: 'https://user:secret@npm.internal/api/npm' } })
    expect(fetched).toEqual([])
    expect(notices).toEqual([])
  })
})

describe('across processes', () => {
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
  const _SUPPORTS_ENV_PROXY = NODE_MAJOR >= 24 || (NODE_MAJOR === 22 && NODE_MINOR >= 21)
  const _SUPPORTS_PROXY_FLAG =
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
          npm_command: '',
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

  async function _withProxyServer<T>(
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

  it('keeps CLI credentials out of probe argv and environment', async () => {
    const inspectionPath = join(temporaryDir, 'probe-inspection.json')
    const preloadDir = join(temporaryDir, 'probe preload')
    const preloadPath = join(preloadDir, 'inspect-probe.cjs')
    const registrySentinel = 'registry-secret-sentinel'
    const apiKeySentinel = 'api-key-secret-sentinel'
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
        const registry = `${origin}?token=${registrySentinel}`
        const result = await runChild(
          entrypoint,
          registry,
          join(temporaryDir, 'config-credential'),
          {
            env: {
              NODE_OPTIONS: `--require="${preloadPath}"`,
              NPM_CONFIG_REGISTRY: registry,
              PROBE_INSPECTION_PATH: inspectionPath,
              SIM_API_KEY: apiKeySentinel,
            },
            useProcessEnv: true,
          }
        )

        expect(result).toMatchObject({ code: 0, signal: null, stderr: '' })
        expect(requestPath).toBe(`/-/package/sim/dist-tags?token=${registrySentinel}`)
        const inspection = JSON.parse(readFileSync(inspectionPath, 'utf8')) as {
          argv: string[]
          environmentValues: string[]
          execArgv: string[]
        }
        const serializedInspection = JSON.stringify(inspection)
        expect(serializedInspection).not.toContain(registrySentinel)
        expect(serializedInspection).not.toContain(apiKeySentinel)
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
})
