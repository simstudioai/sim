/**
 * Source apply under organization governance, against real PostgreSQL: a permission group that
 * withholds a block type already stored in the workflow, and a hosted deployment where a user API
 * key on a hosted model is dropped. Both need `@/lib/core/config/env-flags` driven per case
 * (`isAccessControlEnabled`, `isHosted`), which is why they do not share the main apply suite.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { db } from '@sim/db'
import {
  member,
  organization,
  permissionGroup,
  permissionGroupMember,
  permissionGroupWorkspace,
  permissions,
  user,
  workflow,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { envFlagsMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { catalogBlock } from '@sim/workflow-code'
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import type { BlockState } from '@sim/workflow-types/workflow'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import { applyWorkflowSource } from '@/lib/workflows/application/apply-workflow-source'
import { readSourceCatalog } from '@/lib/workflows/application/read-source-catalog'
import { readWorkflowSource } from '@/lib/workflows/application/read-workflow-source'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'

vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

const organizationId = generateId()
const ownerId = generateId()
const restrictedId = generateId()
const openWorkspaceId = generateId()
const governedWorkspaceId = generateId()
const owner = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
const restricted = createSessionPrincipal({ userId: restrictedId, sessionId: generateId() })

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

/** A workflow whose first block feeds every other block. */
async function seedGraph(workspaceId: string, blocks: BlockState[]): Promise<string> {
  const workflowId = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id: workflowId,
    userId: ownerId,
    workspaceId,
    name: `Source governance ${workflowId}`,
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

type Principal = typeof owner

function getSource(principal: Principal, workflowId: string) {
  return withPermissionGroupScope(() =>
    readWorkflowSource.execute({ principal, input: { workflowId, functionCode: 'inline' } })
  )
}

function apply(
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

function edit(files: Record<string, string>, from: string, to: string): Record<string, string> {
  const text = files['workflow.ts']
  expect(text.split(from), `workflow.ts holds "${from}" once`).toHaveLength(2)
  return { ...files, 'workflow.ts': text.replace(from, to) }
}

beforeAll(async () => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'workflow-code'
  )
  setEnvFlags({ isAccessControlEnabled: true })
  const now = new Date()
  await db.insert(user).values(
    [ownerId, restrictedId].map((id) => ({
      id,
      name: 'Source governance fixture',
      email: `${id}@source-governance.invalid`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db.insert(organization).values({
    id: organizationId,
    name: 'Source governance fixture',
    slug: organizationId,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(member).values(
    [ownerId, restrictedId].map((userId) => ({
      id: generateId(),
      userId,
      organizationId,
      role: userId === ownerId ? 'owner' : 'member',
      createdAt: now,
    }))
  )
  await insertWorkspaceFixture(
    db,
    [openWorkspaceId, governedWorkspaceId].map((id) => ({
      id,
      name: 'Source governance fixture',
      ownerId,
      billedAccountUserId: ownerId,
      organizationId,
      workspaceMode: 'organization' as const,
    }))
  )
  await db.insert(permissions).values([
    ...[openWorkspaceId, governedWorkspaceId].map((entityId) => ({
      id: generateId(),
      userId: ownerId,
      entityType: 'workspace',
      entityId,
      permissionType: 'admin' as const,
    })),
    {
      id: generateId(),
      userId: restrictedId,
      entityType: 'workspace',
      entityId: governedWorkspaceId,
      permissionType: 'write' as const,
    },
  ])
  const restrictedGroupId = generateId()
  await db.insert(permissionGroup).values([
    {
      id: generateId(),
      organizationId,
      name: 'Everyone',
      createdBy: ownerId,
      isDefault: true,
      config: {},
    },
    {
      id: restrictedGroupId,
      organizationId,
      name: 'Functions only',
      createdBy: ownerId,
      config: { allowedIntegrations: ['function'] },
    },
  ])
  await db.insert(permissionGroupWorkspace).values({
    id: generateId(),
    permissionGroupId: restrictedGroupId,
    workspaceId: governedWorkspaceId,
    organizationId,
  })
  await db.insert(permissionGroupMember).values({
    id: generateId(),
    permissionGroupId: restrictedGroupId,
    organizationId,
    userId: restrictedId,
  })
})

afterEach(() => {
  setEnvFlags({ isHosted: false })
})

afterAll(async () => {
  const reportPath =
    process.env.WORKFLOW_SOURCE_GOVERNANCE_REPORT_PATH ??
    resolve('test-results/workflow-source-governance.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  resetEnvFlagsMock()
  await deleteWorkspaceFixture(db, eq(workspace.organizationId, organizationId))
  await db.delete(organization).where(eq(organization.id, organizationId))
  await db.delete(user).where(eq(user.id, ownerId))
  await db.delete(user).where(eq(user.id, restrictedId))
})

check(
  'a block type the permission group withholds refuses the write even when untouched',
  async () => {
    const start = seedBlock('start_trigger', 'Start')
    const score = seedBlock('function', 'Score', { code: ['code', 'return 1'] })
    const request = seedBlock('api', 'Fetch', {
      url: ['short-input', 'https://example.com/health'],
      method: ['dropdown', 'GET'],
    })
    const workflowId = await seedGraph(governedWorkspaceId, [start, score, request])
    const source = await getSource(restricted, workflowId)
    const before = await loadWorkflowFromNormalizedTables(workflowId)

    await expect(
      apply(restricted, source, edit(source.files, 'js`return 1`', 'js`return 2`'))
    ).rejects.toMatchObject({
      code: 'forbidden',
      message: expect.stringContaining('Block type "api"'),
    })
    expect(await loadWorkflowFromNormalizedTables(workflowId)).toEqual(before)
  }
)

check(
  'an attached tool the permission group withholds keeps its stored key out of the source',
  async () => {
    const secret = 'fc-governance-literal-key'
    const start = seedBlock('start_trigger', 'Start')
    const researcher = seedBlock('agent', 'Researcher', {
      model: ['combobox', 'claude-sonnet-5-5'],
      messages: ['messages-input', [{ role: 'user', content: 'hi' }]],
      tools: [
        'tool-input',
        [
          {
            type: 'firecrawl',
            title: 'Firecrawl',
            toolId: 'firecrawl_scrape',
            operation: 'scrape',
            usageControl: 'auto',
            isExpanded: true,
            params: { url: 'https://example.com', apiKey: secret },
          },
        ],
      ],
    })
    const workflowId = await seedGraph(governedWorkspaceId, [start, researcher])

    const source = await getSource(restricted, workflowId)
    expect(JSON.stringify(source.files)).not.toContain(secret)
    expect(source.files['workflow.ts']).toContain('stored()')

    const catalog = await withPermissionGroupScope(() =>
      readSourceCatalog.execute({
        principal: restricted,
        input: { workspaceId: governedWorkspaceId, workflowId },
      })
    )
    expect(catalogBlock(catalog, 'firecrawl')?.addable).toBe(false)
  }
)

check(
  'a user API key set on a hosted model is dropped with a warning and stored as null',
  async () => {
    const start = seedBlock('start_trigger', 'Start')
    const writer = seedBlock('agent', 'Writer', {
      model: ['combobox', 'claude-sonnet-5-5'],
      messages: ['messages-input', [{ role: 'user', content: 'hi' }]],
    })
    const workflowId = await seedGraph(openWorkspaceId, [start, writer])
    const source = await getSource(owner, workflowId)
    setEnvFlags({ isHosted: true })

    const result = await apply(
      owner,
      source,
      edit(
        source.files,
        "model: 'claude-sonnet-5-5',",
        "model: 'claude-sonnet-5-5',\n    apiKey: 'sk-user-supplied-key',"
      )
    )

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'W_APPLY_HOSTED_KEY_DROPPED',
        blockId: writer.id,
        param: 'apiKey',
      })
    )
    const after = await loadWorkflowFromNormalizedTables(workflowId)
    expect(after?.blocks[writer.id]?.subBlocks.apiKey?.value ?? null).toBeNull()
    expect(JSON.stringify(after?.blocks[writer.id])).not.toContain('sk-user-supplied-key')
  }
)
