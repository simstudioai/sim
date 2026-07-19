/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type ExistingWebhookRegistration,
  planWebhookRegistrationReconciliation,
} from '@/lib/webhooks/registration-reconciliation'

interface RegistrationRow {
  id: string
  providerConfig: Record<string, unknown>
}

function existingRegistration(
  triggerId: string,
  fingerprint: string | null,
  generation: number,
  providerConfig: Record<string, unknown> = {}
): ExistingWebhookRegistration<RegistrationRow> {
  return {
    triggerId,
    fingerprint,
    generation,
    row: {
      id: `row-${triggerId}`,
      providerConfig,
    },
  }
}

describe('planWebhookRegistrationReconciliation', () => {
  it('reuses an unchanged physical row across generations with provider state intact', () => {
    const providerConfig = {
      credentialId: 'credential-1',
      externalSubscriptionId: 'external-1',
      historyId: 'history-9',
      setupCompleted: true,
    }
    const existing = existingRegistration('trigger-1', 'fingerprint-1', 4, providerConfig)

    const plan = planWebhookRegistrationReconciliation({
      generation: 5,
      desired: [
        {
          triggerId: 'trigger-1',
          fingerprint: 'fingerprint-1',
          desired: { provider: 'example' },
        },
      ],
      existing: [existing],
    })

    expect(plan.actions).toEqual([
      expect.objectContaining({
        kind: 'reuse',
        triggerId: 'trigger-1',
      }),
    ])
    const [action] = plan.actions
    expect(action.kind).toBe('reuse')
    if (action.kind !== 'reuse') throw new Error('Expected reuse action')
    expect(action.existing).toBe(existing)
    expect(action.existing.row).toBe(existing.row)
    expect(action.existing.row.id).toBe('row-trigger-1')
    expect(action.existing.row.providerConfig).toBe(providerConfig)
  })

  it('prepares candidates for changed and missing registrations without mutating current rows', () => {
    const changed = existingRegistration('changed', 'old-fingerprint', 7, {
      externalId: 'external-1',
    })
    const before = structuredClone(changed)

    const plan = planWebhookRegistrationReconciliation({
      generation: 7,
      desired: [
        {
          triggerId: 'changed',
          fingerprint: 'new-fingerprint',
          desired: { provider: 'example', event: 'updated' },
        },
        {
          triggerId: 'new',
          fingerprint: 'new-trigger-fingerprint',
          desired: { provider: 'example', event: 'created' },
        },
      ],
      existing: [changed],
    })

    expect(plan.actions).toEqual([
      expect.objectContaining({
        kind: 'prepare_candidate',
        triggerId: 'changed',
        existing: changed,
      }),
      expect.objectContaining({
        kind: 'prepare_candidate',
        triggerId: 'new',
        existing: null,
      }),
    ])
    expect(changed).toEqual(before)
  })

  it('leaves removed-row retirement to the atomic activation step', () => {
    const kept = existingRegistration('kept', 'same', 2)
    const removed = existingRegistration('removed', 'old', 2)

    const plan = planWebhookRegistrationReconciliation({
      generation: 3,
      desired: [{ triggerId: 'kept', fingerprint: 'same', desired: {} }],
      existing: [kept, removed],
    })

    expect(plan.actions.map((action) => action.kind)).toEqual(['reuse'])
  })

  it('rejects a stale generation before planning over newer rows', () => {
    const newer = existingRegistration('trigger-1', 'same', 11)

    expect(() =>
      planWebhookRegistrationReconciliation({
        generation: 10,
        desired: [{ triggerId: 'trigger-1', fingerprint: 'same', desired: {} }],
        existing: [newer],
      })
    ).toThrow('newer registration generation 11')
  })

  it.each([
    {
      label: 'desired',
      desired: [
        { triggerId: 'duplicate', fingerprint: 'one', desired: {} },
        { triggerId: 'duplicate', fingerprint: 'two', desired: {} },
      ],
      existing: [],
    },
    {
      label: 'existing',
      desired: [],
      existing: [
        existingRegistration('duplicate', 'one', 1),
        existingRegistration('duplicate', 'two', 1),
      ],
    },
  ])('rejects duplicate trigger identities in $label registrations', ({ desired, existing }) => {
    expect(() =>
      planWebhookRegistrationReconciliation({
        generation: 1,
        desired,
        existing,
      })
    ).toThrow('duplicate triggerId "duplicate"')
  })
})
