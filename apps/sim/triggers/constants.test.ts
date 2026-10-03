import { describe, expect, it } from 'vitest'
import { getProviderHandler } from '@/lib/webhooks/providers'
import { isInternalTriggerProvider, POLLING_PROVIDERS } from '@/triggers/constants'
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

  /**
   * `acceptsPathWebhookDelivery` gates the whole PROVIDER, not the trigger id, so a provider that
   * serves the public path route must not also own a polling trigger - membership in
   * `POLLING_PROVIDERS` would 404 its real deliveries. Providers gated wholesale for a
   * provider-level reason (internal, or an app-level ingress route) never serve that route, so
   * mixing is harmless there and they are exempt. Split dual-delivery services into two providers
   * instead, as Slack does with `slack` and `slack_app`.
   */
  it('no path-delivered provider also owns a polling trigger', () => {
    const byProvider = new Map<string, { polling: string[]; path: string[] }>()
    for (const trigger of Object.values(TRIGGER_REGISTRY)) {
      const gatedByProvider =
        isInternalTriggerProvider(trigger.provider) ||
        getProviderHandler(trigger.provider).ingressMode === 'provider'
      if (gatedByProvider) continue

      const entry = byProvider.get(trigger.provider) ?? { polling: [], path: [] }
      entry[trigger.polling === true ? 'polling' : 'path'].push(trigger.id)
      byProvider.set(trigger.provider, entry)
    }

    const mixed = [...byProvider]
      .filter(([, entry]) => entry.polling.length > 0 && entry.path.length > 0)
      .map(
        ([provider, entry]) =>
          `${provider}: polling=[${entry.polling.join(', ')}] path=[${entry.path.join(', ')}]`
      )

    expect(
      mixed,
      'Split the path-delivered triggers onto their own provider - the public trigger route rejects the whole provider'
    ).toEqual([])
  })
})
