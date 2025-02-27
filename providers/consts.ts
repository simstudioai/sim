import { ProviderId } from './registry'

/**
 * Direct mapping from model names to provider IDs
 * This replaces the need for the MODEL_TOOLS mapping in blocks/consts.ts
 */
export const MODEL_PROVIDERS: Record<string, ProviderId> = {
  'gpt-4o': 'openai',
  o1: 'openai',
  'o3-mini': 'openai',
  'claude-3-7-sonnet-20250219': 'anthropic',
  'gemini-2.0-flash': 'google',
  'grok-2-latest': 'xai',
  'deepseek-v3': 'deepseek',
  'deepseek-r1': 'deepseek',
  'llama-3.3-70b': 'cerebras',
}
