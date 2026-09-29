import {
  type BenchmarkArtifacts,
  type BenchmarkEditablePatch,
  benchmarkArtifactsSchema,
} from '@/lib/benchmarks/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/** Every mask must restore the exact reference, including repeated occurrences. */
export function validateBenchmarkRedaction(
  artifacts: Pick<BenchmarkArtifacts, 'referenceSpec' | 'redactedSpec' | 'blanks'>
): void {
  if (!artifacts.redactedSpec && artifacts.blanks.length === 0) return
  const answers = new Map(artifacts.blanks.map((blank) => [blank.id, blank.answer]))
  if (answers.size !== artifacts.blanks.length || answers.size === 0) {
    throw new OrchestrationError(
      'validation',
      'Redaction requires distinct blank IDs and at least one answer'
    )
  }
  const seen = new Set<string>()
  const restored = artifacts.redactedSpec.replace(
    /\[\[BLANK:([A-Za-z0-9_-]+)\]\]/g,
    (marker, id: string) => {
      const answer = answers.get(id)
      if (answer === undefined)
        throw new OrchestrationError('validation', `Unknown blank marker: ${id}`)
      seen.add(id)
      return answer
    }
  )
  if (seen.size !== answers.size || restored !== artifacts.referenceSpec) {
    throw new OrchestrationError(
      'validation',
      'Every blank must appear as [[BLANK:id]], and replacing the masks with their answers must restore the reference exactly'
    )
  }
}

/** Editing an upstream artifact atomically discards results derived from its previous value. */
export function applyBenchmarkPatch(
  current: BenchmarkArtifacts,
  patch: BenchmarkEditablePatch
): BenchmarkArtifacts {
  const next = { ...current }
  if (patch.taskBrief !== undefined && patch.taskBrief !== current.taskBrief) {
    next.taskBrief = patch.taskBrief
    next.generatedSpec = null
    next.reconstruction = null
    next.grade = null
  }
  if (patch.referenceSpec !== undefined && patch.referenceSpec !== current.referenceSpec) {
    next.referenceSpec = patch.referenceSpec
    next.redactedSpec = ''
    next.blanks = []
    next.generatedSpec = null
    next.reconstruction = null
    next.grade = null
  }
  const redactionChanged =
    (patch.redactedSpec !== undefined && patch.redactedSpec !== current.redactedSpec) ||
    (patch.blanks !== undefined &&
      (patch.blanks.length !== current.blanks.length ||
        patch.blanks.some(
          (blank, index) =>
            blank.id !== current.blanks[index]?.id || blank.answer !== current.blanks[index]?.answer
        )))
  if (redactionChanged) {
    next.redactedSpec = patch.redactedSpec ?? next.redactedSpec
    next.blanks = patch.blanks ?? next.blanks
    next.reconstruction = null
    next.grade = null
  }
  const parsed = benchmarkArtifactsSchema.parse(next)
  validateBenchmarkRedaction(parsed)
  return parsed
}
