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
import { WORKSPACE_COOKBOOK } from '@sim/workflow-sdk/codegen'
import type { WorkspaceBaseV1, WorkspaceKind } from '@sim/workspace-code'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
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

import {
  createWorkspaceCustomToolUseCase,
  deleteWorkspaceCustomToolUseCase,
} from '@/lib/custom-tools/application/use-cases'
import { uploadKnowledgeDocument } from '@/lib/knowledge/application/documents'
import {
  createKnowledgeBase,
  deleteKnowledgeBaseOperation,
} from '@/lib/knowledge/application/knowledge-bases'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import { createSkillUseCase } from '@/lib/skills/application/use-cases'
import { createTableUseCase, deleteTableUseCase } from '@/lib/table/application/tables'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/file-manager'
import { deleteWorkflow } from '@/lib/workflows/application/delete-workflow'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
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
    'applies the workspace cookbook the CLI writes, and re-applying what a get reads changes nothing',
    async () => {
      const workspaceId = await newWorkspace()
      const isBlob = (path: string) => path.startsWith('files/') || path.includes('/docs/')
      const cookbook: Directory = {
        files: Object.fromEntries(
          Object.entries(WORKSPACE_COOKBOOK).filter(([path]) => !isBlob(path))
        ),
        blobs: Object.fromEntries(
          Object.entries(WORKSPACE_COOKBOOK)
            .filter(([path]) => isBlob(path))
            .map(([path, text]) => [path, Buffer.from(text)])
        ),
      }

      const dryRun = await apply(workspaceId, cookbook, { dryRun: true })
      expect(findings(dryRun.diagnostics, 'error')).toEqual([])
      expect(findings(dryRun.diagnostics, 'warning')).toEqual(['W_ENV_UNKNOWN workflow:support'])
      const result = await apply(workspaceId, cookbook)

      expect(result.failed).toBeUndefined()
      expect(
        result.applied.map((change) => `${change.action} ${change.kind}:${change.key}`)
      ).toEqual([
        'create custom-tool:lookup-order',
        'create skill:tone',
        'create table:orders',
        'create knowledge-base:policies',
        'create file:templates/reply.md',
        'create workflow:support',
      ])
      const id = (address: keyof typeof result.base.resources) => result.base.resources[address]?.id
      const state = await loadWorkflowFromNormalizedTables(id('workflow:support') ?? '')
      const values = Object.values(state?.blocks ?? {}).flatMap((block) =>
        Object.values(block.subBlocks ?? {}).map((subBlock) => subBlock.value)
      )
      expect(values).toContain(id('table:orders'))
      expect(values).toContain(id('knowledge-base:policies'))
      expect(values).toContainEqual([{ skillId: id('skill:tone'), name: 'tone' }])
      expect(values).toContainEqual([
        expect.objectContaining({ customToolId: id('custom-tool:lookup-order') }),
      ])

      const read = await get(workspaceId)
      const again = await apply(
        workspaceId,
        { files: read.files, blobs: cookbook.blobs },
        { base: read.base }
      )
      expect(writes(again)).toEqual([])
    }
  )

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
    'a round that leaves a knowledge base document for the next defers the workflow using it, and two rounds converge',
    async () => {
      const workspaceId = await newWorkspace()
      const dir: Directory = {
        files: {
          'knowledge/policies/knowledge.ts': TEXT['knowledge/policies/knowledge.ts'],
          'workflows/answer/workflow.ts': `// @sim-sdk 1
import { knowledge, knowledgeBase, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Answer', {}, () => {
  const start = trigger.start('Start', { inputFormat: { question: 'string' } })
  const search = knowledge.search('Policy Search', {
    knowledgeBaseId: knowledgeBase('policies'),
    query: start.question,
    topK: 3,
  })

  start.to(search)
})
`,
        },
        blobs: BLOBS,
      }
      const send = (carried: readonly string[], base?: WorkspaceBaseV1) =>
        withPermissionGroupScope(() =>
          applyWorkspaceSource.execute({
            principal: owner,
            input: {
              workspaceId,
              files: dir.files,
              blobs: manifest(BLOBS, false).map((blob) =>
                carried.includes(blob.path)
                  ? { ...blob, content: BLOBS[blob.path].toString('base64') }
                  : blob
              ),
              kinds: KINDS,
              ...(base ? { base } : {}),
            },
          })
        )

      const first = await send(['files/notes.txt'])

      expect(first.failed).toBeUndefined()
      expect(first.remainingBlobs).toEqual(['knowledge/policies/docs/refunds.md'])
      const second = await send(first.remainingBlobs, first.base)
      expect(second.failed).toBeUndefined()
      expect(second.remainingBlobs).toEqual([])
      const stored = await snapshot(workspaceId)
      expect(stored.bases.map((base) => base.name)).toEqual(['Policies'])
      expect(stored.documents.map((doc) => doc.filename)).toEqual(['refunds.md'])
      expect(stored.workflows.map((row) => row.name)).toContain('Answer')
    }
  )

  check(
    'refuses deleting a table an unchanged declared workflow uses, as the CLI sends that folder (base only)',
    async () => {
      const { workspaceId, dir, base } = await setUp()
      const before = await snapshot(workspaceId)
      const files = Object.fromEntries(
        Object.entries(dir.files).filter(([path]) => path !== 'tables/leads.ts')
      )
      expect(files['workflows/ingest/workflow.ts']).toBeUndefined()

      const refused = await refusal(
        apply(workspaceId, { ...dir, files }, { base, allowDelete: true })
      )

      expect(findings(refused.diagnostics, 'error')).toEqual(['E_PLAN_REF_DELETED workflow:ingest'])
      expect(await snapshot(workspaceId)).toEqual(before)
    }
  )

  check(
    'deleting a table a workflow outside the directory uses warns, naming that workflow',
    async () => {
      const { workspaceId, dir, base } = await setUp()
      const files = Object.fromEntries(
        Object.entries(dir.files).filter(([path]) => path !== 'tables/leads.ts')
      )

      const deleted = await apply(
        workspaceId,
        { ...dir, files },
        { base, allowDelete: true, only: ['table'] }
      )

      expect(deleted.applied).toMatchObject([{ action: 'delete', kind: 'table', key: 'leads' }])
      const warning = deleted.diagnostics.find(
        (finding) => finding.severity === 'warning' && finding.kind === 'table'
      )
      expect(warning?.message).toContain('"Ingest"')
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

  check(
    'a carried blob that does not match its hash refuses the whole apply before any kind writes; a dry run never decodes',
    async () => {
      const workspaceId = await newWorkspace()
      const empty = await snapshot(workspaceId)
      const forged = manifest(BLOBS, true).map((blob) =>
        blob.path === 'knowledge/policies/docs/refunds.md'
          ? { ...blob, content: Buffer.from('not the declared bytes').toString('base64') }
          : blob
      )
      const send = (dryRun: boolean) =>
        withPermissionGroupScope(() =>
          applyWorkspaceSource.execute({
            principal: owner,
            input: { workspaceId, files: TEXT, blobs: forged, kinds: KINDS, dryRun },
          })
        )

      const refused = await refusal(send(false))

      expect(refused.diagnostics.filter((finding) => finding.severity === 'error')).toEqual([
        expect.objectContaining({
          code: 'E_BLOB_CONTENT',
          file: 'knowledge/policies/docs/refunds.md',
        }),
      ])
      expect(await snapshot(workspaceId)).toEqual(empty)
      const dryRun = await send(true)
      expect(findings(dryRun.diagnostics, 'error')).toEqual([])
    }
  )

  check('a blob listed twice, or at a path no binary file lives at, is refused', async () => {
    const workspaceId = await newWorkspace()
    const [notes] = manifest({ 'files/notes.txt': BLOBS['files/notes.txt'] }, false)

    const refused = await refusal(
      withPermissionGroupScope(() =>
        applyWorkspaceSource.execute({
          principal: owner,
          input: {
            workspaceId,
            files: {},
            blobs: [notes, notes, { ...notes, path: 'tables/leads.ts' }],
            kinds: ['file', 'table'],
          },
        })
      )
    )

    expect(
      refused.diagnostics
        .filter((finding) => finding.severity === 'error')
        .map((finding) => `${finding.code} ${finding.file}`)
    ).toEqual(['E_BLOB_CONTENT files/notes.txt', 'E_BLOB_CONTENT tables/leads.ts'])
  })

  check(
    'a kind counts resources by key, not file: 500 tools of two files each fit, 501 do not',
    async () => {
      const workspaceId = await newWorkspace()
      const tools = (count: number) =>
        Object.fromEntries(
          Array.from({ length: count }, (_, index) => [
            [
              `tools/t${index}.ts`,
              TEXT['tools/lookup.ts']
                .replace("'Lookup order'", `'Tool ${index}'`)
                .replace('./lookup.js', `./t${index}.js`),
            ],
            [`tools/t${index}.js`, TEXT['tools/lookup.js']],
          ]).flat()
        )
      const plan = (count: number) =>
        withPermissionGroupScope(() =>
          applyWorkspaceSource.execute({
            principal: owner,
            input: { workspaceId, files: tools(count), kinds: ['custom-tool'], dryRun: true },
          })
        )

      expect(findings((await plan(500)).diagnostics, 'error')).toEqual([])
      expect(findings((await plan(501)).diagnostics, 'error')).toEqual([
        'E_LIMIT_EXCEEDED custom-tool:undefined',
      ])
    }
  )

  check(
    'renaming any named resource to a name another one holds is refused at plan, nothing written',
    async () => {
      const { workspaceId, dir, base } = await setUp()
      const principal = owner
      await createTableUseCase.execute({
        principal,
        input: {
          workspaceId,
          name: 'contacts',
          schema: { columns: [{ name: 'email', type: 'string' }] },
        },
      })
      await createWorkspaceCustomToolUseCase.execute({
        principal,
        input: {
          workspaceId,
          title: 'Taken tool',
          schema: {
            type: 'function',
            function: { name: 'taken', parameters: { type: 'object', properties: {} } },
          },
          code: 'return 1',
        },
      })
      await createSkillUseCase.execute({
        principal,
        input: { workspaceId, name: 'taken', description: 'Taken', content: 'Taken' },
      })
      await createKnowledgeBase.execute({ principal, input: { workspaceId, name: 'Taken KB' } })
      const before = await snapshot(workspaceId)
      const rename = (path: string, from: string, to: string) => [
        path,
        dir.files[path].replace(from, to),
      ]
      const files = {
        ...dir.files,
        ...Object.fromEntries([
          rename('tables/leads.ts', "name: 'leads'", "name: 'Contacts'"),
          rename('tools/lookup.ts', "title: 'Lookup order'", "title: 'Taken tool'"),
          rename('skills/tone.md', 'name: tone', 'name: taken'),
          rename('knowledge/policies/knowledge.ts', "name: 'Policies'", "name: 'Taken KB'"),
        ]),
      }

      const refused = await refusal(apply(workspaceId, { ...dir, files }, { base }))

      expect(findings(refused.diagnostics, 'error')).toEqual([
        'E_NAME_TAKEN custom-tool:lookup',
        'E_NAME_TAKEN knowledge-base:policies',
        'E_NAME_TAKEN skill:tone',
        'E_NAME_TAKEN table:leads',
      ])
      expect(await snapshot(workspaceId)).toEqual(before)
    }
  )

  check(
    'a get leaves out what would take the directory past the declaration budget, so it applies back unchanged',
    async () => {
      const workspaceId = await newWorkspace()
      const content = 'x'.repeat(50_000)
      for (let index = 0; index < 41; index++) {
        await createSkillUseCase.execute({
          principal: owner,
          input: { workspaceId, name: `skill-${index}`, description: 'Long', content },
        })
      }

      const read = await withPermissionGroupScope(() =>
        readWorkspaceSource.execute({ principal: owner, input: { workspaceId, kinds: ['skill'] } })
      )

      expect(read.skipped.length).toBeGreaterThan(0)
      for (const skipped of read.skipped) {
        expect(skipped).toMatchObject({
          kind: 'skill',
          reason: expect.stringContaining('declaration limit'),
        })
      }
      const again = await withPermissionGroupScope(() =>
        applyWorkspaceSource.execute({
          principal: owner,
          input: { workspaceId, files: read.files, base: read.base, kinds: ['skill'] },
        })
      )
      expect(writes(again)).toEqual([])
      expect(findings(again.diagnostics, 'error')).toEqual([])
    }
  )

  check('workspace files and knowledge documents hash within one per-request budget', async () => {
    const workspaceId = await newWorkspace()
    const size = Math.floor(WORKSPACE_SOURCE_LIMITS.maxBlobBytesPerRequest / 2.5)
    for (const name of ['a.txt', 'b.txt']) {
      await uploadWorkspaceFile(
        workspaceId,
        ownerId,
        Buffer.alloc(size, name),
        name,
        'text/plain',
        {
          notifyWorkspaceChange: false,
        }
      )
    }
    const { knowledgeBase: created } = await createKnowledgeBase.execute({
      principal: owner,
      input: { workspaceId, name: 'Policies' },
    })
    const buffer = Buffer.alloc(size, 'c')
    await uploadKnowledgeDocument.execute({
      principal: owner,
      input: {
        knowledgeBaseId: created.id,
        file: { buffer, filename: 'c.txt', fileSize: size, mimeType: 'text/plain' },
      },
    })

    const read = await get(workspaceId)

    expect(read.blobs).toHaveLength(3)
    expect(read.blobs.filter((blob) => blob.sha256 === undefined)).toHaveLength(1)
  })
})
