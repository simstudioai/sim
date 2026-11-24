/**
 * Every write that places a block, against real PostgreSQL, under a `block-visibility` document
 * that kill-switches `api` for everyone but platform admins and one allowlisted user. A caller who
 * cannot see a type cannot add it (source apply, editing operations, state replace), a block
 * already of that type stays editable, and a caller the rule reveals it to adds it. The document
 * goes through the real evaluation and the admin flag through the real user row; only the
 * AppConfig fetch is replaced.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { db } from '@sim/db'
import { member, organization, permissions, user, workflow, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { envFlagsMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import type { BlockState } from '@sim/workflow-types/workflow'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

const { mockFetchProfile } = vi.hoisted(() => ({ mockFetchProfile: vi.fn() }))

vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/core/config/appconfig', () => ({ fetchAppConfigProfile: mockFetchProfile }))
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import { applyWorkflowOperations } from '@/lib/workflows/application/apply-workflow-operations'
import { applyWorkflowSource } from '@/lib/workflows/application/apply-workflow-source'
import { readWorkflowSource } from '@/lib/workflows/application/read-workflow-source'
import { replaceWorkflowState } from '@/lib/workflows/application/replace-workflow-state'
import { WorkflowSourceRejectedError } from '@/lib/workflows/application/source-error'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'

const organizationId = generateId()
const adminId = generateId()
const memberId = generateId()
const revealedId = generateId()
const workspaceId = generateId()
const userIds = [adminId, memberId, revealedId]
const admin = createSessionPrincipal({ userId: adminId, sessionId: generateId() })
const hiddenFrom = createSessionPrincipal({ userId: memberId, sessionId: generateId() })
const revealedTo = createSessionPrincipal({ userId: revealedId, sessionId: generateId() })

type Principal = typeof admin

const VISIBILITY_DOCUMENT = {
  api: { enabled: false, adminEnabled: true, userIds: [revealedId] },
}

const checks: { name: string; status: string; durationMs: number; error?: string }[] = []

function check(name: string, run: () => Promise<void>) {
  it(name, async () => {
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
      throw error
    }
  })
}

function seedBlock(
  type: string,
  name: string,
  subBlocks: Record<string, [type: string, value: unknown]> = {}
): BlockState {
  return {
    id: generateId(),
    type,
    name,
    position: { x: 0, y: 0 },
    subBlocks: Object.fromEntries(
      Object.entries(subBlocks).map(([key, [subType, value]]) => [
        key,
        { id: key, type: subType, value },
      ])
    ) as BlockState['subBlocks'],
    outputs: {},
    enabled: true,
  }
}

function seedApi(url: string): BlockState {
  return seedBlock('api', 'Fetch', {
    url: ['short-input', url],
    method: ['dropdown', 'GET'],
  })
}

/** A workflow whose first block feeds every other block. */
async function seedGraph(blocks: BlockState[]): Promise<string> {
  const workflowId = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id: workflowId,
    userId: adminId,
    workspaceId,
    name: `Block visibility ${workflowId}`,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  const [first, ...rest] = blocks
  const saved = await saveWorkflowToNormalizedTables(workflowId, {
    blocks: Object.fromEntries(blocks.map((block) => [block.id, block])),
    edges: rest.map((block) => ({ id: generateId(), source: first.id, target: block.id })),
    loops: {},
    parallels: {},
  })
  if (!saved.success) throw new Error(`Seeding the workflow failed: ${saved.error}`)
  return workflowId
}

function seedPlainGraph(): Promise<string> {
  return seedGraph([
    seedBlock('start_trigger', 'Start'),
    seedBlock('function', 'Score', { code: ['code', 'return 1'] }),
  ])
}

function getSource(principal: Principal, workflowId: string) {
  return withPermissionGroupScope(() =>
    readWorkflowSource.execute({ principal, input: { workflowId, functionCode: 'inline' } })
  )
}

function applySource(
  principal: Principal,
  source: Awaited<ReturnType<typeof getSource>>,
  files: Record<string, string>
) {
  return withPermissionGroupScope(() =>
    applyWorkflowSource.execute({
      principal,
      input: { workflowId: source.workflowId, files, lock: source.lock, base: source.base },
    })
  )
}

