/**
 * The gate a turn passes when its message id is a steering id: against real
 * PostgreSQL transcripts and a worker stubbed at HTTP. Failure modes: a message a
 * run already applied runs again as a turn; one still queued in a live run goes
 * out beside it; a stale steering record keeps its place before the turn it failed
 * to steer, so the new turn's message sorts above that turn's answer; the
 * disposition read sends input other than what the worker holds (which it
 * refuses); an ordinary message id costs a worker call.
 */
import { db } from '@sim/db'
import { copilotChats, copilotMessages, copilotRuns, user } from '@sim/db/schema'
import {
  mothershipAgentUrlMock,
  mothershipAgentUrlMockFns,
} from '@sim/testing/mocks/mothership-agent-url.mock'
import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mothership/server/agent-url', () => mothershipAgentUrlMock)

import { resolveSteeringFallback } from '@/lib/mothership/chat/application/steering-fallback'
import { buildOnComplete } from '@/lib/mothership/chat/completion'
import { appendCopilotChatMessages } from '@/lib/mothership/chat/messages-store'
import {
  buildPersistedUserMessage,
  type PersistedMessage,
} from '@/lib/mothership/chat/persisted-message'

const WORKER = 'http://worker.integration.test'
const RECORDED_INPUT = {
  context: [{ type: 'workflow', tag: '@Invoices', content: '{"blocks":{}}' }],
}

const worker: { answers: Response[]; bodies: unknown[] } = { answers: [], bodies: [] }

