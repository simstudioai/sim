/**
 * Real PostgreSQL (and local-disk storage) coverage for knowledge bases as workspace source: a
 * `knowledge/<key>/` folder creates, updates and deletes a knowledge base and its documents
 * through the knowledge use cases, with documents travelling as blobs in rounds. Every check runs
 * in its own workspace and reads the stored rows directly, so "nothing was written" means the rows
 * are unchanged. Writes a report to `WORKSPACE_SOURCE_KNOWLEDGE_REPORT_PATH`.
 */
import { mkdtempSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  auditLog,
  document,
  knowledgeBase,
  knowledgeConnector,
  member,
  organization,
  permissionGroup,
  permissionGroupWorkspace,
  permissions,
  user,
  userStats,
  workspace,
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

import { updateKnowledgeBaseOperation } from '@/lib/knowledge/application/knowledge-bases'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import {
  type ApplyWorkspaceSourceInput,
  type ApplyWorkspaceSourceResult,
  applyWorkspaceSource,
} from '@/lib/workspace-source/application/apply-workspace-source'
import { WorkspaceSourceRejectedError } from '@/lib/workspace-source/application/errors'
import { readWorkspaceSource } from '@/lib/workspace-source/application/read-workspace-source'

const ownerId = generateId()
const memberId = generateId()
const organizationId = generateId()
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

function declaration(name: string, extra = ''): string {
  return `// @sim-sdk 1
import { defineKnowledgeBase } from '@sim/workflow-sdk/workspace'

export default defineKnowledgeBase({
  name: '${name}',${extra}
})
`
}

/** A source directory: text files, and documents by path. */
interface Directory {
  files: Record<string, string>
  docs: Record<string, Buffer>
}

const POLICIES: Directory = {
  files: { 'knowledge/policies/knowledge.ts': declaration('Policies') },
  docs: {
    'knowledge/policies/docs/refunds.md': Buffer.from('# Refunds\nWithin 30 days.\n'),
    'knowledge/policies/docs/shipping.txt': Buffer.from('Ships in two days.\n'),
  },
}

type Carry = 'all' | 'none' | readonly string[]

/** The blob manifest a directory sends, with the content of the paths `carry` names. */
function blobs(dir: Directory, carry: Carry) {
  return Object.entries(dir.docs).map(([path, bytes]) => ({
    path,
    sha256: sha256Hex(bytes),
    size: bytes.byteLength,
    ...(carry === 'all' || (carry !== 'none' && carry.includes(path))
      ? { content: bytes.toString('base64') }
      : {}),
  }))
}

/**
 * The paths the CLI carries in one round: those the server asked for, in manifest order, while
 * they fit the per-request cap (always at least one).
 */
function round(dir: Directory, wanted: readonly string[]): string[] {
  let bytes = 0
  const carried: string[] = []
  for (const blob of blobs(dir, 'none')) {
    if (!wanted.includes(blob.path)) continue
    if (bytes > 0 && bytes + blob.size > WORKSPACE_SOURCE_LIMITS.maxBlobBytesPerRequest) continue
    bytes += blob.size
    carried.push(blob.path)
  }
  return carried
}

type ApplyOptions = Partial<Omit<ApplyWorkspaceSourceInput, 'workspaceId' | 'files' | 'blobs'>> & {
  principal?: Principal
  carry?: Carry
}

function apply(workspaceId: string, dir: Directory, options: ApplyOptions = {}) {
  const { principal = owner, carry = 'all', ...input } = options
  return withPermissionGroupScope(() =>
    applyWorkspaceSource.execute({
      principal,
      input: {
        workspaceId,
        files: dir.files,
        blobs: blobs(dir, carry),
        kinds: ['knowledge-base'],
        ...input,
      },
    })
  )
}

function get(workspaceId: string) {
  return withPermissionGroupScope(() =>
    readWorkspaceSource.execute({
      principal: owner,
      input: { workspaceId, kinds: ['knowledge-base'] },
    })
  )
}

/** The directory an apply leaves behind: its reprinted files over the ones it sent. */
function reprinted(dir: Directory, result: ApplyWorkspaceSourceResult): Directory {
  return { files: { ...dir.files, ...result.files }, docs: dir.docs }
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

function actions(result: ApplyWorkspaceSourceResult, list: 'plan' | 'applied' = 'plan') {
  return result[list].map(({ kind, key, action }) => `${action} ${kind}:${key}`)
}

async function knowledgeBases(workspaceId: string) {
  return db
    .select()
    .from(knowledgeBase)
    .where(and(eq(knowledgeBase.workspaceId, workspaceId), isNull(knowledgeBase.deletedAt)))
}

async function knowledgeBaseNamed(workspaceId: string, name: string) {
  const found = (await knowledgeBases(workspaceId)).find((row) => row.name === name)
  if (!found) throw new Error(`No knowledge base named ${name}`)
  return found
}

/** Live documents of a knowledge base: what "nothing was written" compares. */
async function docs(knowledgeBaseId: string) {
  const rows = await db
    .select({
      id: document.id,
      filename: document.filename,
      fileSize: document.fileSize,
      connectorId: document.connectorId,
      processingStatus: document.processingStatus,
    })
    .from(document)
    .where(and(eq(document.knowledgeBaseId, knowledgeBaseId), isNull(document.deletedAt)))
  return rows.sort((a, b) => compareStrings(a.filename, b.filename))
}

async function snapshot(workspaceId: string) {
  const rows = await knowledgeBases(workspaceId)
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      chunkingConfig: row.chunkingConfig,
      docs: await docs(row.id),
    }))
  )
}

