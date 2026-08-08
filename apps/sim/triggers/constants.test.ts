/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { POLLING_PROVIDERS } from '@/triggers/constants'
import { TRIGGER_REGISTRY } from '@/triggers/registry'

describe('POLLING_PROVIDERS sync with TriggerConfig.polling', () => {
  it('matches every trigger with polling: true in the registry', () => {
    const registryPollingProviders = new Set(
      Object.values(TRIGGER_REGISTRY)
        .filter((t) => t.polling === true)
        .map((t) => t.provider)
    )

    expect(POLLING_PROVIDERS).toEqual(registryPollingProviders)
  })

  it('no trigger with polling: true is missing from POLLING_PROVIDERS', () => {
    const missing: string[] = []
    for (const trigger of Object.values(TRIGGER_REGISTRY)) {
      if (trigger.polling && !POLLING_PROVIDERS.has(trigger.provider)) {
        missing.push(`${trigger.id} (provider: ${trigger.provider})`)
      }
    }
    expect(missing, `Triggers with polling: true missing from POLLING_PROVIDERS`).toEqual([])
  })

  /**
   * `acceptsPathWebhookDelivery` gates the public trigger route on the PROVIDER, not the trigger
   * id, so a provider owning both families would have its HTTP deliveries rejected as though they
   * were forged. Sim already models dual-delivery services as two providers - Slack ships
   * `slack` (path) and `slack_app` (shared ingress) rather than one mixed provider. Adding, say, a
   * Gmail push trigger under the existing `gmail` provider is the shape this guards against: every
   * other assertion here would still pass while real deliveries 404.
   */
  it('no provider mixes polling and HTTP triggers', () => {
    const byProvider = new Map<string, { polling: string[]; http: string[] }>()
    for (const trigger of Object.values(TRIGGER_REGISTRY)) {
      const entry = byProvider.get(trigger.provider) ?? { polling: [], http: [] }
      entry[trigger.polling === true ? 'polling' : 'http'].push(trigger.id)
      byProvider.set(trigger.provider, entry)
    }

    const mixed = [...byProvider]
      .filter(([, entry]) => entry.polling.length > 0 && entry.http.length > 0)
      .map(
        ([provider, entry]) =>
          `${provider}: polling=[${entry.polling.join(', ')}] http=[${entry.http.join(', ')}]`
      )

    expect(
      mixed,
      'Split the HTTP triggers onto their own provider - the public trigger route rejects the whole provider'
    ).toEqual([])
  })

  it('no POLLING_PROVIDERS entry lacks a polling: true trigger in the registry', () => {
    const extra: string[] = []
    for (const provider of POLLING_PROVIDERS) {
      const hasTrigger = Object.values(TRIGGER_REGISTRY).some(
        (t) => t.provider === provider && t.polling === true
      )
      if (!hasTrigger) {
        extra.push(provider)
      }
    }
    expect(extra, `POLLING_PROVIDERS entries with no matching polling trigger`).toEqual([])
  })
})
