/**
 * Real PostgreSQL coverage for build notes: the agent-only notes and the baseline Sim keeps
 * beside them, the evaluation an agent build must pass, and the reconciliation a person's edit
 * forces. Each check names the failure it guards against.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { db, runOutsideTransactionContext } from '@sim/db'
import {
  auditLog,
  folder,
  permissions,
  user,
  userStats,
  workflow,
  workflowBlocks,
  workflowBuildNotes,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import {
  createDelegatedPrincipal,
  createSessionPrincipal,
} from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import type { BlockState } from '@sim/workflow-types/workflow'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import {
  applyBuildNotes,
  createBuildNotes,
  evaluateBuildNotes,
  getBuildNotesChanges,
  getBuildNotesStatus,
  listBuildNotesStates,
  rebaseBuildNotes,
} from '@/lib/build-notes/application/build-notes'
import { loadCurrentBaselineState } from '@/lib/build-notes/baseline'
import {
  createBuildNotesFiles,
  readBuildNotesFileText,
  writeBaseline,
} from '@/lib/build-notes/files'
import { recordBuildNotesEvaluation } from '@/lib/build-notes/repository'
import { observeContentDelivery } from '@/lib/core/application/content-delivery'
import { deleteFolder, restoreFolder } from '@/lib/folders/orchestration'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import { applyWorkflowOperations } from '@/lib/workflows/application/apply-workflow-operations'
import { WORKFLOW_DELEGATION_AUDIENCE } from '@/lib/workflows/application/authorization'
import { replaceWorkflowState } from '@/lib/workflows/application/replace-workflow-state'
import { archiveWorkflow, restoreWorkflow } from '@/lib/workflows/lifecycle'
import { WORKSPACE_FILES_DELEGATION_AUDIENCE } from '@/lib/workspace-files/application/authorization'
import { queryWorkspaceFilePage } from '@/lib/workspace-files/application/list-workspace-files'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'
import { updateWorkspaceFileContent } from '@/lib/workspace-files/application/update-workspace-file-content'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

const ownerId = generateId()
const workspaceId = generateId()
const person = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
const agent = createDelegatedPrincipal({
  subjectUserId: ownerId,
  workspaceId,
  delegationId: generateId(),
  audience: WORKFLOW_DELEGATION_AUDIENCE,
})
const agentFiles = createDelegatedPrincipal({
  subjectUserId: ownerId,
  workspaceId,
  delegationId: generateId(),
  audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
})

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

function block(
  id: string,
  type: string,
  name: string,
  subBlocks: BlockState['subBlocks'] = {}
): BlockState {
  return { id, type, name, position: { x: 0, y: 0 }, subBlocks, outputs: {}, enabled: true }
}

/** A workflow with only its Start block, as `workflows create` leaves it. */
async function seedWorkflow(
  extra: Record<string, BlockState> = {}
): Promise<{ workflowId: string; startId: string }> {
  const workflowId = generateId()
  const startId = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id: workflowId,
    userId: ownerId,
    workspaceId,
    name: `Build notes ${workflowId}`,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  const saved = await saveWorkflowToNormalizedTables(workflowId, {
    blocks: { [startId]: block(startId, 'start_trigger', 'Start'), ...extra },
    edges: [],
    loops: {},
    parallels: {},
  })
  if (!saved.success) throw new Error(`Seeding the workflow failed: ${saved.error}`)
  return { workflowId, startId }
}

/** A Function block wired from Start: a batch that dry-runs clean. */
function functionBatch(startId: string, slug: string, name = `Step ${slug}`) {
  return [
    {
      operation_type: 'add',
      block_id: slug,
      params: {
        type: 'function',
        name,
        inputs: { language: 'javascript', code: 'return { ok: true }' },
      },
    },
    { operation_type: 'edit', block_id: startId, params: { connections: { source: slug } } },
  ]
}

function notesWith(batch: unknown, openItems = '- [assume] Runs on manual start only') {
  return `# Build notes

## Request
Score each lead.

## Graph

\`\`\`json operations
${JSON.stringify(batch, null, 2)}
\`\`\`

## Open items
${openItems}
`
}

