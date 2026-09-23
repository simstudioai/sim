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
  { value: 'gpt-6-sol', label: 'GPT-6 Sol' },
  { value: 'claude-opus-5-5', label: 'Opus 5.5' },
] satisfies Array<{ value: ModelSelection['model']; label: string }>

/** Labels deliberately describe the simplified product dial; values are provider efforts. */
export const MOTHERSHIP_SIMPLE_EFFORT_OPTIONS: Array<{ value: MothershipEffort; label: string }> = [
  { value: 'medium', label: 'Low' },
  { value: 'high', label: 'Medium' },
  { value: 'xhigh', label: 'High' },
]

export function mothershipEffortOptions(model: ModelSelection['model']) {
  return model === 'gpt-6-sol'
    ? [{ value: 'none' as const, label: 'None' }, ...MOTHERSHIP_EFFORT_OPTIONS]
    : MOTHERSHIP_EFFORT_OPTIONS
}

/** Shared by the visible controls, send path and server admission so hidden preferences cannot leak. */
export function resolveMothershipModelSettings(
  settings: { effort?: MothershipEffort; modelSelection?: ModelSelection },
  advanced: boolean
): { effort: MothershipEffort; modelSelection: ModelSelection } {
  let effort = settings.effort ?? 'high'
  if (!advanced) {
    if (effort === 'none' || effort === 'low') effort = 'medium'
    if (effort === 'max') effort = 'xhigh'
    return { effort, modelSelection: { model: 'gpt-6-astra', fastMode: false } }
  }
  const stored = settings.modelSelection ?? { model: 'gpt-6-astra', fastMode: false }
  const model = stored.model === 'claude-opus-5' ? 'claude-opus-5-5' : stored.model
  if (effort === 'none' && model !== 'gpt-6-sol') effort = 'medium'
  return {
    effort,
    modelSelection: { model, fastMode: model === 'claude-opus-5-5' ? false : stored.fastMode },
  }
}
