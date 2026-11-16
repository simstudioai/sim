import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'

/**
 * Workflow source apply over the real HTTP boundary of a running local app: create a workflow,
 * read it as TypeScript (`GET /api/v2/workflows/{id}/source`), edit the text, apply it
 * (`POST .../source`), and check the stored graph through `GET .../state`. Also drives the dry
 * run, the stale-fingerprint 409 and the line-pinned 400. The app must have the `workflow-code`
 * flag on, and the key must be a personal API key (workspace keys are refused).
 *
 * Env: WORKFLOW_SOURCE_E2E_BASE_URL (loopback origin), WORKFLOW_SOURCE_E2E_API_KEY,
 * WORKFLOW_SOURCE_E2E_WORKSPACE_ID, WORKFLOW_SOURCE_E2E_REPORT_PATH.
 */
const logger = createLogger('WorkflowSourceApplyE2E')

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

const baseUrl = new URL(requiredEnvironment('WORKFLOW_SOURCE_E2E_BASE_URL'))
const apiKey = requiredEnvironment('WORKFLOW_SOURCE_E2E_API_KEY')
const workspaceId = requiredEnvironment('WORKFLOW_SOURCE_E2E_WORKSPACE_ID')
const reportPath = requiredEnvironment('WORKFLOW_SOURCE_E2E_REPORT_PATH')
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
assert(loopbackHosts.has(baseUrl.hostname), 'The app must use a loopback host')
assert.equal(baseUrl.protocol, 'http:', 'The app must use local HTTP')
assert.equal(baseUrl.pathname, '/', 'App URL must be an origin without a path')

const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const httpLog: { method: string; path: string; status: number }[] = []
const startedAt = new Date().toISOString()
const SCORE_CODE = 'return 40 + 2'

type Json = Record<string, unknown>

function record(value: unknown): Json {
  assert(isRecordLike(value), 'Expected a JSON object')
  return value
}

