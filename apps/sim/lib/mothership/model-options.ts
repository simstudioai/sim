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
  { value: 'gpt-6-sol', label: 'GPT-6.1 Sol' },
  { value: 'claude-opus-5-5', label: 'Opus 5.5' },
] satisfies Array<{ value: ModelSelection['model']; label: string }>

/** The effort a chat or Sim Chat block runs at until the user picks one. */
export const DEFAULT_MOTHERSHIP_EFFORT: MothershipEffort = 'high'

const SIMPLE_EFFORT_VALUES: ReadonlySet<MothershipEffort> = new Set([
  'low',
  'medium',
  'high',
  'xhigh',
])

/** The efforts the simple picker offers, labeled with the effort each one sends. */
export const MOTHERSHIP_SIMPLE_EFFORT_OPTIONS = MOTHERSHIP_EFFORT_OPTIONS.filter((option) =>
  SIMPLE_EFFORT_VALUES.has(option.value)
)

/**
 * Shared by the visible controls, send path and server admission so hidden preferences cannot leak.
 * Without the model picker no selection is sent, so the worker routes every model role itself.
 */
export function resolveMothershipModelSettings(
  settings: { effort?: MothershipEffort; modelSelection?: ModelSelection },
  advanced: boolean,
  plan = false
): { effort: MothershipEffort; modelSelection: ModelSelection | undefined } {
  let effort = settings.effort ?? DEFAULT_MOTHERSHIP_EFFORT
  // No served model reasons at `none`; a pick stored before it was retired runs at the nearest effort.
  if (effort === 'none') effort = 'low'
  if (!advanced) {
    if (!plan && effort === 'max') effort = 'xhigh'
    return { effort, modelSelection: plan ? { model: 'claude-opus-5-5', fastMode: false } : undefined }
  }
  const modelSelection = normalizeModelSelection(
    settings.modelSelection ?? { model: plan ? 'claude-opus-5-5' : 'gpt-6-astra', fastMode: false }
  )
  return { effort, modelSelection }
}

/** A stored pick on the current catalog: Opus 5 reads as Opus 5.5, which has no Fast mode. */
export function normalizeModelSelection(stored: ModelSelection): ModelSelection {
  const model = stored.model === 'claude-opus-5' ? 'claude-opus-5-5' : stored.model
  return { model, fastMode: model === 'claude-opus-5-5' ? false : stored.fastMode }
}