const target = (workflowId: string) => ({ workflowId, assertedWorkspaceId: workspaceId })

/** Every file id Chat's gate was asked to admit, and whether it admits them. */
const chatGate = { admitted: [] as string[], refuse: false }

/** Runs as Chat's tool surface does: under a content gate that decides what reaches the model. */
function viaChat<T>(execute: () => Promise<T>): Promise<T> {
  return observeContentDelivery(
    {
      async admit(sources) {
        chatGate.admitted.push(...sources.map((source) => source.id))
        return sources.map(() => !chatGate.refuse)
      },
    },
    execute
  )
}

const evaluate = (workflowId: string) =>
  viaChat(() => evaluateBuildNotes.execute({ principal: agent, input: target(workflowId) }))
const changesSince = (workflowId: string) =>
  viaChat(() => getBuildNotesChanges.execute({ principal: agent, input: target(workflowId) }))

async function createNotes(workflowId: string) {
  return createBuildNotes.execute({ principal: agent, input: target(workflowId) })
}

async function notesRow(workflowId: string) {
  const [row] = await db
    .select()
    .from(workflowBuildNotes)
    .where(eq(workflowBuildNotes.workflowId, workflowId))
  if (!row) throw new Error('No build notes row')
  return row
}

/** The agent's own write to a file, through the file tool's use case. */
function agentWrites(fileId: string, content: string) {
  return updateWorkspaceFileContent.execute({
    principal: agentFiles,
    input: { fileId, assertedWorkspaceId: workspaceId, content, encoding: 'utf-8' },
  })
}

async function writeNotes(workflowId: string, content: string) {
  await agentWrites((await notesRow(workflowId)).notesFileId, content)
}

function apply(principal: typeof agent | typeof person, workflowId: string, operations: unknown[]) {
  return withPermissionGroupScope(() =>
    applyWorkflowOperations.execute({
      principal,
      input: {
        workflowId,
        assertedWorkspaceId: workspaceId,
        operations: operations as Parameters<
          typeof applyWorkflowOperations.execute
        >[0]['input']['operations'],
      },
    })
  )
}

