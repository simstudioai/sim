import { AsyncLocalStorage } from 'node:async_hooks'
import { prepareCopilotEnvironmentContext } from '@/lib/copilot/environment-context'
import { inspectModelInputProvenanceRequest } from '@/lib/execution/model-input-provenance'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import {
  isResolvedSecretTraceProvenanceV1,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

const MODEL_INPUT_PROJECTION_ERROR = 'Knowledge model input could not be safely projected'

interface HeaderReader {
  get(name: string): string | null
}

type KnowledgeModelInputProvenancePreparation =
  | { success: true; registry?: ResolvedSecretTraceRegistry }
  | { success: false; error: string; status: 400 | 500 }

interface KnowledgeModelInputContext {
  registry?: ResolvedSecretTraceRegistry
  opaqueInputSafe: boolean
}

const knowledgeModelInputContext = new AsyncLocalStorage<KnowledgeModelInputContext>()

/**
 * Authenticates and imports provenance supplied by the internal tool transport. External
 * headerless calls retain their existing behavior; internal calls and private envelopes fail
 * closed when metadata is missing, partial, or forged.
 */
export async function prepareKnowledgeModelInputProvenance(options: {
  headers: HeaderReader
  payload: unknown
  isInternalRequest: boolean
  userId: string
  workspaceId?: string
  modelInput: unknown
}): Promise<KnowledgeModelInputProvenancePreparation> {
  const inspection = inspectModelInputProvenanceRequest(options.headers, options.payload)
  if (inspection.status === 'unsupported') {
    return options.isInternalRequest
      ? { success: false, error: 'Model input provenance is unavailable', status: 400 }
      : { success: true }
  }
  if (inspection.status === 'invalid' || !options.isInternalRequest) {
    return { success: false, error: 'Invalid model input provenance', status: 400 }
  }
  if (!isResolvedSecretTraceProvenanceV1(inspection.value) || !inspection.value.complete) {
    return { success: false, error: 'Model input provenance is unavailable', status: 400 }
  }
  if (inspection.value.entries.length === 0) {
    return {
      success: true,
      registry: new ResolvedSecretTraceRegistry([], {
        userId: options.userId,
        ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      }),
    }
  }

  let registry: ResolvedSecretTraceRegistry
  try {
    registry = (await prepareCopilotEnvironmentContext(options.userId, options.workspaceId))
      .resolvedSecretTraceRegistry
  } catch {
    return { success: false, error: 'Model input provenance is unavailable', status: 500 }
  }

  const imported = await registry.importProvenanceForValue(inspection.value, options.modelInput, {
    trusted: true,
  })
  if (!imported || !registry.isComplete()) {
    return { success: false, error: 'Model input provenance is unavailable', status: 400 }
  }

  return { success: true, registry }
}

/** Runs only the model-producing portion of a Knowledge request with its verified provenance. */
export function runWithKnowledgeModelInputProvenance<T>(
  registry: ResolvedSecretTraceRegistry | undefined,
  callback: () => T,
  options?: { opaqueInputSafe?: boolean }
): T {
  if (!registry && options?.opaqueInputSafe === undefined) return callback()
  return knowledgeModelInputContext.run(
    {
      registry,
      opaqueInputSafe: options?.opaqueInputSafe ?? !registry,
    },
    callback
  )
}

/** Rejects opaque bytes/URLs that cannot be selectively projected before an external model call. */
export function assertKnowledgeOpaqueModelInputSafe(): void {
  if (knowledgeModelInputContext.getStore()?.opaqueInputSafe === false) {
    throw new Error(MODEL_INPUT_PROJECTION_ERROR)
  }
}

/** Projects one string immediately before it enters an embedding or reranking request. */
export function projectKnowledgeModelInput(value: string): string {
  const registry = knowledgeModelInputContext.getStore()?.registry
  if (!registry) return value

  const projection = projectResolvedSecretModelContent(value, registry)
  if (!projection.safe || typeof projection.value !== 'string') {
    throw new Error(MODEL_INPUT_PROJECTION_ERROR)
  }
  return projection.value
}

/** Projects a string collection immediately before it enters an embedding or reranking request. */
export function projectKnowledgeModelInputs(values: readonly string[]): string[] {
  const registry = knowledgeModelInputContext.getStore()?.registry
  if (!registry) return [...values]

  const projection = projectResolvedSecretModelContent(values, registry)
  if (
    !projection.safe ||
    !Array.isArray(projection.value) ||
    !projection.value.every((value) => typeof value === 'string')
  ) {
    throw new Error(MODEL_INPUT_PROJECTION_ERROR)
  }
  return projection.value
}
