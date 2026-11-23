import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import postgres from 'postgres'

/**
 * Workflow source apply over the real HTTP boundary of a running local app: create a workflow,
 * read it as TypeScript (`GET /api/v2/workflows/{id}/source`), edit the text, apply it
 * (`POST .../source`), and check the stored graph through `GET .../state`. Also drives the dry
 * run, the stale-fingerprint 409 and the line-pinned 400. Then reads the resource manifest
 * (`GET /api/v2/workspaces/{id}/workflows/source/resources`), creates a workflow from source
 * (`POST /api/v2/workspaces/{id}/workflows/source`: dry run, create, name conflict on a create and
 * on its dry run, refusal) and applies to the new workflow with the lock the create returned. The
 * app must have the `workflow-code` flag on. The script seeds its own owner, workspace and
 * personal API key (graph writes refuse workspace keys) in the app's disposable database and
 * removes them when it finishes.
 *
 * The refusals are driven against the same app with fixtures seeded in its disposable database: a
 * locked workflow (423), an oversized body (413 in the v2 envelope), a personal key of a user
 * outside the workspace (404, concealed), a create into a missing folder (404, no folder made) and
 * into a locked one (423), and a create with a workspace key or a read-only member's key (403).
 *
 * The `workflow-code` flag cannot be turned off between a get and an apply here: off AppConfig it
 * is the app process's `WORKFLOW_CODE` environment, read when the app starts, and this script runs
 * outside that process. The flag-off apply is proven in `apply-workflow-source.integration.ts`.
 *
 *   WORKFLOW_SOURCE_APPLY_E2E_BASE_URL=http://127.0.0.1:3000 \
 *   WORKFLOW_SOURCE_APPLY_E2E_DATABASE_URL=postgres://…/sim_test \
 *   WORKFLOW_SOURCE_APPLY_E2E_REPORT_PATH=/tmp/workflow-source-apply-report.json \
 *   bun run test:workflow-source-apply:e2e
 */
const logger = createLogger('WorkflowSourceApplyE2E')

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

const baseUrl = new URL(requiredEnvironment('WORKFLOW_SOURCE_APPLY_E2E_BASE_URL'))
const reportPath = requiredEnvironment('WORKFLOW_SOURCE_APPLY_E2E_REPORT_PATH')
const databaseUrl = assertDisposableTestDatabaseUrl(
  requiredEnvironment('WORKFLOW_SOURCE_APPLY_E2E_DATABASE_URL')
)
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
assert(loopbackHosts.has(baseUrl.hostname), 'The app must use a loopback host')
assert.equal(baseUrl.protocol, 'http:', 'The app must use local HTTP')
assert.equal(baseUrl.pathname, '/', 'App URL must be an origin without a path')

const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const httpLog: { method: string; path: string; status: number }[] = []
const startedAt = new Date().toISOString()
const SCORE_CODE = 'return 40 + 2'
const sql = postgres(databaseUrl.toString(), { max: 2 })
const ownerId = generateId()
const workspaceId = generateId()
/** The workflows' author: an admin of the seeded workspace, calling with a personal key. */
const ownerKey = `sk-sim-fixture-${generateId()}`

/** Disposable callers seeded for the refusal checks. */
const fixtures = {
  readerId: generateId(),
  outsiderId: generateId(),
  readerKey: `sk-sim-fixture-${generateId()}`,
  outsiderKey: `sk-sim-fixture-${generateId()}`,
  workspaceKey: `sk-sim-fixture-${generateId()}`,
  lockedFolderId: generateId(),
  lockedFolderName: `Locked source e2e ${generateId().slice(0, 8)}`,
}

type Json = Record<string, unknown>

function record(value: unknown): Json {
  assert(isRecordLike(value), 'Expected a JSON object')
  return value
}

async function request(method: string, path: string, body?: unknown, expected = 200) {
  return requestAs(ownerKey, method, path, body, expected)
}

async function requestAs(
  key: string,
  method: string,
  path: string,
  body?: unknown,
  expected = 200
) {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      'x-api-key': key,
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
    checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) })
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
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
    base: record(source.base),
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
    base: source.base,
    provenance: { client: 'api' },
  }
}

function errorCode(body: Json): unknown {
  return record(body.error).code
}

