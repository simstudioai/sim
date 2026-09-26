/** Real PostgreSQL name allocation and name lookups for workspace files, plus the URL fetch path. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db, dbFor } from '@sim/db'
import { organization, user, workspace, workspaceFiles } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))

import { fileParseBodySchema } from '@/lib/api/contracts/storage-transfer'
import * as inputValidation from '@/lib/core/security/input-validation.server'
import { executeFileParserOperation } from '@/lib/internal/file/parser'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import {
  createWorkspaceFileFolder,
  fileNameExistsInWorkspaceFolder,
  workspaceFileNameFolderCondition,
} from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import {
  getWorkspaceFileByName,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { createWorkspaceFileDelegatedPrincipal } from '@/lib/workspace-files/application/delegated-principal'

describe('workspace file names in PostgreSQL', () => {
  const fixtures: ReturnType<typeof createKnowledgeAclFixtureIds>[] = []

  beforeAll(() => {
    fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-file-names-'))
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    for (const ids of fixtures) {
      await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
      await db.delete(organization).where(eq(organization.id, ids.organizationId))
      await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    }
    await rm(fixtureStorage.root, { recursive: true, force: true })
    await Promise.all([db.$client.end(), dbFor('cleanup').$client.end()])
  })

  async function seedWorkspace() {
    const ids = createKnowledgeAclFixtureIds()
    fixtures.push(ids)
    await seedKnowledgeAclFixture(ids)
    return ids
  }

  function upload(workspaceId: string, userId: string, name: string, folderId?: string | null) {
    return uploadWorkspaceFile(workspaceId, userId, Buffer.from(name), name, 'text/plain', {
      folderId,
      notifyWorkspaceChange: false,
    })
  }

  it('parses an external URL without saving a copy to workspace Files', async () => {
    const fixture = await seedWorkspace()
    const url = 'https://example.com/page.txt'
    vi.spyOn(inputValidation, 'validateUrlWithDNS').mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
      originalHostname: new URL(url).hostname,
    })
    vi.spyOn(inputValidation, 'secureFetchWithPinnedIP').mockImplementation(async () => {
      const response = new Response('fetched page body')
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: new inputValidation.SecureFetchHeaders({ 'content-type': 'text/plain' }),
        body: response.body,
        text: () => response.text(),
        json: () => response.json(),
        arrayBuffer: () => response.arrayBuffer(),
      }
    })

    const response = await executeFileParserOperation(
      fileParseBodySchema.parse({ filePath: url, workspaceId: fixture.workspaceId }),
      {
        principal: createWorkspaceFileDelegatedPrincipal({
          serviceId: 'executor',
          subjectUserId: fixture.aliceId,
          workspaceId: fixture.workspaceId,
          delegationId: generateId(),
        }),
        workspaceId: fixture.workspaceId,
        workflowId: generateId(),
        attributedUserId: fixture.aliceId,
        fileAccessUserId: fixture.aliceId,
      }
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.output.content).toContain('fetched page body')
    const rows = await db
      .select({ id: workspaceFiles.id })
      .from(workspaceFiles)
      .where(eq(workspaceFiles.workspaceId, fixture.workspaceId))
    expect(rows).toEqual([])
  })

  it('scopes name lookups to root or folder through the unique name index', async () => {
    const fixture = await seedWorkspace()
    const folder = await createWorkspaceFileFolder({
      workspaceId: fixture.workspaceId,
      userId: fixture.aliceId,
      name: 'Reports',
    })
    const rootFile = await upload(fixture.workspaceId, fixture.aliceId, 'root.txt')
    const folderFile = await upload(fixture.workspaceId, fixture.aliceId, 'nested.txt', folder.id)

    expect(await fileNameExistsInWorkspaceFolder(fixture.workspaceId, 'root.txt', null)).toBe(true)
    expect(await fileNameExistsInWorkspaceFolder(fixture.workspaceId, 'root.txt', folder.id)).toBe(
      false
    )
    expect(await fileNameExistsInWorkspaceFolder(fixture.workspaceId, 'nested.txt', null)).toBe(
      false
    )
    expect(
      await fileNameExistsInWorkspaceFolder(fixture.workspaceId, 'nested.txt', folder.id)
    ).toBe(true)
    expect((await getWorkspaceFileByName(fixture.workspaceId, 'root.txt'))?.id).toBe(rootFile.id)
    expect(
      await getWorkspaceFileByName(fixture.workspaceId, 'root.txt', { folderId: folder.id })
    ).toBeNull()
    expect(
      (await getWorkspaceFileByName(fixture.workspaceId, 'nested.txt', { folderId: folder.id }))?.id
    ).toBe(folderFile.id)
    expect(await getWorkspaceFileByName(fixture.workspaceId, 'nested.txt')).toBeNull()

    await db.execute(sql`
      INSERT INTO ${workspaceFiles} (id, key, user_id, workspace_id, folder_id, context, original_name, content_type)
      SELECT 'wf_pad_' || n || '_' || ${fixture.workspaceId}, 'pad/' || n || '/' || ${fixture.workspaceId},
        ${fixture.aliceId}, ${fixture.workspaceId}, CASE WHEN n % 2 = 0 THEN ${folder.id} END,
        'workspace', 'pad-' || n || '.txt', 'text/plain'
      FROM generate_series(1, 2000) AS n`)
    await db.execute(sql`ANALYZE ${workspaceFiles}`)

    for (const folderId of [null, folder.id]) {
      const plan = await db.execute(
        sql`EXPLAIN (FORMAT JSON) SELECT id FROM ${workspaceFiles} WHERE ${and(
          eq(workspaceFiles.workspaceId, fixture.workspaceId),
          eq(workspaceFiles.originalName, 'root.txt'),
          eq(workspaceFiles.context, 'workspace'),
          workspaceFileNameFolderCondition(folderId),
          isNull(workspaceFiles.deletedAt)
        )}`
      )
      const scan = JSON.stringify(plan[0]['QUERY PLAN'])
      expect(scan).toContain('workspace_files_workspace_folder_name_active_unique')
      expect(scan).toMatch(/"Index Cond":"[^"]*COALESCE\(folder_id/)
    }
  })

  it('falls back to a short-id suffix after 20 numbered copies, including under concurrency', async () => {
    const fixture = await seedWorkspace()
    await upload(fixture.workspaceId, fixture.aliceId, 'page.html')
    for (let n = 1; n <= 20; n++) {
      await upload(fixture.workspaceId, fixture.aliceId, `page (${n}).html`)
    }

    const next = await upload(fixture.workspaceId, fixture.aliceId, 'page.html')
    const concurrent = await Promise.all(
      Array.from({ length: 8 }, () => upload(fixture.workspaceId, fixture.aliceId, 'page.html'))
    )

    const shortIdSuffixed = /^page \([A-Za-z0-9_-]{8}\)\.html$/
    expect(next.name).toMatch(shortIdSuffixed)
    const names = concurrent.map((file) => file.name)
    for (const name of names) expect(name).toMatch(shortIdSuffixed)
    expect(new Set([next.name, ...names]).size).toBe(names.length + 1)
  })
})
