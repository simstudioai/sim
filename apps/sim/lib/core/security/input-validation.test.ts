import { defaultMockEnv, envFlagsMock, resetEnvFlagsMock, resetEnvMock, setEnv } from '@sim/testing'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  validateAirtableId,
  validateCallbackUrl,
  validateEnum,
  validateExternalUrl,
  validateGoogleCloudLocation,
  validateGoogleCloudProject,
  validateMicrosoftGraphId,
  validateMondayNumericId,
  validateNumericId,
  validatePathSegment,
  validateS3BucketName,
  validateServiceNowInstanceUrl,
  validateSharePointSiteId,
  validateSupabaseProjectId,
} from '@/lib/core/security/input-validation'
import {
  validateAndPinProxyUrl,
  validateDatabaseHost,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'

afterAll(resetEnvFlagsMock)

describe('validatePathSegment', () => {
  it.concurrent('accepts alphanumerics with hyphens and underscores', () => {
    const result = validatePathSegment('test-item_123')
    expect(result.isValid).toBe(true)
    expect(result.sanitized).toBe('test-item_123')
  })

  it.concurrent('rejects a missing value', () => {
    const result = validatePathSegment(null)
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('required')
  })

  it.concurrent.each([
    ['../etc/passwd', 'plain dot-dot'],
    ['%2e%2e%2f', 'URL-encoded'],
    ['%252e%252e', 'double URL-encoded'],
    ['..%2F', 'mixed-case encoded separator'],
  ])('rejects path traversal %s (%s)', (value) => {
    const result = validatePathSegment(value)
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('path traversal')
  })

  it.concurrent.each(['path/to/file', 'path\\to\\file'])(
    'rejects directory separator in %s',
    (value) => {
      const result = validatePathSegment(value)
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('directory separator')
    }
  )

  it.concurrent.each(['file\0name', 'file%00name'])('rejects null byte in %j', (value) => {
    const result = validatePathSegment(value)
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('invalid characters')
  })

  it.concurrent('rejects dots unless allowDots is set', () => {
    expect(validatePathSegment('file.txt').isValid).toBe(false)
    expect(validatePathSegment('file.name.txt', { allowDots: true }).isValid).toBe(true)
  })

  it.concurrent('honours allowHyphens and allowUnderscores = false', () => {
    expect(validatePathSegment('test-item', { allowHyphens: false }).isValid).toBe(false)
    expect(validatePathSegment('test_item', { allowUnderscores: false }).isValid).toBe(false)
  })

  it.concurrent('rejects strings exceeding maxLength', () => {
    const result = validatePathSegment('a'.repeat(300), { maxLength: 255 })
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('exceeds maximum length')
  })

  it.concurrent('uses a custom pattern in place of the default charset', () => {
    const pattern = /^v\d+\.\d+\.\d+$/
    expect(validatePathSegment('v1.2.3', { customPattern: pattern }).isValid).toBe(true)
    expect(validatePathSegment('v1-2-3', { customPattern: pattern }).isValid).toBe(false)
  })
})

describe('validateNumericId', () => {
  it.concurrent('normalizes a number to a string', () => {
    const result = validateNumericId(456)
    expect(result.isValid).toBe(true)
    expect(result.sanitized).toBe('456')
  })

  it.concurrent.each([['abc'], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'rejects non-finite value %s',
    (value) => {
      expect(validateNumericId(value).isValid).toBe(false)
    }
  )

  it.concurrent('enforces inclusive min/max bounds', () => {
    expect(validateNumericId(0, 'value', { min: 1 }).error).toContain('at least 1')
    expect(validateNumericId(101, 'value', { max: 100 }).error).toContain('at most 100')
    expect(validateNumericId(1, 'value', { min: 1, max: 100 }).isValid).toBe(true)
    expect(validateNumericId(100, 'value', { min: 1, max: 100 }).isValid).toBe(true)
  })
})

describe('validateEnum', () => {
  it.concurrent('rejects values outside the list, case-sensitively', () => {
    const allowed = ['note', 'contact', 'task'] as const
    expect(validateEnum('note', allowed, 'type').isValid).toBe(true)
    expect(validateEnum('Note', allowed, 'type').isValid).toBe(false)
    expect(validateEnum('invalid', allowed, 'type').error).toContain('note, contact, task')
  })
})

describe('validateUrlWithDNS', () => {
  it('should reject http:// URLs to a public host', async () => {
    const result = await validateUrlWithDNS('http://example.com', 'url', 'configuredEndpoint')
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('https://')
  })

  it.each(['http://localhost/api', 'http://[::1]/api'])(
    'accepts self-hosted loopback %s',
    async (url) => {
      const result = await validateUrlWithDNS(url, 'url', 'configuredEndpoint')
      expect(result.isValid).toBe(true)
      expect(result.resolvedIP).toBeDefined()
    }
  )

  it('should reject private IP URLs', async () => {
    const result = await validateUrlWithDNS('https://192.168.1.1/api', 'url', 'configuredEndpoint')
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('private or reserved address')
  })

  it('refuses an IP literal outside the configured range without deferring', () => {
    // A literal was judged against its own address, so a lookup could add
    // nothing — deferring it would accept literals outside every range.
    envFlagsMock.egressAllowedIpRanges = '10.0.0.0/8'
    try {
      expect(
        validateExternalUrl('https://192.168.1.1/x', 'url', 'configuredEndpoint').isValid
      ).toBe(false)
      expect(validateExternalUrl('https://10.0.0.5/x', 'url', 'configuredEndpoint').isValid).toBe(
        true
      )
    } finally {
      envFlagsMock.egressAllowedIpRanges = undefined
    }
  })

  it('permits a private IP once the operator allowlists its range', async () => {
    envFlagsMock.egressAllowedIpRanges = '192.168.0.0/16'
    try {
      const result = await validateUrlWithDNS('http://192.168.1.1/api', 'url', 'configuredEndpoint')
      expect(result.isValid).toBe(true)
      expect(result.resolvedIP).toBe('192.168.1.1')
    } finally {
      envFlagsMock.egressAllowedIpRanges = undefined
    }
  })

  it('never lets an allowlisted range reach a content-provenance URL', async () => {
    envFlagsMock.egressAllowedIpRanges = '192.168.0.0/16'
    try {
      const result = await validateUrlWithDNS('https://192.168.1.1/api', 'url', 'contentFetch')
      expect(result.isValid).toBe(false)
    } finally {
      envFlagsMock.egressAllowedIpRanges = undefined
    }
  })

  it('never lets an allowlisted range reach cloud metadata', async () => {
    envFlagsMock.egressAllowedIpRanges = '169.254.0.0/16'
    try {
      const result = await validateUrlWithDNS(
        'http://169.254.169.254/latest/meta-data/',
        'url',
        'configuredEndpoint'
      )
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('metadata')
    } finally {
      envFlagsMock.egressAllowedIpRanges = undefined
    }
  })
})

describe('validateDatabaseHost', () => {
  afterEach(() => {
    envFlagsMock.egressAllowedHosts = undefined
    envFlagsMock.egressAllowedIpRanges = undefined
  })

  describe('default (SSRF guard on)', () => {
    it('rejects localhost', async () => {
      const result = await validateDatabaseHost('localhost')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('loopback')
    })

    it('rejects a literal private IP', async () => {
      const result = await validateDatabaseHost('10.0.0.5')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('private or reserved address')
    })

    it('rejects a bracketed IPv6 loopback as a private IP (not unresolvable)', async () => {
      const result = await validateDatabaseHost('[::1]')
      expect(result.isValid).toBe(false)
      // A database host gets no loopback carve-out: Sim's own datastore is there.
      expect(result.error).toContain('loopback')
    })

    it('accepts a public IP and pins the resolved address', async () => {
      const result = await validateDatabaseHost('1.1.1.1')
      expect(result.isValid).toBe(true)
      expect(result.resolvedIP).toBe('1.1.1.1')
    })
  })

  describe('deprecated ALLOW_PRIVATE_DATABASE_HOSTS alias', () => {
    afterEach(() => {
      envFlagsMock.legacyPrivateDatabaseAccess = false
    })

    it.each([
      ['localhost', 'loopback by name'],
      ['100.64.0.1', 'CGNAT, where a Tailscale host lives'],
    ])('keeps %s reachable for a deployment still on the old flag — %s', async (host) => {
      envFlagsMock.legacyPrivateDatabaseAccess = true
      expect((await validateDatabaseHost(host)).isValid).toBe(true)
    })

    it('still cannot reach cloud metadata through the alias', async () => {
      envFlagsMock.legacyPrivateDatabaseAccess = true
      const result = await validateDatabaseHost('169.254.169.254')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('cloud metadata endpoint')
    })

    it('does not widen HTTP destinations, which the flag never governed', async () => {
      envFlagsMock.legacyPrivateDatabaseAccess = true
      expect(
        (await validateUrlWithDNS('https://10.0.0.5/api', 'url', 'requestTarget')).isValid
      ).toBe(false)
      expect(
        (await validateUrlWithDNS('https://10.0.0.5/api', 'url', 'configuredEndpoint')).isValid
      ).toBe(false)
    })
  })

  describe('self-host opt-in (EGRESS_ALLOWED_HOSTS / EGRESS_ALLOWED_IP_RANGES)', () => {
    beforeEach(() => {
      envFlagsMock.egressAllowedHosts = 'localhost'
      envFlagsMock.egressAllowedIpRanges = '10.0.0.0/8,127.0.0.0/8,::1/128'
    })

    it('allows localhost and still resolves an IP to pin', async () => {
      const result = await validateDatabaseHost('localhost')
      expect(result.isValid).toBe(true)
      expect(result.resolvedIP).toBeDefined()
    })

    it('allows a bracketed IPv6 loopback and pins the unbracketed address', async () => {
      const result = await validateDatabaseHost('[::1]')
      expect(result.isValid).toBe(true)
      expect(result.resolvedIP).toBe('::1')
    })

    it('still surfaces unresolvable hostnames', async () => {
      const result = await validateDatabaseHost('this-host-does-not-exist.invalid')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('could not be resolved')
    })
  })
})

describe('validateAndPinProxyUrl', () => {
  it('should reject a non-http proxy scheme', async () => {
    const result = await validateAndPinProxyUrl('https://proxy.example.com:8080')
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('http://')
  })

  it('should reject a proxy host that is a private IP', async () => {
    const result = await validateAndPinProxyUrl('http://user:pass@192.168.1.1:8080')
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('private or reserved address')
    // The proxy profile honors no allowlist, so the message must not offer one
    // as a remedy — there is nothing the operator could set to permit this.
    expect(result.error).not.toContain('EGRESS_ALLOWED')
  })

  it('should reject a loopback proxy host even off the hosted platform', async () => {
    const localhost = await validateAndPinProxyUrl('http://localhost:3128')
    expect(localhost.isValid).toBe(false)
    expect(localhost.error).toContain('loopback')
  })

  it('should reject a proxy host that is the metadata IP', async () => {
    const result = await validateAndPinProxyUrl('http://169.254.169.254:80')
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('metadata')
  })

  it('rejects a private proxy even when the operator allowlists its range', async () => {
    envFlagsMock.egressAllowedIpRanges = '192.168.0.0/16'
    try {
      const result = await validateAndPinProxyUrl('http://192.168.1.1:8080')
      expect(result.isValid).toBe(false)
    } finally {
      envFlagsMock.egressAllowedIpRanges = undefined
    }
  })

  it('should accept a public proxy host and pin the hostname to the resolved IP, preserving creds/port', async () => {
    const result = await validateAndPinProxyUrl('http://user:pass@8.8.8.8:8080')
    expect(result.isValid).toBe(true)
    const pinned = new URL(result.pinnedProxyUrl!)
    expect(pinned.protocol).toBe('http:')
    expect(pinned.hostname).toBe('8.8.8.8')
    expect(pinned.username).toBe('user')
    expect(pinned.password).toBe('pass')
    expect(pinned.port).toBe('8080')
  })

  it('should bracket an IPv6 resolved address so the pinned host is the IP, not the original name', async () => {
    const result = await validateAndPinProxyUrl('http://user:pass@[2606:4700:4700::1111]:8080')
    expect(result.isValid).toBe(true)
    const pinned = new URL(result.pinnedProxyUrl!)
    expect(pinned.hostname).toBe('[2606:4700:4700::1111]')
    expect(pinned.username).toBe('user')
    expect(pinned.password).toBe('pass')
    expect(pinned.port).toBe('8080')
  })
})

describe('validateMicrosoftGraphId', () => {
  it.concurrent('accepts SharePoint host:path and group path forms', () => {
    expect(validateMicrosoftGraphId('hostname:/sites/sitename').isValid).toBe(true)
    expect(validateMicrosoftGraphId('groups/abc123/sites/root').isValid).toBe(true)
  })

  it.concurrent.each(['../etc/passwd', '%2e%2e%2f', '%252e%252e%252f'])(
    'rejects path traversal %s',
    (value) => {
      const result = validateMicrosoftGraphId(value)
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('path traversal')
    }
  )

  it.concurrent.each(['test\0value', 'test%00value', 'test\nvalue'])(
    'rejects control characters in %j',
    (value) => {
      const result = validateMicrosoftGraphId(value)
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('control characters')
    }
  )
})

describe('validateSharePointSiteId', () => {
  it.concurrent('rejects URL path dot segments', () => {
    expect(validateSharePointSiteId('.').isValid).toBe(false)
    expect(validateSharePointSiteId('..').isValid).toBe(false)
  })

  it.concurrent('accepts compound SharePoint site IDs', () => {
    expect(
      validateSharePointSiteId(
        'contoso.sharepoint.com,2C712604-1370-44E7-A1F5-426573FDA80A,2D2244C3-251A-49EA-93A8-39E1C3A060FE'
      ).isValid
    ).toBe(true)
  })
})

describe('validateExternalUrl', () => {
  it.concurrent('should accept https URLs', () => {
    expect(
      validateExternalUrl('https://api.example.com/v1/data', 'url', 'configuredEndpoint').isValid
    ).toBe(true)
  })

  it.concurrent('should reject http URLs to a public host', () => {
    const result = validateExternalUrl('http://example.com', 'url', 'configuredEndpoint')
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('https://')
  })

  it.concurrent('should reject invalid URLs', () => {
    const result = validateExternalUrl('not-a-url', 'url', 'configuredEndpoint')
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('valid URL')
  })

  it.concurrent.each(['http://localhost/api', 'http://[::1]/api'])(
    'accepts self-hosted loopback %s over http',
    (url) => {
      expect(validateExternalUrl(url, 'url', 'configuredEndpoint').isValid).toBe(true)
    }
  )

  /**
   * The whole 127.0.0.0/8 range is the same machine. Matching only the
   * 127.0.0.1 literal made this validator disagree with MCP's domain-check,
   * which has always used the shared range helper — so the same self-hosted
   * address was localhost to one caller and a plain http URL to the other.
   */
  it.concurrent('should treat the rest of the loopback range as localhost too', () => {
    expect(validateExternalUrl('http://127.1.2.3/api', 'url', 'configuredEndpoint').isValid).toBe(
      true
    )
    // Still only loopback — neighbouring private ranges stay rejected.
    expect(validateExternalUrl('http://10.0.0.1/api', 'url', 'configuredEndpoint').isValid).toBe(
      false
    )
  })

  it.concurrent.each(['https://0.0.0.0/api', 'https://172.16.0.1/api'])(
    'rejects reserved address %s',
    (url) => {
      const result = validateExternalUrl(url, 'url', 'configuredEndpoint')
      expect(result.isValid).toBe(false)
      expect(result.error).toContain('private or reserved address')
    }
  )

  it.concurrent('gives cloud metadata its own refusal', () => {
    const result = validateExternalUrl('https://169.254.169.254/api', 'url', 'configuredEndpoint')
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('cloud metadata endpoint')
  })

  it.concurrent('should reject blocked ports', () => {
    const result = validateExternalUrl('https://example.com:6379/api', 'url', 'configuredEndpoint')
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('blocked port')
  })
})

describe('validateAirtableId', () => {
  it.concurrent('accepts a prefixed 14-character id', () => {
    const result = validateAirtableId('appABCDEFGHIJKLMN', 'app', 'baseId')
    expect(result.isValid).toBe(true)
    expect(result.sanitized).toBe('appABCDEFGHIJKLMN')
  })

  it.concurrent.each([
    ['tblABCDEFGHIJKLMN', 'wrong prefix'],
    ['appABCDEFGHIJKLM', 'too short'],
    ['appABCDEFGHIJKLMNO', 'too long'],
    ['appABCDEFGH/JKLMN', 'path character'],
  ])('rejects %s (%s)', (value) => {
    expect(validateAirtableId(value, 'app', 'baseId').isValid).toBe(false)
  })
})

describe('validateGoogleCloudLocation', () => {
  it.concurrent.each(['us-central1', 'northamerica-northeast1', 'global'])(
    'should accept %s',
    (location) => {
      expect(validateGoogleCloudLocation(location).isValid).toBe(true)
    }
  )

  it.concurrent.each([
    'attacker.example.com/x',
    'us-central1:8080',
    'user@attacker.tld',
    'us-central1\n',
    '../us-central1',
  ])('should reject hostname injection %j', (location) => {
    expect(validateGoogleCloudLocation(location).isValid).toBe(false)
  })
})

describe('validateGoogleCloudProject', () => {
  it.concurrent.each(['my-project', '123456789012'])('should accept %s', (project) => {
    expect(validateGoogleCloudProject(project).isValid).toBe(true)
  })

  it.concurrent.each(['my-project/../../other', 'my-project:alias', '1project', 'a'.repeat(31)])(
    'should reject %j',
    (project) => {
      expect(validateGoogleCloudProject(project).isValid).toBe(false)
    }
  )
})

describe('validateS3BucketName', () => {
  it.concurrent('accepts a dotted name at the length bounds', () => {
    expect(validateS3BucketName('my.bucket.name').isValid).toBe(true)
    expect(validateS3BucketName('abc').isValid).toBe(true)
    expect(validateS3BucketName('a'.repeat(63)).isValid).toBe(true)
  })

  it.concurrent('rejects names outside 3–63 characters', () => {
    expect(validateS3BucketName('ab').error).toContain('between 3 and 63')
    expect(validateS3BucketName('a'.repeat(64)).error).toContain('between 3 and 63')
  })

  it.concurrent.each(['MyBucket', '-mybucket', 'mybucket.', 'my@bucket'])(
    'rejects malformed name %s',
    (value) => {
      expect(validateS3BucketName(value).isValid).toBe(false)
    }
  )

  it.concurrent('rejects consecutive periods', () => {
    expect(validateS3BucketName('my..bucket').error).toContain('consecutive periods')
  })

  it.concurrent('rejects IP address format', () => {
    expect(validateS3BucketName('192.168.1.1').error).toContain('IP address')
  })
})

describe('validateMondayNumericId', () => {
  it.concurrent('trims and stringifies numeric input', () => {
    expect(validateMondayNumericId(' 12345 ', 'boardId').sanitized).toBe('12345')
    expect(validateMondayNumericId(1234567890, 'boardId').sanitized).toBe('1234567890')
  })

  it.concurrent.each(['1234]) { subscribers { id } } #', '-1', '12.34'])(
    'rejects non-integer %s',
    (value) => {
      expect(validateMondayNumericId(value).isValid).toBe(false)
    }
  )
})

describe('validateCallbackUrl', () => {
  const ORIGIN = 'https://sim.app'
  const originalWindow = (globalThis as { window?: unknown }).window

  beforeEach(() => {
    ;(globalThis as { window?: unknown }).window = {
      location: { origin: ORIGIN },
    }
  })

  afterEach(() => {
    resetEnvMock()
    if (originalWindow === undefined) {
      ;(globalThis as { window?: unknown }).window = undefined
    } else {
      ;(globalThis as { window?: unknown }).window = originalWindow
    }
  })

  it.each([['/invite/abc?foo=bar&baz=qux'], ['?reset=true'], ['HTTPS://SIM.APP/foo']])(
    'accepts same-origin %s',
    (url) => {
      expect(validateCallbackUrl(url)).toBe(true)
    }
  )

  it.each([
    ['', 'empty string'],
    ['//evil.com', 'protocol-relative'],
    ['/\\evil.com', 'backslash protocol-relative'],
    ['/\t/evil.com', 'tab-stripped protocol-relative'],
    ['https://evil.com', 'cross-origin absolute URL'],
    ['https://sim.app@evil.com', 'userinfo smuggling'],
    ['https://sim.app.evil.com', 'subdomain confusion'],
    ['https://sim.app:3001/foo', 'different port'],
    ['http://sim.app/foo', 'different protocol'],
    ['javascript:alert(1)', 'javascript scheme'],
  ])('rejects %s (%s)', (url) => {
    expect(validateCallbackUrl(url)).toBe(false)
  })

  describe('server-side (no window)', () => {
    beforeEach(() => {
      ;(globalThis as { window?: unknown }).window = undefined
    })

    it('resolves against the configured app origin and still rejects cross-origin URLs', () => {
      expect(validateCallbackUrl('/workspace')).toBe(true)
      expect(validateCallbackUrl('//evil.com')).toBe(false)
      expect(validateCallbackUrl('https://evil.com')).toBe(false)
      expect(validateCallbackUrl('javascript:alert(1)')).toBe(false)
    })

    /**
     * The server verdict has to match what the browser will decide once it
     * hydrates, or a callback URL derived during render yields one destination
     * in the SSR markup and another after hydration.
     */
    it('accepts an absolute same-origin URL, matching the browser verdict', () => {
      expect(validateCallbackUrl(`${defaultMockEnv.NEXT_PUBLIC_APP_URL}/workspace/abc`)).toBe(true)
    })

    it('stays fail-closed on absolute URLs when the app URL is unset', () => {
      setEnv({ NEXT_PUBLIC_APP_URL: undefined })

      expect(validateCallbackUrl(`${defaultMockEnv.NEXT_PUBLIC_APP_URL}/workspace/abc`)).toBe(false)
      expect(validateCallbackUrl('/workspace')).toBe(true)
    })
  })
})

describe('validateServiceNowInstanceUrl (vendor-hosted allowlist)', () => {
  it.concurrent('accepts an allowlisted vendor subdomain', () => {
    const result = validateServiceNowInstanceUrl('https://acme.servicenowservices.com/api/now')
    expect(result.isValid).toBe(true)
    expect(result.sanitized).toBe('https://acme.servicenowservices.com/api/now')
  })

  it.concurrent.each([
    ['https://support.acme.com', 'vanity CNAME'],
    ['https://acme.service-now.com.evil.com', 'lookalike suffix'],
    ['https://evilservice-now.com', 'near-miss domain'],
    ['https://acme.service-now.com@evil.com', 'userinfo smuggling'],
  ])('rejects %s (%s)', (url) => {
    const result = validateServiceNowInstanceUrl(url)
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('ServiceNow-hosted domain')
  })

  it.concurrent('requires https:// even for an allowlisted host', () => {
    const result = validateServiceNowInstanceUrl('http://acme.service-now.com')
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('https://')
  })

  it.concurrent('still applies the egress policy before the allowlist', () => {
    const result = validateServiceNowInstanceUrl('https://192.168.1.1')
    expect(result.isValid).toBe(false)
    expect(result.error).toContain('private or reserved address')
  })
})

describe('validateSupabaseProjectId', () => {
  it.concurrent('accepts lowercase alphanumerics within 10–40 characters', () => {
    expect(validateSupabaseProjectId('abc123def456ghi789jk').isValid).toBe(true)
    expect(validateSupabaseProjectId('abcdefghij').isValid).toBe(true)
    expect(validateSupabaseProjectId('a'.repeat(40)).isValid).toBe(true)
  })

  it.concurrent.each([
    'evil#attacker.com',
    'evil.attacker.com',
    'evil\r\nHost: attacker.com',
    'JDRKGEPADSDOPSNTDLOM',
    'abcdefghi',
    'a'.repeat(41),
  ])('rejects %j', (value) => {
    expect(validateSupabaseProjectId(value).isValid).toBe(false)
  })
})
