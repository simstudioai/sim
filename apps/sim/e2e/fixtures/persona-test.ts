import { test as base } from '@playwright/test'
import {
  type PersonaManifestEntry,
  readScenarioManifest,
  resolveStorageStatePath,
  type ScenarioManifest,
} from './e2e-world'

interface PersonaFixtures {
  personaManifest: ScenarioManifest
  contextForPersona: (personaKey: string) => Promise<import('@playwright/test').BrowserContext>
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
    const contexts = new Set<import('@playwright/test').BrowserContext>()
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
      contexts.add(context)
      return context
    })
    await Promise.all([...contexts].map((context) => context.close()))
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
