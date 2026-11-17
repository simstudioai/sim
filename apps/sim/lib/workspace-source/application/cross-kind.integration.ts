/**
 * Real PostgreSQL (and local-disk storage) coverage for the rules workspace source holds across
 * every kind at once: tables, workflows, custom tools, skills, workspace files and knowledge bases
 * in one directory. Each check runs in its own workspace and reads the stored rows directly, so
 * "nothing was written" means the rows are unchanged. Writes a report to
 * `WORKSPACE_SOURCE_CROSS_KIND_REPORT_PATH`.
 */
import { mkdtempSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { db } from '@sim/db'
import {
  auditLog,
  customTools,
  document,
  knowledgeBase,
  permissions,
  skill,
  user,
  userStats,
  userTableDefinitions,
  workflow,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { sha256Hex } from '@sim/security/hash'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { compareStrings } from '@sim/utils/string'
import type { WorkspaceBaseV1, WorkspaceKind } from '@sim/workspace-code'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { deleteWorkspaceCustomToolUseCase } from '@/lib/custom-tools/application/use-cases'
import { deleteKnowledgeBaseOperation } from '@/lib/knowledge/application/knowledge-bases'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import { deleteTableUseCase } from '@/lib/table/application/tables'
import { deleteWorkflow } from '@/lib/workflows/application/delete-workflow'
import { deleteWorkspaceFileOperation } from '@/lib/workspace-files/application/delete-workspace-file'
import {
  type ApplyWorkspaceSourceInput,
  type ApplyWorkspaceSourceResult,
  applyWorkspaceSource,
} from '@/lib/workspace-source/application/apply-workspace-source'
import { WorkspaceSourceRejectedError } from '@/lib/workspace-source/application/errors'
import { readWorkspaceSource } from '@/lib/workspace-source/application/read-workspace-source'

const ownerId = generateId()
const owner = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
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

const KINDS: WorkspaceKind[] = [
  'table',
  'custom-tool',
  'skill',
  'knowledge-base',
  'file',
  'workflow',
]

const TEXT: Record<string, string> = {
  'tables/leads.ts': `// @sim-sdk 1
import { column, defineTable } from '@sim/workflow-sdk/workspace'

export default defineTable({
  name: 'leads',
  columns: { email: column.string({ required: true }) },
})
`,
  'workflows/ingest/workflow.ts': `// @sim-sdk 1
import { table, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Ingest', {}, () => {
  const start = trigger.start('Start', { inputFormat: { email: 'string' } })
  const save = table.insertRow('Save Lead', {
    tableId: table('leads'),
    data: { email: start.email },
  })

  start.to(save)
})
`,
  'workflows/keep/workflow.ts': `// @sim-sdk 1
import { trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Keep', {}, () => {
  trigger.start('Start', { inputFormat: {} })
})
`,
  'tools/lookup.ts': `// @sim-sdk 1
import { codeFile, defineTool } from '@sim/workflow-sdk/workspace'

export default defineTool({
  title: 'Lookup order',
  schema: {
    type: 'function',
    function: {
      name: 'lookup_order',
      parameters: { type: 'object', properties: { orderId: { type: 'string' } } },
    },
  },
  code: codeFile('./lookup.js'),
})
`,
  'tools/lookup.js': 'return { orderId }\n',
  'skills/tone.md': '---\nname: tone\ndescription: Short and warm\n---\nWrite like a person.\n',
  'knowledge/policies/knowledge.ts': `// @sim-sdk 1
import { defineKnowledgeBase } from '@sim/workflow-sdk/workspace'

export default defineKnowledgeBase({
  name: 'Policies',
})
`,
}

const BLOBS: Record<string, Buffer> = {
  'files/notes.txt': Buffer.from('first notes'),
  'knowledge/policies/docs/refunds.md': Buffer.from('# Refunds\nWithin 30 days.\n'),
}

/** The declaration file of each resource, by base address: what a local edit touches. */
const EDITS: Record<string, { path: string; from: string; to: string }> = {
  'table:leads': { path: 'tables/leads.ts', from: "name: 'leads'", to: "name: 'prospects'" },
  'custom-tool:lookup': { path: 'tools/lookup.js', from: 'orderId', to: 'orderId, edited: true' },
  'skill:tone': { path: 'skills/tone.md', from: 'Write like', to: 'Write tersely like' },
  'knowledge-base:policies': {
    path: 'knowledge/policies/knowledge.ts',
    from: "name: 'Policies'",
    to: "name: 'Policies', description: 'Edited'",
  },
  'workflow:ingest': { path: 'workflows/ingest/workflow.ts', from: "'Ingest'", to: "'Ingest v2'" },
}

interface Directory {
  files: Record<string, string>
  blobs: Record<string, Buffer>
}

function manifest(blobs: Record<string, Buffer>, carry: boolean) {
  return Object.entries(blobs).map(([path, bytes]) => ({
    path,
    sha256: sha256Hex(bytes),
    size: bytes.byteLength,
    ...(carry ? { content: bytes.toString('base64') } : {}),
  }))
}

type ApplyOptions = Partial<Omit<ApplyWorkspaceSourceInput, 'workspaceId' | 'files' | 'blobs'>> & {
  carry?: boolean
}

function apply(workspaceId: string, dir: Directory, options: ApplyOptions = {}) {
  const { carry = true, ...input } = options
  return withPermissionGroupScope(() =>
    applyWorkspaceSource.execute({
      principal: owner,
      input: {
        workspaceId,
        files: dir.files,
        blobs: manifest(dir.blobs, carry),
        kinds: KINDS,
        ...input,
      },
    })
  )
}

function get(workspaceId: string) {
  return withPermissionGroupScope(() =>
    readWorkspaceSource.execute({ principal: owner, input: { workspaceId, kinds: KINDS } })
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

function findings(
  diagnostics: ReadonlyArray<{ code: string; severity: string; kind?: string; key?: string }>,
  severity: string
) {
  return diagnostics
    .filter((finding) => finding.severity === severity)
    .map((finding) => `${finding.code} ${finding.kind}:${finding.key}`)
    .sort(compareStrings)
}

function writes(result: ApplyWorkspaceSourceResult) {
  return result.plan.filter((change) => change.action !== 'noop')
}

/** Live rows of every kind in a workspace: what "nothing was written" compares. */
async function snapshot(workspaceId: string) {
  const [tables, workflows, tools, skills, files, bases] = await Promise.all([
    db
      .select({ id: userTableDefinitions.id, name: userTableDefinitions.name })
      .from(userTableDefinitions)
      .where(
        and(
          eq(userTableDefinitions.workspaceId, workspaceId),
          isNull(userTableDefinitions.archivedAt)
        )
      ),
    db
      .select({ id: workflow.id, name: workflow.name })
      .from(workflow)
      .where(and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt))),
    db
      .select({ id: customTools.id, title: customTools.title, code: customTools.code })
      .from(customTools)
      .where(eq(customTools.workspaceId, workspaceId)),
    db
      .select({ id: skill.id, content: skill.content })
      .from(skill)
      .where(eq(skill.workspaceId, workspaceId)),
    db
      .select({ id: workspaceFiles.id, name: workspaceFiles.originalName })
      .from(workspaceFiles)
      .where(and(eq(workspaceFiles.workspaceId, workspaceId), isNull(workspaceFiles.deletedAt))),
    db
      .select({ id: knowledgeBase.id, name: knowledgeBase.name })
      .from(knowledgeBase)
      .where(and(eq(knowledgeBase.workspaceId, workspaceId), isNull(knowledgeBase.deletedAt))),
  ])
  const documents =
    bases.length === 0
      ? []
      : await db
          .select({ id: document.id, filename: document.filename })
          .from(document)
          .where(
            and(
              inArray(
                document.knowledgeBaseId,
                bases.map((base) => base.id)
              ),
              isNull(document.deletedAt)
            )
          )
  return { tables, workflows, tools, skills, files, bases, documents }
}

async function newWorkspace(): Promise<string> {
  const workspaceId = generateId()
  workspaceIds.push(workspaceId)
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Workspace source across kinds',
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
  return workspaceId
}

/**
 * A workspace holding one resource of every kind, and the directory a get writes for it: the
 * workflow folder as the CLI sends it unchanged (its base only).
 */
async function setUp(): Promise<{ workspaceId: string; dir: Directory; base: WorkspaceBaseV1 }> {
  const workspaceId = await newWorkspace()
  const created = await apply(workspaceId, { files: TEXT, blobs: BLOBS })
  expect(created.failed).toBeUndefined()
  const read = await get(workspaceId)
  const files = Object.fromEntries(
    Object.entries(read.files).filter(
      ([path]) => !path.startsWith('workflows/') || path.includes('/.sim/')
    )
  )
  return { workspaceId, dir: { files, blobs: BLOBS }, base: read.base }
}

/**
 * Deletes one resource of every kind through its own use case, as the UI would (`keep` stays: a
 * workspace keeps at least one workflow).
 */
async function deleteEverything(workspaceId: string, base: WorkspaceBaseV1) {
  const id = (address: keyof WorkspaceBaseV1['resources']) => {
    const entry = base.resources[address]
    if (!entry) throw new Error(`No base entry for ${address}`)
    return entry.id
  }
  const principal = owner
  await deleteTableUseCase.execute({
    principal,
    input: { tableId: id('table:leads'), workspaceId },
  })
  await deleteWorkflow.execute({ principal, input: { workflowId: id('workflow:ingest') } })
  await deleteWorkspaceCustomToolUseCase.execute({
    principal,
    input: { workspaceId, toolId: id('custom-tool:lookup') },
  })
  await db.delete(skill).where(eq(skill.id, id('skill:tone')))
  await deleteWorkspaceFileOperation.execute({
    principal,
    input: { fileId: id('file:notes.txt'), assertedWorkspaceId: workspaceId },
  })
  await deleteKnowledgeBaseOperation.execute({
    principal,
    input: { knowledgeBaseId: id('knowledge-base:policies') },
  })
}

beforeAll(async () => {
  fixtureStorage.root = mkdtempSync(join(tmpdir(), 'workspace-source-cross-kind-'))
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'workflow-code'
  )
  const now = new Date()
  await db.insert(user).values({
    id: ownerId,
    name: 'Workspace source cross-kind fixture',
    email: `${ownerId}@workspace-source.invalid`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(userStats).values({ id: generateId(), userId: ownerId })
})

afterAll(async () => {
  const reportPath =
    process.env.WORKSPACE_SOURCE_CROSS_KIND_REPORT_PATH ??
    resolve('test-results/workspace-source-cross-kind.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  if (workspaceIds.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.workspaceId, workspaceIds))
    await deleteWorkspaceFixture(db, inArray(workspace.id, workspaceIds))
  }
  await db.delete(user).where(eq(user.id, ownerId))
  if (fixtureStorage.root) await rm(fixtureStorage.root, { recursive: true, force: true })
})

describe('workspace source across kinds', () => {
  check(
    'nothing deleted on the server comes back: an unchanged directory leaves every kind deleted, and an edit is stale',
    async () => {
      const { workspaceId, dir, base } = await setUp()
      await deleteEverything(workspaceId, base)
      const empty = await snapshot(workspaceId)

      const unchanged = await apply(workspaceId, dir, { base })

      expect(writes(unchanged)).toEqual([])
      expect(unchanged.needBlobs).toEqual([])
      expect(findings(unchanged.diagnostics, 'info')).toEqual(
        [
          'I_SERVER_DELETED custom-tool:lookup',
          'I_SERVER_DELETED file:notes.txt',
          'I_SERVER_DELETED knowledge-base:policies',
          'I_SERVER_DELETED skill:tone',
          'I_SERVER_DELETED table:leads',
          'I_SERVER_DELETED workflow:ingest',
        ].sort(compareStrings)
      )
      expect(await snapshot(workspaceId)).toEqual(empty)

      for (const [address, edit] of Object.entries(EDITS)) {
        const files =
          address === 'workflow:ingest'
            ? { ...dir.files, [edit.path]: TEXT[edit.path].replace(edit.from, edit.to) }
            : { ...dir.files, [edit.path]: dir.files[edit.path].replace(edit.from, edit.to) }
        const refused = await refusal(apply(workspaceId, { ...dir, files }, { base }))
        expect(findings(refused.diagnostics, 'error')).toEqual([`E_APPLY_STALE ${address}`])
      }
      const edited = await refusal(
        apply(
          workspaceId,
          { ...dir, blobs: { ...BLOBS, 'files/notes.txt': Buffer.from('edited notes') } },
          { base }
        )
      )
      expect(findings(edited.diagnostics, 'error')).toEqual(['E_APPLY_STALE file:notes.txt'])
      expect(await snapshot(workspaceId)).toEqual(empty)
    }
  )

  check(
    'a delete of a tool, skill or knowledge base changed on the server since the base is stale',
    async () => {
      const { workspaceId, dir, base } = await setUp()
      await db
        .update(customTools)
        .set({ code: 'return 2' })
        .where(eq(customTools.workspaceId, workspaceId))
      await db
        .update(skill)
        .set({ content: 'Changed in the UI.' })
        .where(eq(skill.workspaceId, workspaceId))
      await db
        .update(knowledgeBase)
        .set({ description: 'Changed in the UI' })
        .where(eq(knowledgeBase.workspaceId, workspaceId))
      const before = await snapshot(workspaceId)
      const dropped = Object.fromEntries(
        Object.entries(dir.files).filter(
          ([path]) =>
            !path.startsWith('tools/') &&
            !path.startsWith('skills/') &&
            !path.startsWith('knowledge/')
        )
      )

      const refused = await refusal(
        apply(
          workspaceId,
          { files: dropped, blobs: { 'files/notes.txt': BLOBS['files/notes.txt'] } },
          { base, allowDelete: true }
        )
      )

      expect(findings(refused.diagnostics, 'error')).toEqual([
        'E_APPLY_STALE custom-tool:lookup',
        'E_APPLY_STALE knowledge-base:policies',
        'E_APPLY_STALE skill:tone',
      ])
      expect(await snapshot(workspaceId)).toEqual(before)
    }
  )
})
