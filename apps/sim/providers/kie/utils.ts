import type { ConversationProtocol } from '@/lib/memory/conversation-types'

export const KIE_API_BASE_URL = 'https://api.kie.ai'

/** Anthropic Messages-compatible base URL; the SDK appends `/v1/messages`. */
export const KIE_CLAUDE_BASE_URL = `${KIE_API_BASE_URL}/claude`

/**
 * Kie serves each model family from its own Responses-compatible path, and a
 * model is rejected on any path but its own.
 */
const KIE_RESPONSES_PATHS: Record<string, string> = {
  'gpt-6-astra': '/codex/v1/responses',
  'gpt-6-sol': '/codex/v1/responses',
  'gpt-6-luna': '/codex/v1/responses',
  'gpt-5-6-sol': '/codex/v1/responses',
  'gpt-5-6-terra': '/codex/v1/responses',
  'gpt-5-6-luna': '/codex/v1/responses',
  'gpt-5-5': '/codex/v1/responses',
  'grok-4-6': '/grok/v1/responses',
  'grok-4-5': '/grok/v1/responses',
  'grok-4-3': '/grok/v1/responses',
  'kimi-k3': '/openai/v1/responses',
}

/** Strips the `kie/` catalog prefix to get the model slug Kie expects on the wire. */
export function getKieWireModel(model: string): string {
  return model.replace(/^kie\//i, '')
}

/** Claude models go through Kie's Anthropic Messages proxy; everything else is Responses. */
export function isKieClaudeModel(model: string): boolean {
  return getKieWireModel(model).toLowerCase().startsWith('claude-')
}

export function getKieResponsesEndpoint(model: string): string | undefined {
  const path = KIE_RESPONSES_PATHS[getKieWireModel(model).toLowerCase()]
  return path ? `${KIE_API_BASE_URL}${path}` : undefined
}

export function getKieConversationProtocol(model: string): ConversationProtocol {
  return isKieClaudeModel(model) ? 'anthropic' : 'responses'
}
