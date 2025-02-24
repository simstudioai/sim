export const MODEL_TOOLS = {
  'gpt-4o': 'openai_chat',
  o1: 'openai_chat',
  'o3-mini': 'openai_chat',
  'deepseek-v3': 'deepseek_chat',
  'deepseek-r1': 'deepseek_reasoner',
  'claude-3-7-sonnet-20250219': 'anthropic_chat',
  'gemini-2.0-flash': 'google_chat',
  'grok-2-latest': 'xai_chat',
} as const

export type ModelType = keyof typeof MODEL_TOOLS
export type ToolType = (typeof MODEL_TOOLS)[ModelType]
