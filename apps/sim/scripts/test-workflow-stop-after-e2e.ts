import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
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
  type V2ExecuteWorkflowData,
  type V2ResumeWorkflowBody,
  v2ExecuteWorkflowDataSchema,
  v2WorkflowRunStatusSchema,
} from '@/lib/api/contracts/v2/workflows'
import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'

/**
 * Exercises `run.stopAfterBlockId` against a running local Next app, through the
 * v2 execute route and the published CLI, on a disposable database.
 *
 * The fixture is `Start → Slow (wait) → Check (wait) → After (wait)`. Slow stands
 * in for an expensive upstream block, so a single-block re-run of Check that
 * finishes well under Slow's delay proves Slow was not re-executed, and an
 * absent After output proves the run stopped where it was told to.
 *
 * A second fixture branches: `Start → Gate (condition, always if)`, with `if →
 * Taken → Tail (slow wait)` and `else → Skipped`. A stop on Skipped must fail the
 * run once Gate routes away from it, well before Tail's delay would elapse.
 */
const logger = createLogger('WorkflowStopAfterE2E')
const execFileAsync = promisify(execFile)
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
/** The first execute request cold-compiles the route's module graph under `next dev`. */
const ROUTE_COMPILE_TIMEOUT_MS = 300_000
/** Every later request hits the compiled route; the slowest fixture run waits about `SLOW_MS`. */
const REQUEST_TIMEOUT_MS = 60_000
const SLOW_SECONDS = 4
const SLOW_MS = SLOW_SECONDS * 1000
const startedAt = new Date().toISOString()

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

const baseUrl = new URL(requiredEnvironment('STOP_AFTER_E2E_BASE_URL'))
const databaseUrl = assertDisposableTestDatabaseUrl(
  requiredEnvironment('STOP_AFTER_E2E_DATABASE_URL')
)
const reportPath = requiredEnvironment('STOP_AFTER_E2E_REPORT_PATH')
assert(new Set(['localhost', '127.0.0.1', '[::1]']).has(baseUrl.hostname), 'Use a loopback app')
assert.equal(baseUrl.protocol, 'http:', 'Use a local HTTP app')
assert(!baseUrl.username && !baseUrl.password, 'App URL cannot contain credentials')
assert.equal(baseUrl.pathname, '/', 'App URL must be an origin')
assert(!baseUrl.search && !baseUrl.hash, 'App URL cannot contain a query or fragment')

const sql = postgres(databaseUrl.toString(), { max: 2 })
const ownerId = generateId()
const workspaceId = generateId()
const personalKey = `sk-sim-fixture-${generateId()}`
const cliPath = fileURLToPath(new URL('../../../packages/sim-cli/src/index.ts', import.meta.url))
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
/** `status` is null when the request ended without a complete response. */
const requests: { method: string; path: string; status: number | null; durationMs: number }[] = []
let directory: string | undefined

interface PipelineFixture {
  workflowId: string
  start: string
  slow: string
  check: string
  after: string
}

const pipeline = fixtureIds()
const otherPipeline = fixtureIds()
const pausePipelines = ['human_in_the_loop', 'human_in_the_loop_v2', 'wait'].map((type) => ({
  ...fixtureIds(),
  type,
}))
const forkedPause = fixtureIds()
const siblingPauses = fixtureIds()
const containerPauses = ['loop', 'parallel'].map((type) => ({
  ...fixtureIds(),
  type,
  inner: generateId(),
}))
const branch = {
  workflowId: generateId(),
  start: generateId(),
  gate: generateId(),
  taken: generateId(),
  tail: generateId(),
  skipped: generateId(),
}

function fixtureIds(): PipelineFixture {
  return {
    workflowId: generateId(),
    start: generateId(),
    slow: generateId(),
    check: generateId(),
    after: generateId(),
  }
}

