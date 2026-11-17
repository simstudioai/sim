/**
 * Real PostgreSQL coverage for custom tools and skills as workspace source: each check applies a
 * directory through `applyWorkspaceSource` in its own workspace and reads the stored rows
 * directly, so "nothing was written" means the rows are unchanged. Writes a report to
 * `WORKSPACE_SOURCE_TOOLS_REPORT_PATH`.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { auditLog, customTools, permissions, skill, user, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import {
  createSessionPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  createWorkspaceCustomToolUseCase,
  updateWorkspaceCustomToolUseCase,
} from '@/lib/custom-tools/application/use-cases'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import { createSkillUseCase, updateSkillUseCase } from '@/lib/skills/application/use-cases'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import {
  type ApplyWorkspaceSourceInput,
  applyWorkspaceSource,
} from '@/lib/workspace-source/application/apply-workspace-source'
import { WorkspaceSourceRejectedError } from '@/lib/workspace-source/application/errors'
import { readWorkspaceSource } from '@/lib/workspace-source/application/read-workspace-source'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

const ownerId = generateId()
const writerId = generateId()
const owner = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
const writer = createSessionPrincipal({ userId: writerId, sessionId: generateId() })
const workspaceIds: string[] = []
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

const LOOKUP = `// @sim-sdk 1
import { codeFile, defineTool } from '@sim/workflow-sdk/workspace'

export default defineTool({
  title: 'Lookup order',
  schema: {
    type: 'function',
    function: {
      name: 'lookup_order',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string' },
        },
      },
    },
  },
  code: codeFile('./lookup.js'),
})
`

const LOOKUP_CODE = `const res = await fetch(\`https://orders.example/\${orderId}?key=\${$env.ORDERS_KEY}\`)
return res.json()
`

const TONE = '---\nname: tone\ndescription: "Voice: short and warm"\n---\nWrite like a person.\n'

const SUPPORT = `// @sim-sdk 1
import { agent, customTool, t, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Support', {}, () => {
  const start = trigger.start('Start', { inputFormat: { question: 'string' } })
  const answer = agent('Answer', {
    model: 'claude-sonnet-5-5',
    messages: [{ role: 'user', content: t\`\${start.question}\` }],
    tools: [customTool('lookup')],
  })

  start.to(answer)
})
`

const SUPPORT_WITH_SKILL = SUPPORT.replace(
  "import { agent, customTool, t, trigger, workflow } from '@sim/workflow-sdk'",
  "import { agent, customTool, skill, t, trigger, workflow } from '@sim/workflow-sdk'"
).replace(
  "tools: [customTool('lookup')],",
  "tools: [customTool('lookup')],\n    skills: [skill('tone')],"
)

/**
 * A schema an older write path stored: it meets the storage shape but not today's write rule (a
 * function name with a space), so only a declaration that changes it may be held to that rule.
 */
const LEGACY_SCHEMA = {
  type: 'function',
  function: { name: 'has spaces', parameters: { type: 'object', properties: {} } },
}

const TOOLS: Record<string, string> = { 'tools/lookup.ts': LOOKUP, 'tools/lookup.js': LOOKUP_CODE }
const SKILLS: Record<string, string> = { 'skills/tone.md': TONE }

async function newWorkspace(): Promise<string> {
  const workspaceId = generateId()
  workspaceIds.push(workspaceId)
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Workspace source tools',
    ownerId,
    billedAccountUserId: ownerId,
  })
  await db.insert(permissions).values([
    {
      id: generateId(),
      userId: ownerId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin',
    },
    {
      id: generateId(),
      userId: writerId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'write',
    },
  ])
  return workspaceId
}

type ApplyOptions = Partial<Omit<ApplyWorkspaceSourceInput, 'workspaceId' | 'files'>> & {
  principal?: Principal
}

function apply(workspaceId: string, files: Record<string, string>, options: ApplyOptions = {}) {
  const { principal = owner, ...input } = options
  return withPermissionGroupScope(() =>
    applyWorkspaceSource.execute({
      principal,
      input: { workspaceId, files, kinds: ['custom-tool', 'skill'], ...input },
    })
  )
}

function get(workspaceId: string, principal: Principal = owner) {
  return withPermissionGroupScope(() =>
    readWorkspaceSource.execute({
      principal,
      input: { workspaceId, kinds: ['custom-tool', 'skill'] },
    })
  )
}

