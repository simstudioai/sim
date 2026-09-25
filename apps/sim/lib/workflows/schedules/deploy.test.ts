/**
 * Tests for schedule deploy utilities
 */
import {
  dbChainMock,
  dbChainMockFns,
  flattenMockConditions,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRandomUUID, mockGetProtectedDeploymentVersionId, mockIsDeploymentOperationCurrent } =
  vi.hoisted(() => ({
    mockRandomUUID: vi.fn(),
    mockGetProtectedDeploymentVersionId: vi.fn(),
    mockIsDeploymentOperationCurrent: vi.fn(),
  }))

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))

vi.mock('@/lib/webhooks/deploy', () => ({
  cleanupWebhooksForWorkflow: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/workflows/persistence/deployment-operations', () => ({
  getProtectedDeploymentVersionId: mockGetProtectedDeploymentVersionId,
  isDeploymentOperationCurrent: mockIsDeploymentOperationCurrent,
  setDeploymentTxTimeouts: vi.fn(),
}))

import { createSchedulesForDeploy, deleteInactiveDeploymentSchedules } from './deploy'
import type { BlockState } from './utils'
import * as scheduleUtils from './utils'
import { findScheduleBlocks, validateScheduleBlock, validateWorkflowSchedules } from './validation'

/**
 * Spy on the shared `./utils` namespace instead of `vi.mock`: under
 * `isolate: false` the modules under test may already be cached from another
 * test file, bound to the real utils instance, which a per-file `vi.mock`
 * factory could never rebind. Patching the resolved namespace covers both
 * fresh and reused module graphs.
 */
const mockGenerateCronExpression = vi.spyOn(scheduleUtils, 'generateCronExpression')
const mockCalculateNextRunTime = vi.spyOn(scheduleUtils, 'calculateNextRunTime')
const mockValidateCronExpression = vi.spyOn(scheduleUtils, 'validateCronExpression')
const mockGetScheduleTimeValues = vi.spyOn(scheduleUtils, 'getScheduleTimeValues')

afterAll(() => {
  mockGenerateCronExpression.mockRestore()
  mockCalculateNextRunTime.mockRestore()
  mockValidateCronExpression.mockRestore()
  mockGetScheduleTimeValues.mockRestore()
  resetDbChainMock()
})

describe('Schedule Deploy Utilities', () => {
  beforeEach(() => {
    resetDbChainMock()

    /**
     * Re-stub per test: `unstubGlobals: true` unstubs all globals before each
     * test, so a top-level stub would not survive past collection.
     */
    vi.stubGlobal('crypto', { randomUUID: mockRandomUUID })

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
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
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

    it('should exclude disabled schedule blocks', () => {
      const blocks: Record<string, BlockState> = {
        'block-1': { id: 'block-1', type: 'schedule', enabled: true, subBlocks: {} } as BlockState,
        'block-2': { id: 'block-2', type: 'schedule', enabled: false, subBlocks: {} } as BlockState,
        'block-3': { id: 'block-3', type: 'schedule', subBlocks: {} } as BlockState, // enabled undefined = enabled
      }

      const result = findScheduleBlocks(blocks)

      expect(result).toHaveLength(2)
      expect(result.map((b) => b.id)).toEqual(['block-1', 'block-3'])
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
    })

    describe('minutes schedule validation', () => {
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
    })

    describe('weekly schedule validation', () => {
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
    })

    describe('monthly schedule validation', () => {
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
    })

    describe('custom cron schedule validation', () => {
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

      const result = await createSchedulesForDeploy('workflow-1', blocks)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Time is required for daily schedules')
      expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
    })
  })
})

describe('deleteInactiveDeploymentSchedules', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockIsDeploymentOperationCurrent.mockResolvedValue(true)
    mockGetProtectedDeploymentVersionId.mockResolvedValue(null)
  })

  it('deletes every schedule owned by an inactive version in one statement', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'schedule-1' }, { id: 'schedule-2' }])

    await expect(deleteInactiveDeploymentSchedules({ workflowId: 'workflow-1' })).resolves.toEqual({
      status: 'deleted',
      count: 2,
    })

    expect(dbChainMockFns.delete).toHaveBeenCalledTimes(1)
    const conditions = flattenMockConditions(dbChainMockFns.where.mock.calls.at(-1)?.[0])
    expect(conditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'inArray',
          column: schemaMock.workflowSchedule.deploymentVersionId,
        }),
        expect.objectContaining({ type: 'isNull', column: schemaMock.workflowSchedule.archivedAt }),
      ])
    )
    expect(conditions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'ne' })])
    )
  })

  it('shields the version an in-flight operation is preparing', async () => {
    mockGetProtectedDeploymentVersionId.mockResolvedValue('version-3')

    await deleteInactiveDeploymentSchedules({ workflowId: 'workflow-1' })

    const conditions = flattenMockConditions(dbChainMockFns.where.mock.calls.at(-1)?.[0])
    expect(conditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'ne',
          left: schemaMock.workflowSchedule.deploymentVersionId,
          right: 'version-3',
        }),
      ])
    )
  })

  it('deletes nothing once a newer operation owns the workflow', async () => {
    mockIsDeploymentOperationCurrent.mockResolvedValue(false)

    await expect(
      deleteInactiveDeploymentSchedules({
        workflowId: 'workflow-1',
        operationFence: { workflowId: 'workflow-1', operationId: 'operation-1', generation: 2 },
      })
    ).resolves.toEqual({ status: 'superseded' })

    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })
})
