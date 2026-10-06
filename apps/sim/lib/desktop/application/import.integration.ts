/**
 * A desktop background executor importing a claimed `import_local_files` call's files into the
 * workspace, against real PostgreSQL and file storage on disk: where entries land, how a tree
 * merges into folders already there, and every way a request that does not own the import is
 * refused.
 */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))

import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  copilotAsyncToolCalls,
  copilotChats,
  copilotRuns,
  desktopDevices,
  permissions,
  session,
  user,
  userStats,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { importDesktopEntry } from '@/lib/desktop/application/import'
import { DesktopDeviceUnrecognizedError } from '@/lib/desktop/executor/errors'
import {
  createWorkspaceFileFolder,
  listWorkspaceFileFolders,
} from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'

describe('desktop imports', () => {
  const userIds: string[] = []

  beforeAll(() => {
    fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-desktop-import-'))
  })

  afterAll(async () => {
    if (userIds.length) {
      await db.delete(workspace).where(inArray(workspace.ownerId, userIds))
      await db.delete(user).where(inArray(user.id, userIds))
    }
    await rm(fixtureStorage.root, { recursive: true, force: true })
  })

  /** A signed-in desktop whose turn claimed an import into a folder of its workspace. */
  async function claimedImport() {
    const userId = generateId()
    const workspaceId = generateId()
    const sessionId = generateId()
    const deviceId = generateId()
    const now = new Date()
    userIds.push(userId)
    await db.insert(user).values({
      id: userId,
      name: 'Desktop import fixture',
      email: `${userId}@desktop-import.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(userStats).values({ id: generateId(), userId })
    await db.insert(workspace).values({
      id: workspaceId,
      name: 'Desktop import fixture',
      ownerId: userId,
      billedAccountUserId: userId,
    })
    await db.insert(permissions).values({
      id: generateId(),
      userId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin',
    })
    await db.insert(session).values({
      id: sessionId,
      userId,
      token: generateId(),
      expiresAt: new Date(now.getTime() + 3_600_000),
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(desktopDevices).values({
      id: deviceId,
      userId,
      sessionId,
      name: 'Studio Mac',
      appVersion: '0.9.0',
      platform: 'darwin-arm64',
      capabilities: { executor: 1, browser: true, terminal: true, localFiles: true },
    })
    const target = await createWorkspaceFileFolder({
      workspaceId,
      userId,
      name: 'Imports',
    })
    const chatId = generateId()
    const runId = generateId()
    await db.insert(copilotChats).values({ id: chatId, userId, workspaceId, type: 'mothership' })
    await db.insert(copilotRuns).values({
      id: runId,
      executionId: generateId(),
      chatId,
      userId,
      workspaceId,
      streamId: generateId(),
      status: 'paused_waiting_for_tool',
      desktopDeviceId: deviceId,
    })
    const toolCallId = generateId()
    const executionToken = generateId()
    await db.insert(copilotAsyncToolCalls).values({
      runId,
      toolCallId,
      toolName: 'import_local_files',
      args: { path: '~/Reports', targetWorkspaceId: workspaceId, folderId: target.id },
      status: 'running',
      claimedBy: 'files',
      executionOwnerToken: executionToken,
    })
    const principal: SessionPrincipal = { kind: 'session', userId, sessionId }
    return { principal, workspaceId, deviceId, toolCallId, executionToken, targetId: target.id }
  }

  function entry(
    claimed: Awaited<ReturnType<typeof claimedImport>>,
    kind: 'file' | 'directory',
    relativePath: string,
    content?: string
  ) {
    return importDesktopEntry.execute({
      principal: claimed.principal,
      input: {
        deviceId: claimed.deviceId,
        toolCallId: claimed.toolCallId,
        executionToken: claimed.executionToken,
        kind,
        sourceName: 'Reports',
        relativePath,
        ...(content !== undefined ? { content: Buffer.from(content) } : {}),
      },
    })
  }

  async function activeFile(workspaceId: string, fileId: string) {
    const [file] = await db
      .select()
      .from(workspaceFiles)
      .where(
        and(
          eq(workspaceFiles.workspaceId, workspaceId),
          eq(workspaceFiles.id, fileId),
          isNull(workspaceFiles.deletedAt)
        )
      )
    return file
  }

  it("lands a directory import's tree under the call's target folder", async () => {
    const claimed = await claimedImport()

    const root = await entry(claimed, 'directory', '')
    const q3 = await entry(claimed, 'directory', 'q3')
    const report = await entry(claimed, 'file', 'q3/summary.txt', 'quarterly numbers')

    const folders = await listWorkspaceFileFolders(claimed.workspaceId)
    const byId = new Map(folders.map((folder) => [folder.id, folder]))
    expect(byId.get(root.id)?.parentId).toBe(claimed.targetId)
    expect(byId.get(q3.id)?.parentId).toBe(root.id)
    const stored = await activeFile(claimed.workspaceId, report.id)
    expect(stored?.folderId).toBe(q3.id)
    expect(stored).toBeDefined()
  })

  it('merges into folders that already exist and never overwrites a file', async () => {
    const claimed = await claimedImport()
    const first = await entry(claimed, 'directory', '')
    const again = await entry(claimed, 'directory', '')
    const original = await entry(claimed, 'file', 'notes.txt', 'v1')
    const second = await entry(claimed, 'file', 'notes.txt', 'v2')

    expect(again.id).toBe(first.id)
    expect(second.id).not.toBe(original.id)
    expect(second.name).not.toBe(original.name)
  })

  it('refuses an import presented with a token that did not claim it', async () => {
    const claimed = await claimedImport()

    await expect(
      importDesktopEntry.execute({
        principal: claimed.principal,
        input: {
          deviceId: claimed.deviceId,
          toolCallId: claimed.toolCallId,
          executionToken: 'someone-else',
          kind: 'file',
          sourceName: 'Reports',
          relativePath: '',
          content: Buffer.from('x'),
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it('refuses an import that is no longer running', async () => {
    const claimed = await claimedImport()
    await db
      .update(copilotAsyncToolCalls)
      .set({ status: 'cancelled' })
      .where(eq(copilotAsyncToolCalls.toolCallId, claimed.toolCallId))

    await expect(entry(claimed, 'file', '', 'late')).rejects.toMatchObject({ code: 'not_found' })
  })

  it("refuses another user's import, even with its device id and token", async () => {
    const claimed = await claimedImport()
    const other = await claimedImport()

    await expect(
      importDesktopEntry.execute({
        principal: other.principal,
        input: {
          deviceId: claimed.deviceId,
          toolCallId: claimed.toolCallId,
          executionToken: claimed.executionToken,
          kind: 'file',
          sourceName: 'Reports',
          relativePath: '',
          content: Buffer.from('x'),
        },
      })
    ).rejects.toBeInstanceOf(DesktopDeviceUnrecognizedError)
  })
})
