/** @vitest-environment node */
import { type ChildProcess, execFileSync, fork } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import {
  readStoredCredential,
  writeConfigProfile,
  writeCredentialsProfile,
} from '../config/profile'

interface WorkerResult {
  refreshToken?: string
  error?: string
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  void promise.catch(() => undefined)
  return { promise, resolve, reject }
}
let buildDir: string
let workerPath: string
let configDir: string
const children = new Set<ChildProcess>()
beforeAll(() => {
  buildDir = mkdtempSync(join(tmpdir(), 'sim-oauth-process-build-'))
  const source = join(buildDir, 'worker.ts')
  const modulePath = (path: string) => JSON.stringify(fileURLToPath(new URL(path, import.meta.url)))
  writeFileSync(
    source,
    `
    import { readStoredCredential } from ${modulePath('../config/profile.ts')}
    import { refreshStoredOAuth } from ${modulePath('./refresh.ts')}
    import { logoutCommand } from ${modulePath('../commands/auth.ts')}
    const current = readStoredCredential('default').oauth
    process.once('message', async () => {
      try {
        if (process.argv[2] === 'logout') {
          await logoutCommand().parseAsync([], { from: 'user' })
          process.send({})
        } else {
          const next = await refreshStoredOAuth({ name: 'default', authProfile: 'default', endpoint: process.env.TEST_ENDPOINT }, current)
          process.send({ refreshToken: next.refreshToken })
        }
      } catch (error) { process.send({ error: error.message }) }
      process.disconnect()
    })
    process.send('ready')
  `
  )
  mkdirSync(join(buildDir, 'dist'))
  writeFileSync(join(buildDir, 'package.json'), JSON.stringify({ version: '2.1.2' }))
  workerPath = join(buildDir, 'dist', 'worker.mjs')
  execFileSync('bun', ['build', source, '--target=node', '--format=esm', '--outfile', workerPath], {
    stdio: 'pipe',
  })
})
afterAll(() => rmSync(buildDir, { recursive: true, force: true }))
beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'sim-oauth-process-config-'))
  vi.stubEnv('SIM_CONFIG_DIR', configDir)
  vi.stubEnv('SIM_CONFIG_FILE', undefined)
  vi.stubEnv('SIM_CREDENTIALS_FILE', undefined)
})
afterEach(() => {
  for (const child of children) child.kill('SIGKILL')
  children.clear()
  vi.unstubAllEnvs()
  rmSync(configDir, { recursive: true, force: true })
})
function startWorker(endpoint: string, mode: 'refresh' | 'logout') {
  const ready = deferred<void>()
  const result = deferred<WorkerResult>()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SIM_CONFIG_DIR: configDir,
    TEST_ENDPOINT: endpoint,
  }
  for (const key of Object.keys(env)) {
    if (key.startsWith('SIM_') && key !== 'SIM_CONFIG_DIR') delete env[key]
  }
  const child = fork(workerPath, [mode], { env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  children.add(child)
  let output: WorkerResult | undefined
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  child.on('message', (message: unknown) => {
    if (message === 'ready') ready.resolve()
    else output = message as WorkerResult
  })
  child.once('error', (error) => {
    ready.reject(error)
    result.reject(error)
  })
  child.once('exit', (code) => {
    children.delete(child)
    if (code === 0 && output) result.resolve(output)
    else {
      const error = new Error(`OAuth worker exited ${code}: ${stderr}`)
      ready.reject(error)
      result.reject(error)
    }
  })
  return { ready: ready.promise, result: result.promise, run: () => child.send('run') }
}
async function withOAuthServer(
  run: (context: {
    endpoint: string
    requests: string[]
    firstRequest: Promise<void>
    release: () => void
  }) => Promise<void>
) {
  const requests: string[] = []
  const firstRequest = deferred<void>()
  let heldResponse: ServerResponse | undefined
  const respond = (response: ServerResponse) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
        scope: 'offline_access api:read',
      })
    )
  }
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const body = new URLSearchParams(Buffer.concat(chunks).toString())
      requests.push(`${request.url}:${body.get('refresh_token') ?? body.get('token')}`)
      if (requests.length === 1) {
        heldResponse = response
        firstRequest.resolve()
      } else respond(response)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  writeConfigProfile('default', { endpoint })
  writeCredentialsProfile('default', {
    kind: 'oauth',
    oauth: {
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: 1,
      issuer: `${endpoint}/api/auth`,
      loginId: 'process-test',
      scope: 'offline_access api:read',
    },
  })
  try {
    await run({
      endpoint,
      requests,
      firstRequest: firstRequest.promise,
      release: () => {
        if (heldResponse) respond(heldResponse)
      },
    })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
it('two independent processes share one refresh and persist the same rotation', async () => {
  await withOAuthServer(async ({ endpoint, requests, firstRequest, release }) => {
    const first = startWorker(endpoint, 'refresh')
    const second = startWorker(endpoint, 'refresh')
    await Promise.all([first.ready, second.ready])
    first.run()
    await firstRequest
    second.run()
    release()
    expect(await Promise.all([first.result, second.result])).toEqual([
      { refreshToken: 'new-refresh' },
      { refreshToken: 'new-refresh' },
    ])
    expect(requests).toEqual(['/api/auth/oauth2/token:old-refresh'])
    expect(readStoredCredential('default')).toMatchObject({
      oauth: { refreshToken: 'new-refresh' },
    })
  })
}, 15000)
it.each(['refresh', 'logout'] as const)(
  'serializes logout with refresh when %s holds the lock first',
  async (firstMode) => {
    await withOAuthServer(async ({ endpoint, requests, firstRequest, release }) => {
      const first = startWorker(endpoint, firstMode)
      const second = startWorker(endpoint, firstMode === 'refresh' ? 'logout' : 'refresh')
      await Promise.all([first.ready, second.ready])
      first.run()
      await firstRequest
      second.run()
      release()
      const results = await Promise.all([first.result, second.result])
      expect(readStoredCredential('default')).toBeNull()
      if (firstMode === 'refresh') {
        expect(results).toEqual([{ refreshToken: 'new-refresh' }, {}])
        expect(requests).toEqual([
          '/api/auth/oauth2/token:old-refresh',
          '/api/auth/oauth2/revoke:new-refresh',
        ])
      } else {
        expect(results[0]).toEqual({})
        expect(results[1].error).toContain('stored login changed')
        expect(requests).toEqual(['/api/auth/oauth2/revoke:old-refresh'])
      }
    })
  },
  15000
)
