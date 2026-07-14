/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  fingerprintDesiredWebhookRegistration,
  normalizeWebhookRegistrationPath,
} from '@/lib/webhooks/registration-identity'

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length <= 1) return [[...values]]

  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((rest) => [
      value,
      ...rest,
    ])
  )
}

const BASE_IDENTITY = {
  provider: 'example',
  path: 'events/incoming',
  routingKey: 'tenant-1',
} as const

describe('fingerprintDesiredWebhookRegistration', () => {
  it('is invariant across deep object key orderings', () => {
    const outerEntries = [
      ['enabled', false],
      ['filter', { zeta: 0, alpha: '', nested: { second: null, first: 'value' } }],
      ['topics', [{ beta: 2, alpha: 1 }, 'created']],
    ] as const
    const nestedEntries = [
      ['zeta', 0],
      ['alpha', ''],
      ['nested', { second: null, first: 'value' }],
    ] as const

    const fingerprints = new Set<string>()
    for (const outerOrder of permutations(outerEntries)) {
      for (const nestedOrder of permutations(nestedEntries)) {
        const desiredConfig = Object.fromEntries(outerOrder) as Record<string, unknown>
        desiredConfig.filter = Object.fromEntries(nestedOrder)
        fingerprints.add(fingerprintDesiredWebhookRegistration({ ...BASE_IDENTITY, desiredConfig }))
      }
    }

    expect(fingerprints.size).toBe(1)
  })

  it('is stable as provider-managed and polling state changes outside the desired projection', () => {
    const desiredConfig = {
      credentialId: 'credential-1',
      eventType: 'message.created',
      includeThreads: false,
    }
    const expected = fingerprintDesiredWebhookRegistration({
      ...BASE_IDENTITY,
      desiredConfig,
    })
    const managedStateVariants = Array.from({ length: 32 }, (_, index) => ({
      externalSubscriptionId: `external-${index}`,
      historyId: String(10_000 + index),
      lastCheckedTimestamp: new Date(1_700_000_000_000 + index * 1000).toISOString(),
      lastSeenGuids: [`guid-${index}`],
      setupCompleted: index % 2 === 0,
      subscriptionExpiration: new Date(1_800_000_000_000 + index * 1000).toISOString(),
    }))

    for (const managedState of managedStateVariants) {
      const persistedProviderConfig = { ...desiredConfig, ...managedState }
      expect(persistedProviderConfig).toMatchObject(managedState)
      expect(
        fingerprintDesiredWebhookRegistration({
          ...BASE_IDENTITY,
          desiredConfig,
        })
      ).toBe(expected)
    }
  })

  it('preserves null, false, zero, empty, undefined, and missing distinctions', () => {
    const variants: ReadonlyArray<Record<string, unknown>> = [
      { value: null },
      { value: false },
      { value: 0 },
      { value: '' },
      { value: {} },
      { value: [] },
      { value: undefined },
      {},
    ]

    const fingerprints = variants.map((desiredConfig) =>
      fingerprintDesiredWebhookRegistration({ ...BASE_IDENTITY, desiredConfig })
    )

    expect(new Set(fingerprints).size).toBe(variants.length)
  })

  it('normalizes equivalent callback paths without collapsing null and empty paths', () => {
    const desiredConfig = { eventType: 'created' }
    const canonical = fingerprintDesiredWebhookRegistration({
      ...BASE_IDENTITY,
      path: 'events/incoming',
      desiredConfig,
    })

    expect(
      fingerprintDesiredWebhookRegistration({
        ...BASE_IDENTITY,
        path: ' /events/incoming/ ',
        desiredConfig,
      })
    ).toBe(canonical)
    expect(normalizeWebhookRegistrationPath(null)).toBeNull()
    expect(normalizeWebhookRegistrationPath(' / ')).toBe('')
    expect(
      fingerprintDesiredWebhookRegistration({ ...BASE_IDENTITY, path: null, desiredConfig })
    ).not.toBe(fingerprintDesiredWebhookRegistration({ ...BASE_IDENTITY, path: '', desiredConfig }))
  })

  it('rejects cyclic desired config instead of emitting an unstable fingerprint', () => {
    const desiredConfig: Record<string, unknown> = {}
    desiredConfig.self = desiredConfig

    expect(() =>
      fingerprintDesiredWebhookRegistration({ ...BASE_IDENTITY, desiredConfig })
    ).toThrow('cannot contain cycles')
  })
})
