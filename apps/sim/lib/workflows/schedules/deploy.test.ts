/**
 * Tests for schedule deploy utilities
 *
 * @vitest-environment node
 */
import { loggerMock } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockInsert,
  mockDelete,
  mockOnConflictDoUpdate,
  mockValues,
  mockWhere,
  mockGenerateCronExpression,
  mockCalculateNextRunTime,
  mockValidateCronExpression,
  mockGetScheduleTimeValues,
  mockRandomUUID,
} = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockDelete: vi.fn(),
  mockOnConflictDoUpdate: vi.fn(),
  mockValues: vi.fn(),
  mockWhere: vi.fn(),
  mockGenerateCronExpression: vi.fn(),
  mockCalculateNextRunTime: vi.fn(),
  mockValidateCronExpression: vi.fn(),
  mockGetScheduleTimeValues: vi.fn(),
  mockRandomUUID: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {},
  workflowSchedule: {
    workflowId: 'workflow_id',
    blockId: 'block_id',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args) => ({ type: 'eq', args })),
}))

vi.mock('@sim/logger', () => loggerMock)

vi.mock('./utils', async (importOriginal) => {
  const original = await importOriginal<typeof import('./utils')>()
  return {
    ...original,
    generateCronExpression: mockGenerateCronExpression,
    calculateNextRunTime: mockCalculateNextRunTime,
    validateCronExpression: mockValidateCronExpression,
    getScheduleTimeValues: mockGetScheduleTimeValues,
  }
})

vi.stubGlobal('crypto', {
  randomUUID: mockRandomUUID,
})

import { createSchedulesForDeploy, deleteSchedulesForWorkflow } from './deploy'
import type { BlockState } from './utils'
import { findScheduleBlocks, validateScheduleBlock, validateWorkflowSchedules } from './validation'

