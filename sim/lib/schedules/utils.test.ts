/**
 * Tests for schedule utility functions
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  calculateNextRunTime,
  generateCronExpression,
  getScheduleTimeValues,
  getSubBlockValue,
  parseTimeString,
  parseCronToHumanReadable,
  BlockState,
} from './utils'

describe('Schedule Utilities', () => {
  describe('parseTimeString', () => {
    it('should parse valid time strings', () => {
      expect(parseTimeString('09:30')).toEqual([9, 30])
      expect(parseTimeString('23:45')).toEqual([23, 45])
      expect(parseTimeString('00:00')).toEqual([0, 0])
    })

    it('should return default values for invalid inputs', () => {
      expect(parseTimeString('')).toEqual([9, 0])
      expect(parseTimeString(null)).toEqual([9, 0])
      expect(parseTimeString(undefined)).toEqual([9, 0])
      expect(parseTimeString('invalid')).toEqual([9, 0])
    })

    it('should handle malformed time strings', () => {
      expect(parseTimeString('9:30')).toEqual([9, 30])
      expect(parseTimeString('9:3')).toEqual([9, 3])
      expect(parseTimeString('9:')).toEqual([9, 0])
      expect(parseTimeString(':30')).toEqual([0, 30]) // Only has minutes
    })

    it('should handle out-of-range time values', () => {
      expect(parseTimeString('25:30')).toEqual([25, 30]) // Hours > 24
      expect(parseTimeString('10:75')).toEqual([10, 75]) // Minutes > 59
      expect(parseTimeString('99:99')).toEqual([99, 99]) // Both out of range
    })
  })

  describe('getSubBlockValue', () => {
    it('should get values from block subBlocks', () => {
      const block: BlockState = {
        type: 'starter',
        subBlocks: {
          scheduleType: { value: 'daily' },
          scheduleTime: { value: '09:30' },
          emptyValue: { value: '' },
          nullValue: { value: null },
        }
      } as BlockState

      expect(getSubBlockValue(block, 'scheduleType')).toBe('daily')
      expect(getSubBlockValue(block, 'scheduleTime')).toBe('09:30')
      expect(getSubBlockValue(block, 'emptyValue')).toBe('')
      expect(getSubBlockValue(block, 'nullValue')).toBe('')
      expect(getSubBlockValue(block, 'nonExistent')).toBe('')
    })

    it('should handle missing subBlocks', () => {
      const block = {
        type: 'starter',
        subBlocks: {},  // Empty subBlocks
      } as BlockState

      expect(getSubBlockValue(block, 'anyField')).toBe('')
    })
  })

  describe('getScheduleTimeValues', () => {
    it('should extract all time values from a block', () => {
      const block: BlockState = {
        type: 'starter',
        subBlocks: {
          scheduleTime: { value: '09:30' },
          minutesInterval: { value: '15' },
          hourlyMinute: { value: '45' },
          dailyTime: { value: '10:15' },
          weeklyDay: { value: 'MON' },
          weeklyDayTime: { value: '12:00' },
          monthlyDay: { value: '15' },
          monthlyTime: { value: '14:30' },
        }
      } as BlockState

      const result = getScheduleTimeValues(block)
      
      expect(result).toEqual({
        scheduleTime: '09:30',
        minutesInterval: 15,
        hourlyMinute: 45,
        dailyTime: [10, 15],
        weeklyDay: 1, // MON = 1
        weeklyTime: [12, 0],
        monthlyDay: 15,
        monthlyTime: [14, 30],
      })
    })

    it('should use default values for missing fields', () => {
      const block: BlockState = {
        type: 'starter',
        subBlocks: {
          // Minimal config
          scheduleType: { value: 'daily' },
        }
      } as BlockState

      const result = getScheduleTimeValues(block)
      
      expect(result).toEqual({
        scheduleTime: '',
        minutesInterval: 15, // Default
        hourlyMinute: 0,     // Default
        dailyTime: [9, 0],   // Default
        weeklyDay: 1,        // Default (MON)
        weeklyTime: [9, 0],  // Default
        monthlyDay: 1,       // Default
        monthlyTime: [9, 0], // Default
      })
    })
  })

  describe('generateCronExpression', () => {
    it('should generate correct cron expressions for different schedule types', () => {
      const scheduleValues = {
        scheduleTime: '09:30',
        minutesInterval: 15,
        hourlyMinute: 45,
        dailyTime: [10, 15] as [number, number],
        weeklyDay: 1, // Monday
        weeklyTime: [12, 0] as [number, number],
        monthlyDay: 15,
        monthlyTime: [14, 30] as [number, number],
      }

      // Minutes (every 15 minutes)
      expect(generateCronExpression('minutes', scheduleValues)).toBe('*/15 * * * *')
      
      // Hourly (at minute 45)
      expect(generateCronExpression('hourly', scheduleValues)).toBe('45 * * * *')
      
      // Daily (at 10:15)
      expect(generateCronExpression('daily', scheduleValues)).toBe('15 10 * * *')
      
      // Weekly (Monday at 12:00)
      expect(generateCronExpression('weekly', scheduleValues)).toBe('0 12 * * 1')
      
      // Monthly (15th at 14:30)
      expect(generateCronExpression('monthly', scheduleValues)).toBe('30 14 15 * *')
    })

    it('should handle custom cron expressions', () => {
      // For this simplified test, let's skip the complex mocking
      // and just verify the 'custom' case is in the switch statement
      
      // Create a mock block with custom cron expression
      const mockBlock: BlockState = {
        type: 'starter',
        subBlocks: {
          cronExpression: { value: '*/5 * * * *' }
        }
      }
      
      // Create schedule values with the block as any since we're testing a special case
      const scheduleValues = {
        ...getScheduleTimeValues(mockBlock),
        // Override as BlockState to access the cronExpression
        // This simulates what happens in the actual code
        subBlocks: mockBlock.subBlocks
      } as any
      
      // Now properly test the custom case
      const result = generateCronExpression('custom', scheduleValues)
      expect(result).toBe('*/5 * * * *')
      
      // Also verify other schedule types still work
      const standardScheduleValues = { 
        scheduleTime: '',
        minutesInterval: 15,
        hourlyMinute: 30,
        dailyTime: [9, 0] as [number, number],
        weeklyDay: 1,
        weeklyTime: [10, 0] as [number, number],
        monthlyDay: 15,
        monthlyTime: [14, 30] as [number, number],
      }
      
      expect(generateCronExpression('minutes', standardScheduleValues)).toBe('*/15 * * * *')
    })

    it('should throw for invalid schedule types', () => {
      const scheduleValues = {} as any
      expect(() => generateCronExpression('invalid-type', scheduleValues)).toThrow()
    })
  })

  describe('calculateNextRunTime', () => {
    beforeEach(() => {
      // Mock Date.now for consistent testing
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-04-12T12:00:00.000Z')) // Noon on April 12, 2025
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should calculate next run for minutes schedule', () => {
      const scheduleValues = {
        scheduleTime: '',
        minutesInterval: 15,
        hourlyMinute: 0,
        dailyTime: [9, 0] as [number, number],
        weeklyDay: 1,
        weeklyTime: [9, 0] as [number, number],
        monthlyDay: 1,
        monthlyTime: [9, 0] as [number, number],
      }

      const nextRun = calculateNextRunTime('minutes', scheduleValues)
      
      // Just check that it's a valid date in the future
      expect(nextRun instanceof Date).toBe(true)
      expect(nextRun > new Date()).toBe(true)
      
      // Check minute is a multiple of the interval
      expect(nextRun.getMinutes() % 15).toBe(0)
    })

    it('should respect scheduleTime for minutes schedule', () => {
      const scheduleValues = {
        scheduleTime: '14:30', // Specific start time
        minutesInterval: 15,
        hourlyMinute: 0,
        dailyTime: [9, 0] as [number, number],
        weeklyDay: 1,
        weeklyTime: [9, 0] as [number, number],
        monthlyDay: 1,
        monthlyTime: [9, 0] as [number, number],
      }

      const nextRun = calculateNextRunTime('minutes', scheduleValues)
      
      // Should be 14:30
      expect(nextRun.getHours()).toBe(14)
      expect(nextRun.getMinutes()).toBe(30)
    })

    it('should calculate next run for hourly schedule', () => {
      const scheduleValues = {
        scheduleTime: '',
        minutesInterval: 15,
        hourlyMinute: 30,
        dailyTime: [9, 0] as [number, number],
        weeklyDay: 1,
        weeklyTime: [9, 0] as [number, number],
        monthlyDay: 1,
        monthlyTime: [9, 0] as [number, number],
      }

      const nextRun = calculateNextRunTime('hourly', scheduleValues)
      
      // Just verify it's a valid future date with the right minute
      expect(nextRun instanceof Date).toBe(true)
      expect(nextRun > new Date()).toBe(true)
      expect(nextRun.getMinutes()).toBe(30)
    })

    it('should calculate next run for daily schedule', () => {
      const scheduleValues = {
        scheduleTime: '',
        minutesInterval: 15,
        hourlyMinute: 0,
        dailyTime: [9, 0] as [number, number],
        weeklyDay: 1,
        weeklyTime: [9, 0] as [number, number],
        monthlyDay: 1,
        monthlyTime: [9, 0] as [number, number],
      }

      const nextRun = calculateNextRunTime('daily', scheduleValues)
      
      // Verify it's a future date at exactly 9:00
      expect(nextRun instanceof Date).toBe(true)
      expect(nextRun > new Date()).toBe(true)
      expect(nextRun.getHours()).toBe(9)
      expect(nextRun.getMinutes()).toBe(0)
    })

    it('should calculate next run for weekly schedule', () => {
      const scheduleValues = {
        scheduleTime: '',
        minutesInterval: 15,
        hourlyMinute: 0,
        dailyTime: [9, 0] as [number, number],
        weeklyDay: 1, // Monday
        weeklyTime: [10, 0] as [number, number],
        monthlyDay: 1,
        monthlyTime: [9, 0] as [number, number],
      }

      const nextRun = calculateNextRunTime('weekly', scheduleValues)
      
      // Should be next Monday at 10:00 AM
      expect(nextRun.getDay()).toBe(1) // Monday
      expect(nextRun.getHours()).toBe(10)
      expect(nextRun.getMinutes()).toBe(0)
    })

    it('should calculate next run for monthly schedule', () => {
      const scheduleValues = {
        scheduleTime: '',
        minutesInterval: 15,
        hourlyMinute: 0,
        dailyTime: [9, 0] as [number, number],
        weeklyDay: 1,
        weeklyTime: [9, 0] as [number, number],
        monthlyDay: 15,
        monthlyTime: [14, 30] as [number, number],
      }

      const nextRun = calculateNextRunTime('monthly', scheduleValues)
      
      // Current date is 2025-04-12 12:00, so next run should be 2025-04-15 14:30
      expect(nextRun.getFullYear()).toBe(2025)
      expect(nextRun.getMonth()).toBe(3) // April (0-indexed)
      expect(nextRun.getDate()).toBe(15)
      expect(nextRun.getHours()).toBe(14)
      expect(nextRun.getMinutes()).toBe(30)
    })

    it('should consider lastRanAt for better interval calculation', () => {
      const scheduleValues = {
        scheduleTime: '',
        minutesInterval: 15,
        hourlyMinute: 0,
        dailyTime: [9, 0] as [number, number],
        weeklyDay: 1,
        weeklyTime: [9, 0] as [number, number],
        monthlyDay: 1,
        monthlyTime: [9, 0] as [number, number],
      }

      // Last ran 10 minutes ago
      const lastRanAt = new Date()
      lastRanAt.setMinutes(lastRanAt.getMinutes() - 10)
      
      const nextRun = calculateNextRunTime('minutes', scheduleValues, lastRanAt)
      
      // Should be 5 minutes from the last run (15 min interval)
      const expectedNextRun = new Date(lastRanAt)
      expectedNextRun.setMinutes(expectedNextRun.getMinutes() + 15)
      
      expect(nextRun.getMinutes()).toBe(expectedNextRun.getMinutes())
    })
  })

  describe('parseCronToHumanReadable', () => {
    it('should parse common cron patterns', () => {
      expect(parseCronToHumanReadable('* * * * *')).toBe('Every minute')
      expect(parseCronToHumanReadable('*/15 * * * *')).toBe('Every 15 minutes')
      expect(parseCronToHumanReadable('30 * * * *')).toBe('Hourly at 30 minutes past the hour')
      expect(parseCronToHumanReadable('0 9 * * *')).toBe('Daily at 9:00 AM')
      expect(parseCronToHumanReadable('30 14 * * *')).toBe('Daily at 2:30 PM')
      expect(parseCronToHumanReadable('0 9 * * 1')).toMatch(/Monday at 9:00 AM/)
      expect(parseCronToHumanReadable('30 14 15 * *')).toMatch(/Monthly on the 15th at 2:30 PM/)
    })

    it('should handle complex patterns', () => {
      // Test with various combinations
      expect(parseCronToHumanReadable('* */2 * * *')).toMatch(/Runs/)
      expect(parseCronToHumanReadable('0 9 * * 1-5')).toMatch(/Runs/)
      expect(parseCronToHumanReadable('0 9 1,15 * *')).toMatch(/Runs/)
    })

    it('should return a fallback for unrecognized patterns', () => {
      const result = parseCronToHumanReadable('*/10 */6 31 2 *') // Invalid (Feb 31)
      // Just check that we get something back that's not empty
      expect(result.length).toBeGreaterThan(5)
    })
  })
})