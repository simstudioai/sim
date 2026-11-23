/**
 * Real PostgreSQL (and local-disk storage) coverage for the rules workspace source holds across
 * every kind at once: tables, workflows, custom tools, skills, workspace files and knowledge bases
 * in one directory. Each check runs in its own workspace and reads the stored rows directly, so
 * "nothing was written" means the rows are unchanged. Writes a report to
 * `WORKSPACE_SOURCE_CROSS_KIND_REPORT_PATH`.
 */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { db } from '@sim/db'
import {
  credential,
  customTools,
  document,
  knowledgeBase,
  skill,
  user,
  userStats,
  userTableDefinitions,
  workflow,
  workspaceFiles,
} from '@sim/db/schema'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import {
  resetUploadsSetupMock,
  setUploadDirServer,
  uploadsSetupMock,
} from '@sim/testing/mocks/uploads-setup.mock'
import { generateId } from '@sim/utils/id'
import { compareStrings } from '@sim/utils/string'
import { WORKSPACE_COOKBOOK } from '@sim/workflow-sdk/codegen'
import type { WorkspaceBaseV1, WorkspaceKind } from '@sim/workspace-code'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, vi } from 'vitest'

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/posthog/server', () => posthogServerMock)
/** Lets a check run another apply while an apply plans, once its deletes are planned. */
const planGate = vi.hoisted(() => ({
  whilePlanning: undefined as (() => Promise<void>) | undefined,
}))
vi.mock('@/lib/workspace-source/application/in-use', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspace-source/application/in-use')>()
  return {
    ...actual,
    checkDeletesInUse: async (...args: Parameters<typeof actual.checkDeletesInUse>) => {
      const whilePlanning = planGate.whilePlanning
      planGate.whilePlanning = undefined
      await whilePlanning?.()
      return actual.checkDeletesInUse(...args)
    },
  }
})

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
import { setSecretUseCase } from '@/lib/secrets/application/use-cases'
import { createSkillUseCase } from '@/lib/skills/application/use-cases'
import { createTableUseCase, deleteTableUseCase } from '@/lib/table/application/tables'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/file-manager'
import { deleteWorkflow } from '@/lib/workflows/application/delete-workflow'
import { duplicateWorkflow } from '@/lib/workflows/application/duplicate-workflow'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { deleteWorkspaceFileOperation } from '@/lib/workspace-files/application/delete-workspace-file'
import { withBoundWorkspaceFindings } from '@/lib/workspace-source/api/route-policies'
import {
  type ApplyWorkspaceSourceInput,
  type ApplyWorkspaceSourceResult,
  applyWorkspaceSource,
} from '@/lib/workspace-source/application/apply-workspace-source'
import { readWorkspaceSource } from '@/lib/workspace-source/application/read-workspace-source'
import {
  findMissingSourceBlobs,
  stageSourceBlobs,
} from '@/lib/workspace-source/application/stage-blobs'
import {
  blobManifest,
  codes,
  refusal,
  sourceChecks,
  sourceRunner,
  sourceWorkspaces,
  stageBlobsAs,
} from '@/lib/workspace-source/application/workspace-source.test-helpers'
import { WorkspaceSourceBusyError } from '@/lib/workspace-source/lease/store'

/** Local object storage the suite's uploads land in, under a temp directory. */
let storageRoot = ''
const ownerId = generateId()
const owner = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
const { check, writeReport } = sourceChecks(
  'WORKSPACE_SOURCE_CROSS_KIND_REPORT_PATH',
  'workspace-source-cross-kind.json'
)
const workspaces = sourceWorkspaces()

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
  'workflow:ingest': {
    path: 'workflows/ingest/workflow.ts',
    from: "{ email: 'string' }",
    to: "{ email: 'string', name: 'string' }",
  },
}

interface Directory {
  files: Record<string, string>
  blobs: Record<string, Buffer>
}

type ApplyOptions = Partial<Omit<ApplyWorkspaceSourceInput, 'workspaceId' | 'files' | 'blobs'>> & {
  carry?: boolean
}

const runner = sourceRunner(KINDS, owner)

function apply(workspaceId: string, dir: Directory, options: ApplyOptions = {}) {
  const { carry = true, ...input } = options
  return runner.apply(workspaceId, {
    files: dir.files,
    blobs: blobManifest(dir.blobs, () => carry),
    ...input,
  })
}

