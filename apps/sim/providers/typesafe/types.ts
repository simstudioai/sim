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

export interface JevEvaluationResult extends JevResponseMetadata {
  answers: Record<string, JevAnswer>
}
