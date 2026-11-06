import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import postgres from 'postgres'
import type { EmbeddedCliIdentity, EmbeddedCliResult } from 'sim/embed'

/**
 * Times the two CLI commands the chat agent issues most, `workflows run --manual`
 * and `logs get --trace`, against a separately running local app over real HTTP.
 *
 * Each command runs through the embedded CLI (the same command tree, request
 * builder and JSON renderer the agent's `sim_cli` tool uses) and its stdout is
 * written to a file the way an `outputFile` sink lands it. Every iteration is
 * split into segments so a before/after comparison shows where time moved:
 * CLI work before the request, server time before execution started, execution,
 * server time after execution ended, CLI rendering, and the sink write.
 *
 * Fixtures are seeded straight into a disposable database and removed at the end.
 * With this checkout's CLI, the run also asserts the embedded results stay lean:
 * file references without inline bytes, and a log without its workflow snapshot.
 * `CLI_LATENCY_E2E_CLI_MODULE` points the run at another checkout's `embed.ts`,
 * so two CLI builds can be compared against the same server (measured, not asserted), and
 * `CLI_LATENCY_E2E_SINK_DIR` keeps every command's stdout for inspection.
 */
const logger = createLogger('CliRunLatencyE2E')
const REQUEST_TIMEOUT_MS = 120_000
const LOG_SETTLE_TIMEOUT_MS = 30_000
const startedAt = new Date().toISOString()

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const value = Number(raw)
  assert(Number.isInteger(value) && value > 0, `${name} must be a positive integer`)
  return value
}

const baseUrl = new URL(requiredEnvironment('CLI_LATENCY_E2E_BASE_URL'))
const databaseUrl = assertDisposableTestDatabaseUrl(
  requiredEnvironment('CLI_LATENCY_E2E_DATABASE_URL')
)
const reportPath = requiredEnvironment('CLI_LATENCY_E2E_REPORT_PATH')
const label = process.env.CLI_LATENCY_E2E_LABEL ?? 'local'
const measuredRuns = positiveInteger('CLI_LATENCY_E2E_RUNS', 30)
const warmupRuns = positiveInteger('CLI_LATENCY_E2E_WARMUP', 3)
const comparedCliModule = process.env.CLI_LATENCY_E2E_CLI_MODULE
const cliModulePath =
  comparedCliModule ??
  fileURLToPath(new URL('../../../packages/sim-cli/src/embed.ts', import.meta.url))
assert(new Set(['localhost', '127.0.0.1', '[::1]']).has(baseUrl.hostname), 'Use a loopback app')
assert.equal(baseUrl.protocol, 'http:', 'Use a local HTTP app')
assert.equal(baseUrl.pathname, '/', 'App URL must be an origin')

const sql = postgres(databaseUrl.toString(), { max: 2 })
const userId = generateId()
const workspaceId = generateId()
const workflowId = generateId()
const apiKey = `sk-sim-fixture-${generateId()}`

type Segment =
  | 'cliBeforeRequestMs'
  | 'serverBeforeExecutionMs'
  | 'executionMs'
  | 'serverAfterExecutionMs'
  | 'httpMs'
  | 'cliRenderMs'
  | 'sinkWriteMs'
  | 'totalMs'

interface CommandTiming {
  command: 'workflows run' | 'logs get'
  iteration: number
  segments: Partial<Record<Segment, number>>
  stdoutBytes: number
  /** What the command's stdout carried, so a size change is attributable. */
  carried: { inlineFileBytes?: boolean; workflowState?: boolean }
}

const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const timings: CommandTiming[] = []

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
      error: truncate(getErrorMessage(error).replaceAll(apiKey, '[redacted]'), 2000),
    })
    throw error
  }
}

function record(value: unknown): Record<string, unknown> {
  assert(isRecordLike(value), 'Expected a JSON object')
  return value
}

const FUNCTION_CODE = `const rows = Array.from({ length: 2000 }, (_, i) => ({ i, label: 'row-' + i, value: i * 7 }))
return { rows, total: rows.reduce((sum, row) => sum + row.value, 0) }`

const SUMMARY_CODE = `const rows = <Build.result>.rows
return { count: rows.length, csv: rows.map((row) => row.i + ',' + row.label + ',' + row.value).join('\\n') }`