async function workflowCountNamed(name: string): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count from workflow
    where workspace_id = ${workspaceId} and name = ${name} and archived_at is null`
  return row.count
}

async function seedFixtures() {
  await sql.begin(async (tx) => {
    for (const id of [ownerId, fixtures.readerId, fixtures.outsiderId]) {
      const email = `${id}@workflow-source-apply.test`
      await tx`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
        values (${id}, 'Workflow source apply fixture', ${email}, ${email}, true, now(), now())`
      await tx`insert into user_stats (id, user_id) values (${generateId()}, ${id})`
    }
    await tx`insert into project (id, name, owner_id) values (${workspaceId}, 'Workflow source apply project', ${ownerId})`
    await tx`insert into workspace (id, project_id, name, owner_id, billed_account_user_id)
      values (${workspaceId}, ${workspaceId}, 'Workflow source apply fixture', ${ownerId}, ${ownerId})`
    await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type)
      values (${generateId()}, ${ownerId}, 'workspace', ${workspaceId}, 'admin')`
    await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type)
      values (${generateId()}, ${fixtures.readerId}, 'workspace', ${workspaceId}, 'read')`
    for (const [userId, key] of [
      [ownerId, ownerKey],
      [fixtures.readerId, fixtures.readerKey],
      [fixtures.outsiderId, fixtures.outsiderKey],
    ]) {
      await tx`insert into api_key (id, user_id, name, key, key_hash, type)
        values (${generateId()}, ${userId}, 'Workflow source apply fixture', ${key}, ${sha256Hex(key)}, 'personal')`
    }
    await tx`insert into api_key (id, user_id, workspace_id, name, key, key_hash, type)
      values (${generateId()}, ${fixtures.readerId}, ${workspaceId}, 'Workflow source apply fixture',
        ${fixtures.workspaceKey}, ${sha256Hex(fixtures.workspaceKey)}, 'workspace')`
    await tx`insert into folder (id, resource_type, name, user_id, workspace_id, locked)
      values (${fixtures.lockedFolderId}, 'workflow', ${fixtures.lockedFolderName}, ${fixtures.readerId},
        ${workspaceId}, true)`
  })
}

/**
 * Deleting the workspace cascades to its workflows, folders and workspace keys; deleting the users
 * cascades to their personal keys, permissions and stats.
 */
async function removeFixtures() {
  await sql.begin(async (tx) => {
    await tx`delete from workspace where id = ${workspaceId}`
    await tx`delete from project where id = ${workspaceId}`
  })
  await sql`delete from "user" where id in (${ownerId}, ${fixtures.readerId}, ${fixtures.outsiderId})`
}

async function main() {
  try {
    await seedFixtures()
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
      assert.equal(record(result.base).fingerprint, source.base.fingerprint)
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
      assert.equal(reread.base.fingerprint, record(result.base).fingerprint)
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

    await check('the resource manifest lists this workflow by a key that stays put', async () => {
      const first = record(
        (await request('GET', `/api/v2/workspaces/${workspaceId}/workflows/source/resources`)).data
      )
      const entry = (first.workflows as unknown[]).map(record).find((w) => w.id === workflowId)
      assert(entry, 'the manifest lists the workflow')
      assert.match(String(entry.key), /^[a-z][a-z0-9_-]{0,63}$/)
      for (const kind of ['tables', 'knowledgeBases', 'credentials', 'env']) {
        assert(Array.isArray(first[kind]), `${kind} is a list`)
      }
      const second = record(
        (await request('GET', `/api/v2/workspaces/${workspaceId}/workflows/source/resources`)).data
      )
      const again = (second.workflows as unknown[]).map(record).find((w) => w.id === workflowId)
      assert.equal(again?.key, entry.key)
    })

    const createPath = `/api/v2/workspaces/${workspaceId}/workflows/source`
    const copyName = `Source create e2e ${generateId().slice(0, 8)}`
    let copy: {
      workflowId: string
      lock: Json
      base: Json
      files: Record<string, string>
    } | null = null

    await check('a dry-run create checks the source and creates nothing', async () => {
      const source = await readSource(workflowId)
      const { data } = await request('POST', `${createPath}?dryRun=true`, {
        files: source.files,
        name: copyName,
      })
      const result = record(data)
      assert.equal(result.applied, false)
      assert.equal(result.dryRun, true)
      await request('GET', `/api/v2/workflows/${String(result.workflowId)}/source`, undefined, 404)
    })

    await check('creating from source writes a new workflow with fresh ids', async () => {
      const source = await readSource(workflowId)
      const { data } = await request('POST', createPath, {
        files: source.files,
        name: copyName,
        provenance: { client: 'api' },
      })
      const result = record(data)
      assert.equal(result.applied, true)
      const newId = String(result.workflowId)
      assert.notEqual(newId, workflowId)
      copy = {
        workflowId: newId,
        lock: record(result.lock),
        base: record(result.base),
        files: record(result.files) as Record<string, string>,
      }
      const blocks = await storedBlocks(newId)
      assert.equal(Object.keys(blocks).length, Object.keys(await storedBlocks(workflowId)).length)
      assert(!(scoreId in blocks), 'the new workflow mints its own block ids')
      const reread = await readSource(newId)
      assert.equal(reread.base.fingerprint, record(result.base).fingerprint)
    })

    await check(
      'the created workflow takes an apply with the lock the create returned',
      async () => {
        assert(copy, 'the create check must run first')
        const { data } = await request('POST', `/api/v2/workflows/${copy.workflowId}/source`, {
          files: edit(copy.files, 'return 7', 'return 8'),
          lock: copy.lock,
          base: copy.base,
        })
        assert.equal(record(data).applied, true)
        const blocks = Object.values(await storedBlocks(copy.workflowId))
        const score = blocks.find((block) => block.name === 'Score')
        assert.equal(record(record(score?.subBlocks).code).value, 'return 8')
      }
    )

    await check(
      'creating under a name the folder already holds answers 409 SOURCE_NAME_TAKEN',
      async () => {
        const source = await readSource(workflowId)
        const body = await request('POST', createPath, { files: source.files, name: copyName }, 409)
        assert.deepEqual(record(body.error).details, { code: 'SOURCE_NAME_TAKEN', name: copyName })
      }
    )

    await check('a dry-run create under a taken name answers the same 409', async () => {
      const source = await readSource(workflowId)
      const body = await request(
        'POST',
        `${createPath}?dryRun=true`,
        { files: source.files, name: copyName },
        409
      )
      assert.equal(record(record(body.error).details).code, 'SOURCE_NAME_TAKEN')
      assert.equal(await workflowCountNamed(copyName), 1)
    })

    await check('broken source creates nothing and answers a line-pinned 400', async () => {
      const body = await request(
        'POST',
        createPath,
        { files: { 'workflow.ts': '// @sim-sdk 1\nconst = \n' }, name: `${copyName} broken` },
        400
      )
      assert.equal(record(record(body.error).details).code, 'SOURCE_REJECTED')
    })

    const applyPath = `/api/v2/workflows/${workflowId}/source`

    await check('an apply to a locked workflow answers 423 and writes nothing', async () => {
      const source = await readSource(workflowId)
      const before = await storedBlocks(workflowId)
      await sql`update workflow set locked = true where id = ${workflowId}`
      try {
        const body = await request(
          'POST',
          applyPath,
          applyBody(source, edit(source.files, 'return 7', 'return 70')),
          423
        )
        assert.equal(errorCode(body), 'LOCKED')
      } finally {
        await sql`update workflow set locked = false where id = ${workflowId}`
      }
      assert.deepEqual(await storedBlocks(workflowId), before)
    })

    await check('a body over the source route cap answers 413 in the v2 envelope', async () => {
      const source = await readSource(workflowId)
      const oversized = `${source.files['workflow.ts']}\n// ${'x'.repeat(10 * 1024 * 1024)}\n`
      const body = await request(
        'POST',
        applyPath,
        applyBody(source, { ...source.files, 'workflow.ts': oversized }),
        413
      )
      assert.equal(errorCode(body), 'PAYLOAD_TOO_LARGE')
    })

    await check('an apply with a key outside the workspace is answered 404', async () => {
      const source = await readSource(workflowId)
      const before = await storedBlocks(workflowId)
      const body = await requestAs(
        fixtures.outsiderKey,
        'POST',
        applyPath,
        applyBody(source, edit(source.files, 'return 7', 'return 71')),
        404
      )
      assert.equal(errorCode(body), 'NOT_FOUND')
      assert.deepEqual(await storedBlocks(workflowId), before)
    })

    await check('a create into a missing folder answers 404 and creates no folder', async () => {
      const source = await readSource(workflowId)
      const folderName = `Missing source e2e ${generateId().slice(0, 8)}`
      const name = `${copyName} missing folder`
      const body = await request(
        'POST',
        createPath,
        { files: source.files, name, folderPath: `/${encodeURIComponent(folderName)}` },
        404
      )
      assert.equal(errorCode(body), 'NOT_FOUND')
      assert.match(String(record(body.error).message), /Folder not found/)
      const [folders] = await sql<{ count: number }[]>`
        select count(*)::int as count from folder
        where workspace_id = ${workspaceId} and name = ${folderName}`
      assert.equal(folders.count, 0)
      assert.equal(await workflowCountNamed(name), 0)
    })

    await check('a create into a locked folder answers 423 and creates nothing', async () => {
      const source = await readSource(workflowId)
      const name = `${copyName} locked folder`
      const body = await request(
        'POST',
        createPath,
        {
          files: source.files,
          name,
          folderPath: `/${encodeURIComponent(fixtures.lockedFolderName)}`,
        },
        423
      )
      assert.equal(errorCode(body), 'LOCKED')
      assert.equal(await workflowCountNamed(name), 0)
    })

    await check('a create with a workspace key or a read-only member key answers 403', async () => {
      const source = await readSource(workflowId)
      const name = `${copyName} denied`
      for (const key of [fixtures.workspaceKey, fixtures.readerKey]) {
        const body = await requestAs(key, 'POST', createPath, { files: source.files, name }, 403)
        assert.equal(errorCode(body), 'FORBIDDEN')
      }
      assert.equal(await workflowCountNamed(name), 0)
    })
  } finally {
    await check('remove disposable fixtures', removeFixtures)
  }
}

main()
  .catch((error: unknown) => {
    checks.push({ name: 'setup', status: 'failed', durationMs: 0, error: getErrorMessage(error) })
  })
  .finally(async () => {
    await sql.end()
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
