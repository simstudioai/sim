import type { BenchmarkArtifacts } from '@/lib/benchmarks/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'

type Reconstruction = NonNullable<BenchmarkArtifacts['reconstruction']>
type Judgments = NonNullable<BenchmarkArtifacts['grade']>

function requireMatchingIds(blanks: BenchmarkArtifacts['blanks'], values: { id: string }[]): void {
  const expected = new Set(blanks.map(({ id }) => id))
  if (
    values.length !== expected.size ||
    new Set(values.map(({ id }) => id)).size !== expected.size ||
    values.some(({ id }) => !expected.has(id))
  ) {
    throw new OrchestrationError(
      'validation',
      'The model must return exactly one result for every blank'
    )
  }
}

export function validateReconstruction(
  blanks: BenchmarkArtifacts['blanks'],
  values: Reconstruction
): void {
  requireMatchingIds(blanks, values)
}

/** Source lookups may resolve references, but cannot supply mechanics absent from the plan. */
export function gradeReconstruction(input: {
  blanks: BenchmarkArtifacts['blanks']
  reconstruction: Reconstruction
  generatedSpec: string
  judgments: Judgments
}): Judgments {
  requireMatchingIds(input.blanks, input.reconstruction)
  requireMatchingIds(input.blanks, input.judgments)
  const answers = new Map(input.reconstruction.map((answer) => [answer.id, answer]))
  const judgments = new Map(input.judgments.map((judgment) => [judgment.id, judgment]))
  return input.blanks.map(({ id }) => {
    const answer = answers.get(id)
    const judgment = judgments.get(id)
    if (!answer || !judgment) throw new Error(`Missing reconstruction or judgment for ${id}`)
    if (answer.evidenceError) return { ...judgment, correct: false, reason: answer.evidenceError }
    if (
      !answer.answer.trim() ||
      !answer.support.trim() ||
      !input.generatedSpec.includes(answer.support)
    ) {
      return {
        id,
        correct: false,
        reason: 'No exact supporting passage was provided from the generated spec.',
      }
    }
    if (judgment.basis === 'missing') return { ...judgment, correct: false }
    if (judgment.basis === 'reference' && !answer.sources?.length) {
      return {
        ...judgment,
        correct: false,
        reason: 'No verified source evidence was provided for this reference.',
      }
    }
    return judgment
  })
}
