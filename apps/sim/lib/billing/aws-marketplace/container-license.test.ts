import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }))

vi.mock('@aws-sdk/client-license-manager', () => ({
  LicenseManagerClient: class {
    send = mockSend
  },
  CheckoutLicenseCommand: class {
    constructor(public input: { ProductSKU: string }) {}
  },
}))
vi.mock('@/lib/core/network/proxy-agent.server', () => ({ awsRequestHandler: () => undefined }))
vi.mock('@sim/utils/random', () => ({ randomInt: (min: number) => min }))

import { applyAwsMarketplaceContainerLicense } from '@/lib/billing/aws-marketplace/container-license'

const MINUTE = 60 * 1000

type Answer =
  | 'entitled'
  | 'NoEntitlementsAllowedException'
  | 'ResourceNotFoundException'
  | 'AccessDeniedException'
  | 'ServerInternalException'

/** License Manager's checkout answers in order; the last one repeats once the list runs out. */
let answers: Answer[] = []
const checkoutRequests: unknown[] = []

function awsError(name: string): Error {
  return Object.assign(new Error(name), { name })
}

function enterpriseEnabled(): boolean {
  return process.env.ENTERPRISE_ENABLED === 'true'
}

describe('applyAwsMarketplaceContainerLicense', () => {
  let kill: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    answers = []
    checkoutRequests.length = 0
    vi.stubEnv('AWS_MARKETPLACE_LICENSE_PRODUCT_SKU', 'product-placeholder')
    kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    mockSend.mockReset()
    mockSend.mockImplementation(async (command: { input: unknown }) => {
      checkoutRequests.push(command.input)
      const answer = answers.length > 1 ? answers.shift() : answers[0]
      if (answer !== 'entitled') throw awsError(answer ?? 'ServerInternalException')
      return { EntitlementsAllowed: [{ Name: 'enterprise_license', Unit: 'None' }] }
    })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    kill.mockRestore()
    Reflect.deleteProperty(process.env, 'ENTERPRISE_ENABLED')
    Reflect.deleteProperty(process.env, 'NEXT_PUBLIC_ENTERPRISE_ENABLED')
  })

  it('does nothing outside a Marketplace install', async () => {
    vi.stubEnv('AWS_MARKETPLACE_LICENSE_PRODUCT_SKU', undefined)
    await applyAwsMarketplaceContainerLicense()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('turns Enterprise on with an uncounted checkout of the entitlement', async () => {
    answers = ['entitled']
    await applyAwsMarketplaceContainerLicense()
    expect(enterpriseEnabled()).toBe(true)
    expect(checkoutRequests).toEqual([
      expect.objectContaining({
        ProductSKU: 'product-placeholder',
        CheckoutType: 'PROVISIONAL',
        KeyFingerprint: 'aws:294406891311:AWS/Marketplace:issuer-fingerprint',
        Entitlements: [{ Name: 'enterprise_license', Unit: 'None' }],
      }),
    ])
  })

  it('runs without Enterprise when no license grants the entitlement', async () => {
    answers = ['NoEntitlementsAllowedException']
    await applyAwsMarketplaceContainerLicense()
    expect(enterpriseEnabled()).toBe(false)
  })

  it('runs without Enterprise when its IAM role cannot check out', async () => {
    answers = ['AccessDeniedException']
    await applyAwsMarketplaceContainerLicense()
    expect(enterpriseEnabled()).toBe(false)
  })

  it.each<Answer>(['NoEntitlementsAllowedException', 'ResourceNotFoundException'])(
    'restarts without Enterprise once the license ends (%s)',
    async (answer) => {
      answers = ['entitled', answer]
      await applyAwsMarketplaceContainerLicense()
      await vi.advanceTimersByTimeAsync(16 * MINUTE)
      expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
    }
  )

  it('restarts into Enterprise once the license becomes active', async () => {
    answers = ['NoEntitlementsAllowedException', 'entitled']
    await applyAwsMarketplaceContainerLicense()
    expect(enterpriseEnabled()).toBe(false)
    await vi.advanceTimersByTimeAsync(16 * MINUTE)
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
  })

  it.each<Answer>(['ServerInternalException', 'AccessDeniedException'])(
    'never restarts a running Enterprise deployment over a failed check (%s)',
    async (answer) => {
      answers = ['entitled', answer]
      await applyAwsMarketplaceContainerLicense()
      await vi.advanceTimersByTimeAsync(6 * 60 * MINUTE)
      expect(kill).not.toHaveBeenCalled()
    }
  )
})
