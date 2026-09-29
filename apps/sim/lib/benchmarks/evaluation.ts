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

/** Correct guesses earn credit only when the reader quotes the submitted plan as evidence. */
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
    const answer = answers.get(id)!
    const judgment = judgments.get(id)!
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
    return judgment
  })
}