const blocks = [
  {
    id: generateId(),
    type: 'start_trigger',
    name: 'Start',
    x: 0,
    subBlocks: { inputFormat: { id: 'inputFormat', type: 'input-format', value: [] } },
  },
  {
    id: generateId(),
    type: 'function',
    name: 'Build',
    x: 300,
    subBlocks: {
      language: { id: 'language', type: 'dropdown', value: 'javascript' },
      code: { id: 'code', type: 'code', value: FUNCTION_CODE },
    },
  },
  {
    id: generateId(),
    type: 'function',
    name: 'Summarize',
    x: 600,
    subBlocks: {
      language: { id: 'language', type: 'dropdown', value: 'javascript' },
      code: { id: 'code', type: 'code', value: SUMMARY_CODE },
    },
  },
  {
    id: generateId(),
    type: 'file_v5',
    name: 'Report',
    x: 900,
    subBlocks: {
      operation: { id: 'operation', type: 'dropdown', value: 'file_write' },
      fileName: { id: 'fileName', type: 'short-input', value: 'latency-report.csv' },
      content: { id: 'content', type: 'long-input', value: '<Summarize.result.csv>' },
      overwrite: { id: 'overwrite', type: 'switch', value: true },
    },
  },
  {
    id: generateId(),
    type: 'file_v5',
    name: 'Read Report',
    x: 1200,
    advancedMode: true,
    subBlocks: {
      operation: { id: 'operation', type: 'dropdown', value: 'file_read' },
      readFileId: { id: 'readFileId', type: 'short-input', value: '<Report.id>' },
    },
  },
]