function get(workspaceId: string) {
  return runner.get(workspaceId)
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

/**
 * Live rows of every kind in a workspace, each kind ordered by id: what "nothing was written"
 * compares. Without the order, rows come back in whichever index the planner picks, and that
 * choice can change between two calls once autovacuum analyzes the table.
 */
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
      )
      .orderBy(userTableDefinitions.id),
    db
      .select({ id: workflow.id, name: workflow.name })
      .from(workflow)
      .where(and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt)))
      .orderBy(workflow.id),
    db
      .select({ id: customTools.id, title: customTools.title, code: customTools.code })
      .from(customTools)
      .where(eq(customTools.workspaceId, workspaceId))
      .orderBy(customTools.id),
    db
      .select({ id: skill.id, content: skill.content })
      .from(skill)
      .where(eq(skill.workspaceId, workspaceId))
      .orderBy(skill.id),
    db
      .select({ id: workspaceFiles.id, name: workspaceFiles.originalName })
      .from(workspaceFiles)
      .where(and(eq(workspaceFiles.workspaceId, workspaceId), isNull(workspaceFiles.deletedAt)))
      .orderBy(workspaceFiles.id),
    db
      .select({ id: knowledgeBase.id, name: knowledgeBase.name })
      .from(knowledgeBase)
      .where(and(eq(knowledgeBase.workspaceId, workspaceId), isNull(knowledgeBase.deletedAt)))
      .orderBy(knowledgeBase.id),
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
          .orderBy(document.id)
  return { tables, workflows, tools, skills, files, bases, documents }
}

async function newWorkspace(): Promise<string> {
  return workspaces.create({ name: 'Workspace source across kinds', ownerId })
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
  storageRoot = mkdtempSync(join(tmpdir(), 'workspace-source-cross-kind-'))
  setUploadDirServer(storageRoot)
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
  await writeReport()
  resetUploadsSetupMock()
  await workspaces.cleanup()
  await db.delete(user).where(eq(user.id, ownerId))
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true })
})

