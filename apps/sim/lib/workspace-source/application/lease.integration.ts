/**
 * Concurrent workspace source applies against Postgres: the per-workspace apply lease lets one
 * apply write a workspace at a time, refuses a second one with nothing written, and is given up
 * on every way an apply ends, or lapses when its process died.
 */
import { db } from '@sim/db'
import { customTools, skill, user, workspaceSourceApplyLease } from '@sim/db/schema'
import {
  createPersonalApiKeyPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { posthogServerMock, posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, vi } from 'vitest'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { WorkspaceSourceRejectedError } from '@/lib/workspace-source/application/errors'
import { skillAdapter } from '@/lib/workspace-source/application/kinds/skills/adapter'
import { toolAdapter } from '@/lib/workspace-source/application/kinds/tools/adapter'
import {
  sourceChecks,
  sourceRunner,
  sourceWorkspaces,
} from '@/lib/workspace-source/application/workspace-source.test-helpers'
import { WorkspaceSourceBusyError } from '@/lib/workspace-source/lease/store'

const ownerId = generateId()
const owner = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
const { check, writeReport } = sourceChecks(
  'WORKSPACE_SOURCE_LEASE_REPORT_PATH',
  'workspace-source-lease.json'
)
const workspaces = sourceWorkspaces()
const runner = sourceRunner(['custom-tool', 'skill'], owner)
/** The owner through a personal API key: analytics attributes a key's applies, not a session's. */
const keyRunner = sourceRunner(
  ['custom-tool', 'skill'],
  createPersonalApiKeyPrincipal({ userId: ownerId, keyId: generateId() })
)

function tool(title: string, name: string): string {
  return `// @sim-sdk 1
import { defineTool } from '@sim/workflow-sdk/workspace'

export default defineTool({
  title: '${title}',
  schema: {
    type: 'function',
    function: { name: '${name}', parameters: { type: 'object', properties: {} } },
  },
  code: 'return 1',
})
`
}

function skillFile(name: string): string {
  return `---\nname: ${name}\ndescription: "A fixture skill"\n---\nWrite like a person.\n`
}

const FIRST = {
  'tools/lookup.ts': tool('Lookup order', 'lookup_order'),
  'skills/tone.md': skillFile('tone'),
}
const SECOND = {
  'tools/refund.ts': tool('Refund order', 'refund_order'),
  'skills/brief.md': skillFile('brief'),
}

async function stored(workspaceId: string) {
  const [tools, skills] = await Promise.all([
    db
      .select({ title: customTools.title })
      .from(customTools)
      .where(eq(customTools.workspaceId, workspaceId)),
    db.select({ name: skill.name }).from(skill).where(eq(skill.workspaceId, workspaceId)),
  ])
  return {
    tools: tools.map((row) => row.title).sort(),
    skills: skills.map((row) => row.name).sort(),
  }
}

async function leases(workspaceId: string) {
  return db
    .select({ token: workspaceSourceApplyLease.token })
    .from(workspaceSourceApplyLease)
    .where(eq(workspaceSourceApplyLease.workspaceId, workspaceId))
}

/** Each `workspace_source_applied` recorded for `workspaceId`: its outcome and error kind. */
function appliedEvents(workspaceId: string) {
  return posthogServerMockFns.mockCaptureServerEvent.mock.calls.flatMap(([, event, properties]) =>
    event === 'workspace_source_applied' && properties.workspace_id === workspaceId
      ? [{ outcome: properties.outcome, error_kind: properties.error_kind }]
      : []
  )
}

/** What `promise` rejects with, or `null` when it resolves. */
function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error
  )
}

