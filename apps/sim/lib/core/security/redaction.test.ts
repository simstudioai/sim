import { describe, expect, it } from 'vitest'
import {
  isSensitiveKey,
  redactApiKeys,
  redactExactSensitiveValues,
  redactSensitiveValues,
  sanitizeEventData,
  sanitizeForLogging,
} from './redaction'

describe('isSensitiveKey', () => {
  it.concurrent.each([
    'apiKey',
    'API_KEY',
    'api-key',
    'Api_Key',
    'access_token',
    'refreshToken',
    'client_secret',
    'private_key',
    'authorization',
    'bearer',
    'auth',
    'password',
    'credential',
    'passphrase',
    'dbPassword',
    'userCredential',
    'hasSecret',
    'searchApiKey',
    'exa_api_key',
    `${'a'.repeat(10000)}password`,
  ])('treats %s as sensitive', (key) => {
    expect(isSensitiveKey(key)).toBe(true)
  })

  it.concurrent.each([
    'tokenCount',
    'tokenizer',
    'secretKey',
    'passwordStrength',
    'authMethod',
    'name',
    'data',
    '',
  ])('does not treat %j as sensitive', (key) => {
    expect(isSensitiveKey(key)).toBe(false)
  })
})

describe('redactSensitiveValues', () => {
  it.concurrent.each([
    ['Authorization: Bearer abc123xyz456', 'abc123xyz456'],
    ['Authorization: Basic dXNlcjpwYXNz', 'dXNlcjpwYXNz'],
    ['Using key sk-1234567890abcdefghijklmnop', 'sk-1234567890abcdefghijklmnop'],
    ['Using key pk-xyz789abcdefghijklmnop', 'pk-xyz789abcdefghijklmnop'],
    ['password: "mysecretpass123"', 'mysecretpass123'],
    ['token: "tokenvalue123"', 'tokenvalue123'],
    ['api_key: "key123456"', 'key123456'],
  ])('redacts %s', (input, secret) => {
    const result = redactSensitiveValues(input)
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain(secret)
  })

  it.concurrent('should redact form and percent-encoded OAuth credentials', () => {
    const input =
      'refresh_token=secret-one&client_secret=secret-two&oauth_token=secret-three&client_password=secret-four oauth_token%3Dsecret-five%26client_password%3Dsecret-six%26scope%3Dx'
    const result = redactSensitiveValues(input)

    expect(result).not.toContain('secret-one')
    expect(result).not.toContain('secret-two')
    expect(result).not.toContain('secret-three')
    expect(result).not.toContain('secret-four')
    expect(result).not.toContain('secret-five')
    expect(result).not.toContain('secret-six')
    expect(result).toContain('refresh_token=[REDACTED]')
    expect(result).toContain('oauth_token%3D[REDACTED]')
    expect(result).toContain('scope%3Dx')
  })

  it.concurrent('redacts authorization schemes without exposing the credential suffix', () => {
    expect(redactSensitiveValues('authorization=Bearer <token> scope=openid')).toBe(
      'authorization=[REDACTED] scope=openid'
    )
    expect(redactSensitiveValues('authorization=Basic dXNlcjpwYXNz')).toBe(
      'authorization=[REDACTED]'
    )
    expect(redactSensitiveValues('authorization=Basic YQ== scope=openid')).toBe(
      'authorization=[REDACTED] scope=openid'
    )
    expect(redactSensitiveValues('authorization=Bearer <padded-token>= scope=openid')).toBe(
      'authorization=[REDACTED] scope=openid'
    )
  })

  it.concurrent('redacts parameterized authorization schemes through the field delimiter', () => {
    expect(
      redactSensitiveValues(
        'authorization=Digest username="user", realm="realm", response="digest-secret"&scope=openid'
      )
    ).toBe('authorization=[REDACTED]&scope=openid')
    expect(
      redactSensitiveValues(
        'proxyAuthorization=OAuth realm="Example", oauth_signature="oauth-secret"&scope=openid'
      )
    ).toBe('proxyAuthorization=[REDACTED]&scope=openid')
  })

  it.concurrent('redacts parameterized authorization header values through the line ending', () => {
    expect(
      redactSensitiveValues(
        'Authorization: Digest username="user", realm="realm", response="digest-secret"\nstatus: 401'
      )
    ).toBe('Authorization: [REDACTED]\nstatus: 401')
    expect(
      redactSensitiveValues(
        'Proxy-Authorization: AWS4-HMAC-SHA256 Credential=key/path, SignedHeaders=host, Signature=signature-secret'
      )
    ).toBe('Proxy-Authorization: [REDACTED]')
  })

  it.concurrent(
    'redacts malformed single-token authorization headers through the line ending',
    () => {
      expect(redactSensitiveValues('Authorization: Bearer prefix:secret-tail')).toBe(
        'Authorization: Bearer [REDACTED]'
      )
      expect(redactSensitiveValues('Proxy-Authorization: Basic prefix:secret-tail')).toBe(
        'Proxy-Authorization: Basic [REDACTED]'
      )
    }
  )

  it.concurrent('does not consume the next line when an authorization header is empty', () => {
    expect(redactSensitiveValues('Authorization: Bearer\nstatus: 401')).toBe(
      'Authorization: [REDACTED]\nstatus: 401'
    )
    expect(redactSensitiveValues('Authorization:\r\nstatus: 401')).toBe(
      'Authorization: [REDACTED]\r\nstatus: 401'
    )
  })

  it.concurrent('redacts encoded form credentials using delimiters at the matching depth', () => {
    let encoded = new URLSearchParams({
      access_token: 'prefix&secret-tail',
      scope: 'openid',
    }).toString()

    for (let layer = 0; layer <= 3; layer++) {
      const result = redactSensitiveValues(encoded)
      expect(result).not.toContain('prefix')
      expect(result).not.toContain('secret-tail')
      expect(result).toContain('scope')
      encoded = encodeURIComponent(encoded)
    }
  })

  it.concurrent('uses the canonical sensitive-key policy for form fields', () => {
    const keys = ['authorization', 'auth', 'bearer', 'private_key', 'passphrase']
    const input = keys
      .flatMap((key, index) => [`${key}=plain-secret-${index}`, `${key}%3Dencoded-secret-${index}`])
      .join('&')
    const result = redactSensitiveValues(input)

    for (let index = 0; index < keys.length; index++) {
      expect(result).not.toContain(`plain-secret-${index}`)
      expect(result).not.toContain(`encoded-secret-${index}`)
    }
  })

  it.concurrent('classifies percent-encoded form keys after bounded decoding', () => {
    const input =
      'api%5Fkey=secret-one&private%2Dkey=secret-two&cl%69ent%5Fsecret=secret-three&display%5Fname=Alice&next%50age%54oken=cursor'

    expect(redactSensitiveValues(input)).toBe(
      'api%5Fkey=[REDACTED]&private%2Dkey=[REDACTED]&cl%69ent%5Fsecret=[REDACTED]&display%5Fname=Alice&next%50age%54oken=cursor'
    )
  })

  it.concurrent('redacts repeatedly encoded authorization keys through their delimiter', () => {
    const input =
      'proxy%252Dauthorization%253DDigest username="user", response="secret"%2526scope%253Dopenid'

    expect(redactSensitiveValues(input)).toBe(
      'proxy%252Dauthorization%253D[REDACTED]%2526scope%253Dopenid'
    )
  })

  it.concurrent('fails closed for malformed or excessively encoded form keys', () => {
    for (const malformedKey of [
      'api%ZZkey',
      'api%G_key',
      'private%2/key',
      'authorization%?%?',
      'authorization%?%3Fscope',
      'api%?%26scope',
      'authorization%FF%3Fscope',
      'api%C0%26scope',
      'api%',
    ]) {
      expect(redactSensitiveValues(`${malformedKey}=secret-one&scope=openid`)).toBe(
        `${malformedKey}=[REDACTED]&scope=openid`
      )
    }
    expect(redactSensitiveValues('api%2525255Fkey=secret-two&scope=openid')).toBe(
      'api%2525255Fkey=[REDACTED]&scope=openid'
    )
    expect(redactSensitiveValues('authorization%E2%82%AC%3Fscope=public&next=ok')).toBe(
      'authorization%E2%82%AC%3Fscope=public&next=ok'
    )
  })

  it.concurrent('preserves safe form keys containing an encoded literal percent', () => {
    expect(redactSensitiveValues('discount%25value=10&scope=openid')).toBe(
      'discount%25value=10&scope=openid'
    )
  })

  it.concurrent('redacts sensitive raw fields nested inside a non-sensitive URL value', () => {
    const input = 'redirect_uri=https://example.com/callback?access_token=raw-secret&scope=openid'

    expect(redactSensitiveValues(input)).toBe(
      'redirect_uri=https://example.com/callback?access_token=[REDACTED]&scope=openid'
    )
  })

  it.concurrent('redacts a raw sensitive value containing an encoded ampersand in full', () => {
    const input = 'access_token=prefix%26secret-tail&scope=openid'

    expect(redactSensitiveValues(input)).toBe('access_token=[REDACTED]&scope=openid')
  })

  it.concurrent(
    'redacts sensitive percent-encoded fields nested inside a non-sensitive URL value',
    () => {
      const input =
        'redirect_uri%3Dhttps%3A%2F%2Fexample.com%2Fcallback%3Faccess_token%3Dencoded-secret%26scope%3Dopenid'

      expect(redactSensitiveValues(input)).toBe(
        'redirect_uri%3Dhttps%3A%2F%2Fexample.com%2Fcallback%3Faccess_token%3D[REDACTED]%26scope%3Dopenid'
      )
    }
  )

  it.concurrent('redacts authorization fields after repeatedly encoded query separators', () => {
    const cases = [
      [
        '%3Fauthorization%3DBearer%20nested-secret%26scope%3Dopenid',
        '%3Fauthorization%3D[REDACTED]%26scope%3Dopenid',
      ],
      [
        '%253Fauthorization%253DBearer%2520nested-secret%2526scope%253Dopenid',
        '%253Fauthorization%253D[REDACTED]%2526scope%253Dopenid',
      ],
      [
        '%25253Fauthorization%25253DBearer%252520nested-secret%252526scope%25253Dopenid',
        '%25253Fauthorization%25253D[REDACTED]%252526scope%25253Dopenid',
      ],
    ]

    for (const [input, expected] of cases) {
      expect(redactSensitiveValues(input)).toBe(expected)
    }
  })

  it.concurrent('redacts authorization fields inside repeatedly encoded URL values', () => {
    let input =
      'redirect_uri=https%3A%2F%2Fexample.com%2Fcallback%3Fauthorization%3DBearer%20nested-secret%26scope%3Dopenid'

    for (let depth = 0; depth < 2; depth++) {
      const result = redactSensitiveValues(input)
      expect(result).not.toContain('nested-secret')
      expect(result).toContain('authorization')
      expect(result).toContain('scope')
      input = encodeURIComponent(input)
    }
  })

  it.concurrent('redacts an encoded nested authorization field after a long safe prefix', () => {
    const prefix = 'x'.repeat(400_000)
    const field = '%3Fauthorization%3DBearer%20nested-secret%26scope%3Dopenid'

    expect(redactSensitiveValues(prefix + field)).toBe(
      `${prefix}%3Fauthorization%3D[REDACTED]%26scope%3Dopenid`
    )
  })

  it.concurrent('does not end a sensitive value at an encoded query separator', () => {
    expect(redactSensitiveValues('access_token=prefix%3Fscope%3Dsecret-tail&next=ok')).toBe(
      'access_token=[REDACTED]&next=ok'
    )
  })

  it.concurrent('preserves safe fields after an encoded query separator', () => {
    const input = 'redirect_uri=https%3A%2F%2Fexample.com%2F%3Fpage%3Dhome%26scope%3Dopenid'
    expect(redactSensitiveValues(input)).toBe(input)
  })

  it.concurrent('preserves non-secret pagination tokens in form-encoded strings', () => {
    const input =
      'nextPageToken=page-one nextPageToken%3Dpage-two nextpagetoken=page-three NEXTPAGETOKEN%3Dpage-four'

    expect(redactSensitiveValues(input)).toBe(input)
  })

  it.concurrent('should redact exact secrets echoed in free-form text', () => {
    const result = redactExactSensitiveValues(
      'provider echoed s3cr%2Ft, s3cr%2ft, space+secret, and plain s3cr/t',
      ['s3cr/t', 'space secret']
    )

    expect(result).not.toContain('s3cr/t')
    expect(result).not.toContain('s3cr%2Ft')
    expect(result).not.toContain('s3cr%2ft')
    expect(result).not.toContain('space+secret')
  })

  it.concurrent('redacts overlapping secrets longest-first', () => {
    const result = redactExactSensitiveValues('provider echoed abcSECRET', ['abc', 'abcSECRET'])

    expect(result).toBe('provider echoed [REDACTED]')
    expect(result).not.toContain('SECRET')
  })

  it.concurrent('redacts mixed-case percent escapes', () => {
    const result = redactExactSensitiveValues('provider echoed %2f%3A', ['/:'])

    expect(result).toBe('provider echoed [REDACTED]')
  })

  it.concurrent('redacts exact secrets through bounded repeated encoding', () => {
    const secret = 'path/secret'
    const encoded = encodeURIComponent(encodeURIComponent(encodeURIComponent(secret)))

    expect(redactExactSensitiveValues(`provider echoed ${encoded}`, [secret])).toBe(
      'provider echoed [REDACTED]'
    )
  })

  it.concurrent(
    'redacts exact secrets containing raw form delimiters before parsing fields',
    () => {
      const secret = 'prefix&secret-tail'

      expect(redactExactSensitiveValues(`echo access_token=${secret}`, [secret])).toBe(
        'echo access_token=[REDACTED]'
      )
    }
  )

  it.concurrent('redacts exact secrets containing whitespace before generic auth parsing', () => {
    const secret = 'password with spaces'

    expect(redactExactSensitiveValues(`Basic ${secret}`, [secret])).toBe('Basic [REDACTED]')
  })

  it.concurrent('leaves text without secrets untouched', () => {
    const input = 'This is a Bear without er suffix: $^.*+?()[]{}|'
    expect(redactSensitiveValues(input)).toBe(input)
  })
})

