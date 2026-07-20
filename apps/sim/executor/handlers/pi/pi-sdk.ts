import type { ModelRegistry, ResourceLoader } from '@earendil-works/pi-coding-agent'

/** The Pi SDK module, loaded dynamically so it stays externalized from the bundle. */
export type PiSdk = typeof import('@earendil-works/pi-coding-agent')

let sdkPromise: Promise<PiSdk> | undefined

/** Loads the Pi SDK while preserving Next.js standalone dependency tracing. */
export function loadPiSdk(): Promise<PiSdk> {
  if (!sdkPromise) {
    sdkPromise = import('@earendil-works/pi-coding-agent').catch((error) => {
      sdkPromise = undefined
      throw error
    })
  }
  return sdkPromise
}

/** Resolves only model definitions that the installed Pi SDK declares exactly. */
export function resolvePiSdkModel(modelRegistry: ModelRegistry, provider: string, modelId: string) {
  return modelRegistry.find(provider, modelId)
}

/**
 * Creates an isolated resource-discovery boundary for untrusted repositories. No project
 * files, extensions, skills, prompt templates, themes, or settings are loaded.
 */
export function createSealedPiResourceLoader(sdk: PiSdk, systemPrompt: string): ResourceLoader {
  const extensions = {
    extensions: [],
    errors: [],
    runtime: sdk.createExtensionRuntime(),
  }

  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  }
}
