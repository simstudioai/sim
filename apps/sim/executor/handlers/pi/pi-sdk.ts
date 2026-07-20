import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import type { ModelRuntime, ResourceLoader } from '@earendil-works/pi-coding-agent'

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

/** Creates a host-only Pi model runtime without reading credentials or models from disk. */
export function createPiModelRuntime(sdk: PiSdk): Promise<ModelRuntime> {
  return sdk.ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
  })
}

/** Resolves only model definitions that the installed Pi SDK declares exactly. */
export function resolvePiSdkModel(modelRuntime: ModelRuntime, provider: string, modelId: string) {
  return modelRuntime.getModel(provider, modelId)
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
