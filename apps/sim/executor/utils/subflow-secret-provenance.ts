import {
  ResolvedSecretTraceProvenanceAccumulator,
  type ResolvedSecretTraceProvenanceV1,
} from '@/executor/utils/resolved-secret-trace-registry'

/** Unions exact encrypted provenance as loop/parallel outputs are aggregated. */
export function mergeSubflowSecretProvenance(
  current: ResolvedSecretTraceProvenanceV1 | undefined,
  next: ResolvedSecretTraceProvenanceV1 | undefined
): ResolvedSecretTraceProvenanceV1 | undefined {
  if (!next) return current

  const accumulator = new ResolvedSecretTraceProvenanceAccumulator(current?.scope ?? next.scope)
  if (current) accumulator.record(current)
  accumulator.record(next)
  return accumulator.exportProvenance()
}
