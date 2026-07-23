import { describe, expect, it } from 'vitest'
import { compileAllowlist, isAddressAllowed, isValidCidrEntry } from './network'

describe('isValidCidrEntry', () => {
  it.each([
    '192.0.2.10',
    '10.0.0.0/16',
    '0.0.0.0/0',
    '255.255.255.255/32',
    '2001:db8::1',
    '2001:db8::/48',
    '::1',
    '::/0',
    '::ffff:192.0.2.1',
    ' 10.0.0.0/24 ',
    '10.0.0.0/16 # Frankfurt VPN',
    '203.0.113.7 #office',
  ])('accepts %s', (entry) => {
    expect(isValidCidrEntry(entry)).toBe(true)
  })

  it.each([
    '',
    'banana',
    '10.0.0/8',
    '10.0.0.256',
    '10.0.0.0/33',
    '10.0.0.0/-1',
    '10.0.0.0/8/8',
    '2001:db8::/129',
    '2001:db8:::1',
    '1:2:3:4:5:6:7:8:9',
    '10.0.0.0/1.5',
    'fe80::%eth0',
    '# label only',
    'banana # labelled garbage',
  ])('rejects %s', (entry) => {
    expect(isValidCidrEntry(entry)).toBe(false)
  })
})

describe('isAddressAllowed', () => {
  const allowlist = compileAllowlist(['10.0.0.0/16', '192.0.2.10', '2001:db8::/48', '::1'])

  it.each([
    ['10.0.0.1', true],
    ['10.0.255.255', true],
    ['10.1.0.0', false],
    ['192.0.2.10', true],
    ['192.0.2.11', false],
    ['2001:db8::1', true],
    ['2001:db8:0:ffff::1', true],
    ['2001:db8:1::1', false],
    ['::1', true],
    ['::2', false],
    ['not-an-ip', false],
    ['', false],
  ])('%s → %s', (address, expected) => {
    expect(isAddressAllowed(address, allowlist)).toBe(expected)
  })

  it('matches IPv4-mapped IPv6 client addresses against v4 entries', () => {
    expect(isAddressAllowed('::ffff:10.0.5.5', allowlist)).toBe(true)
    expect(isAddressAllowed('::ffff:10.1.0.1', allowlist)).toBe(false)
  })

  it('treats /0 as match-all for its family only', () => {
    const v4All = compileAllowlist(['0.0.0.0/0'])
    expect(isAddressAllowed('203.0.113.7', v4All)).toBe(true)
    expect(isAddressAllowed('2001:db8::1', v4All)).toBe(false)

    const v6All = compileAllowlist(['::/0'])
    expect(isAddressAllowed('2001:db8::1', v6All)).toBe(true)
    expect(isAddressAllowed('203.0.113.7', v6All)).toBe(false)
  })

  it('drops malformed entries at compile time without matching everything', () => {
    const compiled = compileAllowlist(['banana', '10.0.0.0/16'])
    expect(compiled.v4).toHaveLength(1)
    expect(isAddressAllowed('10.0.0.1', compiled)).toBe(true)
    expect(isAddressAllowed('203.0.113.7', compiled)).toBe(false)
  })

  it('labels never affect matching', () => {
    const labelled = compileAllowlist(['10.0.0.0/16 # Frankfurt VPN'])
    expect(isAddressAllowed('10.0.5.5', labelled)).toBe(true)
    expect(isAddressAllowed('11.0.0.1', labelled)).toBe(false)
  })

  it('never matches against an empty allowlist', () => {
    const empty = compileAllowlist([])
    expect(isAddressAllowed('10.0.0.1', empty)).toBe(false)
    expect(isAddressAllowed('2001:db8::1', empty)).toBe(false)
  })
})
