import { db } from '@sim/db'
import {
  member,
  memberProfile,
  organization,
  peopleDirectoryEntry,
  peopleDirectorySync,
  scimConnection,
  scimUser,
  user,
} from '@sim/db/schema'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import {
  getPeopleChart,
  getPerson,
  importPeople,
  listDepartments,
  listPeople,
  updatePerson,
} from '@/lib/people/application/use-cases'

vi.hoisted(() => vi.stubEnv('PEOPLE', 'true'))

const org = generateId()
const foreignOrg = generateId()
const ownerId = generateId()
const ownerMember = generateId()
const bossId = generateId()
const bossMember = generateId()
const bossEntry = generateId()
const reportEntry = generateId()
const foreignEntry = generateId()
const bossEmail = `boss-${org}@example.test`
const reportAccount = generateId()
const directoryAccounts = [ownerId, bossId, reportAccount]
const reportEmail = `report-${org}@example.test`
const principal = createSessionPrincipal({ userId: ownerId })
const base = { organizationId: org }

beforeAll(async () => {
  await db.transaction(async (tx) => {
    await tx.insert(organization).values(
      [org, foreignOrg].map((id) => ({
        id,
        slug: id,
        name: 'Directory fixture',
        createdAt: new Date(),
      }))
    )
    await tx.insert(user).values([
      {
        id: ownerId,
        name: 'Administrator',
        email: `admin-${org}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: bossId,
        name: 'Account display name',
        email: bossEmail.toUpperCase(),
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])
    await tx.insert(user).values({
      id: reportAccount,
      name: 'External designer',
      email: reportEmail,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await tx
      .insert(scimConnection)
      .values([org, foreignOrg].map((id) => ({ id, organizationId: id })))
    await tx.insert(scimUser).values(
      [
        { id: bossEntry, connectionId: org, userId: bossId, email: bossEmail },
        { id: reportEntry, connectionId: org, userId: reportAccount, email: reportEmail },
        { id: foreignEntry, connectionId: foreignOrg, userId: bossId, email: bossEmail },
      ].map(({ email, ...row }) => ({
        ...row,
        userName: email,
        orderKey: row.id,
        attributes: {
          userName: email,
          active: true,
          name: { formatted: 'Directory fixture' },
          emails: [{ value: email, primary: true }],
        },
      }))
    )
    await tx
      .insert(member)
      .values({ id: ownerMember, organizationId: org, userId: ownerId, role: 'owner' })
    await tx.insert(peopleDirectorySync).values(
      [org, foreignOrg].map((organizationId) => ({
        organizationId,
        source: 'scim' as const,
        sourceTarget: organizationId,
      }))
    )
    await tx.insert(peopleDirectoryEntry).values([
      {
        id: bossEntry,
        organizationId: org,
        externalId: bossEntry,
        source: 'scim',
        name: 'Directory lead',
        email: bossEmail,
        title: 'Director',
        department: 'Design',
      },
      {
        id: reportEntry,
        organizationId: org,
        externalId: reportEntry,
        source: 'scim',
        name: 'External designer',
        email: reportEmail,
        title: 'Designer',
        department: 'Design',
        managerExternalId: bossEntry,
      },
      {
        id: foreignEntry,
        organizationId: foreignOrg,
        externalId: foreignEntry,
        source: 'scim',
        name: 'Foreign lead',
        email: bossEmail,
      },
    ])
  })
})

afterAll(async () => {
  await db.delete(organization).where(inArray(organization.id, [org, foreignOrg]))
  await db.delete(user).where(inArray(user.id, directoryAccounts))
  vi.unstubAllEnvs()
})

it('browses source identities before they have accounts and preserves profile links after a member joins', async () => {
  const branch = async (memberId: string) =>
    getPeopleChart.execute({ principal, input: { ...base, memberId, page: 1, size: 4 } })
  const profile = async (memberId: string) =>
    getPerson.execute({ principal, input: { ...base, memberId } })
  const directory = async (extra: { search?: string; scope?: 'roots'; department?: string } = {}) =>
    (await listPeople.execute({ principal, input: { ...base, ...extra } })).data
  expect((await directory({ search: 'designer' })).map((p) => p.memberId)).toEqual([reportEntry])
  expect((await directory({ scope: 'roots' })).map((p) => p.memberId)).toEqual([bossEntry])
  expect((await listDepartments.execute({ principal, input: base })).data).toContainEqual({
    name: 'Design',
    count: 2,
  })
  expect((await branch(bossEntry)).reports.map((p) => p.memberId)).toEqual([reportEntry])
  expect((await profile(reportEntry)).person).toMatchObject({
    userId: null,
    joinedAt: null,
    managerMemberId: bossEntry,
  })
  await expect(profile(foreignEntry)).rejects.toMatchObject({ code: 'not_found' })

  await db
    .insert(member)
    .values({ id: bossMember, userId: bossId, organizationId: org, role: 'member' })
  await db
    .insert(memberProfile)
    .values({ memberId: bossMember, location: 'Berlin', title: 'Manual title' })
  expect((await directory({ department: 'Design' })).map((p) => p.memberId)).toEqual([
    bossMember,
    reportEntry,
  ])
  expect((await branch(bossEntry)).person).toMatchObject({
    memberId: bossMember,
    userId: bossId,
    name: 'Directory lead',
    title: 'Director',
    location: 'Berlin',
  })
  expect((await profile(bossEntry)).reports.map((p) => p.memberId)).toEqual([reportEntry])
  expect((await profile(reportEntry)).chain.map((p) => p.memberId)).toEqual([bossMember])
  await expect(
    updatePerson.execute({
      principal,
      input: {
        ...base,
        memberId: bossMember,
        title: 'Overwrite',
        department: null,
        location: null,
        startDate: null,
        managerMemberId: null,
      },
    })
  ).rejects.toMatchObject({ code: 'conflict' })
  const preview = await importPeople.execute({
    principal,
    input: { ...base, headers: ['email', 'title'], rows: [[bossEmail, 'Overwrite']], apply: false },
  })
  expect(preview).toMatchObject({ updated: 0, skipped: 1 })

  await db
    .update(peopleDirectoryEntry)
    .set({ location: 'Paris', title: null })
    .where(eq(peopleDirectoryEntry.id, bossEntry))
  expect((await profile(bossEntry)).person).toMatchObject({ location: 'Paris', title: null })

  await db.update(user).set({ suspendedAt: new Date() }).where(eq(user.id, bossId))
  await expect(profile(bossEntry)).rejects.toMatchObject({ code: 'not_found' })
  await expect(profile(bossMember)).rejects.toMatchObject({ code: 'not_found' })
  expect((await profile(reportEntry)).chain).toEqual([])
  expect(await directory({ search: 'Directory lead' })).toEqual([])

  await db.update(scimUser).set({ active: false }).where(eq(scimUser.id, bossEntry))
  await db.update(user).set({ suspendedAt: null }).where(eq(user.id, bossId))
  await expect(profile(bossEntry)).rejects.toMatchObject({ code: 'not_found' })
  expect((await profile(bossMember)).person).toMatchObject({
    directorySource: null,
    title: 'Manual title',
  })
  expect((await profile(reportEntry)).chain).toEqual([])
  expect(
    await importPeople.execute({
      principal,
      input: {
        ...base,
        headers: ['email', 'title'],
        rows: [[bossEmail, 'New manual title']],
        apply: false,
      },
    })
  ).toMatchObject({ updated: 1, skipped: 0 })
})

it('pages an external team with duplicate names and bounds the full profile response', async () => {
  const reports = Array.from({ length: 55 }, () => generateId()).sort()
  directoryAccounts.push(...reports)
  await db.insert(user).values(
    reports.map((id) => ({
      id,
      name: 'Directory pagination fixture',
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await db.insert(scimUser).values(
    reports.map((id) => ({
      id,
      connectionId: org,
      userId: id,
      userName: `${id}@example.test`,
      orderKey: id,
      attributes: {
        userName: `${id}@example.test`,
        active: true,
        name: { formatted: 'Directory fixture' },
        emails: [{ value: `${id}@example.test`, primary: true }],
      },
    }))
  )
  await db.insert(peopleDirectoryEntry).values(
    reports.map((id) => ({
      id,
      externalId: id,
      organizationId: org,
      source: 'scim' as const,
      name: 'Directory pagination fixture',
      email: `${id}@example.test`,
      managerExternalId: reportEntry,
    }))
  )
  const filter = { organizationId: org, search: 'Directory pagination fixture' }
  const first = await listPeople.execute({ principal, input: filter })
  expect(first.data.map((p) => p.memberId)).toEqual(reports.slice(0, 50))
  expect(first.nextCursorKeys).not.toBeNull()
  const second = await listPeople.execute({
    principal,
    input: { ...filter, cursorKeys: first.nextCursorKeys ?? [] },
  })
  expect(second.data.map((p) => p.memberId)).toEqual(reports.slice(50))
  expect(second.nextCursorKeys).toBeNull()
  const profile = await getPerson.execute({
    principal,
    input: { organizationId: org, memberId: reportEntry },
  })
  expect(profile.totalReports).toBe(55)
  expect(profile.reports.map((p) => p.memberId)).toEqual(reports.slice(0, 50))
  const members = await listPeople.execute({ principal, input: { ...filter, scope: 'members' } })
  expect(members.data).toEqual([])
})
