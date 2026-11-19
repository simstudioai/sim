/**
 * The build-notes loop exactly as Chat's agent drives it: every step is a `sim_cli` call in the
 * shape the worker's parser sends (CLI argv or a `build_notes` service invocation), run through
 * the tool handler under the registry content gate the tool executor installs, against real
 * PostgreSQL and storage. A person's edit lands through the v2 operations use case meanwhile.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { db } from '@sim/db'
import {
  auditLog,
  permissions,
  user,
  userStats,
  workflow,
  workflowBlocks,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

import { observeContentDelivery } from '@/lib/core/application/content-delivery'
import { createCopilotResourceAdmission } from '@/lib/mothership/auth/application-delegation'
import { createRegistryContentGate } from '@/lib/mothership/content-delivery'
import type { ToolExecutionContext } from '@/lib/mothership/tool-executor/types'
import { executeSimCli } from '@/lib/mothership/tools/handlers/sim-cli'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import { applyWorkflowOperations } from '@/lib/workflows/application/apply-workflow-operations'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const ownerId = generateId()
const workspaceId = generateId()
const person = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })

const checks: { name: string; status: string; durationMs: number; error?: string }[] = []
/** Every sim_cli call the agent made, in order, with its exit and first stderr line. */
const transcript: { call: string; ok: boolean; note?: string; stdout?: string }[] = []

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

function chatContext(): ToolExecutionContext {
  return {
    userId: ownerId,
    workspaceId,
    requestMode: 'agent',
    copilotToolExecution: true,
    toolCallId: generateId(),
    copilotResourceAdmission: createCopilotResourceAdmission({
      userId: ownerId,
      invocation: { kind: 'workspace', workspaceId },
    }),
    resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([], {
      userId: ownerId,
      workspaceId,
    }),
  } as ToolExecutionContext
}

interface CliOutcome {
  ok: boolean
  stdout: string
  error: string
}

/** One `sim_cli` call, under the registry gate Chat's tool executor runs it in. */
async function simCli(
  request: { invocation: Record<string, unknown> },
  label: string
): Promise<CliOutcome> {
  const context = chatContext()
  const registry = context.resolvedSecretTraceRegistry
  if (!registry) throw new Error('No registry')
  const gate = createRegistryContentGate({ registry, workspaceId, actorUserId: ownerId })
  const result = await observeContentDelivery(gate, () =>
    withPermissionGroupScope(() => executeSimCli({ request }, context))
  )
  const output = (result.output ?? {}) as { stdout?: string; stderr?: string }
  const outcome = {
    ok: result.success,
    stdout: output.stdout ?? '',
    error: result.error ?? output.stderr ?? '',
  }
  transcript.push({
    call: label,
    ok: outcome.ok,
    ...(outcome.ok
      ? { stdout: outcome.stdout.slice(0, 400) }
      : { note: outcome.error.split('\n')[0] }),
  })
  return outcome
}

const cli = (...argv: string[]) => simCli({ invocation: { kind: 'cli', argv } }, argv.join(' '))

const buildNotes = (action: string, workflowId: string) =>
  simCli(
    { invocation: { kind: 'service', name: 'build_notes', input: { action, workflowId } } },
    `build-notes ${action}`
  )

function json<T>(outcome: CliOutcome): T {
  if (!outcome.ok) throw new Error(`sim_cli failed: ${outcome.error}`)
  return JSON.parse(outcome.stdout) as T
}

const edit = (path: string, change: Record<string, unknown>) =>
  cli('files', 'edit', path, '--edit', JSON.stringify(change), '--output', 'json')