describe('steering fallback gate in PostgreSQL', () => {
  const userId = generateId()

  async function chatWithSteeredTurn(): Promise<{
    chatId: string
    turnId: string
    steeringId: string
  }> {
    const [chat] = await db
      .insert(copilotChats)
      .values({ userId, type: 'mothership' })
      .returning({ id: copilotChats.id })
    const turnId = generateId()
    const steeringId = generateId()
    await appendCopilotChatMessages(chat.id, [
      buildPersistedUserMessage({ id: turnId, content: 'Count to fifty' }),
    ])
    await appendCopilotChatMessages(
      chat.id,
      [
        {
          ...buildPersistedUserMessage({ id: steeringId, content: 'Then summarize' }),
          steering: { streamId: turnId, input: RECORDED_INPUT },
        },
      ],
      { streamId: turnId }
    )
    const answer: PersistedMessage = {
      id: generateId(),
      role: 'assistant',
      content: '1 2 3',
      timestamp: new Date().toISOString(),
    }
    await appendCopilotChatMessages(chat.id, [answer], { streamId: turnId })
    return { chatId: chat.id, turnId, steeringId }
  }

  async function transcriptIds(chatId: string): Promise<string[]> {
    const rows = await db
      .select({ messageId: copilotMessages.messageId })
      .from(copilotMessages)
      .where(eq(copilotMessages.chatId, chatId))
      .orderBy(asc(copilotMessages.seq))
    return rows.map((row) => row.messageId)
  }

  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Steering fallback fixture',
      email: `${userId}@fixture.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
  })

  beforeEach(() => {
    worker.answers = []
    worker.bodies = []
    mothershipAgentUrlMockFns.mockGetMothershipBaseURL.mockResolvedValue(WORKER)
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== `${WORKER}/api/streams/steer/v2`) {
        throw new Error(`Unexpected request ${String(input)}`)
      }
      worker.bodies.push(JSON.parse(String(init?.body)))
      const answer = worker.answers.shift()
      if (!answer) throw new Error('No scripted worker answer')
      return answer
    })
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    await db.delete(copilotChats).where(eq(copilotChats.userId, userId))
    await db.delete(user).where(eq(user.id, userId))
    await db.$client.end()
  })

  it('refuses a turn for a message a run already applied, keeping it where it was applied', async () => {
    const { chatId, turnId, steeringId } = await chatWithSteeredTurn()
    worker.answers.push(
      Response.json({ steeringId, status: 'applied', eventSeq: 3, textOffset: 2 })
    )

    const fallback = await resolveSteeringFallback({ chatId, messageId: steeringId, userId })

    expect(fallback).toEqual({ kind: 'applied' })
    expect(worker.bodies).toEqual([
      { messageId: turnId, steeringId, content: 'Then summarize', ...RECORDED_INPUT },
    ])
    expect(await transcriptIds(chatId)).toContain(steeringId)
  })

  it('answers busy for a message a run Sim still runs holds', async () => {
    const { chatId, turnId, steeringId } = await chatWithSteeredTurn()
    await db
      .insert(copilotRuns)
      .values({ executionId: generateId(), chatId, userId, streamId: turnId, status: 'active' })
    worker.answers.push(Response.json({ steeringId, status: 'queued' }))

    const fallback = await resolveSteeringFallback({ chatId, messageId: steeringId, userId })

    expect(fallback).toEqual({ kind: 'busy', streamId: turnId })
    expect(await transcriptIds(chatId)).toContain(steeringId)
  })

  it('sends a message a run Sim recorded as ended still lists as queued', async () => {
    const { chatId, turnId, steeringId } = await chatWithSteeredTurn()
    await db
      .insert(copilotRuns)
      .values({ executionId: generateId(), chatId, userId, streamId: turnId, status: 'error' })
    worker.answers.push(Response.json({ steeringId, status: 'queued' }))

    const fallback = await resolveSteeringFallback({ chatId, messageId: steeringId, userId })

    expect(fallback).toEqual({ kind: 'send' })
    expect(await transcriptIds(chatId)).not.toContain(steeringId)
  })

  it('clears the record of a message no run applied, so the turn stores it after the turn it missed', async () => {
    const { chatId, turnId, steeringId } = await chatWithSteeredTurn()
    worker.answers.push(Response.json({ steeringId, status: 'not_applied' }))

    const fallback = await resolveSteeringFallback({ chatId, messageId: steeringId, userId })
    await appendCopilotChatMessages(
      chatId,
      [buildPersistedUserMessage({ id: steeringId, content: 'Then summarize' })],
      { streamId: steeringId }
    )

    expect(fallback).toEqual({ kind: 'send' })
    const ids = await transcriptIds(chatId)
    expect(ids).toHaveLength(3)
    expect(ids[0]).toBe(turnId)
    expect(ids[2]).toBe(steeringId)
  })

  it('lets an ordinary message id through without asking the worker', async () => {
    const { chatId, turnId } = await chatWithSteeredTurn()

    const forTurn = await resolveSteeringFallback({ chatId, messageId: turnId, userId })
    const forNew = await resolveSteeringFallback({ chatId, messageId: generateId(), userId })

    expect(forTurn).toEqual({ kind: 'send' })
    expect(forNew).toEqual({ kind: 'send' })
    expect(worker.bodies).toHaveLength(0)
  })

  it('stores no duplicate turn when the worker refuses one for a message a run already applied', async () => {
    const { chatId, turnId, steeringId } = await chatWithSteeredTurn()
    await db
      .update(copilotChats)
      .set({ conversationId: steeringId })
      .where(eq(copilotChats.id, chatId))
    await appendCopilotChatMessages(
      chatId,
      [buildPersistedUserMessage({ id: steeringId, content: 'Then summarize' })],
      { streamId: steeringId }
    )

    await buildOnComplete({ chatId, userMessageId: steeringId, requestId: 'request-1', userId })({
      success: false,
      inputApplied: true,
      content: '',
      contentBlocks: [],
      toolCalls: [],
      error: 'This message was already included in the response it steered.',
    })

    const rows = await db
      .select({
        id: copilotMessages.messageId,
        role: copilotMessages.role,
        content: copilotMessages.content,
      })
      .from(copilotMessages)
      .where(eq(copilotMessages.chatId, chatId))
      .orderBy(asc(copilotMessages.seq))
    expect(rows.map((row) => row.role)).toEqual(['user', 'user', 'assistant'])
    expect(rows[0].id).toBe(turnId)
    expect(toRecord(rows[1].content).steering).toMatchObject({ streamId: steeringId })
    const [chat] = await db
      .select({ conversationId: copilotChats.conversationId })
      .from(copilotChats)
      .where(eq(copilotChats.id, chatId))
    expect(chat.conversationId).toBeNull()
  })
})
