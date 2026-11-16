/**
 * Source apply when the workspace's custom blocks change between `source get` and apply, against
 * real PostgreSQL. A custom block's inputs are derived live from its publisher workflow's active
 * deployment, and the source catalog is served from a process cache keyed by the content it reads,
 * so these cover the two drifts a stale key or a dropped stored type would hide: a block
 * republished with a new input, and a block disabled while it is placed.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { db } from '@sim/db'
import {
  customBlock,
  member,
  organization,
  permissions,
  user,
  workflow,
  workflowDeploymentVersion,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { envFlagsMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import { applyWorkflowSource } from '@/lib/workflows/application/apply-workflow-source'
import { readWorkflowSource } from '@/lib/workflows/application/read-workflow-source'
import { WorkflowSourceRejectedError } from '@/lib/workflows/application/source-error'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'

vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

const organizationId = generateId()
const ownerId = generateId()
const workspaceId = generateId()
const principal = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })

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

type InputField = { id: string; name: string }

/** A deployed publisher state whose Start declares `fields`. */
function publisherState(startId: string, fields: InputField[]) {
  return {
    blocks: {
      [startId]: {
        id: startId,
        type: 'start_trigger',
        name: 'Start',
        enabled: true,
        position: { x: 0, y: 0 },
        outputs: {},
        subBlocks: {
          inputFormat: {
            id: 'inputFormat',
            type: 'input-format',
            value: fields.map((field) => ({ ...field, type: 'string', value: '' })),
          },
        },
      },
    },
    edges: [],
    loops: {},
    parallels: {},
    variables: {},
  }
}

interface Published {
  type: string
  publisherId: string
  startId: string
  version: number
}

