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
import {
  type AwsMarketplaceProduct,
  parseAwsMarketplaceProducts,
} from '@/lib/billing/aws-marketplace/products'

const PRODUCTS = parseAwsMarketplaceProducts(
  'product-placeholder=contract,usage-product-placeholder=platform-with-usage'
)

function product(code: string): AwsMarketplaceProduct {
  const found = PRODUCTS.get(code)
  if (!found) throw new Error(`no test product ${code}`)
  return found
}

const CONTRACT = product('product-placeholder')
const USAGE = product('usage-product-placeholder')
const LICENSE = 'license-placeholder'
const NOW = new Date('2026-06-01T00:00:00.000Z')

function entitlement(overrides: Partial<Entitlement> = {}): Entitlement {
  return {
    ProductCode: CONTRACT.productCode,
    Dimension: 'enterprise',
    Value: { IntegerValue: 25 },
    ...overrides,
  }
}

function readAs(product: AwsMarketplaceProduct, ...entitlements: Entitlement[]) {
  mockSend.mockResolvedValueOnce({ Entitlements: entitlements })
  return verifyLicense(product, LICENSE)
}

function read(...entitlements: Entitlement[]) {
  return readAs(CONTRACT, ...entitlements)
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
    expect(summary).toMatchObject({ active: false, accessReported: true, quantity: 25 })
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

  it('reads a usage entitlement alone as no answer about access, not as access', async () => {
    const summary = await readAs(USAGE, entitlement({ Dimension: 'llm_credits' }))
    expect(summary).toMatchObject({
      active: false,
      licenseSeen: true,
      accessReported: false,
      dimension: null,
    })
  })

  it('reads a lapsed platform as inactive even while usage is current', async () => {
    const summary = await readAs(
      USAGE,
      entitlement({ Dimension: 'llm_credits' }),
      entitlement({ Dimension: 'platform', ExpirationDate: new Date('2026-01-01T00:00:00.000Z') })
    )
    expect(summary).toMatchObject({ active: false, accessReported: true, dimension: 'platform' })
  })

  it('reads a current platform as active and describes it, not the usage dimension', async () => {
    const summary = await readAs(
      USAGE,
      entitlement({ Dimension: 'llm_credits', Value: { IntegerValue: 7 } }),
      entitlement({ Dimension: 'platform', Value: { IntegerValue: 1 } })
    )
    expect(summary).toMatchObject({ active: true, dimension: 'platform', quantity: 1 })
  })

  it('reads quantity only from an integer value, never from another value kind', async () => {
    expect((await read(entitlement({ Value: { DoubleValue: 1200.5 } }))).quantity).toBeNull()
  })

  it('follows NextToken through an empty page to the last one', async () => {
    mockSend
      .mockResolvedValueOnce({ Entitlements: [entitlement({ Dimension: 'one' })], NextToken: 't1' })
      .mockResolvedValueOnce({ Entitlements: [], NextToken: 't2' })
      .mockResolvedValueOnce({ Entitlements: [entitlement({ Dimension: 'two' })] })

    const summary = await verifyLicense(CONTRACT, LICENSE)

    expect(summary).toMatchObject({ accessReported: true, dimension: 'one' })
    expect(mockSend.mock.calls.map(([command]) => command.input.NextToken)).toEqual([
      undefined,
      't1',
      't2',
    ])
  })
})
