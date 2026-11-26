/**
 * The `tools.access` of a block that calls a model (Agent, Router, Evaluator): one id per model
 * provider it may call, not a registered tool. A leaf module, so a block reads it without loading
 * the tool metadata `access-effect` reads.
 */
export const MODEL_PROVIDER_ACCESS_IDS: readonly string[] = [
  'openai_chat',
  'anthropic_chat',
  'google_chat',
  'xai_chat',
  'deepseek_chat',
  'deepseek_reasoner',
]
