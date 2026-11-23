import { db } from '@sim/db'
import { member, memberProfile, organization, user } from '@sim/db/schema'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { jsonResponse } from '@sim/testing/helpers/http'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getPerson, importPeople } from '@/lib/people/application/use-cases'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.hoisted(() => vi.stubEnv('PEOPLE', 'true'))

const organizationId = generateId()
const people = ['lead', 'report', 'third'].map((name) => ({
  name,
  userId: generateId(),
  memberId: generateId(),
  email: `${name}-${organizationId}@example.test`,
}))
const [lead, report, third] = people
const principal = createSessionPrincipal({ userId: lead.userId })

function queueDirectoryPages(source: 'okta' | 'entra', title: string, managerFirst = false) {
  const fetch = inputValidationMockFns.mockSecureFetchWithValidation
  if (source === 'okta') {
    const manager = { id: 'lead', status: 'ACTIVE', profile: { email: lead.email } }
    const worker = {
      id: 'report',
      status: 'ACTIVE',
      profile: { login: report.email, managerId: 'lead', title },
    }
    const [first, second] = managerFirst ? [manager, worker] : [worker, manager]
    fetch
      .mockResolvedValueOnce(
        jsonResponse([first], {
          headers: { Link: '<https://example.okta.com/api/v1/users?after=cursor>; rel="next"' },
        })
      )
      .mockResolvedValueOnce(jsonResponse([second]))
  } else {
    const manager = { id: 'lead', accountEnabled: true, userPrincipalName: lead.email }
    const worker = {
      id: 'report',
      accountEnabled: true,
      mail: report.email,
      manager: { id: 'lead' },
      jobTitle: title,
    }
    const [first, second] = managerFirst ? [manager, worker] : [worker, manager]
    fetch
      .mockResolvedValueOnce(
        jsonResponse({
          value: [first],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users?$skiptoken=cursor',
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          value: [
            second,
            { id: 'offboarded', mail: 'offboarded@example.test', accountEnabled: false },
          ],
        })
      )
  }
}

async function importEntraDirectory(
  users: { id: string; mail: string; jobTitle?: string; manager?: { id: string } }[]
) {
  const input = { source: 'entra' as const, organizationId, token: 'test-token', apply: false }
  const value = users.map((user) => ({ ...user, accountEnabled: true }))
  inputValidationMockFns.mockSecureFetchWithValidation.mockResolvedValueOnce(
    jsonResponse({ value })
  )
  const preview = await importPeople.execute({ principal, input })
  inputValidationMockFns.mockSecureFetchWithValidation.mockResolvedValueOnce(
    jsonResponse({ value })
  )
  await importPeople.execute({
    principal,
    input: { ...input, apply: true, previewDigest: preview.previewDigest },
  })
  return preview
}

function readPerson(memberId: string) {
  return getPerson.execute({ principal, input: { organizationId, memberId } })
}

