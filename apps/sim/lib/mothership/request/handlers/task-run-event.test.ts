/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { MothershipStreamV1EventType } from '@/lib/mothership/generated/mothership-stream-v1'
import { handleRunEvent } from '@/lib/mothership/request/handlers/run'
import type { StreamEvent, StreamingContext } from '@/lib/mothership/request/types'

function context(): StreamingContext {
  // double-cast-allowed: only the fields the run handler reads for task blocks
  return { contentBlocks: [], toolCalls: new Map() } as unknown as StreamingContext
}

describe('background task run events', () => {
  it('records task_armed as a task block and resolves it on task_delivered', async () => {
    const ctx = context()
    await handleRunEvent(
      {
        type: MothershipStreamV1EventType.run,
        payload: {
          kind: 'task_armed',
          taskId: 't-1',
          taskKind: 'timer',
          target: { firesAt: '2026-09-04T00:00:00Z' },
          note: 'nudge me',
        },
      } as StreamEvent,
      ctx,
      // double-cast-allowed: the run handler ignores the execution context and options for task kinds
      {} as never,
      { interactive: false, timeout: 1000 }
    )
    expect(ctx.contentBlocks).toHaveLength(1)
    expect(ctx.contentBlocks[0]).toMatchObject({ type: 'task', task: { taskId: 't-1', status: 'pending' } })
    await handleRunEvent(
      {
        type: MothershipStreamV1EventType.run,
        payload: { kind: 'task_delivered', taskId: 't-1', status: 'completed', summary: 'Timer elapsed' },
      } as StreamEvent,
      ctx,
      {} as never,
      { interactive: false, timeout: 1000 }
    )
    expect(ctx.contentBlocks[0]).toMatchObject({ type: 'task', task: { status: 'completed', summary: 'Timer elapsed' } })
  })
})