describe('workspace source across kinds', () => {
  check(
    'applies the workspace cookbook the CLI writes, and re-applying what a get reads changes nothing',
    async () => {
      const workspaceId = await newWorkspace()
      const isBlob = (path: string) => path.startsWith('files/') || path.includes('/docs/')
      // The MCP server example needs a live server to connect to; mcp.integration.ts applies one.
      const example = Object.entries(WORKSPACE_COOKBOOK).filter(
        ([path]) => !path.startsWith('mcp/')
      )
      const cookbook: Directory = {
        files: Object.fromEntries(example.filter(([path]) => !isBlob(path))),
        blobs: Object.fromEntries(
          example.filter(([path]) => isBlob(path)).map(([path, text]) => [path, Buffer.from(text)])
        ),
      }

      // The cookbook declares the secrets its workflow, tool and MCP server read, and a Slack and a
      // Gmail credential.
      for (const name of [
        'ANTHROPIC_API_KEY',
        'DOCS_MCP_KEY',
        'DOCS_MCP_TOKEN',
        'ORDERS_API_KEY',
      ]) {
        await setSecretUseCase.execute({
          principal: owner,
          input: { workspaceId, name, scope: 'workspace', value: 'test' },
        })
      }
      await db.insert(credential).values({
        id: generateId(),
        workspaceId,
        type: 'service_account',
        displayName: 'Support Slack',
        providerId: 'slack',
        createdBy: ownerId,
      })
      await db.insert(credential).values({
        id: generateId(),
        workspaceId,
        type: 'service_account',
        displayName: 'Support inbox',
        providerId: 'google-email',
        createdBy: ownerId,
      })

      const dryRun = await apply(workspaceId, cookbook, { dryRun: true })
      expect(findings(dryRun.diagnostics, 'error')).toEqual([])
      expect(findings(dryRun.diagnostics, 'warning')).toEqual([])
      const result = await apply(workspaceId, cookbook)

      expect(result.failed).toBeUndefined()
      expect(
        result.applied.map((change) => `${change.action} ${change.kind}:${change.key}`)
      ).toEqual([
        'update secret:ANTHROPIC_API_KEY',
        'update secret:DOCS_MCP_KEY',
        'update secret:DOCS_MCP_TOKEN',
        'update secret:ORDERS_API_KEY',
        'adopt credential:gmail',
        'adopt credential:slack',
        'create custom-tool:lookup-order',
        'create skill:tone',
        'create table:orders',
        'create table:plans',
        'create knowledge-base:policies',
        'create file:templates/reply.md',
        'create workflow:support',
        'create deployment:support',
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
      expect(findings(unchanged.diagnostics, 'warning')).toEqual(
        [
          'W_SERVER_DELETED custom-tool:lookup',
          'W_SERVER_DELETED file:notes.txt',
          'W_SERVER_DELETED knowledge-base:policies',
          'W_SERVER_DELETED skill:tone',
          'W_SERVER_DELETED table:leads',
          'W_SERVER_DELETED workflow:ingest',
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
    'a knowledge base document not staged refuses the whole apply (the file, the base and the workflow using it), and once staged one apply writes them all',
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
      const empty = await snapshot(workspaceId)
      const manifest = blobManifest(BLOBS, () => false)
      const send = () =>
        withPermissionGroupScope(() =>
          applyWorkspaceSource.execute({
            principal: owner,
            input: { workspaceId, files: dir.files, blobs: manifest, kinds: KINDS },
          })
        )
      const stage = (path: string) =>
        stageBlobsAs(owner, workspaceId, [
          {
            sha256: manifest.find((blob) => blob.path === path)?.sha256 ?? '',
            content: BLOBS[path].toString('base64'),
          },
        ])

      await stage('files/notes.txt')
      const refused = await refusal(send())
      expect(refused.diagnostics.filter((finding) => finding.severity === 'error')).toEqual([
        expect.objectContaining({
          code: 'E_BLOB_MISSING',
          file: 'knowledge/policies/docs/refunds.md',
        }),
      ])
      expect(await snapshot(workspaceId)).toEqual(empty)

      await stage('knowledge/policies/docs/refunds.md')
      const applied = await send()
      expect(applied.failed).toBeUndefined()
      const stored = await snapshot(workspaceId)
      expect(stored.bases.map((base) => base.name)).toEqual(['Policies'])
      expect(stored.documents.map((doc) => doc.filename)).toEqual(['refunds.md'])
      expect(stored.workflows.map((row) => row.name)).toContain('Answer')
    }
  )

  check(
    'a workflow naming a knowledge base the same apply adopts by name plans and applies against it',
    async () => {
      const workspaceId = await newWorkspace()
      const { knowledgeBase: existing } = await createKnowledgeBase.execute({
        principal: owner,
        input: { workspaceId, name: 'Policies' },
      })
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
        blobs: {},
      }

      const dryRun = await apply(workspaceId, dir, { dryRun: true })

      expect(findings(dryRun.diagnostics, 'error')).toEqual([])
      expect(writes(dryRun).map(({ kind, action }) => `${action} ${kind}`)).toEqual([
        'adopt knowledge-base',
        'create workflow',
      ])
      const applied = await apply(workspaceId, dir)
      expect(applied.failed).toBeUndefined()
      const stored = await snapshot(workspaceId)
      expect(stored.bases.map((base) => base.id)).toEqual([existing.id])
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
    'renaming a table column an unchanged declared workflow writes warns at the line that writes it',
    async () => {
      const { workspaceId, dir, base } = await setUp()
      const printed = (await get(workspaceId)).files['workflows/ingest/workflow.ts']
      const lines = printed.split('\n')
      const dataLine = lines.findIndex((line) => line.includes('email: start.email')) + 1
      const files = {
        ...dir.files,
        'tables/leads.ts': dir.files['tables/leads.ts'].replace(
          'column.string({ required: true })',
          "column.string({ required: true, name: 'email_address' })"
        ),
      }
      expect(files['tables/leads.ts']).toContain('email_address')

      const planned = await apply(workspaceId, { ...dir, files }, { base, dryRun: true })

      const renamed = planned.diagnostics.filter(
        (finding) => finding.code === 'W_TABLE_COLUMN_RENAMED_IN_USE'
      )
      expect(renamed).toEqual([
        expect.objectContaining({
          severity: 'warning',
          kind: 'table',
          key: 'leads',
          message:
            'tables/leads renames column "email" to "email_address", but block "Save Lead" of workflow "Ingest" still writes "email"; the run drops it.',
          file: 'workflows/ingest/workflow.ts',
          line: dataLine,
        }),
      ])
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
    'bytes staged under a SHA-256 they do not hash to are refused, nothing staged, and an apply naming them writes no kind; a dry run lists them',
    async () => {
      const workspaceId = await newWorkspace()
      const empty = await snapshot(workspaceId)
      const manifest = blobManifest(BLOBS, () => true)
      const refunds = manifest.find((blob) => blob.path === 'knowledge/policies/docs/refunds.md')
      if (!refunds) throw new Error('No refunds blob')

      const forged = await stageBlobsAs(owner, workspaceId, [
        {
          sha256: refunds.sha256,
          content: Buffer.from('not the declared bytes').toString('base64'),
        },
      ]).then(
        () => null,
        (error: unknown) => error
      )
      expect(forged).toMatchObject({ code: 'validation' })
      await stageBlobsAs(
        owner,
        workspaceId,
        manifest.flatMap((blob) =>
          blob.path === refunds.path || !blob.content
            ? []
            : [{ sha256: blob.sha256, content: blob.content }]
        )
      )
      const send = (dryRun: boolean) =>
        withPermissionGroupScope(() =>
          applyWorkspaceSource.execute({
            principal: owner,
            input: {
              workspaceId,
              files: TEXT,
              blobs: manifest.map(({ path, sha256, size }) => ({ path, sha256, size })),
              kinds: KINDS,
              dryRun,
            },
          })
        )

      const refused = await refusal(send(false))

      expect(refused.diagnostics.filter((finding) => finding.severity === 'error')).toEqual([
        expect.objectContaining({ code: 'E_BLOB_MISSING', file: refunds.path }),
      ])
      expect(await snapshot(workspaceId)).toEqual(empty)
      const dryRun = await send(true)
      expect(findings(dryRun.diagnostics, 'error')).toEqual([])
      expect(dryRun.needBlobs).toEqual([refunds.path])
    }
  )

  check('a blob listed twice, or at a path no binary file lives at, is refused', async () => {
    const workspaceId = await newWorkspace()
    const [notes] = blobManifest({ 'files/notes.txt': BLOBS['files/notes.txt'] }, () => false)

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
    ).toEqual(['E_BLOB_MANIFEST files/notes.txt', 'E_BLOB_MANIFEST tables/leads.ts'])
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
      const over = (await plan(501)).diagnostics.filter((finding) => finding.severity === 'error')
      expect(over.map(({ code, kind }) => ({ code, kind }))).toEqual([
        { code: 'E_LIMIT_EXCEEDED', kind: 'custom-tool' },
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

      const deleting = await withPermissionGroupScope(() =>
        applyWorkspaceSource.execute({
          principal: owner,
          input: {
            workspaceId,
            files: read.files,
            base: read.base,
            kinds: ['skill'],
            allowDelete: true,
          },
        })
      )
      expect(writes(deleting)).toEqual([])
      expect(
        deleting.diagnostics.filter((finding) => finding.code === 'W_UNDECLARED')
      ).toHaveLength(read.skipped.length)
    }
  )

  check(
    'a get leaves out the workflows past the directory workflow budget, and the rest applies back unchanged',
    async () => {
      const workspaceId = await newWorkspace()
      const limit = WORKSPACE_SOURCE_LIMITS.maxDirectoryWorkflowBytes
      const prompt = 'x'.repeat(Math.ceil(limit / 9))
      const created = await apply(
        workspaceId,
        {
          files: {
            'workflows/big/workflow.ts': `// @sim-sdk 1
import { agent, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Big', {}, () => {
  const start = trigger.start('Start', { inputFormat: {} })
  const answer = agent('Answer', {
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'system', content: '${prompt}' }],
  })

  start.to(answer)
})
`,
          },
          blobs: {},
        },
        { kinds: ['workflow'] }
      )
      expect(created.failed).toBeUndefined()
      const bigId = created.base.resources['workflow:big']?.id
      if (!bigId) throw new Error('The workflow was not created')
      for (let copy = 1; copy < 10; copy++) {
        await withPermissionGroupScope(() =>
          duplicateWorkflow.execute({
            principal: owner,
            input: { sourceWorkflowId: bigId, name: `Big ${copy}` },
          })
        )
      }

      const read = await withPermissionGroupScope(() =>
        readWorkspaceSource.execute({
          principal: owner,
          input: { workspaceId, kinds: ['workflow'] },
        })
      )

      const printed = Object.entries(read.files).filter(([path]) => path.startsWith('workflows/'))
      const bytes = printed.reduce((total, [, text]) => total + Buffer.byteLength(text), 0)
      expect(bytes).toBeLessThanOrEqual(limit)
      expect(read.skipped.length).toBeGreaterThan(0)
      for (const skipped of read.skipped) {
        expect(skipped).toMatchObject({
          kind: 'workflow',
          reason: expect.stringContaining('workflow limit'),
        })
      }
      const readKeys = Object.keys(read.base.resources)
      expect(readKeys.length + read.skipped.length).toBe(10)

      const again = await withPermissionGroupScope(() =>
        applyWorkspaceSource.execute({
          principal: owner,
          input: {
            workspaceId,
            files: Object.fromEntries(printed.filter(([path]) => path.includes('/.sim/'))),
            base: read.base,
            kinds: ['workflow'],
          },
        })
      )
      expect(writes(again)).toEqual([])
      expect(findings(again.diagnostics, 'error')).toEqual([])

      const deleting = await withPermissionGroupScope(() =>
        applyWorkspaceSource.execute({
          principal: owner,
          input: {
            workspaceId,
            files: Object.fromEntries(printed.filter(([path]) => path.includes('/.sim/'))),
            base: read.base,
            kinds: ['workflow'],
            allowDelete: true,
          },
        })
      )
      expect(writes(deleting)).toEqual([])
      expect(
        deleting.diagnostics.filter((finding) => finding.code === 'W_UNDECLARED')
      ).toHaveLength(read.skipped.length)
    }
  )

  check('workspace files and knowledge documents hash within one per-request budget', async () => {
    const workspaceId = await newWorkspace()
    const size = Math.floor(WORKSPACE_SOURCE_LIMITS.maxHashBytesPerRequest / 2.5)
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
    const { document: uploaded } = await uploadKnowledgeDocument.execute({
      principal: owner,
      input: {
        knowledgeBaseId: created.id,
        file: { buffer, filename: 'c.txt', fileSize: size, mimeType: 'text/plain' },
      },
    })
    // An older document, uploaded before its hash was recorded, is hashed from its bytes.
    await db.update(document).set({ fileSha256: null }).where(eq(document.id, uploaded.id))

    const read = await get(workspaceId)

    expect(read.blobs).toHaveLength(3)
    expect(read.blobs.filter((blob) => blob.sha256 === undefined)).toHaveLength(1)
  })

  check('refuses a staging request carrying more binary bytes than one request may', async () => {
    const workspaceId = await newWorkspace()
    const size = Math.floor(WORKSPACE_SOURCE_LIMITS.maxBlobBytesPerRequest / 2.5)
    const blobs = blobManifest(
      Object.fromEntries(
        ['a', 'b', 'c'].map((name) => [`files/${name}.bin`, Buffer.alloc(size, name)])
      ),
      () => true
    )

    const refused = await withPermissionGroupScope(() =>
      stageSourceBlobs.execute({
        principal: owner,
        input: {
          workspaceId,
          blobs: blobs.map((blob) => ({
            sha256: blob.sha256,
            content: Buffer.from(blob.content ?? '', 'base64'),
          })),
        },
      })
    ).then(
      () => null,
      (error: unknown) => error
    )

    expect(refused).toMatchObject({ code: 'payload_too_large' })
    const missing = await withPermissionGroupScope(() =>
      findMissingSourceBlobs.execute({
        principal: owner,
        input: { workspaceId, blobs: blobs.map(({ sha256, size }) => ({ sha256, size })) },
      })
    )
    expect(missing.missing).toHaveLength(3)

    const [alone] = blobManifest(
      { 'files/alone.bin': Buffer.alloc(WORKSPACE_SOURCE_LIMITS.maxBlobBytes, 'd') },
      () => true
    )
    await stageBlobsAs(owner, workspaceId, [{ sha256: alone.sha256, content: alone.content ?? '' }])
    const stillMissing = await withPermissionGroupScope(() =>
      findMissingSourceBlobs.execute({
        principal: owner,
        input: { workspaceId, blobs: [{ sha256: alone.sha256, size: alone.size }] },
      })
    )
    expect(stillMissing.missing).toEqual([])
  })

  check('a plan already refused authorizes no change', async () => {
    const { workspaceId, dir, base } = await setUp()
    const files = {
      ...Object.fromEntries(
        Object.entries(dir.files).filter(([path]) => path !== 'tables/leads.ts')
      ),
      'workflows/ingest/workflow.ts': TEXT['workflows/ingest/workflow.ts'].replace(
        "{ email: 'string' }",
        "{ email: 'string', name: 'string' }"
      ),
    }
    const authorize = vi.spyOn(deleteTableUseCase, 'authorize')
    let calls = -1

    const refused = await refusal(
      apply(workspaceId, { ...dir, files }, { base, allowDelete: true }).finally(() => {
        calls = authorize.mock.calls.length
        authorize.mockRestore()
      })
    )

    expect(findings(refused.diagnostics, 'error')).toEqual(['E_PLAN_REF_DELETED workflow:ingest'])
    expect(calls).toBe(0)
  })

  check('a plan reports at most 1000 findings, and one more that counts the rest', async () => {
    const workspaceId = await newWorkspace()
    const files = Object.fromEntries(
      Array.from({ length: 1_500 }, (_, index) => [`misc/${index}.ts`, ''])
    )

    const planned = await withPermissionGroupScope(() =>
      applyWorkspaceSource.execute({
        principal: owner,
        input: { workspaceId, files, kinds: KINDS, dryRun: true },
      })
    )

    const answered = withBoundWorkspaceFindings(planned).diagnostics
    expect(answered).toHaveLength(1_001)
    expect(answered.at(-1)).toMatchObject({
      code: 'I_FINDINGS_TRUNCATED',
      severity: 'info',
      message: expect.stringContaining('500 more (500 of them errors)'),
    })
    // More errors than one answer lists still refuse as what they are, never as too large.
    const refused = await refusal(
      withPermissionGroupScope(() =>
        applyWorkspaceSource.execute({
          principal: owner,
          input: { workspaceId, files, kinds: KINDS },
        })
      )
    )
    expect(refused.code).toBe('validation')
    // A size limit found after the first 1000 errors still classes the refusal as too large.
    const oversized = await refusal(
      withPermissionGroupScope(() =>
        applyWorkspaceSource.execute({
          principal: owner,
          input: {
            workspaceId,
            files: {
              ...files,
              'tables/big.ts': 'x'.repeat(WORKSPACE_SOURCE_LIMITS.maxDeclarationBytes + 1),
            },
            kinds: KINDS,
          },
        })
      )
    )
    expect(oversized.code).toBe('payload_too_large')
    expect(codes(oversized.diagnostics)).toContain('E_LIMIT_EXCEEDED')
  })

  check(
    'a plan over 1000 info findings still applies, and its answer keeps every warning while it cuts infos',
    async () => {
      const workspaceId = await newWorkspace()
      const notes = Array.from(
        { length: 230 },
        (_, index) => `  note('Note ${index}', { content: 'n' })`
      ).join('\n')
      const files: Record<string, string> = {}
      for (let index = 0; index < 5; index++) {
        files[`workflows/bulk-${index}/workflow.ts`] = `// @sim-sdk 1
import { note, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Bulk ${index}', {}, () => {
  trigger.start('Start', { inputFormat: {} })
${notes}
})
`
      }
      files['workflows/secret/workflow.ts'] = `// @sim-sdk 1
import { agent, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Secret', {}, () => {
  const start = trigger.start('Start', {})
  const answer = agent('Answer', { model: 'gpt-4o', messages: [], apiKey: 'placeholder-not-a-real-key' })
  start.to(answer)
})
`

      const result = await apply(workspaceId, { files, blobs: {} })

      expect(codes(result.diagnostics)).toEqual([])
      expect(result.failed).toBeUndefined()
      expect(result.applied).toHaveLength(6)
      const answered = withBoundWorkspaceFindings(result).diagnostics
      expect(codes(answered, 'warning')).toContain('W_LITERAL_SECRET')
      expect(codes(answered, 'info')).toContain('I_FINDINGS_TRUNCATED')
    }
  )

  check(
    'refuses deleting a child workflow an unchanged declared parent runs, and warns for one outside the directory',
    async () => {
      const workspaceId = await newWorkspace()
      const created = await apply(workspaceId, { files: CHILD_AND_PARENT, blobs: {} })
      expect(created.failed).toBeUndefined()
      const read = await get(workspaceId)
      const childId = read.base.resources['workflow:child']?.id
      const parentId = read.base.resources['workflow:parent']?.id
      if (!childId || !parentId) throw new Error('The workflows were not created')
      const baseOnly = (key: string) =>
        Object.fromEntries(
          Object.entries(read.files).filter(([path]) =>
            path.startsWith(`workflows/${key}/.sim/base.json`)
          )
        )
      const before = await snapshot(workspaceId)

      // The parent stays declared and unchanged; the child folder is gone.
      const refused = await refusal(
        apply(
          workspaceId,
          { files: { ...baseOnly('parent'), ...baseOnly('keep') }, blobs: {} },
          { base: read.base, allowDelete: true }
        )
      )
      expect(findings(refused.diagnostics, 'error')).toEqual(['E_PLAN_REF_DELETED workflow:parent'])
      expect(await snapshot(workspaceId)).toEqual(before)

      // The parent is on the server but outside the directory (and its base).
      const { 'workflow:parent': _parent, ...resources } = read.base.resources
      const outside = await apply(
        workspaceId,
        { files: baseOnly('keep'), blobs: {} },
        { base: { ...read.base, resources }, allowDelete: true, dryRun: true }
      )
      expect(codes(outside.diagnostics)).toEqual([])
      const warning = outside.diagnostics.find((finding) => finding.code === 'W_RESOURCE_IN_USE')
      expect(warning).toMatchObject({ kind: 'workflow', key: 'child' })
      expect(warning?.message).toContain('"Parent"')
      expect(outside.plan.find((change) => change.key === 'child')).toMatchObject({
        action: 'delete',
        destructive: { counts: { workflows: 1 } },
      })
    }
  )

  check(
    'no apply saves a workflow using a resource while another apply plans its delete',
    async () => {
      const workspaceId = await newWorkspace()
      const { 'workflows/parent/workflow.ts': parentFile, ...childAndKeep } = CHILD_AND_PARENT
      const created = await apply(workspaceId, { files: childAndKeep, blobs: {} })
      expect(created.failed).toBeUndefined()
      const read = await get(workspaceId)
      const keep = Object.fromEntries(
        Object.entries(read.files).filter(([path]) => path.startsWith('workflows/keep/'))
      )

      // While the delete of the child is planned, another apply tries to save a parent that runs
      // it: it is refused, so the delete never breaks a workflow its plan did not see.
      let concurrent: unknown = null
      planGate.whilePlanning = async () => {
        concurrent = await apply(workspaceId, {
          files: { 'workflows/parent/workflow.ts': parentFile },
          blobs: {},
        }).then(
          () => null,
          (error: unknown) => error
        )
      }
      const deleted = await apply(
        workspaceId,
        { files: keep, blobs: {} },
        { base: read.base, allowDelete: true }
      )
      expect(planGate.whilePlanning).toBeUndefined()
      expect(concurrent).toBeInstanceOf(WorkspaceSourceBusyError)
      expect(deleted.failed).toBeUndefined()
      expect(deleted.applied).toMatchObject([{ kind: 'workflow', key: 'child', action: 'delete' }])
      const live = await db
        .select({ name: workflow.name })
        .from(workflow)
        .where(and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt)))
      expect(live.map((row) => row.name)).toEqual(['Keep'])
    }
  )

  check(
    'refuses deleting a child workflow an edited parent still runs, and deletes one that runs only itself',
    async () => {
      const workspaceId = await newWorkspace()
      const files = {
        ...CHILD_AND_PARENT,
        'workflows/self/workflow.ts': caller('Self', 'self'),
      }
      const created = await apply(workspaceId, { files, blobs: {} })
      expect(created.failed).toBeUndefined()
      const selfId = created.base.resources['workflow:self']?.id
      if (!selfId) throw new Error('The workflow was not created')
      expect(await runsWorkflow(selfId)).toEqual([selfId])
      const read = await get(workspaceId)
      const folder = (key: string) =>
        Object.fromEntries(
          Object.entries(read.files).filter(([path]) => path.startsWith(`workflows/${key}/`))
        )
      const parent = folder('parent')
      const entry = 'workflows/parent/workflow.ts'
      const before = await snapshot(workspaceId)

      // The parent is edited (renamed) but still runs the child, whose folder is gone.
      const edited = {
        ...folder('keep'),
        ...folder('self'),
        ...parent,
        [entry]: parent[entry].replace("workflow('Parent'", "workflow('Parent v2'"),
      }
      const refused = await refusal(
        apply(workspaceId, { files: edited, blobs: {} }, { base: read.base, allowDelete: true })
      )
      expect(findings(refused.diagnostics, 'error')).toEqual(['E_PLAN_REF_DELETED workflow:parent'])
      expect(await snapshot(workspaceId)).toEqual(before)

      // A workflow that runs only itself is no user of itself: deleting it is clean.
      const deleted = await apply(
        workspaceId,
        { files: { ...folder('keep'), ...parent, ...folder('child') }, blobs: {} },
        { base: read.base, allowDelete: true }
      )
      expect(codes(deleted.diagnostics)).toEqual([])
      expect(codes(deleted.diagnostics, 'warning')).not.toContain('W_RESOURCE_IN_USE')
      expect(deleted.applied).toMatchObject([{ kind: 'workflow', key: 'self', action: 'delete' }])
    }
  )

  check(
    'creates a parent and the child it runs in one apply, whatever the folder order',
    async () => {
      for (const [parentKey, childKey] of [
        ['parent', 'child'],
        ['a-parent', 'z-child'],
      ]) {
        const workspaceId = await newWorkspace()
        const files = {
          [`workflows/${parentKey}/workflow.ts`]: caller('Parent', childKey),
          [`workflows/${childKey}/workflow.ts`]: CHILD_AND_PARENT['workflows/child/workflow.ts'],
        }

        const dryRun = await apply(workspaceId, { files, blobs: {} }, { dryRun: true })
        expect(codes(dryRun.diagnostics)).toEqual([])
        const result = await apply(workspaceId, { files, blobs: {} })

        expect(result.failed).toBeUndefined()
        const childId = result.base.resources[`workflow:${childKey}`]?.id
        const parentId = result.base.resources[`workflow:${parentKey}`]?.id
        if (!childId || !parentId) throw new Error('The workflows were not created')
        expect(await runsWorkflow(parentId)).toEqual([childId])
      }
    }
  )

  check('creates two workflows that run each other in one apply', async () => {
    const workspaceId = await newWorkspace()
    const files = {
      'workflows/ping/workflow.ts': caller('Ping', 'pong'),
      'workflows/pong/workflow.ts': caller('Pong', 'ping'),
    }

    const dryRun = await apply(workspaceId, { files, blobs: {} }, { dryRun: true })
    expect(codes(dryRun.diagnostics)).toEqual([])
    const result = await apply(workspaceId, { files, blobs: {} })

    expect(result.failed).toBeUndefined()
    const ping = result.base.resources['workflow:ping']?.id
    const pong = result.base.resources['workflow:pong']?.id
    if (!ping || !pong) throw new Error('The workflows were not created')
    expect(await runsWorkflow(ping)).toEqual([pong])
    expect(await runsWorkflow(pong)).toEqual([ping])
    const read = await get(workspaceId)
    expect(read.files['workflows/ping/workflow.ts']).toContain("childWorkflow('pong')")
  })

  check(
    'renaming the key of a table or a tool is reported as a key rename, not a taken name',
    async () => {
      const { workspaceId, dir, base } = await setUp()
      const before = await snapshot(workspaceId)
      const renamed = (from: string, to: string) =>
        Object.fromEntries(
          Object.entries(dir.files).map(([path, text]) =>
            path.startsWith(from)
              ? [path.replace(from, to), text.replaceAll("'./lookup.js'", "'./orders.js'")]
              : [path, text]
          )
        )

      for (const [files, address] of [
        [renamed('tables/leads.ts', 'tables/customers.ts'), 'table:customers'],
        [renamed('tools/lookup', 'tools/orders'), 'custom-tool:orders'],
      ] as const) {
        const dryRun = await apply(
          workspaceId,
          { files, blobs: dir.blobs },
          { base, allowDelete: true, dryRun: true }
        )
        expect(findings(dryRun.diagnostics, 'error')).toEqual([`E_KEY_RENAMED ${address}`])
        expect(dryRun.plan.filter((change) => change.action === 'delete')).toEqual([])
      }
      expect(await snapshot(workspaceId)).toEqual(before)
    }
  )
})

/** A workflow that runs the workflow under `child`. */
function caller(name: string, child: string): string {
  return `// @sim-sdk 1
import { childWorkflow, runWorkflow, trigger, workflow } from '@sim/workflow-sdk'

export default workflow('${name}', {}, () => {
  const start = trigger.start('Start', { inputFormat: {} })
  const run = runWorkflow('Run', { workflowId: childWorkflow('${child}') })
  start.to(run)
})
`
}

/** A parent that runs a child, beside the workflow every workspace keeps. */
const CHILD_AND_PARENT: Record<string, string> = {
  'workflows/parent/workflow.ts': caller('Parent', 'child'),
  'workflows/child/workflow.ts': `// @sim-sdk 1
import { trigger, workflow } from '@sim/workflow-sdk'

export default workflow('Child', {}, () => {
  trigger.start('Start', { inputFormat: {} })
})
`,
  'workflows/keep/workflow.ts': TEXT['workflows/keep/workflow.ts'],
}

/** The workflow ids the Run Workflow blocks of workflow `workflowId` store. */
async function runsWorkflow(workflowId: string): Promise<string[]> {
  const loaded = await loadWorkflowFromNormalizedTables(workflowId)
  return Object.values(loaded?.blocks ?? {}).flatMap((block) => {
    const value = block.subBlocks.workflowId?.value
    return typeof value === 'string' ? [value] : []
  })
}
