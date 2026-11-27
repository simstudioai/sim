/**
 * The organization Assistant's `search_people` against real Postgres: the copilot delegation the
 * People reads now admit, bound to the member's own private chat and their current membership.
 */
import { db } from '@sim/db'
import { copilotChats, member, memberProfile, organization, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { searchPeopleServerTool } from '@/lib/mothership/tools/server/knowledge/people'

vi.hoisted(() => vi.stubEnv('PEOPLE', 'true'))

const org = generateId()
const readerId = generateId()
const leadId = generateId()
const outsiderId = generateId()
const readerMember = generateId()
const leadMember = generateId()
const readerChat = generateId()
const leadChat = generateId()

function turn(userId: string, chatId: string) {
  return {
    userId,
    organizationId: org,
    chatId,
    toolCallId: generateId(),
    copilotToolExecution: true,
    requestMode: 'assistant',
  }
}

beforeAll(async () => {
  await db.insert(organization).values({
    id: org,
    slug: org,
    name: 'Assistant people fixture',
    createdAt: new Date(),
  })
  await db.insert(user).values(
    [
      [readerId, 'Reader Account'],
      [leadId, 'Grace Lead'],
      [outsiderId, 'Former Member'],
    ].map(([id, name]) => ({
      id,
      name,
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await db.insert(member).values([
    { id: readerMember, organizationId: org, userId: readerId, role: 'member' },
    { id: leadMember, organizationId: org, userId: leadId, role: 'member' },
  ])
  await db.insert(memberProfile).values([
    { memberId: leadMember, title: 'Director', department: 'Design' },
    { memberId: readerMember, title: 'Designer', managerMemberId: leadMember },
  ])
  await db.insert(copilotChats).values([
    { id: readerChat, userId: readerId, organizationId: org, type: 'mothership' },
    { id: leadChat, userId: leadId, organizationId: org, type: 'mothership' },
    { id: generateId(), userId: outsiderId, organizationId: org, type: 'mothership' },
  ])
})

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, org))
  await db.delete(user).where(inArray(user.id, [readerId, leadId, outsiderId]))
  vi.unstubAllEnvs()
})

it('answers a member in their own chat with the matching person and reporting line', async () => {
  const result = await searchPeopleServerTool.execute(
    { query: 'designer' },
    turn(readerId, readerChat)
  )
  expect(result).toMatchObject({
    success: true,
    data: {
      person: {
        personId: readerMember,
        name: 'Reader Account',
        title: 'Designer',
        managerChain: [{ personId: leadMember, name: 'Grace Lead', title: 'Director' }],
      },
    },
  })
  expect(
    await searchPeopleServerTool.execute({ personId: leadMember }, turn(readerId, readerChat))
  ).toMatchObject({
    success: true,
    data: { person: { personId: leadMember, directReports: [{ personId: readerMember }] } },
  })
})

it('refuses a delegation naming another member’s chat', async () => {
  const result = await searchPeopleServerTool.execute({ query: 'grace' }, turn(readerId, leadChat))
  expect(result).toEqual({ success: false, message: 'Conversation not found' })
})

it('refuses a chat owner who is no longer a member of the organization', async () => {
  const [chat] = await db
    .select({ id: copilotChats.id })
    .from(copilotChats)
    .where(eq(copilotChats.userId, outsiderId))
  const result = await searchPeopleServerTool.execute(
    { query: 'grace' },
    turn(outsiderId, chat?.id ?? '')
  )
  expect(result).toMatchObject({ success: false })
  expect(JSON.stringify(result)).not.toContain('Grace Lead')
})

it('offers the directory only in organization Assistant conversations', async () => {
  expect(
    await searchPeopleServerTool.execute(
      { query: 'grace' },
      { ...turn(readerId, readerChat), organizationId: undefined, workspaceId: generateId() }
    )
  ).toMatchObject({ success: false })
  expect(
    await searchPeopleServerTool.execute(
      { query: 'grace' },
      { ...turn(readerId, readerChat), requestMode: 'agent' }
    )
  ).toEqual({
    success: false,
    message: 'The People directory is available only in organization Assistant conversations',
  })
})
