/**
 * The execution stream's active-block snapshot script against a real Redis. A block callback can
 * land after the run has ended, and a reconnecting client renders whatever the snapshot holds.
 * Failure modes:
 * - a late block start overwrites the snapshot of a run that is already terminal
 * - a block start on a live run is not recorded
 * Each test uses a fresh execution id; the integration setup flushes Redis per file.
 */
import { generateId } from '@sim/utils/id'
import { afterAll, describe, expect, it } from 'vitest'
import { closeRedisConnection } from '@/lib/core/config/redis'
import {
  type ActiveBlockStartSnapshot,
  initializeExecutionStreamMeta,
  markExecutionStreamTerminal,
  readExecutionMetaState,
  setExecutionActiveBlockStarts,
} from '@/lib/execution/event-buffer'

const lateBlock: ActiveBlockStartSnapshot = {
  eventId: 9,
  data: {
    blockId: 'function-late',
    blockName: 'Late',
    blockType: 'function',
    executionOrder: 3,
  },
}

afterAll(async () => {
  await closeRedisConnection()
})

describe('execution stream active-block snapshot', () => {
  it('does not replace a terminal snapshot with a late block start', async () => {
    const executionId = `exec-${generateId()}`
    await expect(markExecutionStreamTerminal(executionId, 'cancelled')).resolves.toBe(true)

    await expect(setExecutionActiveBlockStarts(executionId, [lateBlock])).resolves.toBe(true)

    await expect(readExecutionMetaState(executionId)).resolves.toMatchObject({
      status: 'found',
      meta: { status: 'cancelled', activeBlockStarts: [] },
    })
  })

  it('records block starts while the run is active', async () => {
    const executionId = `exec-${generateId()}`
    await expect(
      initializeExecutionStreamMeta(executionId, { workflowId: 'wf-1', userId: 'user-1' })
    ).resolves.toBe(true)

    await expect(setExecutionActiveBlockStarts(executionId, [lateBlock])).resolves.toBe(true)

    await expect(readExecutionMetaState(executionId)).resolves.toMatchObject({
      status: 'found',
      meta: { status: 'active', activeBlockStarts: [lateBlock] },
    })
  })
})
