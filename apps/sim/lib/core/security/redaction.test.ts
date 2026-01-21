import { describe, expect, it } from 'vitest'
import {
  isLargeDataKey,
  isSensitiveKey,
  REDACTED_MARKER,
  redactApiKeys,
  redactSensitiveValues,
  sanitizeEventData,
  sanitizeForLogging,
  TRUNCATED_MARKER,
} from './redaction'

/**
 * Security-focused edge case tests for redaction utilities
 */

describe('REDACTED_MARKER', () => {
  it.concurrent('should be the standard marker', () => {
    expect(REDACTED_MARKER).toBe('[REDACTED]')
  })
})

describe('TRUNCATED_MARKER', () => {
  it.concurrent('should be the standard marker', () => {
    expect(TRUNCATED_MARKER).toBe('[TRUNCATED]')
  })
})

describe('isLargeDataKey', () => {
  it.concurrent('should identify base64 as large data key', () => {
    expect(isLargeDataKey('base64')).toBe(true)
  })

  it.concurrent('should not identify other keys as large data', () => {
    expect(isLargeDataKey('content')).toBe(false)
    expect(isLargeDataKey('data')).toBe(false)
    expect(isLargeDataKey('base')).toBe(false)
  })
})

describe('isSensitiveKey', () => {
  describe('exact matches', () => {
    it.concurrent('should match apiKey variations', () => {
      expect(isSensitiveKey('apiKey')).toBe(true)
      expect(isSensitiveKey('api_key')).toBe(true)
      expect(isSensitiveKey('api-key')).toBe(true)
      expect(isSensitiveKey('APIKEY')).toBe(true)
      expect(isSensitiveKey('API_KEY')).toBe(true)
    })

    it.concurrent('should match token variations', () => {
      expect(isSensitiveKey('access_token')).toBe(true)
      expect(isSensitiveKey('refresh_token')).toBe(true)
      expect(isSensitiveKey('auth_token')).toBe(true)
      expect(isSensitiveKey('accessToken')).toBe(true)
    })

    it.concurrent('should match secret variations', () => {
      expect(isSensitiveKey('client_secret')).toBe(true)
      expect(isSensitiveKey('clientSecret')).toBe(true)
      expect(isSensitiveKey('secret')).toBe(true)
    })

    it.concurrent('should match other sensitive keys', () => {
      expect(isSensitiveKey('private_key')).toBe(true)
      expect(isSensitiveKey('authorization')).toBe(true)
      expect(isSensitiveKey('bearer')).toBe(true)
      expect(isSensitiveKey('private')).toBe(true)
      expect(isSensitiveKey('auth')).toBe(true)
      expect(isSensitiveKey('password')).toBe(true)
      expect(isSensitiveKey('credential')).toBe(true)
    })
  })

  describe('suffix matches', () => {
    it.concurrent('should match keys ending in secret', () => {
      expect(isSensitiveKey('clientSecret')).toBe(true)
      expect(isSensitiveKey('appSecret')).toBe(true)
      expect(isSensitiveKey('mySecret')).toBe(true)
    })

    it.concurrent('should match keys ending in password', () => {
      expect(isSensitiveKey('userPassword')).toBe(true)
      expect(isSensitiveKey('dbPassword')).toBe(true)
      expect(isSensitiveKey('adminPassword')).toBe(true)
    })

    it.concurrent('should match keys ending in token', () => {
      expect(isSensitiveKey('accessToken')).toBe(true)
      expect(isSensitiveKey('refreshToken')).toBe(true)
      expect(isSensitiveKey('bearerToken')).toBe(true)
    })

    it.concurrent('should match keys ending in credential', () => {
      expect(isSensitiveKey('userCredential')).toBe(true)
      expect(isSensitiveKey('dbCredential')).toBe(true)
    })
  })

  describe('non-sensitive keys (no false positives)', () => {
    it.concurrent('should not match keys with sensitive words as prefix only', () => {
      expect(isSensitiveKey('tokenCount')).toBe(false)
      expect(isSensitiveKey('tokenizer')).toBe(false)
      expect(isSensitiveKey('secretKey')).toBe(false)
      expect(isSensitiveKey('passwordStrength')).toBe(false)
      expect(isSensitiveKey('authMethod')).toBe(false)
    })

    it.concurrent('should match keys ending with sensitive words (intentional)', () => {
      expect(isSensitiveKey('hasSecret')).toBe(true)
      expect(isSensitiveKey('userPassword')).toBe(true)
      expect(isSensitiveKey('sessionToken')).toBe(true)
    })

    it.concurrent('should not match normal field names', () => {
      expect(isSensitiveKey('name')).toBe(false)
      expect(isSensitiveKey('email')).toBe(false)
      expect(isSensitiveKey('id')).toBe(false)
      expect(isSensitiveKey('value')).toBe(false)
      expect(isSensitiveKey('data')).toBe(false)
      expect(isSensitiveKey('count')).toBe(false)
      expect(isSensitiveKey('status')).toBe(false)
    })
  })
})

