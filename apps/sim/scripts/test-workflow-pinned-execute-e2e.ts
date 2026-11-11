import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import postgres from 'postgres'
import {
  type V2ExecuteWorkflowBody,
  type V2ResumeWorkflowBody,
  v2ExecuteWorkflowDataSchema,
  v2ResumeWorkflowDataSchema,
  v2WorkflowRunStatusSchema,
} from '@/lib/api/contracts/v2/workflows'
import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'

/**
 * Exercises `run: { source: 'deployment', version }` on the v2 execute route
 * against a running local Next app and a disposable database.
 *
 * Every fixture workflow is deployed twice: version 1 and the active version 2
 * differ only in which block runs, so a run's block outputs and its recorded
 * `deployment_version_id` show which graph executed. Before the executor honored
 * the pin, a pinned run loaded version 1 for its variables and still executed
 * version 2 — the pinned checks fail on that code.
 *
 * Run against a dev stack with `bun run test:workflow-pinned-execute:e2e`, setting
 * `PINNED_EXECUTE_E2E_BASE_URL` (the loopback app origin), `PINNED_EXECUTE_E2E_DATABASE_URL`
 * (the disposable database that app uses), and `PINNED_EXECUTE_E2E_REPORT_PATH`.
 */
const logger = createLogger('WorkflowPinnedExecuteE2E')
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
/** The first request to each route cold-compiles it under `next dev`. */
const ROUTE_COMPILE_TIMEOUT_MS = 300_000
const REQUEST_TIMEOUT_MS = 60_000
const POLL_ATTEMPTS = 300
const POLL_INTERVAL_MS = 200
const startedAt = new Date().toISOString()

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

const baseUrl = new URL(requiredEnvironment('PINNED_EXECUTE_E2E_BASE_URL'))
const databaseUrl = assertDisposableTestDatabaseUrl(
  requiredEnvironment('PINNED_EXECUTE_E2E_DATABASE_URL')
)
const reportPath = requiredEnvironment('PINNED_EXECUTE_E2E_REPORT_PATH')
assert(new Set(['localhost', '127.0.0.1', '[::1]']).has(baseUrl.hostname), 'Use a loopback app')
assert.equal(baseUrl.protocol, 'http:', 'Use a local HTTP app')
assert(!baseUrl.username && !baseUrl.password, 'App URL cannot contain credentials')
assert.equal(baseUrl.pathname, '/', 'App URL must be an origin')
assert(!baseUrl.search && !baseUrl.hash, 'App URL cannot contain a query or fragment')

const sql = postgres(databaseUrl.toString(), { max: 2 })
const ownerId = generateId()
const readerId = generateId()
const workspaceId = generateId()
const ownerKey = `sk-sim-fixture-${generateId()}`
const readerKey = `sk-sim-fixture-${generateId()}`
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
/** `status` is null when the request ended without a complete response. */
const requests: { method: string; path: string; status: number | null; durationMs: number }[] = []

interface VersionedFixture {
  workflowId: string
  start: string
  /** Block only version 1 contains, keyed by the name selectors use. */
  one: { id: string; name: string }
  /** Block only version 2 (the active one) contains. */
  two: { id: string; name: string }
  /** Human pause both versions place before their own block, when present. */
  approval?: string
  versionIds: [string, string]
}

function versionedFixture(withApproval: boolean): VersionedFixture {
  return {
    workflowId: generateId(),
    start: generateId(),
    one: { id: generateId(), name: 'VersionOne' },
    two: { id: generateId(), name: 'VersionTwo' },
    ...(withApproval ? { approval: generateId() } : {}),
    versionIds: [generateId(), generateId()],
  }
}

const plain = versionedFixture(false)
const paused = versionedFixture(true)
const publicFixture = versionedFixture(false)

function failureMessage(error: unknown): string {
  let message = getErrorMessage(error)
  for (const secret of [ownerKey, readerKey]) message = message.replaceAll(secret, '[redacted]')
  return truncate(message, 2000)
}

async function check(name: string, run: () => Promise<void>) {
  const started = performance.now()
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) })
    logger.info('Check passed', { name })
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

function record(value: unknown): Record<string, unknown> {
  assert(isRecordLike(value), 'Expected a JSON object')
  return value
}

function block(id: string, type: string, name: string, index: number, subBlocks = {}) {
  return {
    id,
    type,
    name,
    enabled: true,
    position: { x: index * 300, y: 0 },
    outputs: {},
    subBlocks,
  }
}

const waitSubBlocks = {
  timeValue: { id: 'timeValue', type: 'short-input', value: '0.1' },
  timeUnit: { id: 'timeUnit', type: 'dropdown', value: 'seconds' },
  async: { id: 'async', type: 'switch', value: false },
}

