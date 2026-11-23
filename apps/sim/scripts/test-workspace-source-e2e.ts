import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import postgres from 'postgres'

/**
 * Workspace source end to end: the real CLI (`sim workspaces source get|apply`) against a running
 * local app and a disposable database. It reads an empty workspace into a directory, declares a
 * table and a workflow that writes to it, applies both in one run, proves a re-apply changes
 * nothing and a fresh get reproduces the directory byte for byte, refuses dropping a column with
 * data without `--allow-delete` (and drops it with it), exits 5 on an edit to a table the server
 * changed, uploads a workspace file then deletes it once it is removed from the directory, and
 * round-trips a knowledge base with one document: created by an apply, re-applied as a no-op,
 * downloaded byte for byte by a fresh get (the document content route and the CLI's hash check),
 * and replaced when the document is edited. The app must run with the `workflow-code` flag on and
 * an embedding model configured for knowledge bases.
 *
 *   WORKSPACE_SOURCE_E2E_BASE_URL=http://127.0.0.1:3000 \
 *   WORKSPACE_SOURCE_E2E_DATABASE_URL=postgres://…/sim_test \
 *   WORKSPACE_SOURCE_E2E_REPORT_PATH=/tmp/workspace-source-report.json \
 *   bun run test:workspace-source:e2e
 */
const logger = createLogger('WorkspaceSourceE2E')
const CLI_ENTRY = resolve(import.meta.dirname, '../../../packages/sim-cli/src/index.ts')
const startedAt = new Date().toISOString()

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

const baseUrl = new URL(requiredEnvironment('WORKSPACE_SOURCE_E2E_BASE_URL'))
const databaseUrl = assertDisposableTestDatabaseUrl(
  requiredEnvironment('WORKSPACE_SOURCE_E2E_DATABASE_URL')
)
const reportPath = requiredEnvironment('WORKSPACE_SOURCE_E2E_REPORT_PATH')
assert(new Set(['localhost', '127.0.0.1', '[::1]']).has(baseUrl.hostname), 'Use a loopback app')
assert.equal(baseUrl.protocol, 'http:', 'Use a local HTTP app')

const sql = postgres(databaseUrl.toString(), { max: 2 })
const ownerId = generateId()
const workspaceId = generateId()
const apiKey = `sk-sim-fixture-${generateId()}`
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const runs: { argv: string[]; status: number | null; durationMs: number }[] = []

const LEADS = `// @sim-sdk 1
import { column, defineTable } from '@sim/workflow-sdk/workspace'

export default defineTable({
  name: 'leads',
  columns: {
    email: column.string({ required: true }),
    status: column.select({ options: ['new', 'won'] }),
  },
})
`

const INGEST = `// @sim-sdk 1
import { table, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Ingest', {}, () => {
  const start = trigger.start('Start', { inputFormat: { email: 'string' } })
  const save = table.insertRow('Save Lead', {
    tableId: table('leads'),
    data: { email: start.email },
  })

  start.to(save)
})
`

const HANDBOOK = `// @sim-sdk 1
import { defineKnowledgeBase } from '@sim/workflow-sdk/workspace'

export default defineKnowledgeBase({
  name: 'handbook',
})
`

/** The live documents of the `handbook` knowledge base, by file name. */
async function handbookDocuments() {
  return sql<{ id: string; filename: string }[]>`
    select d.id, d.filename from document d
    join knowledge_base kb on kb.id = d.knowledge_base_id
    where kb.workspace_id = ${workspaceId} and kb.name = 'handbook' and kb.deleted_at is null
      and d.deleted_at is null and d.archived_at is null`
}

/** Runs the CLI from source with the fixture key; returns its exit status and parsed output. */
function sim(configDir: string, ...argv: string[]) {
  const started = performance.now()
  const result = spawnSync(process.execPath, [CLI_ENTRY, ...argv], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SIM_ENDPOINT: baseUrl.origin,
      SIM_API_KEY: apiKey,
      SIM_WORKSPACE: workspaceId,
      SIM_OUTPUT: 'json',
      SIM_CONFIG_DIR: configDir,
      SIM_TELEMETRY_DISABLED: '1',
    },
    timeout: 600_000,
  })
  runs.push({ argv, status: result.status, durationMs: performance.now() - started })
  let output: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(result.stdout)
    if (isRecordLike(parsed)) output = parsed
  } catch {}
  return { status: result.status, output, stderr: result.stderr }
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

async function tableRow() {
  const [row] = await sql<
    { id: string; schema: { columns: Array<{ id: string; name: string }> } }[]
  >`
    select id, schema from user_table_definitions
    where workspace_id = ${workspaceId} and name = 'leads' and archived_at is null`
  return row
}

/** Whether a fresh `get --only file` into `into` writes `files/<name>`. */
async function serverHoldsFile(configDir: string, into: string, name: string): Promise<boolean> {
  await rm(into, { recursive: true, force: true })
  const read = sim(configDir, 'workspaces', 'source', 'get', '--dir', into, '--only', 'file')
  assert.equal(read.status, 0, read.stderr)
  return access(join(into, 'files', name)).then(
    () => true,
    () => false
  )
}

