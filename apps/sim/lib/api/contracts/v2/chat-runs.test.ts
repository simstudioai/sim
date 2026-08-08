import { describe, expect, it } from 'vitest'
import {
  v2ChatRunDetailSchema,
  v2ChatRunParamsSchema,
  v2GetChatRunQuerySchema,
  v2ListChatRunsQuerySchema,
} from '@/lib/api/contracts/v2/chat-runs'

describe('v2ListChatRunsQuerySchema', () => {
  it('defaults and clamps its bounded page size', () => {
    expect(v2ListChatRunsQuerySchema.parse({ workspaceId: 'workspace-1' }).limit).toBe(30)
    expect(v2ListChatRunsQuerySchema.parse({ workspaceId: 'workspace-1', limit: '0' }).limit).toBe(
      1
    )
    expect(
      v2ListChatRunsQuerySchema.parse({ workspaceId: 'workspace-1', limit: '999' }).limit
    ).toBe(100)
  })

  it('accepts only durable run statuses and a non-empty cursor', () => {
    expect(
      v2ListChatRunsQuerySchema.parse({ workspaceId: 'workspace-1', status: 'resuming' }).status
    ).toBe('resuming')
    expect(
      v2ListChatRunsQuerySchema.safeParse({ workspaceId: 'workspace-1', status: 'running' }).success
    ).toBe(false)
    expect(
      v2ListChatRunsQuerySchema.safeParse({ workspaceId: 'workspace-1', cursor: '' }).success
    ).toBe(false)
  })
})

describe('v2GetChatRunQuerySchema', () => {
  it('rejects unknown query fields', () => {
    expect(
      v2GetChatRunQuerySchema.safeParse({ workspaceId: 'workspace-1', continuationToken: 'secret' })
        .success
    ).toBe(false)
  })

  it('rejects a malformed run UUID before it reaches Postgres', () => {
    expect(v2ChatRunParamsSchema.safeParse({ runId: 'not-a-uuid' }).success).toBe(false)
  })
})

describe('v2ChatRunDetailSchema', () => {
  it('strips private replay fields from the public projection', () => {
    const parsed = v2ChatRunDetailSchema.parse({
      runId: '4bfa6f89-b746-43be-8246-bf1c69b58593',
      chatId: '80a47295-040e-46f9-9ea8-ad78eff3bcab',
      chatTitle: 'Release plan',
      status: 'complete',
      startedAt: '2026-08-08T12:00:00.000Z',
      completedAt: '2026-08-08T12:01:00.000Z',
      response: 'Done',
      activities: [
        {
          kind: 'tool',
          id: 'tool-1',
          label: 'Read file',
          state: 'complete',
          arguments: { secret: 'private' },
          result: 'private',
        },
      ],
      continuationToken: 'private',
      error: 'private',
    })

    expect(parsed).toEqual({
      runId: '4bfa6f89-b746-43be-8246-bf1c69b58593',
      chatId: '80a47295-040e-46f9-9ea8-ad78eff3bcab',
      chatTitle: 'Release plan',
      status: 'complete',
      startedAt: '2026-08-08T12:00:00.000Z',
      completedAt: '2026-08-08T12:01:00.000Z',
      response: 'Done',
      activities: [{ kind: 'tool', id: 'tool-1', label: 'Read file', state: 'complete' }],
    })
  })
})