async function refusal(promise: Promise<unknown>): Promise<WorkspaceSourceRejectedError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  )
  expect(error).toBeInstanceOf(WorkspaceSourceRejectedError)
  return error as WorkspaceSourceRejectedError
}

function codes(diagnostics: ReadonlyArray<{ code: string; severity: string }>, severity = 'error') {
  return diagnostics
    .filter((finding) => finding.severity === severity)
    .map((finding) => finding.code)
}

function actions(plan: ReadonlyArray<{ kind: string; key: string; action: string }>) {
  return plan.map(({ kind, key, action }) => `${action} ${kind}:${key}`)
}

/** Every stored tool and skill, with update times: what "nothing was written" compares. */
async function snapshot(workspaceId: string) {
  const [toolRows, skillRows] = await Promise.all([
    db.select().from(customTools).where(eq(customTools.workspaceId, workspaceId)),
    db.select().from(skill).where(eq(skill.workspaceId, workspaceId)),
  ])
  return {
    tools: toolRows.map(({ id, title, schema, code, updatedAt }) => ({
      id,
      title,
      schema,
      code,
      updatedAt: updatedAt.getTime(),
    })),
    skills: skillRows.map(({ id, name, description, content, updatedAt }) => ({
      id,
      name,
      description,
      content,
      updatedAt: updatedAt.getTime(),
    })),
  }
}

/** A workspace holding the starter tool and skill, read back as a directory. */
async function setUp(workspaceId: string) {
  const created = await apply(workspaceId, { ...TOOLS, ...SKILLS })
  expect(created.failed).toBeUndefined()
  return get(workspaceId)
}

