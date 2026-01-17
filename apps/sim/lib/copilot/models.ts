export const COPILOT_MODEL_IDS = [
  'gpt-5-fast',
  'gpt-5',
  'gpt-5-medium',
  'gpt-5-high',
  'gpt-5.1-fast',
  'gpt-5.1',
  'gpt-5.1-medium',
  'gpt-5.1-high',
  'gpt-5-codex',
  'gpt-5.1-codex',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-5.2-pro',
  'gpt-4o',
  'gpt-4.1',
  'o3',
  'claude-4-sonnet',
  'claude-4.5-haiku',
  'claude-4.5-sonnet',
  'claude-4.5-opus',
  'claude-4.1-opus',
  'gemini-3-pro',
] as const

export type CopilotModelId = (typeof COPILOT_MODEL_IDS)[number]

export const COPILOT_MODES = ['ask', 'build', 'plan'] as const
export type CopilotMode = (typeof COPILOT_MODES)[number]

export const COPILOT_TRANSPORT_MODES = ['ask', 'agent', 'plan'] as const
export type CopilotTransportMode = (typeof COPILOT_TRANSPORT_MODES)[number]

export const COPILOT_REQUEST_MODES = ['ask', 'build', 'plan', 'agent'] as const
export type CopilotRequestMode = (typeof COPILOT_REQUEST_MODES)[number]
