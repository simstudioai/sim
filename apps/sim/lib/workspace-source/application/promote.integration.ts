/**
 * Promotion against Postgres: a directory read from one workspace (dev) applied to another (prod)
 * twice, as `sim workspaces source apply --to` composes it. The second promotion has to update
 * prod in place, keeping its workflow and block ids (so its webhook paths) and leaving prod's own
 * resources alone.
 */
import { db } from '@sim/db'
import { user, userTableDefinitions, workflow, workflowBlocks } from '@sim/db/schema'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { generateId } from '@sim/utils/id'
import {
  type PromotionRecord,
  promotionRecord,
  promotionSubmission,
} from '@sim/workspace-code/promote'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, vi } from 'vitest'
import {
  codes,
  refusal,
  sourceChecks,
  sourceRunner,
  sourceWorkspaces,
} from '@/lib/workspace-source/application/workspace-source.test-helpers'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

const ownerId = generateId()
const owner = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
const { check, writeReport } = sourceChecks(
  'WORKSPACE_SOURCE_PROMOTE_REPORT_PATH',
  'workspace-source-promote.json'
)
const workspaces = sourceWorkspaces()
const runner = sourceRunner(['skill', 'table', 'workflow'], owner)

const LEADS = `// @sim-sdk 1
import { column, defineTable } from '@sim/workflow-sdk/workspace'

export default defineTable({
  name: 'leads',
  columns: {
    email: column.string({ required: true }),
  },
})
`

const ingest = (system: string) => `// @sim-sdk 1
import { agent, table, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Ingest', {}, () => {
  const start = trigger.start('Start', { inputFormat: { email: 'string' } })
  const answer = agent('Answer', {
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'system', content: '${system}' }],
  })
  const save = table.insertRow('Save Lead', {
    tableId: table('leads'),
    data: { email: start.email },
  })

  start.to(answer)
  answer.to(save)
})
`

const TONE = `---
name: tone
description: House tone
---
Be brief.
`

const NOTIFY = `// @sim-sdk 1
import { trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Notify', {}, () => {
  trigger.start('Start', { inputFormat: { email: 'string' } })
})
`

const DEV: Record<string, string> = {
  'tables/leads.ts': LEADS,
  'skills/tone.md': TONE,
  'workflows/ingest/workflow.ts': ingest('Be helpful.'),
}

/** The text files a get wrote (no blobs here), as a directory holds them. */
type Read = Awaited<ReturnType<typeof runner.get>>

/** `apply --to`'s `--allow-delete` and `--delete-target-only`. */
interface PromoteOptions {
  allowDelete?: boolean
  deleteTargetOnly?: boolean
}

/** What `apply --to` sends for `dev` (a get of the dev workspace) to `target`. */
async function promote(dev: Read, target: string, options: PromoteOptions = {}) {
  const prod = await runner.get(target)
  const composed = promotionSubmission({
    files: dev.files,
    blobPaths: [],
    kinds: dev.kinds,
    target: prod,
    deleteTargetOnly: options.deleteTargetOnly === true,
  })
  return runner.apply(target, {
    files: composed.files,
    base: composed.base,
    allowDelete: options.allowDelete === true,
  })
}

/**
 * Promotes `dev` to `target` as `apply --to` does with the target's promotion record, returning
 * the apply's result and the record it leaves.
 */
async function promoteRecorded(
  dev: Read,
  target: string,
  record: PromotionRecord | undefined,
  options: PromoteOptions = {}
) {
  const prod = await runner.get(target)
  const composed = promotionSubmission({
    files: dev.files,
    blobPaths: [],
    kinds: dev.kinds,
    target: prod,
    record,
    deleteTargetOnly: options.deleteTargetOnly === true,
  })
  const result = await runner.apply(target, {
    files: composed.files,
    base: composed.base,
    allowDelete: options.allowDelete === true,
  })
  return {
    result,
    composed,
    record: promotionRecord({
      workspaceId: target,
      previous: record,
      kinds: dev.kinds,
      files: dev.files,
      submission: composed,
      applied: result,
    }),
  }
}

/** `dev` with `edits` applied to it, read back as the directory would hold it. */
async function editDev(dev: string, edits: Record<string, string>) {
  const read = await runner.get(dev)
  await runner.apply(dev, { files: { ...read.files, ...edits }, base: read.base })
  return runner.get(dev)
}

async function blockIds(workspaceId: string) {
  const rows = await db
    .select({ id: workflowBlocks.id, name: workflowBlocks.name })
    .from(workflowBlocks)
    .innerJoin(workflow, eq(workflow.id, workflowBlocks.workflowId))
    .where(and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt)))
  return Object.fromEntries(rows.map((row) => [row.name, row.id]))
}

