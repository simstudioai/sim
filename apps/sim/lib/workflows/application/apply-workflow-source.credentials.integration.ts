/**
 * Source get and apply over a credential the caller cannot see, against real PostgreSQL. A key is
 * derived from a credential's display name, so printing or allocating one for a reader who is not
 * a member of the credential would show them a name the credential listing withholds. The reader's
 * source keeps the stored id instead, and an unchanged re-apply keeps the binding.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  credential,
  permissions,
  user,
  workflow,
  workspace,
  workspaceResourceKey,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { saveWorkflowToNormalizedTables } from '@sim/workflow-persistence/save'
import type { BlockState } from '@sim/workflow-types/workflow'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'
import { applyWorkflowSource } from '@/lib/workflows/application/apply-workflow-source'
import { readWorkflowSource } from '@/lib/workflows/application/read-workflow-source'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)

const ownerId = generateId()
const readerId = generateId()
const workspaceId = generateId()
const owner = createSessionPrincipal({ userId: ownerId, sessionId: generateId() })
const reader = createSessionPrincipal({ userId: readerId, sessionId: generateId() })

const hiddenKey = 'alice-corp-com-gmail'

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

/** A credential nobody but the workspace admin may see, named after its owner's mailbox. */
async function seedHiddenCredential(): Promise<string> {
  const id = generateId()
  await db.insert(credential).values({
    id,
    workspaceId,
    type: 'service_account',
    displayName: 'alice@corp.com Gmail',
    providerId: 'google-email',
    createdBy: ownerId,
  })
  return id
}