const applyNotes = (workflowId: string) =>
  viaChat(() =>
    withPermissionGroupScope(() =>
      applyBuildNotes.execute({ principal: agent, input: target(workflowId) })
    )
  )

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Build notes fixture',
    email: `${ownerId}@build-notes.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(userStats).values({ id: generateId(), userId: ownerId })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Build notes',
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

beforeEach(() => {
  chatGate.admitted.length = 0
  chatGate.refuse = false
  featureFlagsMockFns.mockIsFeatureEnabled.mockReset()
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'build-notes'
  )
})

afterAll(async () => {
  const reportPath = process.env.BUILD_NOTES_REPORT_PATH ?? resolve('test-results/build-notes.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  await db.delete(auditLog).where(eq(auditLog.workspaceId, workspaceId))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(userStats).where(eq(userStats.userId, ownerId))
  await db.delete(user).where(eq(user.id, ownerId))
})

check('creates the notes and their baseline as files no listing or person reaches', async () => {
  const { workflowId } = await seedWorkflow()
  const created = await createNotes(workflowId)
  expect(created).toMatchObject({
    notes: `build-notes/${workflowId}.md`,
    baseline: `build-notes/${workflowId}.baseline.json`,
  })
  const row = await notesRow(workflowId)
  const files = await db
    .select({ id: workspaceFiles.id, context: workspaceFiles.context })
    .from(workspaceFiles)
    .where(eq(workspaceFiles.workspaceId, workspaceId))
  const ids = [row.notesFileId, row.baselineFileId]
  expect(files.filter((file) => ids.includes(file.id)).map((file) => file.context)).toEqual([
    'build_notes',
    'build_notes',
  ])

  const listing = await queryWorkspaceFilePage.execute({
    principal: person,
    input: { workspaceId, recursive: true, sortBy: 'name', sortOrder: 'asc', limit: 100 },
  })
  expect(listing.files.map((file) => file.id)).not.toContain(row.notesFileId)
  await expect(
    readWorkspaceFileContent.execute({
      principal: person,
      input: { fileId: row.notesFileId, assertedWorkspaceId: workspaceId },
    })
  ).rejects.toMatchObject({ code: 'not_found' })
  await expect(
    updateWorkspaceFileContent.execute({
      principal: person,
      input: {
        fileId: row.notesFileId,
        assertedWorkspaceId: workspaceId,
        content: 'edited by a person',
        encoding: 'utf-8',
      },
    })
  ).rejects.toMatchObject({ code: 'not_found' })
  await expect(createNotes(workflowId)).rejects.toMatchObject({ code: 'conflict' })
})

check('the agent writes its notes but never the baseline Sim keeps', async () => {
  const { workflowId } = await seedWorkflow()
  await createNotes(workflowId)
  const row = await notesRow(workflowId)
  await expect(agentWrites(row.notesFileId, '# Draft\n')).resolves.toBeDefined()
  if (!row.baselineFileId) throw new Error('No baseline')
  await expect(agentWrites(row.baselineFileId, '{"blocks":{}}')).rejects.toMatchObject({
    code: 'forbidden',
  })
  await expect(agentWrites(row.notesFileId, 'x'.repeat(256 * 1024 + 1))).rejects.toMatchObject({
    code: 'payload_too_large',
  })
  await expect(agentWrites(row.notesFileId, 'before\u0000after')).rejects.toMatchObject({
    code: 'validation',
  })
})

check(
  'evaluation lists open placeholders and items and records nothing until they settle',
  async () => {
    const { workflowId, startId } = await seedWorkflow()
    await createNotes(workflowId)
    await writeNotes(
      workflowId,
      notesWith(
        functionBatch(startId, 'score', '<<open:block_name>>'),
        '- [ask] Which channel gets hot leads?'
      )
    )
    const failed = await evaluate(workflowId)
    expect(failed.passed).toBe(false)
    expect(failed.placeholders).toEqual(['block_name'])
    expect(failed.openItems).toEqual([{ mark: 'ask', text: 'Which channel gets hot leads?' }])
    expect((await notesRow(workflowId)).evaluatedNotesHash).toBeNull()

    await writeNotes(workflowId, notesWith(functionBatch(startId, 'score')))
    const passed = await evaluate(workflowId)
    expect(passed.problems).toEqual([])
    expect(passed).toMatchObject({ passed: true, assumedItems: 1 })
    await expect(
      getBuildNotesStatus.execute({ principal: agent, input: target(workflowId) })
    ).resolves.toMatchObject({ exists: true, evaluated: true })

    // The same notes fail once the block the batch wires from is gone; that withdraws the pass.
    await apply(person, workflowId, [{ operation_type: 'delete', block_id: startId }])
    expect((await evaluate(workflowId)).passed).toBe(false)
    expect((await notesRow(workflowId)).evaluatedNotesHash).toBeNull()
  }
)

check(
  'evaluation holds a build for lint its batch adds, never for lint already in the graph',
  async () => {
    const { workflowId, startId } = await seedWorkflow()
    await createNotes(workflowId)
    const loose = (slug: string, name: string) => ({
      operation_type: 'add',
      block_id: slug,
      params: { type: 'function', name, inputs: { language: 'javascript', code: 'return 1' } },
    })
    await apply(person, workflowId, [loose('draft', 'Draft by a person')])

    await writeNotes(workflowId, notesWith([loose('loose', 'Loose end')]))
    const held = await evaluate(workflowId)
    expect(held.passed).toBe(false)
    expect(held.dryRun?.lint).toEqual([expect.stringContaining('Loose end')])
    expect(held.dryRun?.lintAlreadyInGraph).toEqual([expect.stringContaining('Draft by a person')])

    await writeNotes(workflowId, notesWith(functionBatch(startId, 'wired')))
    const passed = await evaluate(workflowId)
    expect(passed.problems).toEqual([])
    expect(passed.dryRun?.lintAlreadyInGraph).toEqual([
      expect.stringContaining('Draft by a person'),
    ])
  }
)

check("notes Chat's content gate refuses are never evaluated or built from", async () => {
  const { workflowId, startId } = await seedWorkflow()
  await createNotes(workflowId)
  await writeNotes(workflowId, notesWith(functionBatch(startId, 'score')))
  const row = await notesRow(workflowId)
  chatGate.refuse = true
  await expect(evaluate(workflowId)).rejects.toMatchObject({ code: 'forbidden' })
  expect(chatGate.admitted).toEqual([row.notesFileId])
  expect((await notesRow(workflowId)).evaluatedNotesHash).toBeNull()
})

check(
  'an agent build applies exactly the evaluated block, then spends the evaluation',
  async () => {
    const { workflowId, startId } = await seedWorkflow()
    await createNotes(workflowId)
    await writeNotes(workflowId, notesWith(functionBatch(startId, 'score')))
    expect((await evaluate(workflowId)).problems).toEqual([])

    await expect(apply(agent, workflowId, functionBatch(startId, 'other'))).rejects.toMatchObject({
      code: 'conflict',
    })
    const built = await applyNotes(workflowId)
    expect(built).toMatchObject({ applied: 2, skipped: [], inputValidationErrors: [] })
    await expect(changesSince(workflowId)).resolves.toMatchObject({ hasChanges: false })
    const row = await notesRow(workflowId)
    expect(row.evaluatedNotesHash).toBeNull()
    await expect(applyNotes(workflowId)).rejects.toMatchObject({ code: 'conflict' })
  }
)

check('notes edited after their evaluation are refused at build time', async () => {
  const { workflowId, startId } = await seedWorkflow()
  await createNotes(workflowId)
  await writeNotes(workflowId, notesWith(functionBatch(startId, 'score')))
  expect((await evaluate(workflowId)).problems).toEqual([])
  await writeNotes(workflowId, notesWith(functionBatch(startId, 'score'), '- [ask] Who owns it?'))
  expect((await notesRow(workflowId)).evaluatedNotesHash).toBeNull()
  await expect(applyNotes(workflowId)).rejects.toMatchObject({ code: 'conflict' })
})

check("a person's edit lands, then holds the agent until it is reconciled", async () => {
  const { workflowId, startId } = await seedWorkflow()
  await createNotes(workflowId)
  await expect(apply(person, workflowId, functionBatch(startId, 'manual'))).resolves.toMatchObject({
    applied: 2,
  })
  const states = await listBuildNotesStates.execute({
    principal: person,
    input: { workspaceId, workflowIds: [workflowId] },
  })
  expect(states.get(workflowId)).toBe('changed')

  const [manual] = await db
    .select({ id: workflowBlocks.id })
    .from(workflowBlocks)
    .where(and(eq(workflowBlocks.workflowId, workflowId), eq(workflowBlocks.name, 'Step manual')))
  if (!manual) throw new Error("The person's block was not saved")
  await writeNotes(
    workflowId,
    notesWith([{ operation_type: 'edit', block_id: manual.id, params: { name: 'Step reviewed' } }])
  )
  expect((await evaluate(workflowId)).problems).toEqual([])
  await expect(applyNotes(workflowId)).rejects.toThrow(/changed outside the agent/)

  const changes = await changesSince(workflowId)
  expect(changes.hasChanges).toBe(true)
  expect(changes.diff.addedBlocks.map((added) => added.name)).toEqual(['Step manual'])

  await rebaseBuildNotes.execute({ principal: agent, input: target(workflowId) })
  expect(
    (
      await listBuildNotesStates.execute({
        principal: person,
        input: { workspaceId, workflowIds: [workflowId] },
      })
    ).get(workflowId)
  ).toBe('current')
  expect((await evaluate(workflowId)).problems).toEqual([])
  await expect(applyNotes(workflowId)).resolves.toMatchObject({ applied: 1 })
})

check(
  'evaluation reads open items under any list marker and keeps backticks inside the batch',
  async () => {
    const { workflowId, startId } = await seedWorkflow()
    await createNotes(workflowId)
    const [add, wire] = functionBatch(startId, 'fenced')
    const batch = [
      {
        ...add,
        params: {
          type: 'function',
          name: 'Fenced',
          inputs: { language: 'javascript', code: 'return "```"' },
        },
      },
      wire,
    ]
    await writeNotes(
      workflowId,
      `## Graph\n\n\`\`\`json operations\n${JSON.stringify(batch, null, 2)}\n\`\`\`\n\n## Open items:\n1. **[gather]** Which table holds leads?\n+ [ask]\n`
    )
    const reading = await evaluate(workflowId)
    expect(reading.dryRun?.operationCount).toBe(2)
    expect(reading.openItems).toEqual([
      { mark: 'gather', text: 'Which table holds leads?' },
      { mark: 'ask', text: '' },
    ])
    expect(reading.passed).toBe(false)
  }
)

