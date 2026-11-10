/**
 * The batched shell resolver the Integrations page reads against real PostgreSQL: it must place
 * every workspace exactly where `resolveWorkspaceShellOrganizationId` places it one at a time.
 * Failure modes: a workspace of the viewer's own organization sent to their landing organization;
 * another team's or an organization-less workspace kept outside the viewer's landing organization;
 * and a viewer in no organization given one.
 */
import { db } from '@sim/db'
import { member, organization, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import {
  readWorkspaceShellResolver,
  resolveWorkspaceShellOrganizationId,
} from '@/lib/workspaces/application/workspace-shell'

const ids = {
  own: `shell-resolver-own-${generateId()}`,
  other: `shell-resolver-other-${generateId()}`,
  viewer: `shell-resolver-viewer-${generateId()}`,
  outsider: `shell-resolver-outsider-${generateId()}`,
  otherOwner: `shell-resolver-other-owner-${generateId()}`,
}
const users = [ids.viewer, ids.outsider, ids.otherOwner]
const organizations = [ids.own, ids.other]

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values(
    users.map((id) => ({
      id,
      name: 'Shell resolver fixture',
      email: `${id}@shell-resolver.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db
    .insert(organization)
    .values(organizations.map((id) => ({ id, name: id, slug: id, createdAt: now })))
  await db.insert(member).values([
    { id: generateId(), organizationId: ids.own, userId: ids.viewer, role: 'member' },
    { id: generateId(), organizationId: ids.other, userId: ids.otherOwner, role: 'owner' },
  ])
})

afterAll(async () => {
  await db.delete(member).where(inArray(member.userId, users))
  await db.delete(organization).where(inArray(organization.id, organizations))
  await db.delete(user).where(inArray(user.id, users))
})

it('places each workspace where the one-at-a-time rule places it', async () => {
  for (const userId of [ids.viewer, ids.outsider]) {
    const shellOf = await readWorkspaceShellResolver(userId)
    for (const workspaceOrganizationId of [ids.own, ids.other, null]) {
      expect(shellOf(workspaceOrganizationId)).toBe(
        await resolveWorkspaceShellOrganizationId(workspaceOrganizationId, userId)
      )
    }
  }
  const viewerShell = await readWorkspaceShellResolver(ids.viewer)
  expect([viewerShell(ids.own), viewerShell(ids.other), viewerShell(null)]).toEqual([
    ids.own,
    ids.own,
    ids.own,
  ])
  expect((await readWorkspaceShellResolver(ids.outsider))(ids.own)).toBeNull()
})
