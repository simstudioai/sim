import { describe, expect, it } from 'vitest'
import {
  sanitizeForLogging,
  validateAlphanumericId,
  validateEnum,
  validateFileExtension,
  validateHostname,
  validateNumericId,
  validatePathSegment,
  validateUUID,
} from './input-validation'

describe('validatePathSegment', () => {
  describe('valid inputs', () => {
    it.concurrent('should accept alphanumeric strings', () => {
      const result = validatePathSegment('abc123')
      expect(result.isValid).toBe(true)
      expect(result.sanitized).toBe('abc123')
    })

    it.concurrent('should accept strings with hyphens', () => {
      const result = validatePathSegment('test-item-123')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept strings with underscores', () => {
      const result = validatePathSegment('test_item_123')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept strings with hyphens and underscores', () => {
      const result = validatePathSegment('test-item_123')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept dots when allowDots is true', () => {
      const result = validatePathSegment('file.name.txt', { allowDots: true })
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept custom patterns', () => {
      const result = validatePathSegment('v1.2.3', {
        customPattern: /^v\d+\.\d+\.\d+$/,
      })
      expect(result.isValid).toBe(true)
    })
  })

  describe('invalid inputs - null/empty', () => {
    it.concurrent('should reject null', () => {
      const result = validatePathSegment(null)
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('required')
    })

    it.concurrent('should reject undefined', () => {
      const result = validatePathSegment(undefined)
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('required')
    })

    it.concurrent('should reject empty string', () => {
      const result = validatePathSegment('')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('required')
    })
  })

  describe('invalid inputs - path traversal', () => {
    it.concurrent('should reject path traversal with ../', () => {
      const result = validatePathSegment('../etc/passwd')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('path traversal')
    })

    it.concurrent('should reject path traversal with ..\\', () => {
      const result = validatePathSegment('..\\windows\\system32')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('path traversal')
    })

    it.concurrent('should reject URL-encoded path traversal %2e%2e', () => {
      const result = validatePathSegment('%2e%2e%2f')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('path traversal')
    })

    it.concurrent('should reject double URL-encoded path traversal', () => {
      const result = validatePathSegment('%252e%252e')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('path traversal')
    })

    it.concurrent('should reject mixed case path traversal attempts', () => {
      const result = validatePathSegment('..%2F')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('path traversal')
    })

    it.concurrent('should reject dots in path by default', () => {
      const result = validatePathSegment('..')
      expect(result.isValid).toBe(false)
    })
  })

  describe('invalid inputs - directory separators', () => {
    it.concurrent('should reject forward slashes', () => {
      const result = validatePathSegment('path/to/file')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('directory separator')
    })

    it.concurrent('should reject backslashes', () => {
      const result = validatePathSegment('path\\to\\file')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('directory separator')
    })
  })

  describe('invalid inputs - null bytes', () => {
    it.concurrent('should reject null bytes', () => {
      const result = validatePathSegment('file\0name')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('invalid characters')
    })

    it.concurrent('should reject URL-encoded null bytes', () => {
      const result = validatePathSegment('file%00name')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('invalid characters')
    })
  })

  describe('invalid inputs - special characters', () => {
    it.concurrent('should reject special characters by default', () => {
      const result = validatePathSegment('file@name')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject dots by default', () => {
      const result = validatePathSegment('file.txt')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject spaces', () => {
      const result = validatePathSegment('file name')
      expect(result.isValid).toBe(false)
    })
  })

  describe('options', () => {
    it.concurrent('should reject strings exceeding maxLength', () => {
      const longString = 'a'.repeat(300)
      const result = validatePathSegment(longString, { maxLength: 255 })
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('exceeds maximum length')
    })

    it.concurrent('should use custom param name in errors', () => {
      const result = validatePathSegment('', { paramName: 'itemId' })
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('itemId')
    })

    it.concurrent('should reject hyphens when allowHyphens is false', () => {
      const result = validatePathSegment('test-item', { allowHyphens: false })
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject underscores when allowUnderscores is false', () => {
      const result = validatePathSegment('test_item', {
        allowUnderscores: false,
      })
      expect(result.isValid).toBe(false)
    })
  })

  describe('custom patterns', () => {
    it.concurrent('should validate against custom pattern', () => {
      const result = validatePathSegment('ABC-123', {
        customPattern: /^[A-Z]{3}-\d{3}$/,
      })
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should reject when custom pattern does not match', () => {
      const result = validatePathSegment('ABC123', {
        customPattern: /^[A-Z]{3}-\d{3}$/,
      })
      expect(result.isValid).toBe(false)
    })
  })
})

