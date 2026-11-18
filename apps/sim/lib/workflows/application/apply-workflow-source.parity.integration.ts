/**
 * Differential parity between the source gates and the full source apply pipeline, over the
 * locked, sunset, trigger and enablement fixtures of `source/gates.test.ts` restated with real
 * registry types: each case is one change expressed as a base → target graph pair. The gates are
 * called directly on the pair, and the same target is printed as source and sent through
 * `applyWorkflowSource` (compile, materialize, diff, gates, write) against the stored base. Both
 * are reduced to `category:blockId` and must equal the expected refusals, so a refusal the gates
 * make can never be lost, renamed or added on the way through compile and materialize.
 *
 * Runs against real PostgreSQL and the real block registry, with no module mocks besides the
 * feature flag and the realtime notifier.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { db } from '@sim/db'
import { auditLog, permissions, user, workflow, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { canonicalize, printWorkflow } from '@sim/workflow-code'
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import { applyWorkflowSource } from '@/lib/workflows/application/apply-workflow-source'
import { readWorkflowSource } from '@/lib/workflows/application/read-workflow-source'
import { WorkflowSourceRejectedError } from '@/lib/workflows/application/source-error'
import { gateSourceDiff, SKIP_TYPE_APPLY_CODES } from '@/lib/workflows/code/apply/gates'
import { diffGraphs, type SourceGraph } from '@/lib/workflows/code/apply/graph-diff'
import { findLockedBlockRefusals } from '@/lib/workflows/code/apply/locked'
import { buildBlockCatalog } from '@/lib/workflows/code/catalog/build'
import { registryTrigger } from '@/lib/workflows/code/catalog/registry-sources'
import { createMaterializeHooks } from '@/lib/workflows/code/materialize-hooks'
import { buildLockFromState } from '@/lib/workflows/code/source-lock'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { getBlockRegistry } from '@/blocks/registry'
import { SDK_NAMES } from '@/blocks/sdk-names.generated'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

const ownerId = generateId()
const workspaceId = generateId()
const principal = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
const hooks = createMaterializeHooks()
const catalog = buildBlockCatalog({
  blocks: Object.values(getBlockRegistry()),
  trigger: registryTrigger,
  sdkNames: SDK_NAMES,
})

const checks: { name: string; status: string; durationMs: number; error?: string }[] = []

/** Gate and pipeline codes as the engine's skip vocabulary, as `gates.test.ts` reduces them. */
const CATEGORY: Record<string, string> = {
  ...Object.fromEntries(Object.entries(SKIP_TYPE_APPLY_CODES).map(([skip, code]) => [code, skip])),
  E_APPLY_LOCKED_BLOCK: 'block_locked',
  E_APPLY_CREDENTIAL_UNREACHABLE: 'credential',
  E_APPLY_SANDBOX_PLAN_REQUIRED: 'sandbox_plan',
  /** The pipeline's own placement refusal for a type the caller may keep but not add. */
  E_APPLY_TYPE_NOT_ADDABLE: 'block_not_allowed',
}

interface BlockOptions {
  parentId?: string
  locked?: boolean
  enabled?: boolean
  code?: string
}

function block(id: string, type: string, name: string, options: BlockOptions = {}): BlockState {
  const created = hooks.initBlock({ id, type, name, triggerMode: false })
  const subBlocks = { ...created.subBlocks }
  if (options.code !== undefined && subBlocks.code) {
    subBlocks.code = { ...subBlocks.code, value: options.code }
  }
  return {
    ...created,
    subBlocks,
    enabled: options.enabled ?? true,
    ...(options.locked ? { locked: true } : {}),
    data: {
      ...(created.data ?? {}),
      ...(options.parentId ? { parentId: options.parentId, extent: 'parent' as const } : {}),
    },
  }
}

interface ParityCase {
  name: string
  base: (ids: Ids) => BlockState[]
  /** Replaces or adds blocks by id; `null` removes one. */
  change: (ids: Ids, base: Record<string, BlockState>) => Record<string, BlockState | null>
  expected: (ids: Ids) => string[]
}

type Ids = Record<'start' | 'a' | 'b' | 'c' | 'loop', string>