/** Publishes a custom block backed by a deployed workflow whose Start takes `fields`. */
async function publishCustomBlock(fields: InputField[]): Promise<Published> {
  const publisherId = generateId()
  const startId = generateId()
  const type = `custom_block_lead${generateId().replace(/-/g, '').slice(0, 12)}`
  const now = new Date()
  await db.insert(workflow).values({
    id: publisherId,
    userId: ownerId,
    workspaceId,
    name: `Lead scorer source ${publisherId}`,
    isDeployed: true,
    deployedAt: now,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(workflowDeploymentVersion).values({
    id: generateId(),
    workflowId: publisherId,
    version: 1,
    state: publisherState(startId, fields),
    isActive: true,
  })
  await db.insert(customBlock).values({
    id: generateId(),
    organizationId,
    workflowId: publisherId,
    type,
    name: 'Lead scorer',
    description: 'Scores a lead',
  })
  return { type, publisherId, startId, version: 1 }
}

/** Deploys a new active version of the publisher, as a republish does. */
async function republish(published: Published, fields: InputField[]): Promise<void> {
  await db
    .update(workflowDeploymentVersion)
    .set({ isActive: false })
    .where(eq(workflowDeploymentVersion.workflowId, published.publisherId))
  published.version += 1
  await db.insert(workflowDeploymentVersion).values({
    id: generateId(),
    workflowId: published.publisherId,
    version: published.version,
    state: publisherState(published.startId, fields),
    isActive: true,
  })
}

/** A consumer workflow: Start wired to one placed instance of the custom block. */
async function seedConsumer(published: Published) {
  const workflowId = generateId()
  const startId = generateId()
  const placedId = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id: workflowId,
    userId: ownerId,
    workspaceId,
    name: `Lead consumer ${workflowId}`,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  const saved = await saveWorkflowToNormalizedTables(workflowId, {
    blocks: {
      [startId]: {
        id: startId,
        type: 'start_trigger',
        name: 'Start',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
      },
      [placedId]: {
        id: placedId,
        type: published.type,
        name: 'Lead scorer',
        position: { x: 400, y: 0 },
        subBlocks: { 'f-lead': { id: 'f-lead', type: 'short-input', value: 'acme' } },
        outputs: {},
        enabled: true,
      },
    },
    edges: [{ id: generateId(), source: startId, target: placedId }],
    loops: {},
    parallels: {},
  })
  if (!saved.success) throw new Error(`Seeding the consumer failed: ${saved.error}`)
  return { workflowId, placedId }
}

function getSource(workflowId: string) {
  return withPermissionGroupScope(() =>
    readWorkflowSource.execute({ principal, input: { workflowId, functionCode: 'inline' } })
  )
}

interface SourceState {
  workflowId: string
  files: Record<string, string>
  lock: Awaited<ReturnType<typeof getSource>>['lock']
  base: Awaited<ReturnType<typeof getSource>>['base']
}

function apply(source: SourceState, files: Record<string, string>) {
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
  setEnvFlags({ isCustomBlocksEnabled: true })
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Source catalog drift fixture',
    email: `${ownerId}@source-catalog.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(organization).values({
    id: organizationId,
    name: 'Source catalog drift fixture',
    slug: organizationId,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(member).values({
    id: generateId(),
    userId: ownerId,
    organizationId,
    role: 'owner',
    createdAt: now,
  })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Source catalog drift fixture',
    ownerId,
    billedAccountUserId: ownerId,
    organizationId,
    workspaceMode: 'organization',
  })
  await db.insert(permissions).values({
    id: generateId(),
    userId: ownerId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
  })
})

afterAll(async () => {
  const reportPath =
    process.env.WORKFLOW_SOURCE_CATALOG_REPORT_PATH ??
    resolve('test-results/workflow-source-catalog.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  resetEnvFlagsMock()
  await db.delete(customBlock).where(eq(customBlock.organizationId, organizationId))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(organization).where(eq(organization.id, organizationId))
  await db.delete(user).where(eq(user.id, ownerId))
})

check(
  'a custom block republished with a new input between get and apply compiles against the new catalog',
  async () => {
    const published = await publishCustomBlock([{ id: 'f-lead', name: 'lead' }])
    const consumer = await seedConsumer(published)
    const source = await getSource(consumer.workflowId)
    await republish(published, [
      { id: 'f-lead', name: 'lead' },
      { id: 'f-score', name: 'score' },
    ])

    const result = await apply(
      source,
      edit(source.files, "{ 'f-lead': 'acme' }", "{ 'f-lead': 'acme', 'f-score': '90' }")
    )

    expect(result.applied).toBe(true)
    expect(result.base.catalogHash).not.toBe(source.base.catalogHash)
    const stored = await loadWorkflowFromNormalizedTables(consumer.workflowId)
    expect(stored?.blocks[consumer.placedId]?.subBlocks['f-score']?.value).toBe('90')
    expect(stored?.blocks[consumer.placedId]?.subBlocks['f-lead']?.value).toBe('acme')
  }
)

check(
  'a disabled custom block stays editable where it is placed but cannot be added again',
  async () => {
    const published = await publishCustomBlock([{ id: 'f-lead', name: 'lead' }])
    const consumer = await seedConsumer(published)
    await db
      .update(customBlock)
      .set({ enabled: false })
      .where(
        and(eq(customBlock.organizationId, organizationId), eq(customBlock.type, published.type))
      )
    const source = await getSource(consumer.workflowId)

    const edited = await apply(source, edit(source.files, "'f-lead': 'acme'", "'f-lead': 'globex'"))

    expect(edited.applied).toBe(true)
    const placed = await loadWorkflowFromNormalizedTables(consumer.workflowId)
    expect(placed?.blocks[consumer.placedId]?.subBlocks['f-lead']?.value).toBe('globex')

    const builder = edited.files['workflow.ts'].match(
      /= (custom\.[A-Za-z0-9_$]+)\('Lead scorer'/
    )?.[1]
    expect(builder, 'the placed block prints through its custom builder').toBeDefined()
    const refused = await apply(
      edited,
      edit(
        edited.files,
        '  start.to(',
        `  const second = ${builder}('Second scorer', {})\n  start.to(`
      )
    ).then(
      () => null,
      (error: unknown) => error
    )

    expect(refused).toBeInstanceOf(WorkflowSourceRejectedError)
    expect((refused as WorkflowSourceRejectedError).diagnostics.map((d) => d.code)).toContain(
      'E_APPLY_TYPE_NOT_ADDABLE'
    )
    expect(await loadWorkflowFromNormalizedTables(consumer.workflowId)).toEqual(placed)
  }
)
