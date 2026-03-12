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