describe('redactApiKeys', () => {
  it.concurrent('redacts sensitive keys at any depth and truncates base64', () => {
    const result = redactApiKeys({
      apiKey: 'secret-key',
      normalField: 'normal-value',
      base64: 'VGhpcyBpcyBhIHZlcnkgbG9uZyBiYXNlNjQgc3RyaW5n...',
      users: [{ name: 'John', credentials: { apiKey: 'nested-key', username: 'john_doe' } }],
      nestedArray: [[{ password: 'deep' }]],
    })

    expect(result.apiKey).toBe('[REDACTED]')
    expect(result.normalField).toBe('normal-value')
    expect(result.base64).toBe('[TRUNCATED]')
    expect(result.users[0].name).toBe('John')
    expect(result.users[0].credentials.apiKey).toBe('[REDACTED]')
    expect(result.users[0].credentials.username).toBe('john_doe')
    expect(result.nestedArray[0][0].password).toBe('[REDACTED]')
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

    expect(result.processedFiles[0].id).toBe('file-123')
    expect(result.processedFiles[0].url).toBe('http://localhost/api/files/serve/...')
    expect(result.processedFiles[0].base64).toBe('[TRUNCATED]')
    expect(result.processedFiles[0]).not.toHaveProperty('key')
    expect(result.processedFiles[0]).not.toHaveProperty('context')
  })

  it.concurrent('should keep the workspace file version, which names the exposed bytes', () => {
    const result = redactApiKeys({
      files: [
        {
          id: 'file-123',
          name: 'notes.md',
          url: 'http://localhost/api/files/serve/notes.md',
          size: 12,
          type: 'text/markdown',
          key: 'workspace/ws/notes.md',
          context: 'workspace',
          version: 4,
        },
      ],
    })

    expect(result.files[0].version).toBe(4)
    expect(result.files[0]).not.toHaveProperty('key')
  })

  it.concurrent('should not mutate original object', () => {
    const original = { apiKey: 'secret-key', nested: { password: 'secret-password' } }
    const originalCopy = structuredClone(original)
    redactApiKeys(original)
    expect(original).toEqual(originalCopy)
  })
})

