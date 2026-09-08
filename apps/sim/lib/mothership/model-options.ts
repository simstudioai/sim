import type { ChatRequest, ModelSelection } from '@/lib/mothership/generated/protocol'

/** Shared model and effort choices for chat and the Sim Chat block. */
export type MothershipEffort = NonNullable<ChatRequest['effort']>

export const MOTHERSHIP_EFFORT_OPTIONS: Array<{ value: MothershipEffort; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
  { value: 'max', label: 'Max' },
]

export const MOTHERSHIP_MODEL_OPTIONS = [
  { value: 'gpt-6-astra', label: 'GPT-6 Astra' },
  { value: 'claude-opus-5', label: 'Opus 5' },
] satisfies Array<{ value: ModelSelection['model']; label: string }>