const CASES: ParityCase[] = [
  {
    name: 'locked: refuses a code edit on a locked block',
    base: (ids) => [
      block(ids.start, 'start_trigger', 'Start'),
      block(ids.a, 'function', 'A', { locked: true, code: 'return 1' }),
    ],
    change: (ids) => ({
      [ids.a]: block(ids.a, 'function', 'A', { locked: true, code: 'return 2' }),
    }),
    expected: (ids) => [`block_locked:${ids.a}`],
  },
  {
    name: 'locked: refuses renaming a locked block',
    base: (ids) => [
      block(ids.start, 'start_trigger', 'Start'),
      block(ids.a, 'function', 'A', { locked: true }),
    ],
    change: (ids, base) => ({ [ids.a]: { ...base[ids.a], name: 'Renamed' } }),
    expected: (ids) => [`block_locked:${ids.a}`],
  },
  {
    name: 'locked: refuses deleting a locked block',
    base: (ids) => [
      block(ids.start, 'start_trigger', 'Start'),
      block(ids.a, 'function', 'A', { locked: true }),
      block(ids.b, 'function', 'B'),
    ],
    change: (ids) => ({ [ids.a]: null }),
    expected: (ids) => [`block_locked:${ids.a}`],
  },
  {
    name: 'locked: refuses an edit to a child of a locked container',
    base: (ids) => [
      block(ids.start, 'start_trigger', 'Start'),
      block(ids.loop, 'loop', 'Each', { locked: true }),
      block(ids.a, 'function', 'Inner', { parentId: ids.loop, code: 'return 1' }),
    ],
    change: (ids, base) => ({
      [ids.a]: {
        ...base[ids.a],
        subBlocks: {
          ...base[ids.a].subBlocks,
          code: { ...base[ids.a].subBlocks.code, value: 'return 2' },
        },
      },
    }),
    expected: (ids) => [`block_locked:${ids.a}`],
  },
  {
    name: 'locked: refuses adding a block to a locked container',
    base: (ids) => [
      block(ids.start, 'start_trigger', 'Start'),
      block(ids.loop, 'loop', 'Each', { locked: true }),
    ],
    change: (ids) => ({ [ids.c]: block(ids.c, 'function', 'New', { parentId: ids.loop }) }),
    expected: (ids) => [`block_locked:${ids.c}`],
  },
  {
    name: 'locked: refuses moving an existing block into a locked container',
    base: (ids) => [
      block(ids.start, 'start_trigger', 'Start'),
      block(ids.loop, 'loop', 'Each', { locked: true }),
      block(ids.b, 'function', 'Outside'),
    ],
    change: (ids, base) => ({
      [ids.b]: {
        ...base[ids.b],
        data: { ...base[ids.b].data, parentId: ids.loop, extent: 'parent' },
      },
    }),
    expected: (ids) => [`block_locked:${ids.b}`],
  },
  {
    name: 'locked: a locked child goes with its deleted unlocked container',
    base: (ids) => [
      block(ids.start, 'start_trigger', 'Start'),
      block(ids.loop, 'loop', 'Each'),
      block(ids.a, 'function', 'Inner', { parentId: ids.loop, locked: true }),
    ],
    change: (ids) => ({ [ids.loop]: null, [ids.a]: null }),
    expected: () => [],
  },
  {
    name: 'sunset: refuses a new legacy block but keeps a placed one editable',
    base: (ids) => [block(ids.start, 'start_trigger', 'Start'), block(ids.a, 'table', 'Rows')],
    change: (ids, base) => ({
      [ids.a]: { ...base[ids.a], name: 'Rows renamed' },
      [ids.b]: block(ids.b, 'table', 'Fresh rows'),
    }),
    expected: (ids) => [`block_not_allowed:${ids.b}`],
  },
  {
    name: 'triggers: refuses a second start trigger',
    base: (ids) => [block(ids.start, 'start_trigger', 'Start')],
    change: (ids) => ({ [ids.b]: block(ids.b, 'start_trigger', 'Start 2') }),
    expected: (ids) => [`duplicate_trigger:${ids.b}`],
  },
  {
    name: 'enablement: refuses enabling a block under a disabled container',
    base: (ids) => [
      block(ids.start, 'start_trigger', 'Start'),
      block(ids.loop, 'loop', 'Each', { enabled: false }),
      block(ids.a, 'function', 'Inner', { parentId: ids.loop, enabled: false }),
    ],
    change: (ids, base) => ({ [ids.a]: { ...base[ids.a], enabled: true } }),
    expected: (ids) => [`disabled_ancestor:${ids.a}`],
  },
]