describe('redactSensitiveValues', () => {
  it.concurrent('should redact Bearer tokens', () => {
    const input = 'Authorization: Bearer abc123xyz456'
    const result = redactSensitiveValues(input)
    expect(result).toBe('Authorization: Bearer [REDACTED]')
    expect(result).not.toContain('abc123xyz456')
  })

  it.concurrent('should redact Basic auth', () => {
    const input = 'Authorization: Basic dXNlcjpwYXNz'
    const result = redactSensitiveValues(input)
    expect(result).toBe('Authorization: Basic [REDACTED]')
  })

  it.concurrent('should redact API key prefixes', () => {
    const input = 'Using key sk-1234567890abcdefghijklmnop'
    const result = redactSensitiveValues(input)
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('sk-1234567890abcdefghijklmnop')
  })

  it.concurrent('should redact JSON-style password fields', () => {
    const input = 'password: "mysecretpass123"'
    const result = redactSensitiveValues(input)
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('mysecretpass123')
  })

  it.concurrent('should redact JSON-style token fields', () => {
    const input = 'token: "tokenvalue123"'
    const result = redactSensitiveValues(input)
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('tokenvalue123')
  })

  it.concurrent('should redact JSON-style api_key fields', () => {
    const input = 'api_key: "key123456"'
    const result = redactSensitiveValues(input)
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('key123456')
  })

  it.concurrent('should not modify safe strings', () => {
    const input = 'This is a normal string with no secrets'
    const result = redactSensitiveValues(input)
    expect(result).toBe(input)
  })

  it.concurrent('should handle empty strings', () => {
    expect(redactSensitiveValues('')).toBe('')
  })

  it.concurrent('should handle null/undefined gracefully', () => {
    expect(redactSensitiveValues(null as any)).toBe(null)
    expect(redactSensitiveValues(undefined as any)).toBe(undefined)
  })
})

