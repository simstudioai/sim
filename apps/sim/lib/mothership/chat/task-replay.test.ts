/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { toDisplayMessage } from '@/lib/mothership/chat/display-message'
import { buildEffectiveChatTranscript } from '@/lib/mothership/chat/effective-transcript'
import {
  buildPersistedAssistantMessage,
  normalizeMessage,
} from '@/lib/mothership/chat/persisted-message'
import type {
  MothershipStreamV1TaskArmedPayload,
  MothershipStreamV1TaskDeliveredPayload,
} from '@/lib/mothership/generated/mothership-stream-v1'
import { createStreamingContext } from '@/lib/mothership/request/context/request-context'
import { handleRunEvent } from '@/lib/mothership/request/handlers/run'
import type { PersistedStreamEventEnvelope } from '@/lib/mothership/request/session/contract'
import { toStreamBatchEvent } from '@/lib/mothership/request/session/types'
import {
  createTurnModel,
  reduceEvent,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/turn-model'
import {
  contentBlocksToModel,
  modelToContentBlocks,
} from '@/app/workspace/[workspaceId]/home/hooks/stream/turn-model-serialize'

type TaskPayload = MothershipStreamV1TaskArmedPayload | MothershipStreamV1TaskDeliveredPayload

const armed: MothershipStreamV1TaskArmedPayload = {
  kind: 'task_armed',
  taskId: 'watch-1',
  taskKind: 'workflow_run',
  target: { workflowId: 'workflow-1', executionId: 'execution-1' },
  note: 'Check the completed report',
}

function event(payload: TaskPayload, seq: number): PersistedStreamEventEnvelope {
  const envelope = {
    v: 1,
    type: 'run',
    stream: { streamId: 'stream-1' },
    seq,
    ts: new Date(seq * 1000).toISOString(),
  } as const
  return payload.kind === 'task_armed' ? { ...envelope, payload } : { ...envelope, payload }
}

describe('task transcript recovery', () => {
  it.each(['completed', 'failed', 'expired', 'stopped'] as const)(
    'preserves a %s watch in the live handler, browser and terminal reconnect snapshot',
    async (status) => {
      const events = [
        event(armed, 1),
        event(
          { kind: 'task_delivered', taskId: armed.taskId, status, summary: 'Result details' },
          2
        ),
      ]
      const context = createStreamingContext()
      const browser = createTurnModel()
      for (const frame of events) {
        await handleRunEvent(
          frame,
          context,
          { userId: 'user-1', workflowId: '' },
          {
            interactive: false,
            timeout: 1000,
          }
        )
        reduceEvent(browser, frame)
      }
      const persisted = normalizeMessage({
        ...buildPersistedAssistantMessage({
          success: true,
          content: '',
          contentBlocks: context.contentBlocks,
          toolCalls: [],
        }),
      })
      const expected = {
        type: 'task',
        task: {
          taskId: armed.taskId,
          kind: armed.taskKind,
          target: armed.target,
          note: armed.note,
          status,
          summary: 'Result details',
        },
      }
      expect(persisted.contentBlocks).toEqual([expect.objectContaining(expected)])
      expect(modelToContentBlocks(browser)).toEqual([expect.objectContaining(expected)])

      const snapshot = buildEffectiveChatTranscript({
        messages: [normalizeMessage({ id: 'stream-1', role: 'user', content: 'Watch the report' })],
        activeStreamId: 'stream-1',
        streamSnapshot: {
          events: events.map(toStreamBatchEvent),
          previewSessions: [],
          status: 'complete',
        },
      })
      expect(snapshot).toHaveLength(2)
      expect(snapshot[1].contentBlocks).toEqual([expect.objectContaining(expected)])
      const reloaded = contentBlocksToModel(toDisplayMessage(snapshot[1]).contentBlocks ?? [])
      for (const frame of events) reduceEvent(reloaded, frame)
      expect(modelToContentBlocks(reloaded)).toEqual([expect.objectContaining(expected)])
    }
  )

  it('keeps a pending timer visible before a reconnect has replayed any text', () => {
    const timer = {
      ...armed,
      taskKind: 'timer',
      target: { firesAt: '2026-09-06T12:00:00Z' },
    } satisfies MothershipStreamV1TaskArmedPayload
    const snapshot = buildEffectiveChatTranscript({
      messages: [normalizeMessage({ id: 'stream-1', role: 'user', content: 'Remind me' })],
      activeStreamId: 'stream-1',
      streamSnapshot: {
        events: [toStreamBatchEvent(event(timer, 1))],
        previewSessions: [],
        status: 'active',
      },
    })
    expect(snapshot[1].contentBlocks).toEqual([
      expect.objectContaining({
        type: 'task',
        task: {
          taskId: timer.taskId,
          kind: 'timer',
          target: timer.target,
          note: timer.note,
          status: 'pending',
        },
      }),
    ])
  })

  it('does not duplicate or reopen a completed watch when registration is replayed', async () => {
    const context = createStreamingContext()
    const events = [
      event(armed, 1),
      event(armed, 2),
      event(
        {
          kind: 'task_delivered',
          taskId: armed.taskId,
          status: 'completed',
          summary: 'Done',
        },
        3
      ),
      event(armed, 4),
    ]
    for (const frame of events) {
      await handleRunEvent(
        frame,
        context,
        { userId: 'user-1', workflowId: '' },
        {
          interactive: false,
          timeout: 1000,
        }
      )
    }
    expect(context.contentBlocks).toHaveLength(1)
    expect(context.contentBlocks[0].task).toMatchObject({ status: 'completed', summary: 'Done' })
    const snapshot = buildEffectiveChatTranscript({
      messages: [normalizeMessage({ id: 'stream-1', role: 'user', content: 'Watch the report' })],
      activeStreamId: 'stream-1',
      streamSnapshot: {
        events: events.map(toStreamBatchEvent),
        previewSessions: [],
        status: 'active',
      },
    })
    expect(snapshot[1].contentBlocks).toHaveLength(1)
    expect(snapshot[1].contentBlocks?.[0].task).toMatchObject({
      status: 'completed',
      summary: 'Done',
    })
  })

  it('keeps concurrent watches separate and in their original position among text', () => {
    const other = { ...armed, taskId: 'watch-2', note: 'Another report' }
    const frames: PersistedStreamEventEnvelope[] = [
      event(armed, 1),
      {
        v: 1,
        type: 'text',
        seq: 2,
        ts: new Date(2000).toISOString(),
        stream: { streamId: 'stream-1' },
        payload: { channel: 'assistant', text: 'Both are being watched.' },
      },
      event(other, 3),
      event(
        {
          kind: 'task_delivered',
          taskId: other.taskId,
          status: 'failed',
          summary: 'Second run failed',
        },
        4
      ),
    ]
    const snapshot = buildEffectiveChatTranscript({
      messages: [normalizeMessage({ id: 'stream-1', role: 'user', content: 'Watch both reports' })],
      activeStreamId: 'stream-1',
      streamSnapshot: {
        events: frames.map(toStreamBatchEvent),
        previewSessions: [],
        status: 'active',
      },
    })
    expect(snapshot[1].contentBlocks).toEqual([
      expect.objectContaining({
        type: 'task',
        task: expect.objectContaining({ taskId: 'watch-1', status: 'pending' }),
      }),
      expect.objectContaining({ type: 'text', content: 'Both are being watched.' }),
      expect.objectContaining({
        type: 'task',
        task: expect.objectContaining({
          taskId: 'watch-2',
          status: 'failed',
          summary: 'Second run failed',
        }),
      }),
    ])
  })
})