async function liveWorkflows(workspaceId: string) {
  return db
    .select({ id: workflow.id, name: workflow.name })
    .from(workflow)
    .where(and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt)))
}

beforeAll(async () => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'workflow-code'
  )
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Workspace source fixture',
    email: `${ownerId}@workspace-source.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
})

afterAll(async () => {
  await writeReport()
  await workspaces.cleanup()
  await db.delete(user).where(inArray(user.id, [ownerId]))
})

describe('workspace source promotion', () => {
  check(
    'a directory applied to another workspace with its own base cannot be applied there a second time',
    async () => {
      const dev = await workspaces.create({ name: 'Dev', ownerId })
      const prod = await workspaces.create({ name: 'Prod', ownerId })
      await runner.apply(dev, { files: DEV })
      const first = await runner.get(dev)

      const created = await runner.apply(prod, { files: first.files, base: first.base })
      expect(created.failed).toBeUndefined()

      await runner.apply(dev, {
        files: { ...first.files, 'workflows/ingest/workflow.ts': ingest('Be terse.') },
        base: first.base,
      })
      const second = await runner.get(dev)
      const refused = await refusal(runner.apply(prod, { files: second.files, base: second.base }))
      expect(codes(refused.diagnostics)).toContain('E_APPLY_NO_BASE')
    }
  )

  check(
    'promoting twice updates the target in place, keeping its workflow and block ids',
    async () => {
      const dev = await workspaces.create({ name: 'Dev', ownerId })
      const prod = await workspaces.create({ name: 'Prod', ownerId })
      await runner.apply(dev, { files: DEV })

      const first = await promote(await runner.get(dev), prod)
      expect(first.failed).toBeUndefined()
      expect(
        first.applied.map((change) => `${change.action} ${change.kind}:${change.key}`).sort()
      ).toEqual(['create skill:tone', 'create table:leads', 'create workflow:ingest'])
      const [prodWorkflow] = await liveWorkflows(prod)
      const prodBlocks = await blockIds(prod)
      expect(Object.keys(prodBlocks).sort()).toEqual(['Answer', 'Save Lead', 'Start'])
      expect(Object.values(prodBlocks)).not.toContain((await blockIds(dev)).Start)

      const devRead = await runner.get(dev)
      await runner.apply(dev, {
        files: {
          ...devRead.files,
          'workflows/ingest/workflow.ts': ingest('Be terse.'),
          'tables/leads.ts': LEADS.replace(
            'email: column.string({ required: true }),',
            'email: column.string({ required: true }),\n    source: column.string(),'
          ),
        },
        base: devRead.base,
      })

      const again = await promote(await runner.get(dev), prod)
      expect(again.failed).toBeUndefined()
      expect(
        again.applied.map((change) => `${change.action} ${change.kind}:${change.key}`).sort()
      ).toEqual(['update table:leads', 'update workflow:ingest'])
      expect(await liveWorkflows(prod)).toEqual([prodWorkflow])
      expect(await blockIds(prod)).toEqual(prodBlocks)
      const prodRead = await runner.get(prod)
      expect(prodRead.files['workflows/ingest/workflow.ts']).toContain('Be terse.')
      expect(prodRead.files['tables/leads.ts']).toContain('source: column.string()')

      const unchanged = await promote(await runner.get(dev), prod)
      expect(unchanged.applied).toEqual([])
      expect(codes(unchanged.diagnostics)).toEqual([])
    }
  )

  check(
    'a change made in the target since the last promotion is kept when the directory left it alone, and refused as stale when the directory changed it too',
    async () => {
      const dev = await workspaces.create({ name: 'Dev', ownerId })
      const prod = await workspaces.create({ name: 'Prod', ownerId })
      await runner.apply(dev, { files: DEV })
      const first = await promoteRecorded(await runner.get(dev), prod, undefined)
      expect(first.result.failed).toBeUndefined()

      const prodRead = await runner.get(prod)
      await runner.apply(prod, {
        files: {
          ...prodRead.files,
          'skills/tone.md': TONE.replace('Be brief.', 'Be brief, prod.'),
          'workflows/ingest/workflow.ts': ingest('Prod hotfix.'),
        },
        base: prodRead.base,
      })

      const untouched = await promoteRecorded(await runner.get(dev), prod, first.record)
      expect(untouched.result.applied).toEqual([])
      const kept = await runner.get(prod)
      expect(kept.files['skills/tone.md']).toContain('Be brief, prod.')
      expect(kept.files['workflows/ingest/workflow.ts']).toContain('Prod hotfix.')

      const edited = await editDev(dev, {
        'skills/tone.md': TONE.replace('Be brief.', 'Be very brief.'),
        'workflows/ingest/workflow.ts': ingest('Be terse.'),
      })
      const stale = await refusal(promoteRecorded(edited, prod, untouched.record))
      expect(stale.stale).toBe(true)
      expect(codes(stale.diagnostics)).toContain('E_APPLY_STALE')
      const unchanged = await runner.get(prod)
      expect(unchanged.files['skills/tone.md']).toContain('Be brief, prod.')
      expect(unchanged.files['workflows/ingest/workflow.ts']).toContain('Prod hotfix.')
    }
  )

  check(
    'a resource deleted in the target since the last promotion stays deleted when the directory left it alone, and an edit of it since is refused as stale',
    async () => {
      const dev = await workspaces.create({ name: 'Dev', ownerId })
      const prod = await workspaces.create({ name: 'Prod', ownerId })
      await runner.apply(dev, { files: { ...DEV, 'workflows/notify/workflow.ts': NOTIFY } })
      const first = await promoteRecorded(await runner.get(dev), prod, undefined)
      expect(first.result.failed).toBeUndefined()

      const prodRead = await runner.get(prod)
      const removed = await runner.apply(prod, {
        files: Object.fromEntries(
          Object.entries(prodRead.files).filter(
            ([path]) => path !== 'skills/tone.md' && !path.startsWith('workflows/notify/')
          )
        ),
        base: prodRead.base,
        allowDelete: true,
      })
      expect(
        removed.applied.map((change) => `${change.action} ${change.kind}:${change.key}`).sort()
      ).toEqual(['delete skill:tone', 'delete workflow:notify'])

      const untouched = await promoteRecorded(await runner.get(dev), prod, first.record)
      expect(untouched.result.applied).toEqual([])
      expect(codes(untouched.result.diagnostics, 'warning').sort()).toEqual([
        'W_SERVER_DELETED',
        'W_SERVER_DELETED',
      ])
      expect((await liveWorkflows(prod)).map((row) => row.name)).toEqual(['Ingest'])
      expect((await runner.get(prod)).files['skills/tone.md']).toBeUndefined()

      const edited = await editDev(dev, {
        'skills/tone.md': TONE.replace('Be brief.', 'Be very brief.'),
        'workflows/notify/workflow.ts': NOTIFY.replace("'Notify'", "'Notify v2'"),
      })
      const stale = await refusal(promoteRecorded(edited, prod, untouched.record))
      expect(stale.stale).toBe(true)
      expect(codes(stale.diagnostics)).toEqual(['E_APPLY_STALE', 'E_APPLY_STALE'])
      expect((await liveWorkflows(prod)).map((row) => row.name)).toEqual(['Ingest'])
    }
  )

  check(
    'with the record, a promotion that changed nothing in the target since converges, and the next edit updates it in place',
    async () => {
      const dev = await workspaces.create({ name: 'Dev', ownerId })
      const prod = await workspaces.create({ name: 'Prod', ownerId })
      await runner.apply(dev, { files: DEV })
      const first = await promoteRecorded(await runner.get(dev), prod, undefined)
      const again = await promoteRecorded(await runner.get(dev), prod, first.record)
      expect(again.result.applied).toEqual([])

      const edited = await editDev(dev, {
        'skills/tone.md': TONE.replace('Be brief.', 'Be very brief.'),
        'workflows/ingest/workflow.ts': ingest('Be terse.'),
      })
      const updated = await promoteRecorded(edited, prod, again.record)
      expect(
        updated.result.applied
          .map((change) => `${change.action} ${change.kind}:${change.key}`)
          .sort()
      ).toEqual(['update skill:tone', 'update workflow:ingest'])
      const settled = await promoteRecorded(edited, prod, updated.record)
      expect(settled.result.applied).toEqual([])
    }
  )

  check('promoting managed rows converges: the second promotion changes nothing', async () => {
    const dev = await workspaces.create({ name: 'Dev', ownerId })
    const prod = await workspaces.create({ name: 'Prod', ownerId })
    const directory = {
      'tables/stock.ts': `// @sim-sdk 1