async function request(method: string, path: string, body?: unknown, expected = 200) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      'x-api-key': apiKey,
      'User-Agent': 'Sim-local-workflow-source-E2E',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  })
  httpLog.push({ method, path, status: response.status })
  const text = await response.text()
  const parsed = text ? record(JSON.parse(text)) : {}
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: ${response.status} ${text.slice(0, 500)}`
  )
  return parsed
}

async function check(name: string, run: () => Promise<void>) {
  const started = performance.now()
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: performance.now() - started })
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: performance.now() - started,
      error: getErrorMessage(error),
    })
    logger.error('Check failed', { name, error: getErrorMessage(error) })
  }
}

function edit(files: Record<string, string>, from: string, to: string): Record<string, string> {
  const hits = Object.entries(files).filter(([, text]) => text.split(from).length === 2)
  assert.equal(hits.length, 1, `exactly one file holds "${from}" once`)
  const [path, text] = hits[0]
  return { ...files, [path]: text.replace(from, to) }
}

async function readSource(workflowId: string) {
  const { data } = await request('GET', `/api/v2/workflows/${workflowId}/source`)
  const source = record(data)
  return {
    files: record(source.files) as Record<string, string>,
    lock: record(source.lock),
    lockBase: record(source.lockBase),
    fingerprint: String(source.fingerprint),
  }
}

async function storedBlocks(workflowId: string): Promise<Record<string, Json>> {
  const { data } = await request('GET', `/api/v2/workflows/${workflowId}/state`)
  return record(record(data).blocks) as Record<string, Json>
}

function applyBody(source: Awaited<ReturnType<typeof readSource>>, files = source.files) {
  return {
    files,
    lock: source.lock,
    lockBase: source.lockBase,
    baseFingerprint: source.fingerprint,
    provenance: { client: 'api' },
  }
}

async function main() {
  const created = record(
    (
      await request(
        'POST',
        '/api/v2/workflows',
        { workspaceId, name: `Source apply e2e ${generateId().slice(0, 8)}` },
        201
      )
    ).data
  )
  const workflowId = String(created.id)
  const startId = String(record((created.blocks as unknown[])[0]).id)
  const scoreId = generateId()
  const seededBlocks = await storedBlocks(workflowId)

  try {
    await request('PUT', `/api/v2/workflows/${workflowId}/state`, {
      blocks: {
        ...seededBlocks,
        [scoreId]: {
          id: scoreId,
          type: 'function',
          name: 'Score',
          position: { x: 420, y: 0 },
          subBlocks: { code: { id: 'code', type: 'code', value: SCORE_CODE } },
          outputs: {},
          enabled: true,
        },
      },
      edges: [{ id: generateId(), source: startId, target: scoreId }],
    })

    await check('unchanged source is a no-op', async () => {
      const source = await readSource(workflowId)
      const { data } = await request(
        'POST',
        `/api/v2/workflows/${workflowId}/source`,
        applyBody(source)
      )
      const result = record(data)
      assert.equal(result.applied, false)
      assert.equal(record(result.diff).noop, true)
      assert.equal(result.newFingerprint, source.fingerprint)
    })

    await check('a dry run reports the edit and saves nothing', async () => {
      const source = await readSource(workflowId)
      const { data } = await request(
        'POST',
        `/api/v2/workflows/${workflowId}/source?dryRun=true`,
        applyBody(source, edit(source.files, SCORE_CODE, 'return 1'))
      )
      assert.equal(record(data).applied, false)
      assert.equal(record(data).dryRun, true)
      const blocks = await storedBlocks(workflowId)
      assert.equal(record(record(blocks[scoreId].subBlocks).code).value, SCORE_CODE)
    })

    let staleSource: Awaited<ReturnType<typeof readSource>> | undefined
    await check('an edit writes exactly that field and keeps the block ids', async () => {
      const source = await readSource(workflowId)
      staleSource = source
      const before = await storedBlocks(workflowId)
      const { data } = await request(
        'POST',
        `/api/v2/workflows/${workflowId}/source`,
        applyBody(source, edit(source.files, SCORE_CODE, 'return 7'))
      )
      const result = record(data)
      assert.equal(result.applied, true)
      const after = await storedBlocks(workflowId)
      assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort())
      assert.equal(record(record(after[scoreId].subBlocks).code).value, 'return 7')
      assert.deepEqual(after[startId], before[startId])
      const reread = await readSource(workflowId)
      assert.equal(reread.fingerprint, result.newFingerprint)
    })

    await check('source read before that edit is refused with 409', async () => {
      assert(staleSource, 'the edit check must run first')
      const body = await request(
        'POST',
        `/api/v2/workflows/${workflowId}/source`,
        applyBody(staleSource, edit(staleSource.files, SCORE_CODE, 'return 9')),
        409
      )
      assert.equal(record(record(body.error).details).code, 'SOURCE_STALE')
    })

    await check('broken source is refused with a line-pinned 400', async () => {
      const source = await readSource(workflowId)
      const body = await request(
        'POST',
        `/api/v2/workflows/${workflowId}/source`,
        applyBody(source, {
          ...source.files,
          'workflow.ts': `${source.files['workflow.ts']}\nconst = \n`,
        }),
        400
      )
      const details = record(record(body.error).details)
      assert.equal(details.code, 'SOURCE_REJECTED')
      const first = record((details.diagnostics as unknown[])[0])
      assert.equal(first.file, 'workflow.ts')
      assert.equal(typeof first.line, 'number')
    })
  } finally {
    await request('DELETE', `/api/v2/workflows/${workflowId}`).catch((error: unknown) => {
      logger.warn('Cleanup failed', { workflowId, error: getErrorMessage(error) })
    })
  }
}

main()
  .catch((error: unknown) => {
    checks.push({ name: 'setup', status: 'failed', durationMs: 0, error: getErrorMessage(error) })
  })
  .finally(async () => {
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(
      reportPath,
      JSON.stringify({ suite: 'workflow-source-apply', startedAt, checks, httpLog }, null, 2)
    )
    const failed = checks.filter((entry) => entry.status === 'failed')
    logger.info('Workflow source apply e2e finished', {
      passed: checks.length - failed.length,
      failed: failed.length,
    })
    if (failed.length > 0) process.exitCode = 1
  })
