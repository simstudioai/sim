import { isPlainRecord } from '@sim/utils/object'
import type { TypeSafeBaseParams, TypeSafeEvaluateParams } from '@/tools/typesafe/types'

/** Selects all model-visible content in a convenience operation, excluding credentials and model ID. */
export function selectTypeSafeModelInput(
  params: TypeSafeBaseParams & { instructions: unknown; criteria?: unknown }
): Record<string, unknown> {
  return { state: params.state, instructions: params.instructions, criteria: params.criteria }
}

function questionMap(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return undefined
    }
  }
  return isPlainRecord(value) ? value : undefined
}

function questionFields(question: unknown): Record<string, unknown> {
  if (!isPlainRecord(question)) return {}
  return Object.fromEntries(
    ['instructions', 'criteria']
      .filter((key) => Object.hasOwn(question, key))
      .map((key) => [key, question[key]])
  )
}

/** Selects question content by ID, excluding question-type controls. */
export function selectTypeSafeEvaluateModelInput(
  params: TypeSafeEvaluateParams
): Record<string, unknown> {
  const questions = questionMap(params.questions)
  return {
    state: params.state,
    questions: questions
      ? Object.fromEntries(
          Object.entries(questions).map(([name, question]) => [name, questionFields(question)])
        )
      : params.questions,
  }
}

/** Restores question IDs and types while applying only the shared projector's model-visible fields. */
export function applyTypeSafeEvaluateModelInput(
  original: Partial<TypeSafeEvaluateParams>,
  projected: Record<string, unknown>
): Record<string, unknown> {
  const questions = questionMap(original.questions)
  if (!questions) return { state: projected.state, questions: projected.questions }
  const projectedQuestions = projected.questions
  const entries = Object.entries(questions)
  if (
    !isPlainRecord(projectedQuestions) ||
    Object.keys(projectedQuestions).length !== entries.length ||
    entries.some(([name]) => !Object.hasOwn(projectedQuestions, name))
  ) {
    throw new Error('Projected TypeSafe questions do not match the original questions')
  }
  return {
    state: projected.state,
    questions: Object.fromEntries(
      entries.map(([name, question]) => {
        const expected = questionFields(question)
        const fields: unknown = projectedQuestions[name]
        if (
          !isPlainRecord(fields) ||
          Object.keys(fields).length !== Object.keys(expected).length ||
          Object.keys(expected).some((key) => !Object.hasOwn(fields, key))
        ) {
          throw new Error('Projected TypeSafe question fields do not match the original question')
        }
        return [name, isPlainRecord(question) ? { ...question, ...fields } : question]
      })
    ),
  }
}