describe('validateUUID', () => {
  describe('valid UUIDs', () => {
    it.concurrent('should accept valid UUID v4', () => {
      const result = validateUUID('550e8400-e29b-41d4-a716-446655440000')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept UUID with uppercase letters', () => {
      const result = validateUUID('550E8400-E29B-41D4-A716-446655440000')
      expect(result.isValid).toBe(true)
      expect(result.sanitized).toBe('550e8400-e29b-41d4-a716-446655440000')
    })

    it.concurrent('should normalize UUID to lowercase', () => {
      const result = validateUUID('550E8400-E29B-41D4-A716-446655440000')
      expect(result.sanitized).toBe('550e8400-e29b-41d4-a716-446655440000')
    })
  })

  describe('invalid UUIDs', () => {
    it.concurrent('should reject non-UUID strings', () => {
      const result = validateUUID('not-a-uuid')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('valid UUID')
    })

    it.concurrent('should reject UUID with wrong version', () => {
      const result = validateUUID('550e8400-e29b-31d4-a716-446655440000') // version 3
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject UUID with wrong variant', () => {
      const result = validateUUID('550e8400-e29b-41d4-1716-446655440000') // wrong variant
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject empty string', () => {
      const result = validateUUID('')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject null', () => {
      const result = validateUUID(null)
      expect(result.isValid).toBe(false)
    })
  })
})

describe('validateAlphanumericId', () => {
  it.concurrent('should accept alphanumeric IDs', () => {
    const result = validateAlphanumericId('user123')
    expect(result.isValid).toBe(true)
  })

  it.concurrent('should accept IDs with hyphens and underscores', () => {
    const result = validateAlphanumericId('user-id_123')
    expect(result.isValid).toBe(true)
  })

  it.concurrent('should reject IDs with special characters', () => {
    const result = validateAlphanumericId('user@123')
    expect(result.isValid).toBe(false)
  })

  it.concurrent('should reject IDs exceeding maxLength', () => {
    const longId = 'a'.repeat(150)
    const result = validateAlphanumericId(longId, 'userId', 100)
    expect(result.isValid).toBe(false)
  })

  it.concurrent('should use custom param name in errors', () => {
    const result = validateAlphanumericId('', 'customId')
    expect(result.error).toContain('customId')
  })
})

describe('validateNumericId', () => {
  describe('valid numeric IDs', () => {
    it.concurrent('should accept numeric strings', () => {
      const result = validateNumericId('123')
      expect(result.isValid).toBe(true)
      expect(result.sanitized).toBe('123')
    })

    it.concurrent('should accept numbers', () => {
      const result = validateNumericId(456)
      expect(result.isValid).toBe(true)
      expect(result.sanitized).toBe('456')
    })

    it.concurrent('should accept zero', () => {
      const result = validateNumericId(0)
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept negative numbers', () => {
      const result = validateNumericId(-5)
      expect(result.isValid).toBe(true)
    })
  })

  describe('invalid numeric IDs', () => {
    it.concurrent('should reject non-numeric strings', () => {
      const result = validateNumericId('abc')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('valid number')
    })

    it.concurrent('should reject null', () => {
      const result = validateNumericId(null)
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject empty string', () => {
      const result = validateNumericId('')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject NaN', () => {
      const result = validateNumericId(Number.NaN)
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject Infinity', () => {
      const result = validateNumericId(Number.POSITIVE_INFINITY)
      expect(result.isValid).toBe(false)
    })
  })

  describe('min/max constraints', () => {
    it.concurrent('should accept values within range', () => {
      const result = validateNumericId(50, 'value', { min: 1, max: 100 })
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should reject values below min', () => {
      const result = validateNumericId(0, 'value', { min: 1 })
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('at least 1')
    })

    it.concurrent('should reject values above max', () => {
      const result = validateNumericId(101, 'value', { max: 100 })
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('at most 100')
    })

    it.concurrent('should accept value equal to min', () => {
      const result = validateNumericId(1, 'value', { min: 1 })
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept value equal to max', () => {
      const result = validateNumericId(100, 'value', { max: 100 })
      expect(result.isValid).toBe(true)
    })
  })
})

describe('validateEnum', () => {
  const allowedTypes = ['note', 'contact', 'task'] as const

  describe('valid enum values', () => {
    it.concurrent('should accept values in the allowed list', () => {
      const result = validateEnum('note', allowedTypes, 'type')
      expect(result.isValid).toBe(true)
      expect(result.sanitized).toBe('note')
    })

    it.concurrent('should accept all values in the list', () => {
      for (const type of allowedTypes) {
        const result = validateEnum(type, allowedTypes)
        expect(result.isValid).toBe(true)
      }
    })
  })

  describe('invalid enum values', () => {
    it.concurrent('should reject values not in the allowed list', () => {
      const result = validateEnum('invalid', allowedTypes, 'type')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('note, contact, task')
    })

    it.concurrent('should reject case-mismatched values', () => {
      const result = validateEnum('Note', allowedTypes, 'type')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject null', () => {
      const result = validateEnum(null, allowedTypes)
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject empty string', () => {
      const result = validateEnum('', allowedTypes)
      expect(result.isValid).toBe(false)
    })
  })

  describe('error messages', () => {
    it.concurrent('should include param name in error', () => {
      const result = validateEnum('invalid', allowedTypes, 'itemType')
      expect(result.error).toContain('itemType')
    })

    it.concurrent('should list all allowed values in error', () => {
      const result = validateEnum('invalid', allowedTypes)
      expect(result.error).toContain('note')
      expect(result.error).toContain('contact')
      expect(result.error).toContain('task')
    })
  })
})