async function newWorkspace(options: { organizationId?: string } = {}): Promise<string> {
  const workspaceId = generateId()
  workspaceIds.push(workspaceId)
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Knowledge source',
    ownerId,
    billedAccountUserId: ownerId,
    ...(options.organizationId
      ? { organizationId: options.organizationId, workspaceMode: 'organization' as const }
      : {}),
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
      userId: memberId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'write',
    },
  ])
  return workspaceId
}

/** Applies `dir` into a fresh workspace and reads it back, as `get` would. */
async function setUp(dir: Directory = POLICIES) {
  const workspaceId = await newWorkspace()
  const created = await apply(workspaceId, dir)
  expect(created.failed).toBeUndefined()
  const read = await get(workspaceId)
  return { workspaceId, read, dir: { files: read.files, docs: dir.docs } }
}

beforeAll(async () => {
  fixtureStorage.root = mkdtempSync(join(tmpdir(), 'knowledge-source-'))
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'workflow-code'
  )
  const now = new Date()
  await db.insert(user).values(
    [ownerId, memberId].map((id) => ({
      id,
      name: 'Knowledge source fixture',
      email: `${id}@knowledge-source.invalid`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db
    .insert(userStats)
    .values([ownerId, memberId].map((userId) => ({ id: generateId(), userId })))
  await db.insert(organization).values({
    id: organizationId,
    name: 'Knowledge source',
    slug: organizationId,
    createdAt: now,
  })
  await db.insert(member).values([
    { id: generateId(), organizationId, userId: ownerId, role: 'owner', createdAt: now },
    { id: generateId(), organizationId, userId: memberId, role: 'member', createdAt: now },
  ])
})

afterAll(async () => {
  const reportPath =
    process.env.WORKSPACE_SOURCE_KNOWLEDGE_REPORT_PATH ??
    resolve('test-results/workspace-source-knowledge.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  if (workspaceIds.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.workspaceId, workspaceIds))
    await deleteWorkspaceFixture(db, inArray(workspace.id, workspaceIds))
  }
  await db.delete(permissionGroup).where(eq(permissionGroup.organizationId, organizationId))
  await db.delete(organization).where(eq(organization.id, organizationId))
  await db.delete(user).where(inArray(user.id, [ownerId, memberId]))
  if (fixtureStorage.root) await rm(fixtureStorage.root, { recursive: true, force: true })
})

describe('knowledge bases as workspace source', () => {
  check('creates a knowledge base with its documents, which index in the background', async () => {
    const workspaceId = await newWorkspace()

    const dryRun = await apply(workspaceId, POLICIES, { dryRun: true, carry: 'none' })

    expect(codes(dryRun.diagnostics)).toEqual([])
    expect(actions(dryRun)).toEqual(['create knowledge-base:policies'])
    expect(dryRun.needBlobs.sort()).toEqual(Object.keys(POLICIES.docs).sort())
    expect(
      dryRun.diagnostics.find((finding) => finding.code === 'I_KB_REEMBED')?.message
    ).toContain('Indexes 2 document(s) (2 new, 0 replaced)')
    expect(await knowledgeBases(workspaceId)).toEqual([])

    const result = await apply(workspaceId, POLICIES)

    expect(result.failed).toBeUndefined()
    expect(result.remainingBlobs).toEqual([])
    const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
    const storedDocs = await docs(stored.id)
    expect(storedDocs.map((doc) => [doc.filename, doc.processingStatus])).toEqual([
      ['refunds.md', 'pending'],
      ['shipping.txt', 'pending'],
    ])
    const entry = result.base.resources['knowledge-base:policies']
    expect(entry?.id).toBe(stored.id)
    expect(Object.keys(entry?.blobs ?? {}).sort()).toEqual(['refunds.md', 'shipping.txt'])
    expect(Object.keys(result.files)).toEqual(['knowledge/policies/knowledge.ts'])
  })

  check('a get reproduces the apply, and re-applying it changes nothing', async () => {
    const workspaceId = await newWorkspace()
    const created = await apply(workspaceId, POLICIES)

    const read = await get(workspaceId)

    expect(read.files).toEqual(created.files)
    expect(read.base).toEqual(created.base)
    expect(read.blobs.map(({ path, sha256, size }) => ({ path, sha256, size }))).toEqual(
      blobs(POLICIES, 'none').sort((a, b) => compareStrings(a.path, b.path))
    )
    const before = await snapshot(workspaceId)

    const again = await apply(
      workspaceId,
      { files: read.files, docs: POLICIES.docs },
      { base: read.base, carry: 'none' }
    )

    expect(actions(again)).toEqual(['noop knowledge-base:policies'])
    expect(again.needBlobs).toEqual([])
    expect(again.applied).toEqual([])
    expect(await snapshot(workspaceId)).toEqual(before)
  })

  check(
    'replacing a document shows the re-embed count, uploads it, and keeps the others',
    async () => {
      const { workspaceId, read, dir } = await setUp()
      const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
      const [refunds, shipping] = await docs(stored.id)
      await db.update(document).set({ tag1: 'billing' }).where(eq(document.id, refunds.id))
      const edited: Directory = {
        files: dir.files,
        docs: {
          ...dir.docs,
          'knowledge/policies/docs/refunds.md': Buffer.from('# Refunds\nWithin 60 days.\n'),
        },
      }

      const dryRun = await apply(workspaceId, edited, {
        base: read.base,
        dryRun: true,
        carry: 'none',
      })

      expect(dryRun.plan).toMatchObject([
        { action: 'update', key: 'policies', fields: ['docs/refunds.md (replace)'] },
      ])
      expect(dryRun.needBlobs).toEqual(['knowledge/policies/docs/refunds.md'])
      expect(
        dryRun.diagnostics.find((finding) => finding.code === 'I_KB_REEMBED')?.message
      ).toContain('(0 new, 1 replaced)')
      expect(codes(dryRun.diagnostics, 'warning')).toEqual(['W_KB_DOC_TAGS'])

      const result = await apply(workspaceId, edited, { base: read.base })

      expect(result.failed).toBeUndefined()
      const after = await docs(stored.id)
      expect(after.map((doc) => doc.filename)).toEqual(['refunds.md', 'shipping.txt'])
      expect(after[0].id).not.toBe(refunds.id)
      expect(after[1].id).toBe(shipping.id)
      expect(result.base.resources['knowledge-base:policies']?.blobs?.['refunds.md']).toMatchObject(
        { id: after[0].id, sha256: sha256Hex(edited.docs['knowledge/policies/docs/refunds.md']) }
      )
    }
  )

  check('refuses a content mismatch: the bytes must hash to the manifest entry', async () => {
    const workspaceId = await newWorkspace()
    const forged = blobs(POLICIES, 'all').map((blob) =>
      blob.path.endsWith('refunds.md')
        ? { ...blob, content: Buffer.from('something else').toString('base64') }
        : blob
    )

    const result = await withPermissionGroupScope(() =>
      applyWorkspaceSource.execute({
        principal: owner,
        input: {
          workspaceId,
          files: POLICIES.files,
          blobs: forged,
          kinds: ['knowledge-base'],
        },
      })
    )

    expect(result.failed).toMatchObject({ key: 'policies', code: 'E_APPLY_REFUSED' })
    const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
    expect((await docs(stored.id)).map((doc) => doc.filename)).not.toContain('refunds.md')
  })

  check(
    'refuses an edit to a knowledge base changed on the server, and notes one it leaves',
    async () => {
      const { workspaceId, read, dir } = await setUp()
      const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
      await updateKnowledgeBaseOperation.execute({
        principal: owner,
        input: { knowledgeBaseId: stored.id, description: 'Edited in the UI' },
      })
      const before = await snapshot(workspaceId)
      const edited: Directory = {
        ...dir,
        files: {
          'knowledge/policies/knowledge.ts': dir.files['knowledge/policies/knowledge.ts'].replace(
            "name: 'Policies'",
            "name: 'Policies v2'"
          ),
        },
      }

      const stale = await refusal(apply(workspaceId, edited, { base: read.base, carry: 'none' }))

      expect(stale.stale).toBe(true)
      expect(codes(stale.diagnostics)).toEqual(['E_APPLY_STALE'])
      expect(await snapshot(workspaceId)).toEqual(before)

      const untouched = await apply(workspaceId, dir, { base: read.base, carry: 'none' })
      expect(untouched.applied).toEqual([])
      expect(codes(untouched.diagnostics, 'info')).toContain('I_SERVER_CHANGED')
      expect(await snapshot(workspaceId)).toEqual(before)
    }
  )

  check('refuses a changed embedding model, and never touches a connector document', async () => {
    const { workspaceId, read, dir } = await setUp()
    const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
    const connectorId = generateId()
    await db.insert(knowledgeConnector).values({
      id: connectorId,
      knowledgeBaseId: stored.id,
      connectorType: 'github',
      sourceConfig: {},
      status: 'paused',
    })
    const syncedId = generateId()
    await db.insert(document).values({
      id: syncedId,
      knowledgeBaseId: stored.id,
      filename: 'synced.md',
      fileUrl: `data:text/markdown;base64,${Buffer.from('# Synced\n').toString('base64')}`,
      fileSize: 9,
      mimeType: 'text/markdown',
      connectorId,
      externalId: 'synced',
      contentHash: 'synced-v1',
    })
    const declared = dir.files['knowledge/policies/knowledge.ts']
    expect(declared).toContain(`embeddingModel: '${stored.embeddingModel}'`)
    const before = await snapshot(workspaceId)

    const refused = await refusal(
      apply(
        workspaceId,
        {
          ...dir,
          files: {
            'knowledge/policies/knowledge.ts': declared.replace(
              stored.embeddingModel,
              'text-embedding-3-large'
            ),
          },
        },
        { base: read.base, carry: 'none' }
      )
    )

    expect(codes(refused.diagnostics)).toEqual(['E_KB_EMBEDDING_IMMUTABLE'])
    expect(await snapshot(workspaceId)).toEqual(before)

    const reread = await get(workspaceId)
    expect(Object.keys(reread.files)).toEqual(['knowledge/policies/knowledge.ts'])
    expect(reread.blobs.map((blob) => blob.path)).not.toContain('knowledge/policies/docs/synced.md')
    expect(codes(reread.diagnostics, 'info')).toEqual(['I_KB_UNMANAGED_DOCS'])

    const emptied = await apply(
      workspaceId,
      { files: reread.files, docs: {} },
      { base: reread.base, allowDelete: true, carry: 'none' }
    )

    expect(emptied.failed).toBeUndefined()
    expect(emptied.plan[0]?.destructive).toEqual({ what: 'documents', counts: { documents: 2 } })
    expect((await docs(stored.id)).map((doc) => doc.id)).toEqual([syncedId])
  })

  check(
    'deletes documents and knowledge bases only with --allow-delete, showing document counts',
    async () => {
      const { workspaceId, read, dir } = await setUp()
      const before = await snapshot(workspaceId)
      const withoutShipping: Directory = {
        files: dir.files,
        docs: {
          'knowledge/policies/docs/refunds.md': dir.docs['knowledge/policies/docs/refunds.md'],
        },
      }

      const docRefused = await refusal(
        apply(workspaceId, withoutShipping, { base: read.base, carry: 'none' })
      )
      expect(codes(docRefused.diagnostics)).toEqual(['E_APPLY_DELETE_NOT_ALLOWED'])
      expect(docRefused.diagnostics[0].message).toContain('docs/shipping.txt')

      const kbRefused = await refusal(
        apply(workspaceId, { files: {}, docs: {} }, { base: read.base, carry: 'none' })
      )
      expect(codes(kbRefused.diagnostics)).toEqual(['E_APPLY_DELETE_NOT_ALLOWED'])
      expect(await snapshot(workspaceId)).toEqual(before)

      const dryRun = await apply(
        workspaceId,
        { files: {}, docs: {} },
        { base: read.base, allowDelete: true, dryRun: true, carry: 'none' }
      )
      expect(dryRun.plan).toEqual([
        expect.objectContaining({
          action: 'delete',
          destructive: { what: 'knowledge base', counts: { documents: 2 } },
        }),
      ])

      const deleted = await apply(
        workspaceId,
        { files: {}, docs: {} },
        { base: read.base, allowDelete: true, carry: 'none' }
      )
      expect(deleted.failed).toBeUndefined()
      expect(await knowledgeBases(workspaceId)).toEqual([])
      expect(deleted.base.resources).toEqual({})
    }
  )

  check('refuses a declared document the server holds twice under one name', async () => {
    const { workspaceId } = await setUp()
    const stored = await knowledgeBaseNamed(workspaceId, 'Policies')
    const [refunds] = await docs(stored.id)
    const [row] = await db.select().from(document).where(eq(document.id, refunds.id))
    await db.insert(document).values({ ...row, id: generateId() })
    const read = await get(workspaceId)
    expect(read.blobs.map((blob) => blob.path)).toEqual(['knowledge/policies/docs/shipping.txt'])
    expect(codes(read.diagnostics, 'info')).toEqual(['I_KB_UNMANAGED_DOCS'])
    const before = await snapshot(workspaceId)

    const refused = await refusal(
      apply(workspaceId, { files: read.files, docs: POLICIES.docs }, { base: read.base })
    )

    expect(codes(refused.diagnostics)).toEqual(['E_KB_DOC_AMBIGUOUS'])
    expect(await snapshot(workspaceId)).toEqual(before)
  })

  check('refuses at plan time a member whose permission group withholds uploads', async () => {
    const workspaceId = await newWorkspace({ organizationId })
    const groupId = generateId()
    await db.insert(permissionGroup).values({
      id: groupId,
      organizationId,
      createdBy: ownerId,
      name: `Knowledge uploads withheld ${groupId}`,
      config: { disableKnowledgeBaseFileUpload: true },
      membershipMode: 'inherit',
    })
    await db.insert(permissionGroupWorkspace).values({
      id: generateId(),
      permissionGroupId: groupId,
      workspaceId,
      organizationId,
    })
    const writer = createSessionPrincipal({ userId: memberId, sessionId: generateId() })

    const refused = await refusal(apply(workspaceId, POLICIES, { principal: writer }))

    expect(codes(refused.diagnostics)).toEqual(['E_APPLY_FORBIDDEN'])
    expect(refused.diagnostics.find((finding) => finding.severity === 'error')).toMatchObject({
      kind: 'knowledge-base',
      key: 'policies',
    })
    expect(await knowledgeBases(workspaceId)).toEqual([])
  })

  check(
    'documents over the request cap travel in two rounds, deletes run only in the last, and an interrupted apply resumes',
    async () => {
      const big = (fill: string) => Buffer.alloc(9_000_000, fill)
      const start: Directory = {
        files: {
          ...POLICIES.files,
          'knowledge/archive/knowledge.ts': declaration('Archive'),
        },
        docs: POLICIES.docs,
      }
      const { workspaceId, read, dir } = await setUp(start)
      const policies = await knowledgeBaseNamed(workspaceId, 'Policies')
      const shipping = (await docs(policies.id)).find((doc) => doc.filename === 'shipping.txt')
      const target: Directory = {
        files: {
          'knowledge/policies/knowledge.ts': dir.files['knowledge/policies/knowledge.ts'],
          'knowledge/faq/knowledge.ts': declaration('FAQ'),
        },
        docs: {
          'knowledge/faq/docs/a.txt': big('a'),
          'knowledge/policies/docs/refunds.md': dir.docs['knowledge/policies/docs/refunds.md'],
          'knowledge/policies/docs/b.txt': big('b'),
          'knowledge/policies/docs/c.txt': big('c'),
          'knowledge/policies/docs/d.txt': big('d'),
        },
      }
      const options = { base: read.base, allowDelete: true }

      const preview = await apply(workspaceId, target, { ...options, dryRun: true, carry: 'none' })
      expect(codes(preview.diagnostics)).toEqual([])
      expect(preview.needBlobs.sort()).toEqual([
        'knowledge/faq/docs/a.txt',
        'knowledge/policies/docs/b.txt',
        'knowledge/policies/docs/c.txt',
        'knowledge/policies/docs/d.txt',
      ])
      const first = round(target, preview.needBlobs)
      expect(first).toEqual(['knowledge/faq/docs/a.txt', 'knowledge/policies/docs/b.txt'])

      const one = await apply(workspaceId, target, { ...options, carry: first })

      expect(one.failed).toBeUndefined()
      expect(actions(one, 'applied').sort()).toEqual([
        'create knowledge-base:faq',
        'update knowledge-base:policies',
      ])
      expect(one.remainingBlobs.sort()).toEqual([
        'knowledge/policies/docs/c.txt',
        'knowledge/policies/docs/d.txt',
      ])
      expect((await docs(policies.id)).map((doc) => doc.filename)).toEqual([
        'b.txt',
        'refunds.md',
        'shipping.txt',
      ])
      expect((await knowledgeBases(workspaceId)).map((row) => row.name).sort()).toEqual([
        'Archive',
        'FAQ',
        'Policies',
      ])

      /** Interrupted here: a fresh apply starts from the directory the first round saved. */
      const saved = reprinted(target, one)
      const resumedPlan = await apply(workspaceId, saved, {
        base: one.base,
        allowDelete: true,
        dryRun: true,
        carry: 'none',
      })
      expect(resumedPlan.needBlobs.sort()).toEqual([
        'knowledge/policies/docs/c.txt',
        'knowledge/policies/docs/d.txt',
      ])
      const second = round(saved, resumedPlan.needBlobs)
      expect(second).toEqual(resumedPlan.needBlobs.sort())

      const two = await apply(workspaceId, saved, {
        base: one.base,
        allowDelete: true,
        carry: second,
      })

      expect(two.failed).toBeUndefined()
      expect(two.remainingBlobs).toEqual([])
      expect(actions(two, 'applied')).toEqual([
        'update knowledge-base:policies',
        'delete knowledge-base:archive',
      ])
      const final = await docs(policies.id)
      expect(final.map((doc) => doc.filename)).toEqual(['b.txt', 'c.txt', 'd.txt', 'refunds.md'])
      expect(final.map((doc) => doc.id)).not.toContain(shipping?.id)
      expect((await knowledgeBases(workspaceId)).map((row) => row.name).sort()).toEqual([
        'FAQ',
        'Policies',
      ])

      const settled = await apply(workspaceId, reprinted(saved, two), {
        base: two.base,
        allowDelete: true,
        carry: 'none',
      })
      expect(settled.plan.every((change) => change.action === 'noop')).toBe(true)
    }
  )
})
