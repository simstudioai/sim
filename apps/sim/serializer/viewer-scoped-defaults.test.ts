import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getBlock } from '@/blocks'
import { ScheduleBlock } from '@/blocks/blocks/schedule'
import { extractBlockParams } from '@/serializer/index'
import { prepareBlockState } from '@/stores/workflows/prepare-block-state'

describe('viewer-scoped sub-block defaults', () => {
  beforeEach(() => {
    vi.mocked(getBlock).mockReturnValue(ScheduleBlock)
  })

  it('leaves a schedule without a stored timezone unset instead of reading the host zone', () => {
    const block = prepareBlockState({
      id: 'schedule_fixture',
      type: 'schedule',
      name: 'Schedule',
      position: { x: 0, y: 0 },
    })
    block.subBlocks.scheduleType.value = 'daily'
    block.subBlocks.timezone.value = null

    expect(extractBlockParams(block).timezone).toBeNull()
  })
})
