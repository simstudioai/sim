import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import type { ModelRuntime, ResourceLoader, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { isRecordLike } from '@sim/utils/object'
import type { PiToolSpec } from '@/executor/handlers/pi/core/backend'
import { createScrubbedPiError, scrubPiSecrets } from '@/executor/handlers/pi/core/redaction'

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

function isToolArguments(value: unknown): value is Record<string, unknown> {
  return isRecordLike(value)
}

/**
 * Converts a backend-neutral {@link PiToolSpec} into a Pi `ToolDefinition`, redacting transport
 * credentials from thrown and reported tool errors. Successful tool output is ordinary model
 * content and stays verbatim; Sim-secret projection is owned by the tool adapter's provenance.
 *
 * A spec's `isError` is rethrown rather than reported in the result: Pi derives a call's error state
 * solely from whether `execute` threw, so a resolved failure would reach the model as a successful
 * tool call whose text happens to describe a failure. Throwing also matches Pi's own `bash`, which
 * throws on a non-zero exit with the output appended, so the failure text survives either way.
 *
 * Shared by both host-side backends: Local Dev converts its SSH, Sim, and search tools here, and
 * Review Code converts its search tool here alongside the review tools it builds directly.
 */
export function toPiTool(sdk: PiSdk, spec: PiToolSpec, secrets: readonly string[]): ToolDefinition {
  return sdk.defineTool({
    name: spec.name,
    label: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    // Pi only renders a guideline that survives onto the active ToolDefinition, so dropping this
    // would silently leave a tool's trusted guidance unreachable.
    ...(spec.promptGuidelines ? { promptGuidelines: spec.promptGuidelines } : {}),
    execute: async (_toolCallId, params) => {
      if (!isToolArguments(params)) throw new Error('Pi tool arguments must be an object')
      const result = await spec.execute(params).catch((error) => {
        throw createScrubbedPiError(error, secrets, 'Pi tool failed')
      })
      // Some providers reject an empty text block, and a spec is free to report a failure with none.
      if (result.isError) throw new Error(scrubPiSecrets(result.text, secrets) || 'Pi tool failed')
      return { content: [{ type: 'text', text: result.text }], details: {} }
    },
  })
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
