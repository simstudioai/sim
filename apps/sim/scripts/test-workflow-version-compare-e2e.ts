import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId, generateShortId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { hashPassword, makeSignature } from 'better-auth/crypto'
import postgres from 'postgres'
import {
  deployedWorkflowStateSchema,
  getDeploymentVersionStateContract,
} from '@/lib/api/contracts/deployments'
import {
  v2CompareWorkflowVersionsContract,
  v2GetWorkflowVersionContract,
} from '@/lib/api/contracts/v2/workflows'
import {
  type CompareWorkflowVersionsData,
  compareWorkflowVersionsDataSchema,
} from '@/lib/api/contracts/workflow-comparison'
import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import { generateWorkflowDiffSummary } from '@/lib/workflows/comparison/compare'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/** Exercises a running local Next app, real credentials, CLI and MCP against a disposable database. */
const logger = createLogger('WorkflowVersionCompareE2E')
const execFileAsync = promisify(execFile)
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 60_000
const startedAt = new Date().toISOString()

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

const baseUrl = new URL(requiredEnvironment('VERSION_COMPARE_E2E_BASE_URL'))
const databaseUrl = assertDisposableTestDatabaseUrl(
  requiredEnvironment('VERSION_COMPARE_E2E_DATABASE_URL')
)
const authSecret = requiredEnvironment('VERSION_COMPARE_E2E_AUTH_SECRET')
const reportPath = requiredEnvironment('VERSION_COMPARE_E2E_REPORT_PATH')
const keepFixtures = process.env.VERSION_COMPARE_E2E_KEEP_FIXTURES === 'true'
const browserFixturesPath = process.env.VERSION_COMPARE_E2E_BROWSER_FIXTURES_PATH
const browserPassword = keepFixtures
  ? requiredEnvironment('VERSION_COMPARE_E2E_BROWSER_PASSWORD')
  : undefined
assert(!browserFixturesPath || keepFixtures, 'Browser fixtures require KEEP_FIXTURES=true')
assert(
  !browserPassword || browserPassword.length >= 12,
  'Use a fixture password of at least 12 characters'
)
assert(new Set(['localhost', '127.0.0.1', '[::1]']).has(baseUrl.hostname), 'Use a loopback app')
assert.equal(baseUrl.protocol, 'http:', 'Use a local HTTP app')
assert(!baseUrl.username && !baseUrl.password, 'App URL cannot contain credentials')
assert.equal(baseUrl.pathname, '/', 'App URL must be an origin')
assert(!baseUrl.search && !baseUrl.hash, 'App URL cannot contain a query or fragment')
assert(authSecret.length >= 32, 'Use a local Better Auth secret of at least 32 characters')

const sql = postgres(databaseUrl.toString(), { max: 2 })
const ownerId = generateId()
const outsiderId = generateId()
const workspaceId = generateId()
const foreignWorkspaceId = generateId()
const workflowId = generateId()
const workspaceKey = `sk-sim-fixture-${generateId()}`
const foreignKey = `sk-sim-fixture-${generateId()}`
const sessionToken = generateShortId()
const outsiderToken = generateShortId()
const secretBase = `synthetic-inline-secret-${generateShortId()}`
const secretTarget = `synthetic-inline-secret-${generateShortId()}`
const cliPath = fileURLToPath(new URL('../../../packages/sim-cli/src/index.ts', import.meta.url))
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const requests: { method: string; path: string; status: number; durationMs: number }[] = []
const browserWorkflows: {
  id: string
  name: string
  url: string
  expectedChecks: unknown
  browserReferences: unknown
}[] = []
let directory: string | undefined
let cookie: string
let outsiderCookie: string