check(
  'a whole-graph replace is refused for the agent on a workflow with notes, never for a person',
  async () => {
    const { workflowId, startId } = await seedWorkflow()
    await createNotes(workflowId)
    const replace = (principal: typeof agent | typeof person) =>
      withPermissionGroupScope(() =>
        replaceWorkflowState.execute({
          principal,
          input: {
            workflowId,
            assertedWorkspaceId: workspaceId,
            blocks: { [startId]: block(startId, 'start_trigger', 'Start') },
            edges: [],
          },
        })
      )
    await expect(replace(agent)).rejects.toThrow(/whole-graph replace is refused/)
    await expect(replace(person)).resolves.toBeDefined()
  }
)

check(
  'a credential switched in the editor is a change, without the baseline keeping either value',
  async () => {
    const gmailId = generateId()
    const credential = (value: string) => ({
      credential: { id: 'credential', type: 'oauth-input' as const, value },
    })
    const { workflowId } = await seedWorkflow({
      [gmailId]: {
        ...block(gmailId, 'gmail', 'Send mail', credential('cred-original')),
        // A legacy credential kept on the block's data, which sanitization also clears.
        data: { apiKey: 'key-original' } as BlockState['data'],
      },
    })
    await createNotes(workflowId)
    const row = await notesRow(workflowId)
    if (!row.baselineFileId) throw new Error('No baseline')
    const baselineText = await readBuildNotesFileText(workspaceId, row.baselineFileId, {
      maxBytes: 16 * 1024 * 1024,
    })
    expect(baselineText).not.toContain('cred-original')
    expect(baselineText).not.toContain('key-original')

    await db
      .update(workflowBlocks)
      .set({ subBlocks: credential('cred-switched'), data: { apiKey: 'key-switched' } })
      .where(eq(workflowBlocks.id, gmailId))
    const changes = await changesSince(workflowId)
    expect(changes.hasChanges).toBe(true)
    expect(changes.changedWithheldFields).toEqual([
      { blockId: gmailId, field: 'credential' },
      { blockId: gmailId, field: 'data.apiKey' },
    ])
    expect(JSON.stringify(changes)).not.toMatch(/cred-|key-/)
  }
)