import { column, defineTable } from '@sim/workflow-sdk/workspace'

export default defineTable({
  name: 'stock',
  columns: {
    sku: column.string({ required: true, unique: true }),
    status: column.select({ options: ['new', 'won'] }),
    note_text: column.string({ name: 'memo' }),
  },
  rows: { mode: 'managed', key: 'sku' },
})
`,
      'tables/stock.rows.jsonl': '{"sku":"A-1","status":"new","note_text":"hi"}\n{"sku":"A-2"}\n',
    }
    const applied = await runner.apply(dev, { files: directory, kinds: ['table'] })
    const devDir = { ...(await runner.get(dev)), files: applied.files }

    const first = await promote(devDir, prod)
    expect(first.applied.map((change) => `${change.action} ${change.kind}:${change.key}`)).toEqual([
      'create table:stock',
    ])
    const second = await promote(devDir, prod)
    expect(second.applied).toEqual([])
  })

  check(
    "the target's own resources are kept, with a warning, even with --allow-delete, and deleted only with --delete-target-only",
    async () => {
      const dev = await workspaces.create({ name: 'Dev', ownerId })
      const prod = await workspaces.create({ name: 'Prod', ownerId })
      await runner.apply(dev, { files: DEV })
      await promote(await runner.get(dev), prod)
      const prodRead = await runner.get(prod)
      const added = await runner.apply(prod, {
        files: {
          'tables/leads.ts': prodRead.files['tables/leads.ts'],
          'tables/audit.ts': LEADS.replace("name: 'leads'", "name: 'audit'"),
        },
        base: prodRead.base,
        kinds: ['table'],
      })
      expect(added.failed).toBeUndefined()

      const kept = await promote(await runner.get(dev), prod)
      expect(kept.applied).toEqual([])
      expect(codes(kept.diagnostics, 'warning')).toContain('W_UNDECLARED')
      const prodTables = await db
        .select({ name: userTableDefinitions.name })
        .from(userTableDefinitions)
        .where(
          and(eq(userTableDefinitions.workspaceId, prod), isNull(userTableDefinitions.archivedAt))
        )
      expect(prodTables.map((table) => table.name).sort()).toEqual(['audit', 'leads'])

      const allowed = await promote(await runner.get(dev), prod, { allowDelete: true })
      expect(allowed.applied).toEqual([])
      expect(
        allowed.diagnostics
          .filter((finding) => finding.code === 'W_UNDECLARED')
          .map((finding) => finding.key)
      ).toEqual(['audit'])

      const deleted = await promote(await runner.get(dev), prod, {
        allowDelete: true,
        deleteTargetOnly: true,
      })
      expect(
        deleted.applied.map((change) => `${change.action} ${change.kind}:${change.key}`)
      ).toEqual(['delete table:audit'])
    }
  )

  check(
    'a resource deleted in the directory since the last promotion is a delete: refused without --allow-delete, and --allow-delete deletes it alone, keeping what only the target holds',
    async () => {
      const dev = await workspaces.create({ name: 'Dev', ownerId })
      const prod = await workspaces.create({ name: 'Prod', ownerId })
      await runner.apply(dev, { files: DEV })
      const first = await promoteRecorded(await runner.get(dev), prod, undefined)
      expect(first.result.failed).toBeUndefined()
      const prodRead = await runner.get(prod)
      await runner.apply(prod, {
        files: {
          'tables/leads.ts': prodRead.files['tables/leads.ts'],
          'tables/audit.ts': LEADS.replace("name: 'leads'", "name: 'audit'"),
        },
        base: prodRead.base,
        kinds: ['table'],
      })
      const devRead = await runner.get(dev)
      await runner.apply(dev, {
        files: Object.fromEntries(
          Object.entries(devRead.files).filter(([path]) => path !== 'skills/tone.md')
        ),
        base: devRead.base,
        allowDelete: true,
      })
      const deletedInDev = await runner.get(dev)

      const refused = await refusal(promoteRecorded(deletedInDev, prod, first.record))
      expect(codes(refused.diagnostics)).toEqual(['E_APPLY_DELETE_NOT_ALLOWED'])
      expect((await runner.get(prod)).files['skills/tone.md']).toContain('Be brief.')

      const allowed = await promoteRecorded(deletedInDev, prod, first.record, { allowDelete: true })
      expect(
        allowed.result.applied.map((change) => `${change.action} ${change.kind}:${change.key}`)
      ).toEqual(['delete skill:tone'])
      expect(allowed.composed.targetOnly).toEqual(['table:audit'])
      expect(
        allowed.result.diagnostics
          .filter((finding) => finding.code === 'W_UNDECLARED')
          .map((finding) => finding.key)
      ).toEqual(['audit'])
      expect(allowed.record.resources['table:audit']).toBeUndefined()
      expect((await runner.get(prod)).files['tables/audit.ts']).toBeDefined()
    }
  )
})
