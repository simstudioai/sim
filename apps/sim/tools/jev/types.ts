import type { ToolResponse } from '@/tools/types'

export type JevJsonValue =
  | string
  | number
  | boolean
  | null
  | JevJsonValue[]
  | { [key: string]: JevJsonValue }

export type JevContent = string | JevJsonValue[] | { [key: string]: JevJsonValue }

export type JevQuestion =
  | {
      type: 'choice'
      instructions: JevContent
      criteria: Record<string, JevContent | null>
    }
  | { type: 'score'; instructions: JevContent; criteria: JevContent[] }
  | {
      type: 'noul'
      instructions: JevContent
      criteria?: { true?: JevContent; false?: JevContent }
    }

export interface JevBaseParams {
  apiKey: string
  model?: string
  state: JevContent
}

export interface JevChoiceParams extends JevBaseParams {
  instructions: JevContent
  criteria: Record<string, JevContent | null> | string
}

export interface JevScoreParams extends JevBaseParams {
  instructions: JevContent
  criteria: JevContent[] | string
}

export interface JevNoulParams extends JevBaseParams {
  instructions: JevContent
  criteria?: { true?: JevContent; false?: JevContent } | string
}

export interface JevEvaluateParams extends JevBaseParams {
  questions: Record<string, JevQuestion> | string
}

export interface JevChoiceAnswer {
  type: 'choice'
  choice: string
  probabilities: Record<string, number>
  confidence: number
}

export interface JevScoreAnswer {
  type: 'score'
  score: number
  legend: Record<string, JevContent>
  probabilities: Record<string, number>
  confidence: number
}

export interface JevNoulAnswer {
  type: 'noul'
  noul: number
}

export type JevAnswer = JevChoiceAnswer | JevScoreAnswer | JevNoulAnswer

export interface JevUsage {
  input_tokens: number
  output_tokens: number
}

export interface JevResponseMetadata {
  model: string
  usage: JevUsage
}

export interface JevEvaluateResponse extends ToolResponse {
  output: JevResponseMetadata & { answers: Record<string, JevAnswer> }
}

export interface JevChoiceResponse extends ToolResponse {
  output: JevResponseMetadata & Omit<JevChoiceAnswer, 'type'>
}

export interface JevScoreResponse extends ToolResponse {
  output: JevResponseMetadata & Omit<JevScoreAnswer, 'type'>
}

export interface JevNoulResponse extends ToolResponse {
  output: JevResponseMetadata & Omit<JevNoulAnswer, 'type'>
}
