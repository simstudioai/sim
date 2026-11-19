import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId, generateShortId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { type BlockCatalog, canonicalHash, canonicalize, compileWorkflow } from '@sim/workflow-code'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { makeSignature } from 'better-auth/crypto'
import postgres from 'postgres'
import { v2GetSourceCatalogContract } from '@/lib/api/contracts/v2/source-catalog'
import { v2GetWorkflowSourceContract } from '@/lib/api/contracts/v2/workflow-source'
import {
  v2ApplyWorkflowOperationsContract,
  v2CreateWorkflowContract,
  v2GetWorkflowStateContract,
} from '@/lib/api/contracts/v2/workflows'
import { getWorkflowSourceContract, type WorkflowSource } from '@/lib/api/contracts/workflow-source'
import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'

/**
 * Workflow source read path (`GET /api/v2/workflows/{workflowId}/source`) against a running local
 * app and a disposable database. The app must run with the `workflow-code` flag on
 * (`WORKFLOW_CODE=true`). It creates a workflow through the v2 create and operations routes, then
 * proves that the printed source compiles with zero errors to the canonical model of the stored
 * state, that the fingerprint follows semantic edits and ignores position-only ones, that a
 * workspace API key reads it, that a key for another workspace is answered 404, and that the
 * canvas route returns the same source under a session.
 *
 *   WORKFLOW_SOURCE_E2E_BASE_URL=http://127.0.0.1:3000 \
 *   WORKFLOW_SOURCE_E2E_DATABASE_URL=postgres://…/sim_test \
 *   WORKFLOW_SOURCE_E2E_AUTH_SECRET=… \
 *   WORKFLOW_SOURCE_E2E_REPORT_PATH=/tmp/workflow-source-report.json \
 *   bun run test:workflow-source:e2e
 */
const logger = createLogger('WorkflowSourceE2E')
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024
/** The first request to each route cold-compiles it under `next dev`. */
const REQUEST_TIMEOUT_MS = 300_000
const startedAt = new Date().toISOString()

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

const baseUrl = new URL(requiredEnvironment('WORKFLOW_SOURCE_E2E_BASE_URL'))
const databaseUrl = assertDisposableTestDatabaseUrl(
  requiredEnvironment('WORKFLOW_SOURCE_E2E_DATABASE_URL')
)
const authSecret = requiredEnvironment('WORKFLOW_SOURCE_E2E_AUTH_SECRET')
const reportPath = requiredEnvironment('WORKFLOW_SOURCE_E2E_REPORT_PATH')
assert(new Set(['localhost', '127.0.0.1', '[::1]']).has(baseUrl.hostname), 'Use a loopback app')
assert.equal(baseUrl.protocol, 'http:', 'Use a local HTTP app')
assert(!baseUrl.username && !baseUrl.password, 'App URL cannot contain credentials')
assert.equal(baseUrl.pathname, '/', 'App URL must be an origin')
assert(authSecret.length >= 32, 'Use a local Better Auth secret of at least 32 characters')

const sql = postgres(databaseUrl.toString(), { max: 2 })
const ownerId = generateId()
const workspaceId = generateId()
const foreignWorkspaceId = generateId()
const scoreBlockId = generateId()
const workspaceKey = `sk-sim-fixture-${generateId()}`
const foreignKey = `sk-sim-fixture-${generateId()}`
/** Graph writes deny workspace keys, so the fixture workflow is built with a personal key. */
const personalKey = `sk-sim-fixture-${generateId()}`
const sessionToken = generateShortId()
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const requests: { method: string; path: string; status: number; durationMs: number }[] = []
let cookie = ''
let workflowId = ''

function failureMessage(error: unknown): string {
  let message = getErrorMessage(error)
  for (const secret of [workspaceKey, foreignKey, personalKey, sessionToken, authSecret]) {
    message = message.replaceAll(secret, '[redacted]')
  }
  return truncate(message, 2000)
}

async function check(name: string, run: () => Promise<void>) {
  const started = performance.now()
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) })
    logger.info(`PASS ${name}`)
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      error: failureMessage(error),
    })
    throw error
  }
}

interface RequestAuth {
  key?: string
  session?: string
}

