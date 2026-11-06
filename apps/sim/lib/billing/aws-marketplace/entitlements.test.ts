import type { Entitlement } from '@aws-sdk/client-marketplace-entitlement-service'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }))

vi.mock('@aws-sdk/client-marketplace-entitlement-service', () => ({
  MarketplaceEntitlementServiceClient: class {
    send = mockSend
  },
  GetEntitlementsCommand: class {
    constructor(public input: { NextToken?: string }) {}
  },
}))

import { verifyLicense } from '@/lib/billing/aws-marketplace/entitlements'

const PRODUCT = 'product-placeholder'
const LICENSE = 'license-placeholder'
const NOW = new Date('2026-06-01T00:00:00.000Z')

function entitlement(overrides: Partial<Entitlement> = {}): Entitlement {
  return {
    ProductCode: PRODUCT,
    Dimension: 'enterprise',
    Value: { IntegerValue: 25 },
    ...overrides,
  }
}

function read(...entitlements: Entitlement[]) {
  mockSend.mockResolvedValueOnce({ Entitlements: entitlements })
  return verifyLicense(PRODUCT, LICENSE)
}

describe('verifyLicense', () => {
  beforeEach(() => {
    mockSend.mockReset()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads an entitlement that expired before now as inactive', async () => {
    const summary = await read(
      entitlement({ ExpirationDate: new Date('2026-05-31T23:59:59.000Z') })
    )
    expect(summary).toMatchObject({ active: false, entitlementCount: 1, quantity: 25 })
  })

  it('reads an entitlement with a future expiry, or none at all, as active', async () => {
    const future = entitlement({ ExpirationDate: new Date('2027-06-01T00:00:00.000Z') })
    expect((await read(future)).active).toBe(true)
    expect((await read(entitlement())).active).toBe(true)
  })

  it('treats an entitlement expiring exactly now as lapsed', async () => {
    expect((await read(entitlement({ ExpirationDate: NOW }))).active).toBe(false)
  })

  it('reads the same lapsed dimension whichever order AWS returns ties in', async () => {
    const expired = new Date('2026-01-01T00:00:00.000Z')
    const alpha = entitlement({ Dimension: 'alpha', ExpirationDate: expired })
    const zeta = entitlement({ Dimension: 'zeta', ExpirationDate: expired })

    expect((await read(alpha, zeta)).dimension).toBe('alpha')
    expect((await read(zeta, alpha)).dimension).toBe('alpha')
  })

  it('describes the current entitlement when another one has lapsed', async () => {
    const summary = await read(
      entitlement({
        Dimension: 'a-lapsed',
        ExpirationDate: new Date('2026-01-01T00:00:00.000Z'),
        Value: { IntegerValue: 5 },
      }),
      entitlement({
        Dimension: 'b-current',
        ExpirationDate: new Date('2027-01-01T00:00:00.000Z'),
        Value: { IntegerValue: 50 },
      })
    )
    expect(summary).toMatchObject({ active: true, dimension: 'b-current', quantity: 50 })
  })

  it('reads quantity only from an integer value, never from another value kind', async () => {
    expect((await read(entitlement({ Value: { DoubleValue: 1200.5 } }))).quantity).toBeNull()
  })

  it('follows NextToken through an empty page to the last one', async () => {
    mockSend
      .mockResolvedValueOnce({ Entitlements: [entitlement({ Dimension: 'one' })], NextToken: 't1' })
      .mockResolvedValueOnce({ Entitlements: [], NextToken: 't2' })
      .mockResolvedValueOnce({ Entitlements: [entitlement({ Dimension: 'two' })] })

    const summary = await verifyLicense(PRODUCT, LICENSE)

    expect(summary).toMatchObject({ entitlementCount: 2, dimension: 'one' })
    expect(mockSend.mock.calls.map(([command]) => command.input.NextToken)).toEqual([
      undefined,
      't1',
      't2',
    ])
  })
})