/** The approval asks for one required field, which the run detail lists for the pause. */
const approvalSubBlocks = {
  inputFormat: {
    id: 'inputFormat',
    type: 'input-format',
    value: [{ id: 'approved', name: 'approved', type: 'boolean', required: true }],
  },
}

/** The deployed graph of one version: Start → [Approval →] the version's own block. */
function deployedState(fixture: VersionedFixture, version: 1 | 2) {
  const own = version === 1 ? fixture.one : fixture.two
  const chain = [
    block(fixture.start, 'start_trigger', 'Start', 0, {
      inputFormat: { id: 'inputFormat', type: 'input-format', value: [] },
    }),
    ...(fixture.approval
      ? [block(fixture.approval, 'human_in_the_loop', 'Approval', 1, approvalSubBlocks)]
      : []),
    block(own.id, 'wait', own.name, 2, waitSubBlocks),
  ]
  return {
    blocks: Object.fromEntries(chain.map((entry) => [entry.id, entry])),
    edges: chain.slice(1).map((target, index) => ({
      id: generateId(),
      source: chain[index].id,
      target: target.id,
      sourceHandle: 'source',
      targetHandle: 'target',
    })),
    loops: {},
    parallels: {},
    variables: {},
    lastSaved: 0,
  }
}

async function seedFixture(
  tx: postgres.TransactionSql,
  fixture: VersionedFixture,
  isPublicApi: boolean
) {
  await tx`insert into workflow (id, user_id, workspace_id, name, last_synced, created_at, updated_at, is_deployed, deployed_at, is_public_api)
    values (${fixture.workflowId}, ${ownerId}, ${workspaceId}, ${`Pinned execute fixture ${fixture.workflowId}`}, now(), now(), now(), true, now(), ${isPublicApi})`
  for (const version of [1, 2] as const) {
    await tx`insert into workflow_deployment_version (id, workflow_id, version, state, is_active, created_by)
      values (${fixture.versionIds[version - 1]}, ${fixture.workflowId}, ${version}, ${JSON.stringify(deployedState(fixture, version))}::text::json, ${version === 2}, ${ownerId})`
  }
}