function failureMessage(error: unknown): string {
  let message = getErrorMessage(error)
  for (const secret of [
    workspaceKey,
    foreignKey,
    sessionToken,
    outsiderToken,
    secretBase,
    secretTarget,
    authSecret,
    ...(browserPassword ? [browserPassword] : []),
  ]) {
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

function record(value: unknown): Record<string, unknown> {
  assert(isRecordLike(value), 'Expected a JSON object')
  return value
}

function state(legacy: boolean, changed: boolean): WorkflowState {
  const selector = legacy ? 'knowledgeBaseId' : 'knowledgeBaseSelector'
  return {
    blocks: {
      knowledge: {
        id: 'knowledge',
        type: 'knowledge',
        name: 'Knowledge',
        enabled: true,
        position: { x: 0, y: 0 },
        outputs: {},
        subBlocks: {
          [selector]: {
            id: selector,
            type: 'knowledge-base-selector',
            value: changed ? 'kb-replacement' : 'kb-original',
          },
        },
      },
      decision: {
        id: 'decision',
        type: 'condition',
        name: 'Decision',
        enabled: true,
        position: { x: 300, y: 0 },
        outputs: {},
        subBlocks: {},
      },
      fn: {
        id: 'fn',
        type: 'function',
        name: 'Action',
        enabled: true,
        position: { x: 600, y: 0 },
        outputs: {},
        subBlocks: { code: { id: 'code', type: 'code', value: changed ? 'return 2' : 'return 1' } },
      },
      convex: {
        id: 'convex',
        type: 'convex',
        name: 'Action',
        enabled: true,
        position: { x: 900, y: 0 },
        outputs: {},
        subBlocks: {
          deployKey: {
            id: 'deployKey',
            type: 'short-input',
            value: changed ? secretTarget : secretBase,
          },
        },
      },
    },
    edges: [
      {
        id: 'branch',
        source: 'decision',
        target: 'fn',
        sourceHandle: changed ? 'condition-else' : 'condition-if',
        targetHandle: 'target',
      },
    ],
    loops: {},
    parallels: {},
    variables: {},
    lastSaved: 0,
  }
}

const snapshots = [state(true, false), state(false, false), state(false, true)]

async function seed() {
  directory = await mkdtemp(resolve(tmpdir(), 'sim-version-compare-'))
  await sql.begin(async (tx) => {
    for (const id of [ownerId, outsiderId]) {
      const email = `${id}@version-compare.test`
      await tx`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
        values (${id}, 'Version comparison fixture', ${email}, ${email}, true, now(), now())`
      await tx`insert into user_stats (id, user_id) values (${generateId()}, ${id})`
    }
    if (browserPassword) {
      const password = await hashPassword(browserPassword)
      await tx`insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at)
        values (${generateId()}, ${ownerId}, 'credential', ${ownerId}, ${password}, now(), now())`
    }
    for (const id of [workspaceId, foreignWorkspaceId]) {
      await tx`insert into workspace (id, name, owner_id, billed_account_user_id)
        values (${id}, 'Version comparison fixture', ${ownerId}, ${ownerId})`
    }
    await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type)
      values (${generateId()}, ${ownerId}, 'workspace', ${workspaceId}, 'admin')`
    for (const [id, token] of [
      [ownerId, sessionToken],
      [outsiderId, outsiderToken],
    ]) {
      await tx`insert into session (id, token, user_id, expires_at, created_at, updated_at)
        values (${generateId()}, ${token}, ${id}, now() + interval '1 hour', now(), now())`
    }
    for (const [id, key] of [
      [workspaceId, workspaceKey],
      [foreignWorkspaceId, foreignKey],
    ]) {
      await tx`insert into api_key (id, user_id, workspace_id, name, key, key_hash, type)
        values (${generateId()}, ${ownerId}, ${id}, 'Version comparison fixture', ${key}, ${sha256Hex(key)}, 'workspace')`
    }
    await tx`insert into workflow (id, user_id, workspace_id, name, last_synced, created_at, updated_at)
      values (${workflowId}, ${ownerId}, ${workspaceId}, 'Version comparison fixture', now(), now(), now())`
    for (const [index, snapshot] of snapshots.entries()) {
      await tx`insert into workflow_deployment_version (id, workflow_id, version, state)
        values (${generateId()}, ${workflowId}, ${index + 1}, ${JSON.stringify(snapshot)}::text::json)`
    }
    const oversized = state(false, false)
    oversized.blocks.fn.subBlocks.code.value = 'x'.repeat(17 * 1024 * 1024)
    await tx`insert into workflow_deployment_version (id, workflow_id, version, state)
      values (${generateId()}, ${workflowId}, 4, ${JSON.stringify(oversized)}::text::json)`
  })
  cookie = encodeURIComponent(`${sessionToken}.${await makeSignature(sessionToken, authSecret)}`)
  outsiderCookie = encodeURIComponent(
    `${outsiderToken}.${await makeSignature(outsiderToken, authSecret)}`
  )
}

async function seedBrowserWorkflows() {
  if (!browserFixturesPath) return
  assert(
    (await stat(browserFixturesPath)).size <= MAX_RESPONSE_BYTES,
    'Browser fixture file exceeds 2 MiB'
  )
  const fixtures = record(JSON.parse(await readFile(browserFixturesPath, 'utf8')))
  assert(
    Array.isArray(fixtures.scenarios) && fixtures.scenarios.length <= 10,
    'Supply at most ten browser scenarios'
  )
  for (const entry of fixtures.scenarios) {
    const scenario = record(entry)
    assert(typeof scenario.name === 'string', 'Browser scenario needs a name')
    const name = scenario.name
    const base = deployedWorkflowStateSchema.parse(scenario.base)
    const target = deployedWorkflowStateSchema.parse(scenario.target)
    const id = generateId()
    await sql.begin(async (tx) => {
      await tx`insert into workflow (id, user_id, workspace_id, name, last_synced, created_at, updated_at, is_deployed, deployed_at, variables)
        values (${id}, ${ownerId}, ${workspaceId}, ${name}, now(), now(), now(), true, now(), ${JSON.stringify(target.variables ?? {})}::text::json)`
      for (const [index, snapshot] of [base, target].entries()) {
        await tx`insert into workflow_deployment_version (id, workflow_id, version, state, is_active, created_by)
          values (${generateId()}, ${id}, ${index + 1}, ${JSON.stringify(snapshot)}::text::json, ${index === 1}, ${ownerId})`
      }
      for (const block of Object.values(target.blocks)) {
        await tx`insert into workflow_blocks (id, workflow_id, type, name, position_x, position_y, enabled, horizontal_handles, advanced_mode, trigger_mode, error_enabled, height, sub_blocks, outputs, data)
          values (${block.id}, ${id}, ${block.type}, ${block.name}, ${block.position.x}, ${block.position.y}, ${block.enabled ?? true}, ${block.horizontalHandles ?? true}, ${block.advancedMode ?? false}, ${block.triggerMode ?? false}, ${block.errorEnabled ?? false}, ${block.height ?? 0}, ${JSON.stringify(block.subBlocks)}::text::jsonb, ${JSON.stringify(block.outputs)}::text::jsonb, ${JSON.stringify(block.data ?? {})}::text::jsonb)`
      }
      for (const edge of target.edges) {
        await tx`insert into workflow_edges (id, workflow_id, source_block_id, target_block_id, source_handle, target_handle)
          values (${edge.id}, ${id}, ${edge.source}, ${edge.target}, ${edge.sourceHandle ?? null}, ${edge.targetHandle ?? null})`
      }
      for (const [kind, subflows] of [
        ['loop', target.loops ?? {}],
        ['parallel', target.parallels ?? {}],
      ] as const) {
        for (const [subflowId, config] of Object.entries(subflows)) {
          await tx`insert into workflow_subflows (id, workflow_id, type, config)
            values (${subflowId}, ${id}, ${kind}, ${JSON.stringify(config)}::text::jsonb)`
        }
      }
    })
    browserWorkflows.push({
      id,
      name,
      url: new URL(`/workspace/${workspaceId}/w/${id}`, baseUrl).toString(),
      expectedChecks: scenario.expectedChecks,
      browserReferences: scenario.browserReferences,
    })
  }
}

async function observedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input)
  assert.equal(
    url.origin,
    baseUrl.origin,
    'E2E requests must remain on the configured loopback app'
  )
  const started = performance.now()
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
  // boundary-raw-fetch: protocol E2E exercises a separately running local app over real HTTP
  const response = await fetch(input, {
    ...init,
    redirect: 'error',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  requests.push({
    method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
    path: url.pathname,
    status: response.status,
    durationMs: Math.round(performance.now() - started),
  })
  return response
}

async function get(path: string, auth: { key?: string; session?: string } = {}, expected = 200) {
  const headers = new Headers({ accept: 'application/json', 'x-forwarded-for': '127.0.0.1' })
  if (auth.key) headers.set('x-api-key', auth.key)
  if (auth.session) headers.set('cookie', `better-auth.session_token=${auth.session}`)
  const response = await observedFetch(new URL(path, baseUrl), { headers })
  assert.equal(response.status, expected, `${path}: unexpected HTTP status`)
  assert.match(response.headers.get('content-type') ?? '', /application\/json/)
  if (path.startsWith('/api/v2/'))
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
  const text = await readResponseTextWithLimit(response, {
    maxBytes: MAX_RESPONSE_BYTES,
    label: 'Version comparison E2E response',
  })
  return record(JSON.parse(text))
}

const comparisonPath = (base: number, target: number) =>
  `/api/v2/workflows/${workflowId}/versions/compare?base=${base}&target=${target}`
async function comparison(base: number, target: number) {
  return v2CompareWorkflowVersionsContract.response.schema.parse(
    await get(comparisonPath(base, target), { key: workspaceKey })
  ).data
}

async function preview(version: number) {
  return getDeploymentVersionStateContract.response.schema.parse(
    await get(`/api/workflows/${workflowId}/deployments/${version}`, { session: cookie })
  ).deployedState
}

async function runCli() {
  assert(directory, 'CLI fixture directory must exist')
  const { stdout } = await execFileAsync(
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
      'versions',
      'compare',
      workflowId,
      '--base',
      '1',
      '--target',
      '3',
    ],
    {
      cwd: directory,
      env: { ...process.env, SIM_CONFIG_DIR: directory, SIM_API_KEY: workspaceKey, NO_COLOR: '1' },
      timeout: REQUEST_TIMEOUT_MS,
      maxBuffer: MAX_RESPONSE_BYTES,
    }
  )
  return compareWorkflowVersionsDataSchema.parse(JSON.parse(stdout))
}

async function runMcp() {
  const client = new Client({ name: 'version-comparison-e2e', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL('/api/mcp', baseUrl), {
    requestInit: { headers: { 'x-api-key': workspaceKey, 'x-forwarded-for': '127.0.0.1' } },
    fetch: observedFetch,
    reconnectionOptions: {
      initialReconnectionDelay: 100,
      maxReconnectionDelay: 100,
      reconnectionDelayGrowFactor: 1,
      maxRetries: 0,
    },
  })
  try {
    await client.connect(transport)
    const result = await client.callTool({
      name: 'call_read_operation',
      arguments: {
        operation: 'compareWorkflowVersions',
        params: { workflowId },
        query: { base: 1, target: 3 },
      },
    })
    assert.notEqual(result.isError, true, 'MCP comparison must succeed')
    assert(Array.isArray(result.content), 'MCP result must contain content')
    const content = result.content.map(record).find((item) => item.type === 'text')
    assert(content && typeof content.text === 'string', 'MCP comparison must contain JSON text')
    return v2CompareWorkflowVersionsContract.response.schema.parse(JSON.parse(content.text)).data
  } finally {
    await client.close()
  }
}

try {
  await check('seed disposable workspace, versions and credentials', seed)
  if (browserFixturesPath) await check('seed browser scenarios', seedBrowserWorkflows)
  await check(
    'session preview migrates both versions while the public archive stays pinned',
    async () => {
      const base = await preview(1)
      const equivalent = await preview(2)
      assert.equal(generateWorkflowDiffSummary(equivalent, base).hasChanges, false)
      assert.equal((await comparison(1, 2)).diff.hasChanges, false)
      assert.equal(base.blocks.convex.subBlocks.deployKey.value, secretBase)
      const pinned = v2GetWorkflowVersionContract.response.schema.parse(
        await get(`/api/v2/workflows/${workflowId}/versions/1`, { key: workspaceKey })
      ).data
      const blocks = record(record(pinned.state).blocks)
      const subBlocks = record(record(blocks.knowledge).subBlocks)
      assert(
        Object.hasOwn(subBlocks, 'knowledgeBaseId'),
        'Pinned version must retain its archived field'
      )
      assert(
        !Object.hasOwn(subBlocks, 'knowledgeBaseSelector'),
        'Pinned version must not be rewritten'
      )
      assert.equal(record(record(record(blocks.convex).subBlocks).deployKey).value, null)
    }
  )

  let expected: CompareWorkflowVersionsData
  await check(
    'v2 comparison preserves direction, exact ports and redacted secret changes',
    async () => {
      expected = await comparison(1, 3)
      const modified = (id: string) =>
        expected.diff.modifiedBlocks.find((block) => block.id === id)?.changes
      assert.deepEqual(modified('knowledge'), [
        {
          scope: 'subblock',
          field: 'knowledgeBaseSelector',
          oldValue: { kind: 'value', value: 'kb-original' },
          newValue: { kind: 'value', value: 'kb-replacement' },
        },
      ])
      assert.deepEqual(modified('fn'), [
        {
          scope: 'subblock',
          field: 'code',
          oldValue: { kind: 'value', value: 'return 1' },
          newValue: { kind: 'value', value: 'return 2' },
        },
      ])
      assert.deepEqual(modified('convex'), [
        {
          scope: 'subblock',
          field: 'deployKey',
          oldValue: { kind: 'redacted' },
          newValue: { kind: 'redacted' },
        },
      ])
      assert.deepEqual(expected.diff.edgeChanges.removedDetails, [
        {
          source: 'decision',
          target: 'fn',
          sourceHandle: 'condition-if',
          targetHandle: 'target',
          sourceName: 'Decision',
          targetName: 'Action',
        },
      ])
      assert.deepEqual(expected.diff.edgeChanges.addedDetails, [
        {
          source: 'decision',
          target: 'fn',
          sourceHandle: 'condition-else',
          targetHandle: 'target',
          sourceName: 'Decision',
          targetName: 'Action',
        },
      ])
      const reverse = await comparison(3, 1)
      assert.deepEqual(
        reverse.diff.edgeChanges.addedDetails,
        expected.diff.edgeChanges.removedDetails
      )
      assert.deepEqual(
        reverse.diff.edgeChanges.removedDetails,
        expected.diff.edgeChanges.addedDetails
      )
      assert(
        !JSON.stringify(expected).includes(secretBase) &&
          !JSON.stringify(expected).includes(secretTarget),
        'Comparison must not expose literal secrets'
      )
    }
  )
  await check('generated CLI executes the same comparison over HTTP', async () => {
    assert.deepEqual(await runCli(), expected)
  })
  await check('generated MCP operation executes the same comparison over HTTP', async () => {
    assert.deepEqual(await runMcp(), expected)
  })
  await check(
    'HTTP auth, concealment, validation and size errors retain their contracts',
    async () => {
      for (const [auth, base, target, status, code] of [
        [{}, 1, 2, 401, 'UNAUTHORIZED'],
        [{ key: foreignKey }, 1, 2, 404, 'NOT_FOUND'],
        [{ key: workspaceKey }, 0, 2, 400, 'BAD_REQUEST'],
        [{ key: workspaceKey }, 1, 99, 404, 'NOT_FOUND'],
        [{ key: workspaceKey }, 1, 4, 413, 'PAYLOAD_TOO_LARGE'],
      ] as const) {
        const body = await get(comparisonPath(base, target), auth, status)
        assert.equal(record(body.error).code, code)
      }
      await get(`/api/workflows/${workflowId}/deployments/1`, { key: workspaceKey }, 401)
      await get(`/api/workflows/${workflowId}/deployments/1`, { session: outsiderCookie }, 404)
    }
  )
  await check('all reads leave archived version payloads unchanged', async () => {
    const rows =
      await sql`select state from workflow_deployment_version where workflow_id = ${workflowId} and version <= 3 order by version`
    assert.equal(rows.length, snapshots.length)
    for (const [index, row] of rows.entries()) assert.deepEqual(row.state, snapshots[index])
  })
} catch (error) {
  logger.error(failureMessage(error))
  process.exitCode = 1
} finally {
  try {
    await check(
      keepFixtures
        ? 'retain disposable database fixtures for browser verification'
        : 'remove disposable fixtures',
      async () => {
        if (!keepFixtures) {
          await sql`delete from workspace where id in (${workspaceId}, ${foreignWorkspaceId})`
          await sql`delete from "user" where id in (${ownerId}, ${outsiderId})`
        }
        if (directory) await rm(directory, { recursive: true, force: true })
      }
    )
  } catch (error) {
    logger.error(failureMessage(error))
    process.exitCode = 1
  } finally {
    await sql.end()
    await writeFile(
      reportPath,
      `${JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), status: process.exitCode ? 'failed' : 'passed', checks, requests, ...(keepFixtures ? { retainedFixtures: { ownerId, outsiderId, workspaceId, foreignWorkspaceId, email: `${ownerId}@version-compare.test`, loginUrl: new URL('/login', baseUrl).toString(), browserWorkflows } } : {}) }, null, 2)}\n`
    )
  }
}