beforeAll(async () => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'workflow-code'
  )
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Workspace source lease fixture',
    email: `${ownerId}@workspace-source-lease.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(async () => {
  await writeReport()
  await workspaces.cleanup()
  await db.delete(user).where(inArray(user.id, [ownerId]))
})

describe('workspace source: one apply at a time', () => {
  check(
    'a second apply while one is writing is refused SOURCE_BUSY and writes nothing',
    async () => {
      const workspaceId = await workspaces.create({ name: 'Concurrent applies', ownerId })
      let entered: () => void = () => {}
      const inside = new Promise<void>((resolve) => {
        entered = resolve
      })
      let open: () => void = () => {}
      const gate = new Promise<void>((resolve) => {
        open = resolve
      })
      const write = skillAdapter.apply.bind(skillAdapter)
      vi.spyOn(skillAdapter, 'apply')
        .mockImplementationOnce(async (change, ctx) => {
          entered()
          await gate
          return write(change, ctx)
        })
        .mockImplementation(write)

      // The first apply has written its tool and is part-way through.
      const first = keyRunner.apply(workspaceId, { files: FIRST })
      await inside
      expect(await stored(workspaceId)).toEqual({ tools: ['Lookup order'], skills: [] })

      const second = await rejection(keyRunner.apply(workspaceId, { files: SECOND }))
      expect(second).toBeInstanceOf(WorkspaceSourceBusyError)
      // A dry run never waits on, or is refused by, an apply in progress.
      const dryRun = await keyRunner.apply(workspaceId, { files: SECOND, dryRun: true })
      expect(dryRun.dryRun).toBe(true)

      open()
      const result = await first
      expect(result.failed).toBeUndefined()
      expect(await stored(workspaceId)).toEqual({ tools: ['Lookup order'], skills: ['tone'] })
      expect(await leases(workspaceId)).toEqual([])
      // One event per apply: the refused one, then the committed one; the dry run records none.
      expect(appliedEvents(workspaceId)).toEqual([
        { outcome: 'refused', error_kind: 'busy' },
        { outcome: 'committed', error_kind: undefined },
      ])
    }
  )

  check(
    'an apply refused for its errors records one refused event and leaves no lease',
    async () => {
      const workspaceId = await workspaces.create({ name: 'Refused apply', ownerId })

      const refused = await rejection(
        keyRunner.apply(workspaceId, { files: { 'tools/broken.ts': 'export default 1\n' } })
      )
      expect(refused).toBeInstanceOf(WorkspaceSourceRejectedError)
      expect(await leases(workspaceId)).toEqual([])
      expect(appliedEvents(workspaceId)).toEqual([{ outcome: 'refused', error_kind: 'rejected' }])
    }
  )

  check(
    'an apply started while another plans is refused SOURCE_BUSY, so the planning one writes all of itself',
    async () => {
      const workspaceId = await workspaces.create({ name: 'Apply while planning', ownerId })
      const plan = skillAdapter.plan.bind(skillAdapter)
      let concurrent: unknown = null
      vi.spyOn(skillAdapter, 'plan').mockImplementationOnce(async (desired, stored, ctx) => {
        // The first apply is planning; a second one creates the skill it is about to create.
        concurrent = await rejection(
          runner.apply(workspaceId, { files: { 'skills/tone.md': skillFile('tone') } })
        )
        return plan(desired, stored, ctx)
      })

      const result = await runner.apply(workspaceId, { files: FIRST })

      expect(concurrent).toBeInstanceOf(WorkspaceSourceBusyError)
      expect(result.failed).toBeUndefined()
      expect(result.applied.map(({ kind, key }) => `${kind}:${key}`)).toEqual([
        'custom-tool:lookup',
        'skill:tone',
      ])
      expect(await stored(workspaceId)).toEqual({ tools: ['Lookup order'], skills: ['tone'] })
      expect(await leases(workspaceId)).toEqual([])
    }
  )

  check('a failing apply gives the lease up, so the next apply writes', async () => {
    const workspaceId = await workspaces.create({ name: 'Failing apply', ownerId })
    vi.spyOn(skillAdapter, 'apply').mockRejectedValueOnce(new Error('storage went away'))

    const failed = await keyRunner.apply(workspaceId, { files: FIRST })
    expect(failed.failed).toMatchObject({ kind: 'skill', key: 'tone', code: 'E_APPLY_FAILED' })
    expect(await leases(workspaceId)).toEqual([])

    const retried = await keyRunner.apply(workspaceId, { files: FIRST, base: failed.base })
    expect(retried.failed).toBeUndefined()
    expect(await stored(workspaceId)).toEqual({ tools: ['Lookup order'], skills: ['tone'] })
    expect(appliedEvents(workspaceId)).toEqual([
      { outcome: 'partial', error_kind: 'E_APPLY_FAILED' },
      { outcome: 'committed', error_kind: undefined },
    ])
  })

  check(
    'an apply whose lease another apply took over stops as a failure applying again continues',
    async () => {
      const workspaceId = await workspaces.create({ name: 'Lease taken over', ownerId })
      const write = toolAdapter.apply.bind(toolAdapter)
      vi.spyOn(toolAdapter, 'apply').mockImplementationOnce(async (change, ctx) => {
        const written = await write(change, ctx)
        // This apply stalled past its lease, and another apply took the workspace over.
        await db
          .update(workspaceSourceApplyLease)
          .set({ token: generateId() })
          .where(eq(workspaceSourceApplyLease.workspaceId, workspaceId))
        return written
      })

      const stalled = await runner.apply(workspaceId, { files: FIRST })
      expect(stalled.failed).toMatchObject({ kind: 'skill', key: 'tone', code: 'E_APPLY_FAILED' })
      expect(await stored(workspaceId)).toEqual({ tools: ['Lookup order'], skills: [] })

      await db
        .delete(workspaceSourceApplyLease)
        .where(eq(workspaceSourceApplyLease.workspaceId, workspaceId))
      const retried = await runner.apply(workspaceId, { files: FIRST, base: stalled.base })
      expect(retried.failed).toBeUndefined()
      expect(await stored(workspaceId)).toEqual({ tools: ['Lookup order'], skills: ['tone'] })
    }
  )

  check(
    'a live lease refuses an apply, and an expired one (a dead process) is taken over',
    async () => {
      const workspaceId = await workspaces.create({ name: 'Dead holder', ownerId })
      await db.insert(workspaceSourceApplyLease).values({
        workspaceId,
        token: generateId(),
        expiresAt: sql`now() + interval '1 minute'`,
      })
      const busy = await rejection(runner.apply(workspaceId, { files: FIRST }))
      expect(busy).toBeInstanceOf(WorkspaceSourceBusyError)
      expect(await stored(workspaceId)).toEqual({ tools: [], skills: [] })

      await db
        .update(workspaceSourceApplyLease)
        .set({ expiresAt: sql`now() - interval '1 second'` })
        .where(eq(workspaceSourceApplyLease.workspaceId, workspaceId))
      const taken = await runner.apply(workspaceId, { files: FIRST })
      expect(taken.failed).toBeUndefined()
      expect(await stored(workspaceId)).toEqual({ tools: ['Lookup order'], skills: ['tone'] })
      expect(await leases(workspaceId)).toEqual([])
    }
  )
})
