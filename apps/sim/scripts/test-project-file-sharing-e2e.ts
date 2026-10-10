import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { db } from '@sim/db'
import {
  member,
  organization,
  permissionGroup,
  permissionGroupWorkspace,
  permissions,
  project,
  subscription,
  user,
} from '@sim/db/schema'
import { insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { toArray, toRecord } from '@sim/utils/object'
import { and, eq, inArray } from 'drizzle-orm'

/** Actual internal sharing policy and public token proof using disposable local fixture owners. */
function required(value: unknown): string {
  assert.ok(typeof value === 'string' && value, 'Required fixture or environment value missing')
  return value
}
const base = new URL(required(process.env.PROJECT_FILE_SHARING_BASE_URL))
const database = new URL(required(process.env.DATABASE_URL))
for (const url of [base, database])
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Local runtime required')
assert.match(database.pathname, /test/i, 'Disposable database required')
const reportPath = required(process.env.PROJECT_FILE_SHARING_REPORT_PATH)
const fixtureDir = required(process.env.PROJECT_FILE_SHARING_FIXTURE_DIR)
const account = toRecord(JSON.parse(await readFile(join(fixtureDir, 'owner-account.json'), 'utf8')))
const cookie = toArray(account.cookies)
  .map((value) => required(value).split(';')[0])
  .join('; ')
const parent = toRecord(
  JSON.parse(await readFile(join(fixtureDir, 'http-project-fixture.json'), 'utf8'))
)
const [actor] = await db
  .select({ id: project.ownerId })
  .from(project)
  .where(eq(project.id, required(toRecord(parent.project).id)))
assert.ok(actor)
const [existingMembership] = await db
  .select({ organizationId: member.organizationId, name: organization.name })
  .from(member)
  .innerJoin(organization, eq(organization.id, member.organizationId))
  .where(eq(member.userId, actor.id))
if (existingMembership)
  assert.equal(
    existingMembership.name,
    'Sharing policy proof',
    'Use an unassociated disposable account'
  )
const [existingOwner] = existingMembership
  ? await db
      .select({ id: member.userId })
      .from(member)
      .where(
        and(eq(member.organizationId, existingMembership.organizationId), eq(member.role, 'owner'))
      )
  : []
const ownerId = existingOwner?.id ?? generateId()
const organizationId = existingMembership?.organizationId ?? generateId()
const workspaceId = generateId()
const otherWorkspaceId = generateId()
const groupId = generateId()
if (!existingMembership) {
  await db.insert(user).values({
    id: ownerId,
    name: 'Sharing proof owner',
    email: `${ownerId}@sharing.invalid`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  await db.insert(organization).values({
    id: organizationId,
    name: 'Sharing policy proof',
    slug: organizationId,
    createdAt: new Date(),
  })
  await db.insert(member).values(
    [ownerId, actor.id].map((userId) => ({
      id: generateId(),
      organizationId,
      userId,
      role: userId === ownerId ? 'owner' : 'member',
      createdAt: new Date(),
    }))
  )
}
await insertWorkspaceFixture(db, {
  id: workspaceId,
  name: 'Share policy environment',
  ownerId,
  organizationId,
  billedAccountUserId: ownerId,
  workspaceMode: 'organization',
})
await insertWorkspaceFixture(db, {
  id: otherWorkspaceId,
  name: 'Restricted sharing environment',
  ownerId,
  organizationId,
  billedAccountUserId: ownerId,
  workspaceMode: 'organization',
  forkedFromWorkspaceId: workspaceId,
})
const [binding] = await db.select().from(workspace).where(eq(workspace.id, workspaceId))
assert.ok(binding)
const projectId = binding.projectId
await db.insert(permissions).values(
  [workspaceId, otherWorkspaceId].map((entityId) => ({
    id: generateId(),
    userId: actor.id,
    entityType: 'workspace',
    entityId,
    permissionType: 'admin' as const,
  }))
)
await db.insert(subscription).values({
  id: generateId(),
  plan: 'enterprise',
  referenceId: organizationId,
  status: 'active',
  metadata: {},
})
await db.insert(permissionGroup).values({
  id: groupId,
  organizationId,
  createdBy: ownerId,
  name: `Sharing policy proof ${groupId}`,
  membershipMode: 'inherit',
  config: {},
})
await db.insert(permissionGroupWorkspace).values({
  id: generateId(),
  permissionGroupId: groupId,
  workspaceId: otherWorkspaceId,
  organizationId,
})
const checks: { name: string; passed: boolean; durationMs: number; error?: string }[] = []
async function request(path: string, method = 'GET', body?: object, authenticated = true) {
  // boundary-raw-fetch: E2E exercises the running app's internal JSON and anonymous binary surfaces.
  const response = await fetch(new URL(path, base), {
    method,
    headers: {
      Origin: base.origin,
      'Content-Type': 'application/json',
      ...(authenticated ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90_000),
    redirect: 'manual',
  })
  return { status: response.status, text: await response.text() }
}
function json(response: Awaited<ReturnType<typeof request>>, status = 200) {
  assert.equal(response.status, status)
  return toRecord(JSON.parse(response.text))
}
async function check(name: string, run: () => Promise<void>) {
  const started = performance.now()
  try {
    await run()
    checks.push({ name, passed: true, durationMs: performance.now() - started })
  } catch (error) {
    checks.push({
      name,
      passed: false,
      durationMs: performance.now() - started,
      error: getErrorMessage(error),
    })
  }
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(
    reportPath,
    JSON.stringify(
      { checks, fixture: { projectId, workspaceId, otherWorkspaceId, organizationId } },
      null,
      2
    )
  )
}
const content = 'Shared Project architecture fixture'
const projectFile = toRecord(
  json(
    await request(`/api/projects/${projectId}/files`, 'POST', {
      name: 'sharing-project.txt',
      content,
      contentType: 'text/plain',
      encoding: 'utf-8',
    }),
    201
  ).file
)
const workspaceFile = toRecord(
  json(
    await request(`/api/workspaces/${workspaceId}/files`, 'POST', {
      name: 'sharing-environment.txt',
      content: 'Environment only fixture',
      contentType: 'text/plain',
      encoding: 'utf-8',
    }),
    201
  ).file
)
const fileId = required(projectFile.id)
const workspaceFileId = required(workspaceFile.id)
const path = `/api/projects/${projectId}/files/${fileId}/share`
let token = ''
await check('Project sharing read projects current effective policy', async () => {
  const result = json(await request(path))
  assert.equal(result.share, null)
  assert.deepEqual(result.policy, {
    canPublish: true,
    allowedAuthTypes: ['public', 'password', 'email', 'sso'],
  })
  assert.deepEqual(result.capabilities, { canRead: true, canWrite: true })
})
await check('Read-only Project access cannot publish or revoke', async () => {
  const ownPermissions = and(
    eq(permissions.userId, actor.id),
    inArray(permissions.entityId, [workspaceId, otherWorkspaceId])
  )
  await db.update(permissions).set({ permissionType: 'read' }).where(ownPermissions)
  try {
    assert.equal(toRecord(json(await request(path)).capabilities).canWrite, false)
    assert.equal((await request(path, 'PUT', { isActive: true })).status, 403)
    assert.equal((await request(path, 'PUT', { isActive: false })).status, 403)
  } finally {
    await db.update(permissions).set({ permissionType: 'admin' }).where(ownPermissions)
  }
})
await check('Wrong file owner is concealed and unauthenticated calls are refused', async () => {
  assert.equal(
    (await request(`/api/projects/${projectId}/files/${workspaceFileId}/share`)).status,
    404
  )
  assert.equal((await request(path, 'GET', undefined, false)).status, 401)
})
await check('Project publication serves actual bytes with stable token', async () => {
  const share = toRecord(
    json(await request(path, 'PUT', { isActive: true, authType: 'public' })).share
  )
  token = required(share.token)
  assert.equal(share.resourceId, fileId)
  assert.equal(
    (await request(`/api/files/public/${token}/content`, 'GET', undefined, false)).text,
    content
  )
  assert.equal(toRecord(json(await request(path)).share).token, token)
})
await check(
  'Another environment policy controls offered modes and actual publication',
  async () => {
    await db
      .update(permissionGroup)
      .set({ config: { allowedFileShareAuthTypes: ['password'] } })
      .where(eq(permissionGroup.id, groupId))
    assert.deepEqual(json(await request(path)).policy, {
      canPublish: true,
      allowedAuthTypes: ['password'],
    })
    assert.equal((await request(path, 'PUT', { isActive: true, authType: 'public' })).status, 403)
    const share = toRecord(
      json(
        await request(path, 'PUT', {
          isActive: true,
          authType: 'password',
          password: 'Local-sharing-proof-password',
        })
      ).share
    )
    assert.equal(share.authType, 'password')
    assert.equal(share.token, token)
    assert.equal(
      (await request(`/api/files/public/${token}/content`, 'GET', undefined, false)).status,
      401
    )
  }
)
await check('Disabled publication preserves the right to revoke current sharing', async () => {
  await db
    .update(permissionGroup)
    .set({ config: { disablePublicFileSharing: true, allowedFileShareAuthTypes: ['password'] } })
    .where(eq(permissionGroup.id, groupId))
  assert.deepEqual(json(await request(path)).policy, {
    canPublish: false,
    allowedAuthTypes: ['password'],
  })
  assert.equal((await request(path, 'PUT', { isActive: true, authType: 'password' })).status, 403)
  const share = toRecord(json(await request(path, 'PUT', { isActive: false })).share)
  assert.equal(share.isActive, false)
  assert.equal(share.token, token)
  assert.equal(
    (await request(`/api/files/public/${token}/content`, 'GET', undefined, false)).status,
    404
  )
})
await check('Environment sharing keeps its separate legacy policy and identity', async () => {
  const workspacePath = `/api/workspaces/${workspaceId}/files/${workspaceFileId}/share`
  const shared = json(await request(workspacePath, 'PUT', { isActive: true, authType: 'public' }))
  assert.deepEqual(Object.keys(shared), ['share'])
  const share = toRecord(shared.share)
  assert.equal(share.resourceId, workspaceFileId)
  assert.notEqual(share.token, token)
  assert.equal(toRecord(json(await request(path)).share).isActive, false)
  assert.equal(
    (await request(`/api/files/public/${required(share.token)}/content`, 'GET', undefined, false))
      .text,
    'Environment only fixture'
  )
  json(await request(workspacePath, 'PUT', { isActive: false }))
})
await request(`/api/workspaces/${workspaceId}/files/${workspaceFileId}/share`, 'PUT', {
  isActive: false,
})
await request(path, 'PUT', { isActive: false })
await writeFile(
  join(fixtureDir, 'sharing-browser-fixtures.json'),
  JSON.stringify(
    {
      projectId,
      workspaceId,
      otherWorkspaceId,
      organizationId,
      groupId,
      actorId: actor.id,
      fileId,
      workspaceFileId,
      token,
    },
    null,
    2
  ),
  { mode: 0o600 }
)
process.stdout.write(
  `${JSON.stringify({
    reportPath,
    passed: checks.filter((c) => c.passed).length,
    failed: checks.filter((c) => !c.passed).length,
  })}\n`
)
process.exit(checks.every((c) => c.passed) ? 0 : 1)
