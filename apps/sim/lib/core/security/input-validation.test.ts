import { loggerMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'
import {
  validateAirtableId,
  validateAlphanumericId,
  validateAwsRegion,
  validateEnum,
  validateExternalUrl,
  validateFileExtension,
  validateGoogleCalendarId,
  validateHostname,
  validateImageUrl,
  validateInteger,
  validateJiraCloudId,
  validateJiraIssueKey,
  validateMicrosoftGraphId,
  validateNumericId,
  validatePathSegment,
  validateProxyUrl,
  validateS3BucketName,
} from '@/lib/core/security/input-validation'
import { validateUrlWithDNS } from '@/lib/core/security/input-validation.server'
import { sanitizeForLogging } from '@/lib/core/security/redaction'

vi.mock('@sim/logger', () => loggerMock)

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

describe('validateUrlWithDNS', () => {
  describe('basic validation', () => {
    it('should reject invalid URLs', async () => {
      const result = await validateUrlWithDNS('not-a-url')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('valid URL')
    })

    it('should reject http:// URLs', async () => {
      const result = await validateUrlWithDNS('http://example.com')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('https://')
    })

    it('should reject localhost URLs', async () => {
      const result = await validateUrlWithDNS('https://localhost/api')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('localhost')
    })

    it('should reject private IP URLs', async () => {
      const result = await validateUrlWithDNS('https://192.168.1.1/api')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('private IP')
    })

    it('should reject null', async () => {
      const result = await validateUrlWithDNS(null)
      expect(result.isValid).toBe(false)
    })

    it('should reject empty string', async () => {
      const result = await validateUrlWithDNS('')
      expect(result.isValid).toBe(false)
    })
  })
})

describe('validateInteger', () => {
  describe('valid integers', () => {
    it.concurrent('should accept positive integers', () => {
      const result = validateInteger(42, 'count')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept zero', () => {
      const result = validateInteger(0, 'count')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept negative integers', () => {
      const result = validateInteger(-10, 'offset')
      expect(result.isValid).toBe(true)
    })
  })

  describe('invalid integers', () => {
    it.concurrent('should reject null', () => {
      const result = validateInteger(null, 'value')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('required')
    })

    it.concurrent('should reject undefined', () => {
      const result = validateInteger(undefined, 'value')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('required')
    })

    it.concurrent('should reject strings', () => {
      const result = validateInteger('42' as any, 'value')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('must be a number')
    })

    it.concurrent('should reject floating point numbers', () => {
      const result = validateInteger(3.14, 'value')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('must be an integer')
    })

    it.concurrent('should reject NaN', () => {
      const result = validateInteger(Number.NaN, 'value')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('valid number')
    })

    it.concurrent('should reject Infinity', () => {
      const result = validateInteger(Number.POSITIVE_INFINITY, 'value')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('valid number')
    })

    it.concurrent('should reject negative Infinity', () => {
      const result = validateInteger(Number.NEGATIVE_INFINITY, 'value')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('valid number')
    })
  })

  describe('min/max constraints', () => {
    it.concurrent('should accept values within range', () => {
      const result = validateInteger(50, 'value', { min: 0, max: 100 })
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should reject values below min', () => {
      const result = validateInteger(-1, 'value', { min: 0 })
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('at least 0')
    })

    it.concurrent('should reject values above max', () => {
      const result = validateInteger(101, 'value', { max: 100 })
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('at most 100')
    })

    it.concurrent('should accept value equal to min', () => {
      const result = validateInteger(0, 'value', { min: 0 })
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept value equal to max', () => {
      const result = validateInteger(100, 'value', { max: 100 })
      expect(result.isValid).toBe(true)
    })
  })
})

describe('validateMicrosoftGraphId', () => {
  describe('valid IDs', () => {
    it.concurrent('should accept simple alphanumeric IDs', () => {
      const result = validateMicrosoftGraphId('abc123')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept GUIDs', () => {
      const result = validateMicrosoftGraphId('12345678-1234-1234-1234-123456789012')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept "root" literal', () => {
      const result = validateMicrosoftGraphId('root')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept complex SharePoint paths', () => {
      const result = validateMicrosoftGraphId('hostname:/sites/sitename')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept group paths', () => {
      const result = validateMicrosoftGraphId('groups/abc123/sites/root')
      expect(result.isValid).toBe(true)
    })
  })

  describe('invalid IDs', () => {
    it.concurrent('should reject null', () => {
      const result = validateMicrosoftGraphId(null)
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('required')
    })

    it.concurrent('should reject empty string', () => {
      const result = validateMicrosoftGraphId('')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('required')
    })

    it.concurrent('should reject path traversal ../)', () => {
      const result = validateMicrosoftGraphId('../etc/passwd')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('path traversal')
    })

    it.concurrent('should reject URL-encoded path traversal', () => {
      const result = validateMicrosoftGraphId('%2e%2e%2f')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('path traversal')
    })

    it.concurrent('should reject double-encoded path traversal', () => {
      const result = validateMicrosoftGraphId('%252e%252e%252f')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('path traversal')
    })

    it.concurrent('should reject null bytes', () => {
      const result = validateMicrosoftGraphId('test\0value')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('control characters')
    })

    it.concurrent('should reject URL-encoded null bytes', () => {
      const result = validateMicrosoftGraphId('test%00value')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('control characters')
    })

    it.concurrent('should reject newline characters', () => {
      const result = validateMicrosoftGraphId('test\nvalue')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('control characters')
    })

    it.concurrent('should reject carriage return characters', () => {
      const result = validateMicrosoftGraphId('test\rvalue')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('control characters')
    })
  })
})

describe('validateJiraCloudId', () => {
  describe('valid IDs', () => {
    it.concurrent('should accept alphanumeric IDs', () => {
      const result = validateJiraCloudId('abc123')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept IDs with hyphens', () => {
      const result = validateJiraCloudId('12345678-1234-1234-1234-123456789012')
      expect(result.isValid).toBe(true)
    })
  })

  describe('invalid IDs', () => {
    it.concurrent('should reject null', () => {
      const result = validateJiraCloudId(null)
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject empty string', () => {
      const result = validateJiraCloudId('')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject path traversal', () => {
      const result = validateJiraCloudId('../etc')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject dots', () => {
      const result = validateJiraCloudId('test.value')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject underscores', () => {
      const result = validateJiraCloudId('test_value')
      expect(result.isValid).toBe(false)
    })
  })
})

describe('validateJiraIssueKey', () => {
  describe('valid issue keys', () => {
    it.concurrent('should accept PROJECT-123 format', () => {
      const result = validateJiraIssueKey('PROJECT-123')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept lowercase keys', () => {
      const result = validateJiraIssueKey('proj-456')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept mixed case', () => {
      const result = validateJiraIssueKey('MyProject-789')
      expect(result.isValid).toBe(true)
    })
  })

  describe('invalid issue keys', () => {
    it.concurrent('should reject null', () => {
      const result = validateJiraIssueKey(null)
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject empty string', () => {
      const result = validateJiraIssueKey('')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject path traversal', () => {
      const result = validateJiraIssueKey('../etc')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject dots', () => {
      const result = validateJiraIssueKey('PROJECT.123')
      expect(result.isValid).toBe(false)
    })
  })
})

describe('validateExternalUrl', () => {
  describe('valid URLs', () => {
    it.concurrent('should accept https URLs', () => {
      const result = validateExternalUrl('https://example.com')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept URLs with paths', () => {
      const result = validateExternalUrl('https://api.example.com/v1/data')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept URLs with query strings', () => {
      const result = validateExternalUrl('https://example.com?foo=bar')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept URLs with standard ports', () => {
      const result = validateExternalUrl('https://example.com:443/api')
      expect(result.isValid).toBe(true)
    })
  })

  describe('invalid URLs', () => {
    it.concurrent('should reject null', () => {
      const result = validateExternalUrl(null)
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('required')
    })

    it.concurrent('should reject empty string', () => {
      const result = validateExternalUrl('')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject http URLs', () => {
      const result = validateExternalUrl('http://example.com')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('https://')
    })

    it.concurrent('should reject invalid URLs', () => {
      const result = validateExternalUrl('not-a-url')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('valid URL')
    })

    it.concurrent('should reject localhost', () => {
      const result = validateExternalUrl('https://localhost/api')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('localhost')
    })

    it.concurrent('should reject 127.0.0.1', () => {
      const result = validateExternalUrl('https://127.0.0.1/api')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('private IP')
    })

    it.concurrent('should reject 0.0.0.0', () => {
      const result = validateExternalUrl('https://0.0.0.0/api')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('private IP')
    })
  })

  describe('private IP ranges', () => {
    it.concurrent('should reject 10.x.x.x', () => {
      const result = validateExternalUrl('https://10.0.0.1/api')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('private IP')
    })

    it.concurrent('should reject 172.16.x.x', () => {
      const result = validateExternalUrl('https://172.16.0.1/api')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('private IP')
    })

    it.concurrent('should reject 192.168.x.x', () => {
      const result = validateExternalUrl('https://192.168.1.1/api')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('private IP')
    })

    it.concurrent('should reject link-local 169.254.x.x', () => {
      const result = validateExternalUrl('https://169.254.169.254/api')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('private IP')
    })
  })

  describe('blocked ports', () => {
    it.concurrent('should reject SSH port 22', () => {
      const result = validateExternalUrl('https://example.com:22/api')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('blocked port')
    })

    it.concurrent('should reject MySQL port 3306', () => {
      const result = validateExternalUrl('https://example.com:3306/api')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('blocked port')
    })

    it.concurrent('should reject PostgreSQL port 5432', () => {
      const result = validateExternalUrl('https://example.com:5432/api')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('blocked port')
    })

    it.concurrent('should reject Redis port 6379', () => {
      const result = validateExternalUrl('https://example.com:6379/api')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('blocked port')
    })

    it.concurrent('should reject MongoDB port 27017', () => {
      const result = validateExternalUrl('https://example.com:27017/api')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('blocked port')
    })

    it.concurrent('should reject Elasticsearch port 9200', () => {
      const result = validateExternalUrl('https://example.com:9200/api')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('blocked port')
    })
  })
})

describe('validateImageUrl', () => {
  it.concurrent('should accept valid image URLs', () => {
    const result = validateImageUrl('https://example.com/image.png')
    expect(result.isValid).toBe(true)
  })

  it.concurrent('should reject localhost URLs', () => {
    const result = validateImageUrl('https://localhost/image.png')
    expect(result.isValid).toBe(false)
  })

  it.concurrent('should use imageUrl as default param name', () => {
    const result = validateImageUrl(null)
    expect(result.error).toContain('imageUrl')
  })
})

describe('validateProxyUrl', () => {
  it.concurrent('should accept valid proxy URLs', () => {
    const result = validateProxyUrl('https://proxy.example.com/api')
    expect(result.isValid).toBe(true)
  })

  it.concurrent('should reject private IPs', () => {
    const result = validateProxyUrl('https://192.168.1.1:8080')
    expect(result.isValid).toBe(false)
  })

  it.concurrent('should use proxyUrl as default param name', () => {
    const result = validateProxyUrl(null)
    expect(result.error).toContain('proxyUrl')
  })
})

describe('validateGoogleCalendarId', () => {
  describe('valid calendar IDs', () => {
    it.concurrent('should accept "primary"', () => {
      const result = validateGoogleCalendarId('primary')
      expect(result.isValid).toBe(true)
      expect(result.sanitized).toBe('primary')
    })

    it.concurrent('should accept email addresses', () => {
      const result = validateGoogleCalendarId('user@example.com')
      expect(result.isValid).toBe(true)
      expect(result.sanitized).toBe('user@example.com')
    })

    it.concurrent('should accept Google calendar format', () => {
      const result = validateGoogleCalendarId('en.usa#holiday@group.v.calendar.google.com')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept alphanumeric IDs with allowed characters', () => {
      const result = validateGoogleCalendarId('abc123_def-456')
      expect(result.isValid).toBe(true)
    })
  })

  describe('invalid calendar IDs', () => {
    it.concurrent('should reject null', () => {
      const result = validateGoogleCalendarId(null)
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('required')
    })

    it.concurrent('should reject empty string', () => {
      const result = validateGoogleCalendarId('')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject path traversal', () => {
      const result = validateGoogleCalendarId('../etc/passwd')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('path traversal')
    })

    it.concurrent('should reject URL-encoded path traversal', () => {
      const result = validateGoogleCalendarId('%2e%2e%2f')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('path traversal')
    })

    it.concurrent('should reject null bytes', () => {
      const result = validateGoogleCalendarId('test\0value')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('control characters')
    })

    it.concurrent('should reject newline characters', () => {
      const result = validateGoogleCalendarId('test\nvalue')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('control characters')
    })

    it.concurrent('should reject IDs exceeding 255 characters', () => {
      const longId = 'a'.repeat(256)
      const result = validateGoogleCalendarId(longId)
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('maximum length')
    })

    it.concurrent('should reject invalid characters', () => {
      const result = validateGoogleCalendarId('test<script>alert(1)</script>')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('format is invalid')
    })
  })
})

describe('validateAirtableId', () => {
  describe('valid base IDs (app prefix)', () => {
    it.concurrent('should accept valid base ID', () => {
      const result = validateAirtableId('appABCDEFGHIJKLMN', 'app', 'baseId')
      expect(result.isValid).toBe(true)
      expect(result.sanitized).toBe('appABCDEFGHIJKLMN')
    })

    it.concurrent('should accept base ID with mixed case', () => {
      const result = validateAirtableId('appAbCdEfGhIjKlMn', 'app', 'baseId')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept base ID with numbers', () => {
      const result = validateAirtableId('app12345678901234', 'app', 'baseId')
      expect(result.isValid).toBe(true)
    })
  })

  describe('valid table IDs (tbl prefix)', () => {
    it.concurrent('should accept valid table ID', () => {
      const result = validateAirtableId('tblABCDEFGHIJKLMN', 'tbl', 'tableId')
      expect(result.isValid).toBe(true)
    })
  })

  describe('valid webhook IDs (ach prefix)', () => {
    it.concurrent('should accept valid webhook ID', () => {
      const result = validateAirtableId('achABCDEFGHIJKLMN', 'ach', 'webhookId')
      expect(result.isValid).toBe(true)
    })
  })

  describe('invalid IDs', () => {
    it.concurrent('should reject null', () => {
      const result = validateAirtableId(null, 'app', 'baseId')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('required')
    })

    it.concurrent('should reject empty string', () => {
      const result = validateAirtableId('', 'app', 'baseId')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('required')
    })

    it.concurrent('should reject wrong prefix', () => {
      const result = validateAirtableId('tblABCDEFGHIJKLMN', 'app', 'baseId')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('starting with "app"')
    })

    it.concurrent('should reject too short ID (13 chars after prefix)', () => {
      const result = validateAirtableId('appABCDEFGHIJKLM', 'app', 'baseId')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject too long ID (15 chars after prefix)', () => {
      const result = validateAirtableId('appABCDEFGHIJKLMNO', 'app', 'baseId')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject special characters', () => {
      const result = validateAirtableId('appABCDEFGH/JKLMN', 'app', 'baseId')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject path traversal attempts', () => {
      const result = validateAirtableId('app../etc/passwd', 'app', 'baseId')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject lowercase prefix', () => {
      const result = validateAirtableId('AppABCDEFGHIJKLMN', 'app', 'baseId')
      expect(result.isValid).toBe(false)
    })
  })
})

describe('validateAwsRegion', () => {
  describe('valid standard regions', () => {
    it.concurrent('should accept us-east-1', () => {
      const result = validateAwsRegion('us-east-1')
      expect(result.isValid).toBe(true)
      expect(result.sanitized).toBe('us-east-1')
    })

    it.concurrent('should accept us-west-2', () => {
      const result = validateAwsRegion('us-west-2')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept eu-west-1', () => {
      const result = validateAwsRegion('eu-west-1')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept eu-central-1', () => {
      const result = validateAwsRegion('eu-central-1')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept ap-southeast-1', () => {
      const result = validateAwsRegion('ap-southeast-1')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept ap-northeast-1', () => {
      const result = validateAwsRegion('ap-northeast-1')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept sa-east-1', () => {
      const result = validateAwsRegion('sa-east-1')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept me-south-1', () => {
      const result = validateAwsRegion('me-south-1')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept af-south-1', () => {
      const result = validateAwsRegion('af-south-1')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept ca-central-1', () => {
      const result = validateAwsRegion('ca-central-1')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept il-central-1', () => {
      const result = validateAwsRegion('il-central-1')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept regions with double-digit numbers', () => {
      const result = validateAwsRegion('ap-northeast-12')
      expect(result.isValid).toBe(true)
    })
  })

  describe('valid GovCloud regions', () => {
    it.concurrent('should accept us-gov-west-1', () => {
      const result = validateAwsRegion('us-gov-west-1')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept us-gov-east-1', () => {
      const result = validateAwsRegion('us-gov-east-1')
      expect(result.isValid).toBe(true)
    })
  })

  describe('valid China regions', () => {
    it.concurrent('should accept cn-north-1', () => {
      const result = validateAwsRegion('cn-north-1')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept cn-northwest-1', () => {
      const result = validateAwsRegion('cn-northwest-1')
      expect(result.isValid).toBe(true)
    })
  })

  describe('valid ISO regions', () => {
    it.concurrent('should accept us-iso-east-1', () => {
      const result = validateAwsRegion('us-iso-east-1')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept us-isob-east-1', () => {
      const result = validateAwsRegion('us-isob-east-1')
      expect(result.isValid).toBe(true)
    })
  })

  describe('invalid regions', () => {
    it.concurrent('should reject null', () => {
      const result = validateAwsRegion(null)
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('required')
    })

    it.concurrent('should reject empty string', () => {
      const result = validateAwsRegion('')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('required')
    })

    it.concurrent('should reject uppercase regions', () => {
      const result = validateAwsRegion('US-EAST-1')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject invalid format - missing number', () => {
      const result = validateAwsRegion('us-east')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject invalid format - wrong separators', () => {
      const result = validateAwsRegion('us_east_1')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject invalid format - too many parts', () => {
      const result = validateAwsRegion('us-east-1-extra')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject path traversal attempts', () => {
      const result = validateAwsRegion('../etc/passwd')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject arbitrary strings', () => {
      const result = validateAwsRegion('not-a-region')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject invalid prefix', () => {
      const result = validateAwsRegion('xx-east-1')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject invalid direction', () => {
      const result = validateAwsRegion('us-middle-1')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should use custom param name in errors', () => {
      const result = validateAwsRegion('', 'awsRegion')
      expect(result.error).toContain('awsRegion')
    })
  })
})

describe('validateS3BucketName', () => {
  describe('valid bucket names', () => {
    it.concurrent('should accept simple bucket name', () => {
      const result = validateS3BucketName('my-bucket')
      expect(result.isValid).toBe(true)
      expect(result.sanitized).toBe('my-bucket')
    })

    it.concurrent('should accept bucket name with numbers', () => {
      const result = validateS3BucketName('bucket123')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept bucket name with periods', () => {
      const result = validateS3BucketName('my.bucket.name')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept 3 character bucket name', () => {
      const result = validateS3BucketName('abc')
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept 63 character bucket name', () => {
      const result = validateS3BucketName('a'.repeat(63))
      expect(result.isValid).toBe(true)
    })

    it.concurrent('should accept minimum valid bucket name (3 chars)', () => {
      const result = validateS3BucketName('a1b')
      expect(result.isValid).toBe(true)
    })
  })

  describe('invalid bucket names - null/empty', () => {
    it.concurrent('should reject null', () => {
      const result = validateS3BucketName(null)
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('required')
    })

    it.concurrent('should reject empty string', () => {
      const result = validateS3BucketName('')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('required')
    })
  })

  describe('invalid bucket names - length', () => {
    it.concurrent('should reject 2 character bucket name', () => {
      const result = validateS3BucketName('ab')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('between 3 and 63')
    })

    it.concurrent('should reject 64 character bucket name', () => {
      const result = validateS3BucketName('a'.repeat(64))
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('between 3 and 63')
    })
  })

  describe('invalid bucket names - format', () => {
    it.concurrent('should reject uppercase letters', () => {
      const result = validateS3BucketName('MyBucket')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject underscores', () => {
      const result = validateS3BucketName('my_bucket')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject starting with hyphen', () => {
      const result = validateS3BucketName('-mybucket')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject ending with hyphen', () => {
      const result = validateS3BucketName('mybucket-')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject starting with period', () => {
      const result = validateS3BucketName('.mybucket')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject ending with period', () => {
      const result = validateS3BucketName('mybucket.')
      expect(result.isValid).toBe(false)
    })

    it.concurrent('should reject consecutive periods', () => {
      const result = validateS3BucketName('my..bucket')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('consecutive periods')
    })

    it.concurrent('should reject IP address format', () => {
      const result = validateS3BucketName('192.168.1.1')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('IP address')
    })

    it.concurrent('should reject special characters', () => {
      const result = validateS3BucketName('my@bucket')
      expect(result.isValid).toBe(false)
    })
  })

  describe('error messages', () => {
    it.concurrent('should use custom param name in errors', () => {
      const result = validateS3BucketName('', 's3Bucket')
      expect(result.error).toContain('s3Bucket')
    })
  })
})