describe('redactApiKeys', () => {
  describe('object redaction', () => {
    it.concurrent('should redact sensitive keys in flat objects', () => {
      const obj = {
        apiKey: 'secret-key',
        api_key: 'another-secret',
        access_token: 'token-value',
        secret: 'secret-value',
        password: 'password-value',
        normalField: 'normal-value',
      }

      const result = redactApiKeys(obj)

      expect(result.apiKey).toBe('[REDACTED]')
      expect(result.api_key).toBe('[REDACTED]')
      expect(result.access_token).toBe('[REDACTED]')
      expect(result.secret).toBe('[REDACTED]')
      expect(result.password).toBe('[REDACTED]')
      expect(result.normalField).toBe('normal-value')
    })

    it.concurrent('should redact sensitive keys in nested objects', () => {
      const obj = {
        config: {
          apiKey: 'secret-key',
          normalField: 'normal-value',
        },
      }

      const result = redactApiKeys(obj)

      expect(result.config.apiKey).toBe('[REDACTED]')
      expect(result.config.normalField).toBe('normal-value')
    })

    it.concurrent('should redact sensitive keys in arrays', () => {
      const arr = [{ apiKey: 'secret-key-1' }, { apiKey: 'secret-key-2' }]

      const result = redactApiKeys(arr)

      expect(result[0].apiKey).toBe('[REDACTED]')
      expect(result[1].apiKey).toBe('[REDACTED]')
    })

    it.concurrent('should handle deeply nested structures', () => {
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
      expect(result.users[0].credentials.apiKey).toBe('[REDACTED]')
      expect(result.users[0].credentials.username).toBe('john_doe')
      expect(result.config.database.password).toBe('[REDACTED]')
      expect(result.config.database.host).toBe('localhost')
    })

    it.concurrent('should truncate base64 fields', () => {
      const obj = {
        id: 'file-123',
        name: 'document.pdf',
        base64: 'VGhpcyBpcyBhIHZlcnkgbG9uZyBiYXNlNjQgc3RyaW5n...',
        size: 12345,
      }

      const result = redactApiKeys(obj)

      expect(result.id).toBe('file-123')
      expect(result.name).toBe('document.pdf')
      expect(result.base64).toBe('[TRUNCATED]')
      expect(result.size).toBe(12345)
    })

    it.concurrent('should truncate base64 in nested UserFile objects', () => {
      const obj = {
        files: [
          {
            id: 'file-1',
            name: 'doc1.pdf',
            url: 'http://example.com/file1',
            size: 1000,
            base64: 'base64content1...',
          },
          {
            id: 'file-2',
            name: 'doc2.pdf',
            url: 'http://example.com/file2',
            size: 2000,
            base64: 'base64content2...',
          },
        ],
      }

      const result = redactApiKeys(obj)

      expect(result.files[0].id).toBe('file-1')
      expect(result.files[0].base64).toBe('[TRUNCATED]')
      expect(result.files[1].base64).toBe('[TRUNCATED]')
    })

    it.concurrent('should filter UserFile objects to only expose allowed fields', () => {
      const obj = {
        processedFiles: [
          {
            id: 'file-123',
            name: 'document.pdf',
            url: 'http://localhost/api/files/serve/...',
            size: 12345,
            type: 'application/pdf',
            key: 'execution/workspace/workflow/file.pdf',
            context: 'execution',
            base64: 'VGhpcyBpcyBhIGJhc2U2NCBzdHJpbmc=',
          },
        ],
      }

      const result = redactApiKeys(obj)

      // Exposed fields should be present
      expect(result.processedFiles[0].id).toBe('file-123')
      expect(result.processedFiles[0].name).toBe('document.pdf')
      expect(result.processedFiles[0].url).toBe('http://localhost/api/files/serve/...')
      expect(result.processedFiles[0].size).toBe(12345)
      expect(result.processedFiles[0].type).toBe('application/pdf')
      expect(result.processedFiles[0].base64).toBe('[TRUNCATED]')

      // Internal fields should be filtered out
      expect(result.processedFiles[0]).not.toHaveProperty('key')
      expect(result.processedFiles[0]).not.toHaveProperty('context')
    })
  })

  describe('primitive handling', () => {
    it.concurrent('should return primitives unchanged', () => {
      expect(redactApiKeys('string')).toBe('string')
      expect(redactApiKeys(123)).toBe(123)
      expect(redactApiKeys(true)).toBe(true)
      expect(redactApiKeys(null)).toBe(null)
      expect(redactApiKeys(undefined)).toBe(undefined)
    })
  })

  describe('no false positives', () => {
    it.concurrent('should not redact keys with sensitive words as prefix only', () => {
      const obj = {
        tokenCount: 100,
        secretKey: 'not-actually-secret',
        passwordStrength: 'strong',
        authMethod: 'oauth',
      }

      const result = redactApiKeys(obj)

      expect(result.tokenCount).toBe(100)
      expect(result.secretKey).toBe('not-actually-secret')
      expect(result.passwordStrength).toBe('strong')
      expect(result.authMethod).toBe('oauth')
    })
  })
})