function failureMessage(error: unknown): string {
  return truncate(getErrorMessage(error).replaceAll(personalKey, '[redacted]'), 2000)
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

function record(value: unknown): Record<string, unknown> {
  assert(isRecordLike(value), 'Expected a JSON object')
  return value
}

async function seedPipeline(tx: postgres.TransactionSql, fixture: PipelineFixture) {
  await tx`insert into workflow (id, user_id, workspace_id, name, last_synced, created_at, updated_at)
    values (${fixture.workflowId}, ${ownerId}, ${workspaceId}, ${`Stop-after fixture ${fixture.workflowId}`}, now(), now(), now())`
  const blocks = [
    {
      id: fixture.start,
      type: 'start_trigger',
      name: 'Start',
      subBlocks: { inputFormat: { id: 'inputFormat', type: 'input-format', value: [] } },
    },
    { id: fixture.slow, type: 'wait', name: 'Slow', subBlocks: waitSubBlocks(SLOW_SECONDS) },
    { id: fixture.check, type: 'wait', name: 'Check', subBlocks: waitSubBlocks(0.2) },
    { id: fixture.after, type: 'wait', name: 'After', subBlocks: waitSubBlocks(0.2) },
  ]
  for (const [index, block] of blocks.entries()) {
    await tx`insert into workflow_blocks (id, workflow_id, type, name, position_x, position_y, sub_blocks)
      values (${block.id}, ${fixture.workflowId}, ${block.type}, ${block.name}, ${index * 300}, 0, ${JSON.stringify(block.subBlocks)}::text::jsonb)`
  }
  for (const [source, target] of [
    [fixture.start, fixture.slow],
    [fixture.slow, fixture.check],
    [fixture.check, fixture.after],
  ]) {
    await tx`insert into workflow_edges (id, workflow_id, source_block_id, target_block_id, source_handle, target_handle)
      values (${generateId()}, ${fixture.workflowId}, ${source}, ${target}, 'source', 'target')`
  }
}

function waitSubBlocks(seconds: number) {
  return {
    timeValue: { id: 'timeValue', type: 'short-input', value: String(seconds) },
    timeUnit: { id: 'timeUnit', type: 'dropdown', value: 'seconds' },
    async: { id: 'async', type: 'switch', value: false },
  }
}

async function seedBranch(tx: postgres.TransactionSql) {
  await tx`insert into workflow (id, user_id, workspace_id, name, last_synced, created_at, updated_at)
    values (${branch.workflowId}, ${ownerId}, ${workspaceId}, ${`Stop-after branch fixture ${branch.workflowId}`}, now(), now(), now())`
  const conditions = [
    { id: `${branch.gate}-if`, title: 'if', value: 'true' },
    { id: `${branch.gate}-else`, title: 'else', value: '' },
  ]
  const blocks = [
    {
      id: branch.start,
      type: 'start_trigger',
      name: 'Start',
      subBlocks: { inputFormat: { id: 'inputFormat', type: 'input-format', value: [] } },
    },
    {
      id: branch.gate,
      type: 'condition',
      name: 'Gate',
      subBlocks: {
        conditions: {
          id: 'conditions',
          type: 'condition-input',
          value: JSON.stringify(conditions),
        },
      },
    },
    { id: branch.taken, type: 'wait', name: 'Taken', subBlocks: waitSubBlocks(0.2) },
    { id: branch.tail, type: 'wait', name: 'Tail', subBlocks: waitSubBlocks(SLOW_SECONDS) },
    { id: branch.skipped, type: 'wait', name: 'Skipped', subBlocks: waitSubBlocks(0.2) },
  ]
  for (const [index, block] of blocks.entries()) {
    await tx`insert into workflow_blocks (id, workflow_id, type, name, position_x, position_y, sub_blocks)
      values (${block.id}, ${branch.workflowId}, ${block.type}, ${block.name}, ${index * 300}, 0, ${JSON.stringify(block.subBlocks)}::text::jsonb)`
  }
  for (const [source, target, sourceHandle] of [
    [branch.start, branch.gate, 'source'],
    [branch.gate, branch.taken, `condition-${branch.gate}-if`],
    [branch.gate, branch.skipped, `condition-${branch.gate}-else`],
    [branch.taken, branch.tail, 'source'],
  ]) {
    await tx`insert into workflow_edges (id, workflow_id, source_block_id, target_block_id, source_handle, target_handle)
      values (${generateId()}, ${branch.workflowId}, ${source}, ${target}, ${sourceHandle}, 'target')`
  }
}

async function seed() {
  directory = await mkdtemp(resolve(tmpdir(), 'sim-stop-after-'))
  await sql.begin(async (tx) => {
    const email = `${ownerId}@stop-after.test`
    await tx`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
      values (${ownerId}, 'Stop-after fixture', ${email}, ${email}, true, now(), now())`
    await tx`insert into user_stats (id, user_id) values (${generateId()}, ${ownerId})`
    await tx`insert into project (id, name, owner_id)
      values (${workspaceId}, 'Stop-after project', ${ownerId})`
    await tx`insert into workspace (id, project_id, name, owner_id, billed_account_user_id)
      values (${workspaceId}, ${workspaceId}, 'Stop-after fixture', ${ownerId}, ${ownerId})`
    await tx`insert into project_workspace (project_id, workspace_id)
      values (${workspaceId}, ${workspaceId})`
    await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type)
      values (${generateId()}, ${ownerId}, 'workspace', ${workspaceId}, 'admin')`
    await tx`insert into api_key (id, user_id, name, key, key_hash, type)
      values (${generateId()}, ${ownerId}, 'Stop-after fixture', ${personalKey}, ${sha256Hex(personalKey)}, 'personal')`
    await seedPipeline(tx, pipeline)
    await seedPipeline(tx, otherPipeline)
    await seedBranch(tx)
    for (const fixture of [
      ...pausePipelines,
      { ...forkedPause, type: 'human_in_the_loop' },
      { ...siblingPauses, type: 'human_in_the_loop' },
      ...containerPauses.map((fixture) => ({ ...fixture, type: 'human_in_the_loop' })),
    ]) {
      await seedPipeline(tx, fixture)
      const subBlocks =
        fixture.type === 'wait'
          ? {
              async: { id: 'async', type: 'switch', value: true },
              timeValue: { id: 'timeValue', type: 'short-input', value: '0.001' },
              timeUnitLong: { id: 'timeUnitLong', type: 'dropdown', value: 'minutes' },
            }
          : {}
      await tx`update workflow_blocks set type = ${fixture.type}, sub_blocks = ${JSON.stringify(subBlocks)}::text::jsonb where id = ${fixture.slow}`
    }
    for (const fixture of [forkedPause, siblingPauses]) {
      await tx`update workflow_edges set source_block_id = ${fixture.start} where workflow_id = ${fixture.workflowId} and target_block_id = ${fixture.check}`
    }
    await tx`update workflow_blocks set type = 'human_in_the_loop', sub_blocks = '{}'::jsonb where id = ${siblingPauses.check}`
    await tx`update workflow_edges set source_block_id = ${siblingPauses.slow} where workflow_id = ${siblingPauses.workflowId} and target_block_id = ${siblingPauses.after}`
    await tx`update workflow_blocks set sub_blocks = ${JSON.stringify(waitSubBlocks(SLOW_SECONDS))}::text::jsonb where id = ${siblingPauses.after}`
    for (const fixture of containerPauses) {
      const config = {
        id: fixture.check,
        nodes: [fixture.inner],
        iterations: 2,
        loopType: 'for',
        count: 2,
        parallelType: 'count',
      }
      await tx`update workflow_blocks set type = ${fixture.type}, sub_blocks = '{}'::jsonb, data = ${JSON.stringify(config)}::text::jsonb where id = ${fixture.check}`
      await tx`insert into workflow_subflows (id, workflow_id, type, config) values (${fixture.check}, ${fixture.workflowId}, ${fixture.type}, ${JSON.stringify(config)}::text::jsonb)`
      await tx`insert into workflow_blocks (id, workflow_id, type, name, position_x, position_y, sub_blocks, data)
        values (${fixture.inner}, ${fixture.workflowId}, 'human_in_the_loop_v2', 'Inner', 0, 0, '{}'::jsonb, ${JSON.stringify({ parentId: fixture.check })}::text::jsonb)`
      await tx`insert into workflow_edges (id, workflow_id, source_block_id, target_block_id, source_handle, target_handle)
        values (${generateId()}, ${fixture.workflowId}, ${fixture.check}, ${fixture.inner}, ${`${fixture.type}-start-source`}, 'target')`
      await tx`update workflow_edges set source_handle = ${`${fixture.type}-end-source`} where workflow_id = ${fixture.workflowId} and target_block_id = ${fixture.after}`
    }
  })
}

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError'
}

async function execute(
  workflowId: string,
  body: V2ExecuteWorkflowBody | V2ResumeWorkflowBody,
  { expectedStatus = 200, timeoutMs = REQUEST_TIMEOUT_MS, runId = '' } = {}
): Promise<Record<string, unknown>> {
  const url = new URL(
    `/api/v2/workflows/${workflowId}/${runId ? `runs/${runId}/resume` : 'execute'}`,
    baseUrl
  )
  const started = performance.now()
  const elapsed = () => Math.round(performance.now() - started)
  let status: number | null = null
  let text: string
  try {
    // boundary-raw-fetch: protocol E2E exercises a separately running local app over real HTTP
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-api-key': personalKey,
        'x-forwarded-for': '127.0.0.1',
      },
      body: JSON.stringify(body),
    })
    text = await readResponseTextWithLimit(response, {
      maxBytes: MAX_RESPONSE_BYTES,
      label: 'Stop-after E2E response',
    })
    status = response.status
  } catch (error) {
    const reason = isTimeout(error)
      ? `no complete response within ${timeoutMs / 1000}s`
      : getErrorMessage(error)
    throw new Error(`POST ${url.pathname} failed after ${elapsed()} ms: ${reason}`)
  } finally {
    requests.push({ method: 'POST', path: url.pathname, status, durationMs: elapsed() })
  }
  assert.equal(status, expectedStatus, `${url.pathname}: ${truncate(text, 500)}`)
  return record(JSON.parse(text))
}

async function run(
  workflowId: string,
  body: V2ExecuteWorkflowBody
): Promise<V2ExecuteWorkflowData> {
  const data = v2ExecuteWorkflowDataSchema.parse(record(await execute(workflowId, body)).data)
  assert.equal(data.status, 'completed', `run ${data.runId} did not complete`)
  return data
}

async function pause(fixture: PipelineFixture, stopAfterBlockId?: string) {
  const result = v2ExecuteWorkflowDataSchema.parse(
    record(
      await execute(fixture.workflowId, {
        run: { source: 'manual', ...(stopAfterBlockId ? { stopAfterBlockId } : {}) },
        selectedOutputs: selectAll,
      })
    ).data
  )
  assert.equal(result.status, 'paused')
  const [saved] =
    await sql`select pause_points from paused_executions where execution_id = ${result.runId}`
  const points = record(saved?.pause_points)
  const contextId = Object.keys(points).find((id) => record(points[id]).blockId === fixture.slow)
  assert(contextId, 'The pause must be durably resumable')
  return { runId: result.runId, contextId }
}

async function get(path: string, authorization?: string): Promise<Record<string, unknown>> {
  const started = performance.now()
  // boundary-raw-fetch: protocol E2E exercises resume polling against the local app
  const response = await fetch(new URL(path, baseUrl), {
    redirect: 'error',
    signal: AbortSignal.timeout(ROUTE_COMPILE_TIMEOUT_MS),
    headers: { 'x-api-key': personalKey, ...(authorization ? { authorization } : {}) },
  })
  requests.push({
    method: 'GET',
    path,
    status: response.status,
    durationMs: Math.round(performance.now() - started),
  })
  const text = await readResponseTextWithLimit(response, {
    maxBytes: MAX_RESPONSE_BYTES,
    label: 'Stop-after poll response',
  })
  assert.equal(response.status, 200, truncate(text, 500))
  return record(JSON.parse(text))
}

async function resume(
  fixture: PipelineFixture & { type?: string },
  paused: { runId: string; contextId: string }
) {
  const query = new URLSearchParams({
    includeOutput: 'true',
    selectedOutputs: [fixture.slow, fixture.check, fixture.after]
      .map((id) => `${id}.status`)
      .join(','),
  })
  const statusPath = `/api/v2/workflows/${fixture.workflowId}/runs/${paused.runId}?${query}`
  if (fixture.type === 'wait') {
    await sleep(100)
    const poll = await get(
      '/api/resume/poll',
      `Bearer ${requiredEnvironment('STOP_AFTER_E2E_CRON_SECRET')}`
    )
    assert.deepEqual(poll.failures, [])
    assert.equal(poll.dispatched, 1)
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = v2WorkflowRunStatusSchema.parse((await get(statusPath)).data)
      if (result.status === 'completed') return result
      assert.notEqual(result.status, 'failed', JSON.stringify(result.error))
      await sleep(100)
    }
    throw new Error('Timed wait did not finish after automatic resume')
  }
  const result = v2ExecuteWorkflowDataSchema.parse(
    record(
      await execute(
        fixture.workflowId,
        {
          contextId: paused.contextId,
          input: { approved: true },
        },
        { runId: paused.runId, timeoutMs: ROUTE_COMPILE_TIMEOUT_MS }
      )
    ).data
  )
  assert.equal(result.status, 'completed', JSON.stringify(result.error))
  return v2WorkflowRunStatusSchema.parse((await get(statusPath)).data)
}

async function expectBadRequest(
  workflowId: string,
  body: V2ExecuteWorkflowBody,
  code: string,
  timeoutMs = REQUEST_TIMEOUT_MS
) {
  const expectedStatus = code === 'NOT_FOUND' ? 404 : 400
  const error = record((await execute(workflowId, body, { expectedStatus, timeoutMs })).error)
  assert.equal(error.code, code)
}

/** Runs the CLI; a run it must fail exits non-zero and still prints the run on stdout. */
async function execCli(
  args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  assert(directory, 'CLI fixture directory must exist')
  try {
    const { stdout, stderr } = await execFileAsync(
      'bun',
      [
        '--no-env-file',
        cliPath,
        '--endpoint',
        baseUrl.origin,
        '--workspace',
        workspaceId,
        '--output',
        'json',
        'workflows',
        'run',
        ...args,
      ],
      {
        cwd: directory,
        env: { ...process.env, SIM_CONFIG_DIR: directory, SIM_API_KEY: personalKey, NO_COLOR: '1' },
        timeout: REQUEST_TIMEOUT_MS,
        maxBuffer: MAX_RESPONSE_BYTES,
      }
    )
    return { exitCode: 0, stdout, stderr }
  } catch (error) {
    assert(isRecordLike(error), getErrorMessage(error))
    assert(
      error.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
      `sim workflows run printed more than ${MAX_RESPONSE_BYTES} bytes`
    )
    assert(!error.killed, `sim workflows run did not exit within ${REQUEST_TIMEOUT_MS / 1000}s`)
    assert(
      typeof error.code === 'number' &&
        typeof error.stdout === 'string' &&
        typeof error.stderr === 'string',
      getErrorMessage(error)
    )
    return { exitCode: error.code, stdout: error.stdout, stderr: error.stderr }
  }
}

async function runCli(args: string[]): Promise<V2ExecuteWorkflowData> {
  const { exitCode, stdout, stderr } = await execCli(args)
  assert.equal(
    exitCode,
    0,
    `sim workflows run exited ${exitCode}: ${truncate(stderr || stdout, 500)}`
  )
  return v2ExecuteWorkflowDataSchema.parse(JSON.parse(stdout))
}

/** A CLI run the command itself must fail: exits non-zero and prints the failed run. */
async function runCliExpectingFailure(args: string[]): Promise<V2ExecuteWorkflowData> {
  const { exitCode, stdout } = await execCli(args)
  assert.notEqual(exitCode, 0, 'the CLI exited 0 for a run that must fail')
  return v2ExecuteWorkflowDataSchema.parse(JSON.parse(stdout))
}

const selectAll = ['Slow.status', 'Check.status', 'After.status']

try {
  await check('seed disposable workspace, personal key and fixtures', seed)

  await check('the execute route compiles and refuses a run before it starts', () =>
    expectBadRequest(
      pipeline.workflowId,
      { run: { source: 'manual', stopAfterBlockId: '' } },
      'BAD_REQUEST',
      ROUTE_COMPILE_TIMEOUT_MS
    )
  )

  let sourceRunId = ''
  await check('a full manual run executes every block and persists its state', async () => {
    const full = await run(pipeline.workflowId, {
      run: { source: 'manual' },
      selectedOutputs: selectAll,
    })
    assert.deepEqual(full.blockOutputs, {
      'Slow.status': 'completed',
      'Check.status': 'completed',
      'After.status': 'completed',
    })
    assert(
      (full.durationMs ?? 0) >= SLOW_MS,
      `a full run must include Slow's ${SLOW_MS} ms, took ${full.durationMs} ms`
    )
    sourceRunId = full.runId
  })

  await check(
    'the CLI re-runs only Check against the source run, without re-running Slow',
    async () => {
      const single = await runCli([
        pipeline.workflowId,
        '--from-block',
        pipeline.check,
        '--source-run',
        sourceRunId,
        '--stop-after',
        pipeline.check,
        ...selectAll.flatMap((selector) => ['--select-output', selector]),
      ])
      assert.equal(single.status, 'completed')
      assert.notEqual(single.runId, sourceRunId)
      assert.deepEqual(single.blockOutputs, { 'Check.status': 'completed' })
      assert(
        (single.durationMs ?? Number.POSITIVE_INFINITY) < SLOW_MS,
        `a single-block run must not wait on Slow, took ${single.durationMs} ms`
      )
    }
  )

  await check('a trigger-entry run stops after the named block', async () => {
    const until = await run(pipeline.workflowId, {
      run: { source: 'manual', stopAfterBlockId: pipeline.slow },
      selectedOutputs: selectAll,
    })
    assert.deepEqual(until.blockOutputs, { 'Slow.status': 'completed' })
  })

  await check('reaching the stop block retires a pause on another branch', async () => {
    const result = await run(forkedPause.workflowId, {
      run: { source: 'manual', stopAfterBlockId: forkedPause.check },
      selectedOutputs: selectAll,
    })
    assert.equal(result.blockOutputs?.['Check.status'], 'completed')
    assert.equal(result.blockOutputs?.['After.status'], undefined)
    const [{ count }] =
      await sql`select count(*)::int as count from paused_executions where execution_id = ${result.runId}`
    assert.equal(count, 0, 'A completed stop-after run must not persist resume points')
  })

  for (const fixture of pausePipelines) {
    await check(`${fixture.type}: resume retains a downstream stop target`, async () => {
      const result = await resume(fixture, await pause(fixture, fixture.check))
      assert.equal(result.blockOutputs?.[`${fixture.check}.status`], 'completed')
      assert.equal(result.blockOutputs?.[`${fixture.after}.status`], undefined)
    })
    await check(
      `${fixture.type}: a pausing stop target completes on resume without running downstream`,
      async () => {
        const result = await resume(fixture, await pause(fixture, fixture.slow))
        assert.equal(result.blockOutputs?.[`${fixture.check}.status`], undefined)
        assert.equal(result.blockOutputs?.[`${fixture.after}.status`], undefined)
      }
    )
    await check(`${fixture.type}: an ordinary resume still runs downstream`, async () => {
      const result = await resume(fixture, await pause(fixture))
      assert.equal(result.blockOutputs?.[`${fixture.check}.status`], 'completed')
      assert.equal(result.blockOutputs?.[`${fixture.after}.status`], 'completed')
    })
  }

  await check('a stop reached on resume retires previously persisted sibling pauses', async () => {
    const paused = await pause(siblingPauses, siblingPauses.after)
    const [before] =
      await sql`select pause_points from paused_executions where execution_id = ${paused.runId}`
    const siblingContext = Object.keys(record(before.pause_points)).find(
      (id) => id !== paused.contextId
    )
    assert(siblingContext)
    const completion = resume(siblingPauses, paused)
    try {
      let claimed = false
      for (let attempt = 0; attempt < 100; attempt++) {
        const [{ count }] =
          await sql`select count(*)::int as count from resume_queue where parent_execution_id = ${paused.runId} and status = 'claimed'`
        if (count === 1) {
          claimed = true
          break
        }
        await sleep(20)
      }
      assert(claimed, 'The first resume must own the run before its sibling is queued')
      await execute(
        siblingPauses.workflowId,
        { contextId: siblingContext },
        { runId: paused.runId, expectedStatus: 202 }
      )
    } finally {
      await completion
    }
    const [saved] =
      await sql`select status, next_resume_at from paused_executions where execution_id = ${paused.runId}`
    assert.equal(saved.status, 'fully_resumed')
    assert.equal(saved.next_resume_at, null)
    const [log] =
      await sql`select status from workflow_execution_logs where execution_id = ${paused.runId}`
    assert.equal(
      log.status,
      'completed',
      'Sibling pauses must not reopen a completed stop-after run'
    )
    const [{ count }] =
      await sql`select count(*)::int as count from resume_queue where parent_execution_id = ${paused.runId} and status in ('pending', 'claimed')`
    assert.equal(count, 0, 'Queued sibling resumes must be retired before they can run')
  })

  for (const fixture of containerPauses) {
    await check(
      `${fixture.type}: pauses before and inside the container retain its stop target`,
      async () => {
        const paused = await pause(fixture, fixture.check)
        const resumedScopes = new Set<number>()
        const query = new URLSearchParams({
          includeOutput: 'true',
          selectedOutputs: `${fixture.after}.status`,
        })
        for (let step = 0; step < 3; step++) {
          const [saved] =
            await sql`select pause_points from paused_executions where execution_id = ${paused.runId}`
          const pending = Object.entries(record(saved.pause_points)).find(
            ([, point]) => record(point).resumeStatus !== 'resumed'
          )
          assert(pending, 'Every iteration or branch must pause before the container finishes')
          const [contextId, point] = pending
          if (step === 0) {
            assert.equal(contextId, paused.contextId)
          } else {
            assert(String(record(point).blockId).startsWith(fixture.inner))
            const scope = record(record(point)[`${fixture.type}Scope`])
            assert.equal(scope[`${fixture.type}Id`], fixture.check)
            const index = fixture.type === 'loop' ? scope.iteration : scope.branchIndex
            assert(typeof index === 'number')
            assert(!resumedScopes.has(index), 'Each iteration or branch resumes once')
            resumedScopes.add(index)
          }
          const resumed = v2ExecuteWorkflowDataSchema.parse(
            record(
              await execute(
                fixture.workflowId,
                { contextId, input: { approved: true } },
                { runId: paused.runId, timeoutMs: ROUTE_COMPILE_TIMEOUT_MS }
              )
            ).data
          )
          assert.notEqual(resumed.status, 'failed', JSON.stringify(resumed.error))
          const status = v2WorkflowRunStatusSchema.parse(
            (await get(`/api/v2/workflows/${fixture.workflowId}/runs/${paused.runId}?${query}`))
              .data
          )
          assert.equal(status.blockOutputs?.[`${fixture.after}.status`], undefined)
          if (step < 2) {
            assert.notEqual(status.status, 'completed', 'The container still has a pending pause')
          } else {
            assert.equal(status.status, 'completed')
          }
        }
        assert.equal(resumedScopes.size, 2)
      }
    )
  }

  const branchOutputs = ['Taken.status', 'Tail.status', 'Skipped.status']

  await check(
    'a stop block on the branch the condition takes still stops the run there',
    async () => {
      const until = await run(branch.workflowId, {
        run: { source: 'manual', stopAfterBlockId: branch.taken },
        selectedOutputs: branchOutputs,
      })
      assert.deepEqual(until.blockOutputs, { 'Taken.status': 'completed' })
    }
  )

  await check(
    'a stop block the condition routes away from fails the run before the other branch finishes',
    async () => {
      const skipped = v2ExecuteWorkflowDataSchema.parse(
        record(
          await execute(branch.workflowId, {
            run: { source: 'manual', stopAfterBlockId: branch.skipped },
            selectedOutputs: branchOutputs,
          })
        ).data
      )
      assert.equal(skipped.status, 'failed')
      assert.match(skipped.error?.message ?? '', /Stop block "Skipped" \(.+\) was not reached/)
      assert.equal(skipped.blockOutputs?.['Skipped.status'], undefined)
      assert.equal(skipped.blockOutputs?.['Tail.status'], undefined)
      assert(
        (skipped.durationMs ?? Number.POSITIVE_INFINITY) < SLOW_MS,
        `the run must end once Gate decides, not after Tail's ${SLOW_MS} ms, took ${skipped.durationMs} ms`
      )
    }
  )

  await check('the CLI exits non-zero when the stop block is not reached', async () => {
    const skipped = await runCliExpectingFailure([
      branch.workflowId,
      '--stop-after',
      branch.skipped,
      ...branchOutputs.flatMap((selector) => ['--select-output', selector]),
    ])
    assert.equal(skipped.status, 'failed')
    assert.match(skipped.error?.message ?? '', /was not reached/)
  })

  await check('a block entry without stopAfterBlockId still runs downstream blocks', async () => {
    const fromCheck = await run(pipeline.workflowId, {
      run: {
        source: 'manual',
        entry: { type: 'block', blockId: pipeline.check, sourceRunId },
      },
      selectedOutputs: selectAll,
    })
    assert.deepEqual(fromCheck.blockOutputs, {
      'Check.status': 'completed',
      'After.status': 'completed',
    })
  })

  await check('invalid stop-after selections are refused before anything runs', async () => {
    const before =
      await sql`select count(*)::int as count from workflow_execution_logs where workflow_id = ${pipeline.workflowId}`
    await expectBadRequest(
      pipeline.workflowId,
      { run: { source: 'manual', stopAfterBlockId: otherPipeline.check } },
      'BAD_REQUEST'
    )
    await expectBadRequest(
      pipeline.workflowId,
      { run: { source: 'manual', stopAfterBlockId: '' } },
      'BAD_REQUEST'
    )
    await expectBadRequest(
      pipeline.workflowId,
      {
        run: {
          source: 'manual',
          entry: { type: 'block', blockId: pipeline.check, sourceRunId },
          stopAfterBlockId: pipeline.slow,
        },
      },
      'BAD_REQUEST'
    )
    await expectBadRequest(
      pipeline.workflowId,
      { run: { source: 'manual', stopAfterBlockId: pipeline.check }, async: true },
      'BAD_REQUEST'
    )
    await expectBadRequest(
      pipeline.workflowId,
      {
        run: {
          source: 'manual',
          entry: { type: 'block', blockId: pipeline.check, sourceRunId: 'not-a-run' },
          stopAfterBlockId: pipeline.check,
        },
      },
      'NOT_FOUND'
    )
    const after =
      await sql`select count(*)::int as count from workflow_execution_logs where workflow_id = ${pipeline.workflowId}`
    assert.equal(after[0].count, before[0].count, 'a refused request must not start a run')
  })

  await check('a source run from another workflow is not accepted', async () => {
    const foreign = await run(otherPipeline.workflowId, { run: { source: 'manual' } })
    await expectBadRequest(
      pipeline.workflowId,
      {
        run: {
          source: 'manual',
          entry: { type: 'block', blockId: pipeline.check, sourceRunId: foreign.runId },
          stopAfterBlockId: pipeline.check,
        },
      },
      'NOT_FOUND'
    )
  })
} catch (error) {
  logger.error(failureMessage(error))
  process.exitCode = 1
} finally {
  try {
    await check('remove disposable fixtures', async () => {
      // A response returns before its run finishes persisting logs and large-value
      // references; a cascade delete racing those writes can be chosen as a deadlock victim.
      const workflowIds = [
        pipeline.workflowId,
        otherPipeline.workflowId,
        branch.workflowId,
        forkedPause.workflowId,
        siblingPauses.workflowId,
        ...pausePipelines.map((fixture) => fixture.workflowId),
        ...containerPauses.map((fixture) => fixture.workflowId),
      ]
      for (let attempt = 0; attempt < 120; attempt++) {
        const [{ open }] =
          await sql`select count(*)::int as open from workflow_execution_logs where workflow_id in ${sql(workflowIds)} and ended_at is null`
        if (open === 0) break
        await sleep(500)
      }
      for (let attempt = 1; ; attempt++) {
        try {
          await sql.begin(async (tx) => {
            await tx`delete from workspace where id = ${workspaceId}`
            await tx`delete from project where id = ${workspaceId}`
            await tx`delete from "user" where id = ${ownerId}`
          })
          break
        } catch (error) {
          const deadlocked = isRecordLike(error) && error.code === '40P01'
          if (!deadlocked || attempt === 5) throw error
          await sleep(1000)
        }
      }
      if (directory) await rm(directory, { recursive: true, force: true })
    })
  } catch (error) {
    logger.error(failureMessage(error))
    process.exitCode = 1
  } finally {
    await sql.end()
    await writeFile(
      reportPath,
      `${JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), status: process.exitCode ? 'failed' : 'passed', checks, requests }, null, 2)}\n`
    )
  }
}