async function call(
  method: 'GET' | 'POST',
  path: string,
  auth: RequestAuth,
  expected: number,
  body?: unknown
): Promise<unknown> {
  const url = new URL(path, baseUrl)
  const headers = new Headers({ accept: 'application/json', 'x-forwarded-for': '127.0.0.1' })
  if (auth.key) headers.set('x-api-key', auth.key)
  if (auth.session) headers.set('cookie', `better-auth.session_token=${auth.session}`)
  if (body !== undefined) headers.set('content-type', 'application/json')
  const started = performance.now()
  // boundary-raw-fetch: protocol E2E exercises a separately running local app over real HTTP
  const response = await fetch(url, {
    method,
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  requests.push({
    method,
    path: url.pathname,
    status: response.status,
    durationMs: Math.round(performance.now() - started),
  })
  const text = await readResponseTextWithLimit(response, {
    maxBytes: MAX_RESPONSE_BYTES,
    label: 'Workflow source E2E response',
  })
  assert.equal(response.status, expected, `${method} ${url.pathname}: unexpected HTTP status`)
  return JSON.parse(text)
}

const sourcePath = (query = '') => `/api/v2/workflows/${workflowId}/source${query}`

async function readSource(query = ''): Promise<WorkflowSource> {
  return v2GetWorkflowSourceContract.response.schema.parse(
    await call('GET', sourcePath(query), { key: workspaceKey }, 200)
  ).data
}

async function readCatalog(): Promise<BlockCatalog> {
  const parsed = v2GetSourceCatalogContract.response.schema.parse(
    await call(
      'GET',
      `/api/v2/workspaces/${workspaceId}/workflows/source/catalog?workflowId=${workflowId}`,
      { key: workspaceKey },
      200
    )
  )
  const catalog: unknown = parsed.data
  assert(isBlockCatalog(catalog), 'Expected a block catalog')
  return catalog
}

/** The catalog fields this script reads; the response contract already validated the rest. */
function isBlockCatalog(value: unknown): value is BlockCatalog {
  return (
    isRecordLike(value) &&
    typeof value.hash === 'string' &&
    typeof value.sdkMajor === 'number' &&
    isRecordLike(value.blocks) &&
    isRecordLike(value.builders) &&
    isRecordLike(value.triggers)
  )
}

async function readStoredState(): Promise<WorkflowState> {
  const state: unknown = v2GetWorkflowStateContract.response.schema.parse(
    await call('GET', `/api/v2/workflows/${workflowId}/state`, { key: workspaceKey }, 200)
  ).data
  return state as WorkflowState
}

async function applyOperations(operations: unknown[]): Promise<void> {
  const { data } = v2ApplyWorkflowOperationsContract.response.schema.parse(
    await call('POST', `/api/v2/workflows/${workflowId}/operations`, { key: personalKey }, 200, {
      operations,
      atomic: true,
    })
  )
  assert.equal(data.skipped.length, 0, 'Every operation must apply')
}

async function seed() {
  await sql.begin(async (tx) => {
    const email = `${ownerId}@workflow-source.test`
    await tx`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
      values (${ownerId}, 'Workflow source fixture', ${email}, ${email}, true, now(), now())`
    await tx`insert into user_stats (id, user_id) values (${generateId()}, ${ownerId})`
    for (const id of [workspaceId, foreignWorkspaceId]) {
      await tx`insert into project (id, name, owner_id) values (${id}, 'Workflow source project', ${ownerId})`
      await tx`insert into workspace (id, project_id, name, owner_id, billed_account_user_id)
        values (${id}, ${id}, 'Workflow source fixture', ${ownerId}, ${ownerId})`
    }
    await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type)
      values (${generateId()}, ${ownerId}, 'workspace', ${workspaceId}, 'admin')`
    // `expires_at` is a UTC timestamp without a zone: `now()` alone is the server's local time.
    await tx`insert into session (id, token, user_id, expires_at, created_at, updated_at)
      values (${generateId()}, ${sessionToken}, ${ownerId},
        (now() at time zone 'utc') + interval '1 hour', now(), now())`
    for (const [id, key] of [
      [workspaceId, workspaceKey],
      [foreignWorkspaceId, foreignKey],
    ]) {
      await tx`insert into api_key (id, user_id, workspace_id, name, key, key_hash, type)
        values (${generateId()}, ${ownerId}, ${id}, 'Workflow source fixture', ${key}, ${sha256Hex(key)}, 'workspace')`
    }
    await tx`insert into api_key (id, user_id, name, key, key_hash, type)
      values (${generateId()}, ${ownerId}, 'Workflow source fixture', ${personalKey}, ${sha256Hex(personalKey)}, 'personal')`
  })
  cookie = encodeURIComponent(`${sessionToken}.${await makeSignature(sessionToken, authSecret)}`)
}

/** Compiles printed files against the source catalog; any error diagnostic fails. */
function compileSource(source: WorkflowSource, catalog: BlockCatalog) {
  const entryText = source.files['workflow.ts']
  assert(entryText, 'The source must include workflow.ts')
  const result = compileWorkflow({
    entry: { path: 'workflow.ts', text: entryText },
    files: new Map(Object.entries(source.files).filter(([path]) => path !== 'workflow.ts')),
    catalog,
    sdkMajor: source.sdkMajor,
  })
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
  assert.deepEqual(
    errors.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`),
    [],
    'The printed source must compile with zero errors'
  )
  assert(result.workflow, 'A compile with no errors returns a workflow')
  return result.workflow
}

try {
  await seed()

  await check(
    'create a workflow and add a wired function block through v2 operations',
    async () => {
      const created = v2CreateWorkflowContract.response.schema.parse(
        await call('POST', '/api/v2/workflows', { key: personalKey }, 201, {
          workspaceId,
          name: 'Workflow source fixture',
        })
      ).data
      workflowId = created.id
      const start = created.blocks[0]
      assert(start, 'The new workflow is seeded with a start block')
      await applyOperations([
        {
          operation_type: 'add',
          block_id: scoreBlockId,
          params: {
            type: 'function',
            name: 'Score',
            inputs: { code: 'return { score: 1 }' },
          },
        },
        {
          operation_type: 'edit',
          block_id: start.id,
          params: { connections: { success: scoreBlockId } },
        },
      ])
    }
  )

  let baseline: WorkflowSource | undefined
  await check(
    'a workspace API key reads source that compiles with zero errors to its canonical hash',
    async () => {
      const [source, catalog] = await Promise.all([readSource(), readCatalog()])
      assert.equal(source.base.catalogHash, catalog.hash)
      assert.match(source.base.fingerprint, /^sf1:[0-9a-f]{64}$/)
      assert(source.blockTypes.includes('function'), 'blockTypes lists the function block')
      assert.equal(source.lock.blocks.score?.id, scoreBlockId, 'The lock binds the key to its id')
      assert.equal(canonicalHash(compileSource(source, catalog)), source.canonicalHash)
      baseline = source
    }
  )

  await check('its canonical hash equals canonicalize of the stored state', async () => {
    assert(baseline, 'baseline source must be read first')
    const [state, catalog] = await Promise.all([readStoredState(), readCatalog()])
    const canonical = canonicalize(state, {
      catalog,
      meta: { name: 'Workflow source fixture', description: null },
    })
    assert.equal(canonicalHash(canonical.workflow), baseline.canonicalHash)
  })

  await check('inline function code keeps the canonical hash', async () => {
    assert(baseline, 'baseline source must be read first')
    const source = await readSource('?functionCode=inline')
    assert.deepEqual(Object.keys(source.files), ['workflow.ts'])
    assert.equal(source.canonicalHash, baseline.canonicalHash)
    assert.equal(source.base.fingerprint, baseline.base.fingerprint)
    assert.equal(canonicalHash(compileSource(source, await readCatalog())), source.canonicalHash)
  })

  await check('a position-only edit leaves the fingerprint unchanged', async () => {
    assert(baseline, 'baseline source must be read first')
    const moved =
      await sql`update workflow_blocks set position_x = position_x + 240, position_y = position_y + 80
        where workflow_id = ${workflowId} returning id`
    assert(moved.length >= 2, 'Both blocks moved')
    const source = await readSource()
    assert.equal(source.base.fingerprint, baseline.base.fingerprint)
    assert.equal(source.canonicalHash, baseline.canonicalHash)
  })

  await check('a canvas-equivalent edit changes the fingerprint', async () => {
    assert(baseline, 'baseline source must be read first')
    await applyOperations([
      {
        operation_type: 'edit',
        block_id: scoreBlockId,
        params: { inputs: { code: 'return { score: 2 }' } },
      },
    ])
    const source = await readSource()
    assert.notEqual(source.base.fingerprint, baseline.base.fingerprint)
    assert.notEqual(source.canonicalHash, baseline.canonicalHash)
    assert.equal(canonicalHash(compileSource(source, await readCatalog())), source.canonicalHash)
  })

  await check('the canvas route returns the same source under a session', async () => {
    const internal = getWorkflowSourceContract.response.schema.parse(
      await call('GET', `/api/workflows/${workflowId}/source`, { session: cookie }, 200)
    ).data
    const external = await readSource()
    assert.deepEqual(internal.files, external.files)
    assert.equal(internal.base.fingerprint, external.base.fingerprint)
  })

  await check('a key for another workspace is answered 404, and no key 401', async () => {
    const foreign = await call('GET', sourcePath(), { key: foreignKey }, 404)
    assert(isRecordLike(foreign) && isRecordLike(foreign.error))
    assert.equal(foreign.error.code, 'NOT_FOUND')
    const anonymous = await call('GET', sourcePath(), {}, 401)
    assert(isRecordLike(anonymous) && isRecordLike(anonymous.error))
    assert.equal(anonymous.error.code, 'UNAUTHORIZED')
  })

  await check('an invalid functionCode is a 400', async () => {
    const invalid = await call('GET', sourcePath('?functionCode=ts'), { key: workspaceKey }, 400)
    assert(isRecordLike(invalid) && isRecordLike(invalid.error))
    assert.equal(invalid.error.code, 'BAD_REQUEST')
  })
} catch (error) {
  logger.error(failureMessage(error))
  process.exitCode = 1
} finally {
  try {
    await check('remove disposable fixtures', async () => {
      await sql.begin(async (tx) => {
        await tx`delete from workspace where id in (${workspaceId}, ${foreignWorkspaceId})`
        await tx`delete from project where id in (${workspaceId}, ${foreignWorkspaceId})`
      })
      await sql`delete from "user" where id = ${ownerId}`
    })
  } catch (error) {
    logger.error(failureMessage(error))
    process.exitCode = 1
  } finally {
    await sql.end()
    await writeFile(
      reportPath,
      `${JSON.stringify(
        {
          startedAt,
          finishedAt: new Date().toISOString(),
          status: process.exitCode ? 'failed' : 'passed',
          checks,
          requests,
        },
        null,
        2
      )}\n`
    )
  }
}
