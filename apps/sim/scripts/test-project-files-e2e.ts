import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId, generateShortId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { makeSignature } from 'better-auth/crypto'
import postgres from 'postgres'

/** Owns disposable infrastructure and prerequisite credentials for the existing real HTTP suites. */
const logger = createLogger('ProjectFilesHttpE2E')
const required = (name: string) => {
  const value = process.env[name]
  assert.ok(value, `${name} is required`)
  return value
}
function requiredString(value: unknown): string {
  assert.ok(typeof value === 'string' && value.length > 0, 'Fixture response field is missing')
  return value
}
const reportPath = resolve(required('PROJECT_FILES_E2E_REPORT_PATH'))
const reportDir = dirname(reportPath)
const adminUrl = new URL(required('PROJECT_FILES_E2E_ADMIN_DATABASE_URL'))
const base = new URL(required('PROJECT_FILES_E2E_BASE_URL'))
const relay = new URL(required('PROJECT_FILES_E2E_RELAY_URL'))
const redis = new URL(required('PROJECT_FILES_E2E_REDIS_URL'))
for (const url of [adminUrl, base, relay, redis]) {
  assert.ok(
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
    'Loopback services required'
  )
}
for (const url of [base, relay]) {
  assert.equal(url.protocol, 'http:')
  assert.ok(url.port && !url.username && !url.password && url.pathname === '/')
}
assert.notEqual(base.origin, relay.origin)
assert.ok(['postgres:', 'postgresql:'].includes(adminUrl.protocol))
assert.equal(redis.protocol, 'redis:')
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rootDir = resolve(appDir, '../..')
const privateDir = await mkdtemp(join(tmpdir(), 'sim-project-files-http-'))
const databaseName = `sim_project_files_http_test_${generateId().replaceAll('-', '')}`
const databaseUrl = new URL(adminUrl)
databaseUrl.pathname = `/${databaseName}`
const authSecret = generateShortId(48)
const internalSecret = generateShortId(48)
const secrets = new Set([adminUrl.toString(), databaseUrl.toString(), authSecret, internalSecret])
if (adminUrl.password) secrets.add(adminUrl.password)
if (redis.password) secrets.add(redis.password)
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const logs: { source: string; target: string }[] = []
const exits: {
  name: string
  code: number | null
  signal: NodeJS.Signals | null
  requestedStop: boolean
  error?: string
}[] = []
const processes: ReturnType<typeof start>[] = []
const admin = postgres(adminUrl.toString(), { max: 1 })
let sql: ReturnType<typeof postgres> | undefined
let createdDatabase = false
let migrated = false
let interrupted = false
const environment: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  SYSTEMROOT: process.env.SYSTEMROOT,
  NODE_ENV: 'development',
  __NEXT_PROCESSED_ENV: 'true',
  DATABASE_URL: databaseUrl.toString(),
  MIGRATION_DATABASE_URL: databaseUrl.toString(),
  REDIS_URL: redis.toString(),
  BETTER_AUTH_SECRET: authSecret,
  INTERNAL_API_SECRET: internalSecret,
  ENCRYPTION_KEY: '0'.repeat(64),
  NEXT_PUBLIC_APP_URL: base.origin,
  BETTER_AUTH_URL: base.origin,
  INTERNAL_API_BASE_URL: base.origin,
  SOCKET_SERVER_URL: relay.origin,
  NEXT_PUBLIC_SOCKET_URL: relay.origin,
  ALLOWED_ORIGINS: base.origin,
  NEXT_PUBLIC_FORCE_HOSTED: 'true',
  BILLING_ENABLED: 'true',
  NEXT_PUBLIC_BILLING_ENABLED: 'true',
  ENTERPRISE_ENABLED: 'true',
  NEXT_PUBLIC_ENTERPRISE_ENABLED: 'true',
  ACCESS_CONTROL_ENABLED: 'true',
  NEXT_PUBLIC_ACCESS_CONTROL_ENABLED: 'true',
  ORGANIZATIONS_ENABLED: 'true',
  NEXT_PUBLIC_ORGANIZATIONS_ENABLED: 'true',
  SSO_ENABLED: 'true',
  NEXT_PUBLIC_SSO_ENABLED: 'true',
  PROJECT_API_ENABLED: 'true',
  PROJECT_FILES_ENABLED: 'true',
  STORAGE_PROVIDER: 'local',
  EMAIL_VERIFICATION_ENABLED: 'false',
  NEXT_PUBLIC_CHAT_DISABLED: 'true',
  DISABLE_TELEMETRY: 'true',
  NEXT_TELEMETRY_DISABLED: '1',
  DB_TX_TRIPWIRE: 'throw',
}