async function seed() {
  await sql.begin(async (tx) => {
    for (const [id, label] of [
      [ownerId, 'owner'],
      [readerId, 'reader'],
    ]) {
      const email = `${id}@pinned-execute.test`
      await tx`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
        values (${id}, ${`Pinned execute ${label}`}, ${email}, ${email}, true, now(), now())`
      await tx`insert into user_stats (id, user_id) values (${generateId()}, ${id})`
    }
    await tx`insert into project (id, name, owner_id)
      values (${workspaceId}, 'Pinned execute project', ${ownerId})`
    await tx`insert into workspace (id, project_id, name, owner_id, billed_account_user_id)
      values (${workspaceId}, ${workspaceId}, 'Pinned execute fixture', ${ownerId}, ${ownerId})`
    for (const [id, role] of [
      [ownerId, 'admin'],
      [readerId, 'read'],
    ]) {
      await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type)
        values (${generateId()}, ${id}, 'workspace', ${workspaceId}, ${role})`
    }
    for (const [id, key] of [
      [ownerId, ownerKey],
      [readerId, readerKey],
    ]) {
      await tx`insert into api_key (id, user_id, name, key, key_hash, type)
        values (${generateId()}, ${id}, 'Pinned execute fixture', ${key}, ${sha256Hex(key)}, 'personal')`
    }
    await seedFixture(tx, plain, false)
    await seedFixture(tx, paused, false)
    await seedFixture(tx, publicFixture, true)
  })
}

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError'
}

async function request(
  method: 'GET' | 'POST',
  path: string,
  {
    body,
    key = ownerKey,
    expectedStatus = 200,
    timeoutMs = REQUEST_TIMEOUT_MS,
  }: {
    body?: V2ExecuteWorkflowBody | V2ResumeWorkflowBody | Record<string, unknown>
    key?: string | null
    expectedStatus?: number
    timeoutMs?: number
  } = {}
): Promise<Record<string, unknown>> {
  const url = new URL(path, baseUrl)
  const started = performance.now()
  const elapsed = () => Math.round(performance.now() - started)
  let status: number | null = null
  let text: string
  try {
    // boundary-raw-fetch: protocol E2E exercises a separately running local app over real HTTP
    const response = await fetch(url, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: 'application/json',
        'x-forwarded-for': '127.0.0.1',
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(key ? { 'x-api-key': key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    text = await readResponseTextWithLimit(response, {
      maxBytes: MAX_RESPONSE_BYTES,
      label: 'Pinned execute E2E response',
    })
    status = response.status
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
  } catch (error) {
    const reason = isTimeout(error)
      ? `no complete response within ${timeoutMs / 1000}s`
      : getErrorMessage(error)
    throw new Error(`${method} ${url.pathname} failed after ${elapsed()} ms: ${reason}`)
  } finally {
    requests.push({ method, path: url.pathname, status, durationMs: elapsed() })
  }
  assert.equal(status, expectedStatus, `${method} ${url.pathname}: ${truncate(text, 500)}`)
  return record(JSON.parse(text))
}

function execute(fixture: VersionedFixture, body: Record<string, unknown>, options = {}) {
  return request('POST', `/api/v2/workflows/${fixture.workflowId}/execute`, {
    body,
    ...options,
  })
}

async function expectError(
  fixture: VersionedFixture,
  body: Record<string, unknown>,
  expectedStatus: number,
  code: string,
  key: string | null = ownerKey
) {
  const error = record((await execute(fixture, body, { expectedStatus, key })).error)
  assert.equal(error.code, code, JSON.stringify(error))
}

/**
 * Selectors resolve against the graph the request loads, so each run selects only
 * the block of the version it should execute: an unknown name is a 400 before the
 * run. A run that loaded one version and executed the other answers without it.
 */
const selectOwn = (own: { name: string }) => [`${own.name}.status`]

/** The version id the durable log recorded for a run. */
async function loggedVersionId(runId: string): Promise<string | null> {
  const [row] =
    await sql`select deployment_version_id from workflow_execution_logs where execution_id = ${runId}`
  assert(row, `Run ${runId} has no execution log`)
  return row.deployment_version_id
}

async function runStatus(fixture: VersionedFixture, runId: string, query = '') {
  return v2WorkflowRunStatusSchema.parse(
    (
      await request('GET', `/api/v2/workflows/${fixture.workflowId}/runs/${runId}${query}`, {
        timeoutMs: ROUTE_COMPILE_TIMEOUT_MS,
      })
    ).data
  )
}

async function waitForSettled(fixture: VersionedFixture, runId: string) {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    const status = await runStatus(fixture, runId)
    if (status.status !== 'queued' && status.status !== 'running') return status
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error(`Run ${runId} did not settle`)
}

try {
  await check('seed disposable workspace, deployed versions and credentials', seed)

  await check('the execute route compiles and runs the active version by default', async () => {
    const data = v2ExecuteWorkflowDataSchema.parse(
      (
        await execute(
          plain,
          { selectedOutputs: selectOwn(plain.two) },
          { timeoutMs: ROUTE_COMPILE_TIMEOUT_MS }
        )
      ).data
    )
    assert.equal(data.status, 'completed', JSON.stringify(data.error))
    assert.deepEqual(Object.keys(data.blockOutputs ?? {}), [`${plain.two.name}.status`])
    assert.equal(await loggedVersionId(data.runId), plain.versionIds[1])
  })

  await check('a synchronous run pinned to version 1 executes version 1', async () => {
    const data = v2ExecuteWorkflowDataSchema.parse(
      (
        await execute(plain, {
          run: { source: 'deployment', version: 1 },
          selectedOutputs: selectOwn(plain.one),
        })
      ).data
    )
    assert.equal(data.status, 'completed', JSON.stringify(data.error))
    assert.deepEqual(Object.keys(data.blockOutputs ?? {}), [`${plain.one.name}.status`])
    assert.equal(await loggedVersionId(data.runId), plain.versionIds[0])
    const status = await runStatus(plain, data.runId)
    assert.equal(status.version, 1)
  })

  await check('an asynchronous run pinned to version 1 executes version 1', async () => {
    const receipt = record(
      (
        await execute(
          plain,
          { async: true, run: { source: 'deployment', version: 1 } },
          { expectedStatus: 202 }
        )
      ).data
    )
    assert.equal(typeof receipt.runId, 'string')
    const runId = String(receipt.runId)
    const settled = await waitForSettled(plain, runId)
    assert.equal(settled.status, 'completed', JSON.stringify(settled.error))
    assert.equal(settled.version, 1)
    assert.equal(await loggedVersionId(runId), plain.versionIds[0])
    const withOutputs = await runStatus(
      plain,
      runId,
      `?selectedOutputs=${plain.one.id}.status,${plain.two.id}.status`
    )
    assert.deepEqual(Object.keys(withOutputs.blockOutputs ?? {}), [`${plain.one.id}.status`])
  })

  await check('an unknown version answers 404 and starts no run', async () => {
    const before =
      await sql`select count(*)::int as n from workflow_execution_logs where workflow_id = ${plain.workflowId}`
    await expectError(plain, { run: { source: 'deployment', version: 99 } }, 404, 'NOT_FOUND')
    const after =
      await sql`select count(*)::int as n from workflow_execution_logs where workflow_id = ${plain.workflowId}`
    assert.equal(after[0].n, before[0].n)
  })

  await check('a malformed version answers 400', async () => {
    for (const version of [0, -1, 1.5, '1', null]) {
      await expectError(plain, { run: { source: 'deployment', version } }, 400, 'BAD_REQUEST')
    }
    await expectError(
      plain,
      { run: { source: 'deployment', version: 1, extra: true } },
      400,
      'BAD_REQUEST'
    )
  })

  await check('a read-role member may run the active version but not pin one', async () => {
    const data = v2ExecuteWorkflowDataSchema.parse(
      (await execute(plain, {}, { key: readerKey })).data
    )
    assert.equal(data.status, 'completed')
    const error = record(
      (
        await execute(
          plain,
          { run: { source: 'deployment', version: 1 } },
          { key: readerKey, expectedStatus: 403 }
        )
      ).error
    )
    assert.equal(error.code, 'FORBIDDEN')
    assert.equal(record(error.details).code, 'INSUFFICIENT_WORKSPACE_ROLE')
  })

  await check('an anonymous public-API caller cannot pin a version', async () => {
    const data = v2ExecuteWorkflowDataSchema.parse(
      (await execute(publicFixture, {}, { key: null })).data
    )
    assert.equal(data.status, 'completed')
    await expectError(
      publicFixture,
      { run: { source: 'deployment', version: 1 } },
      400,
      'BAD_REQUEST',
      null
    )
  })

  await check(
    'a pinned run that pauses lists its pause point and resumes on the pinned version',
    async () => {
      const data = v2ExecuteWorkflowDataSchema.parse(
        (await execute(paused, { run: { source: 'deployment', version: 1 } })).data
      )
      assert.equal(data.status, 'paused', JSON.stringify(data.error))
      assert.equal(await loggedVersionId(data.runId), paused.versionIds[0])
      const pausedStatus = await runStatus(paused, data.runId)
      assert.equal(pausedStatus.version, 1)
      const contextId = pausedStatus.paused?.contextId
      assert(contextId, 'The paused run must expose a resumable context')
      const points = pausedStatus.paused?.points ?? []
      assert.equal(points.length, 1)
      assert.deepEqual(
        {
          contextId: points[0].contextId,
          blockId: points[0].blockId,
          blockName: points[0].blockName,
          kind: points[0].kind,
          status: points[0].status,
          parallel: points[0].parallel,
          loop: points[0].loop,
        },
        {
          contextId,
          blockId: paused.approval,
          blockName: 'Approval',
          kind: 'human',
          status: 'paused',
          parallel: null,
          loop: null,
        }
      )
      assert.deepEqual(points[0].inputFields, [
        { name: 'approved', label: 'approved', type: 'boolean', required: true },
      ])
      const resumed = v2ResumeWorkflowDataSchema.parse(
        (
          await request(
            'POST',
            `/api/v2/workflows/${paused.workflowId}/runs/${data.runId}/resume`,
            {
              body: { contextId, input: { approved: true } },
              timeoutMs: ROUTE_COMPILE_TIMEOUT_MS,
            }
          )
        ).data
      )
      assert.equal(resumed.status, 'completed', JSON.stringify(resumed.error))
      const settled = await runStatus(
        paused,
        data.runId,
        `?selectedOutputs=${paused.one.id}.status,${paused.two.id}.status`
      )
      assert.equal(settled.status, 'completed')
      assert.equal(settled.version, 1)
      assert.deepEqual(Object.keys(settled.blockOutputs ?? {}), [`${paused.one.id}.status`])
    }
  )
} catch (error) {
  logger.error('Pinned execute E2E failed', { error: failureMessage(error) })
  process.exitCode = 1
} finally {
  try {
    await check('remove disposable fixtures', async () => {
      await sql.begin(async (tx) => {
        await tx`delete from workspace where id = ${workspaceId}`
        await tx`delete from project where id = ${workspaceId}`
      })
      await sql`delete from "user" where id in (${ownerId}, ${readerId})`
    })
  } catch (error) {
    logger.error('Pinned execute E2E cleanup failed', { error: failureMessage(error) })
    process.exitCode = 1
  } finally {
    await sql.end()
    await writeFile(
      reportPath,
      `${JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), status: process.exitCode ? 'failed' : 'passed', checks, requests }, null, 2)}\n`
    )
  }
}