describe('sanitizeForLogging', () => {
  it.concurrent('should truncate long strings', () => {
    const longString = 'a'.repeat(200)
    const result = sanitizeForLogging(longString, 50)
    expect(result.length).toBe(50)
  })

  it.concurrent('should use default max length of 100', () => {
    const longString = 'a'.repeat(200)
    const result = sanitizeForLogging(longString)
    expect(result.length).toBe(100)
  })

  it.concurrent('should redact sensitive patterns', () => {
    const input = 'Bearer abc123xyz456'
    const result = sanitizeForLogging(input)
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('abc123xyz456')
  })

  it.concurrent('should handle empty strings', () => {
    expect(sanitizeForLogging('')).toBe('')
  })

  it.concurrent('should not modify safe short strings', () => {
    const input = 'Safe string'
    const result = sanitizeForLogging(input)
    expect(result).toBe(input)
  })
})

describe('sanitizeEventData', () => {
  describe('object sanitization', () => {
    it.concurrent('should remove sensitive keys entirely', () => {
      const event = {
        action: 'login',
        apiKey: 'secret-key',
        password: 'secret-pass',
        userId: '123',
      }

      const result = sanitizeEventData(event)

      expect(result.action).toBe('login')
      expect(result.userId).toBe('123')
      expect(result).not.toHaveProperty('apiKey')
      expect(result).not.toHaveProperty('password')
    })

    it.concurrent('should redact sensitive patterns in string values', () => {
      const event = {
        message: 'Auth: Bearer abc123token',
        normal: 'normal value',
      }

      const result = sanitizeEventData(event)

      expect(result.message).toContain('[REDACTED]')
      expect(result.message).not.toContain('abc123token')
      expect(result.normal).toBe('normal value')
    })

    it.concurrent('should handle nested objects', () => {
      const event = {
        user: {
          id: '123',
          accessToken: 'secret-token',
        },
      }

      const result = sanitizeEventData(event)

      expect(result.user.id).toBe('123')
      expect(result.user).not.toHaveProperty('accessToken')
    })

    it.concurrent('should handle arrays', () => {
      const event = {
        items: [
          { id: 1, apiKey: 'key1' },
          { id: 2, apiKey: 'key2' },
        ],
      }

      const result = sanitizeEventData(event)

      expect(result.items[0].id).toBe(1)
      expect(result.items[0]).not.toHaveProperty('apiKey')
      expect(result.items[1].id).toBe(2)
      expect(result.items[1]).not.toHaveProperty('apiKey')
    })
  })

  describe('primitive handling', () => {
    it.concurrent('should return primitives appropriately', () => {
      expect(sanitizeEventData(null)).toBe(null)
      expect(sanitizeEventData(undefined)).toBe(undefined)
      expect(sanitizeEventData(123)).toBe(123)
      expect(sanitizeEventData(true)).toBe(true)
    })

    it.concurrent('should redact sensitive patterns in top-level strings', () => {
      const result = sanitizeEventData('Bearer secrettoken123')
      expect(result).toContain('[REDACTED]')
    })

    it.concurrent('should not redact normal strings', () => {
      const result = sanitizeEventData('normal string')
      expect(result).toBe('normal string')
    })
  })

  describe('no false positives', () => {
    it.concurrent('should not remove keys with sensitive words in middle', () => {
      const event = {
        tokenCount: 500,
        isAuthenticated: true,
        hasSecretFeature: false,
      }

      const result = sanitizeEventData(event)

      expect(result.tokenCount).toBe(500)
      expect(result.isAuthenticated).toBe(true)
      expect(result.hasSecretFeature).toBe(false)
    })
  })
})

