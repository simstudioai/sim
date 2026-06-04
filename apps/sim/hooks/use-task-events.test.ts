/**
 * @vitest-environment node
 */

import type { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { taskKeys } from '@/hooks/queries/tasks'
import { handleTaskStatusEvent } from '@/hooks/use-task-events'

describe('handleTaskStatusEvent', () => {
  const queryClient = {
    getQueryData: vi.fn(),
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
    removeQueries: vi.fn(),
  } satisfies Pick<QueryClient, 'getQueryData' | 'invalidateQueries' | 'removeQueries'>

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient.getQueryData.mockReturnValue(undefined)
  })

  it('invalidates the task list and detail for completed task events', () => {
    handleTaskStatusEvent(
      queryClient,
      'ws-1',
      JSON.stringify({
        chatId: 'chat-1',
        type: 'completed',
        timestamp: Date.now(),
      })
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.list('ws-1'),
    })
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.detail('chat-1'),
    })
    expect(queryClient.removeQueries).not.toHaveBeenCalled()
  })

  it('keeps completed task detail when an unkeyed completion races an active stream', () => {
    queryClient.getQueryData.mockReturnValue({
      id: 'chat-1',
      title: null,
      messages: [{ id: 'new-stream' }, { id: 'live-assistant:new-stream' }],
      activeStreamId: 'new-stream',
      resources: [],
    })

    handleTaskStatusEvent(
      queryClient,
      'ws-1',
      JSON.stringify({
        chatId: 'chat-1',
        type: 'completed',
        timestamp: Date.now(),
      })
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.list('ws-1'),
    })
    expect(queryClient.removeQueries).not.toHaveBeenCalled()
  })

  it('keeps completed task detail when a newer optimistic stream is active', () => {
    queryClient.getQueryData.mockReturnValue({
      id: 'chat-1',
      title: null,
      messages: [{ id: 'old-stream' }, { id: 'new-stream' }],
      activeStreamId: 'new-stream',
      resources: [],
    })

    handleTaskStatusEvent(
      queryClient,
      'ws-1',
      JSON.stringify({
        chatId: 'chat-1',
        type: 'completed',
        streamId: 'old-stream',
        timestamp: Date.now(),
      })
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.list('ws-1'),
    })
    expect(queryClient.removeQueries).not.toHaveBeenCalled()
  })

  it('keeps completed task detail when only a newer optimistic stream is cached', () => {
    queryClient.getQueryData.mockReturnValue({
      id: 'chat-1',
      title: null,
      messages: [{ id: 'new-stream' }, { id: 'live-assistant:new-stream' }],
      activeStreamId: 'new-stream',
      resources: [],
    })

    handleTaskStatusEvent(
      queryClient,
      'ws-1',
      JSON.stringify({
        chatId: 'chat-1',
        type: 'completed',
        streamId: 'old-stream',
        timestamp: Date.now(),
      })
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.list('ws-1'),
    })
    expect(queryClient.removeQueries).not.toHaveBeenCalled()
  })

  it('invalidates completed task detail when the active stream disagreement is only stale cache', () => {
    queryClient.getQueryData.mockReturnValue({
      id: 'chat-1',
      title: null,
      messages: [{ id: 'new-stream' }, { id: 'old-stream' }],
      activeStreamId: 'new-stream',
      resources: [],
    })

    handleTaskStatusEvent(
      queryClient,
      'ws-1',
      JSON.stringify({
        chatId: 'chat-1',
        type: 'completed',
        streamId: 'old-stream',
        timestamp: Date.now(),
      })
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.list('ws-1'),
    })
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.detail('chat-1'),
    })
    expect(queryClient.removeQueries).not.toHaveBeenCalled()
  })

  it('invalidates completed task detail when a missing stream may be newer server state', () => {
    queryClient.getQueryData.mockReturnValue({
      id: 'chat-1',
      title: null,
      messages: [{ id: 'old-stream' }],
      activeStreamId: 'old-stream',
      resources: [],
    })

    handleTaskStatusEvent(
      queryClient,
      'ws-1',
      JSON.stringify({
        chatId: 'chat-1',
        type: 'completed',
        streamId: 'new-stream',
        timestamp: Date.now(),
      })
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.list('ws-1'),
    })
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.detail('chat-1'),
    })
    expect(queryClient.removeQueries).not.toHaveBeenCalled()
  })

  it('invalidates completed task detail when the completed stream is active', () => {
    queryClient.getQueryData.mockReturnValue({
      id: 'chat-1',
      title: null,
      messages: [],
      activeStreamId: 'stream-1',
      resources: [],
    })

    handleTaskStatusEvent(
      queryClient,
      'ws-1',
      JSON.stringify({
        chatId: 'chat-1',
        type: 'completed',
        streamId: 'stream-1',
        timestamp: Date.now(),
      })
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.list('ws-1'),
    })
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.detail('chat-1'),
    })
    expect(queryClient.removeQueries).not.toHaveBeenCalled()
  })

  it('invalidates the task list and detail for metadata-changing task events', () => {
    handleTaskStatusEvent(
      queryClient,
      'ws-1',
      JSON.stringify({
        chatId: 'chat-1',
        type: 'renamed',
        timestamp: Date.now(),
      })
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.list('ws-1'),
    })
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.detail('chat-1'),
    })
    expect(queryClient.removeQueries).not.toHaveBeenCalled()
  })

  it('invalidates the task list and removes detail cache for deleted task events', () => {
    handleTaskStatusEvent(
      queryClient,
      'ws-1',
      JSON.stringify({
        chatId: 'chat-1',
        type: 'deleted',
        timestamp: Date.now(),
      })
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.list('ws-1'),
    })
    expect(queryClient.removeQueries).toHaveBeenCalledTimes(1)
    expect(queryClient.removeQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.detail('chat-1'),
    })
  })

  it('invalidates the task list and detail for started task events', () => {
    handleTaskStatusEvent(
      queryClient,
      'ws-1',
      JSON.stringify({
        chatId: 'chat-1',
        type: 'started',
        timestamp: Date.now(),
      })
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.list('ws-1'),
    })
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.detail('chat-1'),
    })
    expect(queryClient.removeQueries).not.toHaveBeenCalled()
  })

  it('keeps started task detail when an unkeyed started event races an active stream', () => {
    queryClient.getQueryData.mockReturnValue({
      id: 'chat-1',
      title: null,
      messages: [{ id: 'new-stream' }, { id: 'live-assistant:new-stream' }],
      activeStreamId: 'new-stream',
      resources: [],
    })

    handleTaskStatusEvent(
      queryClient,
      'ws-1',
      JSON.stringify({
        chatId: 'chat-1',
        type: 'started',
        timestamp: Date.now(),
      })
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.list('ws-1'),
    })
    expect(queryClient.removeQueries).not.toHaveBeenCalled()
  })

  it('keeps started task detail when the started stream is already active', () => {
    queryClient.getQueryData.mockReturnValue({
      id: 'chat-1',
      title: null,
      messages: [{ id: 'stream-1' }],
      activeStreamId: 'stream-1',
      resources: [],
    })

    handleTaskStatusEvent(
      queryClient,
      'ws-1',
      JSON.stringify({
        chatId: 'chat-1',
        type: 'started',
        streamId: 'stream-1',
        timestamp: Date.now(),
      })
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.list('ws-1'),
    })
    expect(queryClient.removeQueries).not.toHaveBeenCalled()
  })

  it('keeps started task detail when a stale started stream is older than the active stream', () => {
    queryClient.getQueryData.mockReturnValue({
      id: 'chat-1',
      title: null,
      messages: [{ id: 'old-stream' }, { id: 'new-stream' }],
      activeStreamId: 'new-stream',
      resources: [],
    })

    handleTaskStatusEvent(
      queryClient,
      'ws-1',
      JSON.stringify({
        chatId: 'chat-1',
        type: 'started',
        streamId: 'old-stream',
        timestamp: Date.now(),
      })
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.list('ws-1'),
    })
    expect(queryClient.removeQueries).not.toHaveBeenCalled()
  })

  it('invalidates started task detail when a missing stream may be newer server state', () => {
    queryClient.getQueryData.mockReturnValue({
      id: 'chat-1',
      title: null,
      messages: [{ id: 'old-stream' }],
      activeStreamId: 'old-stream',
      resources: [],
    })

    handleTaskStatusEvent(
      queryClient,
      'ws-1',
      JSON.stringify({
        chatId: 'chat-1',
        type: 'started',
        streamId: 'new-stream',
        timestamp: Date.now(),
      })
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.list('ws-1'),
    })
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.detail('chat-1'),
    })
    expect(queryClient.removeQueries).not.toHaveBeenCalled()
  })

  it('keeps list invalidation only for unknown task event types', () => {
    handleTaskStatusEvent(
      queryClient,
      'ws-1',
      JSON.stringify({
        chatId: 'chat-1',
        type: 'archived',
        timestamp: Date.now(),
      })
    )

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(1)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: taskKeys.list('ws-1'),
    })
    expect(queryClient.removeQueries).not.toHaveBeenCalled()
  })

  it('does not invalidate when task event payload is invalid', () => {
    handleTaskStatusEvent(queryClient, 'ws-1', '{')

    expect(queryClient.invalidateQueries).not.toHaveBeenCalled()
    expect(queryClient.removeQueries).not.toHaveBeenCalled()
  })
})