check(
  'a verdict reached before a build finished cannot revive the approval that build spent',
  async () => {
    const { workflowId, startId } = await seedWorkflow()
    await createNotes(workflowId)
    await writeNotes(workflowId, notesWith(functionBatch(startId, 'score')))
    expect((await evaluate(workflowId)).passed).toBe(true)
    const evaluatedOn = await notesRow(workflowId)
    await applyNotes(workflowId)

    const revived = await recordBuildNotesEvaluation(
      evaluatedOn.id,
      {
        evaluatedNotesHash: evaluatedOn.evaluatedNotesHash ?? '',
        evaluatedOperationsHash: evaluatedOn.evaluatedOperationsHash ?? '',
      },
      { baselineWorkflowUpdatedAt: evaluatedOn.baselineWorkflowUpdatedAt }
    )
    expect(revived).toBe(false)
    expect((await notesRow(workflowId)).evaluatedNotesHash).toBeNull()
  }
)

check('a new baseline withdraws a verdict recorded between a build and its baseline', async () => {
  const { workflowId, startId } = await seedWorkflow()
  await createNotes(workflowId)
  await writeNotes(workflowId, notesWith(functionBatch(startId, 'score')))
  expect((await evaluate(workflowId)).passed).toBe(true)
  const evaluatedOn = await notesRow(workflowId)
  // A late verdict lands while the recorded baseline is still the one it was evaluated against.
  expect(
    await recordBuildNotesEvaluation(
      evaluatedOn.id,
      {
        evaluatedNotesHash: evaluatedOn.evaluatedNotesHash ?? '',
        evaluatedOperationsHash: evaluatedOn.evaluatedOperationsHash ?? '',
      },
      { baselineWorkflowUpdatedAt: evaluatedOn.baselineWorkflowUpdatedAt }
    )
  ).toBe(true)
  await apply(person, workflowId, functionBatch(startId, 'committed'))
  await writeBaseline(evaluatedOn, await loadCurrentBaselineState(workflowId), {
    userId: ownerId,
    source: 'copilot',
  })
  expect((await notesRow(workflowId)).evaluatedNotesHash).toBeNull()
})

