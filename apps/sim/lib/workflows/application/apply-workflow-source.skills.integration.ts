/**
 * Agent skills (`skill-input`) through source get and apply, against real PostgreSQL. The SDK
 * types the field as `SkillRef[]`, so a stored `{ skillId, name }` entry prints as
 * `skill('key')`, and `skill('key')` writes `{ skillId, name }` back: the shape the agent
 * handler reads `skillId` from and the canvas shows `name` from when the skill is gone. A
 * stored entry whose skill does not resolve is kept verbatim.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { db } from '@sim/db'
import { customTools, permissions, skill, user, workflow, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import type { BlockState } from '@sim/workflow-types/workflow'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import { applyWorkflowSource } from '@/lib/workflows/application/apply-workflow-source'
import { readSourceResources } from '@/lib/workflows/application/read-source-resources'
import { readWorkflowSource } from '@/lib/workflows/application/read-workflow-source'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { BUILTIN_SKILLS } from '@/lib/workflows/skills/builtin-skills'
import { resolveKeys } from '@/lib/workspaces/resource-keys'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

const ownerId = generateId()
const workspaceId = generateId()
const owner = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })

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

/** A workspace skill, with its resource key allocated as a prior source get would have. */
async function seedSkill(name: string): Promise<string> {
  const id = generateId()
  await db.insert(skill).values({
    id,
    workspaceId,
    userId: ownerId,
    name,
    description: `${name} skill`,
    content: `# ${name}`,
  })
  await resolveKeys(workspaceId, [{ kind: 'skill', id }], { createdBy: ownerId })
  return id
}

/** Start → Writer (an agent holding `skills`, and `tools` when given). */
async function seedWorkflow(skills: unknown, tools?: unknown[]) {
  const workflowId = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id: workflowId,
    userId: ownerId,
    workspaceId,
    name: `Skills ${workflowId}`,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  const start = seedBlock('start_trigger', 'Start')
  const writer = seedBlock('agent', 'Writer', {
    model: ['combobox', 'claude-sonnet-4-5'],
    messages: ['messages-input', [{ role: 'user', content: 'Write.' }]],
    skills: ['skill-input', skills],
    ...(tools ? { tools: ['tool-input', tools] as [string, unknown] } : {}),
  })
  const saved = await saveWorkflowToNormalizedTables(workflowId, {
    blocks: { [start.id]: start, [writer.id]: writer },
    edges: [{ id: generateId(), source: start.id, target: writer.id }],
    loops: {},
    parallels: {},
  })
  if (!saved.success) throw new Error(`Seeding the workflow failed: ${saved.error}`)
  return { workflowId, writerId: writer.id }
}

function getSource(workflowId: string) {
  return withPermissionGroupScope(() =>
    readWorkflowSource.execute({
      principal: owner,
      input: { workflowId, functionCode: 'inline' },
    })
  )
}

function apply(source: Awaited<ReturnType<typeof getSource>>, files: Record<string, string>) {
  return withPermissionGroupScope(() =>
    applyWorkflowSource.execute({
      principal: owner,
      input: { workflowId: source.workflowId, files, lock: source.lock, base: source.base },
    })
  )
}

function edit(files: Record<string, string>, from: string, to: string): Record<string, string> {
  const text = files['workflow.ts']
  expect(text.split(from), `workflow.ts holds "${from}" once`).toHaveLength(2)
  return { ...files, 'workflow.ts': text.replace(from, to) }
}

async function storedSkills(workflowId: string, blockId: string) {
  const stored = await loadWorkflowFromNormalizedTables(workflowId)
  return stored?.blocks[blockId]?.subBlocks.skills?.value
}

async function storedTools(workflowId: string, blockId: string) {
  const stored = await loadWorkflowFromNormalizedTables(workflowId)
  return stored?.blocks[blockId]?.subBlocks.tools?.value
}

