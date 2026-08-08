import type {
  ResolvedSecretInputPath,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

export interface ProviderToolInputProvenance {
  registry: ResolvedSecretTraceRegistry
  sourcePath: ResolvedSecretInputPath
  projectedParams: Record<string, unknown>
}

export interface PreparedProviderToolInputProvenance {
  registry: ResolvedSecretTraceRegistry
  inputPaths: readonly ResolvedSecretInputPath[]
}

const configuredToolInputProvenance = new WeakMap<object, ProviderToolInputProvenance>()
const preparedToolInputProvenance = new WeakMap<object, PreparedProviderToolInputProvenance>()

/** Associates one provider tool object with its exact resolver-recorded preset input. */
export function registerProviderToolInputProvenance(
  tool: object,
  provenance: ProviderToolInputProvenance
): void {
  configuredToolInputProvenance.set(tool, provenance)
}

/** Reads provenance for the exact configured tool instance, never by tool id or name. */
export function getProviderToolInputProvenance(
  tool: object
): ProviderToolInputProvenance | undefined {
  return configuredToolInputProvenance.get(tool)
}

/** Associates one prepared execution object with its isolated transformed-input registry. */
export function registerPreparedProviderToolInputProvenance(
  executionParams: object,
  provenance: PreparedProviderToolInputProvenance
): void {
  preparedToolInputProvenance.set(executionParams, provenance)
}

/** Reads provenance for the exact prepared execution object passed to the tool adapter. */
export function getPreparedProviderToolInputProvenance(
  executionParams: object
): PreparedProviderToolInputProvenance | undefined {
  return preparedToolInputProvenance.get(executionParams)
}
