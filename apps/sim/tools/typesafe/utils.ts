import { z } from 'zod'
import type {
  TypeSafeBaseParams,
  TypeSafeEntry,
  TypeSafeQuestion,
  TypeSafeQuestions,
  TypeSafeRequest,
  TypeSafeResult,
} from '@/tools/typesafe/types'

const entrySchema = z.union([
  z.string(),
  z.record(z.string(), z.json()),
  z.array(z.json()),
  z.null(),
])
const choiceCriteriaSchema = z
  .record(z.string(), entrySchema)
  .refine((value) => Object.keys(value).length >= 1 && Object.keys(value).length <= 255, {
    message: 'Choice criteria must contain 1–255 options',
  })
const questionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('choice'),
      instructions: entrySchema.optional(),
      criteria: choiceCriteriaSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('score'),
      instructions: entrySchema.optional(),
      criteria: z.array(entrySchema).min(2).max(10),
    })
    .strict(),
  z
    .object({
      type: z.literal('noul'),
      instructions: entrySchema.optional(),
      criteria: z
        .object({ true: entrySchema.optional(), false: entrySchema.optional() })
        .strict()
        .nullable()
        .optional(),
    })
    .strict(),
])
const questionsSchema = z
  .record(z.string(), questionSchema)
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Questions must contain at least one named question',
  })
const probabilitySchema = z.number().min(0).max(1)
const probabilitiesSchema = z
  .record(z.string(), probabilitySchema)
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Probabilities must contain at least one outcome',
  })
const answerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('choice'),
    choice: z.string(),
    probabilities: probabilitiesSchema,
    confidence: probabilitySchema,
  }),
  z.object({
    type: z.literal('score'),
    score: z.number().min(0),
    legend: z.record(z.string(), entrySchema),
    probabilities: probabilitiesSchema,
    confidence: probabilitySchema,
  }),
  z.object({ type: z.literal('noul'), noul: probabilitySchema }),
])
const resultSchema = z.object({
  model: z.string().min(1),
  usage: z.object({
    input_tokens: z.number().int().min(0),
    output_tokens: z.number().int().min(0),
  }),
  answers: z.record(z.string(), answerSchema).refine((value) => Object.keys(value).length > 0, {
    message: 'Answers must contain at least one named answer',
  }),
})

function validate<T>(schema: z.ZodType<T>, value: unknown, field: string): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || field}: ${issue.message}`)
      .join('; ')
    throw new Error(`TypeSafe ${field} is invalid: ${details}`)
  }
  return result.data
}

/** Parses JSON-only editor values after workflow references have been resolved. */
export function parseTypeSafeJson(value: unknown, field: string): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`TypeSafe ${field} must be valid JSON`)
  }
}

/** Accepts structured values and JSON objects/arrays while preserving ordinary text verbatim. */
export function normalizeTypeSafeEntry(value: unknown, field: string): TypeSafeEntry {
  let normalized = value
  if (typeof value === 'string' && /^[[{]/.test(value.trim())) {
    try {
      normalized = JSON.parse(value)
    } catch {
      normalized = value
    }
  }
  return validate(entrySchema, normalized, field)
}

/** Validates the documented mixed-question format without flattening structured descriptions. */
export function normalizeTypeSafeQuestions(value: unknown): TypeSafeQuestions {
  return validate(questionsSchema, parseTypeSafeJson(value, 'questions'), 'questions')
}

/** Builds the single named question used by the convenience operations. */
export function buildTypeSafeQuestion(
  type: TypeSafeQuestion['type'],
  instructions: unknown,
  criteria: unknown
): TypeSafeQuestion {
  if (instructions == null || (typeof instructions === 'string' && !instructions.trim())) {
    throw new Error('TypeSafe instructions are required')
  }
  const optionalCriteria = type === 'noul' && (criteria === undefined || criteria === '')
  return validate(
    questionSchema,
    {
      type,
      instructions: normalizeTypeSafeEntry(instructions, 'instructions'),
      ...(optionalCriteria ? {} : { criteria: parseTypeSafeJson(criteria, 'criteria') }),
    },
    'question'
  )
}

/** Constructs the external request; model aliases and custom model IDs pass through unchanged. */
export function buildTypeSafeRequest(
  params: TypeSafeBaseParams,
  questions: TypeSafeQuestions
): TypeSafeRequest {
  if (params.state === undefined || (typeof params.state === 'string' && !params.state.trim())) {
    throw new Error('TypeSafe state is required')
  }
  const model = params.model?.trim() || 'jev-latest'
  return { state: normalizeTypeSafeEntry(params.state, 'state'), model, questions }
}

/** Reads typed answers and verifies that every requested question has an answer of the same type. */
export async function readTypeSafeResponse(
  response: Response,
  expectedQuestions?: Record<string, { type: TypeSafeQuestion['type'] }>
): Promise<TypeSafeResult> {
  const data = validate(resultSchema, await response.json(), 'response')
  if (expectedQuestions) {
    for (const [name, question] of Object.entries(expectedQuestions)) {
      if (!Object.hasOwn(data.answers, name) || data.answers[name].type !== question.type) {
        throw new Error(
          `TypeSafe response is missing the ${question.type} answer for question "${name}"`
        )
      }
    }
    if (Object.keys(data.answers).length !== Object.keys(expectedQuestions).length) {
      throw new Error('TypeSafe response question IDs do not match the request')
    }
  }
  return data
}