async function seed(blocks: BlockState[]): Promise<{ workflowId: string; name: string }> {
  const workflowId = generateId()
  const name = `Source parity ${workflowId}`
  const now = new Date()
  await db.insert(workflow).values({
    id: workflowId,
    userId: ownerId,
    workspaceId,
    name,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  const state: WorkflowState = {
    blocks: Object.fromEntries(blocks.map((entry) => [entry.id, entry])),
    edges: [],
    loops: {},
    parallels: {},
  }
  const saved = await saveWorkflowToNormalizedTables(workflowId, state)
  if (!saved.success) throw new Error(`Seeding the workflow failed: ${saved.error}`)
  return { workflowId, name }
}

function categories(diagnostics: readonly { code: string; severity: string; blockId?: string }[]) {
  return [
    ...new Set(
      diagnostics
        .filter((diagnostic) => diagnostic.severity === 'error')
        .map(
          (diagnostic) => `${CATEGORY[diagnostic.code] ?? diagnostic.code}:${diagnostic.blockId}`
        )
    ),
  ].sort()
}

/** The target graph as the files and lock a client would send. */
function printTarget(target: WorkflowState, name: string) {
  const canonical = canonicalize(target, { catalog, meta: { name, description: null } })
  const printed = printWorkflow({
    workflow: canonical.workflow,
    catalog,
    options: { functionCode: 'files' },
  })
  return {
    files: Object.fromEntries(printed.files.map((file) => [file.path, file.text])),
    lock: buildLockFromState(null, canonical, printed.hints),
  }
}

beforeAll(async () => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'workflow-code'
  )
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Source parity fixture',
    email: `${ownerId}@source-parity.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Source parity',
    ownerId,
    billedAccountUserId: ownerId,
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
    process.env.WORKFLOW_SOURCE_PARITY_REPORT_PATH ??
    resolve('test-results/workflow-source-parity.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  await db.delete(auditLog).where(eq(auditLog.workspaceId, workspaceId))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(user).where(eq(user.id, ownerId))
})

it.each(CASES)('$name', async (testCase) => {
  const started = performance.now()
  try {
    const ids: Ids = {
      start: generateId(),
      a: generateId(),
      b: generateId(),
      c: generateId(),
      loop: generateId(),
    }
    const { workflowId, name } = await seed(testCase.base(ids))
    const stored = await loadWorkflowFromNormalizedTables(workflowId)
    if (!stored) throw new Error('The seeded workflow did not load')
    const blocks = { ...stored.blocks }
    for (const [id, next] of Object.entries(testCase.change(ids, stored.blocks))) {
      if (next) blocks[id] = next
      else delete blocks[id]
    }
    const base: SourceGraph = { blocks: stored.blocks, edges: stored.edges }
    const target: WorkflowState = { blocks, edges: [], loops: {}, parallels: {} }

    const direct = await withPermissionGroupScope(async () =>
      categories([
        ...findLockedBlockRefusals(base, target, diffGraphs(base, target), () => undefined),
        ...(await gateSourceDiff({
          catalog,
          keyOf: () => undefined,
          base,
          target,
          diff: diffGraphs(base, target),
          permissionConfig: null,
          subjectUserId: ownerId,
          workspaceId,
          isCopilot: false,
        })),
      ])
    )

    const source = await withPermissionGroupScope(() =>
      readWorkflowSource.execute({ principal, input: { workflowId } })
    )
    const { files, lock } = printTarget(target, name)
    const outcome = await withPermissionGroupScope(() =>
      applyWorkflowSource.execute({
        principal,
        input: {
          workflowId,
          files,
          lock,
          base: source.base,
          // The engine operation deletes explicitly, as --allow-delete does for source.
          allowDelete: true,
        },
      })
    ).then(
      () => [] as string[],
      (error: unknown) => {
        if (!(error instanceof WorkflowSourceRejectedError)) throw error
        return categories(error.diagnostics)
      }
    )

    expect(direct).toEqual([...testCase.expected(ids)].sort())
    expect(outcome).toEqual(direct)
    checks.push({ name: testCase.name, status: 'passed', durationMs: performance.now() - started })
  } catch (error) {
    checks.push({
      name: testCase.name,
      status: 'failed',
      durationMs: performance.now() - started,
      error: getErrorMessage(error),
    })
    throw error
  }
})