/** The source with a generic `api` block declared just before the workflow body closes. */
function withAddedApi(files: Record<string, string>): Record<string, string> {
  const text = files['workflow.ts'].replace(/import \{ /, 'import { block, ')
  const close = text.lastIndexOf('})')
  expect(close, 'workflow.ts closes its workflow body').toBeGreaterThan(0)
  const added =
    "  block('api', 'Added fetch', { url: 'https://example.com/added', method: 'GET' })\n"
  return { ...files, 'workflow.ts': `${text.slice(0, close)}${added}${text.slice(close)}` }
}

function edit(files: Record<string, string>, from: string, to: string): Record<string, string> {
  const text = files['workflow.ts']
  expect(text.split(from), `workflow.ts holds "${from}" once`).toHaveLength(2)
  return { ...files, 'workflow.ts': text.replace(from, to) }
}

function addApiOperation(principal: Principal, workflowId: string) {
  return withPermissionGroupScope(() =>
    applyWorkflowOperations.execute({
      principal,
      input: {
        workflowId,
        layout: 'none',
        operations: [
          {
            operation_type: 'add',
            block_id: generateId(),
            params: {
              type: 'api',
              name: 'Added fetch',
              inputs: { url: 'https://example.com/added', method: 'GET' },
            },
          },
        ],
      },
    })
  )
}

function replaceState(
  principal: Principal,
  workflowId: string,
  stored: NonNullable<Awaited<ReturnType<typeof loadWorkflowFromNormalizedTables>>>,
  blocks: Record<string, BlockState>
) {
  return withPermissionGroupScope(() =>
    replaceWorkflowState.execute({
      principal,
      input: { workflowId, blocks, edges: stored.edges },
    })
  )
}

async function storedTypes(workflowId: string): Promise<string[]> {
  const stored = await loadWorkflowFromNormalizedTables(workflowId)
  return Object.values(stored?.blocks ?? {}).map((block) => block.type)
}

async function loadStored(workflowId: string) {
  const stored = await loadWorkflowFromNormalizedTables(workflowId)
  if (!stored) throw new Error('The seeded workflow has no stored graph')
  return stored
}

beforeAll(async () => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'workflow-code'
  )
  setEnvFlags({ isAppConfigEnabled: true })
  mockFetchProfile.mockImplementation(
    async (ids: { profile: string }, parse: (doc: unknown) => unknown) =>
      parse(ids.profile === 'block-visibility' ? VISIBILITY_DOCUMENT : {})
  )
  const now = new Date()
  await db.insert(user).values(
    userIds.map((id) => ({
      id,
      name: 'Block visibility fixture',
      email: `${id}@block-visibility.invalid`,
      emailVerified: true,
      role: id === adminId ? 'admin' : 'user',
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db.insert(organization).values({
    id: organizationId,
    name: 'Block visibility fixture',
    slug: organizationId,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(member).values(
    userIds.map((userId) => ({
      id: generateId(),
      userId,
      organizationId,
      role: userId === adminId ? 'owner' : 'member',
      createdAt: now,
    }))
  )
  await insertWorkspaceFixture(db, [
    {
      id: workspaceId,
      name: 'Block visibility fixture',
      ownerId: adminId,
      billedAccountUserId: adminId,
      organizationId,
      workspaceMode: 'organization' as const,
    },
  ])
  await db.insert(permissions).values(
    userIds.map((userId) => ({
      id: generateId(),
      userId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: userId === adminId ? ('admin' as const) : ('write' as const),
    }))
  )
})

afterAll(async () => {
  const reportPath =
    process.env.BLOCK_VISIBILITY_WRITES_REPORT_PATH ??
    resolve('test-results/block-visibility-writes.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  resetEnvFlagsMock()
  await deleteWorkspaceFixture(db, eq(workspace.organizationId, organizationId))
  await db.delete(organization).where(eq(organization.id, organizationId))
  await db.delete(user).where(inArray(user.id, userIds))
})

check('source apply refuses adding a kill-switched type the caller cannot see', async () => {
  const workflowId = await seedPlainGraph()
  const source = await getSource(hiddenFrom, workflowId)
  const before = await loadWorkflowFromNormalizedTables(workflowId)

  const refused = await applySource(hiddenFrom, source, withAddedApi(source.files)).then(
    () => null,
    (error: unknown) => error
  )

  expect(refused).toBeInstanceOf(WorkflowSourceRejectedError)
  expect((refused as WorkflowSourceRejectedError).diagnostics).toContainEqual(
    expect.objectContaining({
      code: 'E_APPLY_BLOCK_NOT_ALLOWED',
      message: expect.stringContaining('Block type "api" is not available to you'),
    })
  )
  expect(await loadWorkflowFromNormalizedTables(workflowId)).toEqual(before)
})

check('editing operations withhold adding a kill-switched type the caller cannot see', async () => {
  const workflowId = await seedPlainGraph()

  const result = await addApiOperation(hiddenFrom, workflowId)

  expect(result.skipped).toContainEqual(
    expect.objectContaining({
      type: 'block_not_allowed',
      reason: expect.stringContaining('Block type "api" is not available to you'),
    })
  )
  expect(await storedTypes(workflowId)).not.toContain('api')
})

check(
  'state replace refuses a graph adding a kill-switched type the caller cannot see',
  async () => {
    const workflowId = await seedPlainGraph()
    const stored = await loadStored(workflowId)
    const added = seedApi('https://example.com/added')

    await expect(
      replaceState(hiddenFrom, workflowId, stored, { ...stored.blocks, [added.id]: added })
    ).rejects.toMatchObject({
      code: 'forbidden',
      message: expect.stringContaining('Block type "api" is not available to you'),
    })
    expect(await storedTypes(workflowId)).not.toContain('api')
  }
)

check('a placed block of a hidden type stays editable on every write path', async () => {
  const placed = seedApi('https://example.com/before')
  const workflowId = await seedGraph([seedBlock('start_trigger', 'Start'), placed])

  const source = await getSource(hiddenFrom, workflowId)
  const applied = await applySource(
    hiddenFrom,
    source,
    edit(source.files, 'https://example.com/before', 'https://example.com/source')
  )
  expect(applied.applied).toBe(true)

  const operated = await withPermissionGroupScope(() =>
    applyWorkflowOperations.execute({
      principal: hiddenFrom,
      input: {
        workflowId,
        layout: 'none',
        operations: [
          {
            operation_type: 'edit',
            block_id: placed.id,
            params: { type: 'api', inputs: { url: 'https://example.com/operations' } },
          },
        ],
      },
    })
  )
  expect(operated.skipped).toEqual([])
  expect((await loadStored(workflowId)).blocks[placed.id]?.subBlocks.url?.value).toBe(
    'https://example.com/operations'
  )

  const stored = await loadStored(workflowId)
  const replaced = structuredClone(stored.blocks)
  replaced[placed.id].subBlocks.url.value = 'https://example.com/state'
  await replaceState(hiddenFrom, workflowId, stored, replaced)
  expect((await loadStored(workflowId)).blocks[placed.id]?.subBlocks.url?.value).toBe(
    'https://example.com/state'
  )
})

check('a platform admin the rule reveals the type to adds it through source', async () => {
  const workflowId = await seedPlainGraph()
  const source = await getSource(admin, workflowId)

  const result = await applySource(admin, source, withAddedApi(source.files))

  expect(result.applied).toBe(true)
  expect(await storedTypes(workflowId)).toContain('api')
})

check('an allowlisted user adds the type through operations and state replace', async () => {
  const workflowId = await seedPlainGraph()

  const result = await addApiOperation(revealedTo, workflowId)
  expect(result.skipped).toEqual([])
  expect(await storedTypes(workflowId)).toContain('api')

  const stored = await loadStored(workflowId)
  const added = seedApi('https://example.com/second')
  await replaceState(revealedTo, workflowId, stored, { ...stored.blocks, [added.id]: added })
  expect((await storedTypes(workflowId)).filter((type) => type === 'api')).toHaveLength(2)
})