function redact(text: string) {
  for (const secret of secrets) text = text.replaceAll(secret, '[redacted]')
  return text
}

async function saveReport() {
  await mkdir(reportDir, { recursive: true })
  await writeFile(
    reportPath,
    redact(JSON.stringify({ databaseName, checks, exits, reportsDirectory: reportDir }, null, 2))
  )
}

async function check(name: string, action: () => Promise<void>) {
  const started = performance.now()
  try {
    await action()
    checks.push({ name, status: 'passed', durationMs: performance.now() - started })
    logger.info(`PASS ${name}`)
    return true
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: performance.now() - started,
      error: redact(getErrorMessage(error)),
    })
    logger.error(`FAIL ${name}`)
    return false
  } finally {
    await saveReport()
  }
}

function start(name: string, command: string[], cwd: string, env = environment) {
  const source = join(privateDir, `${name}.log`)
  const descriptor = openSync(source, 'w', 0o600)
  const child = spawn(command[0], command.slice(1), {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', descriptor, descriptor],
  })
  closeSync(descriptor)
  const lifecycle = { requestedStop: false }
  const done = new Promise<number>((resolveExit) => {
    child.once('error', (error) => {
      exits.push({
        name,
        code: null,
        signal: null,
        requestedStop: lifecycle.requestedStop,
        error: getErrorMessage(error),
      })
      resolveExit(-1)
    })
    child.once('exit', (code, signal) => {
      exits.push({ name, code, signal, requestedStop: lifecycle.requestedStop })
      resolveExit(code ?? -1)
    })
  })
  logs.push({ source, target: join(reportDir, `${name}.log`) })
  return { child, done, lifecycle }
}

async function stop(process: ReturnType<typeof start>) {
  const { child, done } = process
  if (child.exitCode === null && child.signalCode === null && child.pid) {
    process.lifecycle.requestedStop = true
    try {
      globalThis.process.kill(-child.pid, 'SIGTERM')
    } catch {}
    for (
      let attempt = 0;
      attempt < 100 && child.exitCode === null && child.signalCode === null;
      attempt++
    )
      await sleep(100)
    if (child.exitCode === null && child.signalCode === null) {
      try {
        globalThis.process.kill(-child.pid, 'SIGKILL')
      } catch {}
    }
  }
  await done
}

async function run(name: string, command: string[], cwd: string, env = environment) {
  assert.equal(interrupted, false, 'Acceptance run interrupted')
  const child = start(name, command, cwd, env)
  processes.push(child)
  const timeout = setTimeout(() => {
    if (child.child.pid) {
      try {
        process.kill(-child.child.pid, 'SIGKILL')
      } catch {}
    }
  }, 10 * 60_000)
  try {
    assert.equal(await child.done, 0, `${name} failed; inspect ${name}.log`)
  } finally {
    clearTimeout(timeout)
    await stop(child)
  }
}

async function ready(url: URL, path: string, child: ReturnType<typeof start>) {
  const deadline = Date.now() + 300_000
  while (Date.now() < deadline) {
    assert.equal(interrupted, false, 'Acceptance run interrupted')
    assert.equal(child.child.exitCode, null, 'Service exited before becoming ready')
    assert.equal(child.child.signalCode, null, 'Service stopped before becoming ready')
    try {
      // boundary-raw-fetch: the harness waits for its own loopback app and relay processes.
      const response = await fetch(new URL(path, url), { signal: AbortSignal.timeout(5_000) })
      await response.body?.cancel()
      if (response.ok) return
    } catch {}
    await sleep(1_000)
  }
  throw new Error('Local service readiness deadline exceeded')
}