async function seed() {
  await sql.begin(async (tx) => {
    const email = `${userId}@cli-latency.test`
    await tx`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
      values (${userId}, 'CLI latency fixture', ${email}, ${email}, true, now(), now())`
    await tx`insert into user_stats (id, user_id) values (${generateId()}, ${userId})`
    await tx`insert into project (id, name, owner_id)
      values (${workspaceId}, 'E2E fixture project', ${userId})`
    await tx`insert into workspace (id, project_id, name, owner_id, billed_account_user_id)
      values (${workspaceId}, ${workspaceId}, 'CLI latency fixture', ${userId}, ${userId})`
    await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type)
      values (${generateId()}, ${userId}, 'workspace', ${workspaceId}, 'admin')`
    await tx`insert into api_key (id, user_id, name, key, key_hash, type)
      values (${generateId()}, ${userId}, 'CLI latency fixture', ${apiKey}, ${sha256Hex(apiKey)}, 'personal')`
    await tx`insert into workflow (id, user_id, workspace_id, name, last_synced, created_at, updated_at)
      values (${workflowId}, ${userId}, ${workspaceId}, 'CLI latency fixture', now(), now(), now())`
    for (const block of blocks) {
      await tx`insert into workflow_blocks (id, workflow_id, type, name, position_x, position_y, advanced_mode, sub_blocks)
        values (${block.id}, ${workflowId}, ${block.type}, ${block.name}, ${block.x}, 0, ${'advancedMode' in block}, ${JSON.stringify(block.subBlocks)}::text::jsonb)`
    }
    for (let index = 1; index < blocks.length; index++) {
      await tx`insert into workflow_edges (id, workflow_id, source_block_id, target_block_id, source_handle, target_handle)
        values (${generateId()}, ${workflowId}, ${blocks[index - 1].id}, ${blocks[index].id}, 'source', 'target')`
    }
  })
}

async function cleanup() {
  // Snapshots outlive their workflow (`workflow_id` is set null), so they go first,
  // after the logs that reference them.
  await sql`delete from workflow_execution_logs where workflow_id = ${workflowId}`
  await sql`delete from workflow_execution_snapshots where workflow_id = ${workflowId}`
  await sql.begin(async (tx) => {
    await tx`delete from workspace where id = ${workspaceId}`
    await tx`delete from project where id = ${workspaceId}`
    await tx`delete from "user" where id = ${userId}`
  })
}

interface TransportMarks {
  firstRequestAt?: number
  firstRequestEpochMs?: number
  lastBodyAt?: number
  lastBodyEpochMs?: number
}

/** Real HTTP to the loopback app, recording when the first request left and the last body byte arrived. */
function timingTransport(marks: TransportMarks): typeof fetch {
  const transport = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input)
    assert.equal(url.origin, baseUrl.origin, 'Requests must stay on the loopback app')
    if (marks.firstRequestAt === undefined) {
      marks.firstRequestAt = performance.now()
      marks.firstRequestEpochMs = Date.now()
    }
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    // boundary-raw-fetch: protocol E2E exercises a separately running local app over real HTTP
    const response = await fetch(input, {
      ...init,
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
        : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const markBodyEnd = () => {
      marks.lastBodyAt = performance.now()
      marks.lastBodyEpochMs = Date.now()
    }
    if (!response.body) {
      markBodyEnd()
      return response
    }
    return new Response(
      // The NDJSON reader returns on its `final` frame without reading to EOF, so
      // the last chunk to arrive marks the end of the response as the CLI sees it.
      response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            markBodyEnd()
            controller.enqueue(chunk)
          },
          flush: markBodyEnd,
        })
      ),
      { status: response.status, statusText: response.statusText, headers: response.headers }
    )
  }
  return transport as typeof fetch
}

type RunEmbeddedCli = (argv: string[], identity: EmbeddedCliIdentity) => Promise<EmbeddedCliResult>

async function timedCommand(
  runCli: RunEmbeddedCli,
  argv: string[],
  sinkPath: string
): Promise<{
  result: EmbeddedCliResult
  marks: TransportMarks
  segments: Partial<Record<Segment, number>>
}> {
  const marks: TransportMarks = {}
  const started = performance.now()
  const result = await runCli(argv, {
    endpoint: baseUrl.origin,
    apiKey,
    workspaceId,
    transport: timingTransport(marks),
  })
  const rendered = performance.now()
  assert.equal(
    result.exitCode,
    0,
    `${argv.slice(0, 2).join(' ')} failed: ${truncate(result.stderr, 500)}`
  )
  await writeFile(sinkPath, result.stdout)
  const finished = performance.now()
  assert(
    marks.firstRequestAt !== undefined && marks.lastBodyAt !== undefined,
    'No request was made'
  )
  return {
    result,
    marks,
    segments: {
      cliBeforeRequestMs: marks.firstRequestAt - started,
      httpMs: marks.lastBodyAt - marks.firstRequestAt,
      cliRenderMs: rendered - marks.lastBodyAt,
      sinkWriteMs: finished - rendered,
      totalMs: finished - started,
    },
  }
}

/** The log row is finalized after the response, so a read waits for its terminal state first. */
async function waitForSettledLog(runId: string) {
  const deadline = Date.now() + LOG_SETTLE_TIMEOUT_MS
  while (Date.now() < deadline) {
    // The columns are UTC wall-clock without a zone; epoch extraction reads them as UTC.
    const [row] = await sql<{ status: string; startedAtMs: string; endedAtMs: string | null }[]>`
      select status,
        extract(epoch from started_at) * 1000 as "startedAtMs",
        extract(epoch from ended_at) * 1000 as "endedAtMs"
      from workflow_execution_logs where execution_id = ${runId}`
    if (row?.endedAtMs && row.status !== 'running')
      return { startedAtMs: Number(row.startedAtMs), endedAtMs: Number(row.endedAtMs) }
    await sleep(50)
  }
  throw new Error(`Run ${runId} log did not settle within ${LOG_SETTLE_TIMEOUT_MS} ms`)
}

async function iterate(
  runCli: RunEmbeddedCli,
  directory: string,
  iteration: number,
  keep: boolean
) {
  const run = await timedCommand(
    runCli,
    ['workflows', 'run', workflowId, '--manual', '--select-output', 'Summarize.result.count'],
    resolve(directory, `run-${iteration}.json`)
  )
  const payload = record(JSON.parse(run.result.stdout))
  assert.equal(payload.status, 'completed', 'The fixture run must complete')
  const runId = payload.runId
  assert(typeof runId === 'string', 'The run result names its run')
  assert.deepEqual(payload.blockOutputs, { 'Summarize.result.count': 2000 })
  const file = record(record(payload.output).file)
  assert(
    typeof file.id === 'string' && file.name === 'latency-report.csv',
    'The run names its file'
  )
  const inlineFileBytes = typeof file.base64 === 'string'
  // Another CLI build is measured as it behaves; this checkout's CLI must stay lean.
  if (!comparedCliModule) assert(!inlineFileBytes, 'An embedded run returns file references only')

  const logRow = await waitForSettledLog(runId)
  const logs = await timedCommand(
    runCli,
    ['logs', 'get', runId, '--trace'],
    resolve(directory, `log-${iteration}.json`)
  )
  const log = record(JSON.parse(logs.result.stdout))
  assert.equal(log.runId, runId)
  assert(Array.isArray(log.traceSpans) && log.traceSpans.length > 0, 'The log carries trace spans')
  const workflowState = isRecordLike(log.workflowState)
  if (!comparedCliModule) assert(!workflowState, 'An embedded log read omits the workflow snapshot')

  if (!keep) return
  const { firstRequestEpochMs, lastBodyEpochMs } = run.marks
  assert(firstRequestEpochMs !== undefined && lastBodyEpochMs !== undefined)
  timings.push({
    command: 'workflows run',
    iteration,
    stdoutBytes: Buffer.byteLength(run.result.stdout),
    carried: { inlineFileBytes },
    segments: {
      ...run.segments,
      serverBeforeExecutionMs: logRow.startedAtMs - firstRequestEpochMs,
      executionMs: logRow.endedAtMs - logRow.startedAtMs,
      serverAfterExecutionMs: lastBodyEpochMs - logRow.endedAtMs,
    },
  })
  timings.push({
    command: 'logs get',
    iteration,
    stdoutBytes: Buffer.byteLength(logs.result.stdout),
    carried: { workflowState },
    segments: logs.segments,
  })
}

function percentile(sorted: number[], p: number): number {
  const rank = (sorted.length - 1) * p
  const low = Math.floor(rank)
  const high = Math.ceil(rank)
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low)
}

function summarize() {
  const summary: Record<string, Record<string, { n: number; p50: number; p90: number }>> = {}
  for (const command of ['workflows run', 'logs get'] as const) {
    const rows = timings.filter((timing) => timing.command === command)
    const segments = new Set(rows.flatMap((row) => Object.keys(row.segments)))
    summary[command] = {}
    for (const segment of segments) {
      const values = rows
        .map((row) => row.segments[segment as Segment])
        .filter((value): value is number => value !== undefined)
        .sort((a, b) => a - b)
      summary[command][segment] = {
        n: values.length,
        p50: Math.round(percentile(values, 0.5) * 10) / 10,
        p90: Math.round(percentile(values, 0.9) * 10) / 10,
      }
    }
    const bytes = rows.map((row) => row.stdoutBytes).sort((a, b) => a - b)
    summary[command].stdoutBytes = {
      n: bytes.length,
      p50: percentile(bytes, 0.5),
      p90: percentile(bytes, 0.9),
    }
  }
  return summary
}

async function main() {
  const keptSinkDirectory = process.env.CLI_LATENCY_E2E_SINK_DIR
  const directory = keptSinkDirectory ?? (await mkdtemp(resolve(tmpdir(), 'sim-cli-latency-')))
  await mkdir(directory, { recursive: true })
  let failure: unknown
  try {
    const cli = (await import(pathToFileURL(cliModulePath).href)) as {
      runEmbeddedCli: RunEmbeddedCli
    }
    await check('seed fixtures', seed)
    await check(`warm up (${warmupRuns} iterations, not recorded)`, async () => {
      for (let index = 0; index < warmupRuns; index++)
        await iterate(cli.runEmbeddedCli, directory, -1 - index, false)
    })
    await check(`measure (${measuredRuns} iterations)`, async () => {
      for (let index = 0; index < measuredRuns; index++)
        await iterate(cli.runEmbeddedCli, directory, index, true)
    })
  } catch (error) {
    failure = error
    logger.error('CLI latency E2E failed', {
      error: getErrorMessage(error).replaceAll(apiKey, '[redacted]'),
    })
  } finally {
    await cleanup().catch((error) =>
      logger.warn('Fixture cleanup failed', { error: getErrorMessage(error) })
    )
    await sql.end()
    if (!keptSinkDirectory) await rm(directory, { recursive: true, force: true })
  }

  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        suite: 'cli-run-latency',
        label,
        startedAt,
        finishedAt: new Date().toISOString(),
        baseUrl: baseUrl.origin,
        cliModule: cliModulePath,
        warmupRuns,
        measuredRuns,
        checks,
        summary: summarize(),
        timings,
      },
      null,
      2
    )}\n`
  )
  if (failure) process.exit(1)
}

await main()
