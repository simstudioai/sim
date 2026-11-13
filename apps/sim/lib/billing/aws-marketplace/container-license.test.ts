import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }))

vi.mock('@aws-sdk/client-license-manager', () => ({
  LicenseManagerClient: class {
    send = mockSend
  },
  CheckoutLicenseCommand: class {
    constructor(public input: { ProductSKU: string }) {}
  },
  CheckInLicenseCommand: class {
    constructor(public input: { LicenseConsumptionToken: string }) {}
  },
}))
vi.mock('@/lib/core/network/proxy-agent.server', () => ({ awsRequestHandler: () => undefined }))
vi.mock('@sim/utils/random', () => ({ randomInt: (min: number) => min }))

import { CheckInLicenseCommand } from '@aws-sdk/client-license-manager'
import { applyAwsMarketplaceContainerLicense } from '@/lib/billing/aws-marketplace/container-license'

const MINUTE = 60 * 1000
const TOKEN = 'consumption-token-placeholder'

type Answer =
  | 'entitled'
  | 'NoEntitlementsAllowedException'
  | 'AccessDeniedException'
  | 'ServerInternalException'

/** License Manager's checkout answers in order; the last one repeats once the list runs out. */
let answers: Answer[] = []
let checkInFails = false
const checkoutRequests: unknown[] = []
const checkIns: Array<string | undefined> = []

function awsError(name: string): Error {
  return Object.assign(new Error(name), { name })
}

function enterpriseEnabled(): boolean {
  return process.env.ENTERPRISE_ENABLED === 'true'
}

async function boot(): Promise<void> {
  const started = applyAwsMarketplaceContainerLicense()
  await vi.advanceTimersByTimeAsync(30_000)
  await started
}

describe('applyAwsMarketplaceContainerLicense', () => {
  let kill: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    answers = []
    checkInFails = false
    checkIns.length = 0
    checkoutRequests.length = 0
    vi.stubEnv('AWS_MARKETPLACE_LICENSE_PRODUCT_SKU', 'product-placeholder')
    kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    mockSend.mockReset()
    mockSend.mockImplementation(async (command: unknown) => {
      if (command instanceof CheckInLicenseCommand) {
        checkIns.push(command.input.LicenseConsumptionToken)
        if (checkInFails) throw awsError('ServerInternalException')
        return {}
      }
      checkoutRequests.push((command as { input: unknown }).input)
      const answer = answers.length > 1 ? answers.shift() : answers[0]
      if (answer !== 'entitled') throw awsError(answer ?? 'ServerInternalException')
      return {
        LicenseConsumptionToken: TOKEN,
        EntitlementsAllowed: [{ Name: 'enterprise_license', Unit: 'Count', Value: '1' }],
      }
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
    await boot()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('turns Enterprise on and returns the unit it checked out', async () => {
    answers = ['entitled']
    await boot()
    expect(enterpriseEnabled()).toBe(true)
    expect(checkoutRequests).toEqual([
      expect.objectContaining({
        ProductSKU: 'product-placeholder',
        CheckoutType: 'PROVISIONAL',
        KeyFingerprint: 'aws:294406891311:AWS/Marketplace:issuer-fingerprint',
        Entitlements: [{ Name: 'enterprise_license', Value: '1', Unit: 'Count' }],
      }),
    ])
    expect(checkIns).toEqual([TOKEN])
  })

  it('keeps an active license when returning the unit fails', async () => {
    answers = ['entitled']
    checkInFails = true
    await boot()
    expect(enterpriseEnabled()).toBe(true)
  })

  it('retries a unit another replica is holding at startup', async () => {
    answers = ['NoEntitlementsAllowedException', 'entitled']
    await boot()
    expect(enterpriseEnabled()).toBe(true)
  })

  it('runs without Enterprise when no unit is allowed at startup', async () => {
    answers = ['NoEntitlementsAllowedException']
    await boot()
    expect(enterpriseEnabled()).toBe(false)
  })

  it('runs without Enterprise when its IAM role cannot check out', async () => {
    answers = ['AccessDeniedException']
    await boot()
    expect(enterpriseEnabled()).toBe(false)
  })

  it('keeps Enterprise on through a unit held elsewhere for up to an hour', async () => {
    answers = ['entitled', ...Array<Answer>(5).fill('NoEntitlementsAllowedException'), 'entitled']
    await boot()
    await vi.advanceTimersByTimeAsync(180 * MINUTE)
    expect(kill).not.toHaveBeenCalled()
  })

  it('restarts without Enterprise once no entitlement outlasts any held unit', async () => {
    answers = ['entitled', 'NoEntitlementsAllowedException']
    await boot()
    await vi.advanceTimersByTimeAsync(85 * MINUTE)
    expect(kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10 * MINUTE)
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
  })

  it('does not count failed checks toward switching Enterprise off', async () => {
    answers = [
      'entitled',
      'NoEntitlementsAllowedException',
      ...Array<Answer>(6).fill('ServerInternalException'),
      'NoEntitlementsAllowedException',
      'entitled',
    ]
    await boot()
    await vi.advanceTimersByTimeAsync(130 * MINUTE)
    expect(kill).not.toHaveBeenCalled()
  })

  it('never restarts a running Enterprise deployment over a permission failure', async () => {
    answers = ['entitled', 'AccessDeniedException']
    await boot()
    await vi.advanceTimersByTimeAsync(6 * 60 * MINUTE)
    expect(kill).not.toHaveBeenCalled()
  })

  it('restarts into Enterprise once the license becomes active', async () => {
    answers = [...Array<Answer>(3).fill('NoEntitlementsAllowedException'), 'entitled']
    await boot()
    expect(enterpriseEnabled()).toBe(false)
    await vi.advanceTimersByTimeAsync(16 * MINUTE)
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
  })
})
