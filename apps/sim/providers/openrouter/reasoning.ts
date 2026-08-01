export type OpenRouterReasoningFormat =
  | 'unknown'
  | 'openai-responses-v1'
  | 'azure-openai-responses-v1'
  | 'xai-responses-v1'
  | 'anthropic-claude-v1'
  | 'google-gemini-v1'

interface OpenRouterReasoningDetailBase {
  format?: OpenRouterReasoningFormat
  id?: string | null
  index?: number
}

export type OpenRouterReasoningDetail =
  | (OpenRouterReasoningDetailBase & {
      type: 'reasoning.encrypted'
      data: string
    })
  | (OpenRouterReasoningDetailBase & {
      type: 'reasoning.summary'
      summary: string
    })
  | (OpenRouterReasoningDetailBase & {
      type: 'reasoning.text'
      signature?: string | null
      text?: string | null
    })

/** Returns the user-displayable text from a documented OpenRouter reasoning block. */
export function getOpenRouterReasoningDetailText(detail: OpenRouterReasoningDetail): string {
  if (detail.type === 'reasoning.summary') return detail.summary
  if (detail.type === 'reasoning.text' && typeof detail.text === 'string') return detail.text
  return ''
}
