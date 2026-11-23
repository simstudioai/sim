import { describe, expect, it } from 'vitest'
import { validateScheduleBlock } from '@/lib/workflows/schedules/validation'

describe('validateScheduleBlock reason', () => {
  it('classifies a written but out-of-range numeric zero as invalid, not missing', () => {
    const result = validateScheduleBlock({
      type: 'schedule',
      subBlocks: {
        scheduleType: { value: 'minutes' },
        minutesInterval: { value: 0 },
      },
    })
    expect(result.isValid).toBe(false)
    expect(result.reason).toBe('invalid')
  })
})