/** Start → Score (a function) → Mail (Gmail on `credentialId`). */
async function seedWorkflow(credentialId: string) {
  const workflowId = generateId()
  const now = new Date()
  await db.insert(workflow).values({
    id: workflowId,
    userId: ownerId,
    workspaceId,
    name: `Hidden credential ${workflowId}`,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  const start = seedBlock('start_trigger', 'Start')
  const score = seedBlock('function', 'Score', { code: ['code', 'return 1'] })
  const mail = seedBlock('gmail', 'Mail', {
    operation: ['dropdown', 'read_gmail'],
    credential: ['oauth-input', credentialId],
  })
  const saved = await saveWorkflowToNormalizedTables(workflowId, {
    blocks: { [start.id]: start, [score.id]: score, [mail.id]: mail },
    edges: [
      { id: generateId(), source: start.id, target: score.id },
      { id: generateId(), source: score.id, target: mail.id },
    ],
    loops: {},
    parallels: {},
  })
  if (!saved.success) throw new Error(`Seeding the workflow failed: ${saved.error}`)
  return { workflowId, mailId: mail.id }
}

function getSource(principal: Principal, workflowId: string) {
  return withPermissionGroupScope(() =>
    readWorkflowSource.execute({ principal, input: { workflowId, functionCode: 'inline' } })
  )
}

function apply(
  principal: Principal,
  source: Awaited<ReturnType<typeof getSource>>,
  files: Record<string, string>
) {
  return withPermissionGroupScope(() =>
    applyWorkflowSource.execute({
      principal,
      input: { workflowId: source.workflowId, files, lock: source.lock, base: source.base },
    })
  )
}

function edit(files: Record<string, string>, from: string, to: string): Record<string, string> {
  const text = files['workflow.ts']
  expect(text.split(from), `workflow.ts holds "${from}" once`).toHaveLength(2)
  return { ...files, 'workflow.ts': text.replace(from, to) }
}

function credentialKeyRows(credentialId: string) {
  return db
    .select({ key: workspaceResourceKey.key })
    .from(workspaceResourceKey)
    .where(
      and(
        eq(workspaceResourceKey.workspaceId, workspaceId),
        eq(workspaceResourceKey.kind, 'credential'),
        eq(workspaceResourceKey.resourceId, credentialId)
      )
    )
}

async function storedCredential(workflowId: string, mailId: string) {
  const stored = await loadWorkflowFromNormalizedTables(workflowId)
  return stored?.blocks[mailId]?.subBlocks.credential?.value
}

beforeAll(async () => {
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'workflow-code'
  )
  const now = new Date()
  await db.insert(user).values(
    [ownerId, readerId].map((id) => ({
      id,
      name: 'Hidden credential fixture',
      email: `${id}@hidden-credential.invalid`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Hidden credential',
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
      userId: readerId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'write',
    },
  ])
})

afterAll(async () => {
  const reportPath =
    process.env.WORKFLOW_SOURCE_CREDENTIALS_REPORT_PATH ??
    resolve('test-results/workflow-source-credentials.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  await db.delete(credential).where(eq(credential.workspaceId, workspaceId))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(user).where(inArray(user.id, [ownerId, readerId]))
})

check(
  'a reader who cannot see the credential gets its id, and allocates no key from its name',
  async () => {
    const credentialId = await seedHiddenCredential()
    const { workflowId } = await seedWorkflow(credentialId)

    const source = await getSource(reader, workflowId)

    expect(source.files['workflow.ts']).not.toContain(hiddenKey)
    expect(source.files['workflow.ts']).toContain(credentialId)
    expect(await credentialKeyRows(credentialId)).toEqual([])
  }
)

check('a dry run over a stored credential that has no key yet allocates none for it', async () => {
  const credentialId = await seedHiddenCredential()
  const { workflowId } = await seedWorkflow(credentialId)
  const source = await getSource(reader, workflowId)
  expect(await credentialKeyRows(credentialId)).toEqual([])

  const answer = await withPermissionGroupScope(() =>
    applyWorkflowSource.execute({
      principal: owner,
      input: {
        workflowId,
        files: edit(source.files, 'js`return 1`', 'js`return 2`'),
        lock: source.lock,
        base: source.base,
        dryRun: true,
      },
    })
  )

  expect(answer.dryRun).toBe(true)
  expect(await credentialKeyRows(credentialId)).toEqual([])
})

check('a reader never sees the key an admin already allocated from the name', async () => {
  const credentialId = await seedHiddenCredential()
  const { workflowId } = await seedWorkflow(credentialId)
  const ownerSource = await getSource(owner, workflowId)
  expect(ownerSource.files['workflow.ts']).toContain(`credential('${hiddenKey}`)

  const source = await getSource(reader, workflowId)

  expect(source.files['workflow.ts']).not.toContain(hiddenKey)
  expect(source.files['workflow.ts']).toContain(credentialId)
})

check(
  'a reader’s edit elsewhere keeps the binding, and the admin’s next get still round-trips',
  async () => {
    const credentialId = await seedHiddenCredential()
    const { workflowId, mailId } = await seedWorkflow(credentialId)
    const source = await getSource(reader, workflowId)

    const applied = await apply(reader, source, edit(source.files, 'js`return 1`', 'js`return 2`'))

    expect(applied.applied).toBe(true)
    expect(await storedCredential(workflowId, mailId)).toBe(credentialId)
    const ownerSource = await getSource(owner, workflowId)
    expect(ownerSource.files['workflow.ts']).toContain(`credential('${hiddenKey}`)
    const noop = await apply(owner, ownerSource, ownerSource.files)
    expect(noop.applied).toBe(false)
    expect(await storedCredential(workflowId, mailId)).toBe(credentialId)
  }
)

check(
  'a key a reader names where a credential they cannot see is stored keeps it, alike whether or not it is its key',
  async () => {
    const credentialId = await seedHiddenCredential()
    const { workflowId, mailId } = await seedWorkflow(credentialId)
    const ownerSource = await getSource(owner, workflowId)
    const key = ownerSource.files['workflow.ts'].match(/credential\('([^']+)'\)/)?.[1] ?? ''
    expect(key).toContain(hiddenKey)
    const source = await getSource(reader, workflowId)
    const unresolved = source.files['workflow.ts'].match(/raw\(\{[^}]*\}\)/)?.[0]
    expect(unresolved).toContain(credentialId)
    const naming = (named: string) => {
      const files = edit(source.files, unresolved ?? '', `credential('${named}')`)
      files['workflow.ts'] = files['workflow.ts'].replace(/^import \{ /m, 'import { credential, ')
      return files
    }

    const right = await apply(reader, source, naming(key))
    const guess = await apply(reader, source, naming(`${key}-guess`))

    const codes = (answer: typeof right) => answer.diagnostics.map((finding) => finding.code)
    expect(right.applied).toBe(false)
    expect(guess.applied).toBe(false)
    expect(codes(right)).toContain('W_APPLY_CREDENTIAL_KEPT')
    expect(codes(guess)).toEqual(codes(right))
    expect(await storedCredential(workflowId, mailId)).toBe(credentialId)

    const elsewhere = naming(key)
    elsewhere['workflow.ts'] = elsewhere['workflow.ts'].replace(
      'score.to(mail)',
      `score.to(mail)\n  const copy = legacy.gmail.readEmail('Copy', { credential: credential('${key}') })\n  mail.to(copy)`
    )
    await expect(apply(reader, source, elsewhere)).rejects.toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'E_APPLY_CREDENTIAL_UNREACHABLE' }),
      ]),
    })
    expect(await storedCredential(workflowId, mailId)).toBe(credentialId)
  }
)