beforeAll(async () => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'workflow-code'
  )
  const now = new Date()
  await db.insert(user).values(
    [ownerId, writerId].map((id) => ({
      id,
      name: 'Workspace source tools fixture',
      email: `${id}@workspace-source-tools.invalid`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
})

afterAll(async () => {
  const reportPath =
    process.env.WORKSPACE_SOURCE_TOOLS_REPORT_PATH ??
    resolve('test-results/workspace-source-tools.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  if (workspaceIds.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.workspaceId, workspaceIds))
    await deleteWorkspaceFixture(db, inArray(workspace.id, workspaceIds))
  }
  await db.delete(user).where(inArray(user.id, [ownerId, writerId]))
})

describe('workspace source: custom tools and skills', () => {
  check('creates a tool and the workflow that uses it in one apply', async () => {
    const workspaceId = await newWorkspace()
    const files = { ...TOOLS, 'workflows/support/workflow.ts': SUPPORT }
    const kinds: ApplyWorkspaceSourceInput['kinds'] = ['custom-tool', 'workflow']

    const dryRun = await apply(workspaceId, files, { kinds, dryRun: true })
    expect(codes(dryRun.diagnostics)).toEqual([])
    expect(actions(dryRun.plan)).toEqual(['create custom-tool:lookup', 'create workflow:support'])
    expect((await snapshot(workspaceId)).tools).toEqual([])

    const result = await apply(workspaceId, files, { kinds })

    expect(result.failed).toBeUndefined()
    const [tool] = (await snapshot(workspaceId)).tools
    expect(tool.title).toBe('Lookup order')
    expect(tool.code).toBe(LOOKUP_CODE.replace('$env.ORDERS_KEY', '{{ORDERS_KEY}}'))
    const workflowId = result.base.resources['workflow:support']?.id ?? ''
    const state = await loadWorkflowFromNormalizedTables(workflowId)
    const agentTools = Object.values(state?.blocks ?? {}).flatMap((block) => {
      const value = block.subBlocks?.tools?.value
      return Array.isArray(value) ? value : []
    })
    expect(agentTools).toContainEqual(expect.objectContaining({ customToolId: tool.id }))
    expect(result.base.resources['custom-tool:lookup']?.id).toBe(tool.id)
    expect(result.files['tools/lookup.js']).toBe(LOOKUP_CODE)
  })

  check(
    'a get reproduces the apply byte for byte, and re-applying it changes nothing',
    async () => {
      const workspaceId = await newWorkspace()
      const created = await apply(workspaceId, { ...TOOLS, ...SKILLS })
      const read = await get(workspaceId)
      expect(read.files).toEqual({ ...TOOLS, ...SKILLS })
      expect(read.files).toEqual(created.files)
      expect(read.base).toEqual(created.base)
      const before = await snapshot(workspaceId)

      const again = await apply(workspaceId, read.files, { base: read.base })

      expect(actions(again.plan)).toEqual(['noop custom-tool:lookup', 'noop skill:tone'])
      expect(again.applied).toEqual([])
      expect(await snapshot(workspaceId)).toEqual(before)
    }
  )

  check('applies edits to a tool and a skill through their use cases', async () => {
    const workspaceId = await newWorkspace()
    const read = await setUp(workspaceId)
    const files = {
      ...read.files,
      'tools/lookup.ts': read.files['tools/lookup.ts'].replace('Lookup order', 'Find order'),
      'tools/lookup.js': 'return { orderId }\n',
      'skills/tone.md': read.files['skills/tone.md'].replace('Write like a person.', 'Be brief.'),
    }

    const result = await apply(workspaceId, files, { base: read.base })

    expect(result.applied.map(({ action, key, fields }) => [action, key, fields])).toEqual([
      ['update', 'lookup', ['title', 'code']],
      ['update', 'tone', ['content']],
    ])
    const { tools, skills } = await snapshot(workspaceId)
    expect(tools[0]).toMatchObject({ title: 'Find order', code: 'return { orderId }\n' })
    expect(skills[0]).toMatchObject({ name: 'tone', content: 'Be brief.\n' })
    expect(result.files).toEqual(files)
  })

  check('refuses an edit to a tool or skill changed on the server since the get', async () => {
    const workspaceId = await newWorkspace()
    const read = await setUp(workspaceId)
    const { tools, skills } = await snapshot(workspaceId)
    await updateWorkspaceCustomToolUseCase.execute({
      principal: owner,
      input: { workspaceId, toolId: tools[0].id, code: 'return 1' },
    })
    await updateSkillUseCase.execute({
      principal: owner,
      input: { workspaceId, skillId: skills[0].id, content: 'Edited in the UI' },
    })
    const before = await snapshot(workspaceId)
    const files = {
      ...read.files,
      'tools/lookup.js': 'return 2\n',
      'skills/tone.md': read.files['skills/tone.md'].replace('Write like', 'Talk like'),
    }

    const stale = await refusal(apply(workspaceId, files, { base: read.base }))

    expect(stale.code).toBe('conflict')
    expect(codes(stale.diagnostics)).toEqual(['E_APPLY_STALE', 'E_APPLY_STALE'])
    expect(await snapshot(workspaceId)).toEqual(before)

    const untouched = await apply(workspaceId, read.files, { base: read.base })
    expect(untouched.applied).toEqual([])
    expect(codes(untouched.diagnostics, 'info')).toEqual(['I_SERVER_CHANGED', 'I_SERVER_CHANGED'])
  })

  check('refuses a title another tool holds, naming its key, and an invalid schema', async () => {
    const workspaceId = await newWorkspace()
    await setUp(workspaceId)
    const before = await snapshot(workspaceId)

    const taken = await refusal(
      apply(
        workspaceId,
        { 'tools/other.ts': LOOKUP.replace('./lookup.js', './other.js'), 'tools/other.js': '' },
        { kinds: ['custom-tool'] }
      )
    )

    const finding = taken.diagnostics.find((entry) => entry.code === 'E_NAME_TAKEN')
    expect(finding?.message).toContain('"lookup"')
    expect(finding?.file).toBe('tools/other.ts')

    const invalid = await refusal(
      apply(
        workspaceId,
        {
          'tools/bad.ts': LOOKUP.replace('./lookup.js', './bad.js')
            .replace('Lookup order', 'Bad')
            .replace("name: 'lookup_order'", "name: 'has spaces!'"),
          'tools/bad.js': '',
          ...TOOLS,
        },
        { kinds: ['custom-tool'] }
      )
    )
    expect(codes(invalid.diagnostics)).toContain('E_TOOL_SCHEMA')

    const twins = await refusal(
      apply(
        workspaceId,
        {
          ...TOOLS,
          'tools/a.ts': LOOKUP.replace('./lookup.js', './a.js').replace('Lookup order', 'Twin'),
          'tools/a.js': '',
          'tools/b.ts': LOOKUP.replace('./lookup.js', './b.js').replace('Lookup order', 'Twin'),
          'tools/b.js': '',
        },
        { kinds: ['custom-tool'] }
      )
    )
    expect(twins.diagnostics.find((entry) => entry.code === 'E_NAME_TAKEN')).toMatchObject({
      key: 'b',
      message: expect.stringContaining('tools/a, declared in this directory too'),
    })
    expect(await snapshot(workspaceId)).toEqual(before)
  })

  check(
    'refuses deleting a tool without --allow-delete, warning with the workflows that use it',
    async () => {
      const workspaceId = await newWorkspace()
      const kinds: ApplyWorkspaceSourceInput['kinds'] = ['custom-tool', 'workflow']
      const created = await apply(
        workspaceId,
        { ...TOOLS, 'workflows/support/workflow.ts': SUPPORT },
        { kinds }
      )
      expect(created.failed).toBeUndefined()
      const before = await snapshot(workspaceId)

      const refused = await refusal(
        apply(workspaceId, {}, { kinds: ['custom-tool'], base: created.base })
      )

      expect(codes(refused.diagnostics)).toEqual(['E_APPLY_DELETE_NOT_ALLOWED'])
      expect(
        refused.diagnostics.find((finding) => finding.code === 'W_TOOL_IN_USE')?.message
      ).toContain('"Support"')
      expect(await snapshot(workspaceId)).toEqual(before)

      const dryRun = await apply(
        workspaceId,
        {},
        {
          kinds: ['custom-tool'],
          base: created.base,
          allowDelete: true,
          dryRun: true,
        }
      )
      expect(dryRun.plan).toMatchObject([
        { action: 'delete', key: 'lookup', destructive: { counts: { workflows: 1 } } },
      ])

      const deleted = await apply(
        workspaceId,
        {},
        {
          kinds: ['custom-tool'],
          base: created.base,
          allowDelete: true,
        }
      )
      expect(actions(deleted.applied)).toEqual(['delete custom-tool:lookup'])
      expect(codes(deleted.diagnostics, 'warning')).toContain('W_TOOL_IN_USE')
      expect((await snapshot(workspaceId)).tools).toEqual([])
      expect(deleted.base.resources['custom-tool:lookup']).toBeUndefined()
    }
  )

  check(
    'refuses skills to a workspace API key at plan time, which may still apply tools alone',
    async () => {
      const workspaceId = await newWorkspace()
      const key = createWorkspaceApiKeyPrincipal({ workspaceId, keyId: generateId() })

      const refused = await refusal(apply(workspaceId, { ...TOOLS, ...SKILLS }, { principal: key }))

      expect(codes(refused.diagnostics)).toEqual(['E_APPLY_FORBIDDEN'])
      expect(refused.diagnostics.find((finding) => finding.severity === 'error')).toMatchObject({
        kind: 'skill',
      })
      expect(await snapshot(workspaceId)).toEqual({ tools: [], skills: [] })

      const toolsOnly = await apply(
        workspaceId,
        { ...TOOLS, ...SKILLS },
        { principal: key, only: ['custom-tool'] }
      )
      expect(actions(toolsOnly.applied)).toEqual(['create custom-tool:lookup'])
    }
  )

  check(
    'refuses a member without editor rights an edit or delete of a skill before writing',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      const before = await snapshot(workspaceId)
      const edited = {
        ...read.files,
        'skills/tone.md': read.files['skills/tone.md'].replace('Write like', 'Talk like'),
      }

      const update = await refusal(
        apply(workspaceId, edited, { principal: writer, base: read.base })
      )
      expect(update.code).toBe('validation')
      expect(update.diagnostics.find((finding) => finding.severity === 'error')).toMatchObject({
        code: 'E_APPLY_FORBIDDEN',
        kind: 'skill',
        key: 'tone',
      })

      const remove = await refusal(
        apply(workspaceId, TOOLS, { principal: writer, base: read.base, allowDelete: true })
      )
      expect(codes(remove.diagnostics)).toEqual(['E_APPLY_FORBIDDEN'])
      expect(await snapshot(workspaceId)).toEqual(before)

      const ownSkill = await apply(
        workspaceId,
        { ...read.files, 'skills/voice.md': TONE.replace('name: tone', 'name: voice') },
        { principal: writer, base: read.base }
      )
      expect(actions(ownSkill.applied)).toEqual(['create skill:voice'])
    }
  )

  check(
    'keeps a deleted skill deleted, re-claims its key without a base entry, and adopts an unbound skill by name',
    async () => {
      const workspaceId = await newWorkspace()
      const read = await setUp(workspaceId)
      const [first] = (await snapshot(workspaceId)).skills
      await db.delete(skill).where(eq(skill.id, first.id))

      const untouched = await apply(workspaceId, read.files, { base: read.base })
      expect(untouched.applied).toEqual([])
      expect(codes(untouched.diagnostics, 'info')).toContain('I_SERVER_DELETED')
      expect((await snapshot(workspaceId)).skills).toEqual([])

      const { 'skill:tone': _deleted, ...resources } = read.base.resources
      const recreated = await apply(workspaceId, read.files, { base: { ...read.base, resources } })

      expect(actions(recreated.applied)).toEqual(['create skill:tone'])
      const [second] = (await snapshot(workspaceId)).skills
      expect(second.id).not.toBe(first.id)

      const fresh = await newWorkspace()
      const { tool } = await createWorkspaceCustomToolUseCase.execute({
        principal: owner,
        input: {
          workspaceId: fresh,
          title: 'Lookup order',
          schema: {
            type: 'function',
            function: { name: 'old', parameters: { type: 'object', properties: {} } },
          },
          code: 'return 1',
        },
      })
      const { skill: unbound } = await createSkillUseCase.execute({
        principal: owner,
        input: { workspaceId: fresh, name: 'tone', description: 'Old', content: 'Old' },
      })
      const adopted = await apply(fresh, {
        'tools/orders.ts': LOOKUP.replace('./lookup.js', './orders.js'),
        'tools/orders.js': 'return 0\n',
        'skills/style.md': TONE,
      })
      expect(adopted.applied).toMatchObject([
        { action: 'adopt', kind: 'custom-tool', key: 'orders', id: tool.id },
        { action: 'adopt', kind: 'skill', key: 'style', id: unbound.id },
      ])
    }
  )

  check('applies a workflow using a tool and a skill the same apply adopts', async () => {
    const workspaceId = await newWorkspace()
    const { tool } = await createWorkspaceCustomToolUseCase.execute({
      principal: owner,
      input: {
        workspaceId,
        title: 'Lookup order',
        schema: {
          type: 'function',
          function: { name: 'old', parameters: { type: 'object', properties: {} } },
        },
        code: 'return 1',
      },
    })
    const { skill: adoptedSkill } = await createSkillUseCase.execute({
      principal: owner,
      input: { workspaceId, name: 'tone', description: 'Old', content: 'Old' },
    })
    const files = { ...TOOLS, ...SKILLS, 'workflows/support/workflow.ts': SUPPORT_WITH_SKILL }
    const kinds: ApplyWorkspaceSourceInput['kinds'] = ['custom-tool', 'skill', 'workflow']

    const dryRun = await apply(workspaceId, files, { kinds, dryRun: true })
    expect(codes(dryRun.diagnostics)).toEqual([])

    const result = await apply(workspaceId, files, { kinds })
    expect(result.failed).toBeUndefined()
    expect(actions(result.applied)).toEqual([
      'adopt custom-tool:lookup',
      'adopt skill:tone',
      'create workflow:support',
    ])
    const state = await loadWorkflowFromNormalizedTables(
      result.base.resources['workflow:support']?.id ?? ''
    )
    const agentTools = Object.values(state?.blocks ?? {}).flatMap((block) => {
      const value = block.subBlocks?.tools?.value
      return Array.isArray(value) ? value : []
    })
    expect(agentTools).toContainEqual(expect.objectContaining({ customToolId: tool.id }))
    const agentSkills = Object.values(state?.blocks ?? {}).flatMap((block) => {
      const value = block.subBlocks?.skills?.value
      return Array.isArray(value) ? value : []
    })
    expect(agentSkills).toEqual([{ skillId: adoptedSkill.id, name: 'tone' }])
  })

  check(
    'leaves a legacy tool schema alone: a re-apply is a no-op and a title edit applies',
    async () => {
      const workspaceId = await newWorkspace()
      await db.insert(customTools).values({
        id: generateId(),
        workspaceId,
        userId: ownerId,
        title: 'Legacy',
        schema: LEGACY_SCHEMA,
        code: 'return 1',
      })
      const read = await get(workspaceId)
      expect(read.skipped).toEqual([])
      const before = await snapshot(workspaceId)

      const again = await apply(workspaceId, read.files, { base: read.base })
      expect(again.plan.map(({ action }) => action)).toEqual(['noop'])
      expect(await snapshot(workspaceId)).toEqual(before)

      const declaration = Object.keys(read.files).find((path) => path.endsWith('.ts')) ?? ''
      const renamed = await apply(
        workspaceId,
        { ...read.files, [declaration]: read.files[declaration].replace('Legacy', 'Renamed') },
        { base: read.base }
      )
      expect(renamed.failed).toBeUndefined()
      expect(renamed.applied.map(({ action, fields }) => [action, fields])).toEqual([
        ['update', ['title']],
      ])
      expect((await snapshot(workspaceId)).tools[0]).toMatchObject({
        title: 'Renamed',
        schema: LEGACY_SCHEMA,
      })
    }
  )

  check(
    'leaves a legacy skill name alone: a re-apply is a no-op and a content edit applies',
    async () => {
      const workspaceId = await newWorkspace()
      await db.insert(skill).values({
        id: generateId(),
        workspaceId,
        userId: ownerId,
        name: 'Legacy Skill',
        description: 'Old',
        content: 'Old',
      })
      const read = await get(workspaceId)
      expect(read.skipped).toEqual([])
      const before = await snapshot(workspaceId)

      const again = await apply(workspaceId, read.files, { base: read.base })
      expect(again.plan.map(({ action }) => action)).toEqual(['noop'])
      expect(await snapshot(workspaceId)).toEqual(before)

      const [path] = Object.keys(read.files)
      const edited = await apply(
        workspaceId,
        { [path]: read.files[path].replace(/Old$/, 'New\n') },
        { base: read.base }
      )
      expect(edited.failed).toBeUndefined()
      expect(edited.applied.map(({ action, fields }) => [action, fields])).toEqual([
        ['update', ['content']],
      ])
      expect((await snapshot(workspaceId)).skills[0]).toMatchObject({
        name: 'Legacy Skill',
        content: 'New\n',
      })
    }
  )

  check('refuses an apply when the workspace holds more tools than one load reads', async () => {
    const workspaceId = await newWorkspace()
    const extra = WORKSPACE_SOURCE_LIMITS.maxResourcesPerKind + 101
    await db.insert(customTools).values(
      Array.from({ length: extra }, (_, index) => ({
        id: generateId(),
        workspaceId,
        userId: ownerId,
        title: `Bulk ${index}`,
        schema: LEGACY_SCHEMA,
        code: 'return 1',
      }))
    )

    const refused = await refusal(apply(workspaceId, TOOLS, { kinds: ['custom-tool'] }))

    expect(refused.diagnostics.filter((finding) => finding.severity === 'error')).toMatchObject([
      { code: 'E_APPLY_REFUSED', kind: 'custom-tool' },
    ])
    expect((await snapshot(workspaceId)).tools).toHaveLength(extra)
  })

  check('binds an adopted key only once its write succeeds', async () => {
    const workspaceId = await newWorkspace()
    await createWorkspaceCustomToolUseCase.execute({
      principal: owner,
      input: {
        workspaceId,
        title: 'Lookup order',
        schema: {
          type: 'function',
          function: { name: 'old', parameters: { type: 'object', properties: {} } },
        },
        code: 'return 1',
      },
    })
    await createSkillUseCase.execute({
      principal: owner,
      input: { workspaceId, name: 'tone', description: 'Old', content: 'Old' },
    })
    const raced = new OrchestrationError('conflict', 'Another write took this name.')
    const toolWrite = vi
      .spyOn(updateWorkspaceCustomToolUseCase, 'execute')
      .mockRejectedValueOnce(raced)
    const skillWrite = vi.spyOn(updateSkillUseCase, 'execute').mockRejectedValueOnce(raced)

    try {
      for (const files of [TOOLS, SKILLS]) {
        const failed = await apply(workspaceId, files)
        expect(failed.failed).toBeDefined()
        expect(failed.applied).toEqual([])

        const retried = await apply(workspaceId, files)
        expect(retried.failed).toBeUndefined()
        expect(retried.applied.map(({ action }) => action)).toEqual(['adopt'])
      }
    } finally {
      toolWrite.mockRestore()
      skillWrite.mockRestore()
    }
  })
})
