/** Real PostgreSQL and local object storage: who reaches an issue's body, and how a working chat is claimed and released. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Principal } from '@sim/auth/principal'
import { db, dbFor } from '@sim/db'
import { copilotChats, issue, issueEvent, organization, user, workspace } from '@sim/db/schema'
import { createSessionPrincipal, createWorkspaceApiKeyPrincipal } from '@sim/testing'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))

const flags = vi.hoisted(() => ({ issues: true }))
vi.mock('@/lib/core/config/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/core/config/feature-flags')>()
  return {
    ...actual,
    isFeatureEnabled: (name: string, context: Parameters<typeof actual.isFeatureEnabled>[1]) =>
      name === 'issues'
        ? Promise.resolve(flags.issues)
        : actual.isFeatureEnabled(name as Parameters<typeof actual.isFeatureEnabled>[0], context),
  }
})

import { buildFileDocSeed } from '@/lib/collab-doc/seed'
import { createIssue, startIssue } from '@/lib/issues/application/issues'
import { detachChatFromIssuesInTx } from '@/lib/issues/repository'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { listWorkspaceFiles } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { deleteWorkspaceFileOperation } from '@/lib/workspace-files/application/delete-workspace-file'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { readWorkspaceFileContent } from '@/lib/workspace-files/application/read-workspace-file-content'
import { renameWorkspaceFile } from '@/lib/workspace-files/application/rename-workspace-file'
import { resolveWorkspaceFileReference } from '@/lib/workspace-files/application/resolve-workspace-file-reference'
import { updateWorkspaceFileContent } from '@/lib/workspace-files/application/update-workspace-file-content'

describe('issue bodies in PostgreSQL', () => {
  const ids = createKnowledgeAclFixtureIds()
  const alice = createSessionPrincipal({ userId: ids.aliceId })

  beforeAll(async () => {
    fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-issue-bodies-'))
    await seedKnowledgeAclFixture(ids)
  })

  afterAll(async () => {
    await db.delete(issue).where(eq(issue.workspaceId, ids.workspaceId))
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    await rm(fixtureStorage.root, { recursive: true, force: true })
    await Promise.all([db.$client.end(), dbFor('cleanup').$client.end()])
  })

  async function fileIssue(title: string) {
    const { issue: created } = await createIssue.execute({
      principal: alice,
      input: { workspaceId: ids.workspaceId, title, body: '# Evidence\n' },
    })
    return created
  }

  function readBody(fileId: string, principal: Principal = alice) {
    return readWorkspaceFileContent.execute({ principal, input: { fileId } })
  }

  async function newChat() {
    const [chat] = await db
      .insert(copilotChats)
      .values({ userId: ids.aliceId, workspaceId: ids.workspaceId, type: 'mothership' })
      .returning({ id: copilotChats.id })
    return chat.id
  }

  it('reads and edits a body by id and as issues/<KEY>.md, but never lists it as a file', async () => {
    const filed = await fileIssue('Readable body')
    const files = await listWorkspaceFiles(ids.workspaceId)
    expect(files.some((file) => file.id === filed.bodyFileId)).toBe(false)

    expect((await readBody(filed.bodyFileId)).content.toString()).toBe('# Evidence\n')
    await updateWorkspaceFileContent.execute({
      principal: alice,
      input: { fileId: filed.bodyFileId, content: '# Edited\n', encoding: 'utf-8' },
    })
    expect((await readBody(filed.bodyFileId)).content.toString()).toBe('# Edited\n')

    const byPath = await resolveWorkspaceFileReference({
      principal: alice,
      operation: fileOperations.readContent,
      workspaceId: ids.workspaceId,
      reference: `issues/${filed.key}.md`,
    })
    expect(byPath.id).toBe(filed.bodyFileId)
  })

  it('refuses file management, workspace API keys, a disabled flag, and a deleted issue', async () => {
    const filed = await fileIssue('Guarded body')
    const notFound = { code: 'not_found' }

    await expect(
      renameWorkspaceFile.execute({
        principal: alice,
        input: { fileId: filed.bodyFileId, name: 'renamed.md' },
      })
    ).rejects.toMatchObject(notFound)
    await expect(
      deleteWorkspaceFileOperation.execute({
        principal: alice,
        input: { fileId: filed.bodyFileId },
      })
    ).rejects.toMatchObject(notFound)
    await expect(
      resolveWorkspaceFileReference({
        principal: alice,
        operation: fileOperations.rename,
        workspaceId: ids.workspaceId,
        reference: `issues/${filed.key}.md`,
      })
    ).rejects.toMatchObject(notFound)
    await expect(
      readBody(filed.bodyFileId, createWorkspaceApiKeyPrincipal({ workspaceId: ids.workspaceId }))
    ).rejects.toMatchObject(notFound)

    flags.issues = false
    try {
      await expect(readBody(filed.bodyFileId)).rejects.toMatchObject({ code: 'forbidden' })
      expect(await buildFileDocSeed(ids.workspaceId, filed.bodyFileId)).toBeNull()
    } finally {
      flags.issues = true
    }

    await db.update(issue).set({ deletedAt: new Date() }).where(eq(issue.id, filed.id))
    await expect(readBody(filed.bodyFileId)).rejects.toMatchObject(notFound)
  })

  it('lets only one issue claim a chat, and returns the issue to the inbox when the chat is deleted', async () => {
    const [first, second] = await Promise.all([fileIssue('First claim'), fileIssue('Second claim')])
    const chatId = await newChat()
    const results = await Promise.allSettled(
      [first, second].map((filed) =>
        startIssue.execute({
          principal: alice,
          input: { workspaceId: ids.workspaceId, key: filed.key, chatId },
        })
      )
    )
    const started = results.filter((result) => result.status === 'fulfilled')
    expect(started).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'conflict' },
    })

    const working = await db
      .select({ id: issue.id, status: issue.status })
      .from(issue)
      .where(eq(issue.workingChatId, chatId))
    expect(working).toHaveLength(1)
    const [chat] = await db
      .select({ issueId: copilotChats.issueId })
      .from(copilotChats)
      .where(eq(copilotChats.id, chatId))
    expect(chat.issueId).toBe(working[0].id)

    await db.transaction((tx) => detachChatFromIssuesInTx(tx, chatId))
    const [released] = await db
      .select({ status: issue.status, workingChatId: issue.workingChatId })
      .from(issue)
      .where(eq(issue.id, working[0].id))
    expect(released).toEqual({ status: 'inbox', workingChatId: null })
    const detached = await db
      .select({ kind: issueEvent.kind })
      .from(issueEvent)
      .where(and(eq(issueEvent.issueId, working[0].id), eq(issueEvent.kind, 'chat_detached')))
    expect(detached).toHaveLength(1)
  })
})