check(
  'a member who cannot see a credential applies source an admin read: unchanged it writes nothing, edited it writes',
  async () => {
    const credentialId = await seedHiddenCredential()
    const { workflowId, mailId } = await seedWorkflow(credentialId)
    const ownerSource = await getSource(owner, workflowId)
    expect(ownerSource.files['workflow.ts']).toContain(`credential('${hiddenKey}`)

    const unchanged = await apply(reader, ownerSource, ownerSource.files)
    expect(unchanged.applied).toBe(false)
    expect((await getSource(reader, workflowId)).base.fingerprint).toBe(
      ownerSource.base.fingerprint
    )
    expect(unchanged.base.fingerprint).toBe(ownerSource.base.fingerprint)

    const submitted = edit(ownerSource.files, 'js`return 1`', 'js`return 2`')
    const edited = await apply(reader, ownerSource, submitted)

    expect(edited.applied).toBe(true)
    expect(edited.files['workflow.ts']).toBe(submitted['workflow.ts'])
    expect(await storedCredential(workflowId, mailId)).toBe(credentialId)
    const readerSource = await getSource(reader, workflowId)
    expect(readerSource.files['workflow.ts']).not.toContain(hiddenKey)
    expect(readerSource.base.fingerprint).toBe(edited.base.fingerprint)
    const ownerAfter = await getSource(owner, workflowId)
    expect(ownerAfter.base.fingerprint).toBe(edited.base.fingerprint)
    expect(ownerAfter.files['workflow.ts']).toBe(submitted['workflow.ts'])
  }
)

check(
  'a member who cannot see a credential renames the block that holds it, and the credential is kept',
  async () => {
    const credentialId = await seedHiddenCredential()
    const { workflowId, mailId } = await seedWorkflow(credentialId)
    const ownerSource = await getSource(owner, workflowId)
    expect(ownerSource.files['workflow.ts']).toContain(`credential('${hiddenKey}`)

    const renamed = await apply(
      reader,
      ownerSource,
      edit(ownerSource.files, "'Mail'", "'Mail inbox'")
    )

    expect(renamed.applied).toBe(true)
    expect(renamed.diagnostics.map((finding) => finding.code)).toContain('W_APPLY_CREDENTIAL_KEPT')
    expect(await storedCredential(workflowId, mailId)).toBe(credentialId)
    const stored = await loadWorkflowFromNormalizedTables(workflowId)
    expect(stored?.blocks[mailId]?.name).toBe('Mail inbox')
  }
)
