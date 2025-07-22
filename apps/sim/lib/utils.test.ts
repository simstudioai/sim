import { afterEach, describe, expect, it, vi } from 'vitest'
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
  getInvalidCharacters,
  getTimezoneAbbreviation,
  isValidName,
  redactApiKeys,
  validateName,
} from './utils'

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

vi.mock('@/lib/env', () => ({
  env: {
    ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  },
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('generateApiKey', () => {
  it.concurrent('should generate API key with sim_ prefix', () => {
    const key = generateApiKey()
    expect(key).toMatch(/^sim_/)
  })

  it.concurrent('should generate unique API keys for each call', () => {
    const key1 = generateApiKey()
    const key2 = generateApiKey()
    expect(key1).not.toBe(key2)
  })

  it.concurrent('should generate API keys of correct length', () => {
    const key = generateApiKey()
    // Expected format: 'sim_' + 32 random characters
    expect(key.length).toBe(36)
  })
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

describe('redactApiKeys', () => {
  it.concurrent('should redact API keys in objects', () => {
    const obj = {
      apiKey: 'secret-key',
      api_key: 'another-secret',
      access_token: 'token-value',
      secret: 'secret-value',
      password: 'password-value',
      normalField: 'normal-value',
    }

    const result = redactApiKeys(obj)

    expect(result.apiKey).toBe('***REDACTED***')
    expect(result.api_key).toBe('***REDACTED***')
    expect(result.access_token).toBe('***REDACTED***')
    expect(result.secret).toBe('***REDACTED***')
    expect(result.password).toBe('***REDACTED***')
    expect(result.normalField).toBe('normal-value')
  })

  it.concurrent('should redact API keys in nested objects', () => {
    const obj = {
      config: {
        apiKey: 'secret-key',
        normalField: 'normal-value',
      },
    }

    const result = redactApiKeys(obj)

    expect(result.config.apiKey).toBe('***REDACTED***')
    expect(result.config.normalField).toBe('normal-value')
  })

  it.concurrent('should redact API keys in arrays', () => {
    const arr = [{ apiKey: 'secret-key-1' }, { apiKey: 'secret-key-2' }]

    const result = redactApiKeys(arr)

    expect(result[0].apiKey).toBe('***REDACTED***')
    expect(result[1].apiKey).toBe('***REDACTED***')
  })

  it.concurrent('should handle primitive values', () => {
    expect(redactApiKeys('string')).toBe('string')
    expect(redactApiKeys(123)).toBe(123)
    expect(redactApiKeys(null)).toBe(null)
    expect(redactApiKeys(undefined)).toBe(undefined)
  })

  it.concurrent('should handle complex nested structures', () => {
    const obj = {
      users: [
        {
          name: 'John',
          credentials: {
            apiKey: 'secret-key',
            username: 'john_doe',
          },
        },
      ],
      config: {
        database: {
          password: 'db-password',
          host: 'localhost',
        },
      },
    }

    const result = redactApiKeys(obj)

    expect(result.users[0].name).toBe('John')
    expect(result.users[0].credentials.apiKey).toBe('***REDACTED***')
    expect(result.users[0].credentials.username).toBe('john_doe')
    expect(result.config.database.password).toBe('***REDACTED***')
    expect(result.config.database.host).toBe('localhost')
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