async function blockId(workflowId: string, name: string): Promise<string> {
  const [row] = await db
    .select({ id: workflowBlocks.id })
    .from(workflowBlocks)
    .where(and(eq(workflowBlocks.workflowId, workflowId), eq(workflowBlocks.name, name)))
  if (!row) throw new Error(`No block named ${name}`)
  return row.id
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Build notes agent fixture',
    email: `${ownerId}@build-notes-agent.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(userStats).values({ id: generateId(), userId: ownerId })
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Build notes agent',
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
  featureFlagsMockFns.mockIsFeatureEnabled.mockReset()
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'build-notes'
  )
})

afterAll(async () => {
  const reportPath =
    process.env.BUILD_NOTES_AGENT_REPORT_PATH ?? resolve('test-results/build-notes-agent.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks, transcript }, null, 2))
  await db.delete(auditLog).where(eq(auditLog.workspaceId, workspaceId))
  await db.delete(workflow).where(eq(workflow.workspaceId, workspaceId))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(userStats).where(eq(userStats.userId, ownerId))
  await db.delete(user).where(eq(user.id, ownerId))
})

check('the agent drafts, settles, builds, and reconciles a workflow through sim_cli', async () => {
  const created = json<{ id?: string; data?: { id?: string }; workflow?: { id?: string } }>(
    await cli('workflows', 'create', '--name', 'Lead Router', '--output', 'json')
  )
  const workflowId = created.id ?? created.data?.id ?? created.workflow?.id
  if (!workflowId) throw new Error('workflows create returned no id')
  const notesPath = `build-notes/${workflowId}.md`
  const baselinePath = `build-notes/${workflowId}.baseline.json`

  expect(json(await buildNotes('create', workflowId))).toMatchObject({
    notes: notesPath,
    baseline: baselinePath,
  })
  const template = json<{ fileId: string; text: string }>(
    await cli('files', 'read', notesPath, '--output', 'json')
  )
  expect(template.text).toContain('```json operations')
  const notesFile = template.fileId

  const startId = await blockId(workflowId, 'Start')
  const draft = [
    {
      operation_type: 'add',
      block_id: 'score',
      params: {
        type: 'function',
        name: '<<open:scorer_name>>',
        inputs: { language: 'javascript', code: 'return { tier: "hot" }' },
      },
    },
    { operation_type: 'edit', block_id: startId, params: { connections: { source: 'score' } } },
  ]
  for (const change of [
    { mode: 'search_replace', search: '[]', content: JSON.stringify(draft, null, 2) },
    {
      mode: 'insert_after',
      anchor: '## Open items',
      content: '- [ask] Which channel gets hot leads?',
    },
  ]) {
    const written = await edit(notesFile, change)
    expect(written.ok, written.error).toBe(true)
  }

  const blocked = json<{ passed: boolean; problems: string[] }>(
    await buildNotes('evaluate', workflowId)
  )
  expect(blocked.passed).toBe(false)
  expect(blocked.problems).toEqual([
    'Placeholder still open: <<open:scorer_name>>',
    'Open item marked [ask]: Which channel gets hot leads?',
  ])

  for (const change of [
    { mode: 'search_replace', search: '<<open:scorer_name>>', content: 'Score lead' },
    {
      mode: 'search_replace',
      search: '- [ask] Which channel gets hot leads?',
      content: '- [assume] Hot leads go to #sales until the user names a channel',
    },
  ]) {
    const written = await edit(notesFile, change)
    expect(written.ok, written.error).toBe(true)
  }
  const passed = json<{ passed: boolean; problems: string[]; assumedItems: number }>(
    await buildNotes('evaluate', workflowId)
  )
  expect(passed).toMatchObject({ passed: true, problems: [], assumedItems: 1 })

  const offBook = await cli(
    'workflows',
    'operations',
    'apply',
    workflowId,
    '--atomic',
    '--yes',
    '--operations',
    JSON.stringify([
      {
        operation_type: 'add',
        block_id: 'other',
        params: { type: 'function', name: 'Other', inputs: { language: 'javascript', code: '1' } },
      },
    ])
  )
  expect(offBook.ok).toBe(false)
  expect(offBook.error).toMatch(/not the operations block/)

  const baselineFile = json<{ fileId: string }>(
    await cli('files', 'read', baselinePath, '--output', 'json')
  ).fileId
  const baselineWrite = await edit(baselineFile, {
    mode: 'search_replace',
    search: '"blocks"',
    content: '"nodes"',
  })
  expect(baselineWrite.ok).toBe(false)
  expect(baselineWrite.error).toMatch(/kept by Sim/)

  const built = json<{ applied: number; skipped: unknown[] }>(await buildNotes('apply', workflowId))
  expect(built).toMatchObject({ applied: 2, skipped: [] })
  expect(await blockId(workflowId, 'Score lead')).toBeTruthy()
  const again = await buildNotes('apply', workflowId)
  expect(again.ok).toBe(false)
  expect(again.error).toMatch(/has not passed evaluation/)

  await withPermissionGroupScope(() =>
    applyWorkflowOperations.execute({
      principal: person,
      input: {
        workflowId,
        operations: [
          {
            operation_type: 'add',
            block_id: 'manual',
            params: {
              type: 'function',
              name: 'Manual check',
              inputs: { language: 'javascript', code: 'return 1' },
            },
          },
        ],
      },
    })
  )
  expect(json(await buildNotes('status', workflowId))).toMatchObject({
    exists: true,
    evaluated: false,
    mayHaveChangedOutsideAgent: true,
  })
  const changes = json<{ hasChanges: boolean; diff: { addedBlocks: { name?: string }[] } }>(
    await buildNotes('changes', workflowId)
  )
  expect(changes.hasChanges).toBe(true)
  expect(changes.diff.addedBlocks.map((added) => added.name)).toEqual(['Manual check'])

  const scoreId = await blockId(workflowId, 'Score lead')
  const next = [
    { operation_type: 'edit', block_id: scoreId, params: { name: 'Score inbound lead' } },
  ]
  const rewritten = await edit(notesFile, {
    mode: 'replace_between',
    beforeAnchor: '```json operations',
    afterAnchor: '```',
    content: JSON.stringify(next, null, 2),
  })
  expect(rewritten.ok, rewritten.error).toBe(true)
  const held = json<{ passed: boolean }>(await buildNotes('evaluate', workflowId))
  expect(held.passed).toBe(true)
  const refused = await buildNotes('apply', workflowId)
  expect(refused.ok).toBe(false)
  expect(refused.error).toMatch(/changed outside the agent/)

  const changeLog = await edit(notesFile, {
    mode: 'insert_after',
    anchor: '## Change log',
    content: '- A person added "Manual check"; kept it, renamed the scorer.',
  })
  expect(changeLog.ok, changeLog.error).toBe(true)
  expect((await buildNotes('rebase', workflowId)).ok).toBe(true)
  expect(json<{ passed: boolean }>(await buildNotes('evaluate', workflowId)).passed).toBe(true)
  expect(json(await buildNotes('apply', workflowId))).toMatchObject({ applied: 1 })
  expect(await blockId(workflowId, 'Score inbound lead')).toBe(scoreId)

  const notes = json<{ text: string }>(await cli('files', 'read', notesPath, '--output', 'json'))
  expect(notes.text).toContain('Hot leads go to #sales until the user names a channel')
  expect(notes.text).toContain('A person added "Manual check"')
})