describe('sanitizeForLogging', () => {
  it.concurrent('truncates to maxLength (default 100)', () => {
    expect(sanitizeForLogging('a'.repeat(200))).toHaveLength(100)
    expect(sanitizeForLogging('a'.repeat(200), 50)).toHaveLength(50)
  })

  it.concurrent('redacts sensitive patterns', () => {
    const result = sanitizeForLogging('Bearer abc123xyz456')
    expect(result).toContain('[REDACTED]')
    expect(result).not.toContain('abc123xyz456')
  })
})

describe('sanitizeEventData', () => {
  it.concurrent('strips sensitive keys at any depth and redacts string values', () => {
    const result = sanitizeEventData({
      action: 'login',
      apiKey: 'secret-key',
      message: 'Auth: Bearer abc123token',
      user: { id: '123', accessToken: 'secret-token' },
      items: [{ id: 1, apiKey: 'key1' }],
    })

    expect(result.action).toBe('login')
    expect(Object.keys(result)).not.toContain('apiKey')
    expect(result.message).toContain('[REDACTED]')
    expect(result.message).not.toContain('abc123token')
    expect(result.user.id).toBe('123')
    expect(result.user).not.toHaveProperty('accessToken')
    expect(result.items[0].id).toBe(1)
    expect(result.items[0]).not.toHaveProperty('apiKey')
  })

  it.concurrent('redacts a top-level string', () => {
    expect(sanitizeEventData('Bearer secrettoken123')).toContain('[REDACTED]')
  })
})