check('notes created while their workflow is archived roll back with their files', async () => {
  const { workflowId } = await seedWorkflow()
  await archiveWorkflow(workflowId, { requestId: generateId(), notifySocket: false })
  const liveNotesFiles = async () =>
    (
      await db
        .select({ id: workspaceFiles.id })
        .from(workspaceFiles)
        .where(
          and(
            eq(workspaceFiles.workspaceId, workspaceId),
            eq(workspaceFiles.context, 'build_notes')
          )
        )
    ).length
  const before = await liveNotesFiles()
  await expect(
    createBuildNotesFiles({
      workspaceId,
      workflowId,
      workflowName: 'Archived',
      userId: ownerId,
      baseline: await loadCurrentBaselineState(workflowId),
    })
  ).rejects.toMatchObject({ code: 'not_found' })
  expect(await liveNotesFiles()).toBe(before)
  const rows = await db
    .select({ id: workflowBuildNotes.id })
    .from(workflowBuildNotes)
    .where(eq(workflowBuildNotes.workflowId, workflowId))
  expect(rows).toEqual([])
})

check('a baseline read before a newer one was recorded never replaces it', async () => {
  const { workflowId, startId } = await seedWorkflow()
  await createNotes(workflowId)
  const stale = await loadCurrentBaselineState(workflowId)
  await apply(person, workflowId, functionBatch(startId, 'later'))
  await rebaseBuildNotes.execute({ principal: agent, input: target(workflowId) })

  await writeBaseline(await notesRow(workflowId), stale, { userId: ownerId, source: 'copilot' })
  await expect(changesSince(workflowId)).resolves.toMatchObject({ hasChanges: false })
})

check("restoring a deleted folder brings its workflows' notes and files back", async () => {
  const { workflowId } = await seedWorkflow()
  await createNotes(workflowId)
  await writeNotes(workflowId, '# Draft with history\n')
  const row = await notesRow(workflowId)
  const folderId = generateId()
  await db.insert(folder).values({
    id: folderId,
    resourceType: 'workflow',
    name: `Build notes ${folderId}`,
    userId: ownerId,
    workspaceId,
  })
  await db.update(workflow).set({ folderId }).where(eq(workflow.id, workflowId))

  await deleteFolder({ resourceType: 'workflow', folderId, workspaceId, userId: ownerId })
  expect((await notesRow(workflowId)).deletedAt).not.toBeNull()
  await restoreFolder({ resourceType: 'workflow', folderId, workspaceId, userId: ownerId })

  await expect(
    getBuildNotesStatus.execute({ principal: agent, input: target(workflowId) })
  ).resolves.toMatchObject({ exists: true })
  const files = await db
    .select({ deletedAt: workspaceFiles.deletedAt })
    .from(workspaceFiles)
    .where(inArray(workspaceFiles.id, [row.notesFileId, row.baselineFileId ?? '']))
  expect(files.map((file) => file.deletedAt)).toEqual([null, null])
})

