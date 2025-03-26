import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cn,
  convertScheduleOptionsToCron,
  decryptSecret,
  encryptSecret,
  formatDate,
  formatDateTime,
  formatDuration,
  formatTime,
  generateApiKey,
} from './utils'

// Mock crypto module for encryption/decryption tests
vi.mock('crypto', () => ({
  createCipheriv: vi.fn().mockReturnValue({
    update: vi.fn().mockReturnValue('encrypted-data'),
    final: vi.fn().mockReturnValue('final-data'),
    getAuthTag: vi.fn().mockReturnValue({
      toString: vi.fn().mockReturnValue('auth-tag'),
    }),
  }),
  createDecipheriv: vi.fn().mockReturnValue({
    update: vi.fn().mockReturnValue('decrypted-data'),
    final: vi.fn().mockReturnValue('final-data'),
    setAuthTag: vi.fn(),
  }),
  randomBytes: vi.fn().mockReturnValue({
    toString: vi.fn().mockReturnValue('random-iv'),
  }),
}))

// Mock environment variables for encryption key
beforeEach(() => {
  process.env.ENCRYPTION_KEY = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('generateApiKey', () => {
  it('should generate API key with sim_ prefix', () => {
    const key = generateApiKey()
    expect(key).toMatch(/^sim_/)
  })

  it('should generate unique API keys for each call', () => {
    const key1 = generateApiKey()
    const key2 = generateApiKey()
    expect(key1).not.toBe(key2)
  })

  it('should generate API keys of correct length', () => {
    const key = generateApiKey()
    // Expected format: 'sim_' + 32 random characters
    expect(key.length).toBe(36)
  })
})

describe('cn (class name utility)', () => {
  it('should merge class names correctly', () => {
    const result = cn('class1', 'class2')
    expect(result).toBe('class1 class2')
  })

  it('should handle conditional classes', () => {
    const isActive = true
    const result = cn('base', isActive && 'active')
    expect(result).toBe('base active')
  })

  it('should handle falsy values', () => {
    const result = cn('base', false && 'hidden', null, undefined, 0, '')
    expect(result).toBe('base')
  })

  it('should handle arrays of class names', () => {
    const result = cn('base', ['class1', 'class2'])
    expect(result).toContain('base')
    expect(result).toContain('class1')
    expect(result).toContain('class2')
  })
})

describe('encryption and decryption', () => {
  it('should encrypt secrets correctly', async () => {
    const result = await encryptSecret('my-secret')
    expect(result).toHaveProperty('encrypted')
    expect(result).toHaveProperty('iv')
    expect(result.encrypted).toContain('random-iv')
    expect(result.encrypted).toContain('encrypted-data')
    expect(result.encrypted).toContain('final-data')
    expect(result.encrypted).toContain('auth-tag')
  })

  it('should decrypt secrets correctly', async () => {
    const result = await decryptSecret('iv:encrypted:authTag')
    expect(result).toHaveProperty('decrypted')
    expect(result.decrypted).toBe('decrypted-datafinal-data')
  })

  it('should throw error for invalid decrypt format', async () => {
    await expect(decryptSecret('invalid-format')).rejects.toThrow('Invalid encrypted value format')
  })
})

describe('convertScheduleOptionsToCron', () => {
  it('should convert minutes schedule to cron', () => {
    const result = convertScheduleOptionsToCron('minutes', { minutesInterval: '5' })
    expect(result).toBe('*/5 * * * *')
  })

  it('should convert hourly schedule to cron', () => {
    const result = convertScheduleOptionsToCron('hourly', { hourlyMinute: '30' })
    expect(result).toBe('30 * * * *')
  })

  it('should convert daily schedule to cron', () => {
    const result = convertScheduleOptionsToCron('daily', { dailyTime: '15:30' })
    expect(result).toBe('15 30 * * *')
  })

  it('should convert weekly schedule to cron', () => {
    const result = convertScheduleOptionsToCron('weekly', {
      weeklyDay: 'MON',
      weeklyDayTime: '09:30',
    })
    expect(result).toBe('09 30 * * 1')
  })

  it('should convert monthly schedule to cron', () => {
    const result = convertScheduleOptionsToCron('monthly', {
      monthlyDay: '15',
      monthlyTime: '12:00',
    })
    expect(result).toBe('12 00 15 * *')
  })

  it('should use custom cron expression directly', () => {
    const customCron = '*/15 9-17 * * 1-5'
    const result = convertScheduleOptionsToCron('custom', { cronExpression: customCron })
    expect(result).toBe(customCron)
  })

  it('should throw error for unsupported schedule type', () => {
    expect(() => convertScheduleOptionsToCron('invalid', {})).toThrow('Unsupported schedule type')
  })

  it('should use default values when options are not provided', () => {
    const result = convertScheduleOptionsToCron('daily', {})
    expect(result).toBe('00 09 * * *')
  })
})

describe('date formatting functions', () => {
  it('should format datetime correctly', () => {
    const date = new Date('2023-05-15T14:30:00')
    const result = formatDateTime(date)
    expect(result).toMatch(/May 15, 2023/)
    expect(result).toMatch(/2:30 PM|14:30/)
  })

  it('should format date correctly', () => {
    const date = new Date('2023-05-15T14:30:00')
    const result = formatDate(date)
    expect(result).toMatch(/May 15, 2023/)
    expect(result).not.toMatch(/2:30|14:30/)
  })

  it('should format time correctly', () => {
    const date = new Date('2023-05-15T14:30:00')
    const result = formatTime(date)
    expect(result).toMatch(/2:30 PM|14:30/)
    expect(result).not.toMatch(/2023|May/)
  })
})

describe('formatDuration', () => {
  it('should format milliseconds correctly', () => {
    const result = formatDuration(500)
    expect(result).toBe('500ms')
  })

  it('should format seconds correctly', () => {
    const result = formatDuration(5000)
    expect(result).toBe('5s')
  })

  it('should format minutes and seconds correctly', () => {
    const result = formatDuration(125000) // 2m 5s
    expect(result).toBe('2m 5s')
  })

  it('should format hours, minutes correctly', () => {
    const result = formatDuration(3725000) // 1h 2m 5s
    expect(result).toBe('1h 2m')
  })
})
