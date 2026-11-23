import { db } from '@sim/db'
import { member, memberProfile, organization, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { inArray } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { matchPeopleColumns, planPeopleImport } from '@/lib/people/import'
import { listMemberProfiles } from '@/lib/people/repository'

it('loads just the matched active profiles and the local manager chain through suspended members', async () => {
  const orgId = generateId()
  const otherOrgId = generateId()
  const people = ['report', 'manager', 'suspended', 'unrelated', 'foreign'].map((name) => ({
    name,
    memberId: generateId(),
    userId: generateId(),
    email: `${name}-${orgId}@example.test`,
  }))
  const [report, manager, suspended, unrelated, foreign] = people
  await db.transaction(async (tx) => {
    await tx
      .insert(organization)
      .values([orgId, otherOrgId].map((id) => ({ id, name: id, slug: id, createdAt: new Date() })))
    await tx.insert(user).values(
      people.map(({ name, userId, email }) => ({
        id: userId,
        emailVerified: true,
        name,
        email: name === 'report' ? email.toUpperCase() : email,
        createdAt: new Date(),
        updatedAt: new Date(),
        suspendedAt: name === 'suspended' ? new Date() : null,
      }))
    )
    await tx.insert(member).values(
      people.map(({ memberId, userId, name }) => ({
        id: memberId,
        userId,
        organizationId: name === 'foreign' ? otherOrgId : orgId,
        role: 'member',
      }))
    )
    await tx.insert(memberProfile).values([
      { memberId: report.memberId, location: 'Toronto', managerMemberId: foreign.memberId },
      { memberId: manager.memberId, managerMemberId: suspended.memberId },
      { memberId: suspended.memberId, managerMemberId: report.memberId },
      { memberId: foreign.memberId, managerMemberId: unrelated.memberId },
    ])
    const { members, managerLinks } = await listMemberProfiles(
      tx,
      orgId,
      [report.email, suspended.email, foreign.email],
      [manager.email]
    )
    expect(new Map(managerLinks.map((link) => [link.memberId, link.managerMemberId]))).toEqual(
      new Map([
        [suspended.memberId, report.memberId],
        [report.memberId, foreign.memberId],
      ])
    )
    const matched = matchPeopleColumns(['email', 'manager email'])
    if (!matched.ok) throw new Error(matched.message)
    const plan = planPeopleImport({
      columns: matched.columns,
      members,
      managerLinks,
      rows: [
        { email: report.email, 'manager email': manager.email },
        { email: suspended.email, 'manager email': '' },
      ],
    })
    expect(plan.changes).toEqual([])
    expect(plan.issues).toMatchObject([
      { severity: 'warning', message: expect.stringContaining('reporting loop') },
      { severity: 'skipped', email: suspended.email },
    ])
    const titles = await listMemberProfiles(tx, orgId, [report.email], [])
    expect(titles.managerLinks).toEqual([])
    expect(new Set(members.map((person) => person.memberId))).toEqual(
      new Set([report.memberId, manager.memberId])
    )
    expect(members.find((person) => person.memberId === report.memberId)?.profile?.location).toBe(
      'Toronto'
    )
    await tx.delete(organization).where(inArray(organization.id, [orgId, otherOrgId]))
    await tx.delete(user).where(
      inArray(
        user.id,
        people.map((person) => person.userId)
      )
    )
  })
})
