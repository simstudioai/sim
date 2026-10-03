/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildOracleFusionResourcePath } from '@/lib/internal/oracle-fusion/paths'

describe('buildOracleFusionResourcePath', () => {
  it.each([
    ['hcm', 'workers', '/hcmRestApi/resources/11.13.18.05/workers'],
    ['fscm', 'invoices/123', '/fscmRestApi/resources/11.13.18.05/invoices/123'],
    ['crm', 'opportunities', '/crmRestApi/resources/11.13.18.05/opportunities'],
  ] as const)('builds the fixed %s resource root', (family, relativePath, expected) => {
    expect(buildOracleFusionResourcePath({ family, relativePath })).toBe(expected)
  })

  it('preserves safe URL encoding in an opaque path segment', () => {
    expect(
      buildOracleFusionResourcePath({ family: 'hcm', relativePath: 'workers/key%252Fpart' })
    ).toBe('/hcmRestApi/resources/11.13.18.05/workers/key%252Fpart')
  })

  it.each([
    '',
    ' workers',
    'workers ',
    'workers/bad key',
    '/workers',
    '//evil.example/workers',
    'https://evil.example/workers',
    'workers//assignments',
    'workers/',
    'workers/../users',
    'workers/./users',
    'workers\\users',
    'workers?limit=1',
    'workers#fragment',
    'workers/%2e%2e/users',
    'workers/%2Fusers',
    'workers/%5cusers',
    'workers/%3Fquery',
    'workers/%23fragment',
    'workers/%00control',
    'workers/%E0%A4%A',
    'workers/\ud800',
  ])('rejects the unsafe relative path %j', (relativePath) => {
    expect(() => buildOracleFusionResourcePath({ family: 'hcm', relativePath })).toThrow(
      /resource path/
    )
  })
})
