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

import {
  fetchLicenseEntitlements,
  summarizeEntitlements,
} from '@/lib/billing/aws-marketplace/entitlements'

const PRODUCT = 'product-placeholder'
const LICENSE = 'license-placeholder'
const NOW = new Date('2026-06-01T00:00:00.000Z')

function entitlement(overrides: Partial<Entitlement> = {}): Entitlement {
  return {
    ProductCode: PRODUCT,
    Dimension: 'enterprise',
    CustomerIdentifier: 'customer-placeholder',
    Value: { IntegerValue: 25 },
    ...overrides,
  }
}

function awsError(name: string, status: number): Error {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } })
}

describe('summarizeEntitlements', () => {
  it('reads an entitlement that expired before now as inactive', () => {
    const summary = summarizeEntitlements(
      [entitlement({ ExpirationDate: new Date('2026-05-31T23:59:59.000Z') })],
      PRODUCT,
      NOW
    )
    expect(summary).toMatchObject({ active: false, entitlementCount: 1, quantity: 25 })
  })

  it('reads an entitlement with a future expiry, or none at all, as active', () => {
    expect(
      summarizeEntitlements(
        [entitlement({ ExpirationDate: new Date('2027-06-01T00:00:00.000Z') })],
        PRODUCT,
        NOW
      ).active
    ).toBe(true)
    expect(summarizeEntitlements([entitlement()], PRODUCT, NOW).active).toBe(true)
  })

  it('treats an entitlement expiring exactly now as lapsed', () => {
    expect(summarizeEntitlements([entitlement({ ExpirationDate: NOW })], PRODUCT, NOW).active).toBe(
      false
    )
  })

  it('ignores an entitlement for another product', () => {
    const summary = summarizeEntitlements(
      [entitlement({ ProductCode: 'other-product' })],
      PRODUCT,
      NOW
    )
    expect(summary).toMatchObject({ active: false, entitlementCount: 0, dimension: null })
  })

  it('describes the current entitlement when another one has lapsed', () => {
    const summary = summarizeEntitlements(
      [
        entitlement({
          Dimension: 'a-lapsed',
          ExpirationDate: new Date('2026-01-01T00:00:00.000Z'),
          Value: { IntegerValue: 5 },
        }),
        entitlement({
          Dimension: 'b-current',
          ExpirationDate: new Date('2027-01-01T00:00:00.000Z'),
          Value: { IntegerValue: 50 },
        }),
      ],
      PRODUCT,
      NOW
    )
    expect(summary).toMatchObject({ active: true, dimension: 'b-current', quantity: 50 })
  })

  it('reads quantity only from an integer value, never from another value kind', () => {
    expect(
      summarizeEntitlements([entitlement({ Value: { DoubleValue: 1200.5 } })], PRODUCT, NOW)
        .quantity
    ).toBeNull()
    expect(
      summarizeEntitlements([entitlement({ Value: { IntegerValue: 2.5 } })], PRODUCT, NOW).quantity
    ).toBeNull()
  })
})

describe('fetchLicenseEntitlements', () => {
  beforeEach(() => {
    mockSend.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('follows NextToken through an empty page to the last one', async () => {
    mockSend
      .mockResolvedValueOnce({ Entitlements: [entitlement({ Dimension: 'one' })], NextToken: 't1' })
      .mockResolvedValueOnce({ Entitlements: [], NextToken: 't2' })
      .mockResolvedValueOnce({ Entitlements: [entitlement({ Dimension: 'two' })] })

    const entitlements = await fetchLicenseEntitlements(PRODUCT, LICENSE)

    expect(entitlements.map((row) => row.Dimension)).toEqual(['one', 'two'])
    expect(mockSend.mock.calls.map(([command]) => command.input.NextToken)).toEqual([
      undefined,
      't1',
      't2',
    ])
  })

  it('retries a throttled page and returns once it succeeds', async () => {
    mockSend
      .mockRejectedValueOnce(awsError('ThrottlingException', 400))
      .mockRejectedValueOnce(awsError('InternalServiceErrorException', 500))
      .mockResolvedValueOnce({ Entitlements: [entitlement()] })

    const pending = fetchLicenseEntitlements(PRODUCT, LICENSE)
    await vi.runAllTimersAsync()

    expect(await pending).toHaveLength(1)
    expect(mockSend).toHaveBeenCalledTimes(3)
  })

  it('gives up after three throttled attempts', async () => {
    mockSend.mockRejectedValue(awsError('ThrottlingException', 400))

    const pending = fetchLicenseEntitlements(PRODUCT, LICENSE).catch((error: unknown) => error)
    await vi.runAllTimersAsync()

    expect(await pending).toMatchObject({ name: 'ThrottlingException' })
    expect(mockSend).toHaveBeenCalledTimes(3)
  })

  it('does not retry a request the service rejected as invalid', async () => {
    mockSend.mockRejectedValue(awsError('InvalidParameterException', 400))

    await expect(fetchLicenseEntitlements(PRODUCT, LICENSE)).rejects.toMatchObject({
      name: 'InvalidParameterException',
    })
    expect(mockSend).toHaveBeenCalledTimes(1)
  })
})
