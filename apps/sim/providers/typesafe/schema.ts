import { z } from 'zod'
import type { JevContent, JevEvaluationResult, JevQuestion } from '@/providers/typesafe/types'

const contentSchema: z.ZodType<JevContent> = z.union([
  z.string(),
  z.array(z.json()),
  z.record(z.string(), z.json()),
])

const questionSchema: z.ZodType<JevQuestion> = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('choice'),
    instructions: contentSchema,
    criteria: z
      .record(z.string(), contentSchema.nullable())
      .refine(
        (criteria) => Object.keys(criteria).length >= 1 && Object.keys(criteria).length <= 255,
        'Choice criteria must contain between 1 and 255 options'
      ),
  }),
  z.object({
    type: z.literal('score'),
    instructions: contentSchema,
    criteria: z.array(contentSchema).min(2).max(10),
  }),
  z.object({
    type: z.literal('noul'),
    instructions: contentSchema,
    criteria: z
      .object({ true: contentSchema.optional(), false: contentSchema.optional() })
      .strict()
      .optional(),
  }),
])

const questionsSchema = z
  .record(z.string(), questionSchema)
  .refine((questions) => Object.keys(questions).length > 0, 'Provide at least one question')

const probabilitySchema = z.number().min(0).max(1)
const probabilitiesSchema = z.record(z.string(), probabilitySchema)
const responseSchema: z.ZodType<JevEvaluationResult> = z.object({
  model: z.string(),
  answers: z.record(
    z.string(),
    z.discriminatedUnion('type', [
      z.object({
        type: z.literal('choice'),
        choice: z.string(),
        probabilities: probabilitiesSchema,
        confidence: probabilitySchema,
      }),
      z.object({
        type: z.literal('score'),
        score: z.number(),
        legend: z.record(z.string(), contentSchema),
        probabilities: probabilitiesSchema,
        confidence: probabilitySchema,
      }),
      z.object({ type: z.literal('noul'), noul: probabilitySchema }),
    ])
  ),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
})

export function parseJevJson(value: unknown, field: string): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`Jev ${field} must be valid JSON`)
  }
}

export function parseJevQuestions(questions: unknown) {
  const parsedQuestions = questionsSchema.safeParse(parseJevJson(questions, 'questions'))
  if (!parsedQuestions.success) {
    throw new Error(
      'Invalid Jev questions: provide typed questions with instructions, 1–255 Choice options, 2–10 Score levels, or optional true/false Noul criteria'
    )
  }
  return parsedQuestions.data
}

export function buildJevBody(params: { model: string; state: unknown }, questions: unknown) {
  const parsedQuestions = parseJevQuestions(questions)
  const state = contentSchema.safeParse(params.state)
  if (!state.success) throw new Error('Jev state must be text, a JSON object, or an array')
  return {
    model: params.model,
    state: state.data,
    questions: parsedQuestions,
  }
}

export function parseJevResponse(
  value: unknown,
  questions: Record<string, JevQuestion>
): JevEvaluationResult {
  const result = responseSchema.safeParse(value)
  if (!result.success) throw new Error('TypeSafe returned an invalid Jev evaluation response')
  const { answers } = result.data
  if (
    Object.keys(answers).length !== Object.keys(questions).length ||
    Object.entries(questions).some(
      ([id, question]) => !Object.hasOwn(answers, id) || answers[id].type !== question.type
    )
  ) {
    throw new Error(
      'TypeSafe returned Jev answers that do not match the requested question IDs and types'
    )
  }
  for (const [id, question] of Object.entries(questions)) {
    const answer = answers[id]
    if (
      question.type === 'choice' &&
      answer.type === 'choice' &&
      !Object.hasOwn(question.criteria, answer.choice)
    ) {
      throw new Error('TypeSafe returned a Jev Choice answer outside the requested options')
    }
  }
  return result.data
}