async function seedFixtures() {
  const email = `${ownerId}@workspace-source.test`
  await sql.begin(async (tx) => {
    await tx`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
      values (${ownerId}, 'Workspace source fixture', ${email}, ${email}, true, now(), now())`
    await tx`insert into user_stats (id, user_id) values (${generateId()}, ${ownerId})`
    await tx`insert into project (id, name, owner_id) values (${workspaceId}, 'Workspace source project', ${ownerId})`
    await tx`insert into workspace (id, project_id, name, owner_id, billed_account_user_id)
      values (${workspaceId}, ${workspaceId}, 'Workspace source fixture', ${ownerId}, ${ownerId})`
    await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type)
      values (${generateId()}, ${ownerId}, 'workspace', ${workspaceId}, 'admin')`
    await tx`insert into api_key (id, user_id, name, key, key_hash, type)
      values (${generateId()}, ${ownerId}, 'Workspace source fixture', ${apiKey}, ${sha256Hex(apiKey)}, 'personal')`
  })
}

async function removeFixtures() {
  await sql.begin(async (tx) => {
    await tx`delete from workspace where id = ${workspaceId}`
    await tx`delete from project where id = ${workspaceId}`
    await tx`delete from "user" where id = ${ownerId}`
  })
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), 'sim-workspace-source-e2e-'))
  const config = join(root, 'config')
  const dir = join(root, 'a')
  const fresh = join(root, 'b')
  const filesDir = join(root, 'files')
  const filesCheck = join(root, 'files-check')
  const kbDir = join(root, 'knowledge')
  const kbFresh = join(root, 'knowledge-check')
  await seedFixtures()
  try {
    await check(
      'get writes an empty workspace as a directory that manages tables and workflows',
      async () => {
        const read = sim(
          config,
          'workspaces',
          'source',
          'get',
          '--dir',
          dir,
          '--only',
          'table,workflow'
        )
        assert.equal(read.status, 0, read.stderr)
        const base = JSON.parse(await readFile(join(dir, '.sim/base.json'), 'utf8'))
        assert.equal(base.workspaceId, workspaceId)
        await readFile(join(dir, 'tables/.gitkeep'), 'utf8')
      }
    )

    await check('one apply creates the table and the workflow that writes to it', async () => {
      await mkdir(join(dir, 'workflows/ingest'), { recursive: true })
      await writeFile(join(dir, 'tables/leads.ts'), LEADS)
      await writeFile(join(dir, 'workflows/ingest/workflow.ts'), INGEST)
      const applied = sim(config, 'workspaces', 'source', 'apply', '--dir', dir, '--yes')
      assert.equal(applied.status, 0, applied.stderr)
      const table = await tableRow()
      assert(table, 'the leads table exists')
      const [block] = await sql<{ value: string }[]>`
        select b.sub_blocks->'tableSelector'->>'value' as value from workflow_blocks b
        join workflow w on w.id = b.workflow_id
        where w.workspace_id = ${workspaceId} and b.sub_blocks ? 'tableSelector'`
      assert.equal(block?.value, table.id)
    })

    await check('a re-apply changes nothing and a fresh get reproduces the directory', async () => {
      const again = sim(config, 'workspaces', 'source', 'apply', '--dir', dir, '--dry-run')
      assert.equal(again.status, 0, again.stderr)
      assert.equal(again.output.unchanged, 2)
      const read = sim(
        config,
        'workspaces',
        'source',
        'get',
        '--dir',
        fresh,
        '--only',
        'table,workflow'
      )
      assert.equal(read.status, 0, read.stderr)
      for (const path of ['tables/leads.ts', 'workflows/ingest/workflow.ts', '.sim/base.json']) {
        assert.equal(
          await readFile(join(fresh, path), 'utf8'),
          await readFile(join(dir, path), 'utf8'),
          `${path} matches`
        )
      }
    })

    await check('dropping a column with data needs --allow-delete', async () => {
      const table = await tableRow()
      const byName = new Map(table.schema.columns.map((column) => [column.name, column.id]))
      await sql`insert into user_table_rows (id, table_id, workspace_id, data, position)
        values (${generateId()}, ${table.id}, ${workspaceId},
          ${sql.json({ [byName.get('email') ?? '']: 'a@b.c', [byName.get('status') ?? '']: 'x' })}, 0)`
      const text = await readFile(join(dir, 'tables/leads.ts'), 'utf8')
      await writeFile(join(dir, 'tables/leads.ts'), text.replace(/\n {4}status: .*\n/, '\n'))
      const refused = sim(config, 'workspaces', 'source', 'apply', '--dir', dir, '--yes')
      assert.equal(refused.status, 1, refused.stderr)
      assert.match(refused.stderr, /E_APPLY_DELETE_NOT_ALLOWED/)
      assert.equal((await tableRow()).schema.columns.length, 2)
      const dropped = sim(
        config,
        'workspaces',
        'source',
        'apply',
        '--dir',
        dir,
        '--yes',
        '--allow-delete'
      )
      assert.equal(dropped.status, 0, dropped.stderr)
      assert.deepEqual(
        (await tableRow()).schema.columns.map((column) => column.name),
        ['email']
      )
    })

    await check('an edit to a table the server changed exits 5 and writes nothing', async () => {
      await sql`update user_table_definitions set description = 'Edited in the UI', updated_at = now()
        where workspace_id = ${workspaceId} and name = 'leads'`
      const text = await readFile(join(dir, 'tables/leads.ts'), 'utf8')
      await writeFile(
        join(dir, 'tables/leads.ts'),
        text.replace("name: 'leads',", "name: 'leads',\n  description: 'Mine',")
      )
      const stale = sim(config, 'workspaces', 'source', 'apply', '--dir', dir, '--yes')
      assert.equal(stale.status, 5, stale.stderr)
      const [row] = await sql<{ description: string }[]>`
        select description from user_table_definitions
        where workspace_id = ${workspaceId} and name = 'leads'`
      assert.equal(row.description, 'Edited in the UI')
    })

    await check('an uploaded file is deleted once removed from the directory', async () => {
      const read = sim(config, 'workspaces', 'source', 'get', '--dir', filesDir, '--only', 'file')
      assert.equal(read.status, 0, read.stderr)
      await writeFile(join(filesDir, 'files/notes.txt'), 'hello\n')
      const uploaded = sim(config, 'workspaces', 'source', 'apply', '--dir', filesDir, '--yes')
      assert.equal(uploaded.status, 0, uploaded.stderr)
      assert(await serverHoldsFile(config, filesCheck, 'notes.txt'), 'the file was uploaded')
      await unlink(join(filesDir, 'files/notes.txt'))
      const removed = sim(
        config,
        'workspaces',
        'source',
        'apply',
        '--dir',
        filesDir,
        '--yes',
        '--allow-delete'
      )
      assert.equal(removed.status, 0, removed.stderr)
      assert(!(await serverHoldsFile(config, filesCheck, 'notes.txt')), 'the file was deleted')
    })

    await check(
      'a knowledge base document round-trips: created, re-applied as a no-op, read back byte for byte, replaced',
      async () => {
        const read = sim(
          config,
          'workspaces',
          'source',
          'get',
          '--dir',
          kbDir,
          '--only',
          'knowledge-base'
        )
        assert.equal(read.status, 0, read.stderr)
        const intro = '# Intro\n\nWelcome to the team.\n'
        await mkdir(join(kbDir, 'knowledge/handbook/docs'), { recursive: true })
        await writeFile(join(kbDir, 'knowledge/handbook/knowledge.ts'), HANDBOOK)
        await writeFile(join(kbDir, 'knowledge/handbook/docs/intro.md'), intro)
        const created = sim(config, 'workspaces', 'source', 'apply', '--dir', kbDir, '--yes')
        assert.equal(created.status, 0, created.stderr)
        const [document] = await handbookDocuments()
        assert.equal(document?.filename, 'intro.md')

        const again = sim(config, 'workspaces', 'source', 'apply', '--dir', kbDir, '--dry-run')
        assert.equal(again.status, 0, again.stderr)
        assert.equal(again.output.unchanged, 1)

        await rm(kbFresh, { recursive: true, force: true })
        const fresh = sim(
          config,
          'workspaces',
          'source',
          'get',
          '--dir',
          kbFresh,
          '--only',
          'knowledge-base'
        )
        assert.equal(fresh.status, 0, fresh.stderr)
        assert.equal(
          await readFile(join(kbFresh, 'knowledge/handbook/docs/intro.md'), 'utf8'),
          intro
        )

        await writeFile(join(kbDir, 'knowledge/handbook/docs/intro.md'), `${intro}Edited.\n`)
        const replaced = sim(config, 'workspaces', 'source', 'apply', '--dir', kbDir, '--yes')
        assert.equal(replaced.status, 0, replaced.stderr)
        assert.equal(replaced.output.updated, 1)
        const after = await handbookDocuments()
        assert.deepEqual(
          after.map((entry) => entry.filename),
          ['intro.md']
        )
        assert.notEqual(after[0].id, document.id, 'the edited document replaced the old one')
      }
    )
  } finally {
    await check('remove disposable fixtures', removeFixtures)
    await rm(root, { recursive: true, force: true })
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
      JSON.stringify({ suite: 'workspace-source', startedAt, checks, runs }, null, 2)
    )
    const failed = checks.filter((entry) => entry.status === 'failed')
    logger.info('Workspace source e2e finished', {
      passed: checks.length - failed.length,
      failed: failed.length,
    })
    if (failed.length > 0) process.exitCode = 1
  })