describe('provider import into organization profiles', () => {
  beforeAll(async () => {
    await db.transaction(async (tx) => {
      await tx.insert(organization).values({
        id: organizationId,
        name: 'Provider import fixture',
        slug: organizationId,
        createdAt: new Date(),
      })
      await tx.insert(user).values(
        people.map((person) => ({
          id: person.userId,
          name: person.name,
          email: person.email,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }))
      )
      await tx.insert(member).values(
        people.map((person) => ({
          id: person.memberId,
          userId: person.userId,
          organizationId,
          role: person.userId === lead.userId ? 'owner' : 'member',
        }))
      )
      await tx
        .insert(memberProfile)
        .values({ memberId: report.memberId, location: 'Toronto', department: 'Platform' })
    })
  })
  afterAll(async () => {
    await db.delete(organization).where(eq(organization.id, organizationId))
    await db.delete(user).where(
      inArray(
        user.id,
        people.map((person) => person.userId)
      )
    )
    vi.unstubAllEnvs()
  })

  it.each(['okta', 'entra'] as const)(
    'only applies the %s directory that was previewed',
    async (source) => {
      const provider = source === 'okta' ? { source, domain: 'example.okta.com' } : { source }
      const input = { ...provider, organizationId, token: 'test-token', apply: false }
      const title = `${source} engineer`
      const read = async () =>
        (
          await getPerson.execute({
            principal,
            input: { organizationId, memberId: report.memberId },
          })
        ).person
      const before = await read()
      queueDirectoryPages(source, title)
      const preview = await importPeople.execute({ principal, input })
      expect(preview).toMatchObject({ applied: false, updated: 1, skipped: 0, warnings: 0 })
      expect(await read()).toEqual(before)

      const apply = { ...input, apply: true, previewDigest: preview.previewDigest }
      queueDirectoryPages(source, `Senior ${title}`)
      await expect(importPeople.execute({ principal, input: apply })).rejects.toMatchObject({
        code: 'conflict',
      })
      expect(await read()).toEqual(before)

      queueDirectoryPages(source, title, true)
      expect((await importPeople.execute({ principal, input: apply })).updated).toBe(1)
      expect(await read()).toMatchObject({
        title,
        managerMemberId: lead.memberId,
        department: 'Platform',
        location: 'Toronto',
      })
      queueDirectoryPages(source, title)
      expect((await importPeople.execute({ principal, input: apply })).updated).toBe(0)
    }
  )

  it('applies valid reporting line reversals in one import', async () => {
    await db
      .insert(memberProfile)
      .values({ memberId: report.memberId, managerMemberId: lead.memberId })
      .onConflictDoUpdate({
        target: memberProfile.memberId,
        set: { managerMemberId: lead.memberId },
      })
    const preview = await importEntraDirectory([
      { id: 'lead', mail: lead.email, manager: { id: 'report' } },
      { id: 'report', mail: report.email, manager: { id: 'third' } },
      { id: 'third', mail: third.email },
    ])
    expect(preview).toMatchObject({ updated: 2, warnings: 0 })
    const result = await readPerson(lead.memberId)
    expect(result.chain.map((person) => person.memberId)).toEqual([report.memberId, third.memberId])
  })

  it('skips ambiguous directory accounts and retains links when the manager email is shared', async () => {
    const before = await readPerson(lead.memberId)
    await db
      .insert(memberProfile)
      .values({ memberId: report.memberId, managerMemberId: third.memberId })
      .onConflictDoUpdate({
        target: memberProfile.memberId,
        set: { managerMemberId: third.memberId },
      })
    const preview = await importEntraDirectory([
      { id: 'guest', mail: lead.email.toUpperCase(), jobTitle: 'Contractor' },
      { id: 'staff', mail: lead.email, jobTitle: 'Director' },
      { id: 'third', mail: third.email },
      { id: 'report', mail: report.email, manager: { id: 'guest' }, jobTitle: 'New title' },
    ])
    expect(preview).toMatchObject({ updated: 1, skipped: 2, warnings: 1 })
    expect((await readPerson(lead.memberId)).person).toMatchObject({
      title: before.person.title,
      managerMemberId: before.person.managerMemberId,
    })
    expect((await readPerson(report.memberId)).person).toMatchObject({
      title: 'New title',
      managerMemberId: third.memberId,
    })
  })

  it('retains old links for a cyclic directory component while importing its usable fields', async () => {
    await db
      .insert(memberProfile)
      .values([
        { memberId: lead.memberId, managerMemberId: null },
        { memberId: third.memberId, managerMemberId: null },
      ])
      .onConflictDoUpdate({ target: memberProfile.memberId, set: { managerMemberId: null } })
    const preview = await importEntraDirectory([
      { id: 'lead', mail: lead.email, manager: { id: 'third' }, jobTitle: 'Staff' },
      { id: 'third', mail: third.email, manager: { id: 'lead' } },
    ])
    expect(preview).toMatchObject({ updated: 1, unchanged: 1, warnings: 2 })
    expect((await readPerson(lead.memberId)).person).toMatchObject({
      title: 'Staff',
      managerMemberId: null,
    })
    expect((await readPerson(third.memberId)).chain).toEqual([])
  })
})
