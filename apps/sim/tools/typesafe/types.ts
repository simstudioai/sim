import type { ToolResponse } from '@/tools/types'

export type TypeSafeJsonValue =
  | string
  | number
  | boolean
  | null
  | TypeSafeJsonValue[]
  | { [key: string]: TypeSafeJsonValue }

export type TypeSafeEntry =
  | string
  | TypeSafeJsonValue[]
  | { [key: string]: TypeSafeJsonValue }
  | null

export type TypeSafeQuestion =
  | {
      type: 'choice'
      instructions?: TypeSafeEntry
      criteria: Record<string, TypeSafeEntry>
    }
  | { type: 'score'; instructions?: TypeSafeEntry; criteria: TypeSafeEntry[] }
  | {
      type: 'noul'
      instructions?: TypeSafeEntry
      criteria?: { true?: TypeSafeEntry; false?: TypeSafeEntry } | null
    }

export type TypeSafeQuestions = Record<string, TypeSafeQuestion>

export interface TypeSafeUsage {
  input_tokens: number
  output_tokens: number
}

export interface TypeSafeChoiceAnswer {
  type: 'choice'
  choice: string
  probabilities: Record<string, number>
  confidence: number
}

export interface TypeSafeScoreAnswer {
  type: 'score'
  score: number
  legend: Record<string, TypeSafeEntry>
  probabilities: Record<string, number>
  confidence: number
}

export interface TypeSafeNoulAnswer {
  type: 'noul'
  noul: number
}

export type TypeSafeAnswer = TypeSafeChoiceAnswer | TypeSafeScoreAnswer | TypeSafeNoulAnswer

export interface TypeSafeRequest {
  state: TypeSafeEntry
  model: string
  questions: TypeSafeQuestions
}

export interface TypeSafeResult {
  model: string
  usage: TypeSafeUsage
  answers: Record<string, TypeSafeAnswer>
}

export interface TypeSafeBaseParams {
  state: TypeSafeEntry
  apiKey: string
  model?: string
}

export interface TypeSafeChoiceParams extends TypeSafeBaseParams {
  instructions: TypeSafeEntry
  criteria: string | Record<string, TypeSafeEntry>
}

export interface TypeSafeScoreParams extends TypeSafeBaseParams {
  instructions: TypeSafeEntry
  criteria: string | TypeSafeEntry[]
}

export interface TypeSafeNoulParams extends TypeSafeBaseParams {
  instructions: TypeSafeEntry
  criteria?: string | { true?: TypeSafeEntry; false?: TypeSafeEntry } | null
}

export interface TypeSafeEvaluateParams extends TypeSafeBaseParams {
  questions: string | TypeSafeQuestions
}

export interface TypeSafeChoiceResponse extends ToolResponse {
  output: Omit<TypeSafeChoiceAnswer, 'type'> & { model: string; usage: TypeSafeUsage }
}

export interface TypeSafeScoreResponse extends ToolResponse {
  output: Omit<TypeSafeScoreAnswer, 'type'> & { model: string; usage: TypeSafeUsage }
}

export interface TypeSafeNoulResponse extends ToolResponse {
  output: Omit<TypeSafeNoulAnswer, 'type'> & { model: string; usage: TypeSafeUsage }
}

export interface TypeSafeEvaluateResponse extends ToolResponse {
  output: TypeSafeResult
}

export type TypeSafeResponse =
  | TypeSafeChoiceResponse
  | TypeSafeScoreResponse
  | TypeSafeNoulResponse
  | TypeSafeEvaluateResponse