beforeAll(async () => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'workflow-code'
  )
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Skills fixture',
    email: `${ownerId}@skills.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Skills',
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
    process.env.WORKFLOW_SOURCE_SKILLS_REPORT_PATH ??
    resolve('test-results/workflow-source-skills.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  await db.delete(skill).where(eq(skill.workspaceId, workspaceId))
  await db.delete(customTools).where(eq(customTools.workspaceId, workspaceId))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(user).where(eq(user.id, ownerId))
})

check(
  'a stored skill prints as skill(key), and an unresolvable one stays verbatim and round-trips',
  async () => {
    const toneId = await seedSkill('Tone')
    const gone = { skillId: generateId(), name: 'Deleted skill' }
    const stored = [{ skillId: toneId, name: 'Tone (old name)' }, gone]
    const { workflowId, writerId } = await seedWorkflow(stored)

    const source = await getSource(workflowId)

    const text = source.files['workflow.ts']
    expect(text).toContain("skill('tone')")
    expect(text).not.toContain(toneId)
    expect(text).toContain(`raw({ name: 'Deleted skill', skillId: '${gone.skillId}' })`)
    const noop = await apply(source, source.files)
    expect(noop.applied).toBe(false)
    expect(await storedSkills(workflowId, writerId)).toEqual(stored)
  }
)

check("writing skill(key) stores { skillId, name } with the skill's current name", async () => {
  const toneId = await seedSkill('Tone 2')
  const briefId = await seedSkill('Brief')
  const { workflowId, writerId } = await seedWorkflow([])
  const source = await getSource(workflowId)
  const written = edit(source.files, 'skills: []', "skills: [skill('tone-2'), skill('brief')]")
  written['workflow.ts'] = written['workflow.ts'].replace(/^import \{ /m, 'import { skill, ')

  const applied = await apply(source, written)

  expect(applied.applied).toBe(true)
  expect(await storedSkills(workflowId, writerId)).toEqual([
    { skillId: toneId, name: 'Tone 2' },
    { skillId: briefId, name: 'Brief' },
  ])
  const again = await getSource(workflowId)
  expect(again.files['workflow.ts']).toContain("skills: [skill('tone-2'), skill('brief')]")
})

check('adding a skill keeps the stored name of an entry the list already held', async () => {
  const styleId = await seedSkill('Style')
  const outlineId = await seedSkill('Outline')
  const { workflowId, writerId } = await seedWorkflow([
    { skillId: styleId, name: 'Style (old name)' },
  ])
  const source = await getSource(workflowId)

  const applied = await apply(
    source,
    edit(source.files, "skill('style')", "skill('outline'), skill('style')")
  )

  expect(applied.applied).toBe(true)
  expect(await storedSkills(workflowId, writerId)).toEqual([
    { skillId: outlineId, name: 'Outline' },
    { skillId: styleId, name: 'Style (old name)' },
  ])
})

check('naming a skill key that does not exist is refused', async () => {
  const toneId = await seedSkill('Tone 3')
  const { workflowId, writerId } = await seedWorkflow([{ skillId: toneId, name: 'Tone 3' }])
  const source = await getSource(workflowId)

  await expect(
    apply(source, edit(source.files, "skill('tone-3')", "skill('no-such-skill')"))
  ).rejects.toMatchObject({
    diagnostics: expect.arrayContaining([
      expect.objectContaining({ code: 'E_MAT_UNKNOWN_RESOURCE' }),
    ]),
  })
  expect(await storedSkills(workflowId, writerId)).toEqual([{ skillId: toneId, name: 'Tone 3' }])
})

check(
  'a skill and a custom tool no source has named apply by the keys the resource manifest lists',
  async () => {
    const skillId = generateId()
    await db.insert(skill).values({
      id: skillId,
      workspaceId,
      userId: ownerId,
      name: 'Listed only',
      description: 'Never referenced',
      content: '# Listed only',
    })
    const toolId = generateId()
    await db.insert(customTools).values({
      id: toolId,
      workspaceId,
      userId: ownerId,
      title: 'listed_lookup',
      schema: { type: 'function', function: { name: 'listed_lookup', parameters: {} } },
      code: 'return 1',
    })
    const manifest = await withPermissionGroupScope(() =>
      readSourceResources.execute({ principal: owner, input: { workspaceId } })
    )
    const { workflowId, writerId } = await seedWorkflow([], [])
    const source = await getSource(workflowId)
    const written = edit(
      edit(source.files, 'skills: []', "skills: [skill('listed-only')]"),
      'tools: []',
      "tools: [customTool('listed-lookup')]"
    )
    written['workflow.ts'] = written['workflow.ts'].replace(
      /^import \{ /m,
      'import { customTool, skill, '
    )

    const applied = await apply(source, written)

    expect(applied.applied).toBe(true)
    expect(await storedSkills(workflowId, writerId)).toEqual([{ skillId, name: 'Listed only' }])
    expect(await storedTools(workflowId, writerId)).toEqual([
      expect.objectContaining({ type: 'custom-tool', customToolId: toolId }),
    ])
    expect(manifest.skills).toContainEqual({ key: 'listed-only', id: skillId, name: 'Listed only' })
    expect(manifest.customTools).toContainEqual({
      key: 'listed-lookup',
      id: toolId,
      name: 'listed_lookup',
    })
  }
)

check(
  'a built-in skill stays verbatim with no unresolved-id warning, and a re-apply keeps it',
  async () => {
    const [builtin] = BUILTIN_SKILLS
    const toneId = await seedSkill('Tone 4')
    const stored = [
      { skillId: builtin.id, name: builtin.name },
      { skillId: toneId, name: 'Tone 4' },
    ]
    const { workflowId, writerId } = await seedWorkflow(stored)

    const source = await getSource(workflowId)

    const text = source.files['workflow.ts']
    expect(text).toContain(`raw({ name: '${builtin.name}', skillId: '${builtin.id}' })`)
    expect(text).toContain("skill('tone-4')")
    expect(source.diagnostics.filter((d) => d.code === 'W_CANON_UNRESOLVED_ID')).toEqual([])
    const noop = await apply(source, source.files)
    expect(noop.applied).toBe(false)
    const written = await apply(source, edit(source.files, "skill('tone-4'),", ''))
    expect(written.applied).toBe(true)
    expect(await storedSkills(workflowId, writerId)).toEqual([stored[0]])
  }
)
