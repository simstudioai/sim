import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRotatingApiKey } from '@/lib/core/config/api-keys'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { cn } from '@/lib/core/utils/cn'
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatTime,
  getTimezoneAbbreviation,
} from '@/lib/core/utils/formatting'
import { convertScheduleOptionsToCron } from '@/lib/core/utils/scheduling'
import { getInvalidCharacters, isValidName, validateName } from '@/lib/core/utils/validation'

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

vi.mock('@/lib/core/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/core/config/env')>()
  return {
    ...actual,
    env: {
      ...actual.env,
      ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', // fake key for testing
      OPENAI_API_KEY_1: 'test-openai-key-1', // fake key for testing
      OPENAI_API_KEY_2: 'test-openai-key-2', // fake key for testing
      OPENAI_API_KEY_3: 'test-openai-key-3', // fake key for testing
      ANTHROPIC_API_KEY_1: 'test-anthropic-key-1', // fake key for testing
      ANTHROPIC_API_KEY_2: 'test-anthropic-key-2', // fake key for testing
      ANTHROPIC_API_KEY_3: 'test-anthropic-key-3', // fake key for testing
      GEMINI_API_KEY_1: 'test-gemini-key-1', // fake key for testing
      GEMINI_API_KEY_2: 'test-gemini-key-2', // fake key for testing
      GEMINI_API_KEY_3: 'test-gemini-key-3', // fake key for testing
    },
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('cn (class name utility)', () => {
  it.concurrent('should merge class names correctly', () => {
    const result = cn('class1', 'class2')
    expect(result).toBe('class1 class2')
  })

  it.concurrent('should handle conditional classes', () => {
    const isActive = true
    const result = cn('base', isActive && 'active')
    expect(result).toBe('base active')
  })

  it.concurrent('should handle falsy values', () => {
    const result = cn('base', false && 'hidden', null, undefined, 0, '')
    expect(result).toBe('base')
  })

  it.concurrent('should handle arrays of class names', () => {
    const result = cn('base', ['class1', 'class2'])
    expect(result).toContain('base')
    expect(result).toContain('class1')
    expect(result).toContain('class2')
  })
})

describe('encryption and decryption', () => {
  it.concurrent('should encrypt secrets correctly', async () => {
    const result = await encryptSecret('my-secret')
    expect(result).toHaveProperty('encrypted')
    expect(result).toHaveProperty('iv')
    expect(result.encrypted).toContain('random-iv')
    expect(result.encrypted).toContain('encrypted-data')
    expect(result.encrypted).toContain('final-data')
    expect(result.encrypted).toContain('auth-tag')
  })

  it.concurrent('should decrypt secrets correctly', async () => {
    const result = await decryptSecret('iv:encrypted:authTag')
    expect(result).toHaveProperty('decrypted')
    expect(result.decrypted).toBe('decrypted-datafinal-data')
  })

  it.concurrent('should throw error for invalid decrypt format', async () => {
    await expect(decryptSecret('invalid-format')).rejects.toThrow('Invalid encrypted value format')
  })
})

describe('convertScheduleOptionsToCron', () => {
  it.concurrent('should convert minutes schedule to cron', () => {
    const result = convertScheduleOptionsToCron('minutes', { minutesInterval: '5' })
    expect(result).toBe('*/5 * * * *')
  })

  it.concurrent('should convert hourly schedule to cron', () => {
    const result = convertScheduleOptionsToCron('hourly', { hourlyMinute: '30' })
    expect(result).toBe('30 * * * *')
  })

  it.concurrent('should convert daily schedule to cron', () => {
    const result = convertScheduleOptionsToCron('daily', { dailyTime: '15:30' })
    expect(result).toBe('15 30 * * *')
  })

  it.concurrent('should convert weekly schedule to cron', () => {
    const result = convertScheduleOptionsToCron('weekly', {
      weeklyDay: 'MON',
      weeklyDayTime: '09:30',
    })
    expect(result).toBe('09 30 * * 1')
  })

  it.concurrent('should convert monthly schedule to cron', () => {
    const result = convertScheduleOptionsToCron('monthly', {
      monthlyDay: '15',
      monthlyTime: '12:00',
    })
    expect(result).toBe('12 00 15 * *')
  })

  it.concurrent('should use custom cron expression directly', () => {
    const customCron = '*/15 9-17 * * 1-5'
    const result = convertScheduleOptionsToCron('custom', { cronExpression: customCron })
    expect(result).toBe(customCron)
  })

  it.concurrent('should throw error for unsupported schedule type', () => {
    expect(() => convertScheduleOptionsToCron('invalid', {})).toThrow('Unsupported schedule type')
  })

  it.concurrent('should use default values when options are not provided', () => {
    const result = convertScheduleOptionsToCron('daily', {})
    expect(result).toBe('00 09 * * *')
  })
})

describe('date formatting functions', () => {
  it.concurrent('should format datetime correctly', () => {
    const date = new Date('2023-05-15T14:30:00')
    const result = formatDateTime(date)
    expect(result).toMatch(/May 15, 2023/)
    expect(result).toMatch(/2:30 PM|14:30/)
  })

  it.concurrent('should format date correctly', () => {
    const date = new Date('2023-05-15T14:30:00')
    const result = formatDate(date)
    expect(result).toMatch(/May 15, 2023/)
    expect(result).not.toMatch(/2:30|14:30/)
  })

  it.concurrent('should format time correctly', () => {
    const date = new Date('2023-05-15T14:30:00')
    const result = formatTime(date)
    expect(result).toMatch(/2:30 PM|14:30/)
    expect(result).not.toMatch(/2023|May/)
  })
})

describe('formatDuration', () => {
  it.concurrent('should format milliseconds correctly', () => {
    const result = formatDuration(500)
    expect(result).toBe('500ms')
  })

  it.concurrent('should format seconds correctly', () => {
    const result = formatDuration(5000)
    expect(result).toBe('5s')
  })

  it.concurrent('should format minutes and seconds correctly', () => {
    const result = formatDuration(125000) // 2m 5s
    expect(result).toBe('2m 5s')
  })

  it.concurrent('should format hours, minutes correctly', () => {
    const result = formatDuration(3725000) // 1h 2m 5s
    expect(result).toBe('1h 2m')
  })
})

describe('getTimezoneAbbreviation', () => {
  it.concurrent('should return UTC for UTC timezone', () => {
    const result = getTimezoneAbbreviation('UTC')
    expect(result).toBe('UTC')
  })

  it.concurrent('should return PST/PDT for Los Angeles timezone', () => {
    const winterDate = new Date('2023-01-15') // Standard time
    const summerDate = new Date('2023-07-15') // Daylight time

    const winterResult = getTimezoneAbbreviation('America/Los_Angeles', winterDate)
    const summerResult = getTimezoneAbbreviation('America/Los_Angeles', summerDate)

    expect(['PST', 'PDT']).toContain(winterResult)
    expect(['PST', 'PDT']).toContain(summerResult)
  })

  it.concurrent('should return JST for Tokyo timezone (no DST)', () => {
    const winterDate = new Date('2023-01-15')
    const summerDate = new Date('2023-07-15')

    const winterResult = getTimezoneAbbreviation('Asia/Tokyo', winterDate)
    const summerResult = getTimezoneAbbreviation('Asia/Tokyo', summerDate)

    expect(winterResult).toBe('JST')
    expect(summerResult).toBe('JST')
  })

  it.concurrent('should return full timezone name for unknown timezones', () => {
    const result = getTimezoneAbbreviation('Unknown/Timezone')
    expect(result).toBe('Unknown/Timezone')
  })
})

describe('validateName', () => {
  it.concurrent('should remove invalid characters', () => {
    const result = validateName('test@#$%name')
    expect(result).toBe('testname')
  })

  it.concurrent('should keep valid characters', () => {
    const result = validateName('test_name_123')
    expect(result).toBe('test_name_123')
  })

  it.concurrent('should keep spaces', () => {
    const result = validateName('test name')
    expect(result).toBe('test name')
  })

  it.concurrent('should handle empty string', () => {
    const result = validateName('')
    expect(result).toBe('')
  })

  it.concurrent('should handle string with only invalid characters', () => {
    const result = validateName('@#$%')
    expect(result).toBe('')
  })

  it.concurrent('should handle mixed valid and invalid characters', () => {
    const result = validateName('my-workflow@2023!')
    expect(result).toBe('myworkflow2023')
  })

  it.concurrent('should collapse multiple spaces into single spaces', () => {
    const result = validateName('test    multiple     spaces')
    expect(result).toBe('test multiple spaces')
  })

  it.concurrent('should handle mixed whitespace and invalid characters', () => {
    const result = validateName('test@#$  name')
    expect(result).toBe('test name')
  })
})

describe('isValidName', () => {
  it.concurrent('should return true for valid names', () => {
    expect(isValidName('test_name')).toBe(true)
    expect(isValidName('test123')).toBe(true)
    expect(isValidName('test name')).toBe(true)
    expect(isValidName('TestName')).toBe(true)
    expect(isValidName('')).toBe(true)
  })

  it.concurrent('should return false for invalid names', () => {
    expect(isValidName('test@name')).toBe(false)
    expect(isValidName('test-name')).toBe(false)
    expect(isValidName('test#name')).toBe(false)
    expect(isValidName('test$name')).toBe(false)
    expect(isValidName('test%name')).toBe(false)
  })
})

describe('getInvalidCharacters', () => {
  it.concurrent('should return empty array for valid names', () => {
    const result = getInvalidCharacters('test_name_123')
    expect(result).toEqual([])
  })

  it.concurrent('should return invalid characters', () => {
    const result = getInvalidCharacters('test@#$name')
    expect(result).toEqual(['@', '#', '$'])
  })

  it.concurrent('should return unique invalid characters', () => {
    const result = getInvalidCharacters('test@@##name')
    expect(result).toEqual(['@', '#'])
  })

  it.concurrent('should handle empty string', () => {
    const result = getInvalidCharacters('')
    expect(result).toEqual([])
  })

  it.concurrent('should handle string with only invalid characters', () => {
    const result = getInvalidCharacters('@#$%')
    expect(result).toEqual(['@', '#', '$', '%'])
  })
})

describe('getRotatingApiKey', () => {
  it.concurrent('should return OpenAI API key based on current minute', () => {
    const result = getRotatingApiKey('openai')
    expect(result).toMatch(/^test-openai-key-[1-3]$/)
  })

  it.concurrent('should return Anthropic API key based on current minute', () => {
    const result = getRotatingApiKey('anthropic')
    expect(result).toMatch(/^test-anthropic-key-[1-3]$/)
  })

  it.concurrent('should return Gemini API key based on current minute', () => {
    const result = getRotatingApiKey('gemini')
    expect(result).toMatch(/^test-gemini-key-[1-3]$/)
  })

  it.concurrent('should throw error for unsupported provider', () => {
    expect(() => getRotatingApiKey('unsupported')).toThrow('No rotation implemented for provider')
  })

  it.concurrent('should rotate keys based on minute modulo', () => {
    const result = getRotatingApiKey('openai')
    expect(['test-openai-key-1', 'test-openai-key-2', 'test-openai-key-3']).toContain(result)
  })
})
