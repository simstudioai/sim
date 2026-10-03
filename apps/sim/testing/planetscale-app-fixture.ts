import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { db } from '@sim/db'
import { permissions, session, user, workflow, workspace } from '@sim/db/schema'
import { readTestDatabaseUrl, readTestRedisUrl } from '@sim/db/testing/test-infrastructure'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { serializeSignedCookie } from 'better-call'
import { eq } from 'drizzle-orm'

/** Real Next/auth/database fixture; only fixed-origin PlanetScale requests are redirected. */
export async function createPlanetScaleAppFixture() {
  const root = resolve(process.cwd(), '../..')
  const databaseUrl = readTestDatabaseUrl()
  const redisUrl = readTestRedisUrl()
  if (!redisUrl) throw new Error('PlanetScale app validation requires disposable Redis')
  const directory = await mkdtemp(resolve(tmpdir(), 'sim-planetscale-app-'))
  const userId = generateId()
  const workspaceId = generateId()
  const workflowId = generateId()
  const authSecret = 'planetscale-fixture-auth-secret-is-not-a-real-credential'
  const internalSecret = 'planetscale-fixture-internal-secret-is-not-a-real-credential'
  const fixtureSecret = generateId()
  const serviceTokenId = 'fixture-service-token-id'
  const serviceToken = 'fixture-service-token-secret'
  const signingSecret = 'fixture-generated-signing-secret'
  const remoteHooks = new Map<string, Record<string, unknown>>()
  const providerRequests: { method: string; path: string; status: number }[] = []
  const httpResults: { method: string; path: string; status: number; durationMs: number }[] = []
  let deleteStatus = 204
  let createWithoutSecret = false
  let appUrl = ''
  let child: ChildProcess | undefined
  let realtimeChild: ChildProcess | undefined
  let log = ''
  const now = new Date()
  await db.insert(user).values({
    id: userId,
    name: 'PlanetScale Fixture',
    email: `${userId}@planetscale.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(workspace).values({
    id: workspaceId,
    name: 'PlanetScale Fixture',
    ownerId: userId,
    billedAccountUserId: userId,
  })
  await db.insert(permissions).values({
    id: generateId(),
    userId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
  })
  await db.insert(workflow).values({
    id: workflowId,
    userId,
    workspaceId,
    name: 'PlanetScale Fixture',
    createdAt: now,
    updatedAt: now,
    lastSynced: now,
  })
  const token = generateId()
  await db.insert(session).values({
    id: generateId(),
    userId,
    token,
    expiresAt: new Date(Date.now() + 3_600_000),
    createdAt: now,
    updatedAt: now,
  })
  const cookie = (
    await serializeSignedCookie('better-auth.session_token', token, authSecret)
  ).split(';')[0]

  const providerServer = createServer(async (incoming, outgoing) => {
    if (incoming.url === '/login') {
      outgoing
        .writeHead(302, {
          'set-cookie': `${cookie}; Path=/; HttpOnly; SameSite=Lax`,
          location: `${appUrl}/workspace/${workspaceId}/w/${workflowId}`,
        })
        .end()
      return
    }
    if (incoming.headers['x-planetscale-fixture'] !== fixtureSecret) {
      outgoing.writeHead(401).end()
      return
    }
    const path = incoming.url?.split('?')[0] ?? ''
    if (incoming.headers.authorization !== `${serviceTokenId}:${serviceToken}`) {
      outgoing.writeHead(401).end()
      providerRequests.push({ method: incoming.method ?? '', path, status: 401 })
      return
    }
    const reply = (status: number, body?: unknown) => {
      providerRequests.push({ method: incoming.method ?? '', path, status })
      outgoing
        .writeHead(status, { 'content-type': 'application/json' })
        .end(body === undefined ? undefined : JSON.stringify(body))
    }
    if (incoming.method === 'GET' && path === '/v1/organizations/fixture-org/databases') {
      reply(200, {
        data: [{ id: 'fixture-db-id', name: 'fixture-db' }],
        next_page: null,
        current_page: 1,
        per_page: 100,
        total_count: 1,
        total_pages: 1,
      })
      return
    }
    if (
      incoming.method === 'GET' &&
      path === '/v1/organizations/fixture-org/databases/fixture-db'
    ) {
      reply(200, {
        id: 'fixture-db-id',
        name: 'fixture-db',
        kind: 'vitess',
        state: 'ready',
        ready: true,
        default_branch: 'main',
        branches_count: 1,
        deletion_protected: false,
        require_approval_for_deploy: false,
        created_at: '2023-10-25T16:54:12.879Z',
        updated_at: '2023-10-25T16:54:39.820Z',
        html_url: 'https://app.planetscale.com/fixture-org/fixture-db',
      })
      return
    }
    const base = '/v1/organizations/fixture-org/databases/fixture-db/webhooks'
    if (incoming.method === 'POST' && path === base) {
      const chunks: Buffer[] = []
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString())
      if (
        !isRecordLike(body) ||
        typeof body.url !== 'string' ||
        body.enabled !== true ||
        !Array.isArray(body.events) ||
        !body.events.length
      ) {
        reply(422, {})
        return
      }
      if (remoteHooks.size >= 5) {
        reply(422, {})
        return
      }
      const id = generateId()
      const hook = {
        id,
        url: body.url,
        events: body.events,
        enabled: true,
        secret: createWithoutSecret ? '' : signingSecret,
      }
      remoteHooks.set(id, hook)
      reply(201, hook)
      return
    }
    const id = path.startsWith(`${base}/`) ? decodeURIComponent(path.slice(base.length + 1)) : ''
    if (incoming.method === 'GET' && id) {
      reply(remoteHooks.has(id) ? 200 : 404, remoteHooks.get(id))
      return
    }
    if (incoming.method === 'DELETE' && id) {
      if (!remoteHooks.has(id)) {
        reply(404)
        return
      }
      if (deleteStatus === 204) remoteHooks.delete(id)
      reply(deleteStatus)
      return
    }
    reply(404, {})
  })
  const providerUrl = await listen(providerServer)
  const appPort = await freePort()
  const realtimePort = await freePort()
  appUrl = `http://127.0.0.1:${appPort}`
  const realtimeUrl = `http://127.0.0.1:${realtimePort}`
  const preload = resolve(directory, 'provider-preload.mjs')
  await writeFile(
    preload,
    `
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
const nativeConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const options = normalized[0];
  const host = typeof options === 'object' ? options.host ?? options.hostname ?? 'localhost' : typeof normalized[1] === 'string' ? normalized[1] : 'localhost';
  if (!(typeof options === 'object' && options.path) && !['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('Unexpected external socket in PlanetScale fixture');
  return nativeConnect.apply(this, args);
};
syncBuiltinESMExports();
const nativeFetch = globalThis.fetch;
const provider = ${JSON.stringify(providerUrl)};
const allowed = new Set(${JSON.stringify([appUrl, realtimeUrl, providerUrl])});
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin === 'https://api.planetscale.com' && url.pathname.startsWith('/v1/')) {
    const headers = new Headers(request.headers);
    headers.set('x-planetscale-fixture', ${JSON.stringify(fixtureSecret)});
    return nativeFetch(new Request(provider + url.pathname + url.search, { method: request.method, headers, body: ['GET','HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(), signal: request.signal, redirect: 'error' }));
  }
  if (!allowed.has(url.origin)) throw new Error('Unexpected external request in PlanetScale fixture');
  return nativeFetch(request);
};
`
  )
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    NODE_ENV: 'development',
    DATABASE_URL: databaseUrl,
    MIGRATION_DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    BETTER_AUTH_SECRET: authSecret,
    BETTER_AUTH_URL: appUrl,
    INTERNAL_API_SECRET: internalSecret,
    ENCRYPTION_KEY: '0'.repeat(64),
    API_ENCRYPTION_KEY: '1'.repeat(64),
    NEXT_PUBLIC_APP_URL: appUrl,
    INTERNAL_API_BASE_URL: appUrl,
    NEXT_PUBLIC_SOCKET_URL: realtimeUrl,
    SOCKET_SERVER_URL: realtimeUrl,
    BILLING_ENABLED: 'false',
    DISABLE_AUTH: 'false',
    DISABLE_TELEMETRY: 'true',
    FORKING_ENABLED: 'true',
    KNOWLEDGE_MEMBER_ACCESS: 'true',
    ACCESS_CONTROL_ENABLED: 'true',
    STORAGE_PROVIDER: 'local',
    OCR_PROVIDER: 'local',
    NEXT_TELEMETRY_DISABLED: '1',
    NODE_OPTIONS: `--max-old-space-size=8192 --import=${preload}`,
  }
  const capture = (process: ChildProcess) => {
    process.stdout?.on('data', (chunk: Buffer) => {
      log += chunk.toString()
    })
    process.stderr?.on('data', (chunk: Buffer) => {
      log += chunk.toString()
    })
  }
  const close = async () => {
    await Promise.all([stopChild(child), stopChild(realtimeChild)])
    await writeFile(
      resolve(directory, 'app.log'),
      log
        .replaceAll(cookie, '[REDACTED]')
        .replaceAll(serviceToken, '[REDACTED]')
        .replaceAll(signingSecret, '[REDACTED]')
    )
    await new Promise<void>((resolveClose) => {
      providerServer.close(() => resolveClose())
      providerServer.closeAllConnections()
    })
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
  }
  try {
    const runtimeBuild = spawnSync('bun', ['--no-env-file', 'run', 'build:cli-runtime'], {
      cwd: resolve(root, 'apps/sim'),
      env: environment,
      encoding: 'utf8',
    })
    if (runtimeBuild.status !== 0)
      throw new Error('Unable to build the existing CLI runtime for app validation')
    realtimeChild = spawn('bun', ['--no-env-file', 'src/index.ts'], {
      cwd: resolve(root, 'apps/realtime'),
      env: {
        ...environment,
        NODE_OPTIONS: '',
        PORT: String(realtimePort),
        ALLOWED_ORIGINS: appUrl,
      },
      stdio: 'pipe',
    })
    capture(realtimeChild)
    child = spawn(
      'node',
      [
        resolve(root, 'node_modules/next/dist/bin/next'),
        'dev',
        '--turbopack',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(appPort),
      ],
      { cwd: resolve(root, 'apps/sim'), env: environment, stdio: 'pipe' }
    )
    capture(child)
    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`PlanetScale app exited: ${log.slice(-4000)}`)
      try {
        const response = await fetch(`${appUrl}/api/health`, { signal: AbortSignal.timeout(2000) })
        if (response.status < 500) break
      } catch {}
      await sleep(500)
    }
    if (Date.now() >= deadline) throw new Error(`PlanetScale app did not boot: ${log.slice(-4000)}`)
  } catch (error) {
    await close()
    throw error
  }

  return {
    appUrl,
    providerUrl,
    userId,
    workspaceId,
    workflowId,
    cookie,
    directory,
    signingSecret,
    serviceTokenId,
    serviceToken,
    providerRequests,
    httpResults,
    remoteHooks,
    loginUrl: `${providerUrl}/login`,
    setDeleteStatus(status: number) {
      deleteStatus = status
    },
    setCreateWithoutSecret(value: boolean) {
      createWithoutSecret = value
    },
    async request(path: string, method = 'GET', body?: unknown, authenticated = true) {
      const start = performance.now()
      const response = await fetch(`${appUrl}${path}`, {
        method,
        headers: { ...(authenticated ? { cookie } : {}), 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      httpResults.push({
        method,
        path,
        status: response.status,
        durationMs: performance.now() - start,
      })
      return response
    },
    async deliver(
      path: string,
      payload: unknown,
      headers: Record<string, string> = {},
      valid = true
    ) {
      const raw = JSON.stringify(payload, null, 2)
      const start = performance.now()
      const response = await fetch(`${appUrl}/api/webhooks/trigger/${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-PlanetScale-Signature': valid
            ? createHmac('sha256', signingSecret).update(raw).digest('hex')
            : '0'.repeat(64),
          ...headers,
        },
        body: raw,
      })
      httpResults.push({
        method: 'POST',
        path: `/api/webhooks/trigger/${path}`,
        status: response.status,
        durationMs: performance.now() - start,
      })
      return response
    },
    async report(path: string, evidence: unknown) {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, JSON.stringify({ httpResults, providerRequests, evidence }, null, 2))
    },
    close,
  }
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture did not bind loopback')
  return `http://127.0.0.1:${address.port}`
}
async function freePort(): Promise<number> {
  const server = createServer()
  const url = await listen(server)
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
  return Number(new URL(url).port)
}

async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) return
    await sleep(100)
  }
  child.kill('SIGKILL')
  if (child.exitCode === null && child.signalCode === null)
    await new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()))
}