async function request(cookie: string, path: string, body: object, method = 'POST') {
  // boundary-raw-fetch: fixture resources enter through the running application's actual authenticated APIs.
  const response = await fetch(new URL(path, base), {
    method,
    headers: { Cookie: cookie, Origin: base.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  })
  assert.ok(response.ok, `${method} ${path} returned ${response.status}`)
  return toRecord(await response.json())
}

async function seed(name: string) {
  assert.ok(sql)
  const directory = join(privateDir, name)
  await mkdir(directory, { mode: 0o700 })
  const ownerId = generateId()
  const token = generateShortId(48)
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  const cookie = `better-auth.session_token=${encodeURIComponent(`${token}.${await makeSignature(token, authSecret)}`)}`
  const personalKey = `sk-sim-http-${generateShortId(32)}`
  const workspaceKey = `sk-sim-http-${generateShortId(32)}`
  for (const value of [token, cookie, personalKey, workspaceKey]) secrets.add(value)
  await sql.begin(async (tx) => {
    const email = `${ownerId}@project-files-http.test`
    await tx`insert into "user" (id,name,email,normalized_email,email_verified,created_at,updated_at)
      values (${ownerId},'Project files HTTP owner',${email},${email},true,now(),now())`
    await tx`insert into user_stats (id,user_id) values (${generateId()},${ownerId})`
    await tx`insert into subscription (id,plan,reference_id,status) values (${generateId()},'pro',${ownerId},'active')`
    await tx`insert into session (id,token,user_id,expires_at,created_at,updated_at)
      values (${generateId()},${token},${ownerId},${expiresAt},now(),now())`
    await tx`insert into api_key (id,user_id,name,key,key_hash,type)
      values (${generateId()},${ownerId},'Disposable HTTP personal key',${personalKey},${sha256Hex(personalKey)},'personal')`
  })
  const project = await request(cookie, '/api/projects', {
    name: `HTTP ${name}`,
    organizationId: null,
    initialEnvironment: { name: 'Sandbox' },
  })
  const foreign = await request(cookie, '/api/projects', {
    name: `HTTP ${name} foreign`,
    organizationId: null,
    initialEnvironment: { name: 'Sandbox' },
  })
  const projectId = requiredString(toRecord(project.project).id)
  const workspaceId = requiredString(toRecord(project.initialEnvironment).id)
  const foreignProjectId = requiredString(toRecord(foreign.project).id)
  await sql`insert into api_key (id,user_id,workspace_id,name,key,key_hash,type)
    values (${generateId()},${ownerId},${workspaceId},'Disposable HTTP workspace key',${workspaceKey},${sha256Hex(workspaceKey)},'workspace')`
  for (const [filename, data] of [
    ['owner-account.json', { userId: ownerId, cookies: [cookie] }],
    ['v2-fixture-keys.json', { personal: personalKey, workspace: workspaceKey }],
    ['http-project-fixture.json', project],
  ] as const)
    await writeFile(join(directory, filename), JSON.stringify(data), { mode: 0o600 })
  return { directory, projectId, workspaceId, foreignProjectId, cookie }
}

async function seedInline(fixture: Awaited<ReturnType<typeof seed>>) {
  const image =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII='
  const create = async (
    projectId: string,
    name: string,
    content: string,
    contentType: string,
    encoding: string
  ) =>
    toRecord(
      (
        await request(fixture.cookie, `/api/projects/${projectId}/files`, {
          name,
          content,
          contentType,
          encoding,
        })
      ).file
    )
  const ownImage = await create(fixture.projectId, 'own.png', image, 'image/png', 'base64')
  const foreignImage = await create(
    fixture.foreignProjectId,
    'foreign.png',
    image,
    'image/png',
    'base64'
  )
  const foreignPath = `/api/projects/${fixture.foreignProjectId}/files/${foreignImage.id}/content`
  const doc = await create(
    fixture.projectId,
    'architecture.md',
    `![own](sim:file/${ownImage.id}?project=${fixture.projectId})\n![foreign](${foreignPath})`,
    'text/markdown',
    'utf-8'
  )
  const share = toRecord(
    (
      await request(
        fixture.cookie,
        `/api/projects/${fixture.projectId}/files/${doc.id}/share`,
        { isActive: true, authType: 'public' },
        'PUT'
      )
    ).share
  )
  secrets.add(requiredString(share.token))
  const path = join(fixture.directory, 'inline-source-fixture.json')
  await writeFile(
    path,
    JSON.stringify({
      projectId: fixture.projectId,
      files: [{ owner: 'project', fileId: doc.id, imageId: ownImage.id, token: share.token }],
      wrongOwner: { projectId: fixture.foreignProjectId, fileId: foreignImage.id },
    }),
    { mode: 0o600 }
  )
  return path
}

function interrupt() {
  interrupted = true
  void Promise.all(processes.map(stop)).catch(() => undefined)
}
process.once('SIGINT', interrupt)
process.once('SIGTERM', interrupt)

const suites = [
  ['delivery', 'FILE_DELIVERY', 'test-file-delivery-e2e.ts'],
  ['browser', 'PROJECT_FILE_BROWSER', 'test-project-file-browser-e2e.ts'],
  ['history', 'PROJECT_FILE_HISTORY', 'test-project-file-history-e2e.ts'],
  ['rendered', 'PROJECT_FILE_RENDERED', 'test-project-file-rendered-e2e.ts'],
  ['public', 'PROJECT_FILE_PUBLIC', 'test-project-file-public-e2e.ts'],
  ['sharing', 'PROJECT_FILE_SHARING', 'test-project-file-sharing-e2e.ts'],
  ['inline-source', 'PROJECT_INLINE_SOURCE', 'test-project-file-inline-source-e2e.ts'],
  ['copy', 'FILE_COPY', 'test-file-copy-e2e.ts'],
  ['realtime', 'FILE_LIST_REALTIME', 'test-file-list-realtime-e2e.ts'],
] as const

try {
  assert.ok(
    await check(
      'Create an exclusively owned disposable database and apply normal migrations',
      async () => {
        await admin.unsafe(`CREATE DATABASE "${databaseName}"`)
        createdDatabase = true
        await run(
          'project-files-migrate',
          ['bun', '--no-env-file', 'scripts/migrate.ts'],
          join(rootDir, 'packages/db')
        )
        migrated = true
        sql = postgres(databaseUrl.toString(), { max: 2 })
      }
    )
  )
  assert.ok(
    await check('Start the real app and relay with local-only runtime settings', async () => {
      const app = start(
        'project-files-next',
        [
          'node',
          join(rootDir, 'node_modules/next/dist/bin/next'),
          'dev',
          '--hostname',
          base.hostname,
          '--port',
          base.port,
        ],
        appDir
      )
      processes.push(app)
      await ready(base, '/api/health', app)
      const socket = start(
        'project-files-relay',
        ['bun', '--no-env-file', 'src/index.ts'],
        join(rootDir, 'apps/realtime'),
        { ...environment, PORT: relay.port, SIM_DB_ROLE: 'realtime', DB_APP_NAME: 'sim-realtime' }
      )
      processes.push(socket)
      await ready(relay, '/health', socket)
    })
  )
  for (const [name, prefix, script] of suites) {
    const selectedSuites = process.env.PROJECT_FILES_E2E_SUITES?.split(',')
    if (selectedSuites && !selectedSuites.includes(name)) continue
    assert.equal(interrupted, false, 'Acceptance run interrupted')
    await check(`Existing ${name} acceptance suite`, async () => {
      const fixture = await seed(name)
      const fixturePath = name === 'inline-source' ? await seedInline(fixture) : undefined
      await run(
        `project-files-${name}`,
        ['bun', '--no-env-file', join('scripts', script)],
        appDir,
        {
          ...environment,
          [`${prefix}_BASE_URL`]: base.origin,
          [`${prefix}_FIXTURE_DIR`]: fixture.directory,
          [`${prefix}_REPORT_PATH`]: join(reportDir, `project-files-${name}.json`),
          PROJECT_FILE_RENDERED_FOREIGN_PROJECT_ID: fixture.foreignProjectId,
          PROJECT_FILE_PUBLIC_WORKSPACE_ID: fixture.workspaceId,
          PROJECT_INLINE_SOURCE_FIXTURE_PATH: fixturePath,
          FILE_COPY_WORKSPACE_ID: fixture.workspaceId,
          FILE_LIST_REALTIME_RELAY_URL: relay.origin,
        }
      )
    })
  }
} catch (error) {
  checks.push({
    name: 'Orchestration stopped',
    status: 'failed',
    durationMs: 0,
    error: redact(getErrorMessage(error)),
  })
} finally {
  await check('Stop all owned child processes', async () => {
    for (const child of [...processes].reverse()) await stop(child)
  })
  if (sql && migrated) {
    const database = sql
    await check('Retain token redactions before retiring fixture records', async () => {
      const credentials = await database<{ value: string }[]>`
        select token as value from session
        union all select token as value from public_share
        union all select key as value from api_key`
      for (const credential of credentials) secrets.add(credential.value)
    })
    await check(
      'Remove only storage prefixes belonging to the owned disposable database',
      async () => {
        const owners = await database<
          { id: string; type: string }[]
        >`select id,'project' as type from project union all select id,'workspace' as type from workspace`
        for (const owner of owners) {
          assert.match(owner.id, /^[A-Za-z0-9_-]+$/)
          await rm(join(appDir, 'uploads', owner.type, owner.id), { force: true, recursive: true })
          if (owner.type === 'workspace')
            await rm(join(appDir, 'uploads', 'copilot-doc-compiled', owner.id), {
              force: true,
              recursive: true,
            })
        }
      }
    )
    await check('Close fixture database connections', () => database.end())
  }
  if (createdDatabase)
    await check('Drop only the database successfully created by this run', async () => {
      assert.match(databaseName, /^sim_project_files_http_test_[a-f0-9]{32}$/)
      await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`)
      createdDatabase = false
    })
  await check('Close administrative database connection', () => admin.end())
  await check('Publish redacted logs and remove private credentials', async () => {
    const collect = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) await collect(path)
        else if (entry.name.endsWith('.json')) {
          const scan = (value: unknown, key = '') => {
            if (
              typeof value === 'string' &&
              /^(cookies?|readerCookie|password|token|uploadToken|personal|workspace)$/i.test(
                key
              ) &&
              value.length > 12
            )
              secrets.add(value)
            else if (Array.isArray(value)) for (const child of value) scan(child, key)
            else if (value && typeof value === 'object')
              for (const [name, child] of Object.entries(value)) scan(child, name)
          }
          scan(JSON.parse(await readFile(path, 'utf8')))
        }
      }
    }
    await collect(privateDir)
    for (const log of logs) await writeFile(log.target, redact(await readFile(log.source, 'utf8')))
    for (const [name] of suites) {
      const path = join(reportDir, `project-files-${name}.json`)
      try {
        await writeFile(path, redact(await readFile(path, 'utf8')))
      } catch (error) {
        if (toRecord(error).code !== 'ENOENT') throw error
      }
    }
    await rm(privateDir, { force: true, recursive: true })
  })
  await saveReport()
}
process.removeListener('SIGINT', interrupt)
process.removeListener('SIGTERM', interrupt)
process.exitCode = checks.some((check) => check.status === 'failed') ? 1 : 0
