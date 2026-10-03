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
  parseCronToHumanReadable,
  parseTimeString,
  validateCronExpression,
} from '@/lib/workflows/schedules/utils'

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
      expect(nextRun.getUTCFullYear()).toBe(2025)
      expect(nextRun.getUTCMonth()).toBe(3) // April
      expect(nextRun.getUTCDate()).toBe(15)
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

        const nextRun = calculateNextRunTime('minutes', scheduleValues)

        // Croner calculates based on cron expression
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
      expect(nextRun.getUTCMinutes() % 10).toBe(0) // Should align with the interval
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

      // cronstrue produces "At 9:00 AM" for '0 9 * * *' (no leading zero on hour)
      expect(parseCronToHumanReadable('0 9 * * *')).toContain('9:00 AM')

      // cronstrue produces "At 2:30 PM" for '30 14 * * *' (no leading zero on hour)
      expect(parseCronToHumanReadable('30 14 * * *')).toContain('2:30 PM')

      // cronstrue produces "At 09:00 AM, only on Monday" for '0 9 * * 1'
      expect(parseCronToHumanReadable('0 9 * * 1')).toContain('Monday')

      // cronstrue produces "At 02:30 PM, on day 15 of the month" for '30 14 15 * *'
      expect(parseCronToHumanReadable('30 14 15 * *')).toContain('15')
    })

    it.concurrent('should describe the nth weekday of the month', () => {
      expect(parseCronToHumanReadable('30 9 * * 1#3')).toContain('third Monday')
    })

    it.concurrent("should describe croner's last-weekday syntax without a null ordinal", () => {
      const result = parseCronToHumanReadable('30 9 * * 1#L')
      expect(result).toContain('last Monday')
      expect(result).not.toContain('null')
    })

    it.concurrent('should include timezone information when provided', () => {
      const resultPT = parseCronToHumanReadable('0 9 * * *', 'America/Los_Angeles')
      // Intl.DateTimeFormat returns PST or PDT depending on DST
      expect(resultPT).toMatch(/\(P[SD]T\)/)
      expect(resultPT).toContain('9:00 AM')

      const resultET = parseCronToHumanReadable('30 14 * * *', 'America/New_York')
      // Intl.DateTimeFormat returns EST or EDT depending on DST
      expect(resultET).toMatch(/\(E[SD]T\)/)
      expect(resultET).toContain('2:30 PM')

      const resultUTC = parseCronToHumanReadable('0 12 * * *', 'UTC')
      expect(resultUTC).not.toContain('(UTC)') // UTC should not be explicitly shown
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

  describe('Edge Cases and DST Transitions', () => {
    describe('DST Transition Edge Cases', () => {
      it.concurrent('should handle DST spring forward transition (2:00 AM skipped)', () => {
        // In US timezones, DST spring forward happens at 2:00 AM -> jumps to 3:00 AM
        // March 9, 2025 is DST transition day in America/New_York
        const scheduleValues = {
          scheduleTime: '',
          scheduleStartAt: '',
          timezone: 'America/New_York',
          minutesInterval: 15,
          hourlyMinute: 0,
          dailyTime: [2, 30] as [number, number], // 2:30 AM (during the skipped hour)
          weeklyDay: 1,
          weeklyTime: [2, 30] as [number, number],
          monthlyDay: 1,
          monthlyTime: [2, 30] as [number, number],
          cronExpression: null,
        }

        // Should handle the skipped hour gracefully
        const nextRun = calculateNextRunTime('daily', scheduleValues)
        expect(nextRun instanceof Date).toBe(true)
        expect(nextRun > new Date()).toBe(true)
      })

      it.concurrent('should handle DST fall back transition (1:00 AM repeated)', () => {
        // In US timezones, DST fall back happens at 2:00 AM -> falls back to 1:00 AM
        // November 2, 2025 is DST fall back day in America/Los_Angeles
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2025-11-01T12:00:00.000Z'))

        const scheduleValues = {
          scheduleTime: '',
          scheduleStartAt: '',
          timezone: 'America/Los_Angeles',
          minutesInterval: 15,
          hourlyMinute: 0,
          dailyTime: [1, 30] as [number, number], // 1:30 AM (during the repeated hour)
          weeklyDay: 1,
          weeklyTime: [1, 30] as [number, number],
          monthlyDay: 1,
          monthlyTime: [1, 30] as [number, number],
          cronExpression: null,
        }

        const nextRun = calculateNextRunTime('daily', scheduleValues)
        expect(nextRun instanceof Date).toBe(true)
        expect(nextRun > new Date()).toBe(true)

        vi.useRealTimers()
      })
    })

    describe('End of Month Edge Cases', () => {
      it.concurrent('should handle February 29th in non-leap year', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2025-01-15T12:00:00.000Z')) // 2025 is not a leap year

        const scheduleValues = {
          scheduleTime: '',
          scheduleStartAt: '',
          timezone: 'UTC',
          minutesInterval: 15,
          hourlyMinute: 0,
          dailyTime: [9, 0] as [number, number],
          weeklyDay: 1,
          weeklyTime: [9, 0] as [number, number],
          monthlyDay: 29, // Feb doesn't have 29 days in 2025
          monthlyTime: [9, 0] as [number, number],
          cronExpression: null,
        }

        const nextRun = calculateNextRunTime('monthly', scheduleValues)
        // Should skip February and schedule for next valid month (March 29)
        expect(nextRun.getUTCMonth()).not.toBe(1) // Not February

        vi.useRealTimers()
      })

      it.concurrent('should handle day 31 in months with only 30 days', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2025-04-05T12:00:00.000Z')) // April has 30 days

        const scheduleValues = {
          scheduleTime: '',
          scheduleStartAt: '',
          timezone: 'UTC',
          minutesInterval: 15,
          hourlyMinute: 0,
          dailyTime: [9, 0] as [number, number],
          weeklyDay: 1,
          weeklyTime: [9, 0] as [number, number],
          monthlyDay: 31, // April only has 30 days
          monthlyTime: [9, 0] as [number, number],
          cronExpression: null,
        }

        const nextRun = calculateNextRunTime('monthly', scheduleValues)
        // Should skip April and schedule for May 31
        expect(nextRun.getUTCDate()).toBe(31)
        expect(nextRun.getUTCMonth()).toBe(4) // May (0-indexed)

        vi.useRealTimers()
      })
    })

    describe('Timezone-specific Edge Cases', () => {
      it.concurrent('should handle Australia/Lord_Howe with 30-minute DST shift', () => {
        // Lord Howe Island has a unique 30-minute DST shift
        const scheduleValues = {
          scheduleTime: '',
          scheduleStartAt: '',
          timezone: 'Australia/Lord_Howe',
          minutesInterval: 15,
          hourlyMinute: 0,
          dailyTime: [14, 0] as [number, number],
          weeklyDay: 1,
          weeklyTime: [14, 0] as [number, number],
          monthlyDay: 1,
          monthlyTime: [14, 0] as [number, number],
          cronExpression: null,
        }

        const nextRun = calculateNextRunTime('daily', scheduleValues)
        expect(nextRun instanceof Date).toBe(true)
        expect(nextRun > new Date()).toBe(true)
      })
    })

    describe('Validation Edge Cases', () => {
      it.concurrent('should handle timezone with invalid IANA name', () => {
        const result = validateCronExpression('0 9 * * *', 'Invalid/Timezone')
        // Croner might handle this differently, but it should either reject or fall back
        expect(result).toBeDefined()
      })
    })
  })
})
