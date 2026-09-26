/** `.dashboard` is an ingestion signal: real uploads store an extensionless name and a sticky type. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db, dbFor } from '@sim/db'
import { organization, user, workspace } from '@sim/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))

import { DASHBOARD_CONTENT_TYPE } from '@/lib/dashboards/file'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import {
  getWorkspaceFile,
  updateWorkspaceFileContent,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'

describe('dashboard files in PostgreSQL', () => {
  const ids = createKnowledgeAclFixtureIds()

  beforeAll(async () => {
    fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-dashboard-files-'))
    await seedKnowledgeAclFixture(ids)
  })

  afterAll(async () => {
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    await rm(fixtureStorage.root, { recursive: true, force: true })
    await Promise.all([db.$client.end(), dbFor('cleanup').$client.end()])
  })

  it('drops the suffix into the type and keeps that type across name-inferred writes', async () => {
    const uploaded = await uploadWorkspaceFile(
      ids.workspaceId,
      ids.aliceId,
      Buffer.from('title: Support\nblocks: [{text: Hi}]\n'),
      'Support.Dashboard',
      'text/plain',
      { notifyWorkspaceChange: false }
    )
    expect(uploaded.name).toBe('Support')
    expect(uploaded.type).toBe(DASHBOARD_CONTENT_TYPE)

    await updateWorkspaceFileContent(
      ids.workspaceId,
      uploaded.id,
      ids.aliceId,
      Buffer.from('title: Support v2\nblocks: [{text: Hi}]\n'),
      'text/plain',
      { version: { source: 'api', authorUserId: ids.aliceId } }
    )
    const updated = await getWorkspaceFile(ids.workspaceId, uploaded.id)
    expect(updated?.name).toBe('Support')
    expect(updated?.type).toBe(DASHBOARD_CONTENT_TYPE)
  })

  it('leaves other files and a bare suffix alone', async () => {
    const bare = await uploadWorkspaceFile(
      ids.workspaceId,
      ids.aliceId,
      Buffer.from('x'),
      '.dashboard',
      'text/plain',
      { notifyWorkspaceChange: false }
    )
    expect(bare.name).toBe('.dashboard')
    expect(bare.type).toBe('text/plain')
  })
})
