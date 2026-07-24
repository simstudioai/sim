import { test as base } from '@playwright/test'
import { type BrowserNetworkGuard, installBrowserNetworkGuard } from '../support/browser-network'
import {
  type PersonaManifestEntry,
  readScenarioManifest,
  resolveStorageStatePath,
  type ScenarioManifest,
} from './e2e-world'

export type PersonaCleanup = () => Promise<void> | void

interface PersonaFixtures {
  personaManifest: ScenarioManifest
  contextForPersona: (personaKey: string) => Promise<import('@playwright/test').BrowserContext>
  registerCleanup: (label: string, cleanup: PersonaCleanup) => void
}

export const test = base.extend<PersonaFixtures>({
  personaManifest: [
    async ({ browserName: _browserName }, use) => {
      const manifest = readScenarioManifest(requiredEnv('E2E_MANIFEST_PATH'))
      if (!manifest.authCaptureComplete) {
        throw new Error('Persona storage states were not captured successfully')
      }
      await use(manifest)
    },
    { scope: 'test' },
  ],
  contextForPersona: async ({ browser, contextOptions, personaManifest }, use) => {
    const contexts = new Map<import('@playwright/test').BrowserContext, BrowserNetworkGuard>()
    await use(async (personaKey) => {
      const persona = requirePersona(personaManifest, personaKey)
      const context = await browser.newContext({
        ...contextOptions,
        baseURL: requiredEnv('E2E_BASE_URL'),
        storageState: resolveStorageStatePath(
          requiredEnv('E2E_STORAGE_STATE_DIR'),
          persona.storageStatePath
        ),
      })
      contexts.set(context, await installBrowserNetworkGuard(context))
      return context
    })
    const failures: unknown[] = []
    for (const [context, guard] of contexts) {
      try {
        await context.close()
      } catch (error) {
        failures.push(error)
      }
      try {
        guard.assertNoUnexpectedRequests()
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Persona browser cleanup or network isolation failed')
    }
  },
  registerCleanup: async ({ contextForPersona: _contextForPersona }, use) => {
    const cleanups: Array<{ label: string; cleanup: PersonaCleanup }> = []
    await use((label, cleanup) => cleanups.push({ label, cleanup }))

    const failures: unknown[] = []
    for (const { label, cleanup } of cleanups.reverse()) {
      try {
        await cleanup()
      } catch (error) {
        failures.push(new Error(`Cleanup failed: ${label}`, { cause: error }))
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Persona cleanup registry failed')
    }
  },
})

export { expect } from '@playwright/test'

export function requirePersona(
  manifest: ScenarioManifest,
  personaKey: string
): PersonaManifestEntry {
  const persona = manifest.personas[personaKey]
  if (!persona) throw new Error(`Unknown persona: ${personaKey}`)
  return persona
}

function requiredEnv(key: string): string {
  const value = process.env[key]
  if (!value) throw new Error(`Missing persona fixture environment value: ${key}`)
  return value
}
