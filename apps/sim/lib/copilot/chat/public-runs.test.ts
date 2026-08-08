/**
 * @vitest-environment node
 */
import {
  dbChainMockFns,
  flattenMockConditions,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getPersistedPublicChatRunResponse,
  getPublicChatRun,
  listPublicChatRuns,
} from '@/lib/copilot/chat/public-runs'

function assertOwnedRootMothershipScope(where: unknown, extraRight?: string) {
  const conditions = flattenMockConditions(where)
  const equalities = conditions.filter((condition) => condition.type === 'eq')
  const nullChecks = conditions.filter((condition) => condition.type === 'isNull')

  // Both the run and joined chat are independently pinned to the caller.
  expect(equalities.filter((condition) => condition.right === 'user-1')).toHaveLength(2)
  expect(equalities.filter((condition) => condition.right === 'workspace-1')).toHaveLength(2)
  expect(equalities).toContainEqual(expect.objectContaining({ left: 'type', right: 'mothership' }))
  expect(nullChecks).toContainEqual(expect.objectContaining({ column: 'parentRunId' }))
  expect(nullChecks).toContainEqual(expect.objectContaining({ column: 'deletedAt' }))
  if (extraRight) {
    expect(equalities).toContainEqual(expect.objectContaining({ right: extraRight }))
  }

  expect(dbChainMockFns.innerJoin).toHaveBeenCalledWith(schemaMock.copilotChats, expect.anything())
}

describe('public chat run repository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('scopes list queries to owned root runs in live Mothership chats', async () => {
    queueTableRows(schemaMock.copilotRuns, [])

    await listPublicChatRuns({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      status: 'active',
      limit: 30,
    })

    assertOwnedRootMothershipScope(dbChainMockFns.where.mock.calls.at(-1)?.[0], 'active')
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(31)
  })

  it('uses the same masked scope for run detail lookups', async () => {
    queueTableRows(schemaMock.copilotRuns, [])

    expect(
      await getPublicChatRun({
        runId: 'run-private',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      })
    ).toBeNull()

    assertOwnedRootMothershipScope(dbChainMockFns.where.mock.calls.at(-1)?.[0], 'run-private')
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(1)
  })

  it('rejects a cursor with a malformed UUID before querying Postgres', async () => {
    await expect(
      listPublicChatRuns({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        limit: 30,
        cursorKeys: ['2026-08-08T12:00:00.000Z', 'not-a-uuid'],
      })
    ).resolves.toEqual({ status: 'invalid_cursor' })

    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('returns only assistant prose from persisted stream messages', async () => {
    queueTableRows(schemaMock.copilotMessages, [
      {
        content: {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Stored answer',
          timestamp: '2026-08-08T12:00:00.000Z',
          contentBlocks: [
            {
              type: 'tool',
              toolCall: { params: { secret: 'private' }, result: { output: 'private' } },
            },
          ],
        },
      },
    ])

    await expect(getPersistedPublicChatRunResponse('chat-1', 'stream-1')).resolves.toBe(
      'Stored answer'
    )
    const conditions = flattenMockConditions(dbChainMockFns.where.mock.calls.at(-1)?.[0])
    expect(conditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'eq', left: 'chatId', right: 'chat-1' }),
        expect.objectContaining({ type: 'eq', left: 'streamId', right: 'stream-1' }),
        expect.objectContaining({ type: 'eq', left: 'role', right: 'assistant' }),
        expect.objectContaining({ type: 'isNull', column: 'deletedAt' }),
      ])
    )
  })

  it('refuses a malformed persisted content value instead of forwarding it', async () => {
    queueTableRows(schemaMock.copilotMessages, [
      { content: { content: { secret: 'private' }, toolResult: 'private' } },
    ])

    await expect(getPersistedPublicChatRunResponse('chat-1', 'stream-1')).resolves.toBeNull()
  })
})