check('with the feature off, agent writes go unchecked and the notes are unreachable', async () => {
  const { workflowId, startId } = await seedWorkflow()
  await createNotes(workflowId)
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(async () => false)
  await expect(apply(agent, workflowId, functionBatch(startId, 'off'))).resolves.toMatchObject({
    applied: 2,
  })
  await expect(
    getBuildNotesStatus.execute({ principal: agent, input: target(workflowId) })
  ).rejects.toMatchObject({ code: 'forbidden' })
  await expect(
    listBuildNotesStates.execute({
      principal: person,
      input: { workspaceId, workflowIds: [workflowId] },
    })
  ).resolves.toEqual(new Map())
})

/** Waits until a session is queued behind the given backend's locks. */
function waitForBlockedBehind(holderPid: number): Promise<void> {
  return runOutsideTransactionContext(async () => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const [row] = await db.execute<{ blocked: number }>(sql`
        SELECT count(*)::int AS blocked FROM pg_stat_activity
        WHERE ${holderPid} = ANY(pg_blocking_pids(pid))`)
      if ((row?.blocked ?? 0) > 0) return
      await sleep(25)
    }
    throw new Error(`Expected a session blocked behind backend ${holderPid}`)
  })
}

check(
  'an archive waits behind a build holding the workflow instead of deadlocking on the notes',
  async () => {
    const { workflowId } = await seedWorkflow()
    await createNotes(workflowId)
    const notesId = (await notesRow(workflowId)).id
    let archived: Promise<unknown> | undefined
    await db.transaction(async (tx) => {
      // A build's lock order: the workflow row, then the notes row.
      await tx
        .select({ id: workflow.id })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .for('update')
      const [backend] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
      if (!backend) throw new Error('No backend pid')
      archived = runOutsideTransactionContext(() =>
        archiveWorkflow(workflowId, { requestId: generateId(), notifySocket: false })
      )
      await waitForBlockedBehind(backend.pid)
      await tx
        .update(workflowBuildNotes)
        .set({ updatedAt: new Date() })
        .where(eq(workflowBuildNotes.id, notesId))
    })
    await expect(archived).resolves.toMatchObject({ archived: true })
    expect((await notesRow(workflowId)).deletedAt).not.toBeNull()
  }
)

check('archiving takes the notes and files down; restoring brings exactly them back', async () => {
  const { workflowId } = await seedWorkflow()
  await createNotes(workflowId)
  await writeNotes(workflowId, '# Draft with history\n')
  await rebaseBuildNotes.execute({ principal: agent, input: target(workflowId) })
  const row = await notesRow(workflowId)
  const fileIds = [row.notesFileId, row.baselineFileId].filter((id): id is string => Boolean(id))

  await archiveWorkflow(workflowId, { requestId: generateId(), notifySocket: false })
  const archived = await notesRow(workflowId)
  expect(archived.deletedAt).not.toBeNull()
  const deletedFiles = await db
    .select({ deletedAt: workspaceFiles.deletedAt })
    .from(workspaceFiles)
    .where(inArray(workspaceFiles.id, fileIds))
  expect(deletedFiles.map((file) => file.deletedAt?.getTime())).toEqual([
    archived.deletedAt?.getTime(),
    archived.deletedAt?.getTime(),
  ])
  await expect(
    getBuildNotesStatus.execute({ principal: agent, input: target(workflowId) })
  ).rejects.toMatchObject({ code: 'not_found' })

  await restoreWorkflow(workflowId, { requestId: generateId() })
  await expect(
    getBuildNotesStatus.execute({ principal: agent, input: target(workflowId) })
  ).resolves.toMatchObject({ exists: true })
  for (const fileId of fileIds) {
    const [file] = await db
      .select({ deletedAt: workspaceFiles.deletedAt })
      .from(workspaceFiles)
      .where(eq(workspaceFiles.id, fileId))
    expect(file?.deletedAt).toBeNull()
  }
})