describe('Schedule Deploy Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockRandomUUID.mockReturnValue('test-uuid')
    mockGenerateCronExpression.mockReturnValue('0 9 * * *')
    mockCalculateNextRunTime.mockReturnValue(new Date('2025-04-15T09:00:00Z'))
    mockValidateCronExpression.mockReturnValue({ isValid: true, nextRun: new Date() })
    mockGetScheduleTimeValues.mockReturnValue({
      scheduleTime: '09:00',
      scheduleStartAt: '',
      timezone: 'UTC',
      minutesInterval: 15,
      hourlyMinute: 0,
      dailyTime: [9, 0],
      weeklyDay: 1,
      weeklyTime: [9, 0],
      monthlyDay: 1,
      monthlyTime: [9, 0],
      cronExpression: null,
    })

    // Setup mock chain for insert
    mockOnConflictDoUpdate.mockResolvedValue({})
    mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate })
    mockInsert.mockReturnValue({ values: mockValues })

    // Setup mock chain for delete
    mockWhere.mockResolvedValue({})
    mockDelete.mockReturnValue({ where: mockWhere })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('findScheduleBlocks', () => {
    it('should find schedule blocks in a workflow', () => {
      const blocks: Record<string, BlockState> = {
        'block-1': { id: 'block-1', type: 'schedule', subBlocks: {} } as BlockState,
        'block-2': { id: 'block-2', type: 'agent', subBlocks: {} } as BlockState,
        'block-3': { id: 'block-3', type: 'schedule', subBlocks: {} } as BlockState,
      }

      const result = findScheduleBlocks(blocks)

      expect(result).toHaveLength(2)
      expect(result.map((b) => b.id)).toEqual(['block-1', 'block-3'])
    })

    it('should return empty array when no schedule blocks exist', () => {
      const blocks: Record<string, BlockState> = {
        'block-1': { id: 'block-1', type: 'agent', subBlocks: {} } as BlockState,
        'block-2': { id: 'block-2', type: 'starter', subBlocks: {} } as BlockState,
      }

      const result = findScheduleBlocks(blocks)

      expect(result).toHaveLength(0)
    })

    it('should handle empty blocks object', () => {
      const result = findScheduleBlocks({})
      expect(result).toHaveLength(0)
    })
  })

  describe('validateScheduleBlock', () => {
    describe('schedule type validation', () => {
      it('should fail when schedule type is missing', () => {
        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {},
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(false)
        expect(result.error).toBe('Schedule type is required')
      })

      it('should fail with empty schedule type', () => {
        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: '' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(false)
        expect(result.error).toBe('Schedule type is required')
      })
    })

    describe('minutes schedule validation', () => {
      it('should validate valid minutes interval', () => {
        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'minutes' },
            minutesInterval: { value: '15' },
            timezone: { value: 'UTC' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(true)
        expect(result.cronExpression).toBeDefined()
      })

      it('should fail with empty minutes interval', () => {
        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'minutes' },
            minutesInterval: { value: '' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(false)
        expect(result.error).toBe('Minutes interval is required for minute-based schedules')
      })

      it('should fail with invalid minutes interval (out of range)', () => {
        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'minutes' },
            minutesInterval: { value: '0' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(false)
        expect(result.error).toBe('Minutes interval is required for minute-based schedules')
      })

      it('should fail with minutes interval > 1440', () => {
        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'minutes' },
            minutesInterval: { value: '1441' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(false)
        expect(result.error).toBe('Minutes interval is required for minute-based schedules')
      })
    })

    describe('hourly schedule validation', () => {
      it('should validate valid hourly minute', () => {
        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'hourly' },
            hourlyMinute: { value: '30' },
            timezone: { value: 'UTC' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(true)
      })

      it('should validate hourly minute of 0', () => {
        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'hourly' },
            hourlyMinute: { value: '0' },
            timezone: { value: 'UTC' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(true)
      })

      it('should fail with empty hourly minute', () => {
        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'hourly' },
            hourlyMinute: { value: '' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(false)
        expect(result.error).toBe('Minute value is required for hourly schedules')
      })

      it('should fail with hourly minute > 59', () => {
        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'hourly' },
            hourlyMinute: { value: '60' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(false)
        expect(result.error).toBe('Minute value is required for hourly schedules')
      })
    })

    describe('daily schedule validation', () => {
      it('should validate valid daily time', () => {
        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'daily' },
            dailyTime: { value: '09:30' },
            timezone: { value: 'America/New_York' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(true)
        expect(result.timezone).toBe('America/New_York')
      })

      it('should fail with empty daily time', () => {
        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'daily' },
            dailyTime: { value: '' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(false)
        expect(result.error).toBe('Time is required for daily schedules')
      })

      it('should fail with invalid time format (no colon)', () => {
        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'daily' },
            dailyTime: { value: '0930' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(false)
        expect(result.error).toBe('Time is required for daily schedules')
      })
    })

    describe('weekly schedule validation', () => {
      it('should validate valid weekly configuration', () => {
        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'weekly' },
            weeklyDay: { value: 'MON' },
            weeklyDayTime: { value: '10:00' },
            timezone: { value: 'UTC' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(true)
      })

      it('should fail with missing day', () => {
        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'weekly' },
            weeklyDay: { value: '' },
            weeklyDayTime: { value: '10:00' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(false)
        expect(result.error).toBe('Day and time are required for weekly schedules')
      })

      it('should fail with missing time', () => {
        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'weekly' },
            weeklyDay: { value: 'MON' },
            weeklyDayTime: { value: '' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(false)
        expect(result.error).toBe('Day and time are required for weekly schedules')
      })
    })

    describe('monthly schedule validation', () => {
      it('should validate valid monthly configuration', () => {
        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'monthly' },
            monthlyDay: { value: '15' },
            monthlyTime: { value: '14:30' },
            timezone: { value: 'UTC' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(true)
      })

      it('should fail with day out of range (0)', () => {
        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'monthly' },
            monthlyDay: { value: '0' },
            monthlyTime: { value: '14:30' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(false)
        expect(result.error).toBe('Day and time are required for monthly schedules')
      })

      it('should fail with day out of range (32)', () => {
        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'monthly' },
            monthlyDay: { value: '32' },
            monthlyTime: { value: '14:30' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(false)
        expect(result.error).toBe('Day and time are required for monthly schedules')
      })

      it('should fail with missing time', () => {
        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'monthly' },
            monthlyDay: { value: '15' },
            monthlyTime: { value: '' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(false)
        expect(result.error).toBe('Day and time are required for monthly schedules')
      })
    })

    describe('custom cron schedule validation', () => {
      it('should validate valid custom cron expression', () => {
        mockGetScheduleTimeValues.mockReturnValue({
          scheduleTime: '',
          scheduleStartAt: '',
          timezone: 'UTC',
          minutesInterval: 15,
          hourlyMinute: 0,
          dailyTime: [9, 0],
          weeklyDay: 1,
          weeklyTime: [9, 0],
          monthlyDay: 1,
          monthlyTime: [9, 0],
          cronExpression: '*/5 * * * *',
        })

        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'custom' },
            cronExpression: { value: '*/5 * * * *' },
            timezone: { value: 'UTC' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(true)
      })

      it('should fail with empty cron expression', () => {
        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'custom' },
            cronExpression: { value: '' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(false)
        expect(result.error).toBe('Cron expression is required for custom schedules')
      })
    })

    describe('invalid cron expression handling', () => {
      it('should fail when generated cron is invalid', () => {
        mockValidateCronExpression.mockReturnValue({
          isValid: false,
          error: 'Invalid minute value',
        })

        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'daily' },
            dailyTime: { value: '09:00' },
            timezone: { value: 'UTC' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(false)
        expect(result.error).toContain('Invalid cron expression')
      })

      it('should handle exceptions during cron generation', () => {
        mockGenerateCronExpression.mockImplementation(() => {
          throw new Error('Failed to parse schedule type')
        })

        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'daily' },
            dailyTime: { value: '09:00' },
            timezone: { value: 'UTC' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(false)
        expect(result.error).toBe('Failed to parse schedule type')
      })
    })

    describe('timezone handling', () => {
      it('should use UTC as default timezone', () => {
        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'daily' },
            dailyTime: { value: '09:00' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(true)
        expect(result.timezone).toBe('UTC')
      })

      it('should use specified timezone', () => {
        const block: BlockState = {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'daily' },
            dailyTime: { value: '09:00' },
            timezone: { value: 'Asia/Tokyo' },
          },
        } as BlockState

        const result = validateScheduleBlock(block)

        expect(result.isValid).toBe(true)
        expect(result.timezone).toBe('Asia/Tokyo')
      })
    })
  })

  describe('validateWorkflowSchedules', () => {
    it('should return valid for workflows without schedule blocks', () => {
      const blocks: Record<string, BlockState> = {
        'block-1': { id: 'block-1', type: 'agent', subBlocks: {} } as BlockState,
      }

      const result = validateWorkflowSchedules(blocks)

      expect(result.isValid).toBe(true)
    })

    it('should validate all schedule blocks', () => {
      const blocks: Record<string, BlockState> = {
        'block-1': {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'daily' },
            dailyTime: { value: '09:00' },
            timezone: { value: 'UTC' },
          },
        } as BlockState,
        'block-2': {
          id: 'block-2',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'hourly' },
            hourlyMinute: { value: '30' },
            timezone: { value: 'UTC' },
          },
        } as BlockState,
      }

      const result = validateWorkflowSchedules(blocks)

      expect(result.isValid).toBe(true)
    })

    it('should return first validation error found', () => {
      const blocks: Record<string, BlockState> = {
        'block-1': {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'daily' },
            dailyTime: { value: '09:00' },
            timezone: { value: 'UTC' },
          },
        } as BlockState,
        'block-2': {
          id: 'block-2',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'daily' },
            dailyTime: { value: '' }, // Invalid - missing time
          },
        } as BlockState,
      }

      const result = validateWorkflowSchedules(blocks)

      expect(result.isValid).toBe(false)
      expect(result.error).toBe('Time is required for daily schedules')
    })
  })

  describe('createSchedulesForDeploy', () => {
    it('should return success with no schedule blocks', async () => {
      const blocks: Record<string, BlockState> = {
        'block-1': { id: 'block-1', type: 'agent', subBlocks: {} } as BlockState,
      }

      const mockTx = {
        insert: mockInsert,
        delete: mockDelete,
      }

      const result = await createSchedulesForDeploy('workflow-1', blocks, mockTx as any)

      expect(result.success).toBe(true)
      expect(mockInsert).not.toHaveBeenCalled()
    })

    it('should create schedule for valid schedule block', async () => {
      const blocks: Record<string, BlockState> = {
        'block-1': {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'daily' },
            dailyTime: { value: '09:00' },
            timezone: { value: 'UTC' },
          },
        } as BlockState,
      }

      const mockTx = {
        insert: mockInsert,
        delete: mockDelete,
      }

      const result = await createSchedulesForDeploy('workflow-1', blocks, mockTx as any)

      expect(result.success).toBe(true)
      expect(result.scheduleId).toBe('test-uuid')
      expect(result.cronExpression).toBe('0 9 * * *')
      expect(result.nextRunAt).toEqual(new Date('2025-04-15T09:00:00Z'))
      expect(mockInsert).toHaveBeenCalled()
      expect(mockOnConflictDoUpdate).toHaveBeenCalled()
    })

    it('should return error for invalid schedule block', async () => {
      const blocks: Record<string, BlockState> = {
        'block-1': {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'daily' },
            dailyTime: { value: '' }, // Invalid
          },
        } as BlockState,
      }

      const mockTx = {
        insert: mockInsert,
        delete: mockDelete,
      }

      const result = await createSchedulesForDeploy('workflow-1', blocks, mockTx as any)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Time is required for daily schedules')
      expect(mockInsert).not.toHaveBeenCalled()
    })

    it('should use onConflictDoUpdate for existing schedules', async () => {
      const blocks: Record<string, BlockState> = {
        'block-1': {
          id: 'block-1',
          type: 'schedule',
          subBlocks: {
            scheduleType: { value: 'minutes' },
            minutesInterval: { value: '30' },
            timezone: { value: 'UTC' },
          },
        } as BlockState,
      }

      const mockTx = {
        insert: mockInsert,
        delete: mockDelete,
      }

      await createSchedulesForDeploy('workflow-1', blocks, mockTx as any)

      expect(mockOnConflictDoUpdate).toHaveBeenCalledWith({
        target: expect.any(Array),
        set: expect.objectContaining({
          blockId: 'block-1',
          cronExpression: '0 9 * * *',
          status: 'active',
          failedCount: 0,
        }),
      })
    })
  })

  describe('deleteSchedulesForWorkflow', () => {
    it('should delete all schedules for a workflow', async () => {
      const mockTx = {
        insert: mockInsert,
        delete: mockDelete,
      }

      await deleteSchedulesForWorkflow('workflow-1', mockTx as any)

      expect(mockDelete).toHaveBeenCalled()
      expect(mockWhere).toHaveBeenCalled()
    })
  })
})