describe('Security edge cases', () => {
  describe('redactApiKeys security', () => {
    it.concurrent('should handle objects with prototype-like key names safely', () => {
      const obj = {
        protoField: { isAdmin: true },
        name: 'test',
        apiKey: 'secret',
      }
      const result = redactApiKeys(obj)

      expect(result.name).toBe('test')
      expect(result.protoField).toEqual({ isAdmin: true })
      expect(result.apiKey).toBe('[REDACTED]')
    })

    it.concurrent('should handle objects with constructor key', () => {
      const obj = {
        constructor: 'test-value',
        normalField: 'normal',
      }

      const result = redactApiKeys(obj)

      expect(result.constructor).toBe('test-value')
      expect(result.normalField).toBe('normal')
    })

    it.concurrent('should handle objects with toString key', () => {
      const obj = {
        toString: 'custom-tostring',
        valueOf: 'custom-valueof',
        apiKey: 'secret',
      }

      const result = redactApiKeys(obj)

      expect(result.toString).toBe('custom-tostring')
      expect(result.valueOf).toBe('custom-valueof')
      expect(result.apiKey).toBe('[REDACTED]')
    })

    it.concurrent('should not mutate original object', () => {
      const original = {
        apiKey: 'secret-key',
        nested: {
          password: 'secret-password',
        },
      }

      const originalCopy = JSON.parse(JSON.stringify(original))
      redactApiKeys(original)

      expect(original).toEqual(originalCopy)
    })

    it.concurrent('should handle very deeply nested structures', () => {
      let obj: any = { data: 'value' }
      for (let i = 0; i < 50; i++) {
        obj = { nested: obj, apiKey: `secret-${i}` }
      }

      const result = redactApiKeys(obj)

      expect(result.apiKey).toBe('[REDACTED]')
      expect(result.nested.apiKey).toBe('[REDACTED]')
    })

    it.concurrent('should handle arrays with mixed types', () => {
      const arr = [
        { apiKey: 'secret' },
        'string',
        123,
        null,
        undefined,
        true,
        [{ password: 'nested' }],
      ]

      const result = redactApiKeys(arr)

      expect(result[0].apiKey).toBe('[REDACTED]')
      expect(result[1]).toBe('string')
      expect(result[2]).toBe(123)
      expect(result[3]).toBe(null)
      expect(result[4]).toBe(undefined)
      expect(result[5]).toBe(true)
      expect(result[6][0].password).toBe('[REDACTED]')
    })

    it.concurrent('should handle empty arrays', () => {
      const result = redactApiKeys([])
      expect(result).toEqual([])
    })

    it.concurrent('should handle empty objects', () => {
      const result = redactApiKeys({})
      expect(result).toEqual({})
    })
  })

  describe('redactSensitiveValues security', () => {
    it.concurrent('should handle multiple API key patterns in one string', () => {
      const input = 'Keys: sk-abc123defghijklmnopqr and pk-xyz789abcdefghijklmnop'
      const result = redactSensitiveValues(input)

      expect(result).not.toContain('sk-abc123defghijklmnopqr')
      expect(result).not.toContain('pk-xyz789abcdefghijklmnop')
      expect(result.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(2)
    })

    it.concurrent('should handle multiline strings with sensitive data', () => {
      const input = `Line 1: Bearer token123abc456def
      Line 2: password: "secretpass"
      Line 3: Normal content`

      const result = redactSensitiveValues(input)

      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('token123abc456def')
      expect(result).not.toContain('secretpass')
      expect(result).toContain('Normal content')
    })

    it.concurrent('should handle unicode in strings', () => {
      const input = 'Bearer abc123'
      const result = redactSensitiveValues(input)

      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('abc123')
    })

    it.concurrent('should handle very long strings', () => {
      const longSecret = 'a'.repeat(10000)
      const input = `Bearer ${longSecret}`
      const result = redactSensitiveValues(input)

      expect(result).toContain('[REDACTED]')
      expect(result.length).toBeLessThan(input.length)
    })

    it.concurrent('should not match partial patterns', () => {
      const input = 'This is a Bear without er suffix'
      const result = redactSensitiveValues(input)

      expect(result).toBe(input)
    })

    it.concurrent('should handle special regex characters safely', () => {
      const input = 'Test with special chars: $^.*+?()[]{}|'
      const result = redactSensitiveValues(input)

      expect(result).toBe(input)
    })
  })

  describe('sanitizeEventData security', () => {
    it.concurrent('should strip sensitive keys entirely (not redact)', () => {
      const event = {
        action: 'login',
        apiKey: 'should-be-stripped',
        password: 'should-be-stripped',
        userId: '123',
      }

      const result = sanitizeEventData(event)

      expect(result).not.toHaveProperty('apiKey')
      expect(result).not.toHaveProperty('password')
      expect(Object.keys(result)).not.toContain('apiKey')
      expect(Object.keys(result)).not.toContain('password')
    })

    it.concurrent('should handle Symbol keys gracefully', () => {
      const sym = Symbol('test')
      const event: any = {
        [sym]: 'symbol-value',
        normalKey: 'normal-value',
      }

      expect(() => sanitizeEventData(event)).not.toThrow()
    })

    it.concurrent('should handle Date objects as objects', () => {
      const date = new Date('2024-01-01')
      const event = {
        createdAt: date,
        apiKey: 'secret',
      }

      const result = sanitizeEventData(event)

      expect(result.createdAt).toBeDefined()
      expect(result).not.toHaveProperty('apiKey')
    })

    it.concurrent('should handle objects with numeric keys', () => {
      const event: any = {
        0: 'first',
        1: 'second',
        apiKey: 'secret',
      }

      const result = sanitizeEventData(event)

      expect(result[0]).toBe('first')
      expect(result[1]).toBe('second')
      expect(result).not.toHaveProperty('apiKey')
    })
  })

  describe('isSensitiveKey security', () => {
    it.concurrent('should handle case variations', () => {
      expect(isSensitiveKey('APIKEY')).toBe(true)
      expect(isSensitiveKey('ApiKey')).toBe(true)
      expect(isSensitiveKey('apikey')).toBe(true)
      expect(isSensitiveKey('API_KEY')).toBe(true)
      expect(isSensitiveKey('api_key')).toBe(true)
      expect(isSensitiveKey('Api_Key')).toBe(true)
    })

    it.concurrent('should handle empty string', () => {
      expect(isSensitiveKey('')).toBe(false)
    })

    it.concurrent('should handle very long key names', () => {
      const longKey = `${'a'.repeat(10000)}password`
      expect(isSensitiveKey(longKey)).toBe(true)
    })

    it.concurrent('should handle keys with special characters', () => {
      expect(isSensitiveKey('api-key')).toBe(true)
      expect(isSensitiveKey('api_key')).toBe(true)
    })

    it.concurrent('should detect oauth tokens', () => {
      expect(isSensitiveKey('access_token')).toBe(true)
      expect(isSensitiveKey('refresh_token')).toBe(true)
      expect(isSensitiveKey('accessToken')).toBe(true)
      expect(isSensitiveKey('refreshToken')).toBe(true)
    })

    it.concurrent('should detect various credential patterns', () => {
      expect(isSensitiveKey('userCredential')).toBe(true)
      expect(isSensitiveKey('dbCredential')).toBe(true)
      expect(isSensitiveKey('appCredential')).toBe(true)
    })
  })

  describe('sanitizeForLogging edge cases', () => {
    it.concurrent('should handle string with only sensitive content', () => {
      const input = 'Bearer abc123xyz456'
      const result = sanitizeForLogging(input)

      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('abc123xyz456')
    })

    it.concurrent('should truncate strings to specified length', () => {
      const longString = 'a'.repeat(200)
      const result = sanitizeForLogging(longString, 60)

      expect(result.length).toBe(60)
    })

    it.concurrent('should handle maxLength of 0', () => {
      const result = sanitizeForLogging('test', 0)
      expect(result).toBe('')
    })

    it.concurrent('should handle negative maxLength gracefully', () => {
      const result = sanitizeForLogging('test', -5)
      expect(result).toBe('')
    })

    it.concurrent('should handle maxLength larger than string', () => {
      const input = 'short'
      const result = sanitizeForLogging(input, 1000)
      expect(result).toBe(input)
    })
  })
})
