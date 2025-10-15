/**
 * Tests for schedule utility functions
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type BlockState,
  calculateNextRunTime,
  createDateWithTimezone,
  generateCronExpression,
  getScheduleTimeValues,
  getSubBlockValue,
  parseCronToHumanReadable,
  parseTimeString,
  validateCronExpression,
} from '@/lib/schedules/utils'

describe('Schedule Utilities', () => {
  describe('parseTimeString', () => {
    it.concurrent('should parse valid time strings', () => {
      expect(parseTimeString('09:30')).toEqual([9, 30])
      expect(parseTimeString('23:45')).toEqual([23, 45])
      expect(parseTimeString('00:00')).toEqual([0, 0])
    })

    it.concurrent('should return default values for invalid inputs', () => {
      expect(parseTimeString('')).toEqual([9, 0])
      expect(parseTimeString(null)).toEqual([9, 0])
      expect(parseTimeString(undefined)).toEqual([9, 0])
      expect(parseTimeString('invalid')).toEqual([9, 0])
    })

    it.concurrent('should handle malformed time strings', () => {
      expect(parseTimeString('9:30')).toEqual([9, 30])
      expect(parseTimeString('9:3')).toEqual([9, 3])
      expect(parseTimeString('9:')).toEqual([9, 0])
      expect(parseTimeString(':30')).toEqual([0, 30]) // Only has minutes
    })

    it.concurrent('should handle out-of-range time values', () => {
      expect(parseTimeString('25:30')).toEqual([25, 30]) // Hours > 24
      expect(parseTimeString('10:75')).toEqual([10, 75]) // Minutes > 59
      expect(parseTimeString('99:99')).toEqual([99, 99]) // Both out of range
    })
  })

  describe('getSubBlockValue', () => {
    it.concurrent('should get values from block subBlocks', () => {
      const block: BlockState = {
        type: 'starter',
        subBlocks: {
          scheduleType: { value: 'daily' },
          scheduleTime: { value: '09:30' },
          emptyValue: { value: '' },
          nullValue: { value: null },
        },
      } as BlockState

      expect(getSubBlockValue(block, 'scheduleType')).toBe('daily')
      expect(getSubBlockValue(block, 'scheduleTime')).toBe('09:30')
      expect(getSubBlockValue(block, 'emptyValue')).toBe('')
      expect(getSubBlockValue(block, 'nullValue')).toBe('')
      expect(getSubBlockValue(block, 'nonExistent')).toBe('')
    })

    it.concurrent('should handle missing subBlocks', () => {
      const block = {
        type: 'starter',
        subBlocks: {}, // Empty subBlocks
      } as BlockState

      expect(getSubBlockValue(block, 'anyField')).toBe('')
    })
  })

  describe('getScheduleTimeValues', () => {
    it.concurrent('should extract all time values from a block', () => {
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
          scheduleStartAt: { value: '' },
          timezone: { value: 'UTC' },
        },
      } as BlockState

      const result = getScheduleTimeValues(block)

      expect(result).toEqual({
        scheduleTime: '09:30',
        scheduleStartAt: '',
        timezone: 'UTC',
        minutesInterval: 15,
        hourlyMinute: 45,
        dailyTime: [10, 15],
        weeklyDay: 1, // MON = 1
        weeklyTime: [12, 0],
        monthlyDay: 15,
        monthlyTime: [14, 30],
        cronExpression: null,
      })
    })

    it.concurrent('should use default values for missing fields', () => {
      const block: BlockState = {
        type: 'starter',
        subBlocks: {
          // Minimal config
          scheduleType: { value: 'daily' },
        },
      } as BlockState

      const result = getScheduleTimeValues(block)

      expect(result).toEqual({
        scheduleTime: '',
        scheduleStartAt: '',
        timezone: 'UTC',
        minutesInterval: 15, // Default
        hourlyMinute: 0, // Default
        dailyTime: [9, 0], // Default
        weeklyDay: 1, // Default (MON)
        weeklyTime: [9, 0], // Default
        monthlyDay: 1, // Default
        monthlyTime: [9, 0], // Default
        cronExpression: null,
      })
    })
  })

  describe('generateCronExpression', () => {
    it.concurrent('should generate correct cron expressions for different schedule types', () => {
      const scheduleValues = {
        scheduleTime: '09:30',
        minutesInterval: 15,
        hourlyMinute: 45,
        dailyTime: [10, 15] as [number, number],
        weeklyDay: 1, // Monday
        weeklyTime: [12, 0] as [number, number],
        monthlyDay: 15,
        monthlyTime: [14, 30] as [number, number],
        timezone: 'UTC',
        cronExpression: null,
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

    it.concurrent('should handle custom cron expressions', () => {
      // For this simplified test, let's skip the complex mocking
      // and just verify the 'custom' case is in the switch statement

      // Create a mock block with custom cron expression
      const mockBlock: BlockState = {
        type: 'starter',
        subBlocks: {
          cronExpression: { value: '*/5 * * * *' },
        },
      }

      // Create schedule values with the block as any since we're testing a special case
      const scheduleValues = {
        ...getScheduleTimeValues(mockBlock),
        // Override as BlockState to access the cronExpression
        // This simulates what happens in the actual code
        subBlocks: mockBlock.subBlocks,
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
        timezone: 'UTC',
        cronExpression: null,
      }

      expect(generateCronExpression('minutes', standardScheduleValues)).toBe('*/15 * * * *')
    })

    it.concurrent('should throw for invalid schedule types', () => {
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

    it.concurrent('should calculate next run for minutes schedule using Croner', () => {
      const scheduleValues = {
        scheduleTime: '',
        scheduleStartAt: '',
        timezone: 'UTC',
        minutesInterval: 15,
        hourlyMinute: 0,
        dailyTime: [9, 0] as [number, number],
        weeklyDay: 1,
        weeklyTime: [9, 0] as [number, number],
        monthlyDay: 1,
        monthlyTime: [9, 0] as [number, number],
        cronExpression: null,
      }

      const nextRun = calculateNextRunTime('minutes', scheduleValues)

      // Just check that it's a valid date in the future
      expect(nextRun instanceof Date).toBe(true)
      expect(nextRun > new Date()).toBe(true)

      // Croner will calculate based on the cron expression */15 * * * *
      // The exact minute depends on Croner's calculation
    })

    it.concurrent('should handle scheduleStartAt with scheduleTime', () => {
      const scheduleValues = {
        scheduleTime: '14:30', // Specific start time
        scheduleStartAt: '2025-04-15', // Future date
        timezone: 'UTC',
        minutesInterval: 15,
        hourlyMinute: 0,
        dailyTime: [9, 0] as [number, number],
        weeklyDay: 1,
        weeklyTime: [9, 0] as [number, number],
        monthlyDay: 1,
        monthlyTime: [9, 0] as [number, number],
        cronExpression: null,
      }

      const nextRun = calculateNextRunTime('minutes', scheduleValues)

      // Should return the future start date with time
      expect(nextRun.getFullYear()).toBe(2025)
      expect(nextRun.getMonth()).toBe(3) // April
      expect(nextRun.getDate()).toBe(15)
    })

    it.concurrent('should calculate next run for hourly schedule using Croner', () => {
      const scheduleValues = {
        scheduleTime: '',
        scheduleStartAt: '',
        timezone: 'UTC',
        minutesInterval: 15,
        hourlyMinute: 30,
        dailyTime: [9, 0] as [number, number],
        weeklyDay: 1,
        weeklyTime: [9, 0] as [number, number],
        monthlyDay: 1,
        monthlyTime: [9, 0] as [number, number],
        cronExpression: null,
      }

      const nextRun = calculateNextRunTime('hourly', scheduleValues)

      // Verify it's a valid future date using Croner's calculation
      expect(nextRun instanceof Date).toBe(true)
      expect(nextRun > new Date()).toBe(true)
      // Croner calculates based on cron "30 * * * *"
      expect(nextRun.getMinutes()).toBe(30)
    })

    it.concurrent('should calculate next run for daily schedule using Croner with timezone', () => {
      const scheduleValues = {
        scheduleTime: '',
        scheduleStartAt: '',
        timezone: 'UTC',
        minutesInterval: 15,
        hourlyMinute: 0,
        dailyTime: [9, 0] as [number, number],
        weeklyDay: 1,
        weeklyTime: [9, 0] as [number, number],
        monthlyDay: 1,
        monthlyTime: [9, 0] as [number, number],
        cronExpression: null,
      }

      const nextRun = calculateNextRunTime('daily', scheduleValues)

      // Verify it's a future date at exactly 9:00 UTC using Croner
      expect(nextRun instanceof Date).toBe(true)
      expect(nextRun > new Date()).toBe(true)
      expect(nextRun.getUTCHours()).toBe(9)
      expect(nextRun.getUTCMinutes()).toBe(0)
    })

    it.concurrent(
      'should calculate next run for weekly schedule using Croner with timezone',
      () => {
        const scheduleValues = {
          scheduleTime: '',
          scheduleStartAt: '',
          timezone: 'UTC',
          minutesInterval: 15,
          hourlyMinute: 0,
          dailyTime: [9, 0] as [number, number],
          weeklyDay: 1, // Monday
          weeklyTime: [10, 0] as [number, number],
          monthlyDay: 1,
          monthlyTime: [9, 0] as [number, number],
          cronExpression: null,
        }

        const nextRun = calculateNextRunTime('weekly', scheduleValues)

        // Should be next Monday at 10:00 AM UTC using Croner
        expect(nextRun.getUTCDay()).toBe(1) // Monday
        expect(nextRun.getUTCHours()).toBe(10)
        expect(nextRun.getUTCMinutes()).toBe(0)
      }
    )

    it.concurrent(
      'should calculate next run for monthly schedule using Croner with timezone',
      () => {
        const scheduleValues = {
          scheduleTime: '',
          scheduleStartAt: '',
          timezone: 'UTC',
          minutesInterval: 15,
          hourlyMinute: 0,
          dailyTime: [9, 0] as [number, number],
          weeklyDay: 1,
          weeklyTime: [9, 0] as [number, number],
          monthlyDay: 15,
          monthlyTime: [14, 30] as [number, number],
          cronExpression: null,
        }

        const nextRun = calculateNextRunTime('monthly', scheduleValues)

        // Current date is 2025-04-12 12:00, so next run should be 2025-04-15 14:30 UTC using Croner
        expect(nextRun.getFullYear()).toBe(2025)
        expect(nextRun.getUTCMonth()).toBe(3) // April (0-indexed)
        expect(nextRun.getUTCDate()).toBe(15)
        expect(nextRun.getUTCHours()).toBe(14)
        expect(nextRun.getUTCMinutes()).toBe(30)
      }
    )

    it.concurrent(
      'should work with lastRanAt parameter (though Croner calculates independently)',
      () => {
        const scheduleValues = {
          scheduleTime: '',
          scheduleStartAt: '',
          timezone: 'UTC',
          minutesInterval: 15,
          hourlyMinute: 0,
          dailyTime: [9, 0] as [number, number],
          weeklyDay: 1,
          weeklyTime: [9, 0] as [number, number],
          monthlyDay: 1,
          monthlyTime: [9, 0] as [number, number],
          cronExpression: null,
        }

        // Last ran 10 minutes ago
        const lastRanAt = new Date()
        lastRanAt.setMinutes(lastRanAt.getMinutes() - 10)

        const nextRun = calculateNextRunTime('minutes', scheduleValues, lastRanAt)

        // With Croner, it calculates based on cron expression, not lastRanAt
        // Just verify we get a future date
        expect(nextRun instanceof Date).toBe(true)
        expect(nextRun > new Date()).toBe(true)
      }
    )

    it.concurrent('should respect future scheduleStartAt date', () => {
      const scheduleValues = {
        scheduleStartAt: '2025-04-22T20:50:00.000Z', // April 22, 2025 at 8:50 PM
        scheduleTime: '',
        timezone: 'UTC',
        minutesInterval: 10,
        hourlyMinute: 0,
        dailyTime: [9, 0] as [number, number],
        weeklyDay: 1,
        weeklyTime: [9, 0] as [number, number],
        monthlyDay: 1,
        monthlyTime: [9, 0] as [number, number],
        cronExpression: null,
      }

      const nextRun = calculateNextRunTime('minutes', scheduleValues)

      // Should be exactly April 22, 2025 at 8:50 PM (the future start date)
      expect(nextRun.toISOString()).toBe('2025-04-22T20:50:00.000Z')
    })

    it.concurrent('should ignore past scheduleStartAt date', () => {
      const scheduleValues = {
        scheduleStartAt: '2025-04-10T20:50:00.000Z', // April 10, 2025 at 8:50 PM (in the past)
        scheduleTime: '',
        timezone: 'UTC',
        minutesInterval: 10,
        hourlyMinute: 0,
        dailyTime: [9, 0] as [number, number],
        weeklyDay: 1,
        weeklyTime: [9, 0] as [number, number],
        monthlyDay: 1,
        monthlyTime: [9, 0] as [number, number],
        cronExpression: null,
      }

      const nextRun = calculateNextRunTime('minutes', scheduleValues)

      // Should not use the past date but calculate normally
      expect(nextRun > new Date()).toBe(true)
      expect(nextRun.getMinutes() % 10).toBe(0) // Should align with the interval
    })
  })

  describe('validateCronExpression', () => {
    it.concurrent('should validate correct cron expressions', () => {
      expect(validateCronExpression('0 9 * * *')).toEqual({
        isValid: true,
        nextRun: expect.any(Date),
      })
      expect(validateCronExpression('*/15 * * * *')).toEqual({
        isValid: true,
        nextRun: expect.any(Date),
      })
      expect(validateCronExpression('30 14 15 * *')).toEqual({
        isValid: true,
        nextRun: expect.any(Date),
      })
    })

    it.concurrent('should validate cron expressions with timezone', () => {
      const result = validateCronExpression('0 9 * * *', 'America/Los_Angeles')
      expect(result.isValid).toBe(true)
      expect(result.nextRun).toBeInstanceOf(Date)
    })

    it.concurrent('should reject invalid cron expressions', () => {
      expect(validateCronExpression('invalid')).toEqual({
        isValid: false,
        error: expect.stringContaining('invalid'),
      })
      expect(validateCronExpression('60 * * * *')).toEqual({
        isValid: false,
        error: expect.any(String),
      })
      expect(validateCronExpression('')).toEqual({
        isValid: false,
        error: 'Cron expression cannot be empty',
      })
      expect(validateCronExpression('   ')).toEqual({
        isValid: false,
        error: 'Cron expression cannot be empty',
      })
    })

    it.concurrent('should detect impossible cron expressions', () => {
      // This would be February 31st - impossible date
      expect(validateCronExpression('0 0 31 2 *')).toEqual({
        isValid: false,
        error: 'Cron expression produces no future occurrences',
      })
    })
  })

  describe('parseCronToHumanReadable', () => {
    it.concurrent('should parse common cron patterns using cronstrue', () => {
      // cronstrue produces "Every minute" for '* * * * *'
      expect(parseCronToHumanReadable('* * * * *')).toBe('Every minute')

      // cronstrue produces "Every 15 minutes" for '*/15 * * * *'
      expect(parseCronToHumanReadable('*/15 * * * *')).toBe('Every 15 minutes')

      // cronstrue produces "At 30 minutes past the hour" for '30 * * * *'
      expect(parseCronToHumanReadable('30 * * * *')).toContain('30 minutes past the hour')

      // cronstrue produces "At 09:00 AM" for '0 9 * * *'
      expect(parseCronToHumanReadable('0 9 * * *')).toContain('09:00 AM')

      // cronstrue produces "At 02:30 PM" for '30 14 * * *'
      expect(parseCronToHumanReadable('30 14 * * *')).toContain('02:30 PM')

      // cronstrue produces "At 09:00 AM, only on Monday" for '0 9 * * 1'
      expect(parseCronToHumanReadable('0 9 * * 1')).toContain('Monday')

      // cronstrue produces "At 02:30 PM, on day 15 of the month" for '30 14 15 * *'
      expect(parseCronToHumanReadable('30 14 15 * *')).toContain('15')
    })

    it.concurrent('should include timezone information when provided', () => {
      const resultPT = parseCronToHumanReadable('0 9 * * *', 'America/Los_Angeles')
      expect(resultPT).toContain('(PT)')
      expect(resultPT).toContain('09:00 AM')

      const resultET = parseCronToHumanReadable('30 14 * * *', 'America/New_York')
      expect(resultET).toContain('(ET)')
      expect(resultET).toContain('02:30 PM')

      const resultUTC = parseCronToHumanReadable('0 12 * * *', 'UTC')
      expect(resultUTC).not.toContain('(UTC)') // UTC should not be explicitly shown
    })

    it.concurrent('should handle complex patterns with cronstrue', () => {
      // cronstrue can handle complex patterns better than our custom parser
      const result1 = parseCronToHumanReadable('0 9 * * 1-5')
      expect(result1).toContain('Monday through Friday')

      const result2 = parseCronToHumanReadable('0 9 1,15 * *')
      expect(result2).toContain('day 1 and 15')
    })

    it.concurrent('should return a fallback for invalid patterns', () => {
      const result = parseCronToHumanReadable('invalid cron')
      // Should fallback to "Schedule: <expression>"
      expect(result).toContain('Schedule:')
      expect(result).toContain('invalid cron')
    })
  })

  describe('Timezone-aware scheduling with Croner', () => {
    it.concurrent('should calculate daily schedule in Pacific Time correctly', () => {
      const scheduleValues = {
        scheduleTime: '',
        scheduleStartAt: '',
        timezone: 'America/Los_Angeles',
        minutesInterval: 15,
        hourlyMinute: 0,
        dailyTime: [9, 0] as [number, number], // 9 AM Pacific
        weeklyDay: 1,
        weeklyTime: [9, 0] as [number, number],
        monthlyDay: 1,
        monthlyTime: [9, 0] as [number, number],
        cronExpression: null,
      }

      const nextRun = calculateNextRunTime('daily', scheduleValues)

      // 9 AM Pacific should be 16:00 or 17:00 UTC depending on DST
      // Croner handles this automatically
      expect(nextRun instanceof Date).toBe(true)
      expect(nextRun > new Date()).toBe(true)
    })

    it.concurrent('should handle DST transition for schedules', () => {
      // Set a date during DST transition in March
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-03-08T10:00:00.000Z')) // Before DST

      const scheduleValues = {
        scheduleTime: '',
        scheduleStartAt: '',
        timezone: 'America/New_York',
        minutesInterval: 15,
        hourlyMinute: 0,
        dailyTime: [14, 0] as [number, number], // 2 PM Eastern
        weeklyDay: 1,
        weeklyTime: [14, 0] as [number, number],
        monthlyDay: 1,
        monthlyTime: [14, 0] as [number, number],
        cronExpression: null,
      }

      const nextRun = calculateNextRunTime('daily', scheduleValues)

      // Croner should handle DST transition correctly
      expect(nextRun instanceof Date).toBe(true)
      expect(nextRun > new Date()).toBe(true)

      vi.useRealTimers()
    })

    it.concurrent('should calculate weekly schedule in Tokyo timezone', () => {
      const scheduleValues = {
        scheduleTime: '',
        scheduleStartAt: '',
        timezone: 'Asia/Tokyo',
        minutesInterval: 15,
        hourlyMinute: 0,
        dailyTime: [9, 0] as [number, number],
        weeklyDay: 1, // Monday
        weeklyTime: [10, 0] as [number, number], // 10 AM Japan Time
        monthlyDay: 1,
        monthlyTime: [9, 0] as [number, number],
        cronExpression: null,
      }

      const nextRun = calculateNextRunTime('weekly', scheduleValues)

      // Verify it's a valid future date
      // Tokyo is UTC+9, so 10 AM JST = 1 AM UTC
      expect(nextRun instanceof Date).toBe(true)
      expect(nextRun > new Date()).toBe(true)
    })

    it.concurrent('should handle custom cron with timezone', () => {
      const scheduleValues = {
        scheduleTime: '',
        scheduleStartAt: '',
        timezone: 'Europe/London',
        minutesInterval: 15,
        hourlyMinute: 0,
        dailyTime: [9, 0] as [number, number],
        weeklyDay: 1,
        weeklyTime: [9, 0] as [number, number],
        monthlyDay: 1,
        monthlyTime: [9, 0] as [number, number],
        cronExpression: '30 15 * * *', // 3:30 PM London time
      }

      const nextRun = calculateNextRunTime('custom', scheduleValues)

      // Verify it's a valid future date
      expect(nextRun instanceof Date).toBe(true)
      expect(nextRun > new Date()).toBe(true)
    })

    it.concurrent('should handle monthly schedule on last day of month', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2025-02-15T12:00:00.000Z'))

      const scheduleValues = {
        scheduleTime: '',
        scheduleStartAt: '',
        timezone: 'America/Chicago',
        minutesInterval: 15,
        hourlyMinute: 0,
        dailyTime: [9, 0] as [number, number],
        weeklyDay: 1,
        weeklyTime: [9, 0] as [number, number],
        monthlyDay: 28, // Last day of Feb (non-leap year)
        monthlyTime: [12, 0] as [number, number], // Noon Central
        cronExpression: null,
      }

      const nextRun = calculateNextRunTime('monthly', scheduleValues)

      // Should calculate Feb 28 at noon Central time
      expect(nextRun.getUTCDate()).toBe(28)
      expect(nextRun.getUTCMonth()).toBe(1) // February

      vi.useRealTimers()
    })
  })

  describe('createDateWithTimezone', () => {
    it.concurrent('should correctly handle UTC timezone', () => {
      const date = createDateWithTimezone(
        '2025-04-21T00:00:00.000Z',
        '14:00', // 2:00 PM
        'UTC'
      )
      expect(date.toISOString()).toBe('2025-04-21T14:00:00.000Z')
    })

    it.concurrent('should correctly handle America/Los_Angeles (UTC-7 during DST)', () => {
      // April 21, 2025 is during DST for Los Angeles (PDT = UTC-7)
      const date = createDateWithTimezone(
        '2025-04-21', // Using date string without time/zone
        '14:00', // 2:00 PM local time
        'America/Los_Angeles'
      )
      // 2:00 PM PDT should be 21:00 UTC (14 + 7)
      expect(date.toISOString()).toBe('2025-04-21T21:00:00.000Z')
    })

    it.concurrent('should correctly handle America/Los_Angeles (UTC-8 outside DST)', () => {
      // January 10, 2025 is outside DST for Los Angeles (PST = UTC-8)
      const date = createDateWithTimezone(
        '2025-01-10',
        '14:00', // 2:00 PM local time
        'America/Los_Angeles'
      )
      // 2:00 PM PST should be 22:00 UTC (14 + 8)
      expect(date.toISOString()).toBe('2025-01-10T22:00:00.000Z')
    })

    it.concurrent('should correctly handle America/New_York (UTC-4 during DST)', () => {
      // June 15, 2025 is during DST for New York (EDT = UTC-4)
      const date = createDateWithTimezone(
        '2025-06-15',
        '10:30', // 10:30 AM local time
        'America/New_York'
      )
      // 10:30 AM EDT should be 14:30 UTC (10.5 + 4)
      expect(date.toISOString()).toBe('2025-06-15T14:30:00.000Z')
    })

    it.concurrent('should correctly handle America/New_York (UTC-5 outside DST)', () => {
      // December 20, 2025 is outside DST for New York (EST = UTC-5)
      const date = createDateWithTimezone(
        '2025-12-20',
        '10:30', // 10:30 AM local time
        'America/New_York'
      )
      // 10:30 AM EST should be 15:30 UTC (10.5 + 5)
      expect(date.toISOString()).toBe('2025-12-20T15:30:00.000Z')
    })

    it.concurrent('should correctly handle Europe/London (UTC+1 during DST)', () => {
      // August 5, 2025 is during DST for London (BST = UTC+1)
      const date = createDateWithTimezone(
        '2025-08-05',
        '09:15', // 9:15 AM local time
        'Europe/London'
      )
      // 9:15 AM BST should be 08:15 UTC (9.25 - 1)
      expect(date.toISOString()).toBe('2025-08-05T08:15:00.000Z')
    })

    it.concurrent('should correctly handle Europe/London (UTC+0 outside DST)', () => {
      // February 10, 2025 is outside DST for London (GMT = UTC+0)
      const date = createDateWithTimezone(
        '2025-02-10',
        '09:15', // 9:15 AM local time
        'Europe/London'
      )
      // 9:15 AM GMT should be 09:15 UTC (9.25 - 0)
      expect(date.toISOString()).toBe('2025-02-10T09:15:00.000Z')
    })

    it.concurrent('should correctly handle Asia/Tokyo (UTC+9)', () => {
      // Tokyo does not observe DST (JST = UTC+9)
      const date = createDateWithTimezone(
        '2025-07-01',
        '17:00', // 5:00 PM local time
        'Asia/Tokyo'
      )
      // 5:00 PM JST should be 08:00 UTC (17 - 9)
      expect(date.toISOString()).toBe('2025-07-01T08:00:00.000Z')
    })

    it.concurrent('should handle date object input', () => {
      // Using a Date object that represents midnight UTC on the target day
      const dateInput = new Date(Date.UTC(2025, 3, 21)) // April 21, 2025
      const date = createDateWithTimezone(dateInput, '14:00', 'America/Los_Angeles')
      expect(date.toISOString()).toBe('2025-04-21T21:00:00.000Z')
    })

    it.concurrent('should handle time crossing midnight due to timezone offset', () => {
      // Test case: 1:00 AM local time in Sydney (UTC+10/11)
      // This might result in a UTC date that is the *previous* day.
      const date = createDateWithTimezone(
        '2025-10-15', // During DST for Sydney (AEDT = UTC+11)
        '01:00', // 1:00 AM local time
        'Australia/Sydney'
      )
      // 1:00 AM AEDT on Oct 15th should be 14:00 UTC on Oct 14th (1 - 11 = -10 -> previous day 14:00)
      expect(date.toISOString()).toBe('2025-10-14T14:00:00.000Z')
    })
  })
})
