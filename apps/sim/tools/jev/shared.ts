import { z } from 'zod'
import type { JevBaseParams, JevContent, JevEvaluateResponse, JevQuestion } from '@/tools/jev/types'
import type { ToolConfig } from '@/tools/types'

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
const responseSchema: z.ZodType<JevEvaluateResponse['output']> = z.object({
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

export const JEV_COMMON_PARAMS = {
  apiKey: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'TypeSafe API key from https://console.typesafe.ai',
  },
  model: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description:
      'Model ID or alias: jev-1.13.0, jev-latest, or jev-preview. Defaults to jev-1.13.0.',
  },
  state: {
    type: 'json',
    required: true,
    visibility: 'user-or-llm',
    description: 'Content to evaluate: a text string, JSON object, or array.',
  },
} as const satisfies ToolConfig['params']

export const JEV_INSTRUCTIONS_PARAM = {
  type: 'json',
  required: true,
  visibility: 'user-or-llm',
  description: 'The question to evaluate, as text, a JSON object, or an array.',
} as const

export const JEV_REQUEST = {
  url: 'https://api.typesafe.ai/v1/systemone',
  method: 'POST',
  headers: (params: JevBaseParams) => ({
    Authorization: `Bearer ${params.apiKey}`,
    'Content-Type': 'application/json',
  }),
  retry: { enabled: true, maxRetries: 3, retryIdempotentOnly: false },
} satisfies ToolConfig<JevBaseParams>['request']

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

export function buildJevBody(params: JevBaseParams, questions: unknown) {
  const parsedQuestions = parseJevQuestions(questions)
  const state = contentSchema.safeParse(params.state)
  if (!state.success) throw new Error('Jev state must be text, a JSON object, or an array')
  return {
    model: params.model?.trim() || 'jev-1.13.0',
    state: state.data,
    questions: parsedQuestions,
  }
}

export async function parseJevResponse(response: Response) {
  const result = responseSchema.safeParse(await response.json())
  if (!result.success) throw new Error('TypeSafe returned an invalid Jev evaluation response')
  return result.data
}