describe('validateHostname', () => {
  describe('valid hostnames', () => {
    it.concurrent('should accept valid domain names', () => {
      const result = validateHostname('example.com')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept subdomains', () => {
      const result = validateHostname('api.example.com')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept domains with hyphens', () => {
      const result = validateHostname('my-domain.com')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept multi-level domains', () => {
      const result = validateHostname('api.v2.example.co.uk')
      expect(result.isValid).toBe(true)
    })
  })

  describe('invalid hostnames - private IPs', () => {
    it.concurrent('should reject localhost', () => {
      const result = validateHostname('localhost')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('private IP')
    })

    it.concurrent('should reject 127.0.0.1', () => {
      const result = validateHostname('127.0.0.1')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject 10.x.x.x private range', () => {
      const result = validateHostname('10.0.0.1')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject 192.168.x.x private range', () => {
      const result = validateHostname('192.168.1.1')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject 172.16-31.x.x private range', () => {
      const result = validateHostname('172.16.0.1')
      expect(result.isValid).toBe(false)
      const result2 = validateHostname('172.31.255.255')
      expect(result2.isValid).toBe(false)
    })

    it.concurrent('should reject link-local addresses', () => {
      const result = validateHostname('169.254.169.254')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject IPv6 loopback', () => {
      const result = validateHostname('::1')
      expect(result.isValid).toBe(false)
    })
  })

  describe('invalid hostnames - format', () => {
    it.concurrent('should reject invalid characters', () => {
      const result = validateHostname('example_domain.com')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject hostnames starting with hyphen', () => {
      const result = validateHostname('-example.com')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject hostnames ending with hyphen', () => {
      const result = validateHostname('example-.com')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject empty string', () => {
      const result = validateHostname('')
      expect(result.isValid).toBe(false)
    })
  })
})

describe('validateFileExtension', () => {
  const allowedExtensions = ['jpg', 'png', 'gif', 'pdf'] as const

  describe('valid extensions', () => {
    it.concurrent('should accept allowed extensions', () => {
      const result = validateFileExtension('jpg', allowedExtensions)
      expect(result.isValid).toBe(true)
      expect(result.sanitized).toBe('jpg')
    })

    it.concurrent('should accept extensions with leading dot', () => {
      const result = validateFileExtension('.png', allowedExtensions)
      expect(result.isValid).toBe(true)
      expect(result.sanitized).toBe('png')
    })

    it.concurrent('should normalize to lowercase', () => {
      const result = validateFileExtension('JPG', allowedExtensions)
      expect(result.isValid).toBe(true)
      expect(result.sanitized).toBe('jpg')
    })

    it.concurrent('should accept all allowed extensions', () => {
      for (const ext of allowedExtensions) {
        const result = validateFileExtension(ext, allowedExtensions)
        expect(result.isValid).toBe(true)
      }
    })
  })

  describe('invalid extensions', () => {
    it.concurrent('should reject extensions not in allowed list', () => {
      const result = validateFileExtension('exe', allowedExtensions)
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('jpg, png, gif, pdf')
    })

    it.concurrent('should reject empty string', () => {
      const result = validateFileExtension('', allowedExtensions)
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject null', () => {
      const result = validateFileExtension(null, allowedExtensions)
      expect(result.isValid).toBe(false)
    })
  })
})

describe('sanitizeForLogging', () => {
  it.concurrent('should truncate long strings', () => {
    const longString = 'a'.repeat(200)
    const result = sanitizeForLogging(longString, 50)
    expect(result.length).toBe(50)
  })

  it.concurrent('should mask Bearer tokens', () => {
    const input = 'Authorization: Bearer abc123xyz'
    const result = sanitizeForLogging(input)
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('abc123xyz')
  })

  it.concurrent('should mask password fields', () => {
    const input = 'password: "secret123"'
    const result = sanitizeForLogging(input)
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('secret123')
  })

  it.concurrent('should mask token fields', () => {
    const input = 'token: "tokenvalue"'
    const result = sanitizeForLogging(input)
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('tokenvalue')
  })

  it.concurrent('should mask API keys', () => {
    const input = 'api_key: "key123"'
    const result = sanitizeForLogging(input)
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('key123')
  })

  it.concurrent('should handle empty strings', () => {
    const result = sanitizeForLogging('')
    expect(result).toBe('')
  })

  it.concurrent('should not modify safe strings', () => {
    const input = 'This is a safe string'
    const result = sanitizeForLogging(input)
    expect(result).toBe(input)
  })
})
