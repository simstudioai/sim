import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { db } from '@sim/db'
import {
  member,
  organization,
  permissionGroup,
  permissionGroupWorkspace,
  permissions,
  user,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { featureFlagsMock } from '@sim/testing/mocks/feature-flags.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { authorizeFileDocAccess } from '@/lib/collab-doc/access'
import { readWorkspaceFileMetadata } from '@/lib/workspace-files/application/read-workspace-file-metadata'
import { POST } from '@/app/api/internal/file-doc/access/route'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

const ownerId = generateId()
const memberId = generateId()
const outsiderId = generateId()
const organizationId = generateId()
const workspaceId = generateId()
const fileId = generateId()
const groupId = generateId()
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

async function setFilesWithheld(withheld: boolean) {
  await db
    .update(permissionGroup)
    .set({ config: withheld ? { hideFilesTab: true } : {} })
    .where(eq(permissionGroup.id, groupId))
}

beforeAll(async () => {
  await db.insert(user).values(
    [ownerId, memberId, outsiderId].map((id) => ({
      id,
      name: 'Document access fixture',
      email: `${id}@doc-access.invalid`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await db.insert(organization).values({
    id: organizationId,
    name: 'Document access',
    slug: organizationId,
    createdAt: new Date(),
  })
  await db.insert(member).values([
    { id: generateId(), organizationId, userId: ownerId, role: 'owner', createdAt: new Date() },
    { id: generateId(), organizationId, userId: memberId, role: 'member', createdAt: new Date() },
  ])
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    organizationId,
    ownerId,
    billedAccountUserId: ownerId,
    workspaceMode: 'organization',
    name: 'Document access',
  })
  await db.insert(permissions).values({
    id: generateId(),
    entityType: 'workspace',
    entityId: workspaceId,
    userId: memberId,
    permissionType: 'write',
  })
  await db.insert(workspaceFiles).values({
    id: fileId,
    key: `workspace/${workspaceId}/${fileId}-notes.md`,
    userId: ownerId,
    workspaceId,
    context: 'workspace',
    originalName: 'notes.md',
    contentType: 'text/markdown',
  })
  await db.insert(permissionGroup).values({
    id: groupId,
    organizationId,
    createdBy: ownerId,
    name: 'Files fixture',
    config: {},
    membershipMode: 'inherit',
  })
  await db.insert(permissionGroupWorkspace).values({
    id: generateId(),
    permissionGroupId: groupId,
    workspaceId,
    organizationId,
  })
})

afterAll(async () => {
  const reportPath =
    process.env.FILE_DOC_ACCESS_REPORT_PATH ?? resolve('test-results/file-doc-access.json')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks }, null, 2))
  await db.delete(workspaceFiles).where(eq(workspaceFiles.id, fileId))
  await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
  await db.delete(organization).where(eq(organization.id, organizationId))
  await db.delete(user).where(inArray(user.id, [ownerId, memberId, outsiderId]))
})

check(
  'withholding Files refuses the room exactly where the HTTP file operations refuse',
  async () => {
    await setFilesWithheld(true)
    await expect(
      readWorkspaceFileMetadata.execute({
        principal: createSessionPrincipal({ userId: memberId }),
        input: { fileId },
      })
    ).rejects.toMatchObject({ detailCode: 'PERMISSION_GROUP_CAPABILITY_BLOCKED' })
    expect(await authorizeFileDocAccess(memberId, fileId)).toMatchObject({
      allowed: false,
      status: 403,
      workspaceId,
      workspacePermission: null,
    })
  }
)

check('a non-member is refused and a missing file is not found', async () => {
  await setFilesWithheld(false)
  expect(await authorizeFileDocAccess(outsiderId, fileId)).toMatchObject({
    allowed: false,
    status: 403,
    workspacePermission: null,
  })
  expect(await authorizeFileDocAccess(memberId, generateId())).toMatchObject({
    allowed: false,
    status: 404,
  })
})

check(
  'the relay route refuses without the secret and returns the decision in its body',
  async () => {
    const request = (secret: string | undefined) =>
      POST(
        new NextRequest('http://localhost:3000/api/internal/file-doc/access', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(secret ? { 'x-api-key': secret } : {}),
          },
          body: JSON.stringify({ fileId, userId: memberId }),
        })
      )
    const secret = process.env.INTERNAL_API_SECRET
    expect((await request(undefined)).status).toBe(401)
    await setFilesWithheld(true)
    const refused = await request(secret)
    expect(refused.status).toBe(200)
    expect(await refused.json()).toEqual({ allowed: false, status: 403 })
    await setFilesWithheld(false)
    const allowed = await request(secret)
    expect(allowed.status).toBe(200)
    expect(await allowed.json()).toEqual({
      allowed: true,
      workspaceId,
      workspacePermission: 'write',
    })
  }
)
