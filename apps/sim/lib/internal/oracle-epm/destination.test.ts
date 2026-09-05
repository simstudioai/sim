/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  defineOracleEpmDestination,
  getOracleEpmDestination,
  normalizeOracleEpmDestination,
} from '@/lib/internal/oracle-epm/destination'
import type { OracleEpmDestination } from '@/lib/internal/oracle-epm/types'

describe('Oracle EPM destination', () => {
  it('normalizes and preserves a credential-owned gateway base path', () => {
    expect(normalizeOracleEpmDestination(' https://EPM.example.com/gateway/acme/ ')).toBe(
      'https://epm.example.com/gateway/acme'
    )
    const destination = defineOracleEpmDestination('https://epm.example.com/gateway/acme')
    expect(Object.isFrozen(destination)).toBe(true)
    expect(getOracleEpmDestination(destination)).toMatchObject({
      origin: 'https://epm.example.com',
      baseSegments: ['gateway', 'acme'],
    })
  })

  it('round-trips canonical percent-encoding in a credential-owned base path', () => {
    const normalized = normalizeOracleEpmDestination(
      'https://epm.example.com/gateway/My Folder/日本'
    )
    expect(normalized).toBe('https://epm.example.com/gateway/My%20Folder/%E6%97%A5%E6%9C%AC')
    expect(normalizeOracleEpmDestination(normalized)).toBe(normalized)
  })

  it.each([
    'http://epm.example.com',
    'https://user@epm.example.com',
    'https://epm.example.com?token=secret',
    'https://epm.example.com/#fragment',
    'https://epm.example.com/%2e%2e/admin',
    'https://epm.example.com/%252e%252e/admin',
    'https://epm.example.com/a%2Fb',
    'https:////epm.example.com/gateway',
    'https://epm.example.com/a\\b',
    'https://epm.example.com/gateway/\uD800',
    'https://epm.example.com/gateway/\uDC00',
  ])('rejects unsafe destination %j', (value) => {
    expect(() => defineOracleEpmDestination(value)).toThrow()
  })

  it('rejects forged destination objects', () => {
    expect(() => getOracleEpmDestination({} as OracleEpmDestination)).toThrow(
      'not a valid declaration'
    )
  })
})
