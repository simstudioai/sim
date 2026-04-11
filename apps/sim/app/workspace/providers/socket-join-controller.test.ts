import { describe, expect, it } from 'vitest'
import {
  SOCKET_JOIN_RETRY_BASE_DELAY_MS,
  SOCKET_JOIN_RETRY_MAX_DELAY_MS,
  SocketJoinController,
} from '@/app/workspace/providers/socket-join-controller'

describe('SocketJoinController', () => {
  it('blocks rejoining a deleted workflow until the desired workflow changes', () => {
    const controller = new SocketJoinController()

    expect(controller.setConnected(true)).toEqual([])
    expect(controller.requestWorkflow('workflow-a')).toEqual([
      { type: 'join', workflowId: 'workflow-a' },
    ])
    expect(controller.handleJoinSuccess('workflow-a')).toMatchObject({
      apply: true,
      ignored: false,
      commands: [],
      workflowId: 'workflow-a',
    })

    expect(controller.handleWorkflowDeleted('workflow-a')).toEqual({
      shouldClearCurrent: true,
      commands: [],
    })
    expect(controller.requestWorkflow('workflow-a')).toEqual([])
    expect(controller.requestWorkflow('workflow-b')).toEqual([
      { type: 'join', workflowId: 'workflow-b' },
    ])
  })

  it('joins only the latest desired workflow after rapid A to B to C switching', () => {
    const controller = new SocketJoinController()

    controller.setConnected(true)
    controller.requestWorkflow('workflow-a')
    controller.handleJoinSuccess('workflow-a')

    expect(controller.requestWorkflow('workflow-b')).toEqual([
      { type: 'join', workflowId: 'workflow-b' },
    ])
    expect(controller.requestWorkflow('workflow-c')).toEqual([])

    expect(controller.handleJoinSuccess('workflow-b')).toMatchObject({
      apply: false,
      ignored: true,
      workflowId: 'workflow-b',
      commands: [{ type: 'join', workflowId: 'workflow-c' }],
    })
    expect(controller.handleJoinSuccess('workflow-c')).toMatchObject({
      apply: true,
      ignored: false,
      workflowId: 'workflow-c',
      commands: [],
    })
  })

  it('rejoins the original workflow when a stale success lands after switching back', () => {
    const controller = new SocketJoinController()

    controller.setConnected(true)
    controller.requestWorkflow('workflow-a')
    controller.handleJoinSuccess('workflow-a')

    expect(controller.requestWorkflow('workflow-b')).toEqual([
      { type: 'join', workflowId: 'workflow-b' },
    ])
    expect(controller.requestWorkflow('workflow-a')).toEqual([])

    expect(controller.handleJoinSuccess('workflow-b')).toMatchObject({
      apply: false,
      ignored: true,
      workflowId: 'workflow-b',
      commands: [{ type: 'join', workflowId: 'workflow-a' }],
    })
    expect(controller.handleJoinSuccess('workflow-a')).toMatchObject({
      apply: true,
      ignored: false,
      workflowId: 'workflow-a',
      commands: [],
    })
  })

  it('leaves the room when a late join succeeds after navigating away', () => {
    const controller = new SocketJoinController()

    controller.setConnected(true)
    controller.requestWorkflow('workflow-a')
    controller.handleJoinSuccess('workflow-a')

    expect(controller.requestWorkflow('workflow-b')).toEqual([
      { type: 'join', workflowId: 'workflow-b' },
    ])
    expect(controller.requestWorkflow(null)).toEqual([])

    expect(controller.handleJoinSuccess('workflow-b')).toMatchObject({
      apply: false,
      ignored: true,
      workflowId: 'workflow-b',
      commands: [{ type: 'leave' }],
    })
  })

  it('preserves the last joined workflow during retryable switch failures', () => {
    const controller = new SocketJoinController()

    controller.setConnected(true)
    expect(controller.requestWorkflow('workflow-a')).toEqual([
      { type: 'join', workflowId: 'workflow-a' },
    ])
    controller.handleJoinSuccess('workflow-a')

    expect(controller.requestWorkflow('workflow-b')).toEqual([
      { type: 'join', workflowId: 'workflow-b' },
    ])

    const errorResult = controller.handleJoinError({
      workflowId: 'workflow-b',
      retryable: true,
    })

    expect(errorResult.apply).toBe(false)
    expect(errorResult.retryScheduled).toBe(true)
    expect(errorResult.commands).toEqual([
      {
        type: 'schedule-retry',
        workflowId: 'workflow-b',
        attempt: 1,
        delayMs: SOCKET_JOIN_RETRY_BASE_DELAY_MS,
      },
    ])
    expect(controller.getJoinedWorkflowId()).toBe('workflow-a')
    expect(controller.retryJoin('workflow-b')).toEqual([{ type: 'join', workflowId: 'workflow-b' }])
  })

  it('uses capped exponential backoff for retryable join failures', () => {
    const controller = new SocketJoinController()

    controller.setConnected(true)
    controller.requestWorkflow('workflow-a')

    const first = controller.handleJoinError({ workflowId: 'workflow-a', retryable: true })
    expect(first.commands).toEqual([
      {
        type: 'schedule-retry',
        workflowId: 'workflow-a',
        attempt: 1,
        delayMs: SOCKET_JOIN_RETRY_BASE_DELAY_MS,
      },
    ])

    controller.retryJoin('workflow-a')
    const second = controller.handleJoinError({ workflowId: 'workflow-a', retryable: true })
    expect(second.commands).toEqual([
      {
        type: 'schedule-retry',
        workflowId: 'workflow-a',
        attempt: 2,
        delayMs: SOCKET_JOIN_RETRY_BASE_DELAY_MS * 2,
      },
    ])

    controller.retryJoin('workflow-a')
    controller.handleJoinError({ workflowId: 'workflow-a', retryable: true })
    controller.retryJoin('workflow-a')
    const fourth = controller.handleJoinError({ workflowId: 'workflow-a', retryable: true })
    expect(fourth.commands).toEqual([
      {
        type: 'schedule-retry',
        workflowId: 'workflow-a',
        attempt: 4,
        delayMs: SOCKET_JOIN_RETRY_BASE_DELAY_MS * 8,
      },
    ])

    controller.retryJoin('workflow-a')
    const fifth = controller.handleJoinError({ workflowId: 'workflow-a', retryable: true })
    expect(fifth.commands).toEqual([
      {
        type: 'schedule-retry',
        workflowId: 'workflow-a',
        attempt: 5,
        delayMs: SOCKET_JOIN_RETRY_MAX_DELAY_MS,
      },
    ])
  })

  it('blocks a permanently failed workflow and leaves the fallback room cleanly', () => {
    const controller = new SocketJoinController()

    controller.setConnected(true)
    controller.requestWorkflow('workflow-a')
    controller.handleJoinSuccess('workflow-a')

    expect(controller.requestWorkflow('workflow-b')).toEqual([
      { type: 'join', workflowId: 'workflow-b' },
    ])

    const errorResult = controller.handleJoinError({
      workflowId: 'workflow-b',
      retryable: false,
    })

    expect(errorResult.apply).toBe(true)
    expect(errorResult.commands).toEqual([{ type: 'leave' }])
    expect(controller.getJoinedWorkflowId()).toBeNull()
    expect(controller.requestWorkflow('workflow-b')).toEqual([])
    expect(controller.requestWorkflow('workflow-c')).toEqual([
      { type: 'join', workflowId: 'workflow-c' },
    ])
  })

  it('rejoins the desired workflow when the server session is lost', () => {
    const controller = new SocketJoinController()

    controller.setConnected(true)
    controller.requestWorkflow('workflow-a')
    controller.handleJoinSuccess('workflow-a')

    expect(controller.forceRejoinWorkflow('workflow-a')).toEqual([
      { type: 'join', workflowId: 'workflow-a' },
    ])
    expect(controller.getJoinedWorkflowId()).toBeNull()
  })

  it('resolves retryable errors without workflowId against the pending join', () => {
    const controller = new SocketJoinController()

    controller.setConnected(true)
    controller.requestWorkflow('workflow-a')

    const errorResult = controller.handleJoinError({ retryable: true })

    expect(errorResult.workflowId).toBe('workflow-a')
    expect(errorResult.retryScheduled).toBe(true)
    expect(errorResult.commands).toEqual([
      {
        type: 'schedule-retry',
        workflowId: 'workflow-a',
        attempt: 1,
        delayMs: SOCKET_JOIN_RETRY_BASE_DELAY_MS,
      },
    ])
  })
})
