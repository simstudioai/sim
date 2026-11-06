/**
 * The gate a turn passes when its message id is a steering id: against real
 * PostgreSQL transcripts and a worker stubbed at HTTP. Failure modes: a message a
 * run already applied runs again as a turn; one still queued in a live run goes
 * out beside it; a stale steering record keeps its place before the turn it failed
 * to steer, so the new turn's message sorts above that turn's answer; the
 * disposition read sends input other than what the worker holds (which it
 * refuses); an ordinary message id costs a worker call; a steer under a turn's
 * own id rewrites or deletes that turn's row; a final disposition leaves the input
 * (rendered mentions, base64 images) in the row, or a reader outside the steering
 * path sees it.
 */
import { db } from '@sim/db'
import {
  copilotChats,
  copilotMessages,
  copilotRuns,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  mothershipAgentUrlMock,
  mothershipAgentUrlMockFns,
} from '@sim/testing/mocks/mothership-agent-url.mock'
import { generateId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mothership/server/agent-url', () => mothershipAgentUrlMock)
/** The worker conversation copy is a separate service; Sim persistence stays real. */
const workerCopy = vi.hoisted(() => vi.fn(async (_request: { upToMessageId: string }) => {}))
vi.mock('@/lib/mothership/chat/fork-worker', () => ({
  copyWorkerConversation: workerCopy,
  discardWorkerConversation: vi.fn(async () => {}),
}))

import { forkChat } from '@/lib/mothership/chat/application/fork'
import {
  dismissSteeringMessage,
  resolveSteeringFallback,
} from '@/lib/mothership/chat/application/steering-fallback'
import { buildOnComplete } from '@/lib/mothership/chat/completion'
import { loadCopilotChatMessages } from '@/lib/mothership/chat/lifecycle'
import {
  appendCopilotChatMessages,
  appendSteeringMessageIfAbsent,
} from '@/lib/mothership/chat/messages-store'
import {
  buildPersistedUserMessage,
  type PersistedMessage,
} from '@/lib/mothership/chat/persisted-message'
import { steerRun } from '@/lib/mothership/request/application/steer-run'

const WORKER = 'http://worker.integration.test'
const RECORDED_INPUT = {
  context: [{ type: 'workflow', tag: '@Invoices', content: '{"blocks":{}}' }],
}

const worker: { answers: Response[]; bodies: unknown[] } = { answers: [], bodies: [] }

describe('steering fallback gate in PostgreSQL', () => {
  const userId = generateId()
  const strangerId = generateId()
  const workspaceId = generateId()
  const owner = createSessionPrincipal({ userId, sessionId: generateId() })
  const stranger = createSessionPrincipal({ userId: strangerId, sessionId: generateId() })

  async function chatWithSteeredTurn(): Promise<{
    chatId: string
    turnId: string
    steeringId: string
  }> {
    const [chat] = await db
      .insert(copilotChats)
      .values({ userId, workspaceId, type: 'mothership' })
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

  /** The run Sim holds for a chat's turn, which is what steering it authorizes against. */
  async function runFor(chatId: string, streamId: string, status: 'active' | 'complete') {
    await db
      .insert(copilotRuns)
      .values({ executionId: generateId(), chatId, userId, workspaceId, streamId, status })
  }

  /** The stored steering marker of a message, as no reader outside the steering path sees it. */
  async function storedSteering(chatId: string, messageId: string) {
    const [row] = await db
      .select({ content: copilotMessages.content })
      .from(copilotMessages)
      .where(and(eq(copilotMessages.chatId, chatId), eq(copilotMessages.messageId, messageId)))
    return toRecord(toRecord(row?.content).steering)
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
    await db.insert(user).values(
      [userId, strangerId].map((id) => ({
        id,
        name: 'Steering fallback fixture',
        email: `${id}@fixture.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Steering fallback fixture',
      ownerId: userId,
      billedAccountUserId: userId,
    })
    await db.insert(permissions).values(
      [userId, strangerId].map((id) => ({
        id: generateId(),
        userId: id,
        entityType: 'workspace' as const,
        entityId: workspaceId,
        permissionType: 'admin' as const,
      }))
    )
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
    await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
    await db.delete(user).where(inArray(user.id, [userId, strangerId]))
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

  describe("a steering id that names a turn's own message", () => {
    it('keeps the row of a turn a steer under its id arrives for', async () => {
      const { chatId, turnId } = await chatWithSteeredTurn()

      const stored = await appendSteeringMessageIfAbsent(
        chatId,
        {
          ...buildPersistedUserMessage({ id: turnId, content: 'Rewritten' }),
          steering: { streamId: generateId(), input: RECORDED_INPUT },
        },
        { streamId: generateId() }
      )

      expect(stored).toBe(false)
      const [message] = (await loadCopilotChatMessages(chatId)).filter((row) => row.id === turnId)
      expect(message.content).toBe('Count to fifty')
      expect(message.steering).toBeUndefined()
    })

    it('refuses a stale tab steering it into a later turn, and leaves the row to survive', async () => {
      const { chatId, turnId } = await chatWithSteeredTurn()
      const laterTurn = generateId()
      await runFor(chatId, laterTurn, 'active')

      await expect(
        steerRun.execute({
          principal: owner,
          input: { streamId: laterTurn, chatId, steeringId: turnId, content: 'Count to fifty' },
        })
      ).rejects.toMatchObject({ code: 'conflict' })
      await resolveSteeringFallback({ chatId, messageId: turnId, userId })

      expect(worker.bodies).toEqual([])
      expect(await transcriptIds(chatId)).toContain(turnId)
      expect(await storedSteering(chatId, turnId)).toEqual({})
    })

    it('never deletes a row re-marked as the turn its id went out as', async () => {
      const { chatId, steeringId } = await chatWithSteeredTurn()
      await db.delete(copilotMessages).where(eq(copilotMessages.messageId, steeringId))
      await appendCopilotChatMessages(
        chatId,
        [
          {
            ...buildPersistedUserMessage({ id: steeringId, content: 'Then summarize' }),
            steering: { streamId: steeringId },
          },
        ],
        { streamId: steeringId }
      )

      expect(await resolveSteeringFallback({ chatId, messageId: steeringId, userId })).toEqual({
        kind: 'send',
      })

      expect(worker.bodies).toEqual([])
      expect(await transcriptIds(chatId)).toContain(steeringId)
    })
  })

  describe('a final disposition', () => {
    it('drops the input once a message is applied, and answers later reads from the record', async () => {
      const steeringId = generateId()
      const { chatId, turnId } = await chatWithSteeredTurn()
      await runFor(chatId, turnId, 'active')
      const input = { streamId: turnId, chatId, steeringId, content: 'Focus on the tests' }
      worker.answers.push(
        Response.json({ steeringId, status: 'applied', eventSeq: 4, textOffset: 2 })
      )

      await steerRun.execute({ principal: owner, input })
      const reread = await steerRun.execute({ principal: owner, input })

      expect(reread).toEqual({ steeringId, status: 'applied', eventSeq: 4, textOffset: 2 })
      expect(worker.bodies).toHaveLength(1)
      const stored = await storedSteering(chatId, steeringId)
      expect(stored).not.toHaveProperty('input')
      expect(stored.disposition).toEqual({ status: 'applied', eventSeq: 4, textOffset: 2 })
      expect(await resolveSteeringFallback({ chatId, messageId: steeringId, userId })).toEqual({
        kind: 'applied',
      })
      expect(worker.bodies).toHaveLength(1)
    })

    it('keeps the input while the message is only queued', async () => {
      const steeringId = generateId()
      const { chatId, turnId } = await chatWithSteeredTurn()
      await runFor(chatId, turnId, 'active')
      worker.answers.push(Response.json({ steeringId, status: 'queued' }))

      await steerRun.execute({
        principal: owner,
        input: { streamId: turnId, chatId, steeringId, content: 'Focus on the tests' },
      })

      expect(await storedSteering(chatId, steeringId)).toHaveProperty('input')
    })

    it('settles a message a queued answer can no longer apply, since Sim says the run is over', async () => {
      const { chatId, turnId } = await chatWithSteeredTurn()
      await runFor(chatId, turnId, 'complete')
      const steeringId = generateId()
      worker.answers.push(Response.json({ steeringId, status: 'queued' }))

      const answer = await steerRun.execute({
        principal: owner,
        input: { streamId: turnId, chatId, steeringId, content: 'Focus on the tests' },
      })

      expect(answer).toEqual({ steeringId, status: 'not_applied' })
      const stored = await storedSteering(chatId, steeringId)
      expect(stored).not.toHaveProperty('input')
      expect(await resolveSteeringFallback({ chatId, messageId: steeringId, userId })).toEqual({
        kind: 'send',
      })
      expect(await transcriptIds(chatId)).not.toContain(steeringId)
    })

    it('drops the input when the gate learns the message was applied', async () => {
      const { chatId, steeringId } = await chatWithSteeredTurn()
      worker.answers.push(
        Response.json({ steeringId, status: 'applied', eventSeq: 2, textOffset: 1 })
      )

      await resolveSteeringFallback({ chatId, messageId: steeringId, userId })

      const stored = await storedSteering(chatId, steeringId)
      expect(stored).not.toHaveProperty('input')
      expect(stored.disposition).toMatchObject({ status: 'applied', textOffset: 1 })
    })

    it("drops the input when a turn's own transcript shows it applied the message", async () => {
      const { chatId, turnId, steeringId } = await chatWithSteeredTurn()
      await db
        .update(copilotChats)
        .set({ conversationId: turnId })
        .where(eq(copilotChats.id, chatId))
      await db
        .delete(copilotMessages)
        .where(and(eq(copilotMessages.chatId, chatId), eq(copilotMessages.role, 'assistant')))

      await buildOnComplete({ chatId, userMessageId: turnId, requestId: 'request-2', userId })({
        success: true,
        content: 'Done',
        contentBlocks: [
          { type: 'steering', steering: { steeringId }, timestamp: Date.now() },
          { type: 'text', content: 'Done', timestamp: Date.now() },
        ],
        toolCalls: [],
      })

      const stored = await storedSteering(chatId, steeringId)
      expect(stored).not.toHaveProperty('input')
      expect(stored.disposition).toEqual({ status: 'applied' })
    })

    it('never shows the input to a reader of the whole transcript (fork, import)', async () => {
      const { chatId, turnId, steeringId } = await chatWithSteeredTurn()

      const messages = await loadCopilotChatMessages(chatId)

      expect(messages.find((row) => row.id === steeringId)?.steering).toEqual({ streamId: turnId })
    })
  })

  describe('dismissing a message', () => {
    it('removes a record no run holds', async () => {
      const { chatId, steeringId } = await chatWithSteeredTurn()
      worker.answers.push(Response.json({ steeringId, status: 'not_applied' }))

      const answer = await dismissSteeringMessage.execute({
        principal: owner,
        input: { chatId, messageId: steeringId },
      })

      expect(answer).toEqual({ status: 'dismissed' })
      expect(await transcriptIds(chatId)).not.toContain(steeringId)
    })

    it('keeps one a run applied', async () => {
      const { chatId, steeringId } = await chatWithSteeredTurn()
      worker.answers.push(
        Response.json({ steeringId, status: 'applied', eventSeq: 2, textOffset: 1 })
      )

      const answer = await dismissSteeringMessage.execute({
        principal: owner,
        input: { chatId, messageId: steeringId },
      })

      expect(answer).toEqual({ status: 'applied' })
      expect(await transcriptIds(chatId)).toContain(steeringId)
    })

    it('keeps one a running turn still holds, naming that turn', async () => {
      const { chatId, turnId, steeringId } = await chatWithSteeredTurn()
      await runFor(chatId, turnId, 'active')
      worker.answers.push(Response.json({ steeringId, status: 'queued' }))

      const answer = await dismissSteeringMessage.execute({
        principal: owner,
        input: { chatId, messageId: steeringId },
      })

      expect(answer).toEqual({ status: 'busy', streamId: turnId })
      expect(await transcriptIds(chatId)).toContain(steeringId)
    })

    it("leaves a turn's own row alone", async () => {
      const { chatId, turnId } = await chatWithSteeredTurn()

      const answer = await dismissSteeringMessage.execute({
        principal: owner,
        input: { chatId, messageId: turnId },
      })

      expect(answer).toEqual({ status: 'dismissed' })
      expect(await transcriptIds(chatId)).toContain(turnId)
    })

    it('removes a record whose bytes the worker no longer recognizes', async () => {
      const { chatId, steeringId } = await chatWithSteeredTurn()
      worker.answers.push(new Response(null, { status: 409 }))

      const answer = await dismissSteeringMessage.execute({
        principal: owner,
        input: { chatId, messageId: steeringId },
      })

      expect(answer).toEqual({ status: 'dismissed' })
      expect(await transcriptIds(chatId)).not.toContain(steeringId)
    })

    it("refuses someone else's chat, leaving the record", async () => {
      const { chatId, steeringId } = await chatWithSteeredTurn()

      await expect(
        dismissSteeringMessage.execute({
          principal: stranger,
          input: { chatId, messageId: steeringId },
        })
      ).rejects.toMatchObject({ code: 'not_found' })

      expect(worker.bodies).toEqual([])
      expect(await transcriptIds(chatId)).toContain(steeringId)
    })
  })

  describe('forking a chat', () => {
    it('neither cuts at nor copies a steering message no turn applied', async () => {
      workerCopy.mockClear()
      const { chatId, turnId, steeringId } = await chatWithSteeredTurn()
      const [{ messageId: answerId }] = await db
        .select({ messageId: copilotMessages.messageId })
        .from(copilotMessages)
        .where(and(eq(copilotMessages.chatId, chatId), eq(copilotMessages.role, 'assistant')))

      const fromAnswer = await forkChat.execute({
        principal: owner,
        input: { chatId, upToMessageId: answerId },
      })
      const fromRecord = await forkChat.execute({
        principal: owner,
        input: { chatId, upToMessageId: steeringId },
      })

      expect(workerCopy.mock.calls.map(([request]) => request.upToMessageId)).toEqual([
        turnId,
        turnId,
      ])
      expect(await transcriptIds(fromAnswer.id)).toEqual([turnId, answerId])
      expect(await transcriptIds(fromRecord.id)).toEqual([turnId])
    })

    it('keeps a steering message a turn applied, and may cut at it', async () => {
      workerCopy.mockClear()
      const { chatId, steeringId } = await chatWithSteeredTurn()
      const answerId = generateId()
      await appendCopilotChatMessages(chatId, [
        {
          id: answerId,
          role: 'assistant',
          content: 'Done',
          timestamp: new Date().toISOString(),
          contentBlocks: [{ type: 'steering', steering: { steeringId }, timestamp: Date.now() }],
        },
      ])
      const fork = await forkChat.execute({
        principal: owner,
        input: { chatId, upToMessageId: answerId },
      })

      expect(workerCopy.mock.calls[0][0].upToMessageId).toBe(steeringId)
      expect(await transcriptIds(fork.id)).toContain(steeringId)
    })
  })
})
