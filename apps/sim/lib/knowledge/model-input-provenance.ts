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

export type KnowledgeModelInputProvenancePreparation =
  | { success: true; registry?: ResolvedSecretTraceRegistry }
  | { success: false; error: string; status: 400 | 500 }

const knowledgeModelInputRegistry = new AsyncLocalStorage<ResolvedSecretTraceRegistry>()

/**
 * Authenticates and imports provenance supplied by the internal tool transport. Headerless calls
 * retain their legacy behavior; partial or forged private envelopes fail closed.
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
  if (inspection.status === 'unsupported') return { success: true }
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
  callback: () => T
): T {
  return registry ? knowledgeModelInputRegistry.run(registry, callback) : callback()
}

/** Projects one string immediately before it enters an embedding or reranking request. */
export function projectKnowledgeModelInput(value: string): string {
  const registry = knowledgeModelInputRegistry.getStore()
  if (!registry) return value

  const projection = projectResolvedSecretModelContent(value, registry)
  if (!projection.safe || typeof projection.value !== 'string') {
    throw new Error(MODEL_INPUT_PROJECTION_ERROR)
  }
  return projection.value
}

/** Projects a string collection immediately before it enters an embedding or reranking request. */
export function projectKnowledgeModelInputs(values: readonly string[]): string[] {
  const registry = knowledgeModelInputRegistry.getStore()
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
